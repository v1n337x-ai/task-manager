import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";

export interface PptTemplateSlideAnalysis {
  number: number;
  title: string | null;
  role: string;
  textPreview: string[];
  hasTable: boolean;
  hasChart: boolean;
}

export interface PptTemplateAnalysis {
  filename: string;
  sha256: string;
  storedBytes: number;
  slideCount: number;
  slideSize: { cx: number; cy: number; widthInches: number; heightInches: number } | null;
  themes: Array<{ name: string; colors: string[] }>;
  media: Array<{ name: string; ext: string; bytes: number }>;
  fonts: string[];
  slides: PptTemplateSlideAnalysis[];
  aiAvailable: boolean;
  warnings: string[];
}

const TEMPLATE_DIR = path.join(process.cwd(), "prisma", "templates", "ppt");
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, "uploaded-template.pptx");
const ANALYSIS_PATH = path.join(TEMPLATE_DIR, "uploaded-template-analysis.json");
export const MAX_PPT_TEMPLATE_BYTES = 25 * 1024 * 1024;

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractAllText(xml: string): string[] {
  return [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)].map((m) => decodeXmlText(m[1]));
}

function firstNonEmpty(values: string[]): string | null {
  return values.find((v) => v.trim().length > 0) ?? null;
}

function inferRole(index: number, title: string, allText: string[]): string {
  const text = `${title} ${allText.join(" ")}`.toLowerCase();
  if (index === 1) return "cover";
  if (/table of contents|toc/.test(text)) return "table_of_contents";
  if (/executive summary/.test(text)) return "executive_summary";
  if (/application register/.test(text)) return "application_register";
  if (/application owners/.test(text)) return "application_owners";
  if (/application status|status dashboard/.test(text)) return "application_status";
  if (/internal vs external/.test(text)) return "internal_vs_external";
  if (/severity overview/.test(text)) return "severity_overview";
  if (/findings by application/.test(text)) return "findings_by_application";
  if (/scan timeline/.test(text)) return "scan_timeline";
  if (/remediation status/.test(text)) return "remediation_status";
  if (/cumulative findings/.test(text)) return "cumulative_findings";
  if (/key insights/.test(text)) return "key_insights";
  if (/security activity/.test(text)) return "security_activity";
  if (/sophos policies/.test(text)) return "sophos_policies";
  if (/future/.test(text)) return "future_work";
  if (/ongoing process/.test(text)) return "ongoing_process";
  if (/\bm365\b/.test(text)) return "m365";
  return "other";
}

export async function analyzePptx(buffer: Buffer, filename: string): Promise<PptTemplateAnalysis> {
  const warnings: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("The uploaded file is not a readable Office Open XML presentation.");
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string").catch(() => null);
  if (!presentationXml) throw new Error("The presentation does not contain ppt/presentation.xml.");
  const relsText = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string").catch(() => "")) ?? "";
  const relMap = new Map<string, string>();
  for (const m of relsText.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
  const slideTargets = [...presentationXml.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/g)]
    .map((m) => relMap.get(m[1]))
    .filter((t): t is string => Boolean(t))
    .map((t) => t.replace(/^\/ppt\//, "ppt/").replace(/^slides\//, "ppt/slides/"));
  const slideCount = slideTargets.length;
  if (!slideCount) throw new Error("No slides were found in the uploaded presentation.");

  const sizeMatch = presentationXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const slideSize = sizeMatch
    ? {
        cx: Number(sizeMatch[1]),
        cy: Number(sizeMatch[2]),
        widthInches: Number(sizeMatch[1]) / 914400,
        heightInches: Number(sizeMatch[2]) / 914400,
      }
    : null;

  const themes: PptTemplateAnalysis["themes"] = [];
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))) {
    const xml = (await zip.file(name)?.async("string").catch(() => "")) ?? "";
    const colors = [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)].map((m) => `#${m[1].toLowerCase()}`);
    themes.push({ name: path.basename(name), colors: [...new Set(colors)].slice(0, 20) });
  }

  const media: PptTemplateAnalysis["media"] = [];
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/") && !zip.files[n]?.dir)) {
    const file = zip.files[name];
    const data = file ? await file.async("uint8array") : new Uint8Array();
    media.push({ name: path.basename(name), ext: path.extname(name).slice(1), bytes: data.length });
  }

  const fonts = new Set<string>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (/^ppt\/slideMasters\/slideMaster\d+\.xml$|^ppt\/slideLayouts\/slideLayout\d+\.xml$|^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      const xml = await file.async("string").catch(() => "");
      for (const m of xml.matchAll(/<a:latin typeface="([^"]+)"/g)) fonts.add(m[1]);
    }
  }

  const slides: PptTemplateSlideAnalysis[] = [];
  for (let i = 0; i < slideTargets.length; i++) {
    const target = slideTargets[i]!;
    const xml = await zip.file(target)?.async("string").catch(() => "");
    if (!xml) {
      warnings.push(`Could not read ${target}; slide analysis is partial.`);
      slides.push({ number: i + 1, title: null, role: "other", textPreview: [], hasTable: false, hasChart: false });
      continue;
    }
    const texts = extractAllText(xml);
    const title = firstNonEmpty(texts);
    slides.push({
      number: i + 1,
      title,
      role: inferRole(i + 1, title ?? "", texts),
      textPreview: texts.filter((t) => t.trim()).slice(0, 12),
      hasTable: xml.includes("<a:tbl>"),
      hasChart: xml.includes("<c:chart") || xml.includes("chart"),
    });
  }

  return {
    filename,
    sha256,
    storedBytes: buffer.length,
    slideCount,
    slideSize,
    themes,
    media,
    fonts: [...fonts].slice(0, 12),
    slides,
    aiAvailable: Boolean(process.env.OPENCODE_SERVER_URL && process.env.OPENCODE_SERVER_PASSWORD),
    warnings,
  };
}

export async function saveTemplate(buffer: Buffer, filename: string): Promise<PptTemplateAnalysis> {
  if (buffer.length > MAX_PPT_TEMPLATE_BYTES) throw new Error("PPT template must be 25 MB or smaller.");
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("File must be a valid .pptx presentation.");
  const analysis = await analyzePptx(buffer, filename);
  await fs.mkdir(TEMPLATE_DIR, { recursive: true });
  await fs.writeFile(TEMPLATE_PATH, buffer);
  await fs.writeFile(ANALYSIS_PATH, JSON.stringify(analysis, null, 2), "utf8");
  return analysis;
}

export async function getTemplateStatus(): Promise<PptTemplateAnalysis | null> {
  try {
    const raw = await fs.readFile(ANALYSIS_PATH, "utf8");
    return JSON.parse(raw) as PptTemplateAnalysis;
  } catch {
    return null;
  }
}

export async function getStoredTemplate(): Promise<{ buffer: Buffer; analysis: PptTemplateAnalysis } | null> {
  const analysis = await getTemplateStatus();
  if (!analysis) return null;
  try {
    return { buffer: await fs.readFile(TEMPLATE_PATH), analysis };
  } catch {
    return null;
  }
}

export async function removeTemplate(): Promise<void> {
  await Promise.all([
    fs.rm(TEMPLATE_PATH, { force: true }),
    fs.rm(ANALYSIS_PATH, { force: true }),
  ]);
}

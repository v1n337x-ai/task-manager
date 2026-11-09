import { prisma } from "@/lib/db";

const BRANDING_DOMAIN = "ui_branding";

export const DEFAULT_PRIMARY = "#ff8c42";
export const DEFAULT_SECONDARY = "#9b7bb5";

export interface BrandingColors {
  primary: string;
  secondary: string;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (!HEX_RE.test(v)) throw new Error("Color must be an Akasa orange or violet hex code, for example #ff8c42 or #9b7bb5.");
  return v;
}

function hsl(hex: string): { hue: number; saturation: number } {
  const [r255, g255, b255] = parseChannels(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  if (delta === 0) return { hue: 0, saturation };
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation };
}

export function validatePrimaryColor(value: unknown): string {
  if (typeof value !== "string") throw new Error("Akasa primary must be an orange hex code.");
  const hex = normalizeHex(value);
  const { hue, saturation } = hsl(hex);
  if (hue < 8 || hue > 48 || saturation < 0.35) throw new Error("Akasa primary must be an orange hex code.");
  return hex;
}

export function validateSecondaryColor(value: unknown): string {
  if (typeof value !== "string") throw new Error("Akasa secondary must be a violet hex code.");
  const hex = normalizeHex(value);
  const { hue, saturation } = hsl(hex);
  if (hue < 255 || hue > 302 || saturation < 0.12) throw new Error("Akasa secondary must be a violet hex code.");
  return hex;
}

function parseChannels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Mix a hex color with another hex color by the weight of the second color.
 * `mix("#ff8c42", "#ffffff", 0.92)` returns a very light tint.
 */
export function mixHex(hex: string, withHex: string, weight: number): string {
  const [r, g, b] = parseChannels(hex);
  const [wr, wg, wb] = parseChannels(withHex);
  return rgbToHex(r * (1 - weight) + wr * weight, g * (1 - weight) + wg * weight, b * (1 - weight) + wb * weight);
}

export function lightTint(hex: string, weight = 0.92): string {
  return mixHex(hex, "#ffffff", weight);
}

export function deepShade(hex: string, weight = 0.82): string {
  return mixHex(hex, "#000000", weight);
}

export function validateColor(value: unknown): string {
  if (typeof value !== "string") throw new Error("Color must be a hex code string.");
  return normalizeHex(value);
}

async function readStored(key: string): Promise<string | null> {
  const row = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: BRANDING_DOMAIN, value: key } },
    select: { label: true },
  });
  return row?.label ?? null;
}

/**
 * Read the admin-selected UI brand colors. Falls back to the existing
 * orange/violet Akasa defaults if no value has been saved yet.
 */
export async function getBrandingColors(): Promise<BrandingColors> {
  const [primary, secondary] = await Promise.all([
    readStored("primary").catch(() => null),
    readStored("secondary").catch(() => null),
  ]);
  return {
    primary: primary && HEX_RE.test(primary) ? primary.toLowerCase() : DEFAULT_PRIMARY,
    secondary: secondary && HEX_RE.test(secondary) ? secondary.toLowerCase() : DEFAULT_SECONDARY,
  };
}

export async function setBrandingColors(colors: BrandingColors): Promise<BrandingColors> {
  const primary = validatePrimaryColor(colors.primary);
  const secondary = validateSecondaryColor(colors.secondary);
  const upserts: Array<[string, string, number]> = [
    ["primary", primary, 1],
    ["secondary", secondary, 2],
  ];
  for (const [value, label, sortOrder] of upserts) {
    await prisma.masterValue.upsert({
      where: { domain_value: { domain: BRANDING_DOMAIN, value } },
      update: { label, isActive: true, sortOrder },
      create: { domain: BRANDING_DOMAIN, value, label, isActive: true, sortOrder },
    });
  }
  return { primary, secondary };
}

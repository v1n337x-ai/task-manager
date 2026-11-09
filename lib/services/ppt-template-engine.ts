import JSZip from "jszip";
import type { DashboardReport } from "./reporting/report-service";

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface TextNode {
  index: number;
  value: string;
  start: number;
  end: number;
  insideTable: boolean;
}

export function extractTextNodes(xml: string): TextNode[] {
  const nodes: TextNode[] = [];
  let i = 0;
  let activeTables = 0;
  const re = /<a:tbl[^>]*>|<\/a:tbl>|<a:t[^>]*>([^<]*)<\/a:t>/g;
  for (const m of xml.matchAll(re)) {
    const tag = m[0];
    if (tag.startsWith("<a:tbl")) {
      activeTables += 1;
    } else if (tag.startsWith("</a:tbl>")) {
      activeTables = Math.max(0, activeTables - 1);
    } else {
      nodes.push({
        index: i++,
        value: decodeXmlText(m[1]),
        start: m.index + m[0].indexOf(">") + 1,
        end: m.index + m[0].length - 6,
        insideTable: activeTables > 0,
      });
    }
  }
  return nodes;
}

function replaceTextNodes(xml: string, changes: Map<number, string>): string {
  if (!changes.size) return xml;
  const nodes = extractTextNodes(xml);
  const replacements = [...changes.entries()]
    .filter(([i]) => i >= 0 && i < nodes.length)
    .map(([i, value]) => ({ start: nodes[i]!.start, end: nodes[i]!.end, value }))
    .sort((a, b) => b.start - a.start);
  let next = xml;
  for (const r of replacements) next = `${next.slice(0, r.start)}${escapeXml(r.value)}${next.slice(r.end)}`;
  return next;
}

function shapeOffsetForNode(xml: string, node: TextNode): { y: number; start: number } | null {
  const shapeStart = xml.lastIndexOf("<p:sp", node.start);
  const shapeEnd = xml.lastIndexOf("</p:sp>", node.start);
  const searchFrom = Math.max(shapeStart, shapeEnd >= 0 ? shapeEnd + 7 : 0);
  const offRe = /<a:off x="(\d+)" y="(\d+)"/g;
  let last: { y: number; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = offRe.exec(xml))) {
    if (m.index < searchFrom) continue;
    if (m.index > node.start) break;
    last = { y: Number(m[2]), start: m.index };
  }
  return last;
}

function setTextShapeY(xml: string, text: string, newY: number): string {
  const nodes = extractTextNodes(xml);
  const node = nodes.find((n) => n.value.trim().toLowerCase() === text.toLowerCase());
  if (!node) return xml;
  const off = shapeOffsetForNode(xml, node);
  if (!off) return xml;
  const tag = xml.slice(off.start).match(/^<a:off x="\d+" y="\d+"/)?.[0];
  if (!tag) return xml;
  const nextTag = tag.replace(/\by="\d+"/, `y="${newY}"`);
  return `${xml.slice(0, off.start)}${nextTag}${xml.slice(off.start + tag.length)}`;
}

function setNodeShapeY(xml: string, node: TextNode, newY: number): string {
  const off = shapeOffsetForNode(xml, node);
  if (!off) return xml;
  const tag = xml.slice(off.start).match(/^<a:off x="\d+" y="\d+"/)?.[0];
  if (!tag) return xml;
  const nextTag = tag.replace(/\by="\d+"/, `y="${newY}"`);
  return `${xml.slice(0, off.start)}${nextTag}${xml.slice(off.start + tag.length)}`;
}

function applyReferenceTocRunStyle(xml: string, targetText: string, referenceText: string): string {
  const shapePattern = /<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g;
  const rPrPattern = /<a:rPr[^>]*>[\s\S]*?<\/a:rPr>|<a:rPr[^>]*\/>/;
  let referenceRPr = "";
  for (const shape of xml.matchAll(shapePattern)) {
    if (!new RegExp(`<a:t>${referenceText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</a:t>`, "i").test(shape[0])) continue;
    referenceRPr = shape[0].match(rPrPattern)?.[0] ?? "";
    break;
  }
  if (!referenceRPr) return xml;
  return xml.replace(shapePattern, (shape) => {
    if (!new RegExp(`<a:t>${targetText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</a:t>`, "i").test(shape)) return shape;
    if (rPrPattern.test(shape)) return shape.replace(rPrPattern, referenceRPr);
    return shape.replace(/<a:t>/, `<a:rPr sz="1250" b="1"><a:solidFill><a:srgbClr val="1F1F1F"/></a:solidFill><a:latin typeface="Poppins"/></a:rPr><a:t>`);
  });
}

function metricValuesFor(report: DashboardReport): Record<string, string | number> {
  const closureRate = report.totalFindings ? `${((report.closedFindings / report.totalFindings) * 100).toFixed(1)}%` : "0.0%";
  const pendingRate = report.totalFindings ? `${((report.pendingFindings / report.totalFindings) * 100).toFixed(1)}%` : "0.0%";
  const fullyCleared = report.applications.filter((a) => a.counts.total > 0 && a.counts.pending === 0).length;
  const highOpenApps = report.applications.filter((a) => a.counts.high > 0 && a.counts.pending > 0).length;
  const criticalOpenApps = report.applications.filter((a) => a.counts.critical > 0 && a.counts.pending > 0).length;
  return {
    applications: report.totalApplications,
    "applications assessed": report.totalApplications,
    "total findings": report.totalFindings,
    closed: report.closedFindings,
    "open / pending": report.pendingFindings,
    open: report.pendingFindings,
    pending: report.pendingFindings,
    "closure rate": closureRate,
    "closure rate percent": closureRate,
    "pending rate": pendingRate,
    "critical (open)": criticalOpenApps,
    "high (open)": highOpenApps,
    "car verified": report.carVerified,
    car: report.carVerified,
    critical: report.severityBreakdown.critical,
    high: report.severityBreakdown.high,
    medium: report.severityBreakdown.medium,
    low: report.severityBreakdown.low,
    info: report.severityBreakdown.info,
    fixed: report.statusBreakdown.fixed,
    "not fixed": report.statusBreakdown.notFixed,
    reopened: report.statusBreakdown.reopened,
    "fully cleared": fullyCleared,
    "10/34": `${fullyCleared}/${report.totalApplications}`,
    "applications covered": report.totalApplications,
  };
}

function metricForText(raw: string): string | null {
  const text = normalize(raw);
  if (text.includes("critical (open)")) return "critical (open)";
  if (text.includes("high (open)")) return "high (open)";
  if (text.includes("open") && text.includes("critical")) return null;
  if (text.includes("open") && text.includes("high")) return null;
  if (text.includes("critical and high")) return null;
  if (text.includes("applications assessed") || text === "applications" || text === "application") return "applications";
  if (text.includes("total findings") || text.includes("total vuln count") || text.includes("findings recorded")) return "total findings";
  if (text.includes("open / pending") || text === "open pending") return "open / pending";
  if (text === "closed" || text.includes("vulnerabilities closed") || text.includes("vulnerability closed") || text.includes("are closed")) return "closed";
  if (text.includes("closure rate")) return "closure rate";
  if (text.includes("car verified")) return "car verified";
  if (text === "car") return "car";
  if (text === "fixed") return "fixed";
  if (text.includes("not fixed")) return "not fixed";
  if (text === "reopened") return "reopened";
  if (text === "fully cleared") return "fully cleared";
  if (text === "critical") return "critical";
  if (text === "high") return "high";
  if (text === "medium") return "medium";
  if (text === "low") return "low";
  if (text === "info") return "info";
  if (text.includes("pending")) return "pending";
  return null;
}

function replaceKpiText(xml: string, metrics: Record<string, string | number>): string {
  const nodes = extractTextNodes(xml);
  const changes = new Map<number, string>();
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]!.insideTable) continue;
    const current = nodes[i]!.value.trim();
    if (/across \d+ applications,\s*\d+ findings were recorded/i.test(current)) {
      changes.set(
        i,
        `Across ${metrics.applications} applications, ${metrics["total findings"]} findings were recorded; ${metrics.closed} (${metrics["closure rate"]}) are closed and ${metrics["open / pending"]} remain open, including ${Number(metrics.critical) + Number(metrics.high)} Critical and High findings.`,
      );
      continue;
    }
    if (/^(?:\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty)\s+of\s+\d+\s+applications are fully cleared/i.test(current)) {
      changes.set(i, `${metrics["fully cleared"]} of ${metrics.applications} applications are fully cleared.`);
      continue;
    }
    if (!/^(?:\d+(?:\.\d+)?%?|\d+\s*\/\s*\d+)$/.test(current)) continue;
    // Numeric KPI cards put the label immediately after the value. Prefer
    // that nearest follower, then the nearest preceding label.
    const ordered: number[] = [];
    for (let distance = 1; distance <= 4; distance++) {
      if (i + distance < nodes.length) ordered.push(i + distance);
      if (i - distance >= 0) ordered.push(i - distance);
    }
    for (const j of ordered) {
      const candidate = nodes[j]!.value;
      const key = metricForText(candidate);
      if (!key || metrics[key] === undefined) continue;
      const expected = String(metrics[key]);
      if (current !== expected) changes.set(i, expected);
      break;
    }
  }
  return replaceTextNodes(xml, changes);
}

function replaceDates(xml: string, report: DashboardReport): string {
  const generated = new Date(report.generatedAt);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = months[generated.getMonth()];
  const day = String(generated.getDate()).padStart(2, "0");
  const month = String(generated.getMonth() + 1).padStart(2, "0");
  const year = generated.getFullYear();
  let out = xml;
  out = out.replace(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi, `${day} ${monthName} ${year}`);
  out = out.replace(/\d{1,2}\/(?:0?[1-9]|1[0-2])\/\d{4}/g, `${day}/${month}/${year}`);
  out = out.replace(/\d{1,2}-(?:0?[1-9]|1[0-2])-?\d{2,4}/g, `${day}-${month}-${year}`);
  out = out.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi, `${monthName} ${year}`);
  return out;
}

function cleanXmlText(value: string): string {
  return decodeXmlText(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeAppName(value: string): string {
  return normalize(value)
    .replace(/\bweb\b/g, "")
    .replace(/\bblack box testing\b/g, "bb")
    .replace(/\bblack box\b/g, "bb")
    .replace(/\btesting\b/g, "")
    .replace(/\bwww\b/g, "")
    .replace(/\bakasa air\b/g, "")
    .replace(/\becommerce\b/g, "ecom")
    .replace(/\bmarketing\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function appMatches(rowName: string, report: DashboardReport) {
  const wanted = normalizeAppName(rowName);
  if (!wanted) return undefined;
  const isUat = /\buat\b/.test(wanted);
  const isProd = /\bprod\b/.test(wanted);
  let best: (typeof report.applications)[number] | undefined;
  let bestScore = 0;
  for (const a of report.applications) {
    const current = normalizeAppName(a.displayName);
    if (!current) continue;
    if (wanted === current) return a;
    if (isUat && !/\buat\b/.test(current)) continue;
    if (isProd && !/\bprod\b/.test(current)) continue;
    const score = wanted.split(" ").filter((t) => t.length > 2 && current.split(" ").includes(t)).length;
    if (score > bestScore && score >= 2) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

function replaceTables(xml: string, report: DashboardReport, engagementStatusByAppId?: Map<number, string>): string {
  let out = xml;
  const tableRe = /<a:tbl>[\s\S]*?<\/a:tbl>/g;
  out = out.replace(tableRe, (tableXml) => {
    const rows: string[] = [];
    const rowRe = /<a:tr[^>]*>[\s\S]*?<\/a:tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableXml))) rows.push(rowMatch[0]);
    if (rows.length < 2) return tableXml;

    const getCells = (rowXml: string) =>
      [...rowXml.matchAll(/(<a:tc[^>]*>)([\s\S]*?)(<\/a:tc>)/g)].map((m) => ({ open: m[1], body: m[2], close: m[3], text: cleanXmlText(m[2]) }));
    const headers = getCells(rows[0]).map((c) => normalize(c.text));
    if (!headers.some((h) => h.includes("application"))) return tableXml;

    const headerIndex = (name: string) => headers.findIndex((h) => h.includes(name));
    const applicationIdx = headerIndex("application");
    const typeIdx = headers.findIndex((h) => h === "type");
    const statusIdx = headers.findIndex((h) => h.includes("status"));
    const scopeIdx = headers.findIndex((h) => h.includes("scope"));
    const totalIdx = headers.findIndex((h) => h === "total" || h === "total vuln count");
    const pendingIdx = headers.findIndex((h) => h === "pending" || h === "open");
    const closedIdx = headers.findIndex((h) => h === "closed" || h === "fixed");
    const critIdx = headers.findIndex((h) => h === "critical" || h === "crit");
    const highIdx = headers.findIndex((h) => h === "high");
    const medIdx = headers.findIndex((h) => h === "medium" || h === "med");
    const lowIdx = headers.findIndex((h) => h === "low");
    const carIdx = headers.findIndex((h) => h === "car");
    const nfIdx = headers.findIndex((h) => h.includes("not fixed"));
    const reopenedIdx = headers.findIndex((h) => h === "reopened");
    const latestIdx = headers.findIndex((h) => h.includes("latest iteration") || h.includes("latest"));
    if (applicationIdx < 0) return tableXml;

    const nextTable = tableXml;
    let rebuilt = nextTable.slice(0, nextTable.indexOf(rows[0]));
    rebuilt += rows[0];

    for (let r = 1; r < rows.length; r++) {
      const rowXml = rows[r];
      const cells = [...rowXml.matchAll(/(<a:tc[^>]*>)([\s\S]*?)(<\/a:tc>)/g)].map((m) => ({ open: m[1], body: m[2], close: m[3], text: cleanXmlText(m[2]) }));
      const appName = cells[applicationIdx]?.text ?? "";
      const app = appMatches(appName, report);
      if (!app) {
        rebuilt += rowXml;
        continue;
      }
      const values: Record<number, string | null> = {};
      if (typeIdx >= 0) values[typeIdx] = app.typeName;
      if (statusIdx >= 0) values[statusIdx] = engagementStatusByAppId?.get(app.id) ?? app.statusLabel;
      if (scopeIdx >= 0) values[scopeIdx] = app.scopeLabel;
      if (totalIdx >= 0) values[totalIdx] = String(app.counts.total);
      if (pendingIdx >= 0) values[pendingIdx] = String(app.counts.pending);
      if (closedIdx >= 0) values[closedIdx] = String(app.counts.fixed);
      if (critIdx >= 0) values[critIdx] = String(app.counts.critical);
      if (highIdx >= 0) values[highIdx] = String(app.counts.high);
      if (medIdx >= 0) values[medIdx] = String(app.counts.medium);
      if (lowIdx >= 0) values[lowIdx] = String(app.counts.low);
      if (carIdx >= 0) values[carIdx] = String(app.counts.car);
      if (nfIdx >= 0) values[nfIdx] = String(app.counts.notFixed);
      if (reopenedIdx >= 0) values[reopenedIdx] = String(app.counts.reopened);
      if (latestIdx >= 0) values[latestIdx] = app.latestIteration ? `I${app.latestIteration}` : null;
      // Owner is not present in the report snapshot, so leave it untouched.

      const changedCells = cells.map((cell, idx) => {
        const value = values[idx];
        if (value === null || value === undefined) return `${cell.open}${cell.body}${cell.close}`;
        const body = cell.body.replace(/<a:t[^>]*>[^<]*<\/a:t>/, `<a:t>${escapeXml(value)}</a:t>`);
        return `${cell.open}${body}${cell.close}`;
      });
      const rowOpening = rowXml.match(/^<a:tr[^>]*>/)?.[0] ?? "<a:tr>";
      rebuilt += `${rowOpening}${changedCells.join("")}</a:tr>`;
    }
    rebuilt += nextTable.slice(nextTable.lastIndexOf(rows[rows.length - 1]) + rows[rows.length - 1].length);
    return rebuilt;
  });
  return out;
}

function countBy(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
}

function replaceChartValues(xml: string, report: DashboardReport, engagementStatusCounts?: Map<string, number>): string {
  let out = xml;
  const statusCounts = engagementStatusCounts ?? countBy(report.applications.map((a) => a.statusLabel));
  const typeCounts = countBy(report.applications.map((a) => a.typeName));
  const statusValues: Record<string, number> = {};
  for (const label of statusCounts.keys()) {
    if (label === "Pending") statusValues["Open — Retest"] = statusCounts.get(label) ?? 0;
    statusValues[label] = statusCounts.get(label) ?? 0;
  }
  const typeValues: Record<string, number> = {
    Web: typeCounts.get("Web") ?? 0,
    Mobile: typeCounts.get("Mobile") ?? 0,
    API: typeCounts.get("API") ?? 0,
  };
  const severityValues: Record<string, number> = {
    Critical: report.severityBreakdown.critical,
    High: report.severityBreakdown.high,
    Medium: report.severityBreakdown.medium,
    Low: report.severityBreakdown.low,
    Info: report.severityBreakdown.info,
  };
  const appByName = new Map(report.applications.map((a) => [normalizeAppName(a.displayName), a]));
  const cumulativeByMonth = new Map(report.cumulativeFindings.map((point) => [normalize(point.label), point]));
  const monthlyScanByMonth = new Map(report.cumulativeFindings.map((point) => [normalize(point.label), point]));
  const parseMonthCategory = (category: string): string | null => {
    const normalized = normalize(category);
    const exact = cumulativeByMonth.get(normalized);
    if (exact) return exact.month;
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const monthIndex = months.findIndex((month) => normalized.includes(month));
    const yearMatch = normalized.match(/\b(20\d{2})\b/);
    if (monthIndex >= 0 && yearMatch) return `${yearMatch[1]}-${String(monthIndex + 1).padStart(2, "0")}`;
    const isoDate = new Date(category);
    if (!Number.isNaN(isoDate.getTime())) return `${isoDate.getUTCFullYear()}-${String(isoDate.getUTCMonth() + 1).padStart(2, "0")}`;
    return null;
  };

  out = out.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    const categories = [...ser.matchAll(/<c:cat><c:strRef><c:f>[^<]+<\/c:f><c:strCache><c:ptCount val="\d+"\/>([\s\S]*?)<\/c:strCache><\/c:strRef><\/c:cat>/g)]
      .flatMap((m) => [...m[1].matchAll(/<c:v>([^<]+)<\/c:v>/g)].map((n) => decodeXmlText(n[1])));
    const seriesTitle = ([...ser.matchAll(/<c:tx><c:strRef><c:f>[^<]+<\/c:f><c:strCache><c:ptCount val="\d+"\/><c:pt idx="0"><c:v>([^<]+)<\/c:v>/g)][0]?.[1] ?? "");
    const lookupFor = (cat: string) => {
      if (cat in statusValues) return statusValues[cat];
      if (cat in typeValues) return typeValues[cat];
      if (cat in severityValues) return severityValues[cat];
      const monthKey = parseMonthCategory(cat);
      if (monthKey) {
        const point = report.cumulativeFindings.find((p) => p.month === monthKey) ?? monthlyScanByMonth.get(normalize(cat));
        if (point) {
          if (/cumulative/i.test(seriesTitle)) return point.cumulativeFindings;
          if (/apps\s+received/i.test(seriesTitle)) return point.applications;
          if (/produced|new.*findings/i.test(seriesTitle)) return point.findingsThisMonth;
          return point.findingsThisMonth;
        }
      }
      const app = appByName.get(normalizeAppName(cat));
      if (!app) return null;
      if (/closed|fixed/i.test(seriesTitle)) return app.counts.fixed;
      if (/open|pending/i.test(seriesTitle)) return app.counts.pending;
      return app.counts.total;
    };
    return ser.replace(/<c:val>[\s\S]*?<\/c:val>/g, (valBlock) =>
      valBlock.replace(/<c:pt idx="(\d+)"><c:v>([^<]+)<\/c:v><\/c:pt>/g, (match, idxRaw) => {
        const idx = Number(idxRaw);
        const cat = categories[idx];
        const value = cat ? lookupFor(cat) : null;
        if (value === null || value === undefined) return match;
        return `<c:pt idx="${idx}"><c:v>${value}</c:v></c:pt>`;
      }),
    );
  });
  return out;
}

function normalizeTocVerticalSpacing(xml: string): string {
  const nodes = extractTextNodes(xml);
  const titleNames = new Set([
    "executive summary",
    "application register",
    "application status dashboard",
    "severity overview",
    "findings by application",
    "internal vs external",
    "scan timeline",
    "remediation status",
    "cumulative findings",
    "key insights",
    "future work",
  ]);
  const entries: Array<{ title: TextNode; page: TextNode | null }> = [];
  for (let i = 0; i < nodes.length; i++) {
    const titleValue = normalize(nodes[i]!.value);
    if (!titleNames.has(titleValue)) continue;
    const page = nodes.slice(i + 1, i + 4).find((n) => /^\d+$/.test(n.value.trim())) ?? null;
    entries.push({ title: nodes[i]!, page });
  }
  if (!entries.length) return xml;
  const firstOff = shapeOffsetForNode(xml, entries[0]!.title);
  if (!firstOff) return xml;
  let next = xml;
  entries.forEach((entry, idx) => {
    const y = firstOff.y + idx * Math.round(0.52 * 914400);
    next = setNodeShapeY(next, entry.title, y);
    if (entry.page) next = setNodeShapeY(next, entry.page, y);
  });
  return next;
}

function applyTocScope(xml: string): string {
  const originalNodes = extractTextNodes(xml);
  const securityNode = originalNodes.find((n) => normalize(n.value) === "security activity");
  const securityOff = securityNode ? shapeOffsetForNode(xml, securityNode) : null;
  const securityY = securityOff?.y;
  const nodes = originalNodes;
  const changes = new Map<number, string>();
  for (let i = 0; i < nodes.length; i++) {
    const value = normalize(nodes[i]!.value);
    if (["security activity", "sophos policies", "m365"].includes(value)) {
      changes.set(i, "");
      for (let j = i + 1; j < Math.min(nodes.length, i + 3); j++) {
        if (/^\d+$/.test(nodes[j]!.value.trim())) changes.set(j, "");
      }
    }
    if (value === "future work") {
      for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
        if (/^\d+$/.test(nodes[j]!.value.trim())) {
          changes.set(j, "13");
          break;
        }
      }
    }
  }
  let next = replaceTextNodes(xml, changes);

  // Move Future Work into the first now-empty row (Security Activity's y),
  // so spacing remains on the original uniform rhythm and no text overlaps.
  // Move Future Work one normal 0.52" step below Key Insights (6.050"),
  // matching the spacing of the other TOC entries.
  if (securityY) {
    const newY = 6.05 * 914400 + 0.52 * 914400;
    next = setTextShapeY(next, "FUTURE WORK", Math.round(newY));
    const nextNodes = extractTextNodes(next);
    const futureIndex = nextNodes.findIndex((n) => normalize(n.value) === "future work");
    if (futureIndex >= 0) {
      const pageNode = nextNodes.slice(futureIndex + 1).find((n) => /^\d+$/.test(n.value.trim()));
      if (pageNode) next = setNodeShapeY(next, pageNode, Math.round(newY));
    }
  }
  next = applyReferenceTocRunStyle(next, "FUTURE WORK", "EXECUTIVE SUMMARY");
  next = applyReferenceTocRunStyle(next, "13", "03");
  next = normalizeTocVerticalSpacing(next);
  return next;
}

export async function buildTemplateValueUpdate(report: DashboardReport, templateBuffer: Buffer, engagementStatusCounts?: Map<string, number>, engagementStatusByAppId?: Map<number, string>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  const metrics = metricValuesFor(report);
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();

  const tocSlides = new Set<string>();
  for (const file of slideFiles) {
    const f = zip.file(file);
    if (f && /table of contents/i.test(await f.async("string"))) tocSlides.add(file);
  }
  for (const file of slideFiles) {
    if (tocSlides.has(file)) {
      const xmlFile = zip.file(file);
      if (xmlFile) {
        const xml = await xmlFile.async("string");
        zip.file(file, applyTocScope(xml));
      }
      continue;
    }
    const xmlFile = zip.file(file);
    if (!xmlFile) continue;
    const xml = await xmlFile.async("string");
    const next = replaceTables(replaceKpiText(replaceDates(xml, report), metrics), report, engagementStatusByAppId);
    zip.file(file, next);
  }
  for (const file of Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))) {
    const chartFile = zip.file(file);
    if (!chartFile) continue;
    const xml = await chartFile.async("string");
    zip.file(file, replaceChartValues(xml, report, engagementStatusCounts));
  }

  // Keep the deck through the first "Future Work" section. Slides after that
  // are removed from presentation order entirely, while every layout, master,
  // logo and text shape on retained slides remains untouched.
  const presentationFile = zip.file("ppt/presentation.xml");
  const relFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentationFile && relFile) {
    const presentationXml = await presentationFile.async("string");
    const relsText = (await relFile.async("string")) ?? "";
    const relMap = new Map<string, string>();
    for (const m of relsText.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
    const slideRefs = [...presentationXml.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/g)].map((m) => ({
      id: m[1]!,
      target: (relMap.get(m[1]!) ?? "").replace(/^\/ppt\//, "ppt/").replace(/^slides\//, "ppt/slides/"),
    }));
    const targetTexts = new Map<string, string>();
    for (const target of slideRefs.map((r) => r.target)) {
      const f = zip.file(target);
      if (f) targetTexts.set(target, extractTextNodes(await f.async("string")).map((t) => t.value).join(" "));
    }
    let cutoff = slideRefs.length - 1;
    for (let i = 0; i < slideRefs.length; i++) {
      if (tocSlides.has(slideRefs[i]!.target)) continue;
      const text = targetTexts.get(slideRefs[i]!.target) ?? "";
      if (/(^|\s)(future work|future works)(\s|$)/i.test(text)) {
        cutoff = i;
        break;
      }
    }
    const keep = new Set(slideRefs.slice(0, cutoff + 1).map((r) => r.id));
    const removedSlides = slideRefs.slice(cutoff + 1);
    const nextPresentationXml = presentationXml.replace(/<p:sldId[^>]*r:id="([^"]+)"[^>]*\/>/g, (match, id) => (keep.has(id) ? match : ""));
    zip.file("ppt/presentation.xml", nextPresentationXml);

    // Cleanly remove the now-unreferenced slide parts instead of leaving
    // orphan slide XML in the package.
    for (const removedSlide of removedSlides) {
      zip.remove(removedSlide.target);
      const relName = `ppt/slides/_rels/${removedSlide.target.split("/").pop()}.rels`;
      zip.remove(relName);
    }
    let nextRels = relsText;
    for (const removedSlide of removedSlides) {
      nextRels = nextRels.replace(new RegExp(`<Relationship[^>]*Id="${removedSlide.id}"[^>]*Target="[^"]+"[^>]*/>`), "");
    }
    zip.file("ppt/_rels/presentation.xml.rels", nextRels);
    const contentTypesFile = zip.file("[Content_Types].xml");
    if (contentTypesFile) {
      let contentTypes = await contentTypesFile.async("string");
      for (const removedSlide of removedSlides) {
        const partName = `/${removedSlide.target}`;
        contentTypes = contentTypes.replace(new RegExp(`<Override PartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`), "");
      }
      zip.file("[Content_Types].xml", contentTypes);
    }
  }

  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/**
 * Phase 9.1 tests — application PDF reports (upload/list/download/delete with
 * verbatim storage + sha256 + magic-byte guards) and per-iteration summaries
 * with Excel-identical Open/Closed rollup semantics.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";

const q = async (domain: string, value: string) => (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } })).id;

async function makeApp(name: string): Promise<{ id: number }> {
  return testDb.application.create({
    data: {
      name,
      displayName: name,
      applicationType: await q("application_type", "web"),
      scope: await q("scope", "internal"),
      environment: await q("environment", "prod"),
      site: await q("application_status", "active"),
    },
  });
}

function fakePdf(bytes = 256): Buffer {
  // Genuine PDF magic bytes + filler (enough for the sniffing check).
  const body = Buffer.alloc(bytes, 0x41);
  return Buffer.concat([Buffer.from("%PDF-1.4\u000a"), body]);
}

describe.skipIf(!dbAvailable)("Application PDF reports (upload verbatim + guards)", () => {
  let userId = 0;
  let appId = 0;
  let i1id = 0;
  let tmpRoot = "";

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await makeApp("PDF Probe App");
    appId = app.id;
    const engSvc = await import("@/lib/services/engagement-service");
    const eng = await engSvc.createEngagement(
      { applicationId: appId, name: "PDF Probe VAPT", scopeValue: "internal", assessmentSourceValue: "vapt", statusValue: "in_progress" },
      userId,
      {},
    );
    i1id = (await engSvc.createIteration({ engagementId: eng.id, iterationTypeValue: "initial_scan" }, userId, {})).id;
    // Isolated storage directory for the test run.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tm-pdf-"));
    process.env.REPORT_STORAGE_ROOT = tmpRoot;
  }, 60_000);

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.REPORT_STORAGE_ROOT;
  });

  it("upload → original bytes stored verbatim, sha256 + DTO correct", async () => {
    const svc = await import("@/lib/services/reporting/pdf-report-service");
    const content = fakePdf(512);
    const dto = await svc.uploadApplicationReport({
      applicationId: appId,
      iterationId: i1id,
      filename: "Iteration-1 Report (vendor X).pdf",
      content,
      userId,
      ctx: {},
    });
    expect(dto.fileName).toBe("Iteration-1 Report (vendor X).pdf");
    expect(dto.mimeType).toBe("application/pdf");
    expect(dto.byteSize).toBe(content.length);
    expect(dto.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(dto.iterationNumber).toBe(1);

    const root = svc.reportsRoot();
    const stored = await listFiles(root);
    const raw = fs.readFileSync(path.join(root, stored.find((f) => f.endsWith(".pdf"))!));
    expect(raw.equals(content)).toBe(true); // VERBATIM original bytes
  });

  it("mime/name never trusted: non-PDF content rejected (magic bytes)", async () => {
    const svc = await import("@/lib/services/reporting/pdf-report-service");
    await expect(
      svc.uploadApplicationReport({ applicationId: appId, filename: "report.pdf", content: Buffer.from("plain text, not a pdf"), userId, ctx: {} }),
    ).rejects.toThrow(/genuine PDF/);
  });

  it("empty upload rejected; iteration must belong to the application", async () => {
    const svc = await import("@/lib/services/reporting/pdf-report-service");
    await expect(svc.uploadApplicationReport({ applicationId: appId, filename: "a.pdf", content: Buffer.alloc(0), userId, ctx: {} })).rejects.toThrow(/empty/);
    await expect(
      svc.uploadApplicationReport({ applicationId: appId, iterationId: 981723, filename: "a.pdf", content: fakePdf(), userId, ctx: {} }),
    ).rejects.toThrow(/belong to this application/);
    await expect(
      svc.uploadApplicationReport({ applicationId: 999999, filename: "a.pdf", content: fakePdf(), userId, ctx: {} }),
    ).rejects.toThrow(/Application/);
  });

  it("download returns the EXACT original bytes + is audited; list is clean of storage paths", async () => {
    const svc = await import("@/lib/services/reporting/pdf-report-service");
    const listed = await svc.listApplicationReports(appId);
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(listed)).not.toMatch(/storage[\\/]/i); // internal paths never leak

    const bytes = await svc.readApplicationReportBytes(listed[0]!.id, { userId, ctx: {} });
    expect(bytes.mimeType).toBe("application/pdf");
    expect(createHash("sha256").update(bytes.buffer).digest("hex")).toBe(listed[0]!.sha256);

    const audits = await testDb.auditLog.findMany({ where: { action: "app_report.downloaded" } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("delete is superuser-only; file + row are removed, audit trail kept", async () => {
    const svc = await import("@/lib/services/reporting/pdf-report-service");
    const dto = await svc.uploadApplicationReport({ applicationId: appId, filename: "tobedeleted.pdf", content: fakePdf(77), userId, ctx: {} });
    const root = svc.reportsRoot();
    const files = await listFiles(root);
    expect(files.some((f) => f.includes("tobedeleted.pdf"))).toBe(true);

    // non-superuser attempt rejected
    const other = await testDb.user.create({ data: { email: "viewer@t.test", passwordHash: "x".repeat(20), displayName: "Viewer", isSuperuser: false } });
    await expect(svc.deleteApplicationReport(dto.id, { userId: other.id, isSuperuser: false, ctx: {} })).rejects.toThrow(/superuser/);

    await svc.deleteApplicationReport(dto.id, { userId, isSuperuser: true, ctx: {} });
    const gone = await testDb.applicationReport.findUnique({ where: { id: dto.id } });
    expect(gone).toBeNull();
    const filesAfter = await listFiles(root);
    expect(filesAfter.some((f) => f.includes("tobedeleted.pdf"))).toBe(false);
    const audits = await testDb.auditLog.findMany({ where: { action: "app_report.deleted" } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(!dbAvailable)("Per-iteration summaries (Excel Open/Closed semantics)", () => {
  let userId = 0;
  let appId = 0;
  let i1 = 0;
  let i2 = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await makeApp("Summary Probe App");
    appId = app.id;
    const engSvc = await import("@/lib/services/engagement-service");
    const eng = await engSvc.createEngagement(
      { applicationId: appId, name: "Summary Probe VAPT", scopeValue: "internal", assessmentSourceValue: "vapt", statusValue: "in_progress" },
      userId,
      {},
    );
    i1 = (await engSvc.createIteration({ engagementId: eng.id, iterationTypeValue: "initial_scan" }, userId, {})).id;
    i2 = (await engSvc.createIteration({ engagementId: eng.id, iterationTypeValue: "retest" }, userId, {})).id;

    const fSvc = await import("@/lib/services/finding-service");
    const a = await fSvc.createFinding({ applicationId: appId, title: "Critical XSS", severityValue: "critical" }, userId, {});
    await fSvc.setFindingIterationState({ findingId: a.id, iterationId: i1, severityValue: "critical", statusValue: "open" }, userId, {});
    await fSvc.setFindingIterationState({ findingId: a.id, iterationId: i2, severityValue: "critical", statusValue: "fixed" }, userId, {});
    const b = await fSvc.createFinding({ applicationId: appId, title: "High SSRF", severityValue: "high" }, userId, {});
    await fSvc.setFindingIterationState({ findingId: b.id, iterationId: i1, severityValue: "high", statusValue: "open" }, userId, {});
    await fSvc.setFindingIterationState({ findingId: b.id, iterationId: i2, severityValue: "high", statusValue: "not_fixed" }, userId, {});
    const c = await fSvc.createFinding({ applicationId: appId, title: "Medium IDOR", severityValue: "medium" }, userId, {});
    await fSvc.setFindingIterationState({ findingId: c.id, iterationId: i2, severityValue: "medium", statusValue: "open" }, userId, {});
  }, 60_000);

  it("I1 and I2 roll up separately with open/closed exactly like the export", async () => {
    const { getApplicationIterationSummaries } = await import("@/lib/services/reporting/iteration-summaries");
    const summary = await getApplicationIterationSummaries(appId);
    expect(summary.application.id).toBe(appId);
    expect(summary.iterations.length).toBe(2);

    const row1 = summary.iterations.find((r) => r.iterationId === i1)!;
    expect(row1.iterationNumber).toBe(1);
    expect(row1.counts).toMatchObject({ total: 2, critical: 1, high: 1, open: 2, closed: 0 });

    const row2 = summary.iterations.find((r) => r.iterationId === i2)!;
    expect(row2.counts).toMatchObject({ total: 3, critical: 1, high: 1, medium: 1, fixed: 1, notFixed: 1, open: 1, closed: 2 });

    // statuses/types carried through
    expect(row1.typeLabel.length).toBeGreaterThan(0);
    expect(row2.statusLabel.length).toBeGreaterThan(0);
  });

  it("unknown application → NotFound (no fabricated blank report)", async () => {
    const { getApplicationIterationSummaries } = await import("@/lib/services/reporting/iteration-summaries");
    await expect(getApplicationIterationSummaries(9999991)).rejects.toThrow(/Application/);
  });
});

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

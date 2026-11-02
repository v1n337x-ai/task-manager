/**
 * Phase 9.1 pipeline-completion tests (user-requested "work on it"):
 * 1) Excel finding-list import (vapt.xlsx shape) → REAL tracker findings with
 *    per-iteration states; duplicates skipped truthfully.
 * 2) Human-approved AI finding candidates apply to the tracker (AI never
 *    touches data alone — the approval IS the write gate).
 */
import ExcelJS from "exceljs";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { parseFindingListWorkbook } from "@/lib/excel/finding-list-parser";

async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet2");
  ws.addRow(["#", "Name of the vulnerability", "Severity", "Iteration 2 Status"]);
  ws.addRow([1, "Parameter Tampering leads to IDOR", "Critical", ""]);
  ws.addRow([2, "Testing for OTP flooding", "Critical", ""]);
  ws.addRow([3, "Missing Security Headers", "High", "Not Fixed"]);
  ws.addRow([4, "CORS - Misconfiguration", "Medium", ""]);
  ws.addRow([5, "Web application fingerprinting", "Low", ""]);
  ws.addRow([6, "Who is information disclosure", "Info", ""]);
  ws.addRow([7, "", "", ""]); // blank row skipped
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function q(domain: string, value: string) {
  return testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } }).then((x) => x.id);
}

describe.skipIf(!dbAvailable)("Finding-list import → tracker", () => {
  let userId = 0;
  let appId = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await testDb.application.create({
      data: {
        name: "Import Probe App",
        displayName: "Import Probe App",
        applicationType: await q("application_type", "web"),
        scope: await q("scope", "internal"),
        environment: await q("environment", "prod"),
        site: await q("application_status", "active"),
      },
    });
    appId = app.id;
  }, 60_000);

  it("parser: header detection + severity mapping + blank skip + unknown severity warn", async () => {
    const buf = await buildWorkbook();
    const parsed = await parseFindingListWorkbook(buf);
    expect(parsed.sheetName).toBe("Sheet2");
    expect(parsed.rows.length).toBe(6);
    expect(parsed.rows[0]).toMatchObject({ no: 1, title: "Parameter Tampering leads to IDOR", severity: "critical" });
    expect(parsed.rows[2]!.iteration2Status).toBe("not_fixed");
    expect(parsed.warnings.length).toBe(0);

    // garbage severity row → warning + skip
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet("S");
    ws2.addRow(["#", "Name of the vulnerability", "Severity"]);
    ws2.addRow([1, "Bad severity row", "catastrophic"]);
    ws2.addRow([2, "Good severity row", "High"]);
    const buf2 = Buffer.from(await wb2.xlsx.writeBuffer() as ArrayBuffer);
    const parsed2 = await parseFindingListWorkbook(buf2);
    expect(parsed2.rows.length).toBe(1);
    expect(parsed2.rows[0]!.severity).toBe("high");
    expect(parsed2.warnings.length).toBe(1);
  });

  it("import creates findings + I1 open states (+ I2 for annotated rows)", async () => {
    const svc = await import("@/lib/services/finding-import-service");
    const result = await svc.importFindingList({ applicationId: appId, content: await buildWorkbook(), actorUserId: userId, ctx: {} });
    expect(result.created.length).toBe(6);
    expect(result.skipped.length).toBe(0);
    // I1 states exist for every created finding:
    const states = await testDb.findingIterationState.findMany({ include: { statusRef: true, iteration: true } });
    const i1States = states.filter((s) => s.statusRef.value === "open");
    expect(i1States.length).toBe(6); // ALL six findings have an I1 "open" state (incl. the I2-annotated one)
    // the "Not Fixed" row got an I2 state:
    const notFixed = states.filter((s) => s.statusRef.value === "not_fixed");
    expect(notFixed.length).toBe(1);
    // DB findings count matches:
    expect(await testDb.finding.count({ where: { applicationId: appId } })).toBe(6);
  });

  it("re-import: rows skip truthfully as duplicates (no duplicates created)", async () => {
    const svc = await import("@/lib/services/finding-import-service");
    const result = await svc.importFindingList({ applicationId: appId, content: await buildWorkbook(), actorUserId: userId, ctx: {} });
    expect(result.created.length).toBe(0);
    expect(result.skipped.length).toBe(6);
    expect(result.skipped.every((s) => /duplicate/i.test(s.reason))).toBe(true);
    expect(await testDb.finding.count({ where: { applicationId: appId } })).toBe(6);
  });
});

describe.skipIf(!dbAvailable)("AI approval applies the candidate to the tracker (human-gated)", () => {
  let userId = 0;
  let appId = 0;
  let extractionId = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await testDb.application.create({
      data: {
        name: "AI Apply Probe App",
        displayName: "AI Apply Probe App",
        applicationType: await q("application_type", "web"),
        scope: await q("scope", "internal"),
        environment: await q("environment", "prod"),
        site: await q("application_status", "active"),
      },
    });
    appId = app.id;

    const vapt = await q("assessment_source", "vapt");
    const eng = await testDb.engagement.create({ data: { applicationId: appId, name: "AI Apply VAPT", scope: await q("scope", "internal"), assessmentSource: vapt, status: await q("engagement_status", "in_progress") } });
    await testDb.iteration.create({ data: { engagementId: eng.id, number: 1, iterationType: await q("iteration_type", "initial_scan"), name: "I1", status: await q("iteration_status", "completed") } });
    await testDb.iteration.create({ data: { engagementId: eng.id, number: 2, iterationType: await q("iteration_type", "retest"), name: "I2", status: await q("iteration_status", "completed") } });

    const threadRef = await testDb.emailThread.create({ data: { subject: "Probe thread", subjectHash: "probe-thread", participantKey: "p" } });
    const pending = (await q("extraction_status", "pending"));
    const structured = {
      schemaVersion: "AI_EXTRACTION_V1",
      threadSummary: "Probe thread with one finding candidate.",
      participants: [{ email: "t@digialert.test", proposedRole: "pentester", roleBasis: "EXPLICIT", confidence: "HIGH", evidence: [{ messageIndex: 0, excerpt: "authority", confidence: "HIGH" }] }],
      findings: [
        { identifierExplicit: null, identifierMark: "IDENTIFIER_NOT_EXPLICIT", title: "OTP Flooding on Login", titleMark: "AI_PROPOSED", severity: "high", severityMark: "INFERRED", description: null, recommendation: null, relatedTestCaseRefs: [], iterationSignal: 2, iterationSignalExplicit: true, statusSignal: "not_fixed", isNewFindingCandidate: true, evidence: [{ messageIndex: 0, excerpt: "otp flood still", confidence: "HIGH" }] },
      ],
      testCases: [],
      iterationSignals: [],
      evidence: [{ messageIndex: 0, excerpt: "otp flood still", confidence: "HIGH" }],
    };
    const created = await testDb.aiExtraction.create({
      data: { threadId: threadRef.id, applicationId: appId, providerSlug: "mock", schemaVersion: "AI_EXTRACTION_V1", promptVersion: "VAPT_EMAIL_ANALYSIS_V1", inputContextHash: "x", extractionType: "thread_vapt_analysis", status: pending, structuredOutput: structured },
    });
    extractionId = created.id;
    // thread 1 does not exist in this test-db state — created above without linkage
    void appId;
  }, 60_000);

  it("approve(findingStatus:0) creates the finding + I2 not_fixed state, audited", async () => {
    const svc = await import("@/lib/services/ai-foundation-service");
    await svc.recordApprovalDecision({ extractionId, decision: "approve", itemKey: "findingStatus:0" }, userId, {});

    const rows = await testDb.finding.findMany({ where: { applicationId: appId } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("OTP Flooding on Login");
    const states = await testDb.findingIterationState.findMany({ where: { findingId: rows[0]!.id }, include: { statusRef: true, iteration: true } });
    expect(states.length).toBe(1);
    expect(states[0]!.statusRef.value).toBe("not_fixed");
    expect(states[0]!.iteration.number).toBe(2);
    const audits = await testDb.auditLog.findMany({ where: { action: "ai_approval.finding_applied" } });
    expect(audits.length).toBe(1);
  });

  it("second approval of the same item is rejected (unique decision) — no duplicate finding", async () => {
    const svc = await import("@/lib/services/ai-foundation-service");
    await expect(svc.recordApprovalDecision({ extractionId, decision: "approve", itemKey: "findingStatus:0" }, userId, {})).rejects.toThrow(/A decision already exists/);
    expect(await testDb.finding.count({ where: { applicationId: appId } })).toBe(1);
  });

  it("rejection never touches the tracker", async () => {
    const threadRef2 = await testDb.emailThread.create({ data: { subject: "Probe thread 2", subjectHash: "probe-thread-2", participantKey: "p2" } });
    const pending = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "extraction_status", value: "pending" } } })).id;
    const structured2 = {
      schemaVersion: "AI_EXTRACTION_V1", threadSummary: "second probe with a candidate.", participants: [{ email: "t@digialert.test", proposedRole: "pentester", roleBasis: "EXPLICIT", confidence: "HIGH", evidence: [{ messageIndex: 0, excerpt: "e", confidence: "HIGH" }] }],
      findings: [{ identifierExplicit: null, identifierMark: "IDENTIFIER_NOT_EXPLICIT", title: "Should NOT appear", titleMark: "AI_PROPOSED", severity: "high", severityMark: "INFERRED", description: null, recommendation: null, relatedTestCaseRefs: [], iterationSignal: 1, iterationSignalExplicit: true, statusSignal: "open", evidence: [{ messageIndex: 0, excerpt: "e", confidence: "HIGH" }] }],
      testCases: [], iterationSignals: [], evidence: [{ messageIndex: 0, excerpt: "e", confidence: "HIGH" }],
    };
    const e2 = await testDb.aiExtraction.create({ data: { threadId: threadRef2.id, applicationId: appId, providerSlug: "mock", schemaVersion: "AI_EXTRACTION_V1", promptVersion: "VAPT_EMAIL_ANALYSIS_V1", inputContextHash: "y", extractionType: "thread_vapt_analysis", status: pending, structuredOutput: structured2 } });
    const svc = await import("@/lib/services/ai-foundation-service");
    await svc.recordApprovalDecision({ extractionId: e2.id, decision: "reject", itemKey: "findingStatus:0" }, userId, {});
    const titles = (await testDb.finding.findMany({ where: { applicationId: appId } })).map((f) => f.title);
    expect(titles).not.toContain("Should NOT appear");
  });
});

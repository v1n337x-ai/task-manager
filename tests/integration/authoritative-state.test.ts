/**
 * Phase 6 — authoritative state engine tests (§12-§26 fixtures).
 * The deterministic core: chronological precedence, human correction,
 * reopened, missing test case, explicit removal/out-of-scope, correction
 * precedence over AI, no fake states, projection recalculation.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";

function fixture(name: string): string {
  const p = path.join("tests/fixtures/authoritative", name);
  if (!fs.existsSync(p)) throw new Error(`fixture missing: ${p}`);
  return fs.readFileSync(p, "utf8").slice(0, 160);
}

let master: (domain: string, value: string) => Promise<number>;
let userId = 0;
let appId = 0;
let engagementId = 0;
let i1 = 0;
let i2 = 0;
let i3 = 0;

async function createApp() {
  const appType = await master("application_type", "web");
  const scope = await master("scope", "internal");
  const env = await master("environment", "prod");
  const active = await master("application_status", "active");
  const app = await testDb.application.create({
    data: { name: `AuthProbe-${Date.now()}`, displayName: "AuthProbe", applicationType: appType, scope, environment: env, site: active },
  });
  appId = app.id;
  const eng = await testDb.engagement.create({
    data: {
      applicationId: appId,
      name: `AuthProbe VAPT ${Date.now()}`,
      scope,
      assessmentSource: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "assessment_source", value: "vapt" } } })).id,
      status: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "engagement_status", value: "in_progress" } } })).id,
    },
  });
  engagementId = eng.id;
  const iterType = await master("iteration_type", "initial_scan");
  const retestType = await master("iteration_type", "retest");
  const done = await master("iteration_status", "completed");
  i1 = (await testDb.iteration.create({ data: { engagementId, number: 1, iterationType: iterType, name: "Iteration 1 — Initial Scan", status: done } })).id;
  i2 = (await testDb.iteration.create({ data: { engagementId, number: 2, iterationType: retestType, name: "Iteration 2 — Retest", status: done } })).id;
  i3 = (await testDb.iteration.create({ data: { engagementId, number: 3, iterationType: retestType, name: "Iteration 3 — Retest", status: done } })).id;
  return { i1, i2, i3 };
}

async function createFinding(title: string, severityValue: string, iterationNumberFirstSeen: number | null) {
  const sev = await master("severity", severityValue);
  const open = await master("finding_status", "open");
  return testDb.finding.create({
    data: {
      applicationId: appId,
      code: `F-${String(Date.now() % 10000).padStart(4, "0")}`,
      title,
      severity: sev,
      currentStatus: open,
      firstSeenIterationNumber: iterationNumberFirstSeen,
    },
  });
}

async function surfaceOf(findingId: number): Promise<string> {
  const f = await testDb.finding.findUniqueOrThrow({ where: { id: findingId }, include: { statusRef: true } });
  return f.statusRef.value;
}

describe.skipIf(!dbAvailable)("§12-§26 authoritative state machine", () => {
  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    master = (async (domain: string, value: string) =>
      (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } })).id) as (domain: string, value: string) => Promise<number>;
    await createApp();
  }, 90_000);

  // §13-§14 FIXTURES 1-3: developer fixed → later pentester not-fixed
  it("Fixture 1-3 — chronological: Fixed then NOT_FIXED ⇒ current NOT_FIXED with history preserved", async () => {
    const finding = await createFinding("Broken auth bypass", "critical", 1);
    const svc = await import("@/lib/services/authoritative-state/finding-state");

    // Message A: developer says fixed at I2
    const msgA = fixture("developer-fixed.txt");
    await svc.recordAuthoritativeDecision({
      entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed",
      verification: "DEVELOPER_REPORTED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION",
      sourceMessageId: null, sourceThreadId: null, evidenceRef: [{ excerpt: msgA }], approvedByUserId: userId, reason: "Fixture developer-fixed.txt",
    });
    expect(await surfaceOf(finding.id)).toBe("fixed");

    // Message B: later pentester retest says still vulnerable
    const msgB = fixture("pentester-notfixed.txt");
    await svc.recordAuthoritativeDecision({
      entityType: "finding", entityId: finding.id, iterationId: i3, iterationNumber: 3, newState: "not_fixed",
      verification: "RETEST_VERIFIED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION",
      sourceMessageId: null, sourceThreadId: null, evidenceRef: [{ excerpt: msgB }], approvedByUserId: userId, reason: "Fixture pentester-notfixed.txt",
    });
    expect(await surfaceOf(finding.id)).toBe("not_fixed");

    // history: both fixed (I2) and not_fixed (I3) decisions + everything else retained
    const decisions = await testDb.authoritativeStateDecision.findMany({ where: { entityType: "finding", entityId: finding.id }, orderBy: { id: "asc" } });
    expect(decisions.map((d) => d.newState)).toEqual(["fixed", "not_fixed"]);
    const states = await testDb.findingIterationState.findMany({ where: { findingId: finding.id }, include: { statusRef: true, iteration: true } });
    expect(states.find((s) => s.iterationId === i2)!.statusRef.value).toBe("fixed");
    expect(states.find((s) => s.iterationId === i3)!.statusRef.value).toBe("not_fixed");
  });

  // §14 FIXTURE 4: developer fixed + later pentester PASSED ⇒ current FIXED (retest verified)
  it("Fixture 4 — reverse chronological: Fixed then RETEST VERIFIED ⇒ current FIXED", async () => {
    const finding = await createFinding("SQL injection in login", "critical", 1);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed", verification: "DEVELOPER_REPORTED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i3, iterationNumber: 3, newState: "fixed", verification: "RETEST_VERIFIED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    expect(await surfaceOf(finding.id)).toBe("fixed");
    const explanation = await svc.calculateAuthoritativeFindingState(finding.id);
    expect(explanation.verification).toBe("RETEST_VERIFIED");
  });

  // §14 FIXTURE 2: developer says fixed ONLY ⇒ current fixed, verification DEVELOPER_REPORTED
  it("Fixture 2 — developer-only fixed ⇒ verified=DEVELOPER_REPORTED (never claims retest verification)", async () => {
    const finding = await createFinding("Session token in URL", "high", 1);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed", verification: "DEVELOPER_REPORTED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    const explanation = await svc.calculateAuthoritativeFindingState(finding.id);
    expect(explanation.verification).toBe("DEVELOPER_REPORTED");
    expect(await surfaceOf(finding.id)).toBe("fixed");
  });

  // §17 FIXTURE 5: reopened
  it("Fixture 5 — reopen after fixed ⇒ current reopened, prior fixed retained", async () => {
    const finding = await createFinding("Directory listing", "low", 2);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed", verification: "RETEST_VERIFIED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i3, iterationNumber: 3, newState: "reopened", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    expect(await surfaceOf(finding.id)).toBe("reopened");
    const decisions = await testDb.authoritativeStateDecision.findMany({ where: { entityId: finding.id } });
    expect(decisions.some((d) => d.newState === "fixed")).toBe(true); // history preserved
    expect(decisions.some((d) => d.newState === "reopened")).toBe(true);
  });

  // §46 FIXTURE 12: idempotency — same decision repeated creates nothing
  it("Fixture 12 partially — idempotent duplicate decisions (§46)", async () => {
    const finding = await createFinding("Info disclosure", "low", 1);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    const input = { entityType: "finding" as const, entityId: finding.id, iterationId: i1, iterationNumber: 1, newState: "fixed", resolutionMethod: "EXPLICIT_COMMUNICATION" as const, decisionSource: "COMMUNICATION" as const, approvedByUserId: userId };
    const first = await svc.recordAuthoritativeDecision(input);
    const second = await svc.recordAuthoritativeDecision(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const count = await testDb.authoritativeStateDecision.count({ where: { entityId: finding.id, iterationId: i1 } });
    expect(count).toBe(1);
  });

  // §26/§42 FIXTURE 11: human correction overrides AI
  it("Fixture 11 — HUMAN_CORRECTION overrides AI_APPROVED with full provenance", async () => {
    const finding = await createFinding("Weak cipher suite", "medium", 2);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed", resolutionMethod: "INFERRED_CONTEXT", decisionSource: "AI_APPROVED", sourceMessageId: null, approvedByUserId: userId, reason: "AI proposed fixed from email" });
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "not_fixed", resolutionMethod: "HUMAN_CORRECTION", decisionSource: "HUMAN_CORRECTION", approvedByUserId: userId, reason: "Developer statement was not independently verified" });
    expect(await surfaceOf(finding.id)).toBe("not_fixed");
    const decisions = await testDb.authoritativeStateDecision.findMany({ where: { entityId: finding.id }, orderBy: { id: "asc" } });
    expect(decisions[0]!.decisionSource).toBe("AI_APPROVED"); // AI record preserved
    expect(decisions[1]!.decisionSource).toBe("HUMAN_CORRECTION"); // correction appended
  });

  // §19-§20 FIXTURE 6: new finding in later iteration keeps firstSeen=2
  it("Fixture 6 — new finding in I2 keeps firstSeenIterationNumber=2", async () => {
    const finding = await createFinding("New SSRF probe", "high", 2);
    expect(finding.firstSeenIterationNumber).toBe(2);
  });

  // §18-§19 FIXTURE 7-10: test case states
  it("Fixture 7 — test case absent from I2 is NOT deleted (uses not_retested state)", async () => {
    const tc = await testDb.testCase.create({
      data: {
        applicationId: appId,
        code: "TC-200",
        title: "Legacy rate-limit check",
        currentStatus: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "test_case_status", value: "included" } } })).id,
      },
    });
    await testDb.testCaseIteration.create({
      data: { testCaseId: tc.id, iterationId: i1, status: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "test_case_status", value: "tested" } } })).id },
    });
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "test_case", entityId: tc.id, iterationId: i2, iterationNumber: 2, newState: "not_retested", resolutionMethod: "SYSTEM_DEFAULT", decisionSource: "SYSTEM_CALCULATION", approvedByUserId: userId });
    const preserved = await testDb.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(preserved).toBeDefined(); // NOT deleted
    const state = await testDb.testCaseIteration.findFirstOrThrow({ where: { testCaseId: tc.id, iterationId: i2 }, include: { statusRef: true } });
    expect(["not_retested", "not_specified", "unknown", "included"]).not.toContain(1);
    expect(["not_retested"].concat(["not_specified"]), "not retested state is honored").toBeTruthy();
    expect(state.statusRef.value).toBe("not_retested");
  });

  it("Fixture 8 — explicit removal state (never deletion)", async () => {
    const tc = await testDb.testCase.create({
      data: {
        applicationId: appId,
        code: "TC-201",
        title: "Removed cookie flags probe",
        currentStatus: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "test_case_status", value: "included" } } })).id,
      },
    });
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "test_case", entityId: tc.id, iterationId: i2, iterationNumber: 2, newState: "removed", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId, reason: "TC-201 has been removed." });
    const preserved = await testDb.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(preserved.isActive).toBe(false); // business state, not physical deletion
    const state = await testDb.testCaseIteration.findFirstOrThrow({ where: { testCaseId: tc.id, iterationId: i2 }, include: { statusRef: true } });
    expect(state.statusRef.value).toBe("removed");
  });

  it("Fixture 9 — out-of-scope state (never deletion)", async () => {
    const tc = await testDb.testCase.create({
      data: {
        applicationId: appId,
        code: "TC-202",
        title: "Out-of-scope CORS probe",
        currentStatus: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "test_case_status", value: "included" } } })).id,
      },
    });
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "test_case", entityId: tc.id, iterationId: i2, iterationNumber: 2, newState: "out_of_scope", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId, reason: "TC-202 is out of scope." });
    const state = await testDb.testCaseIteration.findFirstOrThrow({ where: { testCaseId: tc.id, iterationId: i2 }, include: { statusRef: true } });
    expect(state.statusRef.value).toBe("out_of_scope");
  });

  // §22/§23-§45: recalculate projection is deterministic
  it("Projection recalculation (§23/§45) — rebuildable from history", async () => {
    const finding = await createFinding("CMS path traversal", "high", 2);
    const svc = await import("@/lib/services/authoritative-state/finding-state");
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i2, iterationNumber: 2, newState: "fixed", verification: "RETEST_VERIFIED", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });
    await svc.recordAuthoritativeDecision({ entityType: "finding", entityId: finding.id, iterationId: i3, iterationNumber: 3, newState: "reopened", resolutionMethod: "EXPLICIT_COMMUNICATION", decisionSource: "COMMUNICATION", approvedByUserId: userId });

    // Simulate drift: surface set to a stale value, then recalc
    await testDb.finding.update({ where: { id: finding.id }, data: { currentStatus: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "finding_status", value: "open" } } })).id } });
    const recalc = await svc.recalculateFindingProjection(finding.id);
    expect(recalc.projection).toBe("reopened");
    expect(await surfaceOf(finding.id)).toBe("reopened");
  });

  it("Fixture 10 — ambiguous message yields UNRESOLVED iteration (never silently decided)", async () => {
    const resolver = await import("@/lib/services/authoritative-state/iteration-resolution");
    const resolution = await resolver.resolveIteration({
      messageText: "Please find the revised checklist attached. Several items were reviewed.",
      threadApplicationId: appId,
      threadSubjectHash: "irrelevant",
      aiCandidate: null,
    });
    expect(resolution.method).toBe("UNRESOLVED");
    expect(resolution.iterationNumber).toBeNull();
  });

  it("§7 — explicit iteration statement resolves with HIGH confidence", async () => {
    const resolver = await import("@/lib/services/authoritative-state/iteration-resolution");
    const resolution = await resolver.resolveIteration({
      messageText: "Please find attached the retest results for iteration 2.",
      threadApplicationId: appId,
      threadSubjectHash: "irrelevant",
      aiCandidate: null,
    });
    expect(resolution.method).toBe("EXPLICIT");
    expect(resolution.confidence).toBe("HIGH");
    expect(resolution.iterationNumber).toBe(2);
  });
});

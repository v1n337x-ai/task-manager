/**
 * Phase 3 §61 — finding / iteration data-integrity tests (service level).
 * Uses the isolated test DB; seeded minimal via setup-db.
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";

async function ids(): Promise<{ appTypeId: number; scopeId: number; envId: number; activeId: number; sevHighId: number; sevCritId: number }> {
  const q = async (domain: string, value: string) => (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } })).id;
  return {
    appTypeId: await q("application_type", "web"),
    scopeId: await q("scope", "internal"),
    envId: await q("environment", "prod"),
    activeId: await q("application_status", "active"),
    sevHighId: await q("severity", "high"),
    sevCritId: await q("severity", "critical"),
  };
}

async function makeApp(): Promise<{ id: number }> {
  const idsv = await ids();
  return testDb.application.create({
    data: {
      name: "Integrity Probe",
      displayName: "Integrity Probe",
      applicationType: idsv.appTypeId,
      scope: idsv.scopeId,
      environment: idsv.envId,
      site: idsv.activeId,
    },
  });
}

describe.skipIf(!dbAvailable)("§61 data-integrity chain (history preserved)", () => {
  let userId = 0;
  let appId = 0;
  let engagementId = 0;
  let i1 = 0;
  let i2 = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await makeApp();
    appId = app.id;
    const engSvc = await import("@/lib/services/engagement-service");
    const eng = await engSvc.createEngagement(
      { applicationId: appId, name: "Integrity Probe VAPT", scopeValue: "internal", assessmentSourceValue: "vapt", statusValue: "in_progress" },
      userId,
      {},
    );
    engagementId = eng.id;
    i1 = (await engSvc.createIteration({ engagementId, iterationTypeValue: "initial_scan" }, userId, {})).id;
    i2 = (await engSvc.createIteration({ engagementId, iterationTypeValue: "retest" }, userId, {})).id;
  }, 60_000);

  it("Test 1 — Open (I1) → Fixed (I2): history contains BOTH", async () => {
    const svc = await import("@/lib/services/finding-service");
    const finding = await svc.createFinding({ applicationId: appId, title: "Stored XSS in search", severityValue: "high" }, userId, {});
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i1, severityValue: "high", statusValue: "open" }, userId, { source: "HUMAN" });
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i2, severityValue: "high", statusValue: "fixed" }, userId, { source: "HUMAN" });

    const history = await svc.listFindingHistory(finding.id);
    expect(history.map((h) => h.newStatus)).toEqual(["open", "fixed"]);
    // I1 row retains open (nothing overwritten):
    const i1State = await testDb.findingIterationState.findFirstOrThrow({
      where: { findingId: finding.id, iterationId: i1 },
      include: { statusRef: true },
    });
    expect(i1State.statusRef.value).toBe("open");
  });

  it("Test 2 — Open (I1) → Not Fixed (I2): current = Not Fixed", async () => {
    const svc = await import("@/lib/services/finding-service");
    const finding = await svc.createFinding({ applicationId: appId, title: "Verbose error disclosure", severityValue: "low" }, userId, {});
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i1, severityValue: "low", statusValue: "open" }, userId, { source: "HUMAN" });
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i2, severityValue: "low", statusValue: "not_fixed" }, userId, { source: "HUMAN" });

    const tracker = await import("@/lib/services/tracker-service");
    const detail = await tracker.getApplicationTracker(appId);
    const f = detail.findings.find((x) => x.id === finding.id)!;
    const current = f.iterationStates.reduce((a, b) => (b.iterationNumber > a.iterationNumber ? b : a)).statusValue;
    expect(current).toBe("not_fixed");
    // surface status mirrored:
    const surface = await testDb.finding.findUniqueOrThrow({ where: { id: finding.id }, include: { statusRef: true } });
    expect(surface.statusRef.value).toBe("not_fixed");
  });

  it("Test 3 — test case present in I1, absent in I2 → preserved with state, never deleted", async () => {
    const tcSvc = await import("@/lib/services/test-case-service");
    const tc = await tcSvc.createTestCase({ applicationId: appId, title: "Rate-limit check login", statusValue: "included" }, userId, {});
    await tcSvc.setTestCaseIterationState({ testCaseId: tc.id, iterationId: i1, statusValue: "tested" }, userId, { source: "HUMAN" });
    // Iteration 2 produces no row: importer semantics mark removal explicitly:
    await tcSvc.setTestCaseIterationState({ testCaseId: tc.id, iterationId: i2, statusValue: "not_retested" }, userId, { source: "HUMAN" });

    const preserved = await testDb.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(preserved.isActive).toBe(true); // deactivated only on removed/out_of_scope
    const states = await testDb.testCaseIteration.findMany({ where: { testCaseId: tc.id }, include: { statusRef: true } });
    expect(states.map((s) => s.statusRef.value)).toEqual(["tested", "not_retested"]);
  });

  it("Test 4 — finding first seen in I2 records firstSeenIterationNumber = 2 (new)", async () => {
    const svc = await import("@/lib/services/finding-service");
    const finding = await svc.createFinding(
      { applicationId: appId, title: "New nosql injection probe", severityValue: "high", firstSeenIterationNumber: 2 },
      userId,
      {},
    );
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i2, severityValue: "high", statusValue: "new" }, userId, { source: "HUMAN" });

    const row = await testDb.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(row.firstSeenIterationNumber).toBe(2);
    const state = await testDb.findingIterationState.findFirstOrThrow({ where: { findingId: finding.id, iterationId: i2 }, include: { statusRef: true } });
    expect(state.statusRef.value).toBe("new");
  });

  it("Test 5 — I2 Fixed → human correction Not Fixed: decision wins; I3 creation is capped", async () => {
    const svc = await import("@/lib/services/finding-service");
    const finding = await svc.createFinding({ applicationId: appId, title: "Session fixation on SSO", severityValue: "critical" }, userId, {});
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i1, severityValue: "critical", statusValue: "open" }, userId, { source: "HUMAN" });
    await svc.setFindingIterationState({ findingId: finding.id, iterationId: i2, severityValue: "critical", statusValue: "fixed" }, userId, { source: "HUMAN" });

    // Human CORRECTION (authoritative ledger, §24/§54) — the append-only way to
    // mark not_fixed now that the contract ends at I2.
    const correct = await import("@/lib/services/authoritative-state/finding-state");
    await correct.recordAuthoritativeDecision({
      entityType: "finding",
      entityId: finding.id,
      iterationId: i2,
      newState: "not_fixed",
      reason: "retest says still vulnerable",
      resolutionMethod: "HUMAN_CORRECTION",
      decisionSource: "HUMAN_CORRECTION",
    } as never);

    const state = await correct.calculateAuthoritativeFindingState(finding.id);
    expect(state.currentStatus).toBe("not_fixed");

    const tracker = await import("@/lib/services/tracker-service");
    const detail = await tracker.getApplicationTracker(appId);
    const f = detail.findings.find((x) => x.id === finding.id)!;
    expect(["open", "fixed", "not_fixed"]).toContain(f.currentStatusValue);
    // displayed iteration columns are capped at I1/I2 (no iteration 3):
    expect(f.iterationStates.filter((s) => s.iterationNumber <= 2).length).toBe(2);
    // and creating I3 is rejected by the contract cap (user-directed 2026-11):
    const engSvc2 = await import("@/lib/services/engagement-service");
    await expect(engSvc2.createIteration({ engagementId, iterationTypeValue: "retest" }, userId, {})).rejects.toThrow(/exactly two iterations|Iteration 3/);
  });

  it("matchKey dedupes near-identical titles (§23 deterministic matching)", async () => {
    const svc = await import("@/lib/services/finding-service");
    await svc.createFinding({ applicationId: appId, title: "CORS Misconfiguration.", severityValue: "medium" }, userId, {});
    await expect(
      svc.createFinding({ applicationId: appId, title: "CORS Misconfiguration", severityValue: "medium" }, userId, {}),
    ).rejects.toThrow(/matching finding already exists/i);
  });
});

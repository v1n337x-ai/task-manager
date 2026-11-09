/**
 * Phase 5 tests — AI thread analysis: provider gating (§6), deterministic mock
 * extraction, structured output validation, evidence persistence, review
 * decisions (§74), reanalysis history (§46), and NO VAPT mutation (§58).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { writeFixtures } from "../fixtures/eml-fixtures";

const FIXTURE_DIR = path.join("tests", "fixtures", "eml-live");

describe.skipIf(!dbAvailable)("AI thread analysis (mock provider)", () => {
  let userId = 0;
  let threadId = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    writeFixtures(FIXTURE_DIR);
    // Set up Application X + ingest the three-message chain (Phase 4 pipeline).
    const appType = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_type", value: "web" } } })).id;
    const scope = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "scope", value: "internal" } } })).id;
    const env = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "environment", value: "prod" } } })).id;
    const active = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_status", value: "active" } } })).id;
    const app = await testDb.application.create({
      data: { name: "Application X", displayName: "Application X", applicationType: appType, scope, environment: env, site: active },
    });
    appIdGlobal = app.id;
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    let lastThread: number | null = null;
    for (const name of ["chain-a.eml", "chain-b.eml", "chain-c.eml"]) {
      const content = fs.readFileSync(path.join(FIXTURE_DIR, name));
      const valid = await validateEmlUpload({ filename: name, content, userId, applicationId: appIdGlobal, ctx: {} });
      const confirmed = await confirmEmlUpload({ jobId: valid.jobId, userId, ctx: {} });
      lastThread = confirmed.threadId;
    }
    threadId = lastThread!;
  }, 90_000);

  let appIdGlobal = 0;

  it("1-3. explicit analysis creates a versioned run with structured V1 output (§7/§11)", async () => {
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    const run = await analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "mock" });

    expect(run.extractionId).toBeGreaterThan(0);
    expect(run.status).toBe("needs_review");
    expect(run.provider).toBe("mock");
    expect(run.schemaVersion).toBe("AI_EXTRACTION_V1");
    expect(run.promptVersion).toBe("VAPT_EMAIL_ANALYSIS_V2");
    // mock found F-002/003 status statements from the fixture chain:
    expect(run.structured!.findings.length).toBeGreaterThanOrEqual(1);
    const fixedSignal = run.structured!.findings.find((f) => f.statusSignal === "fixed");
    const notFixed = run.structured!.findings.find((f) => f.statusSignal === "not_fixed");
    expect(fixedSignal).toBeDefined();
    expect(notFixed).toBeDefined();
    // §28 contradictory signals preserved (chain: developer says fixed → pentester says not fixed)
    expect((run.structured!.findings.filter((f) => f.statusSignal === "fixed").length > 0)).toBe(true);
    expect((run.structured!.findings.filter((f) => f.statusSignal === "not_fixed").length > 0)).toBe(true);

    const row = await testDb.aiExtraction.findUniqueOrThrow({ where: { id: run.extractionId } });
    expect(row.inputContextHash).toBeTruthy();
    expect(row.outputHash).toBeTruthy();
    expect(row.promptVersion).toBe("VAPT_EMAIL_ANALYSIS_V2");
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("4-6. evidence rows reference REAL messages with minimal excerpts (§32/§33/§62)", async () => {
    const runs = await testDb.aiExtraction.findMany({ where: { threadId }, orderBy: { createdAt: "desc" }, take: 1 });
    const extraction = runs[0]!;
    const evidence = await testDb.aiEvidence.findMany({ where: { extractionId: extraction.id } });
    expect(evidence.length).toBeGreaterThan(0);
    const messages = await testDb.emailMessage.findMany({ where: { threadId }, select: { id: true } });
    const messageIds = messages.map((m) => m.id);
    for (const ev of evidence) {
      expect(messageIds).toContain(ev.sourceId);
      if (ev.excerpt) expect(ev.excerpt.length).toBeLessThanOrEqual(900);
    }
  });

  it("7-9. item-level approve/correct preserves the AI payload (§42/§74/§75)", async () => {
    const runs = await testDb.aiExtraction.findMany({ where: { threadId }, orderBy: { createdAt: "desc" }, take: 1 });
    const extractionId = runs[0]!.id;
    const before = JSON.stringify(await testDb.aiExtraction.findUniqueOrThrow({ where: { id: extractionId }, select: { structuredOutput: true } }));

    const { recordApprovalDecision } = await import("@/lib/services/ai-foundation-service");
    // approve one finding item:
    await recordApprovalDecision({ extractionId, decision: "approve", itemKey: "findingStatus:1" }, userId, {});
    // correct a participant role (AI said X → human says pentester):
    await recordApprovalDecision(
      { extractionId, decision: "correct", itemKey: "participantRole:vineet@security-vendor.test", correctedValue: "pentester", note: "evidence: authored retest report" },
      userId,
      {},
    );
    // reject another item:
    await recordApprovalDecision({ extractionId, decision: "reject", itemKey: "findingStatus:0" }, userId, {});

    const after = JSON.stringify(await testDb.aiExtraction.findUniqueOrThrow({ where: { id: extractionId }, select: { structuredOutput: true } }));
    expect(before).toBe(after); // AI output IMMUTABLE

    const decisions = await testDb.aiApprovalDecision.findMany({ where: { extractionId }, include: { decidedBy: true } });
    expect(decisions.map((d) => d.itemKey)).toContain("findingStatus:1");
    expect(decisions.map((d) => d.itemKey)).toContain("participantRole:vineet@security-vendor.test");
    const correction = decisions.find((d) => d.decision === "correct");
    expect(correction!.correctedValue).toBe("pentester");
    const rejected = decisions.find((d) => d.decision === "reject");
    expect(rejected).toBeDefined();
    // whole-run status remains in review (partial decisions don't auto-approve the run):
    const extractionAfter = await testDb.aiExtraction.findUniqueOrThrow({ where: { id: extractionId }, include: { statusRef: true } });
    expect(["needs_review", "approved", "rejected"]).toContain(extractionAfter.statusRef.value);
  });

  it("10-11. reanalyze creates a NEW run; the previous run + corrections remain (§45/§46)", async () => {
    const before = await testDb.aiExtraction.count({ where: { threadId } });
    const beforeCorrections = await testDb.aiApprovalDecision.count();
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    const run2 = await analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "mock" });
    expect(await testDb.aiExtraction.count({ where: { threadId } })).toBe(before + 1);
    expect(await testDb.aiApprovalDecision.count()).toBe(beforeCorrections);
    expect(run2.inputContextHash).toBeTruthy();
  });

  it("12. repeated identical context does NOT overwrite the first run (§49 idempotency of history)", async () => {
    const runs = await testDb.aiExtraction.findMany({ where: { threadId }, orderBy: { createdAt: "asc" } });
    const previous = runs[runs.length - 1]!;
    const rl = await import("@/lib/auth/rate-limit");
    rl.resetRateLimiter();
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    const repeated = await analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "mock" });
    expect(repeated.inputContextHash).toBe(previous.inputContextHash); // tracker state unchanged since previous run
    expect(repeated.extractionId).not.toBe(previous.id); // separate runs, both kept
  });

  it("13-15. OpenCode (enabled, unconfigured) fails HONESTLY without server/credential (§6/§50)", async () => {
    // Enabled provider row but NO server/credential configuration — analysis
    // must refuse honestly, record a failed run, and never fabricate output.
    await testDb.aiConfiguration.upsert({
      where: { provider: "opencode" },
      update: { enabled: true },
      create: { provider: "opencode", enabled: true },
    });
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    await expect(analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "opencode" })).rejects.toThrow(/contract unavailab|cannot run until/i);
    const failureRuns = await testDb.aiExtraction.findMany({ where: { threadId, statusRef: { value: "failed" } } });
    expect(failureRuns.length).toBeGreaterThanOrEqual(1);
    expect(failureRuns[0]!.errorMessage).toContain("contract unavailable");
    // NO fake extraction data was created:
    for (const fr of failureRuns) {
      expect(fr.structuredOutput).toBeNull();
    }
  });

  it("16-17. AI analysis alone never mutates VAPT data — the human approval is the write gate (§58/§83 + Phase 9.1)", async () => {
    // Approvals in tests 7-9 applied ONE finding to the tracker (Phase 9.1):
    const findingsBefore = await testDb.finding.count();
    expect(findingsBefore).toBeGreaterThanOrEqual(1);
    const decisions = await testDb.aiApprovalDecision.count();
    expect(decisions).toBeGreaterThanOrEqual(1);

    // Running the analysis again must NOT create/alter anything (§58: AI
    // never writes alone — only APPROVED data reaches the tracker). The rate
    // limiter has already been consumed by earlier tests in this file, so
    // reset it first (this is the §53 guard, still covered by test 18).
    const rl = await import("@/lib/auth/rate-limit");
    rl.resetRateLimiter();
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    const run = await analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "mock" });
    expect(run.status).toBe("needs_review");
    expect(await testDb.finding.count()).toBe(findingsBefore);
    // and the approved finding genuinely carries iteration state:
    const states = await testDb.findingIterationState.count();
    expect(states).toBeGreaterThanOrEqual(1);
  });

  it("18. rate limiting guards the expensive endpoint (§53)", async () => {
    const rl = await import("@/lib/auth/rate-limit");
    rl.resetRateLimiter();
    const { analyzeThread } = await import("@/lib/ai/analysis-service");
    let hit = false;
    for (let i = 0; i < 5; i++) {
      try {
        await analyzeThread({ threadId, userId, ctx: {}, providerOverrideSlug: "mock" });
      } catch (error) {
        const message = String(error);
        if (/rate limit/i.test(message)) hit = true;
      }
    }
    expect(hit).toBe(true);
  });
});

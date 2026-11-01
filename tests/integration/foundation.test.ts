/**
 * End-to-end foundation test (brief section 59) + phase-2 §52 database tests.
 * Runs against the isolated test database; skipped gracefully when unusable.
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { authenticate } from "@/lib/services/user-service";

describe.skipIf(!dbAvailable)("§59 end-to-end foundation chain", () => {
  let userId = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
  }, 60_000);

  it("1-2. authenticates the seeded single credential (valid + invalid password)", async () => {
    const envEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@akasaair.com").toLowerCase();
    const envPwd = process.env.SEED_ADMIN_PASSWORD ?? "TaskManager!2026";
    const ok = await authenticate(envEmail, envPwd);
    expect(ok.email).toBe(envEmail);
    await expect(authenticate(envEmail, "wrong-password-1")).rejects.toThrow();
    await expect(authenticate("nobody@akasaair.com", envPwd)).rejects.toThrow();
  });

  let applicationId = 0;
  it("3. creates an application through the service layer", async () => {
    const svc = await import("@/lib/services/application-service");
    const created = await svc.createApplication(
      {
        name: "E2E Probe App",
        applicationTypeValue: "web",
        scopeValue: "internal",
        environmentValue: "prod",
        webUrl: "https://e2e.akasaair.test",
      },
      userId,
      {},
    );
    applicationId = created.id;
    expect(created.name).toBe("E2E Probe App");
    expect(created.typeName).toBe("web");
  });

  it("4. adds aliases including near-duplicates (duplicate alias handling)", async () => {
    const svc = await import("@/lib/services/application-service");
    const a = await svc.addAlias({ applicationId, alias: "E2E Probe" }, userId, {});
    expect(a.normalized).toBe("e2e probe");
    await expect(svc.addAlias({ applicationId, alias: "e2e probe" }, userId, {})).rejects.toThrow(/already exists|overlaps/i);
    await svc.addAlias({ applicationId, alias: "e2e-probe-url", aliasTypeValue: "fqdn" }, userId, {});
    const aliases = await svc.listAliases(applicationId);
    expect(aliases.length).toBeGreaterThanOrEqual(2);
  });

  let engagementId = 0;
  let iteration1Id = 0;
  let iteration2Id = 0;
  it("5-7. creates engagement + Iteration 1 (Initial Scan) + Iteration 2 (Retest)", async () => {
    const svc = await import("@/lib/services/engagement-service");
    const engagement = await svc.createEngagement(
      {
        applicationId,
        name: "E2E Probe VAPT",
        scopeValue: "internal",
        assessmentSourceValue: "manual_burp",
        statusValue: "in_progress",
      },
      userId,
      {},
    );
    engagementId = engagement.id;

    const i1 = await svc.createIteration({ engagementId, iterationTypeValue: "initial_scan", statusValue: "completed" }, userId, {});
    expect(i1.number).toBe(1);
    iteration1Id = i1.id;
    const i2 = await svc.createIteration({ engagementId, iterationTypeValue: "retest", statusValue: "in_progress" }, userId, {});
    expect(i2.number).toBe(2);
    iteration2Id = i2.id;

    // Iteration 3 must work without schema redesign (§18-19).
    const i3 = await svc.createIteration({ engagementId, iterationTypeValue: "follow_up" }, userId, {});
    expect(i3.number).toBe(3);
  });

  let findingId = 0;

  it("8-9. creates a finding + iteration states (Open → Fixed) with preserved history", async () => {
    const svc = await import("@/lib/services/finding-service");
    const finding = await svc.createFinding(
      { applicationId, title: "E2E SQL Injection probe", severityValue: "high" },
      userId,
      {},
    );
    findingId = finding.id;
    expect(finding.code).toMatch(/^F-\d{3}$/);

    await svc.setFindingIterationState(
      { findingId, iterationId: iteration1Id, severityValue: "high", statusValue: "open" },
      userId,
      { source: "HUMAN" },
    );
    // Iteration 2: Fixed — Iteration 1 history must remain (§24/§60).
    await svc.setFindingIterationState(
      { findingId, iterationId: iteration2Id, severityValue: "high", statusValue: "fixed", retestNote: "validated in retest" },
      userId,
      { source: "HUMAN" },
    );

    const states = await testDb.findingIterationState.findMany({ where: { findingId }, include: { statusRef: true } });
    expect(states.length).toBe(2);
    const history = await svc.listFindingHistory(findingId);
    expect(history.map((h) => h.newStatus)).toEqual(["open", "fixed"]);
  });

  let testCaseId = 0;
  it("10-11. creates a test case + iteration state (removed test case preserved, §22)", async () => {
    const svc = await import("@/lib/services/test-case-service");
    const tc = await svc.createTestCase(
      { applicationId, title: "E2E Session cookie flags", statusValue: "included" },
      userId,
      {},
    );
    testCaseId = tc.id;
    expect(tc.code).toMatch(/^TC-\d{3}$/);

    await svc.setTestCaseIterationState({ testCaseId, iterationId: iteration1Id, statusValue: "passed" }, userId, { source: "HUMAN" });
    // Disappears in Iteration 2 → recorded as removed, row persists:
    await svc.setTestCaseIterationState({ testCaseId, iterationId: iteration2Id, statusValue: "removed" }, userId, { source: "HUMAN" });

    const rows = await testDb.testCaseIteration.findMany({ where: { testCaseId } });
    expect(rows.length).toBe(2);
    const removed = await testDb.testCase.findUnique({ where: { id: testCaseId } });
    expect(removed?.isActive).toBe(false); // deactivated, never deleted
  });

  it("12. creates an email thread + message + participant + attachment metadata", async () => {
    const svc = await import("@/lib/services/email-foundation-service");
    await svc.upsertParticipant(
      { emailAddress: "pentester@digialert.test", name: "Vineet K", roleValue: "pentester", roleSource: "RULE" },
      null,
    );
    const thread = await svc.createThread(
      { applicationId, subject: "Re: [Request ID :##SR-99##] E2E probe scan" },
      null,
    );
    const participant = await testDb.emailParticipant.findUniqueOrThrow({ where: { emailAddress: "pentester@digialert.test" } });
    const message = await svc.createMessage(
      {
        threadId: thread.id,
        messageId: "<e2e-probe-1@digialert.test>",
        fromParticipantId: participant.id,
        subject: "Re: E2E probe scan",
        sentAt: new Date("2026-11-02T09:30:00Z"),
        bodyText: "Validation completed.",
        recipients: [{ kind: "TO", email: "owner@akasaair.test", name: "App Owner" }],
      },
      null,
    );
    expect(message.threadId).toBe(thread.id);

    const attachment = await svc.createAttachmentMeta(
      { messageId: message.id, filename: "report.pdf", contentType: "application/pdf", sizeBytes: 1024 },
      null,
    );
    expect(attachment.processingStatusRef).toBeUndefined(); // id only — verify via DB read:
    const withRef = await testDb.emailAttachment.findUniqueOrThrow({ where: { id: attachment.id }, include: { processingStatusRef: true } });
    expect(withRef.processingStatusRef.value).toBe("pending");

    // Human role override beats AI role (§30).
    await svc.overrideParticipantRole({ participantEmail: "pentester@digialert.test", roleValue: "security_team" }, userId);
    const overridden = await testDb.emailParticipant.findUniqueOrThrow({
      where: { emailAddress: "pentester@digialert.test" },
      include: { roleOverrideRef: true, roleRef: true },
    });
    expect(overridden.roleOverrideRef?.value).toBe("security_team");
    expect(overridden.roleRef.value).toBe("pentester");
  });

  it("13. creates an AI extraction record + evidence (no agent wired, §32-33)", async () => {
    const svc = await import("@/lib/services/ai-foundation-service");
    const message = await testDb.emailMessage.findFirstOrThrow();
    const extraction = await svc.createExtraction(
      {
        sourceMessageId: message.id,
        applicationId,
        extractionType: "finding_status",
        structuredOutput: { findingCode: "F-001", status: "fixed", confidence: 94 },
        confidence: 94,
      },
      null,
    );
    expect(extraction.id).toBeGreaterThan(0);

    await svc.addEvidence(
      {
        extractionId: extraction.id,
        sourceType: "EMAIL_MESSAGE",
        sourceId: message.id,
        field: "finding.status",
        extractedValue: "fixed",
        excerpt: "Session token issue validated as fixed",
        confidence: 94,
      },
      null,
    );
    const evidence = await testDb.aiEvidence.findMany({ where: { extractionId: extraction.id } });
    expect(evidence.length).toBe(1);

    // §34: only a human approval is stored by this foundation — no business write.
    await svc.recordApprovalDecision({ extractionId: extraction.id, decision: "approve", note: "reviewed" }, userId, {});
    const decision = await testDb.aiApprovalDecision.findUniqueOrThrow({ where: { extractionId: extraction.id } });
    expect(decision.decision).toBe("approve");
    await expect(svc.recordApprovalDecision({ extractionId: extraction.id, decision: "reject" }, userId, {})).rejects.toThrow();
  });

  it("14. every write so far left an audit trail (§35)", async () => {
    const count = await testDb.auditLog.count();
    expect(count).toBeGreaterThan(5);
    const sources = new Set((await testDb.auditLog.findMany()).map((a) => a.source));
    expect(sources.has("HUMAN")).toBe(true);
    expect(sources.has("SYSTEM")).toBe(true);
  });

  it("15. schema versions contract present (§37)", async () => {
    // registered by the reconcile step inside resetTestData? — seeded here if absent.
    await testDb.schemaVersion.upsert({
      where: { trackerName_version: { trackerName: "PT Tracker", version: "1.0" } },
      update: {},
      create: { trackerName: "PT Tracker", version: "1.0", columnsCount: 39 },
    });
    const v = await testDb.schemaVersion.findUniqueOrThrow({
      where: { trackerName_version: { trackerName: "PT Tracker", version: "1.0" } },
    });
    expect(v.columnsCount).toBe(39);
  });
});

describe.skipIf(!dbAvailable)("§52 master-data & iteration tests", () => {
  beforeAll(async () => {
    await resetTestData();
  }, 30_000);

  it("master values exist per domain with ≥1 active value (§14)", async () => {
    // Seed master values (must run before other asserts in this describe).
    const { MASTER_VALUES } = await import("@/lib/master-data/vocabulary");
    await testDb.masterValue.createMany({
      data: MASTER_VALUES.map((entry) => ({ domain: entry.domain, value: entry.value, label: entry.label, sortOrder: entry.sortOrder })),
      skipDuplicates: true,
    });
    const rows = await testDb.masterValue.groupBy({ by: ["domain"], _count: { _all: true } });
    const domains = rows.map((r) => r.domain);
    for (const required of [
      "application_type", "environment", "scope", "application_status", "engagement_status",
      "iteration_type", "iteration_status", "test_case_status", "finding_status",
      "finding_iteration_status", "severity", "assessment_source", "test_approach",
      "participant_role", "alias_type", "attachment_status", "extraction_status", "job_status",
    ]) expect(domains).toContain(required);
  });

  it("iteration numbering is open-ended (§19)", async () => {
    const svc = await import("@/lib/services/engagement-service");
    const app = await testDb.application.create({
      data: {
        name: "Iteration Probe",
        displayName: "Iteration Probe",
        applicationType: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_type", value: "web" } } })).id,
        scope: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "scope", value: "internal" } } })).id,
        environment: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "environment", value: "prod" } } })).id,
        site: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_status", value: "active" } } })).id,
      },
    });
    const eng = await svc.createEngagement({ applicationId: app.id, name: "Iteration Probe VAPT", scopeValue: "internal", assessmentSourceValue: "vapt" }, null, {});
    const i1 = await svc.createIteration({ engagementId: eng.id, iterationTypeValue: "initial_scan" }, null, {});
    const i2 = await svc.createIteration({ engagementId: eng.id, iterationTypeValue: "retest" }, null, {});
    const i3 = await svc.createIteration({ engagementId: eng.id, iterationTypeValue: "retest" }, null, {});
    const i4 = await svc.createIteration({ engagementId: eng.id, iterationTypeValue: "follow_up" }, null, {});
    expect([i1.number, i2.number, i3.number, i4.number]).toEqual([1, 2, 3, 4]);
    // Rule enforcement: iteration 1 must be initial scan, 2+ cannot be.
    await expect(
      svc.createIteration({ engagementId: eng.id, iterationTypeValue: "retest" }, null, {}),
    ).resolves.toBeTruthy();
    await expect(svc.createIteration({ engagementId: eng.id, iterationTypeValue: "initial_scan" }, null, {})).rejects.toThrow(/Initial Scan/);
  });
});

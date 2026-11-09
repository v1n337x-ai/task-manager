/**
 * Phase 4 tests: .eml upload → parse → thread reconstruction → participants →
 * attachments → duplicates → security guards.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { guardEmlUpload } from "@/lib/eml/email-import-service";
import { sanitizeEmailHtml } from "@/lib/eml/sanitize";
import { writeFixtures } from "../fixtures/eml-fixtures";

const FIXTURE_DIR = path.join("tests", "fixtures", "eml-live");

describe("upload guards (§7-§8)", () => {
  it("rejects non-.eml extensions", () => {
    expect(() => guardEmlUpload("report.pdf", Buffer.from("%PDF-1.4"))).toThrow(/only .eml files/);
  });
  it("rejects empty files", () => {
    expect(() => guardEmlUpload("x.eml", Buffer.alloc(0))).toThrow(/empty file/);
  });
  it("rejects ZIP masquerading as EML (content sniff)", () => {
    expect(() => guardEmlUpload("x.eml", Buffer.concat([Buffer.from("PK\u0003\u0004invalid"), Buffer.alloc(10)]))).toThrow(/not an RFC-822/);
  });
  it("sanitizes HTML bodies: script removed, safe markup kept, external image stripped, js:-urls dropped", () => {
    const dirty = "<html><body><p>Safe <strong>text</strong></p><script>alert('evil')</script><img src=\"https://evil.test/x.png\"><a href=\"javascript:alert(1)\">click</a></body></html>";
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).toContain("Safe");
    expect(clean).toContain("<strong>text</strong>");
    expect(clean.toLowerCase()).not.toContain("script");
    expect(clean).not.toContain("evil.test");
    expect(clean).not.toContain("javascript");
  });
});

describe.skipIf(!dbAvailable)(".EML pipeline (test DB)", () => {
  let userId = 0;
  let appId = 0;
  const uploadResults: { jobId: number; filename: string; preview: Record<string, unknown> | null }[] = [];

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    writeFixtures(FIXTURE_DIR);
    const appType = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_type", value: "web" } } })).id;
    const scope = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "scope", value: "internal" } } })).id;
    const env = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "environment", value: "prod" } } })).id;
    const active = (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_status", value: "active" } } })).id;
    const app = await testDb.application.create({
      data: { name: "Application X", displayName: "Application X", applicationType: appType, scope, environment: env, site: active },
    });
    appId = app.id;
  }, 60_000);

  it("1-2. the §15 chain: three EMLs land on ONE thread (Message-ID graph + application link)", async () => {
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    for (const name of ["chain-a.eml", "chain-b.eml", "chain-c.eml"]) {
      const content = fs.readFileSync(path.join(FIXTURE_DIR, name));
      const result = await validateEmlUpload({
        filename: name,
        content,
        userId,
        applicationId: appId,
        options: { batchId: "chain" },
        ctx: {},
      });
      expect(result.duplicate).toBe(false);
      uploadResults.push({ jobId: result.jobId, filename: name, preview: result.preview as unknown as Record<string, unknown> });
    }
    const confirmations: { threadId: number; threadReason: string }[] = [];
    for (const u of uploadResults) {
      const confirmed = await confirmEmlUpload({ jobId: u.jobId, userId, ctx: {} });
      confirmations.push({ threadId: confirmed.threadId, threadReason: confirmed.threadReason });
    }
    // one thread for all three:
    expect(confirmations[0]!.threadId).toBe(confirmations[1]!.threadId);
    expect(confirmations[1]!.threadId).toBe(confirmations[2]!.threadId);
    // reasons recorded per priority:
    expect(confirmations[0]!.threadReason).toBe("new_thread");
    expect(confirmations[1]!.threadReason).toBe("in_reply_to_ancestor");
    expect(confirmations[2]!.threadReason).toBe("references_ancestor");

    const thread = await testDb.emailThread.findUniqueOrThrow({
      where: { id: confirmations[0]!.threadId },
      include: {
        messages: { orderBy: { sentAt: "asc" }, include: { fromContact: { include: { roleRef: true } }, recipients: true } },
      },
    });
    expect(thread.applicationId).toBe(appId);
    expect(thread.messages.length).toBe(3);
    // graph facts:
    expect(thread.messages[0]!.inReplyTo).toBeNull();
    expect(thread.messages[0]!.messageId).toBe("<chainA-0001@security-vendor.test>");
    expect(thread.messages[1]!.inReplyTo).toContain("chainA-0001");
    expect(thread.messages[2]!.references).toContain("chainA-0001");
    // participant roles: AUTO-DETECTED from the .eml (user-directed 2026-11) �
    // the security-vendor vendor participants classify as pentester via the rule
    // engine; unknown remains unknown only when no evidence exists.
    for (const m of thread.messages) {
      if (m.fromContact.emailAddress.includes("security-vendor")) {
        expect(m.fromContact.roleRef.value).toBe("pentester");
        expect(m.fromContact.roleSource).toBe("RULE");
      } else {
        expect(["unknown", "application_owner", "developer", "pentester"]).toContain(m.fromContact.roleRef.value);
      }
    }
    // participants directory: deduplicated addresses across the chain
    const participants = await testDb.emailParticipant.count();
    expect(participants).toBeGreaterThanOrEqual(3);
    // recipients recorded per message (TO/CC kinds):
    const toCounts = thread.messages.map((m) => m.recipients.filter((r) => r.kind === "TO").length);
    expect(toCounts[0]!).toBeGreaterThan(0);
    // original files preserved verbatim:
    for (const m of thread.messages) {
      expect(m.sourceFile).toBeTruthy();
      const bytes = fs.readFileSync(m.sourceFile!);
      expect(bytes.length).toBeGreaterThan(50);
      expect(bytes.toString()).toContain("Message-ID");
    }
  });

  it("3. multipart/alternative + attachment: HTML extracted (sanitized at API), attachment bytes stored", async () => {
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    const content = fs.readFileSync(path.join(FIXTURE_DIR, "multipart.eml"));
    const result = await validateEmlUpload({ filename: "multipart.eml", content, userId, applicationId: appId, options: { batchId: "multi" }, ctx: {} });
    expect(result.preview.attachments.length).toBe(1);
    expect(result.preview.attachments[0]!.filename).toBe("report-notes.txt");
    const stored = fs.readFileSync(path.resolve(result.preview.attachments[0]!.storageReference!));
    expect(stored.toString()).toBe("Cash Portal check notes");
    expect(result.preview.hasTextBody).toBe(true);
    expect(result.preview.hasHtmlBody).toBe(true);
    expect(result.preview.subjectOriginal).toContain("Report with attachment");

    const confirmed = await confirmEmlUpload({ jobId: result.jobId, userId, ctx: {} });
    const message = await testDb.emailMessage.findUniqueOrThrow({ where: { id: confirmed.messageId! } });
    expect(message.bodyHtml).toContain("<strong>markup</strong>");
    // �2: the DB preserves the ORIGINAL html; sanitization happens at read-time.
    const { sanitizeEmailHtml } = await import("@/lib/eml/sanitize");
    expect(sanitizeEmailHtml(message.bodyHtml) ?? "").not.toContain("<script");
    const attachments = await testDb.emailAttachment.findMany({ where: { messageId: message.id } });
    expect(attachments.length).toBe(1);
    expect(attachments[0]!.sizeBytes).toBeGreaterThan(0);
  });

  it("4-5. absent Message-ID → deterministic synthetic ID (§13); original preserved", async () => {
    const content = fs.readFileSync(path.join(FIXTURE_DIR, "no-message-id.eml"));
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    const validated = await validateEmlUpload({ filename: "no-message-id.eml", content, userId, ctx: {} });
    const preview = validated.preview as unknown as Record<string, unknown>;
    expect(preview["messageIdOriginal"]).toBeNull();
    const confirmed = await confirmEmlUpload({ jobId: validated.jobId, userId, ctx: {} });
    const message = await testDb.emailMessage.findUniqueOrThrow({ where: { id: confirmed.messageId! } });
    // deterministic: sha-based id
    expect(message.messageId).toMatch(/^<synth-[0-9a-f]{64}@task-manager\.invalid>$/);
    expect(message.headersRaw).toBeTruthy();
    expect(JSON.stringify(message.headersRaw).length).toBeGreaterThan(10);
  });

  it("6. duplicate upload flagged, NOT written; force reprocess stays idempotent (same message)", async () => {
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    const content = fs.readFileSync(path.join("tests/fixtures/eml-live", "chain-a.eml"));
    const again = await validateEmlUpload({ filename: "chain-a.again.eml", content, userId, applicationId: appId, ctx: {} });
    expect(again.duplicate).toBe(true);
    expect(again.preview.duplicateOf?.threadId).toBeTruthy();

    const messagesBefore = await testDb.emailMessage.count();
    // confirm without force must FAIL with the duplicate conflict:
    await expect(confirmEmlUpload({ jobId: again.jobId, userId, ctx: {} })).rejects.toThrow(/Duplicate EML detected/);
    expect(await testDb.emailMessage.count()).toBe(messagesBefore);

    // §13: explicit force reprocess — same Message-ID identities are NEVER duplicated;
    // the same row is reused (idempotent interpretation refresh).
    const forced = await confirmEmlUpload({ jobId: again.jobId, userId, force: true, ctx: {} });
    expect(forced.threadReason).toBe("message_id_known");
    expect(await testDb.emailMessage.count()).toBe(messagesBefore);
    const sameMessage = await testDb.emailMessage.findUniqueOrThrow({ where: { messageId: "<chainA-0001@security-vendor.test>" } });
    expect(sameMessage.threadId).toBe(forced.threadId);
  });

  it("§17: identical subject across DIFFERENT participants/application must NOT merge", async () => {
    const { prisma } = await import("@/lib/db");
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    const otherApp = await testDb.application.create({
      data: {
        name: "Unrelated Application Y",
        displayName: "Unrelated Application Y",
        applicationType: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_type", value: "web" } } })).id,
        scope: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "scope", value: "external" } } })).id,
        environment: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "environment", value: "uat" } } })).id,
        site: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_status", value: "active" } } })).id,
      },
    });
    const email = `From: someone@elsewhere.test
To: other-owner@client.test
Subject: VAPT Findings - Application X
Date: Sat, 07 Nov 2026 09:00:00 +0530
Message-ID: <unrelated-99@elsewhere.test>
Content-Type: text/plain

Same subject, different estate and participant set.
`;
    const result = await validateEmlUpload({ filename: "unrelated.eml", content: Buffer.from(email), userId, applicationId: otherApp.id, ctx: {} });
    // With an application declared, the subject+application key does not match chain-a's (different application):
    const confirmed = await confirmEmlUpload({ jobId: result.jobId, userId, ctx: {} });
    expect(confirmed.threadId).not.toBe((uploadResults[0]!.payload as unknown as { threadMatch?: { threadId?: number } })?.threadMatch?.threadId);
    const thread = await testDb.emailThread.findUniqueOrThrow({ where: { id: confirmed.threadId } });
    expect(thread.applicationId).toBe(otherApp.id);
    void prisma;
  });
});


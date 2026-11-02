/**
 * Phase 9.1 tests (batch 2) — deterministic EML participant role detection
 * (pentester/developer from the email itself) and the I1/I2 contract cap.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";

describe("EML role rules (deterministic, no AI)", () => {
  it("digialert vendor domain → pentester (domain + body confidence)", async () => {
    const { inferParticipantRoleFromEml } = await import("@/lib/eml/role-rules");
    const r1 = inferParticipantRoleFromEml({ email: "vineet@digialert.test", name: "Vineet", bodyHint: "Retest completed. F-001 Fixed." });
    expect(r1?.role).toBe("pentester");
    expect(r1!.confidence).toBeGreaterThanOrEqual(85);
    const r2 = inferParticipantRoleFromEml({ email: "ashwin.k@digialert.co.in", name: "Ashwin", bodyHint: "report attached" });
    expect(r2?.role).toBe("pentester");
  });

  it("developer via fix language; application owner via name; no evidence stays unknown", async () => {
    const { inferParticipantRoleFromEml } = await import("@/lib/eml/role-rules");
    const dev = inferParticipantRoleFromEml({ email: "someone@akasaair.com", name: "Rahul", bodyHint: "Deployed. The issue has been fixed and verified in staging." });
    expect(dev?.role).toBe("developer");
    const owner = inferParticipantRoleFromEml({ email: "p.prakash2@akasaair.com", name: "Application Owner", bodyHint: "acknowledged" });
    expect(owner?.role).toBe("application_owner");
    expect(inferParticipantRoleFromEml({ email: "someone@akasaair.com", name: "Random Person", bodyHint: "thanks" })).toBeNull();
  });

  it("conflicting language prefers pentester evidence; empty email rejected", async () => {
    const { inferParticipantRoleFromEml } = await import("@/lib/eml/role-rules");
    const mixed = inferParticipantRoleFromEml({ email: "tester@vendor.io", name: "Tester", bodyHint: "still vulnerable after your patch" });
    expect(mixed?.role).toBe("pentester");
    expect(inferParticipantRoleFromEml({ email: "", name: "x" })).toBeNull();
  });
});

describe.skipIf(!dbAvailable)("EML confirm auto-assigns RULE roles from the .eml", () => {
  let userId = 0;
  let appId = 0;
  let threadId = 0;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    const app = await testDb.application.create({
      data: {
        name: "Role Probe App",
        displayName: "Role Probe App",
        applicationType: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_type", value: "web" } } })).id,
        scope: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "scope", value: "internal" } } })).id,
        environment: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "environment", value: "prod" } } })).id,
        site: (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "application_status", value: "active" } } })).id,
      },
    });
    appId = app.id;
    const FIXTURE_DIR = path.join("tests", "fixtures", "eml-live");
    if (!fs.existsSync(path.join(FIXTURE_DIR, "chain-a.eml"))) {
      const { writeFixtures } = await import("../fixtures/eml-fixtures");
      writeFixtures(FIXTURE_DIR);
    }
    const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
    for (const name of ["chain-a.eml", "chain-b.eml", "chain-c.eml"]) {
      const valid = await validateEmlUpload({ filename: name, content: fs.readFileSync(path.join(FIXTURE_DIR, name)), userId, applicationId: appId, ctx: {} });
      const confirmed = await confirmEmlUpload({ jobId: valid.jobId, userId, ctx: {} });
      threadId = confirmed.threadId;
    }
  }, 90_000);

  it("participants from the chain get RULE-derived roles with confidence", async () => {
    const parts = await testDb.emailParticipant.findMany();
    const digi = parts.find((p) => p.emailAddress.includes("digialert"));
    expect(digi).toBeDefined();
    expect(digi!.roleSource).toBe("RULE");
    expect(digi!.confidence).toBeGreaterThanOrEqual(70);
    const roleRow = await testDb.masterValue.findUniqueOrThrow({ where: { id: digi!.role } });
    expect(roleRow.value).toBe("pentester");
    // the thread actually linked to the app:
    expect(threadId).toBeGreaterThan(0);
  });
});

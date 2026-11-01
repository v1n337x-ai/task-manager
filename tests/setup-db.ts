/**
 * Test bootstrap: loads .env.test, provides a disposable Prisma client + schema
 * reset helper (brief sections 52-53: from-empty migration + seed verification).
 */
import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Load the isolated test environment (.env.test â€” separate database).
config({ path: path.resolve(__dirname, "..", ".env.test"), override: true });

export const testDb = new PrismaClient();

/**
 * Probe connectivity SYNCHRONOUSLY at module load (top-level await) so
 * describe.skipIf(...) evaluates against reality, not a placeholder value.
 */
export let dbAvailable = false;
try {
  if (!process.env.TESTS_SKIP_DB) {
    await testDb.$queryRaw`SELECT 1`;
    dbAvailable = true;
  }
} catch {
  console.warn("[tests] test database unreachable â€” DB-dependent tests will SKIP.");
}

beforeAll(async () => {
  if (!dbAvailable) return;

  // Ensure the test schema matches current migrations (brief section 38).
  if (process.env.TESTS_SKIP_MIGRATE !== "1") {
    try {
      execSync("npx prisma migrate deploy", {
        stdio: "pipe",
        env: { ...process.env },
        cwd: path.resolve(__dirname, ".."),
      });
    } catch {
      try {
        execSync("npx prisma migrate reset --force --skip-seed", {
          stdio: "pipe",
          env: { ...process.env },
          cwd: path.resolve(__dirname, ".."),
        });
      } catch (error) {
        console.warn("[tests] migrate/reset failed:", String(error).slice(0, 200));
      }
      await testDb.$connect();
    }
  }
}, 120_000);

afterAll(async () => {
  await testDb.$disconnect().catch(() => undefined);
});

/** Wipe all data rows (keep schema): deterministic integration state. */
export async function resetTestData(): Promise<void> {
  await testDb.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "ai_configurations",
      "email_recipients", "email_attachments", "email_messages", "email_participants",
      "email_threads",
      "ai_evidence", "ai_approval_decisions", "ai_extractions",
      "finding_status_history", "finding_iteration_states", "findings",
      "test_case_iterations", "test_cases",
      "iterations", "engagements",
      "application_aliases", "application_assigned_members", "applications",
      "contacts", "master_values", "users",
      "audit_logs", "import_jobs", "export_jobs", "schema_versions"
    CASCADE;
  `);
}

/** Seed the minimum (same contract as `prisma/seed.ts` but test-isolated). */
export async function seedMinimal(bcryptModule: typeof bcrypt): Promise<{ userId: number }> {
  const passwordHash = await bcryptModule.hash(process.env.SEED_ADMIN_PASSWORD ?? "TaskManager!2026", 4);
  const user = await testDb.user.upsert({
    where: { email: (process.env.SEED_ADMIN_EMAIL ?? "admin@akasaair.com").toLowerCase() },
    update: { passwordHash },
    create: { email: (process.env.SEED_ADMIN_EMAIL ?? "admin@akasaair.com").toLowerCase(), passwordHash, displayName: "Platform Admin" },
  });
  const { MASTER_VALUES } = (await import("../lib/master-data/vocabulary")) as { MASTER_VALUES: { domain: string; value: string; label: string; sortOrder: number }[] };
  await testDb.masterValue.createMany({
    data: MASTER_VALUES.map((m) => ({ domain: m.domain, value: m.value, label: m.label, sortOrder: m.sortOrder })),
    skipDuplicates: true,
  });
  return { userId: user.id };
}

export const ROOT = path.resolve(__dirname, "..");
export const hasMigrationsFolder = fs.existsSync(path.join(ROOT, "prisma", "migrations"));

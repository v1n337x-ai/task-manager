/**
 * Development seed (brief section 39): ONE login user, the master-data controlled
 * vocabularies, and a small number of applications.
 * The full VAPT tracker workbook is NOT seeded — that import is Phase 3.
 *
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env; the seed
 * NEVER invents a password on its own.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (adminPassword.length < 10) {
    throw new Error("Refusing to seed: SEED_ADMIN_PASSWORD must be set (min 10 chars) in your .env file.");
  }

  // 1) Synthetic login user (single credential — brief section 6).
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, isActive: true },
    create: {
      email: adminEmail,
      passwordHash,
      displayName: "Platform Admin",
    },
  });
  console.log(`✓ seeded user ${user.email}`);

  // 2) Master data vocabularies (DL-03 §5 real workbook values + Phase 2 states).
  const { MASTER_VALUES } = await import("../lib/master-data/vocabulary");

  for (const entry of MASTER_VALUES) {
    await prisma.masterValue.upsert({
      where: { domain_value: { domain: entry.domain, value: entry.value } },
      update: { label: entry.label, sortOrder: entry.sortOrder },
      create: { domain: entry.domain, value: entry.value, label: entry.label, sortOrder: entry.sortOrder },
    });
  }
  console.log(`✓ seeded ${MASTER_VALUES.length} master values across ${new Set(MASTER_VALUES.map((m) => m.domain)).size} domains`);

  // 3) No operational data is seeded. Applications, engagements, findings, mail,
  //    and report documents are added only after first login.

  // 4) Register the workbook schema version contract (brief section 37) so Phase 3
  //    import/export can already reference a stored 39-column contract.
  await prisma.schemaVersion.upsert({
    where: { trackerName_version: { trackerName: "PT Tracker", version: "1.0" } },
    update: {},
    create: {
      trackerName: "PT Tracker",
      version: "1.0",
      columnsCount: 39,
      notes:
        "Contract from Phase 1 DL-02/DL-03: A..AC single-block (29 cols) + AE..AN severity open/closed matrix (10) — 39 tracked columns in used range A1:AO37.",
    },
  });
  console.log("✓ registered PT Tracker schema v1.0 contract (39 columns)");
}

main()
  .catch((e) => {
    console.error("✗ seed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

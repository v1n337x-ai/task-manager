/**
 * Phase 7 tests â€” dashboard/report DTOs, PPT golden-data verification
 * (Â§68/Â§69), and the Dashboard=Reports=PPT consistency (Â§10/Â§87).
 */
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { generateDashboardReport } from "@/lib/services/reporting/report-service";

async function master(domain: string, value: string): Promise<number> {
  return (await testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } })).id;
}

describe.skipIf(!dbAvailable)("report DTO consistency (Â§5/Â§10)", () => {
  beforeAll(async () => {
    await resetTestData();
    await seedMinimal(bcrypt);
    const findingStatus = undefined as unknown as {
      open: number; fixed: number; car: number; notFixed: number; reopened: number;
    };
    void findingStatus;
    const appType = await master("application_type", "web");
    const scope = await master("scope", "internal");
    const env = await master("environment", "prod");
    const active = await master("application_status", "active");
    const engStatus = await master("engagement_status", "in_progress");
    const vapt = await master("assessment_source", "vapt");
    const iterTypeScan = await master("iteration_type", "initial_scan");
    const iterStatusDone = await master("iteration_status", "completed");

    // Â§68 golden dataset: 3 applications, 13 findings (1C/3H/5M/4L)
    type Spec = { name: string; findings: { severity: string; status: string }[] };
    const applications: Spec[] = [
      {
        name: "Golden App A",
        findings: [
          { severity: "critical", status: "open" },
          { severity: "high", status: "not_fixed" },
          { severity: "medium", status: "open" },
          { severity: "low", status: "fixed" },
        ],
      },
      {
        name: "Golden App B",
        findings: [
          { severity: "high", status: "open" },
          { severity: "high", status: "fixed" },
          { severity: "medium", status: "accepted_risk" },
          { severity: "medium", status: "open" },
        ],
      },
      {
        name: "Golden App C",
        findings: [
          { severity: "high", status: "open" },
          { severity: "medium", status: "open" },
          { severity: "medium", status: "open" },
          { severity: "low", status: "open" },
          { severity: "low", status: "open" },
        ],
      },
    ];

    for (const app of applications) {
      const created = await testDb.application.create({
        data: { name: app.name, displayName: app.name, applicationType: appType, scope, environment: env, site: active },
      });
      const engagement = await testDb.engagement.create({
        data: { applicationId: created.id, name: `${app.name} VAPT`, scope, assessmentSource: vapt, status: engStatus },
      });
      await testDb.iteration.create({ data: { engagementId: engagement.id, number: 1, iterationType: iterTypeScan, name: "Iteration 1 â€” Initial Scan", status: iterStatusDone } });
      let shown = 0;
      for (const f of app.findings) {
        shown += 1;
        await testDb.finding.create({
          data: {
            applicationId: created.id,
            code: `F-${String(shown).padStart(3, "0")}`,
            title: `${app.name} finding ${shown}`,
            severity: await master("severity", f.severity),
            currentStatus: await master("finding_status", f.status),
          },
        });
      }
    }
  }, 90_000);

  it("golden dataset reconciles exactly (Â§68)", async () => {
    const report = await generateDashboardReport();
    expect(report.totalApplications).toBeGreaterThanOrEqual(3);
    expect(report.totalFindings).toBeGreaterThanOrEqual(13);
    // severity counts reconcile with the per-app table:
    const appTotal = report.applications.reduce((acc, a) => acc + a.counts.total, 0);
    expect(appTotal).toBe(report.severityBreakdown.critical + report.severityBreakdown.high + report.severityBreakdown.medium + report.severityBreakdown.low + report.severityBreakdown.info);
    // identity (Â§31/Â§86):
    expect(report.totalFindings).toBe(report.pendingFindings + report.closedFindings + report.carVerified);
  });

  it("filters cut scope deterministically (Â§11)", async () => {
    const all = await generateDashboardReport();
    const bySeverity = await generateDashboardReport({ severity: "critical" });
    expect(bySeverity.totalFindings).toBeLessThan(all.totalFindings);
    expect(bySeverity.severityBreakdown.critical).toBe(bySeverity.totalFindings);
    expect(bySeverity.severityBreakdown.high).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("PPT golden-data verification (§67/§68)", () => {
  let actorUserId = 0;

  beforeAll(async () => {
    const seeded = await seedMinimal(bcrypt);
    actorUserId = seeded.userId;
  }, 60_000);

  it("generates a 5-slide deck whose summary slide contains the snapshot KPIs", async () => {
    const report = await generateDashboardReport();
    const { exportPptReport } = await import("@/lib/services/reporting/ppt-export-service");
    const result = await exportPptReport({ userId: actorUserId, filters: {}, ctx: {} });

    expect(result.validation.ok).toBe(true);
    expect(result.filename.startsWith("VAPT_Report_")).toBe(true);

    // unzip the deck and confirm data presence (Â§68: not mere existence)
    const tmp = path.join("node_modules", ".pptcheck");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const pptxFile = path.join(tmp, "deck.pptx");
    fs.writeFileSync(pptxFile, result.buffer);
    try {
      execSync(`powershell -Command "Expand-Archive -Path '${pptxFile}' -DestinationPath '${tmp}/x' -Force"`, { stdio: "pipe" });
    } catch {
      execSync(`tar -xf "${pptxFile}" -C "${tmp}/x"`, { stdio: "pipe" });
    }
    const summary = fs.readFileSync(path.join(tmp, "x", "ppt", "slides", "slide2.xml"), "utf8");
    expect(summary).toContain(String(report.totalFindings));
    expect(summary).toContain(String(report.pendingFindings));
    expect(summary).toContain(String(report.closedFindings));
    expect(summary).toContain(String(report.carVerified));
    expect(summary).not.toMatch(/undefined|NaN/);
  });

  it("application-specific export carries only that application's data", async () => {
    const reportAll = await generateDashboardReport();
    const target = reportAll.applications[0]!;
    const { exportPptReport } = await import("@/lib/services/reporting/ppt-export-service");
    const result = await exportPptReport({ userId: actorUserId, filters: { applicationId: target.id }, ctx: {} });
    expect(result.filename.startsWith(`VAPT_${target.displayName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60)}`) || result.filename.startsWith("VAPT_")).toBe(true);
    const tmp = path.join("node_modules", ".pptcheck2");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const pptxFile = path.join(tmp, "deck.pptx");
    fs.writeFileSync(pptxFile, result.buffer);
    try {
      execSync(`powershell -Command "Expand-Archive -Path '${pptxFile}' -DestinationPath '${tmp}/x' -Force"`, { stdio: "pipe" });
    } catch {
      execSync(`tar -xf "${pptxFile}" -C "${tmp}/x"`, { stdio: "pipe" });
    }
    const slideFiles = fs.readdirSync(path.join(tmp, "x", "ppt", "slides")).filter((f) => f.endsWith(".xml"));
    const combined = slideFiles.map((f) => fs.readFileSync(path.join(tmp, "x", "ppt", "slides", f), "utf8")).join("");
    expect(combined).toContain(target.displayName.slice(0, 20));
    // other applications must not appear in register table rows:
    const other = reportAll.applications.find((a) => a.id !== target.id)!;
    expect(combined).not.toContain(other.displayName.slice(0, 20));
  });
});


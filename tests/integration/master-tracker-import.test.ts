/**
 * Phase M2 — master multi-app tracker import ("PT Tracker 26-27.xlsx").
 * Covers: header/band detection, dd/mm/yyyy + Date cell parsing, grand-total
 * row skip, invalid-matrix guard (Akasa-Inflight-style junk), per-severity CAR
 * reconstruction, engagement/iteration fill-fill-empty behavior, contacts,
 * placeholder findings, sha256 idempotency and the snapshot marker guard.
 */
import ExcelJS from "exceljs";
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import { parseMasterTrackerWorkbook, type MasterTrackerParseResult } from "@/lib/excel/master-tracker-parser";

const HEADERS = [
  "S.no", "Application", "Internal / External", "Web URL/API/FQDN", "Mail Subject", "Type", "Source / tool",
  "POC Akasa Air", "Digialert Team - Assigned member", "Overall Status", "Total Vuln Count", "Scan/Report Date",
  "Requested date", "iteration - 1 Date", "Iteration - 1 Status", "Iteration-2 Date ", "Iteration - 2 Status",
  "Comments", "Follow-up", "Follow-up Response", "Critical ", "High ", "Medium ", "Low", "Info ",
  "CAR", "Total", "Pending", "Vulnerabilities  Closed",
];

function buildMasterWorkbook(): Promise<Buffer> {
  const build = async (): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("VAPT tracker");
  // band row: title + severity band over the Open/Closed matrix
  const band: (string | number)[] = ["Akasa Air VAPT Tracker 2026"];
  ws.addRow(band);
  for (let c = 31; c <= 40; c++) ws.getRow(1).getCell(c).value = ["Critical", "Critical", "High", "High", "Medium", "Medium", "Low", "Low", "Info", "Info"][c - 31]!;
  // header row
  const header: (string | number)[] = [];
  for (let i = 0; i < 40; i++) header.push(HEADERS[i] ?? "");
  header[30] = "Open"; header[31] = "Closed"; header[32] = "Open"; header[33] = "Closed";
  header[34] = "Open"; header[35] = "Closed"; header[36] = "Open"; header[37] = "Closed";
  header[38] = "Open"; header[39] = "Closed";
  ws.addRow(header);
  // row 3 — full data row (Akasa Air Ecommerce - PROD-like):
  // totals crit2/hi1/med4/low2/info1 = 10; open: med1; closed: crit2 hi1 med1 low2; CAR → med2 info1 (recon=3)
  ws.addRow([
    1, "Volody Contracts (Black Box Testing)", "External", "https://contracts.qp.akasaair.com", "URGENT : Suspected open secrets", "Web", "Manual Testing / Burp",
    "Hemal Dodhia - Volody", "Vineet ", "Completed", 3, "19/6/2026", "17/6/2026", "19/6/2026", "Completed", "19/6/2026", "Completed",
    "Summary of contracts.akasaair.com (Production Environment)", "20/7/2026", "We sent the summary.", 3, 0, 0, 0, 0, 0, 3, 0, 3,
    "", "", "", "", "", "", "", "", "", "",
  ]);
  for (let c = 31; c <= 40; c++) ws.getRow(3).getCell(c).value = [0, 3, 0, 0, 0, 0, 0, 0, 0, 0][c - 31]!;
  // row 4 — mixed-type date cells (Date objects for scanned columns)
  ws.addRow([
    2, "MyFlights Web", "Internal", "https://myflights.akasaair.com", "Web VAPT for MyFlights", "Web", "AI Assisted",
    "Ramesh Ganji / Amar Nath", "Vineet / Niranjena", "In Progress", 10, new Date(Date.UTC(2026, 2, 24)), "16/2/2026", "24/3/2026", "Completed", "Pending", "In Progress",
    "Iteration-1 completed with 10 findings.", "18/9/2026", "Validation confirmed Fixed.", 3, 2, 2, 3, 0, 0, 10, 7, 3,
  ]);
  for (let c = 31; c <= 40; c++) ws.getRow(4).getCell(c).value = [1, 2, 2, 0, 1, 1, 3, 0, 0, 0][c - 31]!;
  // row 5 — grand-total band (no S.no) — must be skipped
  ws.addRow(["", "TOTAL ROW", "", "", "", "", "", "", "", "", 227, "", "", "", "", "", "", "", "", "", 44, 62, 63, 52, 2, 7, 227, 103, 113]);
  // row 6 — junk matrix above declared total (Akasa Inflight-style) → matrix ignored, 0 vulns
  ws.addRow([
    3, "Import Master App X", "Internal", "", "Request for VAPT Testing", "Mobile Application", "VAPT",
    "Mohsin Chunawala", "Vineet ", "Initiated / Walkthrough Pending", 0, new Date(Date.UTC(2026, 9, 8)), "10/8/2026", "", "", "", "",
    "", "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  for (let c = 31; c <= 40; c++) ws.getRow(6).getCell(c).value = [12, 32, 33, 29, 30, 28, 28, 24, 0, 0][c - 31]!;
  const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as unknown as ArrayBuffer);
  };
  return build();
}

function q(domain: string, value: string) {
  return testDb.masterValue.findUniqueOrThrow({ where: { domain_value: { domain, value } } }).then((x) => x.id);
}

describe.skipIf(!dbAvailable)("Master tracker import (Phase M2)", () => {
  let userId = 0;
  let appId1 = 0; // exact registered name for test 1
  let appId2 = 0; // normalization-variant app

  let sharedWorkbook: Buffer;

  beforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
    appId1 = (await testDb.application.create({
      data: {
        name: "MyFlights Web", displayName: "MyFlights Web",
        applicationType: await q("application_type", "web"), scope: await q("scope", "internal"),
        environment: await q("environment", "prod"), site: await q("application_status", "active"),
      },
    })).id;
    appId2 = (await testDb.application.create({
      data: {
        name: "Volody Contracts (Black Box Testing)", displayName: "Volody Contracts Application",
        applicationType: await q("application_type", "web"), scope: await q("scope", "external"),
        environment: await q("environment", "prod"), site: await q("application_status", "active"),
      },
    })).id;
  }, 60_000);

  let parsed: MasterTrackerParseResult;
  beforeAll(async () => {
    sharedWorkbook = await buildMasterWorkbook();
    parsed = await parseMasterTrackerWorkbook(sharedWorkbook);
  });

  it("parser: headers, date types, totals, matrix junk and total-row skip", async () => {
    expect(parsed.sheetName).toBe("VAPT tracker");
    expect(parsed.rows.length).toBe(3); // total band skipped
    const row1 = parsed.rows[0]!;
    expect(row1.application).toBe("Volody Contracts (Black Box Testing)");
    expect(row1.sNo).toBe(1);
    expect(row1.total).toBe(3);
    expect(row1.openBySeverity.critical).toBe(0);
    expect(row1.closedBySeverity.critical).toBe(3);
    expect(row1.car).toBe(0);
    expect(row1.carBySeverity.critical).toBe(0);
    expect(new Date(row1.scanDate!.getTime()).toDateString()).toBe(new Date(2026, 5, 19).toDateString());
    expect(row1.iteration2Date).not.toBeNull();
    expect(row1.iteration2Status).toBe("Completed");
    expect(row1.followUpDate).not.toBeNull();
    expect(row1.followUpResponse).toBe("We sent the summary.");

    const row2 = parsed.rows[1]!;
    expect(row2.application).toBe("MyFlights Web");
    expect(row2.openBySeverity).toEqual({ critical: 1, high: 2, medium: 1, low: 3, info: 0 });
    expect(row2.closedBySeverity.critical).toBe(2);
    expect(row2.iteration2Date).toBeNull(); // "Pending" string
    expect(row2.iteration2Status).toBe("In Progress");
    expect(row2.carBySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });

    const row3 = parsed.rows[2]!;
    expect(row3.application).toBe("Import Master App X");
    expect(row3.total).toBe(0);
    // junk matrix exceeds declared total → all zeros + warning
    expect(Object.values(row3.openBySeverity).every((v) => v === 0)).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("Import Master App X"))).toBe(true);
  });

  it("service: engagement + iterations + contacts + placeholder findings", async () => {
    const svc = await import("@/lib/services/master-tracker-import-service");
    const result = await svc.importMasterTrackerWorkbook(
      { fileContent: sharedWorkbook, options: { fileName: "master.xlsx", countsMode: "placeholder_findings" } },
      userId,
      {},
    );
    expect(result.applicationsMatched).toBe(2);
    expect(result.findingsCreated).toBe(13); // row1: 3 fixed; row2: 7 open + 3 fixed (crit2 + med1)
    expect(result.skipped.length).toBe(1); // "Import Master App X" has no registry row

    const eng1 = await testDb.engagement.findFirst({ where: { applicationId: appId1 }, include: { statusRef: true, sourceRef: true, iterations: { orderBy: { number: "asc" }, include: { statusRef: true } } } });
    expect(eng1?.statusRef.value).toBe("in_progress");
    expect(eng1?.sourceRef.value).toBe("ai_assisted");
    expect(eng1?.mailSubject).toBe("Web VAPT for MyFlights");
    expect(eng1?.reportDate ? eng1.reportDate.toISOString().slice(0, 10) : null).toBe("2026-03-24");
    expect(eng1?.requestedDate && eng1.requestedDate.toDateString()).toBe(new Date(2026, 1, 16).toDateString());
    expect(eng1?.followUpDate && eng1.followUpDate.toDateString()).toBe(new Date(2026, 8, 18).toDateString());
    expect(eng1?.notes).toContain("Iteration-1 completed with 10 findings.");
    const i1 = eng1?.iterations.find((x) => x.number === 1);
    const i2 = eng1?.iterations.find((x) => x.number === 2);
    expect(i1?.startDate && i1.startDate.toDateString()).toBe(new Date(2026, 2, 24).toDateString());
    expect(i2?.statusRef.value).toBe("in_progress");

    const app1Findings = await testDb.finding.findMany({
      where: { applicationId: appId1 },
      select: { statusRef: { select: { value: true } } },
    });
    const l = (s: string) => app1Findings.filter((f) => f.statusRef.value === s).length;
    expect(l("open")).toBe(7);
    expect(l("fixed")).toBe(3);
    expect(l("accepted_risk")).toBe(0);

    // app 1 (Volody) — all closed, 3 findings + status completed
    const eng2 = await testDb.engagement.findFirst({ where: { applicationId: appId2 }, include: { statusRef: true, sourceRef: true } });
    // status update rule: only auto-provisioned default is replaced — 'completed' ⇒ stays in_progress? no:
    // new engagement created here carries the master's value in creation data.
    expect(eng2?.statusRef.value).toBe("completed");
    expect(eng2?.sourceRef.value).toBe("manual_burp");

    const app1 = await testDb.application.findUnique({ where: { id: appId1 }, include: { primaryPoc: true, assignedMembers: { include: { contact: true } } } });
    expect(app1?.primaryPocId).not.toBeNull();
    expect(app1?.primaryPoc?.fullName).toBe("Ramesh Ganji");
    const assigned = app1?.assignedMembers.map((m) => m.contact.fullName).sort();
    expect(assigned).toEqual(["Niranjena", "Vineet"]);

    // I1 states exist for open+fixed, none for accepted_risk
    const carCount = await testDb.finding.count({ where: { applicationId: appId1, statusRef: { value: "accepted_risk" } } });
    expect(carCount).toBe(0);
  });

  it("sha256 idempotency rejects the exact same workbook", async () => {
    const svc = await import("@/lib/services/master-tracker-import-service");
    expect(svc).toBeTruthy();
    await expect(svc.importMasterTrackerWorkbook(
      { fileContent: sharedWorkbook, options: { fileName: "master.xlsx", countsMode: "skip_counts" } },
      userId,
      {},
    )).rejects.toThrow(/already imported/i);
  });

  it("snapshot marker guard: a NEW workbook's counts are skipped when placeholders exist", async () => {
    const svc = await import("@/lib/services/master-tracker-import-service");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("VAPT tracker");
    const rows = [
      ["Akasa Air VAPT Tracker 2026", ...Array.from({ length: 30 }, () => "")],
    ] as unknown as (string | number)[][];
    ws.addRow(rows[0]!);
    for (let c = 31; c <= 40; c++) ws.getRow(1).getCell(c).value = ["Critical", "Critical", "High", "High", "Medium", "Medium", "Low", "Low", "Info", "Info"][c - 31]!;
    const header: (string | number)[] = HEADERS.slice(0, 29);
    while (header.length < 30) header.push("");
    header[30] = "Open"; header[31] = "Closed"; header[32] = "Open"; header[33] = "Closed";
    header[34] = "Open"; header[35] = "Closed"; header[36] = "Open"; header[37] = "Closed";
    header[38] = "Open"; header[39] = "Closed";
    ws.addRow(header);
    ws.addRow([1, "MyFlights Web", "Internal", "", "subject", "Web", "VAPT", "POC1", "Vineet", "In Progress", 2, "1/2/2026", "1/2/2026", "1/2/2026", "Completed", "Pending", "In Progress", "c", "1/2/2026", "resp", 2, 0, 0, 0, 0, 0, 2, 2, 0]);
    for (let c = 31; c <= 40; c++) ws.getRow(3).getCell(c).value = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0][c - 31]!;

    const result = await svc.importMasterTrackerWorkbook(
      { fileContent: Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer), options: { fileName: "master-v2.xlsx", countsMode: "placeholder_findings" } },
      userId,
      {},
    );
    expect(result.findingsCreated).toBe(0);
    expect(result.warnings.some((w) => w.includes("MyFlights Web"))).toBe(true);
  });
});

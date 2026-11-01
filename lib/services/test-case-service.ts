/**
 * Test case service (brief sections 20-22, 60).
 * Removed test cases stay in the database (isActive=false); their iteration
 * states record what happened in each iteration.
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export interface CreateTestCaseInput {
  applicationId: number;
  code?: string;
  title: string;
  description?: string | null;
  category?: string | null;
  statusValue: "included" | "not_tested" | "passed" | "failed" | "removed" | "not_retested" | "out_of_scope" | "not_applicable" | "unknown";
}

export async function createTestCase(input: CreateTestCaseInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const app = await prisma.application.findUnique({ where: { id: input.applicationId } });
  if (!app) throw NotFoundError("Application");

  const status = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "test_case_status", value: input.statusValue } },
  });
  if (!status) throw ValidationError("Unknown test case status.");

  let code = input.code?.trim();
  if (code) {
    const dup = await prisma.testCase.findUnique({ where: { applicationId_code: { applicationId: app.id, code } } });
    if (dup) throw ConflictError(`Test case code ${code} already exists for this application.`);
  } else {
    const count = await prisma.testCase.count({ where: { applicationId: app.id } });
    let attempt = count + 1;
    for (;;) {
      const candidate = `TC-${String(attempt).padStart(3, "0")}`;
      const exists = await prisma.testCase.findUnique({ where: { applicationId_code: { applicationId: app.id, code: candidate } } });
      if (!exists) {
        code = candidate;
        break;
      }
      attempt += 1;
    }
  }

  const row = await prisma.testCase.create({
    data: {
      applicationId: app.id,
      code: code!,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      currentStatus: status.id,
    },
  });

  await recordAudit({
    action: "test_case.create",
    entityType: "TestCase",
    entityId: row.id,
    newValue: JSON.stringify({ applicationId: app.id, code: row.code, title: row.title }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return row;
}

export interface SetTestCaseIterationStateInput {
  testCaseId: number;
  iterationId: number;
  statusValue: "included" | "not_tested" | "passed" | "failed" | "removed" | "out_of_scope" | "not_applicable" | "not_retested" | "unknown";
  notes?: string | null;
}

/**
 * Preserves history: TC-001 present in Iteration 1 but missing from Iteration 2
 * is recorded as `removed`/"not_retested" in Iteration 2 — never deleted
 * (brief section 22).
 */
export async function setTestCaseIterationState(input: SetTestCaseIterationStateInput, actorUserId: number | null, ctx: { source: "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM"; label?: string; ip?: string; userAgent?: string }) {
  const testCase = await prisma.testCase.findUnique({ where: { id: input.testCaseId } });
  if (!testCase) throw NotFoundError("Test case");
  const iteration = await prisma.iteration.findUnique({ where: { id: input.iterationId } });
  if (!iteration) throw NotFoundError("Iteration");

  const status = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "test_case_status", value: input.statusValue } },
  });
  if (!status) throw ValidationError("Unknown test case status.");

  const existing = await prisma.testCaseIteration.findUnique({
    where: { testCaseId_iterationId: { testCaseId: testCase.id, iterationId: iteration.id } },
  });

  const row = existing
    ? await prisma.testCaseIteration.update({
        where: { id: existing.id },
        data: { status: status.id, notes: input.notes ?? existing.notes },
      })
    : await prisma.testCaseIteration.create({
        data: {
          testCaseId: testCase.id,
          iterationId: iteration.id,
          status: status.id,
          notes: input.notes ?? null,
        },
      });

  // Keep the test case surface status pointing at its latest iteration state.
  const latestIteration = await prisma.iteration.findFirst({
    where: { engagementId: iteration.engagementId },
    orderBy: { number: "desc" },
  });
  if (latestIteration?.id === iteration.id && testCase.currentStatus !== status.id) {
    await prisma.testCase.update({ where: { id: testCase.id }, data: { currentStatus: status.id } });
  }
  if (input.statusValue === "removed" || input.statusValue === "out_of_scope") {
    await prisma.testCase.update({ where: { id: testCase.id }, data: { isActive: false } });
  }

  await recordAudit({
    action: "test_case.iteration_state.set",
    entityType: "TestCase",
    entityId: testCase.id,
    fieldName: `iteration:${iteration.number}`,
    oldValue: null, // previous state readable from test_case_iterations rows
    newValue: status.value,
    source: ctx.source,
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return row;
}

export async function listTestCases(applicationId: number) {
  const rows = await prisma.testCase.findMany({
    where: { applicationId },
    orderBy: [{ code: "asc" }],
    include: {
      statusRef: true,
      iterations: { include: { statusRef: true, iteration: { select: { number: true } } }, orderBy: { iterationId: "asc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    category: r.category,
    isActive: r.isActive,
    currentStatus: { value: r.statusRef.value, label: r.statusRef.label },
    iterations: r.iterations.map((i) => ({
      id: i.id,
      iterationNumber: i.iteration.number,
      status: { value: i.statusRef.value, label: i.statusRef.label },
      notes: i.notes,
    })),
  }));
}

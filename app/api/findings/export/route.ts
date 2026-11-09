import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { exportFindingsWorkbook } from "@/lib/excel/findings-export-service";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * POST /api/findings/export — Master Summary + per-application Iteration 1/2
 * side-by-side workbook. The live tracker export remains unchanged.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const result = await exportFindingsWorkbook();
    const completed = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "completed" } } });
    if (completed) {
      const job = await prisma.exportJob.create({
        data: {
          filename: result.filename,
          target: "xlsx-findings",
          params: { applications: result.rows },
          status: completed.id,
          rowsProcessed: result.rows,
          createdByUserId: Number(session.sub),
        },
      });
      await recordAudit({
        action: "findings_excel_export.completed",
        entityType: "ExportJob",
        entityId: job.id,
        newValue: JSON.stringify({ filename: result.filename, applications: result.rows }),
        source: "HUMAN",
        actorUserId: Number(session.sub),
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
    }
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Iteration resolution (Phase 6 §7-§8): deterministic, explainable assignment
 * of communications to iterations. Precedence: explicit statement → thread /
 * app context → finding & test-case history → AI signal → human correction.
 */
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

export interface IterationResolution {
  iterationId: number | null;
  iterationNumber: number | null;
  method: "EXPLICIT" | "THREAD_CONTEXT" | "HISTORY_INFER" | "AI_SIGNAL" | "UNRESOLVED";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
}

export function extractExplicitIteration(text: string): { number: number | null; kind: string | null; quote: string | null } {
  const lower = text.toLowerCase();
  const numMatch = /iteration\s*(\d+)/i.exec(text);
  if (numMatch) return { number: Number(numMatch[1]), kind: "iteration-N", quote: numMatch[0] };
  const roundMatch = /(?:round|second round|re-?test)\s*(\d+)?/i.exec(text);
  if (roundMatch) {
    const n = roundMatch[1] ? Number(roundMatch[1]) : null;
    return { number: n ? n + 1 : null, kind: "retest-suffix", quote: roundMatch[0] };
  }
  if (/follow-?up retest/i.test(lower)) return { number: null, kind: "follow_up", quote: (lower.match(/follow-?up retest/i) as RegExpMatchArray)[0] };
  if (/\bre-?test\b/i.test(lower)) return { number: null, kind: "retest", quote: RETEST_QUOTE(text) };
  return { number: null, kind: null, quote: null };
}

function RETEST_QUOTE(text: string): string {
  const m2 = /\bre-?test\b/i.exec(text);
  return m2 ? (m2 as RegExpMatchArray)[0] : "retest";
}

/**
 * Resolve the iteration for a communication (message text + known thread).
 * §37: when nothing determines confidently, return UNRESOLVED — review UI
 * lets the user assign it manually; nothing is silently decided.
 */
export async function resolveIteration(input: {
  messageText: string | null;
  threadApplicationId: number | null;
  threadSubjectHash: string;
  aiCandidate?: { number: number | null; explicitOrInferred: string } | null;
}): Promise<IterationResolution> {
  // 1) explicit statement (§7.1)
  const explicit = input.messageText ? extractExplicitIteration(input.messageText) : null;
  if (explicit?.number || explicit?.kind === "follow_up") {
    const number = explicit.number ?? (await nextIterationNumber(input.threadApplicationId)) ?? 2;
    const it = await findOrCreateUnder(number, input.threadApplicationId);
    return { iterationId: it?.id ?? null, iterationNumber: it?.number ?? number, method: "EXPLICIT", confidence: "HIGH", evidence: explicit.quote ?? "" };
  }

  // 2) thread/app context (§7.2): only applies when the communication relates to
  // known VAPT work (finding/retest/fix language). A generic message on an app
  // with existing iterations is NOT silent evidence (§37 ambiguous → unresolved).
  if (input.threadApplicationId) {
    const relatesToWork = /findings?|re-?test|vulnerab|fixed|test case|report/i.test(input.messageText ?? "");
    if (relatesToWork) {
      const latest = await latestIterationForApplication(input.threadApplicationId);
      if (latest) {
        return { iterationId: latest.id, iterationNumber: latest.number, method: "HISTORY_INFER", confidence: "MEDIUM", evidence: `application's latest iteration: I${latest.number}` };
      }
    }
  }

  // 5) AI signal (least authority) — only explicit AI claims qualify (§24)
  if (input.aiCandidate && input.aiCandidate.explicitOrInferred === "EXPLICIT" && input.aiCandidate.number) {
    const it = await findIterationByNumber(input.aiCandidate.number, input.threadApplicationId);
    return { iterationId: it?.id ?? null, iterationNumber: it?.number ?? input.aiCandidate.number, method: "AI_SIGNAL", confidence: "LOW", evidence: "explicit AI iteration signal (requires human review)" };
  }

  return { iterationId: null, iterationNumber: null, method: "UNRESOLVED", confidence: "LOW", evidence: "no reliable iteration evidence" };
}

async function findOrCreateUnder(number: number, applicationId: number | null) {
  if (!applicationId) return null;
  const engagement = await prisma.engagement.findFirst({ where: { applicationId }, orderBy: { id: "asc" } });
  if (!engagement) return null;
  const existing = await prisma.iteration.findUnique({ where: { engagementId_number: { engagementId: engagement.id, number } } });
  if (existing) return existing;
  return null; // never silently create an iteration here — that happens through explicit create/createIteration flows
}

async function nextIterationNumber(applicationId: number | null): Promise<number | null> {
  if (!applicationId) return null;
  const latest = await latestIterationForApplication(applicationId);
  return latest ? latest.number + 1 : 1;
}

async function latestIterationForApplication(applicationId: number | null) {
  if (!applicationId) return null;
  const it = await prisma.iteration.findFirst({
    where: { engagement: { applicationId } },
    orderBy: { number: "desc" },
    select: { id: true, number: true },
  });
  return it;
}

async function findIterationByNumber(number: number, applicationId: number | null) {
  if (!applicationId) return null;
  return prisma.iteration.findFirst({
    where: { engagement: { applicationId }, number },
    select: { id: true, number: true },
  });
}

export async function requireIterationsForApplication(applicationId: number): Promise<{ number: number; id: number }[]> {
  if (!Number.isInteger(applicationId) || applicationId <= 0) throw ValidationError("Invalid application id.");
  const rows = await prisma.iteration.findMany({ where: { engagement: { applicationId } }, orderBy: { number: "asc" }, select: { id: true, number: true } });
  return rows;
}

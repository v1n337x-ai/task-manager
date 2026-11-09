/**
 * Analysis prompt builder (Phase 5.1) — the DETERMINISTIC instruction block
 * handed to provider ports. Prompt text is versioned via PROMPT_VERSION and
 * must remain structurally in sync with lib/ai/schema.ts (AI_EXTRACTION_V1).
 * The context is serialized exactly as hashed by lib/ai/context.ts, so a
 * changed thread always produces a new inputContextHash (§49).
 */
import type { AiAnalyzeContextInput } from "./providers";

const SCHEMA_INSTRUCTIONS = `You are the deterministic extraction engine of an internal VAPT management platform (Task Manager "Task Manager"). You analyze a VULNERABILITY-ASSESSMENT EMAIL THREAD and return a single JSON object, nothing else.

OUTPUT RULES (absolute):
1. Respond with EXACTLY ONE JSON object conforming to AI_EXTRACTION_V1. No markdown, no prose before or after, no JSON fences.
2. NEVER invent data. Every candidate value must be traceable to a message in the provided context. Unknown values stay null ONLY for fields described as "string|null" or "@>=1|null"; REQUIRED fields (threadSummary, at least 1 participant, every findings[].title, every findings[].evidence, top-level evidence) must NEVER be null, missing, or empty — when nothing concrete applies, write a neutral 1-2 sentence factual value (e.g., "This thread contains no explicit vulnerability discussion; it is recorded for completeness.").
3. Every evidence item references the analyzed context: "messageIndex" is the "index" field of a message in the provided context JSON (0-based), and "excerpt" MUST be a VERBATIM substring (min 3 chars) copied from that message's "bodyText" (never paraphrased, never fabricated).
4. "identifierExplicit" ("F-001"/"TC-004" style application finding codes) is ONLY populated when the code literally appears in a message; otherwise null with IDENTIFIER_NOT_EXPLICIT.
5. Never claim that any state has been applied. You only extract candidates; a human reviewer approves or rejects every item.

JSON SHAPE (AI_EXTRACTION_V1):
{
  "schemaVersion": "AI_EXTRACTION_V1",
  "threadSummary": string (10-4000 chars; neutral factual summary),
  "participants": [ { "email": string, "name": string|null, "proposedRole": "pentester"|"developer"|"application_owner"|"security_team"|"management"|"other"|"unknown", "roleBasis": "EXPLICIT"|"INFERRED", "confidence": "HIGH"|"MEDIUM"|"LOW", "score": number 0..1, "evidence": [evidence] } ] (min 1),
  "findings": [ { "identifierExplicit": string|null, "identifierMark": "IDENTIFIER_EXPLICIT"|"IDENTIFIER_NOT_EXPLICIT", "title": string (3-300), "titleMark": "EXPLICIT"|"AI_PROPOSED", "severity": "critical"|"high"|"medium"|"low"|"info"|"unknown", "severityMark": "EXPLICIT"|"INFERRED", "description": string|null (max 4000), "recommendation": string|null (max 2000), "relatedTestCaseRefs": string[] (max 10), "iterationSignal": integer>=1|null, "iterationSignalExplicit": boolean, "statusSignal": "fixed"|"not_fixed"|"open"|"reopened"|"retested"|"not_retested"|"removed"|"out_of_scope"|null, "isNewFindingCandidate": boolean, "evidence": [evidence] } ] (max 50),
  "testCases": [ { "identifierExplicit": string|null, "identifierMark": as above, "title": string (max 300), "titleMark": "EXPLICIT"|"AI_PROPOSED", "stateSignal": statusSignal|null, "stateSignalExplicit": boolean, "evidence": [evidence] } ] (max 50),
  "iterationSignals": [ { "candidateIteration": integer>=1|null, "typeSignal": "initial_scan"|"retest"|"follow_up"|"other"|null, "explicitOrInferred": "EXPLICIT"|"INFERRED", "confidence": "HIGH"|"MEDIUM"|"LOW", "evidence": [evidence] } ] (max 20),
  "evidence": [evidence] (min 1)
}
evidence = { "messageIndex": integer, "excerpt": string (3-1500, verbatim), "confidence": "HIGH"|"MEDIUM"|"LOW", "score": number 0..1 (optional) }

SEMANTICS:
- Only emit a finding when the thread actually discusses a concrete issue or explicitly references application finding codes. Status statements ("has been fixed", "still vulnerable") become statusSignal "fixed"/"not_fixed".
- findings may be EMPTY. A remediation follow-up, status/fix request, or aggregate report thread that does not name individual vulnerabilities must return findings: [] — do not turn "reported findings", "test cases awaiting fixation", or "pending remediation" into a pseudo-finding.
- A finding candidate is valid only when the quoted evidence names a concrete, individual vulnerability. Its severity must be explicitly stated; if severity is unknown, omit the finding rather than inferring it.
- Never use remediation/status summaries as finding titles (for example: "reported VAPT findings pending remediation", "fix for finding #2 confirmed complete", or "finding fix pending").
- Retest mentions ("iteration 2", "retest", "retested") populate iterationSignals; infer the iteration number only when it is consistent with the thread.
- applications context (existing findings/test cases) is for CODE RESOLUTION only — never reinterpret it as a status statement.`;

export function buildExtractionPrompt(context: AiAnalyzeContextInput, feedback?: string | null): string {
  const contextJson = JSON.stringify(context);
  const feedbackBlock = feedback && feedback.trim().length > 0
    ? `\n\nLEARNED FEEDBACK (from past human review — apply these rules to avoid repeating mistakes):\n${feedback.trim()}\n`
    : "";
  return `${SCHEMA_INSTRUCTIONS}${feedbackBlock}\n\nANALYZED CONTEXT (single JSON object; the ONLY source of truth for this extraction):\n${contextJson}\n\nReturn the AI_EXTRACTION_V1 JSON object now.`;
}

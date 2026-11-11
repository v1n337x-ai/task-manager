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
  "findings": [ { "identifierExplicit": string|null, "identifierMark": "IDENTIFIER_EXPLICIT"|"IDENTIFIER_NOT_EXPLICIT", "title": string (3-300), "titleMark": "EXPLICIT"|"AI_PROPOSED", "severity": "critical"|"high"|"medium"|"low"|"info"|"unknown", "severityMark": "EXPLICIT"|"INFERRED", "description": string|null (max 4000), "recommendation": string|null (max 2000), "relatedTestCaseRefs": string[] (max 10), "iterationSignal": integer>=1|null, "iterationSignalExplicit": boolean, "statusSignal": "fixed"|"not_fixed"|"open"|"reopened"|"retested"|"not_retested"|"removed"|"out_of_scope"|"accepted_risk"|null, "isNewFindingCandidate": boolean, "evidence": [evidence] } ] (max 50),
  "testCases": [ { "identifierExplicit": string|null, "identifierMark": as above, "title": string (max 300), "titleMark": "EXPLICIT"|"AI_PROPOSED", "stateSignal": statusSignal|null, "stateSignalExplicit": boolean, "evidence": [evidence] } ] (max 50),
  "iterationSignals": [ { "candidateIteration": integer>=1|null, "typeSignal": "initial_scan"|"retest"|"follow_up"|"other"|null, "explicitOrInferred": "EXPLICIT"|"INFERRED", "confidence": "HIGH"|"MEDIUM"|"LOW", "evidence": [evidence] } ] (max 20),
  "engagementRecord": { "mailSubject": string|null (max 300), "requestedDate": string|null, "scanReportDate": string|null, "iteration1Date": string|null, "iteration2Date": string|null, "comments": string|null (max 2000), "followUpDate": string|null, "followUpResponse": string|null (max 1000), "primaryPoc": string|null (max 120, person NAME), "assignedMembers": string|null (max 300, comma/slash-separated person NAMES), "evidence": [evidence] } | null,
  "evidence": [evidence] (min 1)
}
evidence = { "messageIndex": integer, "excerpt": string (3-1500, verbatim), "confidence": "HIGH"|"MEDIUM"|"LOW", "score": number 0..1 (optional) }

SEMANTICS:
- Only emit a finding when the thread actually discusses a concrete issue or explicitly references application finding codes. Status statements become statusSignal exactly, mapped: "has been fixed" → "fixed"; "still vulnerable"/"not fixed"/"reopened" → "not_fixed"; "accepted"/"accepted risk"/"risk accepted"/"CAR"/"closed as accepted" → "accepted_risk"; "gone"/"removed"/"out of scope" → "removed"; explicit "pending"/"will re-verify later" → "not_retested"; explicit "awaiting fix" or "open" → "open".
- CISO / sign-off language is a STATUS context, not a pseudo-finding: "sign-off approved", "sign-off given", "testing is signed off", "VAPT completed" alone must NEVER create a finding — they only matter when paired with a concrete vulnerability name, in which case they supply the statusSignal for that finding (sign-off of an unremediated finding means "not_fixed" unless the thread says otherwise; if the sign-off thread affirms closure, use "fixed"; if it states documented risk acceptance, use "accepted_risk").
- When a finding is FIRST REPORTED in this thread (new vulnerability being reported now, not previously tracked), set isNewFindingCandidate=true and, if the thread's own words indicate the current state, set statusSignal accordingly; when the report itself carries no verdict yet, statusSignal stays null and the human reviewer will pick one at approval time.
- findings may be EMPTY. A remediation follow-up, status/fix request, or aggregate report thread that does not name individual vulnerabilities must return findings: [] — do not turn "reported findings", "test cases awaiting fixation", or "pending remediation" into a pseudo-finding.
- A finding candidate is valid only when the quoted evidence names a concrete, individual vulnerability. Its severity must be explicitly stated; if severity is unknown, omit the finding rather than inferring it.
- Never use remediation/status summaries as finding titles (for example: "reported VAPT findings pending remediation", "fix for finding #2 confirmed complete", or "finding fix pending").
- Retest mentions ("iteration 2", "retest", "retested") populate iterationSignals; infer the iteration number only when it is consistent with the thread.
- SUMMARY TABLES: some messages carry a "summaryTable" digest — one line per reported finding ("#no | title | severity | status/comments"). These rows are the thread's authoritative findings report. Emit ONE finding candidate per row (verbatim title, the row's severity; the row's status/comment text becomes the statusSignal when it states one, e.g. "fixed"/"not fixed"/"accepted"). Rows whose comment text only discusses the issue without a verdict keep statusSignal null. Every candidate must quote the message that carries the table as its evidence.
- ENGAGEMENT RECORD: derive the application-record fields when the thread states them, quoting the exact message for each: "mailSubject" = the ORIGINAL initiating mail subject (the first message's Subject, not a "Re:" variant) when the thread shows it; "requestedDate" = the date testing was requested (earliest relevant mail date); "scanReportDate" = the scan/report date when stated (e.g. "PFA summary" mail date or an explicit date); "iteration1Date"/"iteration2Date" = iteration-1/iteration-2 report dates when stated; "comments" = a concise factual status line for the tracker Comments column (e.g. "Iteration-2 validation completed; one High finding remained open"); "followUpDate" = the date of the latest chase/reminder mail; "followUpResponse" = a one-line summary of the latest vendor/owner response about remediation; "primaryPoc" = the client-side point of contact NAME; "assignedMembers" = the assessment-side tester NAME(S). Use null for anything the thread does not state — never guess dates or people. Names must be real person names from the thread, not mail addresses.
- applications context (existing findings/test cases) is for CODE RESOLUTION only — never reinterpret it as a status statement.`;

export function buildExtractionPrompt(context: AiAnalyzeContextInput, feedback?: string | null): string {
  const contextJson = JSON.stringify(context);
  const feedbackBlock = feedback && feedback.trim().length > 0
    ? `\n\nLEARNED FEEDBACK (from past human review — apply these rules to avoid repeating mistakes):\n${feedback.trim()}\n`
    : "";
  return `${SCHEMA_INSTRUCTIONS}${feedbackBlock}\n\nANALYZED CONTEXT (single JSON object; the ONLY source of truth for this extraction):\n${contextJson}\n\nReturn the AI_EXTRACTION_V1 JSON object now.`;
}

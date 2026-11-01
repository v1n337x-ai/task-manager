# AI Analysis (Phase 5)

Thread-level AI analysis over the normalized Phase 4 email graph.

## Flow

```
Analyze Thread (explicit user click)
  → Load thread/application/[/findings/test-cases] context
  → Deterministic context build (chronological, capped, hash-stamped)
  → Provider port
  → Structured AI_EXTRACTION_V1 output
  → Zod validation  (§51)
  → AIExtraction row  (provider/model/schema/prompt/context-hash/duration)
  → AiEvidence rows   (minimal excerpts, linked to REAL messages)
  → needs_review      (human review)
```

## Honest provider gating (§6/§50)

- `opencode` is configured in Settings but has **no implemented API contract** in this build; its port raises an honest *"contract unavailable"* error and a failed extraction row records it. No fake analysis is ever simulated.
- The `mock` provider is a deterministic keyword-based extractor usable **only outside production** — created for §79 tests. Its output passes the same Zod contract.

## Structured contract (§11-§12/§47)

`AI_EXTRACTION_V1`: threadSummary · participants (role + basis EXPLICIT/INFERRED + confidence + evidence) · findings (identifier EXPLICIT/NOT_EXPLICIT, title EXPLICIT/AI_PROPOSED, severity EXPLICIT/INFERRED, status signal) · testCases · iterationSignals · evidence. All schema changes ⇒ a new version (`AI_EXTRACTION_V2`), never a silent change.

## No mutation (§58)

The analysis service NEVER writes findings/test-cases/iterations — it creates one `aiExtraction` run + evidence. Contradictory statements (developer "fixed" then pentester "not fixed") both persist as separate evidence-backed signals (§28).

## Review (§39-§44, §67-§76)

Item-level rows in `ai_approval_decisions` keyed `extractionId + itemKey` (`participantRole:<email>`, `findingStatus:<idx>`, `iterationSignal:<idx>`, `__run__` for the whole run). Decisions: approve | reject | correct (correctedValue stored beside the AI value — the AI payload is immutable) | partially_approved. Working through `POST /api/ai/extractions/[id]/approve|reject|correct`; whole-run status only changes on whole-run decisions.

## Re-analysis (§45-§49)

`reanalyze` creates a new versioned run for the thread; identical context hashes (deterministic builder, sha256 of canonical serialization) keep history auditable across model changes — a different model simply produces a new run beside the old one.

## APIs (§57)

```
POST /api/ai/analyze/thread            (auth + CSRF + per-user rate limit 3/120s)
GET  /api/ai/extractions/[id]
GET  /api/ai/threads/[threadId]/extractions
POST /api/ai/extractions/[id]/approve  (itemKey optional)
POST /api/ai/extractions/[id]/reject   (itemKey optional)
POST /api/ai/extractions/[id]/correct  (itemKey REQUIRED + correctedValue)
POST /api/ai/extractions/[id]/reanalyze
```

The `x-ai-provider-override` header exists ONLY for deterministic test runs; the registry rejects `mock` in production (§79/§6).

## Security notes (§80)

API key never leaves the server; audit metadata never contains excerpts or keys; failures store sanitized messages only.

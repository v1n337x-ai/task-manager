# Authoritative State (Phase 6)

Deterministic Fixed/Not-Fixed determination with mandatory human approval — the AI never mutates VAPT data.

## Decision model

`authoritative_state_decisions` — append-only ledger with full provenance:

| Field | Meaning |
|---|---|
| entityType/entityId | finding / test_case / iteration |
| iterationId / iterationNumber | iteration context (nullable for app-level calls) |
| previousState → newState | explicit transition |
| verification | `DEVELOPER_REPORTED` vs `RETEST_VERIFIED` (§56 distinction) |
| decisionSource | STRUCTURED_DATA / COMMUNICATION / AI_APPROVED / HUMAN_CORRECTION / SYSTEM_CALCULATION |
| resolutionMethod | EXPLICIT / INFERRED / HUMAN_CORRECTION / SYSTEM_DEFAULT |
| sourceMessageId / sourceThreadId / aiExtractionId | provenance chain |
| evidenceRef | minimal excerpts backing the decision |
| approvedByUserId / approvedAt / reason | approval provenance (CORRECT mandates reason §75) |

Natural-key idempotency: (entityType, entityId, iterationId, newState, sourceMessageId).

## Precedence (§4)

```
HUMAN_CORRECTION  (always)
  > AI_APPROVED          (only with approving user)
  > STRUCTURED_DATA      (workbook import)
  > COMMUNICATION        (parsed EML)
  > SYSTEM_CALCULATION   (deterministic default, e.g. Not Retested from absence)
```

Absence is never evidence for a destructive state — missing test cases become `not_retested`, not `removed` (unless explicitly communicated).

## Calculation (§22)

`calculateAuthoritativeFindingState(findingId)`: loads decisions + status history chronologically, applies precedence, returns `{currentStatus, currentIterationNumber, firstSeenIterationNumber, verification, resolutionMethod, decisions[], statusHistory[]}` — a rebuildable explanation.

## Projection (§23)

`finding.currentStatus` is a safe projection; `recalculateFindingProjection(findingId)` rebuilds it from the decision ledger when it drifts.

## APIs (§40)

| Endpoint | Purpose |
|---|---|
| `POST /api/authoritative-state/approve` | record an approved decision (auth+CSRF+Zod) |
| `POST /api/authoritative-state/correct` | human CORRECTION (reason mandatory) |
| `GET /api/authoritative-state/approve?findingId=` | explanation for one finding |
| `GET /api/authoritative-state/review?applicationId=` | review queue per application |

_reanalyze_ lives under `/api/ai/extractions/[id]/reanalyze` (creates a new AI run — old preserved).

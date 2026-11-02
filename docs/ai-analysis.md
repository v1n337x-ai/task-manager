# AI Analysis (Phase 5 → 5.1)

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

## Real OpenCode provider contract (Phase 5.1 — verified live)

The `opencode` port implements the **actual HTTP contract of OpenCode v2**
(verified live against `opencode serve`, v2.2.5) in `lib/ai/opencode.ts`:

| Operation | Endpoint | Notes |
|---|---|---|
| Connection check | `GET /api/info` | Returns `{version, urls, …}` — used by the Settings connection test |
| Analysis | `POST /api/experimental/generate/text` | Body `{prompt, model:{providerID, id}}` → `{data:{text}}` |
| Default model | `GET /api/model/default` | Used when `OPENCODE_MODEL` is unset |

- **Authentication:** HTTP basic auth — username `opencode`, password = the
  stored OpenCode credential. The credential lives ONLY as an AES-256-GCM
  envelope in the AI configuration row (Settings → AI) or in the optional
  `OPENCODE_SERVER_PASSWORD` env var; it is decrypted in memory per request.
  Mint a credential with `opencode pair` (redeems `/auth/connect/<code>`).
- **Server location:** `OPENCODE_SERVER_URL` (e.g. `http://127.0.0.1:28894` —
  printed by `opencode service status`). Unset ⇒ analysis and the connection
  test are honestly **UNAVAILABLE** (`ProviderUnavailableError`), a failed
  extraction row records it, and no synthetic analysis is ever produced.
- **Prompt:** deterministic instruction block + AI_EXTRACTION_V1 schema +
  the exact context JSON hashed by the context builder (`lib/ai/prompt.ts`).
- **Validation:** the port returns the raw text; the analysis service parses
  it and fails the run honestly if it is not schema-valid AI_EXTRACTION_V1.
- **Honest failures:** 401/403 → auth error; 404 → model not found; network
  errors → unavailable; timeouts → timeout message. All sanitized (no keys,
  no request bodies) before storage (§50/§55).

The connection-test gate never fakes success (§2.1.15): without configuration
it is `UNAVAILABLE`; with configuration it makes a REAL `/api/info` call.

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

Credential never leaves the server; audit metadata never contains excerpts or keys; failures store sanitized messages only. The `x-ai-provider-override` header exists ONLY for deterministic test runs; the registry rejects `mock` in production (§79/§6).

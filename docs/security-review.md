# Phase 8 — Final Security & Integration Review

## Secret sweep

`.env` / `.env.test` / `.env.local` are gitignored (verified via `git ls-files` — only `.env.example` tracked). Audit/logger outputs redact keys/passwords/tokens. AI API key stored only as AES-256-GCM envelope.

## Placeholder sweep

No "Coming in Phase N" placeholders remain — Settings and Reports reflect delivered features truthfully. The 501 stubs from earlier phases have been replaced by real implementations.

## Registry of security behaviors verified live

| Behavior | Verified |
|---|---|
| Unauthenticated API → 401 | LVE ✓ (E2E steps 1) |
| CSRF absent → 403 | LVE ✓ (E2E step 3) |
| Login rate limiting | Phase 2 tests ✓ |
| AI key masked in GET | Phase 2.1 tests ✓ |
| EML upload auth | Phase 4 tests ✓ |
| PPT/Excel export auth | Phase 7 tests ✓ |

## Data-lifecycle (§102/§103)

```
Excel → validate → confirm (transaction) → normalized DB
EML → parse → thread → participants/attachments → DB (originals verbatim)
Communications → AI candidate extraction (structured + evidence + confidence)
          → HUMAN review/approve/correct
          → authoritative_state_decisions (append-only)
          → projection
Dashboard/Reports/PPT/Excel read the same authoritative state.
```

## Backup / recovery expectations (§89)

No automated backup exists in this build. Operational requirement: schedule `pg_dump` of the PostgreSQL database plus a filesystem backup of `EML_STORAGE_ROOT` (original .eml files + attachments). Recovery = restore DB + restore storage directory; sha256 integrity re-verification can be run from the application.

## Performance observations

The report DTO is built from 3 batched queries (applications, findings, grouping) — no N+1. Tracker list uses 3 queries for arbitrary volumes. PPT generation is one snapshot read + deck composition (~<1s for 30 apps).

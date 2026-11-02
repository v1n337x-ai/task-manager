# Task Manager — VAPT

Internal VAPT management platform for the Akasa Air programme. **Implementation complete (Phases 2 → 8).**

> Architecture and data model follow the approved Phase 1 Blueprint (`../Phase 1 Blueprint/`). Deviations made under change control are listed at the bottom of this file.

## Stack (pinned)

Next.js **15.5.28** (App Router) · React 19.3 · TypeScript strict · Tailwind CSS 4.3 · shadcn-style Radix components · PostgreSQL 16 · Prisma 6.19.3 · Zod 3.25 · jose · bcryptjs · Recharts 3 (installed, Phase 4) · ExcelJS (Phase 3) · pptxgenjs (Phase 4/5) · Vitest.

## Quick start

```
docker run -d --name tm-postgres -p 5432:5432 -v tmpgdata:/var/lib/postgresql/data \
  -e POSTGRES_USER=task_manager -e POSTGRES_PASSWORD=task_manager_dev -e POSTGRES_DB=task_manager \
  postgres:16-alpine
docker exec tm-postgres psql -U task_manager -d task_manager -c "CREATE DATABASE task_manager_test OWNER task_manager;"

copy .env.example .env    # fill DATABASE_URL, AUTH_SECRET, APPLICATION_SECRET, SEED_ADMIN_PASSWORD
npm install
npm run db:migrate        # (db:deploy for CI) then:
npm run db:seed
npm run dev               # http://localhost:3210 (redirects to /login)
```

Sign in with the seeded credential from your `.env` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

## Scripts

| Command | Meaning |
|---|---|
| `npm run dev` / `build` / `start` | app (port 3210) |
| `npm run typecheck` / `lint` / `format` | quality gates (all clean) |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:reset` | database tooling |
| `npm run test` / `test:unit` / `test:db` | 23 tests (unit + §59 foundation chain) |

## Phase delivery timeline (all complete)
| Phase | Delivered | Commit |
|---|---|---|
| 2 — Foundation/Auth/DB | app shell, single-credential auth, 24-table schema | `d36f815` |
| 2.1 — AI API key config | Settings→AI with AES-256-GCM encrypted key | `7e83d3d` |
| 3 — PT Tracker/Iterations/Excel | tracker UI, open-ended iterations, 39-column contract, import/export | `fe4f936` |
| 4 — EML ingestion | .eml parse/thread/conversation (originals verbatim) | `aa784cc` |
| 5 — AI analysis | AI_EXTRACTION_V1 + evidence + human review | `b57bcff` |
| 5.1 — Real OpenCode adapter | live-verified v2 contract (`/api/info`, generate/text, basic auth) | this commit |
| 6 — Authoritative state | decisions ledger, Fixed/Not-Fixed precedence, corrections | `8cc3c9c` |
| 7 — Dashboard/Reports/PPT | live Recharts dashboard, reports, VAPT-styled PPT export | `5998da6` |
| 8 — Hardening/QA | E2E lifecycle, clean-DB verification, docs, final reviews | this commit |

## What Phase 3 delivers (operational PT Tracker)
- **Iteration engine** (`docs/iteration-engine.md`): open-ended iterations (1 = Initial Scan auto-named; 2+ default Retest; 3+ no migrations), append-only per-iteration states for findings AND test cases, current state = latest authoritative iteration state, `firstSeenIterationNumber` for "New in I2", deterministic `matchKey` for future import matching.
- **PT Tracker UI** (`docs/pt-tracker.md`): dense application table with live finding-derived counts + filters/search; application detail with Overview/Findings/Iterations/Test-Cases/History tabs; Add Finding / Create Iteration / Add Test Case flows; every figure computed from PostgreSQL.
- **Strict Excel contract** (`docs/excel-contract.md`): PT Tracker v1.0 — 39 verbatim columns (headers compared exactly incl. trailing spaces); validate → preview → confirm (single transaction); idempotent by sha256; unresolved applications skipped (never silently created); import snapshots stored as audit context only; template-preserving export with live data and explicit SUM totals (stale/`#REF!` formulas never recreated); round-trip enforced by tests.
- **APIs**: `/api/pt-tracker`, `/api/pt-tracker/[applicationId]`(+`/findings`), findings POST/PATCH(history), iterations, test-cases, `/api/imports/excel{,/validate,/confirm}`, `/api/exports/excel` — all behind auth + CSRF + Zod + audit.
- **Migration** `20261102000000_phase3_pt_tracker_iteration_excel` (new migration — Phase 2 untouched): findings.testCaseId/firstSeenIterationNumber/matchKey(+unique), iterations.importSnapshot, import_jobs.preview/schemaVersionId/warningCount, export_jobs.filename/schemaVersionId, new master values (generating + tested/retested + pipeline job states).
- **Tests**: 40+ total incl. §61 data-integrity chain and the §60 template round trip; `fileParallelism: false` serialises DB suites.

## What Phase 2 delivers
- **Secure single-user auth**: bcrypt + HTTP-only JWT cookie (12h), edge middleware + server-side session re-verification, per-IP rate limit, double-submit CSRF, audited login/logout, no user enumeration.
- **Database**: PostgreSQL 16; migrations only (§38); full model — applications/aliases, master_values (18 domains/98 values), contacts/POC/assigned members, engagements → open-ended **iterations** (1=Initial Scan, 2+=Retest enforced), test cases + iteration states (removed cases preserved), findings + per-iteration states + append-only status history, email threads/messages/participants-with-AI-role-plus-human-override/attachments, AI extractions + evidence + human-approval gate, audit logs (HUMAN/EXCEL_IMPORT/EML/AI/SYSTEM), import/export job registries, PT Tracker schema-version contract (39 columns).
- **Master Data UI**: application registry with create/edit/deactivate + alias manager (duplicate-safe, normalization for future EML/AI matching), controlled-vocabulary viewer.
- **Shell & UX**: Phase 1 design tokens (ink band, accent rule, Bebas Neue/Poppins, severity palette), sidebar with VAPT group (Dashboard · PT Tracker · Reports · Settings), brand menu (Master Data · Reports · Settings), KPI cards (live DB counts), truthful "Coming in Phase X" placeholders (settings, reports, tracker detail sections).
- **API surface** (`/api`): auth, applications + aliases, master data, iterations, findings, test cases, emails/threads/participants, ai extractions, audit, health; imports/exports are truthful 501 stubs until Phase 3.
- **Tests**: 23/23 passing — authentication unit suite + full Phase-2 §59 end-to-end foundation chain + §52 master-data/iteration blocks. `docs/testing.md`.

## Documentation

`docs/architecture.md` · `docs/database.md` · `docs/authentication.md` · `docs/api.md` · `docs/master-data.md` · `docs/development.md` · `docs/testing.md`

## Security baseline (§48)

Security headers (CSP/XFO/nosniff/referrer/permissions) in `next.config.ts`; secrets only via env (`.env*` gitignored, `.env.example` names only); structured logs with secret redaction; uploads trust nothing (attachments are metadata; filenames/extension/MIME never trusted); parameterized access through Prisma only.

## Known limitations (documented, changed in Phase 5.1)

1. **OpenCode provider — implemented (Phase 5.1) with runtime prerequisites.** The real OpenCode v2 HTTP contract is implemented and was verified live (`GET /api/info`, `POST /api/experimental/generate/text`, basic auth `opencode:<credential>`). It requires an accessible OpenCode server (`opencode service status` / `opencode serve`) and a stored credential (Settings → AI or `OPENCODE_SERVER_PASSWORD`); without them analysis honestly refuses instead of simulating output.
2. **PPT fonts on machines without Bebas Neue/Poppins installed** — PowerPoint falls back per viewer; the font names are embedded in the deck and install correctly on any machine with the fonts present. Documented fallback rather than silent substitution.
3. **EML attachments are metadata + verbatim storage** — attachment content is never executed or rendered inline in Phase 4/5 (by design); an attachment viewer is a Phase 9-candidate.
4. **Automated backups** — no scheduled backup in the build; documented expectation in `docs/security-review.md`.
5. **Single-provider AI configuration** — schema is future-proof (one row per provider), but the Settings UI exposes OpenCode only per Phase 2.1 scope.

## Documented deviations from the Phase 1 blueprint (change control §57) — unchanged from Phase 2

1. **Session implementation — `jose` JWT instead of NextAuth@5 (beta).** Original decision DL-04; the replacement keeps all DL-04 properties (JWT in HTTP-only cookie, 12h TTL, credentials flow) and leaves an upgrade path to Auth.js without changing cookie semantics.
2. **bcryptjs instead of native bcrypt.** Pure-JS implementation of the same bcrypt algorithm; avoids a Windows native build toolchain; identical security properties (cost default 12). Swapping to native `bcrypt` is a drop-in change of one module.
3. **Two-iteration contract (user-directed, 2026-11).** The original iteration engine was open-ended and a third creation path existed in tests; per user direction the platform enforces EXACTLY Iteration 1 and Iteration 2: creation beyond I2 is rejected, every product surface displays only I1/I2, and any historical records beyond I2 remain stored (append-only, never deleted) but hidden.
4. **Automatic participant roles (user-directed, 2026-11).** At EML ingestion participants are classified by a deterministic rule engine (vendor domain, retest/fix language, owner wording) with `roleSource=RULE` + confidence; unknown stays unknown. Human overrides and the AI-analysis proposal flow remain the review path.
5. **Audit/history is backend-only (user-directed, 2026-11).** Every mutation continues to write append-only `audit_logs` rows (provenance is never destroyed), but NO audit/history viewer exists anywhere in the web app — dashboard "Recent activity", Settings audit panel and the application History tab were removed. Access stays available programmatically via `/api/audit` for compliance queries.
6. **Severity colors follow the workbook (user-directed, 2026-11).** The web severity palette now uses the PT Tracker workbook's own Office theme accents — Critical `#ED7D31`, High `#4472C4`, Medium `#FFC000`, Low `#70AD47`, Info `#A5A5A5` — with Excel-tint fills and darker-accent text (workbook chrome: band `#BCD4D8`, data tint `#ECF2F3`, peach `#FCE4D6`, green `#E2EFDA`; square corners). The PPT export keeps its original ink/red family until separately re-skinned.

## Phase 2.1 — AI API Key Configuration (delivered)

Settings → AI is now a real configuration panel (single provider: **OpenCode**; provider registry structured for future additions):

- API key stored ONLY as AES-256-GCM envelope in `ai_configurations.encryptedApiKey`, keyed by the dedicated **`APP_ENCRYPTION_KEY`** env secret (never `AUTH_SECRET`, enforced by env validation).
- GET `/api/settings/ai` returns the safe DTO only (`configured`, provider, enabled, masked `•••• abcd` hint, test state) — the key/ciphertext never leaves the server.
- Save semantics: empty input preserves the stored key; a new key replaces it; **Remove key** requires a confirmation dialog and deletes the envelope.
- **No reveal button** by design (§11).
- Connection test runs server-side; with no OpenCode contract in the project it honestly reports *"Connection test unavailable until the OpenCode provider endpoint/configuration is supplied."* (never a fake "Connected").
- Audit entries record `ai_config.saved` / `key_replaced` / `key_cleared` / `test` — never the key value.
- No mail/IMAP/SMTP configuration exists — .eml upload remains the Phase 6 path.

End-to-end tests for the above live in `tests/integration/ai-config.test.ts` (11 tests; suite total 34).

## History preservation rule (§60)

Iterations, finding states (Open → Fixed / Not Fixed), test-case states (including `removed`) are append-only per (entity × iteration). Emails remain individually traceable. Nothing is ever silently overwritten.

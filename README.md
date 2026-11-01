# Task Manager — VAPT

Internal VAPT management platform for the Akasa Air programme. **Phase 2: Application Foundation, Authentication, Database & Master Data.**

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

## Documented deviations from the Phase 1 blueprint (change control §57)

1. **Session implementation — `jose` JWT instead of NextAuth@5 (beta).** Original decision DL-04; reason: single-credential scope + beta-quality of next-auth@5 at pin time; replacement keeps all DL-04 properties (JWT in HTTP-only cookie, 12h TTL, credentials flow) and leaves an upgrade path to Auth.js without changing cookie semantics; impact on Phases 3–5: none (auth is a self-contained seam).
2. **bcryptjs instead of native bcrypt.** Pure-JS implementation of the same bcrypt algorithm; avoids a Windows native build toolchain; identical security properties (cost default 12). Impact: none for later phases; swapping to native `bcrypt` is a drop-in change of one module.

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

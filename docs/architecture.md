# Architecture

Task Manager — internal VAPT management platform. Phase 2 is the **foundation phase**: secure single-user application, normalized PostgreSQL schema, master data, and future-ready seams for the tracker, EML and AI pipelines.

## Layer boundaries

```
UI (server components + client islands)
      │  via server actions (Phase 2) / typed fetches
API layer (app/api/v1-style route handlers)
      │  Zod validation boundary
Service layer (lib/services/*)        ← all business rules live here
      │
Repository (Prisma client via lib/db.ts)
      │
PostgreSQL 16
```

Rules (brief §55):

- UI components never touch `prisma` directly; pages call services.
- Controlled vocabularies resolve ONLY via `master-data-service` (`MasterValue` rows). No hardcoded enums in components.
- Every mutation → `recordAudit()` in `lib/audit.ts`.
- Secrets never leave `lib/env.ts` (Zod-validated); they are redacted at the logger boundary.

## Authentication flow

```
POST /api/auth/login  or  login server action
  → Zod LoginSchema
  → per-IP fixed-window rate limit (5 / 60s default)
  → bcrypt verify against users.password_hash
  → HS256 JWT (jose) { sub, email, displayName } iss=task-manager aud=task-manager-app
  → Set-Cookie tm_session (HTTP-only, SameSite=Lax, Secure in prod, 12h TTL)
  → Set-Cookie tm_csrf (double-submit, readable)
  → audit "auth.login"

GET/POST to protected routes
  → middleware.ts verifies the JWT signature at the edge
  → (pages) server components call requireSession() again (defense in depth)
  → (APIs) requireSessionH(request)
Mutations to protected APIs
  → middleware enforces x-csrf-token === tm_csrf cookie (double-submit CSRF)
```

Login failure returns one generic message for unknown-email and wrong-password (no user enumeration).

## Route protection

| Area | Behaviour unauthenticated |
|---|---|
| `/dashboard`, `/pt-tracker`, `/reports`, `/settings`, `/master-data` | 302 → `/login?next=…` |
| `/api/applications`, `/api/master-data`, `/api/iterations`, `/api/findings`, `/api/test-cases`, `/api/emails`, `/api/email-threads`, `/api/participants`, `/api/audit`, `/api/imports`, `/api/exports`, `/api/auth/me` | 401 JSON |
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`* , `/api/health` | public (*me registered protected) |
| `/login` when authenticated | redirect → `/dashboard` |

## Future-phase seams (installed, not implemented)

| Seam | Where | Activates |
|---|---|---|
| Excel import/export contract | `schema_versions` + `import_jobs`/`export_jobs` + DL-03 dictionary | Phase 3 |
| PPT composition | `export_jobs(target=pptx)` + design tokens | Phase 4/5 |
| EML ingestion | `email_threads`/`email_messages`/`email_participants`/`email_recipients`/`email_attachments` + `normalizeSubjectForThread()` | Phase 6 |
| AI extraction | `ai_extractions` + `ai_evidence` + `ai_approval_decisions` (AI never writes business rows directly) | Phase 5 |

## Secret storage (Phase 2.1)

`lib/crypto/secrets.ts` — AES-256-GCM envelope (`v1:` + base64(ciphertext‖iv‖tag)) keyed by the dedicated
`APP_ENCRYPTION_KEY` server secret (validated distinct from `AUTH_SECRET`/`APPLICATION_SECRET`).
Only the AI provider API key is stored there today; the plaintext never reaches the client,
the audit log, or the logger. The provider abstraction (`lib/ai/provider-registry.ts`) refuses
to invent endpoints: without a real contract, connection tests return `UNAVAILABLE` with an
honest message, never a fake "Connected".

## Errors & logging

- `AppError` codes (`lib/errors.ts`) map to HTTP statuses; production UI shows safe messages only.
- Structured JSON logs (`lib/logger.ts`) with redaction of password/secret/token keys.
- Security headers (CSP, XFO, nosniff, referrer, permissions policy) in `next.config.ts`.

See also: `database.md`, `authentication.md`, `api.md`, `master-data.md`, `development.md`, `testing.md`.

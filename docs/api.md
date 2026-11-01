# API

All endpoints live under `/api` (Next.js route handlers). Zod validation at the boundary; `AppError` → JSON `{error:{code,message,details}}`; mutations audited. Auth via the session cookie — protected endpoints respond 401 through middleware + in-handler guards.

## Status in Phase 2

| Endpoint | Methods | Status |
|---|---|---|
| `/api/health` | GET | public database probe |
| `/api/auth/login` | POST/GET | live (rate-limited, audited) |
| `/api/auth/logout` | POST | live |
| `/api/auth/me` | GET | live (protected) |
| `/api/applications` | GET, POST | live (list + create, Zod + audit) |
| `/api/applications/[id]` | GET, PATCH, DELETE | live (DELETE = soft deactivate) |
| `/api/applications/[id]/aliases` | GET, POST | live (duplicate-alias conflicts → 409) |
| `/api/master-data` | GET, POST | live (list; activate/deactivate vocab) |
| `/api/iterations` | GET, POST | live (open-ended numbering, Initial-Scan rule) |
| `/api/findings` | GET, POST, PUT | live (POST create; PUT = iteration state, append history) |
| `/api/test-cases` | GET, POST, PUT | live (POST create; PUT = iteration state incl. removed) |
| `/api/emails` | GET, POST, PUT | live (threads list/create; participants + human role override) |
| `/api/email-threads` | POST | live (idempotent creation by subject hash) |
| `/api/participants` | GET | live (ai/override effective roles) |
| `/api/ai/extractions` | GET, POST | live for record-keeping; **no agent wired** |
| `/api/settings/ai` | GET, POST | live — safe DTO GET (never returns key); POST SAVE (encrypt+upsert) / CLEAR_KEY |
| `/api/settings/ai/test` | POST | live — server-side connection test with honest provider result |
| `/api/audit` | GET | live (protected read) |
| `/api/imports` | GET, POST | GET live (job registry); POST → 501 Coming in Phase 3 |
| `/api/exports` | GET, POST | GET live (job registry); POST → 501 (Phase 3 xlsx / Phase 4-5 pptx) |

Not every endpoint has full UI in Phase 2 (allowed by §50) — the architecture is the deliverable; operational PT Tracker UI is Phase 3.

## Error codes

`UNAUTHORIZED 401 · FORBIDDEN 403 · VALIDATION_ERROR 422 · NOT_FOUND 404 · CONFLICT 409 · RATE_LIMITED 429 · DATABASE_UNAVAILABLE 503 · INTERNAL_ERROR 500`

## Client usage contract

Client components fetch own API only through `fetch` wrappers that attach `x-csrf-token` from the cookie; direct `prisma` usage from the browser cannot exist by construction.

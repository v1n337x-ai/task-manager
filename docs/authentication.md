# Authentication

**Model:** one credential (Phase 2 — brief §6). bcrypt hashing, signed JWT session cookie, rate limiting, CSRF. No registration, no multi-tenancy, no role admin.

## Credentials

- Stored in `users` (email + `passwordHash`, bcrypt cost 12), seeded by `prisma/seed.ts` from env (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Secrets come only from `.env` — never committed, never in client JS, never localStorage.

## Session

| Property | Value |
|---|---|
| Cookie | `tm_session` — HTTP-only, SameSite=Lax, Secure (production), 12h TTL (`SESSION_TTL_SECONDS`) |
| Format | JWT HS256 (`jose`), iss `task-manager`, aud `task-manager-app`, claims `{sub, email, displayName}` |
| Cookie 2 | `tm_csrf` — double-submit CSRF token (not HTTP-only) |
| Sign/verify | `lib/auth/session.ts` (server, `jose`) |

## Enforcement points

1. **`middleware.ts`** verifies the JWT signature at the edge for all protected page prefixes and `/api/*`; unauth pages → `/login?next=`; unauth APIs → 401 JSON.
2. **Server components/actions** call `requireSession()` — hides-and-verifies (§49).
3. **Route handlers** call `requireSessionH(request)`.
4. **Mutating protected APIs** must echo `x-csrf-token === tm_csrf` (double-submit check in middleware).
5. Sign-out: `POST /api/auth/logout` clears both cookies (audited).

## Rate limiting (§8)

`lib/auth/rate-limit.ts` — fixed-window per-IP bucket (5 attempts / 60 s default via `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_SECONDS`); exceeded → 429 with `Retry-After`, audited.

## No user enumeration

Unknown email and wrong password return the same generic error ("Invalid username or password."), both logged as `auth.login_rejected` with a reason code only (no credentials).

## Tested

`tests/unit/auth.test.ts` + the §59 chain: valid login, invalid password, invalid username, logout, protected page redirect, direct API access without session. Rate limiter windows and per-key isolation covered in unit tests.

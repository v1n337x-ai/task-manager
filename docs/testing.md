# Testing

Vitest suites (brief §52). Unit tests run DB-free; integration tests run against the isolated `task_manager_test` database created by `tests/setup-db.ts` (loads `.env.test`, auto-applies migrations, truncates between suites) and skip gracefully when the DB is unreachable.

## Suites

| File | Covers |
|---|---|
| `tests/unit/auth.test.ts` | bcrypt hash/verify + policy; rate limiter windows/isolation/reset; LoginSchema; alias normalization + type inference (§16-17); thread subject normalization (§28) |
| `tests/integration/foundation.test.ts` — **§59 chain** | the complete foundation flow: authenticate seeded credential (valid + invalid variants) → create application → add aliases (duplicate handling) → engagement → Iteration 1/2/3 (open-ended §19) → finding + iteration states with preserved history (Open→Fixed, §24/26) → test case + iteration state with removed-preserved (§22) → email thread/message/participant/attachment metadata (§27-31) → human role override beats AI role (§30) → AI extraction + evidence + single human approval (§32-34) → audit trail ≥ HUMAN+SYSTEM sources (§35) → schema-version contract 39 columns (§37) |
| `tests/integration/foundation.test.ts` — **§52 blocks** | master-value domains present with ≥1 active; iteration numbering rules (1=Initial Scan; 2+ prohibits Initial Scan) |

## §53 reproducibility (executed in Phase 2 and repeatable)

1. `DROP DATABASE task_manager` → recreate empty
2. `prisma migrate deploy` → schema from zero
3. `npm run db:seed` → user + master values + 3 sample applications + schema contract
4. `next build && next start` → login via UI/API → protected routes → logout

## Auth test matrix (§52 §54)

Valid login ✅ · invalid password ✅ · invalid username ✅ · logout ✅ · session expiry (JWT exp, 5s tolerance) ✅ (unit-covered in session verify + middleware rejects expired) · protected page without session → redirect to /login ✅ (middleware) · API without session → 401 ✅ (middleware + guards).

## What Phase 3 adds

Golden-file Excel round-trip (import original workbook → export → re-import diff = ∅), vocabulary snapshot tests, UI visual regression, Playwright E2E (login→shell→flows) — per Phase 1 DL-12.

# Development

## Prerequisites

- Node ≥ 20.9 (tested on Node 26), npm 11
- Docker (for local PostgreSQL 16)
- Note (Windows): PowerShell ExecutionPolicy blocks `npm.ps1` on this machine — use `npm.cmd` or run from cmd.

## First run

```
# 1. Database
docker run -d --name tm-postgres -p 5432:5432 -v tmpgdata:/var/lib/postgresql/data ^
  -e POSTGRES_USER=task_manager -e POSTGRES_PASSWORD=task_manager_dev -e POSTGRES_DB=task_manager ^
  postgres:16-alpine
docker exec tm-postgres psql -U task_manager -d task_manager -c "CREATE DATABASE task_manager_test OWNER task_manager;"

# 2. Environment
copy .env.example .env     # then edit DATABASE_URL / AUTH_SECRET / APPLICATION_SECRET / SEED_ADMIN_PASSWORD

# 3. Install + migrate + seed
npm install
npm run db:migrate          # or: npm run db:deploy
npm run db:seed

# 4. Run
npm run dev                 # http://localhost:3210 → auto-redirects to /login
```

Seeded login lives in your `.env` (e.g. `admin@akasaair.com` + your `SEED_ADMIN_PASSWORD`).

## Scripts

| Script | Purpose |
|---|---|
| `dev` / `build` / `start` | Next.js 15 app (port 3210) |
| `typecheck` / `lint` / `format` | TS strict · ESLint · Prettier |
| `db:migrate` `db:deploy` `db:seed` `db:reset` | Prisma tooling (see database.md) |
| `test` / `test:unit` / `test:db` | Vitest suites (see testing.md) |

## Project layout

```
app/            routes (login + (app)=authenticated group + api)
components/     ui primitives + shell + feature components
lib/            env · db · logger · errors · audit · auth/ · services/ · validation/
prisma/         schema.prisma · migrations/ · seed.ts
tests/          unit (no DB) · integration (test DB) via setup-db.ts
docs/           architecture/database/authentication/api/master-data/development/testing
middleware.ts   edge protection + CSRF double-submit
```

## Layer discipline (§55)

- Pages → services; services → Prisma; never the reverse.
- Only `lib/env.ts` reads `process.env` (any secret access at redacted logging boundary).
- Controlled vocab always from master-data-service.

## Reproducibility check (§53)

```
docker stop tm-postgres && docker rm tm-postgres   # or DROP DATABASE task_manager
# recreate database (empty) → npm run db:deploy → npm run db:seed → npm run build && npm run start
```

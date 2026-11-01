# Database

PostgreSQL 16 + Prisma 6.19.3. Created exclusively through `prisma/migrations` (§38) — never edited manually in any environment.

## Environment databases

| Environment | Database | URL source |
|---|---|---|
| Development | `task_manager` | `.env` |
| Test | `task_manager_test` | `.env.test` (loaded by vitest setup) |
| Production | provisioned by deployment | environment injection — not in repo |

Local: `docker run -d --name tm-postgres -p 5432:5432 -v tmpgdata:/var/lib/postgresql/data -e POSTGRES_USER=task_manager -e POSTGRES_PASSWORD=task_manager_dev -e POSTGRES_DB=task_manager postgres:16-alpine` (+ manual `CREATE DATABASE task_manager_test OWNER task_manager;` once).

## Model map (prisma/schema.prisma → PostgreSQL tables)

| Domain | Tables |
|---|---|
| Auth | `users` |
| Master data (§14) | `master_values` (domain+value+label), `contacts` |
| Applications (§15-17) | `applications`, `application_aliases`, `application_assigned_members` |
| Iterations (§18-19) | `engagements`, `iterations` (open-ended `number`, 1=Initial Scan rule enforced) |
| Test cases (§20-22) | `test_cases` (stable code, `isActive` instead of delete), `test_case_iterations` |
| Findings (§23-26) | `findings`, `finding_iteration_states`, `finding_status_history` (append-only) |
| Email (§27-31) | `email_threads` (subjectHash key), `email_messages` (RFC Message-ID), `email_recipients`, `email_participants` (role + role_source + confidence + human override), `email_attachments` (sha256, processing status) |
| AI (§32-34) | `ai_extractions`, `ai_evidence`, `ai_approval_decisions` |
| AI configuration (Phase 2.1) | `ai_configurations` (one row per provider; API key stored ONLY as AES-256-GCM envelope `v1:…`; last4 display hint; test state NOT_TESTED/PASSED/FAILED/UNAVAILABLE) |
| Audit (§35) | `audit_logs` (source: HUMAN/EXCEL_IMPORT/EML/AI/SYSTEM) |
| Jobs (§36) | `import_jobs` (sha256 idempotency key), `export_jobs` |
| Schema contract (§37) | `schema_versions` ("PT Tracker" v1.0, 39 columns) |

## Integrity (§40)

- FKs everywhere a relationship exists (no orphan business rows possible).
- Uniques: application name; (application, alias-normalized); (application, code) for TC/F; (engagement, iteration number); finding×iteration; test-case×iteration; email message-id; participant email; audit no-dedup (append).
- Indexes on: application name/type/active; alias normalized; iterations number; findings severity/code; email thread subjectHash + applicationId; participants email/name; import/export jobs status+createdAt+sha256; audit (entity, source, action, createdAt).
- CONTROLLED values are FK-linked to `master_values` (18 seeded domains, 98 values).

## Migrations

```
npm run db:migrate        # create + apply against dev (interactive)
npm run db:deploy         # apply committed migrations (CI/test)
npm run db:reset          # drop + recreate dev (skips seed)
npm run db:seed           # user + master values + 3 sample apps + schema contract
```

From-scratch verification (§53): destroy both databases → `prisma migrate deploy` on each → `npm run db:seed` → application boots and login works. The vitest integration suite performs `migrate deploy/reset` against `task_manager_test` automatically when reachable.

## Historical-state rule (§60)

Updates NEVER overwrite prior iterations:
- `finding_iteration_states` keeps one row per (finding × iteration).
- `finding_status_history` is append-only.
- Removed test cases are `isActive=false` + a `removed` iteration-state row.
- Email messages are immutable; attachments are metadata rows only.

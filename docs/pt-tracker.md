# PT Tracker

The operational tracker (Phase 3): dense, minimized, PPT-derived design system.

## Main page — `/pt-tracker`

- Header actions: Import Excel · Export Excel · Add Application (→ Master Data) · Refresh.
- Live KPI row (§56): Applications · Total findings (+pending) · Critical · High · Pending (+fixed/not fixed) · New in latest iteration (+test cases, CAR).
- Filters (§41): search `q` (server-backed), scope/type/status chips, severity chips (critical/high/medium/low), Fixed / Not Fixed / New / Pending state chips, iteration number filter.
- Dense table (§6): S.No · Application (links to detail) · URL · Assessment · PT Status · Iteration · Total · Crit/High/Med/Low · Pending · Fixed · CAR · Last update. All numbers from `tracker-service` findings aggregation — nothing hardcoded.

## Application detail — `/pt-tracker/[applicationId]?tab=…`

Tabs (§9): **Overview** (KPI cards §10 + registry facts) · **Findings** (§11 dynamic iteration columns: I1/I2/I3… derived from existing states; `New in I2` badges; current column = latest authoritative state; per-row state edit) · **Iterations** (numbered list with type/status; imported snapshots shown audit-only) · **Test Cases** (TC identities with per-iteration state chips + findings count + state editor) · **History** (§47 audit timeline across the application graph).

Actions in header: Add Finding (§43; optional inline test-case creation) · Create Iteration (§45; defaults Retest for 2+) · Add Test Case (§20; TC codes permanent) · Export Excel · Back.

Conversations/email are NOT part of Phase 3 (Phase 6); the History tab walks the audit trail instead.

## Service & API

- `lib/services/tracker-service.ts` — `listTrackerApps(filters)` (batch-aggregated, no N+1), `summarize`, `getApplicationTracker(id)` (findings atlas + iterations + TC + audit graph), `currentStatusFromStates` (§19).
- `GET /api/pt-tracker` — rows + totals (all filters).
- `GET /api/pt-tracker/[applicationId]` — full detail.
- `GET /api/pt-tracker/[applicationId]/findings` — findings only.
- `POST /api/findings` · `GET|PATCH /api/findings/[id]` — creation records initial state in history; PATCH appends the new per-iteration state (§44).
- `GET/POST /api/iterations` — accepts `engagementId` OR `applicationId` (audit-logged container creation only when the application has none).
- `GET/POST/PUT /api/test-cases` — CREATE + iteration-state PUT (removed preserved, §21-§22).
- `POST /api/imports/excel` (multipart validate) · `/confirm` · `/validate` · `GET /api/imports`.
- `POST /api/exports/excel` (xlsx download) · `GET /api/exports` — history.
- All mutations: session + CSRF + Zod + audit (existing Phase 2 controls untouched).

## States & UX (§58)

Empty states for zero-rows per tab, loading states (server-rendered skeletons not needed — RSC), error state for DB unavailable, confirmation dialog for import confirm + destructive-ish mutations, inline validation errors from Zod through to dialog text.

## Testing

`tests/integration/finding-history.test.ts` (§61 tests 1–5 + matchKey dedupe) and `tests/integration/excel-roundtrip.test.ts` (§60 template round trip + §52 idempotency + invalid header/rows rejection). Run `npm test`.

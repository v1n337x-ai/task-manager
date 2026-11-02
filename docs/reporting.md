# Reporting & PPT Export (Phase 7)

One source of truth: PostgreSQL authoritative state → DashboardReport DTO → dashboard, reports, PPT.

## Shared snapshot

`lib/services/reporting/report-service.ts → generateDashboardReport(filters)`

Filters (server-validated): applicationId · severity · statusValue · iterationNumber. Every metric is computed from live database state — no hardcoded values, no Excel snapshots, no AI-narrative numbers.

## Dashboard

`/dashboard` — KPI cards + Recharts (severity/status/applications) with severity colors #CF1325/#E86B10/#F5A623/#4A90D9/#9E9E9E; recent activity; filters via URL params (reproducible, §12).

## Reports

`/reports` — findings/application/iteration/severity report tables over the same snapshot.

## PPT export (§24-§37)

`POST /api/reports/ppt` — pptxgenjs 16:9 deck, VAPT visual family (ink #1F1F1F, red #CF1325, Bebas Neue titles, Poppins body, KPI cards with accent bars, doughnut/level charts with severity colors):

```
Slide 1: Cover · Slide 2: Executive KPIs · Slide 3: Charts · Slide 4: Application register · Slide 5: Remediation focus
```

Deterministic filename `VAPT_[Application]_YYYY-MM-DD.pptx` (sanitized §33). Automated validation (§34/§35): slide count, no `undefined`/`NaN`, KPI text presence; on failure the deck is rejected with `VALIDATION_ERROR` — never returned as success. ExportJob rows + `ppt_export.started/completed/validation_failed` audit events.

## Consistency (§10/§87/§95)

Dashboard = Reports = PPT for the same filters/timestamp — covered by the golden-data test (`tests/integration/reports-ppt.test.ts`) that unzips the generated deck and verifies KPI text equals the report snapshot.

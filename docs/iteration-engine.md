# Iteration Engine

Iterations are an **open-ended entity** (§12-§15) — nothing in the schema or logic caps them at two. Iteration N works without migrations.

## Model

```
Application → Engagement → Iteration (number 1, 2, 3, …)
                                   ↓
                    FindingIterationState (per finding × iteration)
                    TestCaseIteration     (per test case × iteration)
```

- `iterations.engagementId + number` unique — retest numbers auto-increment; explicit numbers are validated to not skip ahead (max `last + 1`).
- Type vocabulary: `initial_scan` · `retest` · `follow_up` · `other` (master values).
- Rule engine: **Iteration 1 must be Initial Scan; iterations ≥ 2 cannot be Initial Scan.**

## Defaults (§13-§15)

- First assessment → `Iteration 1 — Initial Scan` (auto-named).
- Later iterations default type `Retest` (UI default; editable metadata: name/date/notes).
- Iteration 3+/N supported by the same create-iteration flow.

## Never overwrite (§3, §60)

Every new state is an INSERT:

- `finding_iteration_states` — one row per (finding × iteration); Iteration 1 keeps its original status forever.
- `finding_status_history` — append-only trail (`oldStatusCode → newStatusCode`, actor, source, iteration, note).
- `test_case_iterations` — same envelope for test cases; a test case missing from a iteration is recorded (`removed` / `out_of_scope` / `not_retested`), the TC row itself is never deleted (`isActive=false` only on removal-type states).

## Current-state calculation (§19)

`current = status of the highest-numbered iteration that has a state for the finding`
(`lib/services/tracker-service.ts → currentStatusFromStates`). Older iterations are never consulted once a newer authoritative state exists. The finding's surface status (`findings.currentStatus`) mirrors the latest iteration state for listing/filtering, but the per-iteration atlas remains the authority for history.

Fixed / Not Fixed (§18) are persisted as iteration-specific states with green/red badges **plus text labels** (never colour-only).

## New findings (§22)

`Finding.firstSeenIterationNumber` is set when a finding appears first in a later iteration ("— in I1, New in I2"). The Findings Summary shows `New in I2` badges; KPI `New (latest)` counts surfaced-new findings in the latest iteration.

## Data flow with Excel (§33/§36)

The v1 workbook has no finding rows: its aggregates import as `iterations.importSnapshot` (audit context only). Live tracker counts are always computed from `findings` + `finding_iteration_states`, never from stale spreadsheet values.

## Future AI/EML compatibility (§65)

The engine already persists per-iteration state per entity with `source` attribution (HUMAN / EXCEL_IMPORT / EML / AI / SYSTEM). An AI extraction that proposes `Fixed` for iteration 2 simply goes through `setFindingIterationState(..., source: "AI")` followed by a human-approved decision — the history mechanism is identical. No redesign needed.

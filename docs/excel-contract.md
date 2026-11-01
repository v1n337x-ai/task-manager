# Excel Contract — PT Tracker v1.0

**Fixed business contract: 39 tracked columns.** Source of truth: the original uploaded workbook (`prisma/templates/pt-tracker-v1.xlsx`), analysed in Phase 1 (DL-02). Headers live on **row 2** of sheet `VAPT tracker`; data starts at **row 3**. Rows 1/31 (+AD) are structural.

## The 39 columns (exact header text — spaces are part of the contract)

| # | Col | Header (verbatim) | Kind |
|---|---|---|---|
| 1 | A | `S.no` | serial (display only, never a key) |
| 2 | B | `Application` | application identity |
| 3 | C | `Internal / External` | scope enum |
| 4 | D | `Web URL/API/FQDN` | URL / FQDN / APK text |
| 5 | E | `Mail Subject` | engagement thread key |
| 6 | F | `Type` | web / mobile / api / other |
| 7 | G | `Source / tool` | assessment source |
| 8 | H | `POC Akasa Air` | contact names (slash-separated) |
| 9 | I | `Digialert Team - Assigned member` | vendor assignment |
| 10 | J | `Overall Status` | engagement status |
| 11 | K | `Total Vuln Count` | recorded aggregate |
| 12 | L | `Scan/Report Date` | required date |
| 13 | M | `Requested date` | optional date |
| 14 | N | `iteration - 1 Date` | optional date |
| 15 | O | `Iteration - 1 Status` | status |
| 16 | P | `Iteration-2 Date ` (trailing space) | optional date |
| 17 | Q | `Iteration - 2 Status` | status → iteration 2 creation trigger |
| 18 | R | `Comments` | long text |
| 19 | S | `Follow-up` | optional date |
| 20 | T | `Follow-up Response` | long text |
| 21–25 | U–Y | `Critical ` `High ` `Medium ` `Low` `Info ` (trailing spaces) | counts |
| 26 | Z | `CAR` | accepted-risk count |
| 27 | AA | `Total` | recorded aggregate |
| 28 | AB | `Pending` | recorded aggregate |
| 29 | AC | `Vulnerabilities  Closed` (double space) | recorded aggregate |
| 30 | AD | *(blank spacer — outside contract)* | |
| 31–40 | AE–AN | `Open`/`Closed` ×5 groups | severity matrix |

Header comparison is **exact** (case + spaces). Any difference ⇒ import rejected with `INVALID_EXCEL_SCHEMA` (no silent guessing, §27).

## Import pipeline (§25–§30, §51–§56)

```
Upload (multipart, never trusts filename/MIME)
  → sha256 (idempotency, §52)
  → workbook readable? sheet "VAPT tracker"? exact 39 headers?
  → row parse: dates (§34), counts (junk "11+4" sums + warning), enums (§55)
  → identity check  Total = Pending + Closed + CAR  → warning, never auto-corrected (§36)
  → app matching: exact name → alias → (optional create) else UNRESOLVED row skipped (§53)
  → preview persisted on ImportJob (status: validating → ready/failed)
  → user confirms → ONE transaction (§51):
        applications · aliases · contacts (POC/assigned) · engagements
        · iteration 1 (Initial Scan) · iteration 2 (Retest, when Q recognisable)
        · importSnapshot per iteration (audit context ONLY, §36)
  → job completed / completed_with_warnings; audit: validated → confirmed → completed
```

- Same file re-uploaded after completion ⇒ idempotent skip (§52) unless `force=true`.
- Validation writes NO business data; failures roll back and mark the job failed (§51).
- Aggregates (K, U…AC) are stored as `iterations.importSnapshot` for reconciliation **only** — live PT Tracker counts always derive from finding rows (§36). The v1 contract contains NO per-finding rows; finding-level structure (with `matchKey`, §23) is prepared for future EML/AI imports.
- Iteration detection (§54): iteration 2 is created only when `Iteration - 2 Status` (Q) parses to a known status. A "Pending" string in P produces a **date warning** and does NOT invent iteration 2.

## Export pipeline (§31, §40)

- The template binary is opened and only data regions rewritten: same columns, order, header text, sheet, fonts, borders, widths, validations (§31). Exported values are **live DB data** (§36/§37) — not the stale snapshots.
- Matrix AE–AN exported from current finding states (Open bucket = open/new/not_fixed/not_retested; Closed = fixed).
- Leftover template data rows are blanked (styles preserved); totals (U33…AC33 and matrix row) are rewritten as explicit `SUM` formulas over the exported range — the workbook's original `#REF!`/stale formulas are never recreated (§35).
- `ExportJob` records filename/params/rows/user; audits `excel_export.started` / `.completed`.

## Dates (§34)

Accepted: Excel serials, JS Date cells, ISO `yyyy-mm-dd`, `d/m/yyyy` ("16/6/2026" convention), `dd MMM yy`/`yyyy` ("04 Jul 26"). Ambiguous `04/01/2026` → interpreted day-first (program convention) **with a recorded warning**; invalid/out-of-range → warning/error, never silently fixed.

## Round-trip contract (§32) — enforced by tests

`template → import → DB → export → re-import` must always succeed with the same row count and zero duplicates; header validation runs on the export too (`tests/integration/excel-roundtrip.test.ts`).

# Master Data

Controlled values live in the **`master_values`** table (18 domains × 98 seeded values) — never hardcoded in components/APIs (§14, §55). Every business row FK-references its vocabulary row.

## Domains seeded (from the Phase 1 real workbook vocabulary, DL-03 §5)

| Domain | Values (label basis) |
|---|---|
| application_type | web · mobile · api · other |
| environment | prod · uat · staging · dev · unknown |
| scope | internal · external |
| application_status | active · inactive |
| engagement_status | initiated / in_progress / pending / on_hold / completed / cancelled (workbook states preserved) |
| iteration_type | initial_scan · retest · follow_up · other |
| iteration_status | planned · in_progress · pending · completed · cancelled |
| test_case_status | included · not_tested · passed · failed · removed · not_retested · out_of_scope · not_applicable · unknown |
| finding_status | open · fixed · not_fixed · accepted_risk (CAR) · removed · duplicate |
| finding_iteration_status | open · fixed · not_fixed · not_retested · removed · out_of_scope · not_applicable · unknown |
| severity | critical · high · medium · low · info (CAR is a STATUS, not a severity — DL-06) |
| assessment_source | manual_burp, ai_assisted, mobsf variants, vapt forms, other (tracker G-column raw labels preserved) |
| test_approach | black_box · static_analysis · api_testing · manual_validation |
| participant_role | pentester · developer · application_owner · security_team · management · other · unknown |
| alias_type | name · shortname · fqdn · url · package · email_subject · other |
| attachment_status | pending · processing · processed · failed · skipped |
| extraction_status | pending · processed · needs_review · approved · rejected · failed |
| job_status | queued · running · completed · failed · cancelled |

## Applications (§15)

Fields per brief: name (verbatim registry key), display_name, type, scope (internal/external), environment, web URL, API/FQDN, POC (`contacts` + primary pointer), assigned team members (`application_assigned_members`), status, active/inactive, created/updated. interact via Master Data UI (create/edit/alias dialogs) or `/api/applications`.

## Application aliases (§16-17)

`application_aliases` stores verbatim alias + deterministic `normalized` key lowercased/trimmed. Type auto-inference: URL → FQDN → package (com./org./io. namespace) → name; overridable. Uniqueness **(application, normalized)** with friendly conflict message. The name + display name are seeded as aliases on creation — groundwork for the Phase 5/6 EML matching ("Cash Portal ≈ CashPortal ≈ cash-portal ≈ UAT Cash Portal").

## Contacts (POCs / assigned members)

`contacts` (org + fullName unique) mirrors the workbook's "POC" and "Assigned member" columns (multi-person strings will be split during the Phase 3 import). Contact management UI expands in Phase 3 alongside import mapping.

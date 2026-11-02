TRUNCATE authoritative_state_decisions, ai_approval_decisions, ai_evidence, ai_extractions,
  email_recipients, email_attachments, email_messages, email_participants, email_threads,
  finding_status_history, finding_iteration_states, findings, test_case_iterations, test_cases,
  iterations, engagements, application_aliases, application_assigned_members,
  application_reports, applications, contacts, audit_logs, import_jobs, export_jobs
  RESTART IDENTITY CASCADE;
SELECT (SELECT COUNT(*) FROM applications) AS apps, (SELECT COUNT(*) FROM findings) AS findings,
       (SELECT COUNT(*) FROM email_threads) AS threads, (SELECT COUNT(*) FROM ai_extractions) AS ai,
       (SELECT COUNT(*) FROM master_value) AS master_kept, (SELECT COUNT(*) FROM users) AS users_kept,
       (SELECT COUNT(*) FROM ai_configurations) AS ai_config_kept;

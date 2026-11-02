SELECT COUNT(*) AS done_import_jobs FROM import_jobs j
  JOIN master_values mv ON mv.id = j.status AND mv.domain = 'job_status' AND mv.value LIKE 'completed%'
WHERE j.type = 'eml_batch' AND j.options->>'declaredApplicationId' = '28';

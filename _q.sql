SELECT COUNT(*) AS msgs,
       (SELECT COUNT(*) FROM email_threads) AS threads,
       (SELECT COUNT(*) FROM import_jobs WHERE type='pst_batch') AS pst;

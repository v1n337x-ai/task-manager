SELECT DISTINCT t.id FROM email_threads t
JOIN email_messages m ON m."threadId" = t.id
WHERE t."applicationId" = 28
AND (t.subject ILIKE '%OPAS%' OR t.subject ILIKE '%vapt%' OR t.subject ILIKE '%vulner%' OR t.subject ILIKE '%penetration%' OR t.subject ILIKE '%WAF%' OR t.subject ILIKE '%CVE%' OR t.subject ILIKE '%black box%' OR t.subject ILIKE '%retest%' OR t.subject ILIKE '%security adv%')
GROUP BY t.id HAVING COUNT(m.id) >= 2
ORDER BY COUNT(m.id) DESC;

/**
 * Controlled master-value registry — DB-backed (brief section 14).
 * Hidden from the UI (user direction 2026-11): the vocabulary is an internal
 * system configuration, not something operators browse. It stays DB-backed
 * and everything downstream (dialogs, imports, exports) reads it exactly as
 * before — only the Master Data page section is removed.
 */
export function MasterValuesSection() {
  return null;
}

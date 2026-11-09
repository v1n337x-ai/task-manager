/**
 * Master-tracker placeholder findings were created to carry aggregate
 * vulnerability counts when an application's detail report had not been
 * imported yet. These rows intentionally have synthetic titles such as
 * "Imported vuln (High, Closed) #1" and are marked by the master-import
 * description marker.
 *
 * Once real named findings appear for an application, matching placeholder
 * rows are duplicate representations of those findings and must not be
 * counted or displayed as separate vulnerabilities. The physical records are
 * preserved; this helper only identifies which placeholders are superseded
 * and should be excluded from application/reporting surfaces.
 */

export const MASTER_PLACEHOLDER_MARKER = "[Master tracker import ";

export interface PlaceholderFindingCandidate {
  id: number;
  title: string | null;
  description: string | null;
}

export function isMasterPlaceholder(finding: PlaceholderFindingCandidate): boolean {
  return (
    finding.title?.trim().toLowerCase().startsWith("imported vuln") === true ||
    finding.description?.includes(MASTER_PLACEHOLDER_MARKER) === true
  );
}

/**
 * Totally count-based duplicate detection: if the application has `R`
 * non-placeholder findings, the first `min(R, P)` placeholder records are
 * superseded. This preserves every counted vulnerability total while
 * removing synthetic names whenever a named representation exists.
 */
export function duplicateMasterPlaceholderIds<T extends PlaceholderFindingCandidate>(
  findings: readonly T[],
  applicationIdOf?: (finding: T) => number,
): Set<number> {
  const duplicateIds = new Set<number>();
  const findingsByApplication = new Map<number, T[]>();

  for (const finding of findings) {
    const applicationId = applicationIdOf ? applicationIdOf(finding) : 0;
    const group = findingsByApplication.get(applicationId) ?? [];
    group.push(finding);
    findingsByApplication.set(applicationId, group);
  }

  for (const group of findingsByApplication.values()) {
    const placeholders = group
      .filter((finding) => isMasterPlaceholder(finding))
      .sort((a, b) => a.id - b.id);
    const realFindingCount = group.length - placeholders.length;
    const supersededCount = Math.min(realFindingCount, placeholders.length);
    for (let i = 0; i < supersededCount; i++) duplicateIds.add(placeholders[i]!.id);
  }

  return duplicateIds;
}

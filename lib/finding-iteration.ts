/**
 * Universal "New in Iteration N" invariant for the VAPT tracker.
 *
 * A verdict in Iteration N logically proves the finding existed BEFORE
 * Iteration N: a vulnerability cannot be fixed, rejected, accepted as risk or
 * retested before it was first observed. Therefore an AI proposal or a stacked
 * workbook table that claims `isNewFindingCandidate` while carrying such a
 * verdict must never produce `firstSeenIterationNumber = N` (which renders the
 * false "New in I2" badge in the UI and Excel export).
 *
 * This is a pure module (no server imports) so it can be shared by the apply
 * service, the workbook importer, the tracker page and the Excel exporter.
 */
export const PRIOR_EXISTENCE_STATUSES: ReadonlySet<string> = new Set([
  "fixed",
  "not_fixed",
  "reopened",
  "retested",
  "accepted_risk",
  "removed",
  "out_of_scope",
  "not_applicable",
  "duplicate",
]);

export function statusImpliesPriorSighting(statusValue: string | null | undefined): boolean {
  return !!statusValue && PRIOR_EXISTENCE_STATUSES.has(statusValue);
}

/** Resolve firstSeenIterationNumber without trusting an unverified "new" flag. */
export function resolveFirstSeenIterationNumber(params: {
  iterationNumber: number;
  aiSaysNew: boolean;
  statusValue: string | null | undefined;
}): number {
  if (params.aiSaysNew && !statusImpliesPriorSighting(params.statusValue)) {
    return params.iterationNumber;
  }
  return Math.min(params.iterationNumber, 1);
}

/** UI/export guard for legacy rows whose stored firstSeen value is already wrong. */
export function isNewInIteration(params: {
  firstSeenIterationNumber: number | null;
  iterationNumber: number;
  hasIterationState: boolean;
  hasEarlierIterationState: boolean;
  statusValue?: string | null;
}): boolean {
  return (
    params.firstSeenIterationNumber === params.iterationNumber &&
    params.hasIterationState &&
    !params.hasEarlierIterationState &&
    !statusImpliesPriorSighting(params.statusValue)
  );
}

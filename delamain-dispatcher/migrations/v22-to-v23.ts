export async function migrate(): Promise<void> {
  // v23 fixes dispatcher-local incident-context wiring for blocked
  // tracked_path_conflict results: the structured conflict facts and
  // merge/repo attempt ids now survive from the blocking branch into
  // runtime state and preserved incident bundles.
  //
  // Persisted dispatcher runtime-state remains backward-compatible because the
  // shape stays additive and reader-normalized. Keep the sequential
  // construct-upgrade chain contiguous with a documented no-op step.
}

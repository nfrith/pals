export async function migrate(): Promise<void> {
  // v22 widens local-only dispatcher forensics surfaces: telemetry moves to
  // schema @2, runtime incidents gain structured incident_context, and
  // incident bundles are preserved under runtime/incidents/<dispatch_id>.json.
  //
  // Persisted dispatcher runtime-state remains backward-compatible because the
  // new fields are additive and reader-normalized. Keep the sequential
  // construct-upgrade chain contiguous with a documented no-op step.
}

export async function migrate(): Promise<void> {
  // v2 rebuilds the shipped dashboard renderer and route contract, but the
  // dashboard process still keeps no operator-owned persisted schema inside
  // the ALS system. Keep the sequential construct-upgrade chain contiguous
  // with a no-op migration step for 1 -> 2.
}

export async function migrate(): Promise<void> {
  // v21 adds projected active-operator assignment metadata to the runtime
  // manifest and teaches the dispatcher to filter items by the local
  // active-operator selector. Persisted dispatcher runtime-state does not
  // change shape, so keep the sequential construct-upgrade chain contiguous
  // with a documented no-op step for 20 -> 21.
}

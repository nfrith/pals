export async function migrate(): Promise<void> {
  // v20 narrows primary-clone pre-commit enforcement to authoritative
  // worktrees only, but it does not change the persisted dispatcher
  // runtime-state shape. Keep the sequential construct-upgrade chain
  // contiguous with a no-op migration step for 19 -> 20.
}

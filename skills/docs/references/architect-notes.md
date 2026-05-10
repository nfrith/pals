# Architect Notes

Practical tips and shortcuts for ALS architects working on live systems. These are not part of the formal spec — they're field notes from operating real ALS systems.

## In-Place Module Edits (Bypassing change/migrate)

One way to quickly modify an ALS module without running the `/change` and `/migrate` workflows is to modify the versioned bundle in place, then re-deploy with `alsc deploy`. This is safe **so long as the change does not require a schema modification in any way whatsoever** — no new fields, no new entities, no enum changes, no section changes. Agent prompt edits, skill SKILL.md updates, and dispatcher config tweaks are typical candidates.

After editing the source file under `.als/modules/{module}/v{N}/`, run:

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy ${HARNESS} ${SYSTEM_ROOT} <module-id>
```

Resolve `ALS_PLUGIN_ROOT`, `HARNESS`, and `SYSTEM_ROOT` through `skills/lib/runtime-env.sh` first. This instantly projects the change into the active harness roots reported by the helper.

This technique is also useful for debugging — when you want to test a prompt change or dispatcher behavior quickly without going through the full version lifecycle. Just be mindful that nothing is actively processing in the delamain while you're editing, or you may create a race between the running dispatcher and your in-flight edits.

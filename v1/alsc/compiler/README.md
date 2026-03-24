# Compiler

Bun-based validator for the explicit centralized `.als/` metadata model.

The system registry owns a single `system_id`, and each module declares one explicit mount path relative to the system root.
Each system also declares one active `als_version`. This compiler currently supports `als_version: 1` only and treats ALS upgrades as whole-system cutovers rather than mixed-version rollouts.

Shape files are inferred by convention as `.als/modules/<module-id>/v<version>/shape.yaml`.
Each active module version may also carry canonical skill bundles under `skills/`.
Every required module version above `v1` must also carry inbound migration assets under `migrations/`.
Authored ALS source YAML does not carry a top-level `schema` field.

## Usage

```bash
cd v1/alsc/compiler
bun run src/index.ts ../../example-systems/centralized-metadata-happy-path
```

Optional module filter:

```bash
bun run src/index.ts ../../example-systems/centralized-metadata-happy-path backlog
```

## Output Contract

The validator emits JSON shaped as `als-validation-output@1`.

- `schema` identifies the output contract version.
- `als_version` is the active ALS language version declared by `.als/system.yaml`.
- `compiler_contract.supported_als_versions` lists the ALS language versions this compiler accepts today.
- `compiler_contract.upgrade_mode` is currently `whole-system-cutover`: one system targets one ALS version at a time.
- `compiler_contract.upgrade_assistance` is currently `hybrid-assisted`: official ALS upgrades may combine deterministic rewrites with supervised agent guidance.
- Diagnostics remain author-facing, but `code` and nullable `reason` are the machine-readable contract for automation. Tooling must not key on `message` text.
- `reason` coverage is being rolled out incrementally. Older diagnostics may still emit `null` until each call site is upgraded.

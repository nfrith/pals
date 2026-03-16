# Compiler

Bun-based validator for the explicit centralized `.pals/` metadata model.

The system registry declares named repo-root mounts, and each module resolves from `mount + path`.

## Usage

```bash
cd v1/palsc/compiler
bun run src/index.ts ../../example-systems/centralized-metadata-happy-path
```

Optional module filter:

```bash
bun run src/index.ts ../../example-systems/centralized-metadata-happy-path backlog
```

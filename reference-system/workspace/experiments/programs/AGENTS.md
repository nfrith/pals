# experiments/programs/

Each program is a subdirectory: `PRG-NNNN/PRG-NNNN.md` with its experiments nested below.

## What Makes a Good Program

A program starts with a belief worth testing. The HYPOTHESIS should be one clear paragraph — if you can't state it simply, the program isn't scoped well enough.

SUCCESS_CRITERIA must be measurable. "Improve performance" is not a criterion. "Reduce p95 latency below 200ms across 3 consecutive runs" is.

## Navigation

- `PRG-NNNN/PRG-NNNN.md` — the program record
- `PRG-NNNN/experiments/` — experiments under this program
- Every program must reference a client in `clients/registry/`. The client is the reason the program exists.

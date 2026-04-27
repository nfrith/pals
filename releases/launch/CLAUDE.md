# ALS Public Launch Gate

This directory defines what "ready to push ALS to the world" means while ALS remains labeled Beta Research Preview.

## This Gate Is Not

- not a claim that ALS is 1.0 or stable
- not a promise of zero breakage
- not a statement that production-lifecycle tooling is already complete

## This Gate Is

- a defensible answer for how operators install, update, and recover an ALS system
- a clear boundary between the current preview contract and the unfinished lifecycle work
- a single execution list of the remaining launch blockers

## Launch Standard

ALS is ready for the broader public push only when:

- the release/update model in `../update-model/` matches real operator workflows
- installed delamains have a real upgrade path
- `als_version` cutovers have a first-class toolchain
- bundled operator-facing surfaces have explicit refresh rules
- changelog and version-policy discipline are active
- the remaining work is small enough that `punchlist.md` is a finishing list, not an architecture placeholder

## Current Status

ALS-050 establishes the document architecture and writes down the intended model. It does not claim the implementation work is done. The remaining blockers are the items in `punchlist.md`.

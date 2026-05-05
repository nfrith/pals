# Reference System

The reference system acts as all of the following:

- The demo for new users
- The system for testing ALS internally
- The system where we paint new concepts

## Bootup Invariant

This seed is intentionally constrained to fire exactly one agent dispatch on `/bootup`.

- The one live dispatch is `postmortem-lifecycle` on `operations/postmortems/INC-003.md`
- That agent is a bootup-safe demo that sleeps for 20 minutes and exits cleanly
- Future seed additions must preserve the one-live-dispatch invariant unless a later ALS job changes it deliberately

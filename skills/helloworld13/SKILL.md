---
name: helloworld13
description: Phase 5 fix bump. Replaces the broken /helloworld-broken from 0.1.12. Architect /update on RC should fire and land 0.1.12 → 0.1.13. After RC validation, stable advances 0.1.11 → 0.1.13, skipping 0.1.12 entirely. Edgerunner /update goes 0.1.11 → 0.1.13 in one step, never seeing the broken state.
---

# helloworld13

Print exactly:

```
hello from /helloworld13 — fix bump after the bad 0.1.12
```

Setup at test time:
- nfrith/als main → 0.1.13 (this commit, the fix)
- nfrith/als stable → still at 0.1.11 (will advance to 0.1.13, skipping 0.1.12)
- Architect's project-scope test folder → at 0.1.12 with `/helloworld-broken` (about to be replaced)
- Edgerunner user-scope install → at 0.1.11 with `/helloworld11` (will jump to 0.1.13 after stable advance)

Expected:
- Architect /update on RC: fires, lands at 0.1.13, sees `/helloworld13` (no `/helloworld-broken` anymore — the rename replaced it)
- After stable advances to 0.1.13, edgerunner /update fires, lands at 0.1.13 with `/helloworld13`. Edgerunner skips 0.1.12 entirely — never has `/helloworld-broken`.

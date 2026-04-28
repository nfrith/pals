---
name: helloworld-broken
description: BAD BUMP MARKER — this skill should never reach edgerunners. If you (the architect) see `/helloworld-broken` in autocomplete after a /update, the bump landed. The next step is to bump again with a fix; stable does NOT advance to this version. If an edgerunner ever sees this skill, the channel gate failed.
---

# helloworld-broken

Print exactly:

```
hello from /helloworld-broken — YOU SHOULD NOT SEE THIS AS AN EDGERUNNER
```

Setup at test time:
- nfrith/als main → 0.1.12 (this commit, deliberately marked broken)
- nfrith/als stable → 0.1.11 (held back; will skip 0.1.12 entirely)
- Architect's project-scope test folder → 0.1.10 from `als-marketplace` (RC)
- Edgerunner user-scope install → 0.1.11 from `als-marketplace-stable` (kept active to test relaxed rule)

Expected:
- Architect /update on RC: fires, lands at 0.1.12, sees `/helloworld-broken` (smoke test reveals breakage)
- Edgerunner /update on stable: no-op (stable still at 0.1.11)
- After fix-bump (0.1.13) ships and stable advances 0.1.11 → 0.1.13, edgerunner /update should land at 0.1.13 directly. Edgerunner NEVER has `/helloworld-broken`.

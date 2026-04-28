---
name: helloworld11
description: Test A redux — RC channel /update with the testing-discipline rule honored (only one install active at a time). Project-scope test folder was reinstalled at 0.1.9 fresh, edgerunner user-scope install was suspended/uninstalled. Bumps main to 0.1.10. Architect /update on the project-scope test folder should fire (RC, 0.1.9 → 0.1.10).
---

# helloworld11

Print exactly:

```
hello from /helloworld11 — RC update probe with single-install discipline
```

Setup at test time:
- nfrith/als main → 0.1.10 (this commit)
- nfrith/als stable → 0.1.8 (untouched)
- Architect's project-scope test folder → 0.1.9 (reinstalled fresh during Phase 3 inspection)
- Edgerunner user-scope install → suspended (uninstalled to honor the new single-install rule)

Expected: /update on the project-scope test folder fires, lands at 0.1.10. Verifies that even when stable is far behind (0.1.8), the RC channel updates independently.

---
name: helloworld10
description: Channel separation probe (Phase 3). Bumps nfrith/als main to 0.1.9 while stable branch stays at 0.1.8. Architect /update on the project-scope test folder (RC channel) should fire and land at 0.1.9. Edgerunner /update from any dir on user-scope install (stable channel) should be a no-op because stable hasn't moved. This proves a bump on main reaches RC only — main churn doesn't touch edgerunners until stable advances.
---

# helloworld10

Print exactly:

```
hello from /helloworld10 — channel separation probe (RC fires, stable doesn't)
```

Setup at test time:
- nfrith/als main → 0.1.9 (this commit)
- nfrith/als stable → 0.1.8 (untouched since Phase 1 branch)
- Architect's project-scope test folder → installed at 0.1.5 from `als-marketplace` (RC)
- Edgerunner user-scope install → 0.1.8 from `als-marketplace-stable` (stable)

Expected on /update:
- RC (project-scope test folder): fires, lands at 0.1.9
- Stable (user-scope install): no-op, "already on latest"

This is the gate proof. If both fire, channels aren't separating. If neither fires, the skill's broken. If only RC fires, channels work.

---
name: helloworld9
description: Edgerunner-fidelity test of the unified-CLI `/update` skill. Edgerunner is on a user-scope install (installed via Desktop's GUI from Customize), now at 0.1.5. Bumps remote to 0.1.6. Operator runs `/update` from a random test dir (not Fixture A) — exercises the user-scope path where `claude plugin update als@als-marketplace` (no --scope flag) is the right default.
---

# helloworld9

Print exactly:

```
hello from /helloworld9 — edgerunner /update probe (user scope)
```

Setup: Edgerunner installed ALS via Desktop's Customize → Add plugin (no terminal). Lands at user scope at version 0.1.5. Remote now at 0.1.6. Operator runs `/update` from any directory (user scope is global). Pass = the skill's Phase 4 default `claude plugin update als@als-marketplace` succeeds because the install is user-scoped (matching the CLI default). Fail = something in the user-scope path differs from the project-scope path we just validated, and we adapt.

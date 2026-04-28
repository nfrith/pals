---
name: helloworld6
description: First test of the project-scope `/update` flow on Claude Code Desktop. Bumps `0.1.2` → `0.1.3`. If the architect's Fixture A (`~/test-systems/dev-claude-code-desktop/`) sees this new version after running `/update`, project-scope `/update` works and the proposed lane-1 plan rests on solid ground. If not, we adapt.
---

# helloworld6

Print exactly:

```
hello from /helloworld6 — project-scope /update probe
```

Setup: ALS installed at project scope in `~/test-systems/dev-claude-code-desktop/` via `claude plugin install --scope project`. Folder opened in Claude Code Desktop. Remote ALS bumped from `0.1.2` → `0.1.3`. Architect runs `/update` from inside the Desktop session for that folder. Pass = `/update` detects the bump, walks the swap, and `/helloworld6` becomes available afterward. Fail = something in the project-scope state shape breaks `/update`'s assumptions, and we learn exactly where.

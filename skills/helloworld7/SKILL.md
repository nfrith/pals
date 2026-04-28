---
name: helloworld7
description: Test of the unified-CLI `/update` path (Bash shellout to `claude plugin update als@als-marketplace`) from inside a Claude Code Desktop session. Bumps `0.1.3` → `0.1.4`. If `/update` invokes the shellout cleanly and the version lands, we collapse the platform-specific Phase 4 in `/update` and use one CLI primitive for everyone.
---

# helloworld7

Print exactly:

```
hello from /helloworld7 — unified-CLI /update probe
```

Setup: ALS installed at project scope in `~/test-systems/dev-claude-code-desktop/`, currently at `0.1.3` after the previous /update test. Remote bumped to `0.1.4`. The `/update` skill has been patched to drop the Desktop GUI walkthrough and instead Bash-shellout to `claude plugin update als@als-marketplace`. Operator opens Fixture A in Desktop, invokes `/update`. Pass = the shellout completes, the version installs, `/helloworld7` becomes available after a session restart. Fail = the shellout from inside a Desktop-launched session has constraints we haven't accounted for, and we move to Option B (SlashCommand tool).

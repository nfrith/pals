---
name: helloworld8
description: End-to-end test of the simplified unified-CLI `/update` skill from inside Claude Code Desktop. Fixture A is at 0.1.4 with the new skill installed; remote is at 0.1.5. Operator runs `/update` from Desktop, observes whether the skill's Phase 4 Bash shellout to `claude plugin update als@als-marketplace` works cleanly.
---

# helloworld8

Print exactly:

```
hello from /helloworld8 — simplified /update end-to-end probe
```

Setup: Fixture A (`~/test-systems/dev-claude-code-desktop/`) at 0.1.4 with the simplified `/update` skill (no GUI walkthrough, single CLI primitive). Remote bumped to 0.1.5 with this skill renamed. Operator opens Fixture A in Desktop, runs `/update`. Pass = skill completes Phase 1–6 without error, `/helloworld8` becomes available after a session restart, and we have a one-skill answer for both architect and edgerunner. Fail = bash shellout from inside Desktop has a constraint we missed, and we move to Option B (SlashCommand tool).

---
name: helloworld4
description: Test skill for verifying whether Claude Code's version comparator strips pre-release suffixes. Renamed from helloworld3 alongside a version jump from 0.1.0-beta.33 to 0.1.1 — a real MAJOR.MINOR.PATCH change that no string-trimming comparator could ignore.
---

# helloworld4

Print exactly:

```
hello from /helloworld4 — semver MAJOR.MINOR.PATCH bump
```

Hypothesis under test: Desktop's "On latest version" behavior may be caused by a comparator that ignores the `-beta.X` pre-release suffix. By bumping to `0.1.1` (no suffix, real PATCH increment), we force any reasonable comparator to see a different version. If Desktop's Update button activates this time, the comparator-strips-prerelease theory is confirmed.

---
name: helloworld2
description: Test skill for verifying the ALS plugin auto-update mechanic. Renamed from helloworld1 to test that auto-update propagates skill renames to an edgerunner's Desktop install on startup.
---

# helloworld2

Print exactly:

```
hello from /helloworld2 — auto-update propagated
```

This skill exists to verify that with `autoUpdate: true` set on the als-marketplace registration, a Desktop restart pulls beta.31 and renames `/helloworld1` to `/helloworld2`.

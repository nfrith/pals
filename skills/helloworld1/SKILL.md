---
name: helloworld1
description: Test skill for verifying the ALS plugin update mechanic. Renamed from helloworld to test that an explicit-version bump propagates a skill rename to an edgerunner's Desktop install.
---

# helloworld1

Print exactly:

```
hello from /helloworld1 — rename propagated
```

This skill exists to verify that an explicit-version bump (from 0.1.0-beta.29 to 0.1.0-beta.30) successfully renames `/helloworld` to `/helloworld1` on an installed edgerunner.

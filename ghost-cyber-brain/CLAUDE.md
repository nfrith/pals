# Ghost Cyber Brain (ALS)

The cyber-brain construct in ALS. Receives features deployed forward from Ghost.

## Deployment Pattern

This directory receives features from Ghost's `.als/ghost-cyber-brain/`. Deployments flow in one direction only — forward from Ghost to ALS. Never backwards. Never bidirectional.

```
Ghost (.als/ghost-cyber-brain/)
        │
        │  forward deploy
        ▼
ALS (nfrith-repos/als/ghost-cyber-brain/)   ← you are here
```

Ghost is the origin where the cyber-brain is built and proven. ALS is where it becomes a construct available to all ALS systems.

## Status

Receiving. No features deployed yet — Ghost is still building v1.

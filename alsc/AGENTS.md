# ALSC Harness Design

Code under `alsc/` must treat harnesses as an open set.

Do not write logic that assumes the only harnesses are `claude` and `codex`, and do not use `target === "claude" ? ... : ...` as a proxy for all other harness behavior. New code should be correct if a third harness such as `opencode` is added later, and should continue to scale to additional harnesses after that.

Use registry-driven patterns:

- Put harness roots, display names, transaction roots, lifecycle support, and feature capabilities in the shared harness registry.
- Prefer loops over registered harness specs or construct capability records instead of hard-coded two-way branches.
- Let each harness declare what it supports. For example, dispatcher and dashboard support should be capability data, while statusline should be modeled as an optional harness display face.
- Keep provider concepts separate from harness concepts. `anthropic` and `openai` are agent providers; `claude`, `codex`, and future targets such as `opencode` are harnesses.
- If behavior truly is harness-specific, isolate it behind a named registry field, adapter, or narrowly scoped helper rather than spreading string checks through compiler, update, or construct code.

When adding or changing harness behavior, add tests that would fail if a future third harness were accidentally treated as "not Claude" or "not Codex" instead of being driven by its own declared capabilities.

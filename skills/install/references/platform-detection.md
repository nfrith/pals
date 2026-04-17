# Platform Detection

This is placeholder detection. The goal is to acknowledge one explicit ALS platform code, not to fully branch behavior yet.

Choose in this order:

1. If the operator or task context explicitly says Claude Code Desktop or CDSK, acknowledge [`ALS-PLAT-CDSK`](nfrith-repos/als/CLAUDE.md).
2. If the operator or task context explicitly says Claude Code CLI or the install is clearly shell-first, acknowledge [`ALS-PLAT-CCLI`](nfrith-repos/als/CLAUDE.md).
3. If the platform is ambiguous, use AskUserQuestion:
   - Header: `Platform`
   - Question: `Which ALS platform are you using for this install?`
   - Options:
     - `Claude Code Desktop (Recommended)` — maps to `ALS-PLAT-CDSK`
     - `Claude Code CLI` — maps to `ALS-PLAT-CCLI`

After detection:

- Restate the chosen platform code explicitly.
- Say that platform-specific branching is future work.
- Do not invent new ALS platform codes or silently omit the acknowledgement.

---
description: Restore context from AGENTS.md and PROJECT_STATUS.md, then continue the last task (non-colliding alias of /resume)
agent: build
---

Run the recovery/resume flow. Do not deploy.

Step 1 — Read:
- AGENTS.md (especially section 14)
- PROJECT_STATUS.md
- current `git status`
- current `git diff`
- last 5 `git log` commits

Step 2 — Reconcile PROJECT_STATUS.md with reality:
- is the recorded state still valid?
- was code modified since the checkpoint?
- are there uncommitted changes?
- are there new commits?
- does anything need re-verification?
- If PROJECT_STATUS.md is missing, infer state from git status/diff/log and code structure, create it, and say this is a first-time recovery.
- If the file conflicts with reality, real Git/files win: state the conflict briefly, then continue from reality.

Step 3 — Give a very short recovery summary:
- where we stopped
- what remains
- whether it is currently safe
- the next planned action

Step 4 — If the next action is clear and safe, do it directly. Do not ask "continue?" again.
If it is not safe or not clearly within scope, say so and stop.

Do not deploy. Do not commit, push, rebase, restore, or take any production action; if the recorded next action is a git write or production action, stop after the summary and ask the user for explicit approval first.

$ARGUMENTS

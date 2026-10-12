---
description: Save a recovery checkpoint into PROJECT_STATUS.md without committing, pushing, or deploying
agent: build
---

Save a recovery checkpoint. Do not commit, do not push, do not deploy.

Required workflow:
1. Read AGENTS.md, especially section 14.
2. Check `git status`.
3. Check `git diff`.
4. Summarize the current task and progress.
5. Update `PROJECT_STATUS.md` at the repository root as a short current-state snapshot with:
   - Current Goal
   - Current Task
   - Completed
   - Pending
   - Changed Files
   - Verification
   - Known Issues
   - Git State (branch, dirty/clean, uncommitted files)
   - Deployment Impact (dependencies, env, migrations, restart required)
   - Next Action
   - Last Updated
6. Never write secrets, credentials, `.env` values, sessions, or private/production-sensitive data. Refer to secrets by name only.
7. Overwrite the snapshot; do not append a log.
8. Confirm the checkpoint is saved and state the file path.

$ARGUMENTS

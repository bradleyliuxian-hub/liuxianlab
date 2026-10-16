---
description: Upload to GitHub — run the local pre-push gate, then commit and push
agent: verifier
---
Publish to GitHub:

$ARGUMENTS

A push here is always immediately followed by a server deploy, so it must be deploy-clean.

Steps (in order):
1. Run `scripts/local/pre-push-check.sh` (add `--full` for a release/PR). Do NOT push if it fails.
2. If it fails: report file:line + reason, fix the reported files without auto-fixing logic, re-run, then continue. Never push a failing check.
3. Inspect `git status` / `git diff`; stage only intended files (never `git add .`; never secrets/runtime data).
4. Commit with a concise message matching repo style.
5. `git push origin <current-branch>`.
6. Report: check result, commit SHA, push range, and remaining dirty/untracked files.

Never force-push, reset --hard, or deploy. Do not touch production servers.

# Project Status

Updated: 2026-10-15

> Short current-state snapshot. Overwrite each time; no history, no diffs, no secrets.
> Source of truth is the real repo + Git; if this file disagrees, Git wins.

## Git

- Branch: `main` (query: `git branch --show-current`)
- HEAD: `17dbc98` (query: `git rev-parse --short HEAD`)
- origin/main: in sync
- Working tree: dirty — uncommitted AI/OpenCode dev-system files only
  (no business code). Query: `git status --short`.

## Current Focus

AI / OpenCode control-plane refactor — Phases 1–4 + 4.1 + 4.2 + **final pre-commit
cleanup**. **AI/config files only; no business code changed.** Status = pre-commit
candidate (NOT committed).

- Active skills (exactly 7): `repo-inspector`, `development-task`,
  `contract-review`, `excel-review`, `excel-tail-risk`, `excel-hardcode`,
  `deployment-safety`.
- Candidate commit scope: `AGENTS.md`, `PROJECT_STATUS.md`, `PROJECT_INDEX.md`,
  `.opencode/opencode.json`, `.opencode/skills/**`, `docs/agent/**`,
  `archive/opencode-skills-design/**`. Excludes backups, `ui-ux-pro-max`,
  contract-speed docs.
- Final cleanup fixed broken refs (4× non-existent `archive/liuxianlab-deploy/…`,
  1× stale `AGENTS §3.1`).
- Legacy design skills archived (`archive/opencode-skills-design/`); `ui-ux-pro-max`
  in `.opencode/optional-skills/` (not auto-loaded).

## Known Broken

- None confirmed in the app or the refactor.
- Caveat (not broken): the parent `~/AI-Workspace` has its own `.git` pointing at
  the same origin as this repo — always confirm cwd before Git operations.

## Pending Decision

- Restart OpenCode (config-time changes are not hot-reloaded).
- Routing verification (one real bug / feature / review / deploy request) — **not
  yet run; status UNVERIFIED**.
- Human review of the AI refactor before any commit (scope proposed, see Focus).
- Backup dirs disposition: keep `.opencode-backup/` and `archive/opencode-backup-*`
  untracked (not deleted); decide whether to add a `.gitignore` rule.
- `ui-ux-pro-max`: candidate to move to shared/global skills later (not in repo commit).
- SEPARATE DOCUMENT GOVERNANCE DECISION: `docs/contract-speed-v1.1-*.md` stay untracked.
- Later/separate: parent-repo vs sub-repo Git structure.

## Next Action

1. Restart OpenCode to load the updated `AGENTS.md` / skills.
2. Run representative routing verification.
3. Human review before commit. Do not commit/push/deploy without approval.

## Last Verification

- Final pre-commit cleanup: `git diff --check` clean; exactly 7 active skills;
  `.opencode/opencode.json` valid minimal JSON; candidate scope contains no
  business code / tests / migrations / deps / config / backups / optional-skill /
  contract-speed docs; broken-ref audit fixed (see Focus). Business test suites
  **NOT RUN** this round (no business code changed).
- Historical (previous rounds, not re-run): Node `npm test` 148 pass / 0 fail;
  `services/excel_review` 79 pass; `services/contract_review` 99 pass
  (+2 import errors, `psycopg` missing in venv — environment, unrelated).

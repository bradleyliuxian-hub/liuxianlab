# Project Status

Updated: 2026-10-15

> Short current-state snapshot. Overwrite each time; no history, no diffs, no secrets.
> Source of truth is the real repo + Git; if this file disagrees, Git wins.

## Git

- Branch: `main` (query: `git branch --show-current`)
- HEAD: `51f3ec5` (query: `git rev-parse --short HEAD`)
- Working tree: dirty — uncommitted AI/OpenCode governance files only
  (no business code). Query: `git status --short`.

## Current Focus

AI / OpenCode control-plane + workspace governance cleanup. **AI / config / docs
only; no business code changed.** Status = ready for two governance commits.

- Active skills (exactly 7): `repo-inspector`, `development-task`,
  `contract-review`, `excel-review`, `excel-tail-risk`, `excel-hardcode`,
  `deployment-safety`.
- Hygiene: mechanical backups, the generic `ui-ux-pro-max`, and the retired
  design skills are moved out of the repo to
  `~/AI-Workspace/backups/liuxianlab/` and `~/AI-Workspace/shared-skills/`.
- Contract Review v1.1 knowledge distilled to
  `docs/agent/contract-review/quality-and-cache.md`; original reports archived
  under `docs/archive/contract-review/`.

## Known Broken

- None confirmed in the app.
- Caveat (not broken): the parent `~/AI-Workspace` has its own `.git` pointing at
  the same origin as this repo — always confirm cwd before Git operations.

## Pending Decisions

- Restart OpenCode (config-time changes are not hot-reloaded).
- Routing verification (one real bug / feature / review / deploy request) —
  **not yet run; status UNVERIFIED**.
- Human review, then two scoped commits (governance hygiene; contract-review
  knowledge).
- Later/separate: parent-repo vs sub-repo Git structure.

## Next Action

1. Commit governance changes (two scoped commits) after human review.
2. Restart / new-session verification only if required.
3. Resume normal development.
   Do not push / deploy without explicit approval.

## Last Verification

- Batch D cleanup: `git diff --check` clean; exactly 7 active skills;
  `.opencode/opencode.json` unchanged; no business code / tests / migrations /
  deps touched; no mechanical backup, optional-skill, or generic-skill archive
  remains in the repo. Business test suites **NOT RUN** this round (no business
  code changed).

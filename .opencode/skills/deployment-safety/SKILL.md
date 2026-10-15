---
name: deployment-safety
description: Use for any production question in Liuxian Lab — "上线", "部署", "deploy", "可以上线了吗", release preflight, rollback, PM2/Nginx/migration. Produces a readiness judgment + runbook and BLOCKS unless explicitly approved. Never performs a production action on its own.
---

# deployment-safety

Decide whether a deploy is allowed and produce the check steps. This skill is a
gate, not a launcher: it never pushes, SSHes, restarts PM2, edits Nginx, or runs
migrations without explicit user approval.

## Philosophy

> Simplify the human's input, never simplify the safety checks.

## Preflight checklist (all must be answered from real state)

1. **Production clean** — target release has no uncommitted/unintended changes.
2. **Current health** — `GET /health` -> `{"ok":true}`; app reachable.
3. **Active work** — no queued/processing Contract Review or Excel Review jobs
   and no running parser/worker processes; refuse a restart while active work
   could be interrupted (human-review-pending items do not block).
4. **Git ancestry** — the candidate commit is the intended one and is on `main`
   (verify against origin; do not assume).
5. **Dependency consistency** — a `package.json` dependency-section change
   requires a matching `package-lock.json` change (else NO-GO); any Python
   dependency manifest change needs explicit environment review; no new native deps.
6. **Migration safety** — only newly added migrations may be applied; historical
   migrations are immutable (never edit/rename/delete); additive, idempotent,
   `BEGIN/COMMIT`; destructive SQL (`DROP TABLE`/`COLUMN`, `TRUNCATE`,
   `DELETE FROM`) ⇒ stop; DB reachable.
7. **Backup** — a rollback point exists (previous release/tag or snapshot).
8. **Syntax** — `node --check` on changed JS; `python -m py_compile` on changed Python.
9. **Tests** — run the real suites: `npm test` (Node), excel_review unittest,
   contract_review regression.
10. **MinerU safety** — contract worker/model state untouched unless intended.
11. **Reverse proxy** — Nginx routes/HTTPS unchanged unless part of the change.
12. **Process** — PM2 config/`ecosystem.config.js` correct; restart is the only
    step needed (config files are not hot-reloaded).
13. **Health after** — plan the post-restart `GET /health` and a real request.
14. **Rollback** — code rollback to the previous commit (+ dependency reinstall /
    restart if needed); it does **not** reverse schema — additive DB migrations
    are a separate manual operation.
15. **Concurrency** — only one deployment may run at a time.

## Known facts to re-verify, never assume

- The active deployer (script / runbook) is NOT confirmed in-repo — verify its
  real location and contents before relying on it; do not assume a path.
- Any "Deploy Key" / wrapper activation must be checked in real state, not taken
  from an old handoff.

## Review discipline (GO/NO-GO is read-only)

1. **Review ≠ execution.** A GO/NO-GO audit must NOT auto-run SSH / migration /
   restart / tag / push / deploy. It produces a judgment only.
2. **Three separate questions — never collapse into one "LOCAL GO":**
   - `TARGET COMMIT LOCAL PRECHECK`
   - `CURRENT WORKTREE DEPLOYABILITY`
   - `PRODUCTION GO`
   e.g. target commit: CONDITIONAL GO; dirty worktree as deploy source: NO-GO;
   production GO: UNKNOWN.
3. **Test status vocabulary:** `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`. Import
   errors or missing deps ⇒ never "all green" (e.g. `PARTIAL PASS / BLOCKED BY ENVIRONMENT`).
4. **Read the current deployer/runbook in-repo** (script or `docs/agent/deployment/*`)
   rather than relying on handoff — and still state that the repo's deployer
   implementation ≠ the production environment's current state.
5. **Deployment-order wording:** if only derived from dependencies, write
   `inferred deployment requirement`; only after reading the current deployer is it
   `current deployer behavior` (e.g. "migration before restart").
6. **active-job guard wording:** do not assert "the deployer needs a new guard"
   without reading it. Correct form: "project principle requires an active-job
   guard; this audit did not verify whether the current deployer implements it."

## Output

```
TARGET COMMIT LOCAL PRECHECK:   GO | CONDITIONAL GO | NO-GO   (evidence + status)
CURRENT WORKTREE DEPLOYABILITY: GO | NO-GO                     (clean/dirty)
PRODUCTION GO:                  UNKNOWN unless verified from production
Blockers:  <list>
Pending:   migrations / deps / env names  (inferred vs current-deployer)
Plan:      numbered deploy steps (for the human to approve/run)
Rollback:  <steps>
```

## Rules

- `BLOCKED` unless every checklist item passes or is explicitly waived by the user.
- Never execute production actions here. Approval is required after the preflight.
- Migrations are named and additive-only; if a migration is destructive, stop.
- No secrets in output; refer to env var names only.
- Local tests passing is never written as "can go live"; production GO needs
  production evidence.
- Read `docs/agent/deployment/*` for topology/runbook detail.

# Deployment (production details)

Read on demand. Deployment is a separate phase; see AGENTS §10 and the `deployment-safety` skill.

## Target topology

- Nginx (TLS termination, public 80/443) -> reverse proxy -> Node `127.0.0.1:8080`.
- Node process managed by PM2 via `ecosystem.config.js`.
- Public ports: 80/443 only. The Node port is never exposed.

## Environment (names only)

Set in `.env` (never commit, never print values):

- `PORT` (default 8080), `HOST` (default 127.0.0.1)
- `NODE_ENV=production`
- `SESSION_SECRET` (required in production; app exits if missing)
- `SESSION_DAYS` (default 7)
- `DATABASE_URL` (PostgreSQL, used by contract review)

## Preconditions for production

- Python workers available: MinerU environment (`.mineru/`) + `workers/excel/requirements.txt` installed.
- PostgreSQL reachable and migrations applied (`server/contracts/migrations/`).
- `data/users.json` present with real users (admin-created).

## Deployment invariants (policy)

Stable rules, independent of the current deployer implementation. An archived
deploy script is reference evidence only, never the confirmed active deployer.

- **Active-work protection** — a deploy must refuse to restart while active work
  could be interrupted. Coverage: Contract Review jobs, Excel Review jobs, and
  running parser/worker processes. Items merely waiting on human review are not
  active compute and need not block.
- **Single deployment at a time** — only one deployment may run against
  production concurrently.
- **Dependency consistency** — a `package.json` dependency-section change
  requires a matching `package-lock.json` change, else NO-GO. Any Python
  dependency manifest change (e.g. `requirements.txt`, `pyproject.toml`,
  `poetry.lock`, `services/*/requirements.txt`) requires explicit
  dependency/environment review before deploy.
- **Migration safety** — historical migrations are immutable (never modify,
  rename, or delete an applied migration; add a new one). Automation may apply
  only newly added migration files. Destructive patterns (`DROP TABLE`,
  `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`) require a manual stop and a reviewed
  plan; a pattern scan alone does not prove a migration is safe. Additive /
  backward-compatible remains the project default.
- **Rollback boundary** — rollback is primarily *code* rollback (return to the
  previous commit; reinstall deps if the lock changed; restart). It does not
  reverse schema: additive DB migrations are a separate, manual operation.
- **Health gating** — local service health must pass before a deploy is called
  successful; public/external health is an additional signal and must not
  substitute for local service health.

## Preflight checklist (produce, do not execute)

1. Target branch + candidate commit.
2. Working-tree cleanliness.
3. Dependency changes.
4. Env-var names added/changed.
5. Migration requirements.
6. Python/runtime requirements.
7. PM2 restart/reload requirement.
8. Nginx impact.
9. Health check (`GET /health`) + smoke tests.
10. Rollback plan.
11. Ordered command checklist, clearly marked NOT EXECUTED.

## Hard rules

- Never push / SSH / restart PM2 / modify Nginx / run migrations without explicit user approval after the preflight.
- Claim production success only after production verification.

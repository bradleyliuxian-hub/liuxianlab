# deployment / overview

Production: Nginx + HTTPS -> Node on `127.0.0.1:8080` (PM2 via `ecosystem.config.js`).
See `AGENTS.md` §10 and the `deployment-safety` skill (preflight, approval-gated).

Read when: planning/validating a deploy, migrations, PM2/Nginx.
Authority: `docs/agent/deployment.md` (detailed notes), `ecosystem.config.js`,
real server state. Repo deployer implementation ≠ production's current state.

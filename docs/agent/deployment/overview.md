# deployment / overview

Production: Nginx + HTTPS -> Node on `127.0.0.1:8080` (PM2 via `ecosystem.config.js`).
See `AGENTS.md` §10 and the `deployment-safety` skill (preflight, approval-gated).

Read when: planning/validating a deploy, migrations, PM2/Nginx.
Authority: `docs/agent/deployment.md` (detailed notes), `ecosystem.config.js`,
real server state. `deploy-liuxianlab.sh` at repo root is the reviewed source;
production may still run an older copy until an approved install/replace.
Local orchestration: `scripts/local/deploy-production.sh` (`npm run deploy:prod`);
see `one-click-production-deploy.md`.

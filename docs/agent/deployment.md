# Deployment (production details)

Read on demand. Deployment is a separate phase; see AGENTS §10 and the `deployment-safety` skill.

## Reviewed deployment source

`deploy-liuxianlab.sh` at the repository root is the reviewed source for the
production deployer. It is not automatically installed to
`/usr/local/bin/deploy-liuxianlab.sh`; installing/overwriting production is a
separate approval-gated operation.

Python dependency behavior is documented in
`docs/agent/deployment/python-dependency-management.md`.

Local one-command deployment (`npm run deploy:prod`) is documented in
`docs/agent/deployment/one-click-production-deploy.md`.

Server auto-deployment from latest `origin/main` (`liuxianlab-deploy`) is
documented in `docs/agent/deployment/server-auto-deploy.md`.

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
- Optional contract cloud parsing: `CONTRACT_MINERU_BACKEND=cloud` plus
  `MINERU_API_TOKEN` (names only; see `contract-review/mineru-cloud.md`)
- Per-task cloud tokens: `MINERU_API_TOKEN_ENCRYPTION_KEY` (32 bytes; required
  only when users submit their own token) and optional
  `CONTRACT_CREDENTIAL_TTL_HOURS`

## Preconditions for production

- Python workers available: MinerU environment (`.mineru/`) + `workers/excel/requirements.txt` installed (shared `.venv`: `openpyxl==3.1.5`, `xlrd==2.0.2`; `xlrd` is required for journal-entry `.xls` uploads). The generic manager checks these mappings and can repair missing packages only after explicit approval; see `docs/agent/deployment/python-dependency-management.md`.
- Equity OCR environment: run `scripts/local/setup-equity-ocr.sh` to create `.equity-venv` (PaddleOCR/PaddlePaddle/OpenCV/CairoSVG). The first OCR run downloads the Chinese model; confirm network or pre-seed the model cache. Set `EQUITY_STRUCTURE_PYTHON_BIN` if using another interpreter.
- Flowchart-to-Excel is PAUSED / Coming Soon. It has no production Python dependency manifest; do not add `services/flowchart_excel/requirements.txt` back to the deploy path without an explicit dependency review.
- Equity PNG export also needs system Cairo/Pango and a CJK font. On Ubuntu/Debian install `libcairo2 libpango-1.0-0 libpangocairo-1.0-0 fonts-noto-cjk`; on macOS the wrapper `scripts/local/equity-python` adds Homebrew Cairo paths.
- PostgreSQL reachable and migrations applied (`server/contracts/migrations/`, `server/journal-entry/migrations/`, `server/purchase-reconciliation/migrations/`, `server/equity-structure/migrations/`).
- `data/users.json` present with real users (admin-created).

## 部署不变量（策略）

与当前 deployer 实现无关的稳定规则。归档的 deploy 脚本仅作参考证据，绝非已确认的当前 deployer。

- **活跃工作保护** —— 当重启可能打断正在进行的任务时，部署必须拒绝重启。覆盖：
  Contract Review 任务、Excel Review 任务，以及正在运行的 parser/worker 进程。
  仅等待人工审核的项不算活跃计算，无需阻塞。
- **同一时间仅一次部署** —— 只能有一个部署并发作用于 production。
- **依赖一致性** —— `package.json` 依赖段的变更需要 `package-lock.json` 相应
  变更，否则 NO-GO。Python `requirements*.txt` 由
  `scripts/local/python-dependency-manager.sh` 按
  `scripts/python-environments.tsv` 映射检查；缺失/超范围包仅在显式批准后安装。
  `pyproject.toml`、Poetry、uv、Pipenv 等其他格式仍 fail-closed，必须补显式
  handler，不得默认走 `pip install -r`。
- **迁移安全** —— 历史 migration 不可变（绝不修改、重命名或删除已应用的
  migration；应新增一个）。自动化只可应用新增的 migration 文件。破坏性模式
  （`DROP TABLE`、`DROP COLUMN`、`TRUNCATE`、`DELETE FROM`）需要人工停手并评审
  方案；仅靠模式扫描不能证明 migration 安全。additive / backward-compatible
  仍是项目默认。
- **回滚边界** —— 回滚主要是*代码*回滚（回到上一个 commit；如 lock 变更则重装
  依赖；重启）。它不会回滚 schema：additive DB migration 是独立的、手动操作。
- **健康门** —— 本地服务健康通过后，才能称部署成功；public/external 健康是
  附加信号，不能替代本地服务健康。

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

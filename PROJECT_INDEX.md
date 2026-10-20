# PROJECT_INDEX — "I hit X, read Y"

Knowledge map for this repo. Read `AGENTS.md` and `PROJECT_STATUS.md` first, then
this index, then the smallest set of docs + code for the task. Verify facts
against code and Git; this index only routes, it is not a source of truth.

## How to use

1. Classify the task (this file).
2. Load at most ONE domain skill.
3. Read the listed docs, then the listed code, then run the listed tests.

## Cross-cutting

| Task | Skill | Docs | Code | Tests |
|---|---|---|---|---|
| Resume / status | — | `PROJECT_STATUS.md` | — | — |
| Decide what to read / where is X | `repo-inspector` | `docs/agent/project-map.md` | — | — |
| Turn a request into an executable task spec | `development-task` | `docs/agent/project-map.md` | — | — |
| Generic bug / feature / review / verify | (command + role agent) | `docs/agent/architecture.md` | — | — |
| Deployment readiness | `deployment-safety` | `docs/agent/deployment/*` | `ecosystem.config.js` (deploy script: verify in repo) | — |
| Security / auth | — | `docs/agent/security.md` | `server.js` (`requireAuth`, `sameOriginForStateChange`) | — |

Frontend tools are Vanilla HTML/CSS/JS. Do not introduce React/Vue/Tailwind without explicit approval.

## Excel Review （批注整理 / `/tools/excel-review`）

| Item | Location |
|---|---|
| Skill | `excel-review` |
| Docs | `docs/agent/excel-review/*` |
| Node | `server/excel-review/` (routes, repository, parse-runner, job-factory, encoding, control-log-*) |
| Python | `services/excel_review/` (parser, review_workbook, statistics, control_log, worker) |
| Frontend | `private/tools/excel-review/` |
| Migration | `server/excel-review/migrations/001_excel_review.sql`, `002_excel_review_control_logs.sql` |
| Tests | `tests/excel-review/*`, `services/excel_review/tests/*` |

## Excel 死数检查 （hardcode / `/tools/excel-hardcode-check`）

| Item | Location |
|---|---|
| Skill | `excel-hardcode` |
| Docs | `docs/agent/excel-hardcode/*` |
| Frontend (browser-local) | `private/tools/excel-hardcode-check/` |
| Shared | `private/shared/excel-viewer/*`, `private/shared/excel-highlight/ooxml-highlight.js`, `private/vendor/fflate/` |
| Benchmark | `scripts/local/hardcode-benchmark.js` |
| Tests | `tests/excel-hardcode-check/*` |

## Excel 尾差检查 （tail-risk / decimal / `/tools/excel-decimal-check`）

| Item | Location |
|---|---|
| Skill | `excel-tail-risk` |
| Docs | `docs/agent/excel-tail-risk/*` |
| Frontend (browser-local) | `private/tools/excel-decimal-check/` |
| Shared | `private/shared/excel-viewer/*`, `private/shared/excel-highlight/*`, `private/vendor/fflate/` |
| Tests | `tests/excel-decimal-check/*` |

## Excel 标准化 & 销售/收入分析

| Item | Location |
|---|---|
| Node | `server/excel-standardizer/` (routes, jobs), `server/sales-income/` |
| Python | `services/excel_standardizer/` (processor, preview, audit, job_state, rules/*), `workers/excel/sales_income/*` |
| Frontend | `private/tools/excel-standardizer/`, `private/tools/sales-income-analysis/` |
| Config | `config/excel_profiles/default.json` |
| Docs | `docs/agent/excel-and-sales.md` |

## 采购与退货对抵 （purchase-reconciliation / PostgreSQL）

| Item | Location |
|---|---|
| Node | `server/purchase-reconciliation/` (routes, repository, job-factory, inspection-runner, worker-runner, result-store) |
| Python | `services/purchase_reconciliation/` (schema, column_mapper, excel_reader, engine, exporters, inspection, worker) |
| Frontend | `private/tools/purchase-reconciliation/` |
| Migration | `server/purchase-reconciliation/migrations/001_purchase_reconciliation.sql` |
| Docs | `docs/agent/purchase-reconciliation/web-integration.md` |
| Tests | `tests/purchase-reconciliation/*`, `services/purchase_reconciliation/tests/*` |

## 股权结构图识别 （equity-structure / PaddleOCR）

| Item | Location |
|---|---|
| Node | `server/equity-structure/` (routes, repository, job-factory, worker-runner) |
| Python | `services/equity_structure/` (tiling, ocr_engine, node/line detectors, topology, percentage reader, exporters, worker) |
| Frontend | `private/tools/equity-structure/` |
| Dictionary | `config/equity_structure/company_dictionary.txt` |
| Migration | `server/equity-structure/migrations/001_equity_structure.sql` |
| Setup | `scripts/local/setup-equity-ocr.sh` → `.equity-venv` |
| Docs | `docs/agent/equity-structure/overview.md` |
| Tests | `tests/equity-structure/*`, `services/equity_structure/tests/*` |

## 合同审阅 （contract-review / PostgreSQL）

| Item | Location |
|---|---|
| Skill | `contract-review` |
| Docs | `docs/agent/contract-review/*` (start at `overview.md`; cloud backend: `mineru-cloud.md`) |
| Node | `server/contracts/` (db, repository, review-store, parse-runner, routes) |
| Migrations | `server/contracts/migrations/001..003` |
| Python | `services/contract_review/` |
| Frontend | `private/tools/contract-review/` |
| Tests | `services/contract_review/tests/*` |

> High-risk (auth/DB/MinerU worker). Read the `contract-review` skill invariants
> before changing anything. Only `overview.md` is a routing entry today; the
> large historical handoff is kept as an archive source for a later split.

## Platform / infra

| Item | Location |
|---|---|
| Express app + mounts | `server.js` |
| Dashboard cards | `config/tools.json` |
| Users | `create-user.js`, `list-users.js` (data in gitignored `data/users.json`) |
| Runtime (gitignored) | `sessions/`, `storage/`, `logs/`, `data/`, `.mineru/` |
| Deploy scripts | not in repo — verify (see `deployment-safety`) |

## Hard rules (do not relearn)

- One Excel upload = one job; Control Log is an aggregation layer above jobs.
- **Review / detection tools** (`excel-review`, `excel-tail-risk`, `excel-hardcode`)
  are read-only on the source workbook: never auto-fix or write back the source.
  (This does NOT apply to `excel-standardizer`, which is a transformation tool
  that intentionally produces a new standardized workbook.)
- Never `git add .`, force-push, reset --hard, or deploy without explicit approval.
- Never load >1 domain skill per task unless explicitly cross-module.

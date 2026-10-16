# project-map

Module -> path map for routing. Companion to `PROJECT_INDEX.md`. Read when you
need to know where a module lives before reading code.

- Entry: `server.js` (Express; auth, mounts, static `/app` -> `private/`).
- Dashboard cards: `config/tools.json`.
- Tools (frontend): `private/tools/<slug>/`.
- Excel Review: Node `server/excel-review/`, Python `services/excel_review/`.
- 死数检查: `private/tools/excel-hardcode-check/` (browser-local).
- 尾差检查: `private/tools/excel-decimal-check/` (browser-local).
- Shared viewer/highlight: `private/shared/**`, vendored `private/vendor/**`.
- Excel 标准化: `server/excel-standardizer/`, `services/excel_standardizer/`. 销售分析: `server/sales-income/`, `workers/excel/sales_income/`.
- 合同审阅: `server/contracts/`, `services/contract_review/`, migrations in `server/contracts/migrations/`.
- Runtime (gitignored): `sessions/`, `storage/`, `logs/`, `data/`, `.mineru/`.

Authority: `docs/agent/architecture.md` and the real code. Keep this map updated
when modules move.

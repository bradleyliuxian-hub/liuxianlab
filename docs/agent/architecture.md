# Architecture (runtime topology & module map)

Read on demand. Keep this current; do not load it for simple tasks.

## Process topology (local)

- `server.js` — Express app, single Node process, binds `HOST:PORT` (default `127.0.0.1:8080`).
- Auth: `express-session` + `session-file-store` writing to `sessions/`.
- Python workers run as separate processes (Excel worker / contract worker), orchestrated by Node routes.

## server.js responsibilities

- Security middleware: Helmet + CSP, `express.json({limit:'16kb'})` (contract draft PUT route bypasses to a 5 MB parser in `server/contracts/routes.js`), `express.urlencoded`.
- Session config: cookie `liuxianlab.sid`, `httpOnly`, `sameSite=lax`, `secure` in production, rolling, file store in `sessions/`.
- `requireAuth(req,res,next)` — auth gate; JSON 401 for `/api/*`, redirect to `/login` otherwise.
- `sameOriginForStateChange` — Origin/host check for state-changing requests.
- Login: `POST /api/login` with `loginLimiter` (15 min / 10 attempts) and bcrypt (`data/users.json`, `DUMMY_HASH` for timing safety).
- Public: `/login`, `/login.css`, `/login.js`, `/health`.
- Authenticated: `/api/tools`, `/api/session`, `POST /api/logout`.
- Tool routing: static `/app` -> `private/`, `/` -> `private/index.html`, `/tools/:slug` -> `private/tools/<slug>/index.html` if present else `private/tool.html` placeholder.
- Route mounts:
  - `/api/excel` -> `server/excel/routes.js` (`createExcelRouter`)
  - `/api/sales-income` -> `server/sales-income/inspect-routes.js` + `run-routes.js` + `routes.js`
  - `/api/contracts` -> `server/contracts/routes.js` (`createContractRouter`)
  - `/vendor/pdfjs` -> `node_modules/pdfjs-dist/build` (used by contract review UI)
  - `/tools/contract-review/review` -> `private/tools/contract-review/review.html`

## Frontend layout

- `public/` — login page only (`login.html/.css/.js`).
- `private/` — dashboard (`index.html`, `styles.css`, `script.js`) + placeholder (`tool.html/.css/.js`) + `private/tools/<slug>/`.
- Tools: `excel-standardizer`, `sales-income-analysis`, `contract-review`, scaffold `_template`.

## Backend modules

- `server/contracts/` — `db.js`, `repository.js`, `review-store.js`, `parse-runner.js`, `routes.js`, `migrations/*.sql` (PostgreSQL).
- `server/excel/` — `routes.js`, `jobs.js` (job lifecycle).
- `server/sales-income/` — `routes.js`, `inspect-routes.js`, `run-routes.js`.
- `services/contract_review/` — Python: `database.py`, `mineru_service.py`, `issue_detector.py`, `issue_locator.py`, `consistency_checker.py`, `consistency_artifacts.py`, `review_artifacts.py`, `worker.py`.
- `workers/excel/` — Python: `processor.py`, `preview.py`, `audit.py`, `job_state.py`, `rules/*` (autofit_columns, header_style, normalize_dates, remove_empty_rows, sheet_settings, trim_text), `sales_income/*`.

## Data & config

- `config/tools.json` — dashboard tool cards (source of truth).
- `config/excel_profiles/default.json` — Excel standardization profile.
- Runtime (gitignored): `sessions/`, `storage/` (`storage/excel/...`, `storage/contracts/...`), `logs/`, `data/users.json`.
- `scripts/` — `run_contract_worker.sh`, `patch_mineru_seal.py`, `scripts/local/*` dev helpers.

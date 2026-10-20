# 序时账分析 — Web Integration

## Flow

1. `POST /api/journal-entry-analyses` uploads `.xls` / `.xlsx` to
   `storage/journal-entry/<uuid>/source.*` and creates a `draft` DB row.
2. The upload route synchronously runs the Python inspection CLI. It returns
   sheet list, header candidates, auto-suggested mapping and ambiguity warnings.
3. The browser confirms sheet, header row, amount layout and field mapping, then
   `POST .../:id/preview` runs the normalization-only preview and returns
   cleaning counts, issues and 3 sample vouchers.
4. `POST .../:id/start` validates the same preview, changes the row to `queued`
   and enqueues an in-process worker.
5. The Node runner claims the row (`queued -> running`), spawns
   `python -m services.journal_entry.worker`, and polls `status.json`.
6. The worker writes `result.json` and `journal-entry-analysis-report.xlsx`,
   then reports `completed`; the runner verifies both files before marking the
   DB row completed.
7. The page polls `GET .../:id`, fetches the owner-scoped result JSON and offers
   the owner-scoped Excel export.

No financial rows or descriptions are logged. Only aggregate counts and status
messages are written to Node logs / `status.json`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/journal-entry-analyses/meta` | limits, layouts, mapping fields |
| `POST` | `/api/journal-entry-analyses` | upload -> draft + inspection |
| `GET` | `/api/journal-entry-analyses` | owner history (max 50) |
| `POST` | `/api/journal-entry-analyses/:id/inspect` | re-detect sheet / header |
| `POST` | `/api/journal-entry-analyses/:id/preview` | mapping + cleaning preview |
| `POST` | `/api/journal-entry-analyses/:id/start` | validate, queue, enqueue |
| `GET` | `/api/journal-entry-analyses/:id` | status / progress |
| `GET` | `/api/journal-entry-analyses/:id/result` | full result JSON |
| `GET` | `/api/journal-entry-analyses/:id/export` | Excel report |
| `DELETE` | `/api/journal-entry-analyses/:id` | delete non-active job |

All routes are owner-scoped and mounted behind `requireAuth` +
`sameOriginForStateChange` in `server.js`.

## Files

```text
server/journal-entry/
├── routes.js
├── repository.js
├── job-factory.js
├── preview-runner.js
├── parse-runner.js
└── migrations/001_journal_entry.sql

services/journal_entry/
├── status.py
├── job_io.py
├── preview.py
├── analysis_result.py
├── export.py
└── worker.py

private/tools/journal-entry-analysis/
├── index.html
├── styles.css
└── script.js

tests/journal-entry/routes.test.js
services/journal_entry/tests/test_worker_integration.py
```

## Migration

The migration is **manual and not auto-applied**:

```bash
psql "$DATABASE_URL" -f server/journal-entry/migrations/001_journal_entry.sql
```

It creates `journal_entry_jobs` with owner, status/progress, mapping request,
source/result/export paths, compact summary and timestamps. Apply it before
starting the new Node code; otherwise startup recovery logs a missing-table
error and uploads cannot create jobs.

## Environment

- `JOURNAL_ENTRY_PYTHON_BIN` (fallback `PYTHON_BIN`, then `.venv/bin/python`,
  then `python3`)
- `JOURNAL_ENTRY_TIMEOUT_MS` (default 900000)
- `JOURNAL_ENTRY_PREVIEW_TIMEOUT_MS` (default 120000)
- `JOURNAL_ENTRY_MAX_CONCURRENT` (default 1)
- `JOURNAL_ENTRY_RETENTION_HOURS` (default 72)

Python dependencies: `openpyxl==3.1.5`, `xlrd==2.0.2`.

## Verification

- Python: `.venv/bin/python -m unittest discover -s services/journal_entry/tests -t .`
  — 235 tests.
- Node: `node --test tests/journal-entry/*.test.js` — 9 tests.
- Full `npm test` — 267 tests.
- Real ledger smoke (序时账-巨效001-2025.xls): 8,670 raw rows, 8,668 lines,
  1,674 vouchers, 2 blank-voucher issues, 1,674 exactly balanced, 318 max lines,
  1,000 classified / 674 other, 390 findings / 171 finding vouchers, review rate
  0.102151, worker ~9s / ~240MB peak, export ~1.36MB.
- Mocked browser flow (upload -> mapping -> preview -> result -> voucher detail)
  completed without console exceptions.

## Retention / operations

- Draft / completed / failed rows older than 72h are removed with their job
  directories. Queued/running rows are not cleaned.
- On startup, `running` jobs are marked failed (server restart) and `queued`
  jobs are re-enqueued.
- No shell interpolation; workers are spawned with
  `spawn(python, args, { cwd: root })`.
- Results are private; both JSON and XLSX downloads require login and owner
  match.

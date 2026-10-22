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
  — 257 tests.
- Node: `node --test tests/journal-entry/*.test.js` — 51 tests
  (single routes 17 + batch 16 + queue 2 + splits 9 + presets 3 + cleanup 4).
- Full `npm test` — 456 tests.
- Batch smoke: `npm run smoke:journal-entry`; browser E2E:
  `npm run e2e:journal-entry`.
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

## Batch workspace (v1.1.0)

A batch is an orchestration layer. It never re-implements accounting logic;
each file becomes an ordinary `journal_entry_jobs` child using the existing
single-file inspect / preview / worker / result / export endpoints.

### Model

```text
journal_entry_batches        id, owner_username, name, created_at, updated_at, deleted_at
journal_entry_batch_items    batch_id, job_id, position, original_filename, file_size, created_at
```

Batch status/counts/progress are derived from child `journal_entry_jobs` rows;
there is no second item-status table. Statuses: `draft`, `queued`, `running`,
`completed`, `partial_failed`, `failed`.

The relation table was chosen instead of adding nullable `batch_id` columns to
`journal_entry_jobs`: existing single-file jobs stay untouched, one job can be
listed without batch concerns, and batch deletion/cascade rules stay contained.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/journal-entry-batches/meta` | max files / size limits |
| `POST` | `/api/journal-entry-batches` | multi-file upload -> batch + draft children + inspect |
| `GET` | `/api/journal-entry-batches` | owner batch history |
| `GET` | `/api/journal-entry-batches/:id` | batch detail + child jobs |
| `POST` | `/api/journal-entry-batches/:id/start` | validate all configured drafts, queue all |

Per-file configuration, progress, result and export continue to use
`/api/journal-entry-analyses/:id/*`.

### Limits / validation

- 20 files per batch, 25 MB per file, 100 MB total (memory upload safety).
- Every file independently checks extension + magic bytes before any DB/file
  write; one invalid file rejects the whole upload.
- Upload stores UUID directories; original filenames are display/trace only.
- Upload does not auto-start analysis.
- Start-ready processes only draft children that pass the same single-file
  preview validation. Ready children are queued; unconfigured/invalid drafts
  remain draft. If none are ready, the API returns 422 with structured
  `notReady` reasons; otherwise 202 includes `startedCount`, `skippedCount`,
  `startedJobIds`, and `notReady`. Repeated start-ready only touches drafts.

### UI

`/app/tools/journal-entry-analysis/batch.html` provides multi-file upload,
batch metrics, per-file table, batch history and per-file result/export links.
Per-file mapping reuses the existing single-file page in an embedded iframe
(`index.html?job=<id>&embedded=1`) instead of duplicating mapping logic. The
single page supports `?job=<id>` and hides upload/history/start chrome when
embedded.

Migration: `server/journal-entry/migrations/002_journal_entry_batches.sql`.

One `createJournalEntryRuntime()` instance is created in `server.js` and injected
into both the single-file and batch routers. It owns exactly one process-local
queue, one preview runner, startup recovery and cleanup. Batch children are
ordinary `journal_entry_jobs` rows, so the single startup recovery query requeues
them. `JOURNAL_ENTRY_MAX_CONCURRENT` is global across single and batch work; the
runner's queue/active guards prevent duplicate enqueue.

### Batch summary

`batch.summary` aggregates **completed children only**, using
`journal_entry_jobs.summary_json` (never result.json). Counts are summed.
Rates are weighted:

```text
businessCoverage = sum(business_classified_count) / sum(voucher_count)
reviewRate       = sum(finding_voucher_count) / sum(voucher_count)
```

`finding_count` and `finding_voucher_count` stay separate. Older jobs missing a
field produce `null` for that aggregate (UI shows `—`), never a fabricated 0.
Worker summaries now persist raw/line/voucher/issue/unbalanced/classified/
finding counts for future batches.

## Batch outputs (Phase 4B.1)

Batch outputs are generated by `services/journal_entry/batch_output.py`, which
consumes completed child `result.json` and existing per-file exports. It never
opens source workbooks and never runs Reader / Mapping / Normalize / Business /
Contra / Anomaly.

```text
POST /api/journal-entry-batches/:id/exports
GET  /api/journal-entry-batches/:id/exports/latest
GET  /api/journal-entry-batches/:id/exports/:outputId/{summary|merged|zip}
```

- Only `status = completed` children are included. Draft/queued/running/failed
  children are recorded in the snapshot and manifest with exclusion reasons.
- Zero completed children -> 422.
- Snapshot (`journal_entry_batch_outputs.snapshot_json`) records batch id,
  generated_at, included/excluded job ids and counts, child completion times.
- Output directory: `storage/journal-entry-batches/<batch_id>/<output_id>/`
  with 0700 directory and 0600 files; DB stores relative paths.
- Generation runs in a separate Python process with a timeout and an export
  concurrency limit (`JOURNAL_ENTRY_BATCH_EXPORT_CONCURRENCY`, default 1); it
  does not consume the analysis concurrency slot.
- Missing per-file export is regenerated from the existing result via the
  existing `build_export` helper. Corrupt/missing result fails explicitly.
- Output files: `batch-summary.xlsx`, `merged-standardized-journal.xlsx`,
  `manifest.json`, `batch-report.zip`.
- Summary workbook sheets: 批次概览, 文件清单, 业务分类汇总, 异常汇总,
  数据质量汇总. Rates use the Phase 4A.1 weighted API summary, not averages.
- Merged workbook sheets: 标准分录, 来源文件. Each row carries Batch ID, Job ID,
  original filename, source sheet/row, external line id and internal line key.
  Batch identity is `job_id + internal_line_key`; voucher identity is
  `job_id + voucher_key`. Ordering is batch position → source sheet → source row.
- ZIP entries: three root files plus `reports/NNN-safe-name-分析报告.xlsx`.
  Report names are position-prefixed and sanitized; no absolute paths, `..` or
  backslashes. Per-file exports are file-based archive writes, not all-in-memory.
- Formula-injection protection is shared with the per-file exporter
  (`safe_excel_text` prefixes cells beginning with `=`, `+`, `-`, `@`, tab, CR).

Migration: `server/journal-entry/migrations/003_journal_entry_batch_outputs.sql`.
Output retention/cleanup is deferred.

## Ledger filter & split export (v1.2.0)

Optional canonical fields passed through from explicit mapping (never inferred
from description): `customer_code`, `customer_name`, `supplier_code`,
`supplier_name`, `counterparty_code`, `counterparty_name`. They flow through
`JournalLine` → result lines → per-file export / batch merge / split export.

```text
GET  /api/journal-entry-splits/meta
GET  /api/journal-entry-splits/dimensions?scopeType=&scopeId=&dimension=&q=&limit=
POST /api/journal-entry-splits/preview
POST /api/journal-entry-splits
GET  /api/journal-entry-splits/latest?scopeType=&scopeId=
GET  /api/journal-entry-splits/:id/download
```

- Scope is `job` (completed single job) or `batch` (completed children only).
- Filter first, then group: source file, entity, date range, month, period,
  account, customer, supplier, counterparty, debit/credit min/max.
- Group by: 1–3 ordered dimensions from account (optional prefix N), customer,
  supplier, counterparty, month, period, entity, source file. Duplicate
  dimensions are rejected; ordering changes sheet/file names and hierarchy.
  Structured group keys/values are stored in preview, index and manifest.
- Blank dimension values form 未指定 groups; no rows are dropped.
- Preview returns counts/group summaries only, never all lines. Generate checks
  the expected completed-job set and limits again.
- Limits: multi-sheet 200 groups, ZIP 500, max 1,048,000 rows per sheet; groups
  over the row limit are split into parts. `max_groups`/`max_rows_per_sheet` can
  be lowered server-side.
- Output modes: one workbook with 拆分说明 + 分组索引 + group sheets, or a ZIP
  with one workbook per group plus `manifest.json`.
- Batch identity remains `job_id + internal_line_key` and
  `job_id + voucher_key`; no cross-file voucher merging.
- Full-voucher output mode is explicitly **NOT IMPLEMENTED** (UI disabled, API
  rejects).
- Snapshot/request/filter/group specs are persisted in
  `journal_entry_split_outputs`; download requires owner and scope ownership.
  Optional `preset_id` and `preset_name_at_generation` are recorded, but the
  full actual spec is always saved so later preset edits do not change history.
- Saved presets: `/api/journal-entry-split-presets` CRUD, owner-scoped,
  validated by the same filter/group schema. Built-in templates are returned
  by `/api/journal-entry-splits/meta` and are not persisted per user.
- Output directory: `storage/journal-entry-splits/<output_id>/`, 0700, files
  0600. Formula injection and ZIP Slip protections are shared with earlier
  exporters.
- Migration: `server/journal-entry/migrations/004_journal_entry_split_outputs.sql`,
  `005_journal_entry_split_presets.sql`,
  `006_journal_entry_storage_lifecycle.sql`.

## Storage lifecycle (v1.3.0)

- Job source/meta/request/status/result/export live under
  `storage/journal-entry/<job_id>/`; Batch metadata in `journal_entry_batches`
  + `journal_entry_batch_items`; Batch output files under
  `storage/journal-entry-batches/<batch_id>/<output_id>/`; Split output files
  under `storage/journal-entry-splits/<output_id>/`; presets are DB-only.
- Default retention is 72h (`JOURNAL_ENTRY_RETENTION_HOURS`,
  `JOURNAL_ENTRY_OUTPUT_RETENTION_HOURS`). Orphan safety is 24h
  (`JOURNAL_ENTRY_ORPHAN_SAFETY_HOURS`).
- Single-job user delete soft-deletes the row, detaches it from batch items,
  removes the job directory and hides it from single history.
- Batch delete is refused while any child is queued/running or any output is
  generating; it soft-deletes the batch, removes batch items, expires batch
  outputs and scoped split outputs/files, and **retains child single-file jobs**.
- Batch/split output delete/retention marks `expired_at`, clears file paths,
  removes the controlled output directory, and keeps metadata so the UI can
  show “已过期，请重新生成”. Presets are never removed by output retention.
- Active jobs/output generation are never cleaned. Expired jobs are
  draft/completed/failed older than retention; queued/running are excluded.
- Empty/deleted batches are purged after retention; presets only purge after
  explicit soft delete.
- Cleanup uses storage-root containment + realpath checks, removes symlinks
  themselves rather than following them, and never follows a symlink escape.
- Scheduled once by the shared Journal Entry runtime; manual command:
  `npm run cleanup:journal-entry -- --dry-run` / without `--dry-run` for real
  cleanup. Deployment checks include batch-output/split-export Python processes.


## Split export columns (v1.3.2)

- Split export accepts `columns` as an ordered list of stable column IDs.
- Definitions: core financial, auxiliary, other business, source, and
  advanced/system groups. Defaults are human-facing columns; advanced system
  keys are off by default.
- Preview returns `column_stats`, `selected_columns`, and `column_order` based
  on the filtered dataset. Empty strings/null are empty; decimal zero and false
  are not empty.
- Snapshot/output metadata records `selected_columns` and `column_order`.
- Presets persist `columns`; presets without columns fall back to the
  human-facing defaults.
- Multi-sheet and ZIP exports use the same ordered column schema; the split
  description/index sheets keep their fixed structure.
- Single-file standard journal and batch merged journal use Chinese,
  human-facing default columns with technical traceability moved to the tail.

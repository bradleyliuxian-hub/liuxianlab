# Excel standardizer & sales-income analysis

Read on demand. Both tools are Node routes + Python workers.

## Excel standardizer

- UI: `private/tools/excel-standardizer/` (`index.html`, `script.js`, `styles.css`).
- API: `/api/excel` -> `server/excel/routes.js` (`createExcelRouter`), job lifecycle in `server/excel/jobs.js`.
- Worker: `workers/excel/`
  - `processor.py` — main processing entry.
  - `job_state.py` — job state persistence.
  - `preview.py` — preview generation.
  - `audit.py` — audit output.
  - `rules/` — ordered rule modules: `remove_empty_rows.py`, `trim_text.py`, `normalize_dates.py`, `header_style.py`, `autofit_columns.py`, `sheet_settings.py`.
  - `requirements.txt` — worker Python deps.
- Profile: `config/excel_profiles/default.json`.
- The `rules/*` modules are individually SIMPLE/MEDIUM to change; the job lifecycle is MEDIUM.

## Sales-income analysis

- UI: `private/tools/sales-income-analysis/` (`index.html`, `script.js`, `styles.css`).
- API: `/api/sales-income` -> three routers:
  - `server/sales-income/inspect-routes.js` — inspect an uploaded workbook.
  - `server/sales-income/run-routes.js` — run the analysis.
  - `server/sales-income/routes.js` — shared/aggregate routes.
- Worker: `workers/excel/sales_income/`
  - `main.py` — entry, `inspect_excel.py` — workbook inspection, `sales.py` — sales calc, `income.py` — income calc, `exporter.py` — result export, `rules.py` — shared rules.
- Storage (gitignored): `storage/excel/sales-income/jobs/<uuid>/{config.json, input/input.xlsx, job.json, output/*.xlsx}`.

## Notes

- Changing rule math is MEDIUM (verify with a small fixture); changing the job schema or storage layout is COMPLEX.
- Do not commit `storage/` outputs or user spreadsheets.

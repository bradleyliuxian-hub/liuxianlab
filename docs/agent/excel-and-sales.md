# Excel standardizer & sales-income analysis

Read on demand. Both tools are Node routes + Python workers.

## Excel standardizer

- UI: `private/tools/excel-standardizer/` (`index.html`, `script.js`, `styles.css`).
- API: `/api/excel` -> `server/excel-standardizer/routes.js` (`createExcelRouter`), job lifecycle in `server/excel-standardizer/jobs.js`.
- Worker: `services/excel_standardizer/`
  - `processor.py` — main processing entry; reads each job's `selection` and executes only selected features.
  - `job_state.py` — job state persistence.
  - `preview.py` — preview generation.
  - `audit.py` — audit output.
  - `rules/` — implementation modules: `trim_text.py`, `normalize_dates.py`, `header_style.py`, `autofit_columns.py`, `sheet_settings.py`, `remove_empty_rows.py`.
- Profile: `config/excel_profiles/default.json` stores rule parameters plus recommended selection defaults.
- Python deps remain shared in the project's existing environment/manifest; do not add `services/excel_standardizer/requirements.txt`.

### Selectable features (v1.1.0)

The browser exposes 8 per-job checkboxes. The selection is posted as multipart field `selection` (JSON), stored in `job.json`, returned by the job API, and copied into `result.json` summary.

1. `trim_text` — remove leading/trailing text whitespace.
2. `normalize_dates` — date cells -> `yyyy-mm-dd`.
3. `normalize_datetime` — datetime cells -> `yyyy-mm-dd hh:mm`.
4. `header_style` — first-row header style.
5. `autofit_columns` — column width adjustment.
6. `freeze_header` — freeze first row (`A2`).
7. `auto_filter` — set the current worksheet data range as auto-filter.
8. `remove_empty_rows` — delete fully empty rows (not recommended by default because formulas can be affected).

Recommended selection: all except `normalize_datetime` and `remove_empty_rows`. At least one feature must be selected. Date/datetime and freeze/filter are intentionally independent even though they reuse the same underlying Python modules.

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

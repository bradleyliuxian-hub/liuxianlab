# excel-review / control-log

Multi-file aggregation layer.

- DB: `excel_review_control_logs` + `excel_review_control_log_jobs`
  (migration `002_excel_review_control_logs.sql`).
- Node: `control-log-{routes,repository,runner}.js`; Python `control_log.py` +
  `control_log_worker.py`.
- Snapshot `control_log.json` + `control_log.xlsx` per log (self-contained;
  survives source-job deletion).
- Identity: `control_log_id + control_item_id`; provenance via
  `source_job_id + source_item_id`. Questions only (replies excluded).
- Workbook: Dashboard / Control Log / Source Files / hidden `_Mapping`.

Read when: Control Log create/list/download/delete, stats, identity.

Tests: `services/excel_review/tests/test_control_log.py`.

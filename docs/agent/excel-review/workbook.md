# excel-review / workbook

Review workbook layout (`review.xlsx`) + Control Log workbook.

- `services/excel_review/review_workbook.py`: Dashboard + 新版批注 / 旧版批注 +
  hidden `_Mapping`; no worksheet protection; F5 `Excel Address` per row.
- One threaded thread = one row (replies merged into 回复).
- `statistics.py` is the single stats object for web + Dashboard.
- Control Log workbook built by `control_log.py` (see control-log.md).

Read when: workbook columns, dashboard formulas, mapping, F5 address.

Tests: `services/excel_review/tests/*`.

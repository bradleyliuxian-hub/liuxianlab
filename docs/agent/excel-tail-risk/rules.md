# excel-tail-risk / rules

- Hit when `effectiveDecimalPlaces(actualValue)` > 2 (or > 15 / uncached).
- Trailing zeros and JS float noise are not hits.
- Formula cells: use cached result; no cache -> "不可判定" (never guess).
- Number roles (control/period/unit/logical) follow `decimal-core.js`.
- Date-formatted numeric cells are excluded.

Read when: threshold/role logic, exemptions, classification.

Authority: `decimal-core.js`, `decimal-workbook.js`, tests.

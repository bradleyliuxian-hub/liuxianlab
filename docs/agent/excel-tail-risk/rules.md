# excel-tail-risk / rules

- Hit when `effectiveDecimalPlaces(actualValue)` > `allowedDecimalPlaces` for the
  cell's business type (2 for normal_number, 4 for exchange_rate; percentage is
  separate; suspected_exchange_rate is NOT exempted and uses 2).
- Business type is context-detected (`business-type.js`), never from value range.
- Trailing zeros and JS float noise are not hits.
- Formula cells: use cached result; no cache -> `unknown` (never guess).
- Date-formatted numeric cells are excluded.
- Category priority (first match wins): `hidden` (only when 隐藏区域 is checked)
  > `unknown` > `percentage` > `exchange_rate` > `formula` > `raw`.
- Percentage is decided by Number Format (`%` semantics; escaped `\%` / quoted
  `"%"` are literals). Percentages NEVER enter the numeric/formula lists.
- Hidden rows/cols/sheets come from `!rows[].hidden`, `!cols[].hidden`,
  `wb.Workbook.Sheets[].Hidden`; hidden findings are a separate category.
- Reference fields on every issue: `directReferenceCount` (直接引用数) and
  `downstreamReferenceCount` (下游引用数, unique reachable nodes) plus
  `hasCircularDependency`.
- Default ordering: risk level, then downstream desc, then direct desc.

Read when: threshold/role logic, exemptions, category routing, ordering.

Authority: `decimal-core.js`, `risk-core.js`, `reference-map.js`,
`decimal-workbook.js`, tests.

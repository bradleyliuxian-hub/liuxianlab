# excel-tail-risk / testing

- `node --test tests/excel-decimal-check/*.test.js` (also in `npm test`).
- Files: `decimal-core.test.js`, `reference-map.test.js`, `risk-core.test.js`,
  `business-type.test.js`, `decimal-workbook.test.js`, `issue-filters.test.js`,
  `stress.test.js`.
- Cover: decimal rules (10 / 10.1 / 10.12 / 10.120 ok; 10.123 / -10.123 / 0.001
  hits; 0.1+0.2 not a hit), no auto-fix helpers exported, percentage isolated
  from raw/formula, hidden row/col/sheet excluded unless included, direct
  reference count, downstream reach (chain / diamond de-dup / cycle / cross-sheet),
  tricky sheet names + F5 escaping, unknown formula result, risk levels, sort
  modes, exchange-rate detection (title / pair / named range / referenced
  source / suspected) and its 4-decimal allowance, 7-sheet export ordering,
  read-only (workbook unchanged), and a large-workbook dependency-graph
  performance guard (not O(n^2)).

Read when: writing/repairing tests.

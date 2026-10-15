# excel-tail-risk / testing

- `node --test tests/excel-decimal-check/*.test.js` (also in `npm test`).
- Cover: non-ASCII filenames, trailing zeros, float noise, formula cache,
  highlight exclusivity for IGNORE, workbook not mutated.

Read when: writing/repairing tests.

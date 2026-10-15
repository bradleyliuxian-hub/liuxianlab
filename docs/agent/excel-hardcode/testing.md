# excel-hardcode / testing

- `node --test tests/excel-hardcode-check/*.test.js` (also in `npm test`).
- The stress fixture (`tests/excel-hardcode-check/fixtures/hardcode_stress_v1.xlsx`)
  encodes the rule contract — keep it green; never edit expectations to pass.
- Real-file sanity: `node scripts/local/hardcode-benchmark.js "<file.xlsx>"`.

Read when: writing/repairing rules, parser, viewer, or highlight tests.

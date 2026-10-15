# excel-hardcode / formula-parser

- `formula-parser.js`: tokenizer + AST; classifies numeric literals by role
  (control/allocation, unit conversion, business, logical, date, string, array).
- `formula-pattern.js`: relative-reference standardization, pattern compare,
  reference-vs-constant, extra-constant, ROUND-tail plug detection.

Authority: the two modules + `tests/excel-hardcode-check/*`.

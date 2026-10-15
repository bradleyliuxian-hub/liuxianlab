# excel-hardcode / rules-notice (HC201-HC205) + IGNORE (HC901+)

- Notices: arithmetic constant / ratio / period / unit / repeated hardcode.
- IGNORE: strings, control args, absolute refs, date args, arrays, blanks.
- HC204 `=A1/1000` standalone remains a notice; inside ROUND it is exempt.

Authority: `hardcode-core.js`, `formula-parser.js` + tests.

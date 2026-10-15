# excel-review / upload

Paths & flow for upload (single, multiple, and `.zip`).

- `server/excel-review/routes.js` -> `POST /api/excel-reviews` (single),
  `POST /api/excel-reviews/archive` (zip -> one job per `.xlsx`).
- `server/excel-review/job-factory.js#createExcelReviewJobFromBuffer` is the ONE
  job creator used by single + archive; keeps dir/source/meta + DB + enqueue.
- Multipart filenames decode as UTF-8 (`defParamCharset`); `encoding.js` repairs
  legacy mojibake on read.
- Archive-vs-workbook decided by route + extension, never by PK magic (`.xlsx`
  is itself a ZIP).
- Errors: typed codes (`INVALID_XLSX`, `DB_UNAVAILABLE`, ...); DB outage -> 503.

Read when: upload/extraction fails, zip issues, filename encoding, batch.

Tests: `tests/excel-review/upload-pipeline.test.js`, `archive.test.js`,
`encoding.test.js`.

# Contract review (core flow)

Read on demand. The contract-review tool is the most complex, highest-risk module.

## Entry points

- UI: `/tools/contract-review` (upload/parse page: `private/tools/contract-review/index.html` + `workflow.js`, `script.js`, `contract-history.js`) and `/tools/contract-review/review` (`review.html` + `review.js`, `review-fields.js`, `review-issues.js`, `review-guide.js`).
- API: `/api/contracts/*` -> `server/contracts/routes.js` (`createContractRouter`).
- PDF rendering: `/vendor/pdfjs` static from `node_modules/pdfjs-dist/build`.

## Server side

- `server/contracts/db.js` — PostgreSQL pool (`DATABASE_URL`).
- `server/contracts/migrations/` — `001_contracts.sql`, `002_contract_soft_delete.sql`.
- `server/contracts/repository.js` — persistence (contracts, soft delete).
- `server/contracts/review-store.js` — review draft/fields persistence.
- `server/contracts/parse-runner.js` — launches the Python parse/worker flow.
- The contract draft PUT route (`PUT /api/contracts/:id/draft`) uses its own 5 MB JSON parser (bypasses the global 16 KB parser in `server.js`).

## Python service (`services/contract_review/`)

- `mineru_service.py` — OCR/parse via MinerU (see `.mineru/`, `scripts/patch_mineru_seal.py`).
- `issue_detector.py`, `issue_locator.py` — detect and locate review issues in the draft.
- `consistency_checker.py`, `consistency_artifacts.py` — consistency checks/artifacts.
- `review_artifacts.py` — build review artifacts.
- `database.py` — DB access matching the migrations.
- `worker.py` — background worker entry (run via `scripts/run_contract_worker.sh`).

## Storage layout (gitignored, per contract UUID)

```text
storage/contracts/<uuid>/
├── source.pdf
├── job.json
├── parsed/
│   ├── document.raw.md / document.draft.md
│   ├── document.fields.json / document.structured.json / document.middle.json
│   ├── issues.json
│   ├── mineru-export/...          # MinerU output (markdown.md, model_output.json, images/, mineru-output.zip)
│   └── mineru.log
└── final/document.md
```

## Notes / risks

- Touch `requireAuth`/same-origin, upload limits, path handling, SQL, and worker lifecycle with care.
- Migrations and the Python worker are COMPLEX changes (see AGENTS §5).
- Never read/print contract contents or `.env` unless the task requires it.

# Contract review (core flow)

Read on demand. The contract-review tool is the most complex, highest-risk module.

## Entry points

- UI: `/tools/contract-review` (upload/parse page: `private/tools/contract-review/index.html` + `workflow.js`, `script.js`, `contract-history.js`) and `/tools/contract-review/review` (`review.html` + `review.js`, `review-fields.js`, `review-issues.js`, `review-guide.js`).
- API: `/api/contracts/*` -> `server/contracts/routes.js` (`createContractRouter`).
- PDF rendering: `/vendor/pdfjs` static from `node_modules/pdfjs-dist/build`.

## Server side

- `server/contracts/db.js` — PostgreSQL pool (`DATABASE_URL`).
- `server/contracts/migrations/` — `001..004` (004 adds per-contract backend and
  encrypted credential storage).
- `server/contracts/repository.js` — persistence (contracts, soft delete).
- `server/contracts/review-store.js` — review draft/fields persistence.
- `server/contracts/token-crypto.js` — AES-256-GCM for per-task cloud tokens.
- `server/contracts/contract-options.js` — pure parse-mode/backend/consent/token
  upload validation.
- `server/contracts/parse-runner.js` — launches the Python parse/worker flow.
- `contract_credentials` — encrypted per-task MinerU tokens only; never plaintext
  (see `contract-review/mineru-cloud.md`).
- The contract draft PUT route (`PUT /api/contracts/:id/draft`) uses its own 5 MB JSON parser (bypasses the global 16 KB parser in `server.js`).

## Python service (`services/contract_review/`)

- `mineru_service.py` — backend dispatcher: local MinerU CLI (default) or cloud
  API v4 (see `mineru-cloud.md`; local details in `.mineru/`,
  `scripts/patch_mineru_seal.py`).
- `mineru_api_client.py` — stdlib MinerU cloud client + output adapter. It only
  executes/uploads/downloads/adapts; mode, gate, and integrity decisions stay in
  `worker.py` / `quality_gate.py` / `critical_integrity.py`.
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
│   ├── mineru-export/...          # local MinerU output (markdown.md, model_output.json, images/, mineru-output.zip)
│   ├── mineru-cloud-export/...    # cloud output when CONTRACT_MINERU_BACKEND=cloud
│   ├── mineru-cloud-output.zip    # cloud result ZIP (diagnostics)
│   └── mineru.log
└── final/document.md
```

## Notes / risks

- Touch `requireAuth`/same-origin, upload limits, path handling, SQL, and worker lifecycle with care.
- Migrations and the Python worker are COMPLEX changes (see AGENTS §5).
- Never read/print contract contents or `.env` unless the task requires it.

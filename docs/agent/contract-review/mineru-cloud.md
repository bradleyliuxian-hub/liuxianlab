# contract-review / MinerU cloud backend

Optional execution backend for the existing contract parse pipeline. It does
not change modes, quality gates, critical-integrity checks, review artifacts, or
the local MinerU rollback path.

Authoritative source: `services/contract_review/mineru_api_client.py`,
`mineru_service.py`, `parse_profile.py`, `worker.py`.

## UI and per-contract selection

The upload page (`/tools/contract-review`) now has two independent choices:

- **解析引擎**: 本地解析 (default) / 云端解析.
- **解析模式**: 自动 / 快速 / 高精度 (unchanged, independent of engine).

Any combination is valid: local+AUTO, cloud+FAST, cloud+ACCURATE, etc. Cloud is
never treated as ACCURATE, and choosing cloud never changes the mode.

The browser submits `parserBackend=local|cloud` and `parseMode=auto|fast|accurate`.
Cloud submissions additionally send `cloudProcessingConsent=true` and, when the
user chooses to use a task-specific token, `mineruApiToken`. The backend rejects
cloud requests without consent or without any token source.

`GET /api/contracts/cloud-config` returns only two booleans:
`serverTokenConfigured` and `encryptionKeyConfigured`. "Configured" means the
environment value is non-empty; it does not validate the token against MinerU.
The endpoint never returns a token, key, or MinerU base URL.

## Per-contract backend storage

`contracts.parse_backend_requested` is `local | cloud`, default `local`.
Migration `004_contract_parser_backend.sql` backfills historical rows to `local`.
The worker reads this column for each job; it does **not** switch a process-wide
environment variable between jobs.

`CONTRACT_MINERU_BACKEND` remains only as the legacy fallback for a record with a
NULL/blank backend (defensive; migration backfills old rows to local).

- `local` = pinned local MinerU CLI (`LIUXIANLAB_MINERU_PRODUCTION_ENV_V1`).
- `cloud` = MinerU precise-parse API v4 (`MINERU_API_*`).
- An unknown backend value raises; it never silently changes execution.
- The normal worker is spawned by `server/contracts/parse-runner.js`, inheriting
  Node's dotenv-loaded environment. `scripts/run_contract_worker.sh` does not
  source `.env`; if it is run manually, export the variables first.
- Rollback: set the affected contract's `parse_backend_requested='local'` (or let
  new uploads choose local). Old code can run against the additive schema; local
  MinerU and `LIUXIANLAB_SAFE_SEAL_CROP_V3` are untouched.
- Backend is part of the parser signature, so local and cloud cache entries are
  isolated. Switching backend never restores the other backend's artifacts.

## Token sources, encryption, and lifecycle

Priority for a cloud job:

1. Per-task token submitted in the UI (encrypted at rest).
2. Server `MINERU_API_TOKEN`.
3. Reject the upload (or the job, if the stored credential expired).

Per-task token handling:

- Node encrypts with AES-256-GCM (`server/contracts/token-crypto.js`).
- Key: `MINERU_API_TOKEN_ENCRYPTION_KEY`, 32 bytes as 64 hex chars or base64.
  Generate with `openssl rand -hex 32`.
- AAD binds ciphertext to `contract_id` + `owner_username`; swapping rows fails.
- `contract_credentials` stores ciphertext / 12-byte IV / 16-byte auth tag /
  key version / expiry. Plaintext is never stored in PostgreSQL, `job.json`,
  metrics, logs, cookies, local/session storage, or URLs.
- Python (`services/contract_review/credential_store.py`) lazily imports
  `cryptography` and decrypts only the current contract's row.
- The worker deletes the row in a `finally` block on success or failure. A crash
  is covered by `expires_at` plus `prune_expired_credentials()` on worker start.
- `CONTRACT_CREDENTIAL_TTL_HOURS` (1-168, default 24) sets the expiry.
- If the user supplies a token but the server has no encryption key, upload is
  rejected; there is no plaintext fallback. If the server token is configured,
  the user can leave the field blank.
- `MINERU_API_BASE_URL` is server-only; the browser cannot set an arbitrary URL.

## Tier -> cloud model mapping

| Product mode | Local tier | Cloud model (default) |
|---|---|---|
| FAST | basic | `pipeline` |
| ACCURATE | standard | `vlm` |
| AUTO | basic, then standard on gate/integrity failure | `pipeline`, then `vlm` |

This mapping is a **product policy**, not a claim that `pipeline`/`vlm` are
semantically identical to local `basic`/`standard`. Override with
`MINERU_API_MODEL_BASIC` / `MINERU_API_MODEL_STANDARD`.

Modes are unchanged:

- FAST = basic only; never auto-upgrades.
- ACCURATE = standard only.
- AUTO = basic -> structural Quality Gate -> Critical Integrity -> optional
  standard; standard is still not ground truth.

## API flow

1. `POST /file-urls/batch` with one file (`name`, `data_id`, `is_ocr`) and the
   selected `model_version`.
2. `PUT` the private source PDF to the returned signed URL. No Authorization and
   no Content-Type header is sent.
3. Poll `GET /extract-results/batch/{batch_id}`.
4. Match the result by `data_id`; a filename match is used only when the API
   omitted `data_id`. Multiple unmatched results are rejected rather than
   randomly selected.
5. On `done`, download `full_zip_url` with HTTPS, timeout, and size limits.
6. Extract with traversal / symlink / archive-size guards.
7. Adapt the artifacts before the existing gates run.

Non-terminal states handled: `waiting-file`, `pending`, `uploading`, `running`,
`converting`. Terminal: `done`, `failed`.

## Output mapping

| Cloud ZIP | Stable artifact | Notes |
|---|---|---|
| `full.md` | `parsed/document.raw.md` | UTF-8 validation; empty file is an error; OCR text is not auto-corrected |
| `layout.json` (middle.json) | `parsed/document.middle.json` | Validated/converted, not merely renamed |
| `*_content_list.json` | `parsed/document.structured.json` | Cloud-native content list; preferred over model JSON |
| `*_model.json` | `parsed/document.structured.json` fallback | Only when content list is absent |
| whole ZIP | `parsed/mineru-cloud-output.zip` | Retained for diagnostics |
| extracted tree | `parsed/mineru-cloud-export/` | Images and HTML references preserved |
| sanitized events | `parsed/mineru.log` | No token, no signed URL, no contract text |

### Middle JSON adapter

The adapter accepts:

- `{"pages": [...]}` (MinerU 4 middle/layout shape);
- a list of pages;
- a `{"pages": {index: page}}` mapping;
- legacy `{"pdf_info": [...]}` with `preproc_blocks` / `para_blocks` / `lines`.

It normalizes each page/block but preserves the data:

- `page_idx` (zero-based; missing -> positional index);
- `blocks` (also accepts `preproc_blocks`, `para_blocks`, `layout_blocks`,
  `lines`);
- `bbox` as a 4-number list (MinerU 4 middle JSON uses normalized coordinates);
- `content` from `content` / `text` / `value`, or flattened `lines` / `spans`
  text when the newer block has no direct content string; original child nodes
  are retained as `contentNodes` so the issue locator can still prefer a
  smaller child bbox;
- `type` from `type` / `block_type` / `category` / `label`.

If `layout.json` is absent or invalid and a `*_content_list.json` exists, a
conservative fallback builds pages from `page_idx` + `bbox` + text. The fallback
is recorded in `mineru.log` and in the result (`middle_json_source`). It never
fabricates empty blocks or an empty middle JSON to make the Quality Gate pass.

`bbox` coordinate semantics are inherited from the cloud payload. MinerU 4's
middle JSON contract uses normalized coordinates; this was **not** re-verified
against a live cloud result in this change. If a live payload uses absolute
coordinates, the adapter must be extended (with a fixture) before relying on PDF
highlight positioning.

## Errors vs AUTO fallback

Only these can trigger AUTO's Standard fallback:

- structural Quality Gate failure;
- critical-integrity `requiresStandard`.

These fail the job with a diagnostic error and never masquerade as a gate
failure:

- missing/invalid token;
- network timeout/refusal;
- upload-URL failure;
- upload failure;
- API `failed` state;
- result download/extract failure;
- missing/invalid required artifacts.

AUTO does not resubmit a cloud task because a transport call failed. Bounded
retries apply to idempotent operations (poll, signed PUT, ZIP download); the
upload-URL POST is not retried automatically, to avoid duplicate cloud tasks.
The poll timeout fails the job and tells the user the task may still be running
in the cloud; it does not silently start a new parse.

## Security

- `MINERU_API_TOKEN` is read from the environment only. It is not written to the
  repo, logs, errors, browser responses, or URLs.
- Per-task tokens are accepted only over authenticated HTTPS requests, encrypted
  immediately, and never written to ordinary job files or metrics.
- The browser never receives the server token and cannot choose a Base URL.
- Signed upload/download URLs are not logged or exposed to the browser.
- The upload PUT carries no Authorization header.
- API base and result downloads must use HTTPS (an explicit test-only insecure
  override exists for local experiments).
- ZIP extraction rejects absolute paths, `..`, symlinks, too many files, and
  oversized uncompressed content.
- Source PDF path must stay under `storage/contracts/`.
- API limits enforced locally: 200 MB source, 200 pages when the source page
  count is known.
- Enabling cloud sends the contract PDF to MinerU. Confirm the applicable data
  processing / confidentiality requirements before enabling it in production.

## Quality/cache consequences

- `parse_metrics` records `parseBackend`, `parseModelVersion`, and the existing
  gate/integrity/timing metrics. No token is stored there.
- Cache keys/paths include owner + source SHA256 + tier + parser signature, and
  the signature includes backend + cloud model + OCR/table/formula settings.
  Local, cloud-pipeline, and cloud-vlm entries are isolated.
- Cache hits never call the cloud API and never require a token; they still run
  the current Quality Gate and Critical Integrity checks.
- `CONTRACT_PARSE_PROFILE_VERSION` remains `v1.2.0`; per-task backend selection
  does not change parser output for a given backend/model.

## Migration / deployment

- `server/contracts/migrations/004_contract_parser_backend.sql`:
  - adds `contracts.parse_backend_requested` (backfill `local`, default `local`,
    NOT NULL, CHECK local/cloud);
  - creates `contract_credentials` (FK to contracts, ciphertext/IV/tag,
    expiry) and its indexes.
- It is additive and does not modify `001..003` or delete data.
- Deploy order: apply migration 004 first, then restart Node/worker with the new
  code. (The new INSERT/SELECT references the column.)
- Old code can still run against the expanded schema; rolling back code does not
  require a DB rollback. The extra column/table is ignored by old code.
- Do not run this migration against production from a development machine; use
  the approved production deploy process.

## Tests

```bash
.mineru/bin/python -m unittest discover -s services/contract_review/tests -t .
node --test tests/contracts/*.test.js
node --check server/contracts/routes.js
git diff --check
```

The cross-language credential test runs a test-only Node bridge
(`tests/contracts/helpers/token-crypto-bridge.js`) and decrypts with Python. It
uses a fictional token and a test key; it never calls MinerU.

## Not yet verified

- Real MinerU cloud API (no token used, no contract uploaded, no quota spent).
- Live `layout.json` shape / bbox semantics from the cloud service.
- Production deployment, PM2 restart, and migration execution.
- The current environment's production `.env` values.

# contract-review / quality & cache

Stable rules for the Contract Digitization parse pipeline (modes, quality gate,
AUTO fallback, artifact cache, progress). Authoritative source is the code:
`services/contract_review/{parse_profile,quality_gate,parse_cache,worker,mineru_service}.py`.
Read this for intent; read the code for exact behaviour.

## Backend

Each contract stores `parse_backend_requested` (`local` default | `cloud`). The
worker resolves the backend per job; `CONTRACT_MINERU_BACKEND` is only the legacy
default for old/blank records.

- `local` — pinned local MinerU CLI; the rollback path.
- `cloud` — MinerU precise-parse API v4; see `mineru-cloud.md`.

Tier selection and all gates are unchanged. The backend is part of the parser
signature, so local/cloud cache entries are isolated. API/network errors fail the
job; they are **not** converted into a Quality Gate failure and therefore cannot
trigger AUTO fallback. A cloud cache hit does not require a token or call the
API.

## Modes → tier

Modes are user intent; tiers are what MinerU actually runs. Two modes can map to
the same tier. For the cloud backend, the product-policy mapping is
`basic -> pipeline`, `standard -> vlm` (configurable; not an equivalence claim).

- `FAST` → Basic only; never falls back.
- `ACCURATE` → Standard only.
- `AUTO` (default) → tries Basic first and may fall back to Standard.

`normalize_mode()` maps missing/unknown → `AUTO` (old clients stay compatible);
`is_valid_mode()` is the strict upload-API check (unknown → HTTP 400).
`initial_tier_for_mode()`: ACCURATE starts Standard, AUTO/FAST start Basic.
Tier is always passed to the MinerU CLI explicitly; it is never auto-selected.

## Structural Quality Gate (`quality_gate.py`)

Purpose and boundary: a **deterministic** check that "Basic clearly failed / is
badly incomplete", so AUTO can decide whether to fall back. It is **not** an AI
confidence score and it **never fabricates OCR confidence**. Ordinary OCR issues
(one wrong digit, a seal a human should eyeball, a single `[Illegible]`) must
**not** trigger fallback — those belong to human review.

Machine-readable reason codes (de-duplicated, order-stable):

- `missing_markdown` / `empty_markdown`
- `missing_middle_json` / `invalid_middle_json`
- `page_count_mismatch`
- `extremely_low_text_volume`
- `excessive_illegible_markers` (absolute **and** ratio)
- `encoding_noise` (U+FFFD, absolute **and** ratio)
- `insufficient_page_coverage`

Thresholds are centralized in `thresholds()` and overridable via `CONTRACT_QG_*`
env vars; the check logic holds no magic numbers. Reasons combine into a fallback
string via `fallback_reason()`: `basic_quality_gate_failed:<reason1>,<reason2>`.

`page_count_mismatch` is **strict equality** when both the input page count
(Node/pdfjs) and the parsed page count (middle JSON) are reliable. There is
intentionally **no tolerance** and **no blank-page exception**: a difference means
pages were dropped or mis-grouped. A future legitimate-omission case must be
re-added together with a fixture and a documented reason — not loosened up front.

## AUTO fallback triggers (two, not one)

AUTO drops the Basic result and runs Standard when **either**:

1. the structural Quality Gate fails, or
2. the deterministic **critical-integrity** check reports `requiresStandard`
   (`basic_critical_integrity_failed:<reason>`).

FAST records the gate result but never falls back. ACCURATE never runs Basic.
Standard is a **second parse, not ground truth** — it never silently overrides
Basic except through these gate/integrity paths.

## Artifact cache (`parse_cache.py`)

Cache stores **only raw MinerU artifacts**: `document.raw.md`,
`document.middle.json`, `document.structured.json` (whatever exists). It never
caches human review state — `document.draft.md`, `issues.json`,
`document.fields.json`, `final/document.md`, resolved decisions. A cache hit
restores raw artifacts, then the job **always re-generates** its own
draft / issues / fields, so every job's review state is independent. This is the
reason the cache cannot leak one job's review decisions into another.

Layout (gitignored, never served over HTTP):

```
storage/contracts-cache/
  <owner_hash>/<source_sha256>/<parser_signature>/<tier>/
    manifest.json
    document.raw.md  document.middle.json  document.structured.json
```

- **Owner-scoped**: the directory uses `owner_hash(username)`, never the raw
  username; one owner cannot reuse another's cache.
- **Parser signature** = SHA256 of:
  - local: `mineru=<ver>;tier;backend=local;source;small_backend;vlm;profile;seal`;
  - cloud: `mineru=cloud;tier;backend=cloud;api_base;api_model;api_lang;
    api_ocr;api_table;api_formula;profile`.
  The tier and backend are part of the signature, so Basic/Standard and
  local/cloud are isolated automatically. Changing profile/MinerU/backend/VLM/
  seal or cloud model/OCR settings **intentionally invalidates** old entries.
- The manifest also records `backend` and `modelVersion` for diagnostics; the
  signature remains the authority.
- **Atomic publish**: fill a `.tmp-*` dir, write `manifest.json` last, then
  `os.replace`. A crashed job can never leave a half-written entry that a later
  job mistakes for a hit.
- **Cache is never a single point of failure**: a missing/corrupt/mismatched
  manifest, wrong version, or missing artifact is quarantined and treated as a
  **miss** (never raises on the job path).
- **TTL**: `CONTRACT_PARSE_CACHE_DAYS` (default 30) with a best-effort
  `prune_expired()`. The stored `qualityPass` in the manifest is metrics/debug
  only — on a Basic hit the worker re-runs the **current** gate, so a stale value
  never decides fallback.

## Progress semantics

`ProgressReporter`: writes are **monotonic** (clamped, never go backwards) with
`floor=10` (claim sets 10 first), and are throttled (write on message/stage/state
change, or growth ≥2, or ≥1s since last write) to avoid hammering PostgreSQL.

Cache restore and a real parse use **different** progress numbers on purpose:
`70` = cache restore; a real Standard parse uses `68/74/78/81/84` + `86`. Stage
detail comes from stable MinerU log keywords (`Layout Predict`, `VLM Predict`,
`OCR-det`, `OCR-rec`, `OCR-seal`); when a keyword is missing, progress degrades to
stage level. ANSI progress bars are not parsed and exact percentages are not
fabricated.

## Performance safety boundaries (must preserve)

- Improving speed must not trade away production stability: keep the pinned
  MinerU environment (`MINERU_MODEL_SOURCE=local`,
  `MINERU_MODEL_SMALL_BACKEND=onnx`, `MINERU_MODEL_VLM_ENGINE=llama-cpp`) and the
  `LIUXIANLAB_MINERU_PRODUCTION_ENV_V1` / `LIUXIANLAB_SAFE_SEAL_CROP_V3`
  interfaces.
- **MinerU concurrency = 1** (worker advisory lock). The host is shared/small;
  do not raise it.
- Migrations stay **additive / backward-compatible** (`001..003` pattern;
  `ADD COLUMN IF NOT EXISTS`, `BEGIN/COMMIT`, idempotent, no destructive/renamed
  columns).
- The source contract body is never auto-modified; the tool locates/annotates.

# 公司地图地址查询 — Company Map Lookup

## Purpose

Batch company-name lookup through official map POI APIs. Output is a **map POI
address**, not a business-registration address. Do not present it as a legal
registered address.

## Files

- Backend: `server/company-map-lookup/`
  - `providers/amap.js` — Amap V5 keyword search; `region` optional (nationwide).
  - `providers/baidu.js` — Baidu Place V3 region search; `region` required.
  - `service.js` — owner-scoped jobs, provider/key resolution, matching, cache.
  - `provider-errors.js` — maps Amap/Baidu error codes to `MAP_API_*` codes
    without exposing the key or the raw request URL.
  - `matching.js` — precision-first ranking; branch markers and region mismatch
    are penalized. `review` is never silently converted to `matched`.
  - `job-store.js` — in-memory TTL job store (V1); never stores an API key.
- Frontend: `private/tools/company-map-lookup/`
  - `index.html` — tool page using the existing Liuxian Lab shell.
  - `template.js` — builds the standard XLSX template in the browser with the
    vendored SheetJS (`公司名单` + `填写说明`); no extra package.
  - `script.js` — provider/key UI, paste/XLSX/CSV import, mapped preview,
    job creation/polling, review drawer, filters, pagination, XLSX/CSV export.
  - `styles.css` — tool-local styling on top of design tokens.
- Tests: `tests/company-map-lookup/`
  - `backend.test.js` — matching, auth, same-origin, owner scope, batch errors,
    cancel, resolve, filters, key priority/fallback, validate endpoint, leakage.
  - `template.test.js` — template XLSX generation, sheets, headers, no key.
  - `frontend-contract.test.js` — registration, server mount, API wiring, export
    fields, no frontend key.
  - `frontend-e2e.test.js` — real Chrome event chain with a fake provider:
    template download, XLSX import, provider Key show/hide, validate API, job,
    review confirmation, filters, search, CSV/XLSX export, 390px overflow check.

## API

Base path: `/api/company-map-lookup`

```
GET  /meta
POST /provider/validate
POST /search
POST /jobs
GET  /jobs/:jobId
GET  /jobs/:jobId/results?offset=&limit=&status=&q=
POST /jobs/:jobId/cancel
POST /jobs/:jobId/items/:itemId/resolve
```

`POST /jobs` accepts `{ provider, apiKey?, items }`; `provider` is `amap` or
`baidu`, and `apiKey` is the user's temporary key for this job only. `POST
/provider/validate` accepts `{ provider, apiKey? }` and performs one minimal
real provider query (never creates a job). Errors use `MAP_API_KEY_REQUIRED`,
`MAP_API_KEY_INVALID`, `MAP_API_QUOTA_EXCEEDED`, `MAP_API_FORBIDDEN`,
`MAP_API_TIMEOUT`, `MAP_API_PROVIDER_ERROR`.

Per-item status: `queued`, `searching`, `matched`, `review`, `not_found`,
`error`, `cancelled`. Job status: `queued`, `running`, `completed`, `cancelled`.
`review` requires an explicit candidate selection; resolve only accepts a
`poiId` already returned for that item.

## Excel template

`private/tools/company-map-lookup/template.js` builds the file in the browser
using the vendored SheetJS. Sheets: `公司名单` (header only: `公司名称`,
`城市/地区（可选）`; AutoFilter + column widths) and `填写说明` (11 rules).
No new npm dependency; users download `公司地图地址查询模板.xlsx`. Uploaded
XLSX/CSV still uses the existing column-mapping flow, so older files keep
working. Duplicate `公司名称 + 城市/地区` rows are queried once but exported
row-by-row against the original list.

## Auth / owner scope

- Mounted in `server.js` with the project `requireAuth` and
  `sameOriginForStateChange`.
- `ownerId` is derived from `req.session.auth.username`; client JSON cannot set
  it. A guessed job UUID from another user returns `404`.
- `/meta` exposes provider names, not keys. Request URLs are never logged.
- API keys: a user key is sent only in an authenticated same-origin POST body
  and kept in the job execution closure. It is never written to localStorage /
  sessionStorage / IndexedDB / cookies / URL / logs / DB / job metadata /
  results / exports, and is released when the job reaches a terminal state.
  Precedence: user key > server env key (`AMAP_WEB_SERVICE_KEY` /
  `BAIDU_MAP_AK`); if neither exists the API returns `MAP_API_KEY_REQUIRED`.
  The browser never calls Amap/Baidu directly.

## Environment

```
COMPANY_MAP_PROVIDER=auto|amap|baidu
AMAP_WEB_SERVICE_KEY=...
BAIDU_MAP_AK=...
```

These are optional admin fallbacks; users may enter their own key in the page
for a single query. Defaults and bounded tuning are documented in
`.env.example`. Amap is the recommended provider for name-only searches.
Baidu requires a city/region.

## Persistence

V1 uses `MemoryJobStore`. Jobs and results disappear on Node/PM2 restart; the UI
explicitly says so and does not promise recovery. No migration was added. If a
future version needs history/recovery, implement an additive, owner-scoped
PostgreSQL store following the existing repository/migration conventions.

## Run checks

```bash
node --check server/company-map-lookup/*.js
node --check private/tools/company-map-lookup/script.js
node --check private/tools/company-map-lookup/template.js
node --test tests/company-map-lookup/backend.test.js
node --test tests/company-map-lookup/template.test.js
node --test tests/company-map-lookup/frontend-contract.test.js
node --test tests/company-map-lookup/frontend-e2e.test.js
```

The E2E test uses system Chrome via `puppeteer-core`; it skips when Chrome is
absent. No real map key or quota is used in tests.

## Deployment preflight

- `COMPANY_MAP_PROVIDER` and `AMAP_WEB_SERVICE_KEY` / `BAIDU_MAP_AK` are
  optional fallbacks; users can supply a temporary key in the page. Install env
  values without printing them.
- Confirm the provider account's quota, concurrency and license for internal
  production use (free developer quota is not automatically a commercial
  license). User-supplied keys consume that user's own account quota.
- No migration. No PM2 restart is authorized by this document.
- Cache busting: `index.html` asset queries and `config/tools.json` version must
  match the current page version (v1.1.0 for this iteration).

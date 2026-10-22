# Phase 5B.1 — Large Result Delivery & Browser Scalability

Updated: 2026-10-22

Verdict: **LARGE RESULT DELIVERY READY**

No production deployment, migration, or cleanup was executed.

## Architecture

```text
canonical result:
  result.json (unchanged; complete analysis fact)
  used by export, batch output, split export and trace/debug.

UI projection (per job, inside <job>/ui/):
  summary.json       lightweight dashboard summary, ~2.7 KB
  vouchers.ndjson    compact list rows, streamed by Node per query
  findings.json      compact finding rows
  details.bin        one zlib member per voucher + byte offsets
  details.idx.json   voucher_key -> [offset, compressed_length]

query mechanism:
  Node streams vouchers.ndjson for pagination/filtering; no full result parse.
  Detail request seeks one compressed member and inflates it in Node.
  Summary/findings/detail index are cached with a small LRU.

browser endpoints:
  summary, voucher pages, finding pages, lazy voucher detail.
  The browser never requests /result.

legacy behavior:
  missing projection + result <= 32 MB: build the projection on demand with
  the existing Python runtime.
  missing projection + result > 32 MB: HTTP 409 prompt to re-analyze; the full
  result is never returned to the browser.
```

The projection is written by the worker before `reporter.finish()`. The
parse-runner requires all five projection files before `finalizeSuccess()`.
A projection failure fails the job instead of exposing an unusable completed
result. Projection files are inside the job directory, so the existing 72 h
retention/delete/orphan lifecycle removes them with the job.

## API

```text
GET /api/journal-entry-analyses/:id/summary

GET /api/journal-entry-analyses/:id/vouchers
  page=1..N (default 1)
  pageSize (default 50, max 200)
  sort=voucher | riskScore | riskLevel
  balance=all|balanced|within|unbalanced
  view=business|contra
  businessCode=... confidence=HIGH|MEDIUM|LOW
  riskLevel=HIGH|MEDIUM|LOW|INFO
  contra=allocated|unallocated|ambiguous|limited

GET /api/journal-entry-analyses/:id/vouchers/detail?key=<encoded voucher_key>
  URL query is used because voucher_key may contain /, :, spaces or Chinese.
  It is looked up as data in details.idx.json, never as a filesystem path.

GET /api/journal-entry-analyses/:id/findings
  page, pageSize, sort=default|riskScore|riskLevel
  riskLevel=HIGH|MEDIUM|LOW|INFO
  ruleCode=...
  businessCode=...
```

All endpoints require auth and are owner scoped; another owner gets 404.
`GET /:id/result` remains for legacy/internal compatibility and remains owner
scoped, but the Result Viewer no longer calls it.

## Before / After

| Metric | Before | After |
| --- | ---: | ---: |
| 100k initial result-view bytes | 169,724,487 | 23,210 bytes (summary 2,743 + first voucher page 20,467) |
| 100k usable load | full download + parse; E2E analysis+result 99.06 s | dashboard 0.00 s after job completion; representative first page 0.26 s; E2E analysis+result 101.86 s including worker/projection |
| 100k JS heap | ~315 MiB | 5.59 MB dashboard / 5.56 MB pagination / 5.65 MB drawer |
| 300k canonical result | 510,730,683 | 510,730,683 (unchanged) |
| 300k browser initial payload | not tested | 23,225 bytes (summary 2,757 + first page 20,468) |
| 300k browser load | not tested | dashboard 0.00 s after completion; E2E analysis+result 366.75 s including worker/projection |

The 101.86 s / 366.75 s totals include Python analysis and projection generation.
The post-completion Result Viewer no longer scales with canonical JSON size.

## 100k Browser

```text
initial payload:        23,210 bytes
usable dashboard:       0.00 s after completed status
first voucher page:     20,467 bytes
API response bytes:     summary 2,743; vouchers 122,549; findings 12,362; details 1,713
largest response:       20,467 bytes
JS heap:                dashboard 5,586,425; pagination 5,564,253; drawer 5,648,755 bytes
tabs+drawer actions:    0.85 s
split preview:          3.04 s, 120 groups
console/pageerror/5xx:  0 / 0 / 0
full result requests:   0
```

Representative Node query timings (300k and 100k, no HTTP framework overhead):

```text
100k: summary 0.47 ms; first page 92.8 ms; next page 89.3 ms;
      business filter 89.2 ms; findings 2.4 ms; detail 10.1 ms
300k: summary 0.07 ms; first page 263.8 ms; next page 257.1 ms;
      business filter 260.3 ms; findings 2.2 ms; detail 27.3 ms
```

Node RSS during 300k queries was ~66 MiB after first page and ~127 MiB after a
detail read; it does not load the 510 MB canonical JSON.

## 300k Browser

```text
canonical size:         510,730,683 bytes
initial payload:        23,225 bytes
usable dashboard:       0.00 s after completed status
first voucher page:     20,468 bytes
API response bytes:     summary 2,757; vouchers 122,554; findings 12,362; details 1,713
largest response:       20,468 bytes
JS heap:                dashboard 3,411,380; pagination 3,510,175; drawer 3,788,936 bytes
Business:               first page, next page, filter all PASS
Anomaly:                first page PASS
Voucher detail:         PASS, lines + internal_line_key preserved
Contra:                 detail allocations PASS
Split entry:            PASS; preview 13.56 s, 120 groups
console/pageerror/5xx:  0 / 0 / 0
full result requests:   0
Node E2E RSS:           70.9 -> 43.9 MiB after analysis
```

The browser network assertion checked the exact `/api/journal-entry-analyses/<uuid>/result`
path and passed for normal, 100k and 300k flows, including batch child viewer.

## Correctness

```text
summary vs canonical:    PASS (all summary blocks exact)
business vs canonical:   PASS (all compact rows; 50k/150k vouchers)
findings vs canonical:   PASS (all 1k/3k findings)
contra vs canonical:     PASS (allocation counts, detail source keys sampled)
voucher detail:          PASS (lines, amounts, internal_line_key; 20 first/last offset samples)
duplicate line_id:       PASS (existing normal E2E)
owner isolation:         PASS (404 for summary/pages/findings/detail)
large legacy:            PASS (409, no full result)
small legacy:            PASS (on-demand projection)
```

The projection only transforms the canonical result. It never re-runs Business,
Contra or Anomaly analysis.

## Storage Impact

```text
                 100k               300k
result.json      169,724,487        510,730,683
summary.json           2,706              2,720
vouchers.ndjson   20,266,000         60,798,000
findings.json        246,002            738,002
details.bin       39,512,548        118,670,409
details.idx.json   2,136,896          6,462,438
UI total          62,164,152        186,671,569
```

UI artifacts are about 36.6% of canonical result size; details are compressed
and are about 23% of canonical size. Per-job total (source + result + export + UI):

```text
100k: ~255 MB
300k: ~768 MB
```

72 h at 10 completed jobs/day (30 jobs) is roughly 7.7 GB for 100k and 23.0 GB
for 300k, before split/batch outputs. Job delete/expiry removes the UI directory
with the rest of the job. A route test asserts the UI files disappear on delete.

## Security

```text
auth:                 requireAuth on all new endpoints
owner isolation:      404 for another owner
path safety:          ui dir 0700, files 0600, detail files opened O_NOFOLLOW,
                      offsets are integers from server-owned index, no user path
financial logging:    no voucher/account/customer/amount data logged
result endpoint:      retained owner-scoped for legacy/internal use; UI does not call it
native dependencies:  none added; Node zlib/readline and Python zlib are built-ins
```

## Test Results

```text
Journal Entry Python:   260 passed / 0 failed
Excel Review Python:     79 passed / 0 failed
Journal Entry Node:      61 passed / 0 failed
  routes 18 + batch 16 + queue 2 + splits 9 + presets 3 + cleanup 5 + ui-result 8
npm test:               466 passed / 0 failed
normal browser E2E:     PASS
100k browser E2E:       PASS
300k browser E2E:       PASS
deployment smoke:       PASS
cleanup --dry-run:      PASS (0 artifacts; no deletion)
migration:              none required in this phase
compileall:             PASS
git diff --check:       PASS
```

## Core Regression

```text
Reader semantics changed:              NO
Mapping semantics changed:             NO
Normalize accounting semantics changed: NO
Business rules changed:                NO
Contra algorithm changed:              NO
Anomaly scoring changed:               NO
Split/filter semantics changed:        NO
internal_line_key semantics changed:   NO
```

The only split-page change is initial dimension availability loading: it now
loads only selected dimensions instead of four dimensions in parallel; split
semantics/API are unchanged.

## Remaining P0

```text
None
```

## Remaining Production Checks

```text
Production RAM (recommend 16 GiB for 300k; 8 GiB is not enough for 300k)
Production free disk (300k job ~768 MB; plan retention)
Nginx client_max_body_size >= 100 MB
Nginx proxy_read_timeout / send_timeout for preview/start and export (>120 s)
PM2 single instance / fork (in-process queue)
SESSION_SECRET (replace placeholder)
Production DB migration (none added in 5B.1; 002-006 still pending)
Backup and production smoke
```

P1 observations: 300k preview/start remain synchronous (~65 s each), so proxy
timeouts must be set accordingly. Legacy results above 32 MB require re-analysis
to build a projection; the UI intentionally never falls back to a full result.

## Git Status

```text
 M PROJECT_STATUS.md
 M config/tools.json
 M deploy-liuxianlab.sh
 M docs/agent/journal-entry-analysis/web-integration.md
 M package-lock.json
 M package.json
 M private/tools/journal-entry-analysis/index.html
 M private/tools/journal-entry-analysis/script.js
 M private/tools/journal-entry-analysis/styles.css
 M server.js
 M server/journal-entry/parse-runner.js
 M server/journal-entry/repository.js
 M server/journal-entry/routes.js
 M services/journal_entry/analysis_result.py
 M services/journal_entry/export.py
 M services/journal_entry/mapping.py
 M services/journal_entry/normalize.py
 M services/journal_entry/preview.py
 M services/journal_entry/reader.py
 M services/journal_entry/schema.py
 M services/journal_entry/tests/fixture_factory.py
 M services/journal_entry/tests/fixtures/expected_basic.json
 M services/journal_entry/tests/test_input_adapters.py
 M services/journal_entry/tests/test_mapping.py
 M services/journal_entry/tests/test_reader.py
 M services/journal_entry/tests/test_worker_integration.py
 M services/journal_entry/worker.py
 M tests/journal-entry/routes.test.js
?? docs/agent/journal-entry-analysis/phase5b-checkpoint.md
?? docs/agent/journal-entry-analysis/phase5b1-report.md
?? private/tools/journal-entry-analysis/batch.css
?? private/tools/journal-entry-analysis/batch.html
?? private/tools/journal-entry-analysis/batch.js
?? private/tools/journal-entry-analysis/split.css
?? private/tools/journal-entry-analysis/split.html
?? private/tools/journal-entry-analysis/split.js
?? scripts/e2e-journal-entry.js
?? scripts/local/cleanup-journal-entry.js
?? scripts/smoke-journal-entry.js
?? server/journal-entry/batch-output-repository.js
?? server/journal-entry/batch-output-runner.js
?? server/journal-entry/batch-repository.js
?? server/journal-entry/batch-routes.js
?? server/journal-entry/batch-summary.js
?? server/journal-entry/cleanup.js
?? server/journal-entry/migrations/002_journal_entry_batches.sql
?? server/journal-entry/migrations/003_journal_entry_batch_outputs.sql
?? server/journal-entry/migrations/004_journal_entry_split_outputs.sql
?? server/journal-entry/migrations/005_journal_entry_split_presets.sql
?? server/journal-entry/migrations/006_journal_entry_storage_lifecycle.sql
?? server/journal-entry/runtime.js
?? server/journal-entry/split-preset-repository.js
?? server/journal-entry/split-preset-routes.js
?? server/journal-entry/split-repository.js
?? server/journal-entry/split-routes.js
?? server/journal-entry/split-runner.js
?? server/journal-entry/storage-safety.js
?? server/journal-entry/ui-projection.js
?? services/journal_entry/batch_output.py
?? services/journal_entry/split_export.py
?? services/journal_entry/tests/fixtures/journal_audit_split.xlsx
?? services/journal_entry/tests/fixtures/journal_basic.xls
?? services/journal_entry/tests/fixtures/journal_duplicate_line_id.xlsx
?? services/journal_entry/tests/fixtures/journal_signed_amount.xlsx
?? services/journal_entry/tests/test_batch_output.py
?? services/journal_entry/tests/test_split_export.py
?? services/journal_entry/tests/test_ui_projection.py
?? services/journal_entry/ui_projection.py
?? tests/journal-entry/batches.test.js
?? tests/journal-entry/cleanup.test.js
?? tests/journal-entry/presets.test.js
?? tests/journal-entry/queue.test.js
?? tests/journal-entry/splits.test.js
?? tests/journal-entry/ui-result.test.js
```

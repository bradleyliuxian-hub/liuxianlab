# Phase 5B performance checkpoint

Updated: 2026-10-22

Status: **PASS IN BENCHMARK ENVIRONMENT** — no remaining P0 found after the async output
and completion-race fixes. Production deployment still requires server-side verification
of RAM, reverse-proxy limits, disk, and the production database.

## Environment

```text
OS:            macOS 15.5 (Apple M4)
CPU:           Apple M4, 10 cores
RAM:           16 GiB
Disk:          228 GiB, ~90 GiB free at measurement time
Node:          v25.9.0 (local Homebrew simdjson 5.0.5 needed a local
               libsimdjson.33 compatibility symlink to 4.6.3; production
               Linux not affected)
Python:        3.9.6 (.venv; openpyxl 3.1.5, xlrd 2.0.2)
PostgreSQL:    16.15 local
Chrome:        155.0.8059.86
BENCHMARK ENVIRONMENT IS NOT PRODUCTION
```

Effective timeouts and process model after Phase 5B:

```text
preview:       120 s
worker:        900 s
batch output:  600 s, asynchronous POST -> 202 { output.status: generating }, UI polls latest
split export:  600 s, asynchronous POST -> 202 { output.status: generating }, UI polls latest
upload/proxy:  no repository Nginx config; REQUIRES SERVER-SIDE VERIFICATION
PM2:           ecosystem.config.js = fork, one app, no cluster/instances override
Node memory:   no --max-old-space-size configured
```

## Synthetic data

Deterministic debit/credit workbook generator; 12 columns, 2 balanced lines per voucher,
10 accounts, 100 customers, 7 suppliers, 12 months, 3 entities, fixed values.
Files under `/tmp/je-bench/` (not repository data).

```text
10k rows:    560,413 bytes
100k rows: 5,582,301 bytes
300k rows: 16,762,493 bytes
440k rows: 24,588,508 bytes (24.48 MiB; near the 25 MB product boundary)
```

## Single-file worker measurements

Direct Python pipeline, no HTTP:

| Rows | File bytes | Normalize | Business | Contra | Anomaly | Build result | Serialize | Export | Result JSON | Export XLSX | Peak RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 560,413 | 2.03s | 0.31s | 0.20s | 0.43s | 0.16s | 0.15s | 3.71s | 16,905,958 | 1,788,691 | ~393 MiB |
| 100,000 | 5,582,301 | 22.90s | 3.83s | 2.31s | 4.56s | 2.51s | 1.31s | 39.75s | 169,724,487 | 17,759,054 | ~2.70 GiB |
| 300,000 | 16,762,493 | 63.61s | 10.86s | 6.57s | 14.55s | 10.29s | 5.40s | 183.67s | 510,730,683 | 53,372,897 | ~4.51 GiB |

300k `/usr/bin/time -l` peak memory footprint: 9,179,127,200 bytes (~8.55 GiB).
300k worker total phase sum ~294 s < 900 s worker timeout.

## Batch output measurements

One completed 100k-row child:

```text
duration: 24.19 s
summary:  9,512 bytes
merged:   11,786,011 bytes
ZIP:      12,426,820 bytes
merged rows: 100,000
peak memory footprint: 1,842,529,984 bytes (~1.72 GiB)
```

5 × 100k-row children (500k merged rows):

```text
duration: 204.68 s
ZIP:      63,819,453 bytes
merged rows: 500,000
peak RSS: ~3,874.6 MiB
```

This exceeded the old 120 s synchronous timeout, so batch output was changed to
asynchronous generation with a 600 s timeout and UI polling. The measured 204.68 s
generation is below the effective 600 s limit.

## Split measurements

100k rows (earlier Phase 4B.3): 2D ZIP ~27.2 s; 2D preview ~1.6 s.

300k rows:

```text
account + month:          groups 120, preview 9.14 s
entity + account + month: groups 120, preview 8.82 s
customer + month:         groups 300, preview 8.13 s, limit_exceeded false
account + month ZIP:      82.22 s, 12,586,297 bytes
/usr/bin/time -l peak memory footprint: 3,561,147,200 bytes (~3.32 GiB)
```

300k split ZIP 82.22 s < effective 600 s. Multi-sheet/ZIP group boundary tests at
199/200/201 and 499/500/501 now pass.

## Browser E2E

Normal E2E PASS. Current 100k large-result E2E PASS:

```text
upload (server-side inspect included): 7.04 s
preview path:                          27.67 s
analysis + result load:                99.06 s
result JSON response:                  169,724,548 bytes
tabs + voucher drawer:                 0.11 s
split preview (account + month):        2.89 s, 120 groups
JS heap used:                          329,905,160 bytes (~315 MiB)
Node E2E process RSS start/after analysis: 70.5 / 54.1 MiB
console/pageerror/unhandled/5xx:       0
```

440k near-limit upload-only E2E PASS:

```text
upload + inspect: 26.55 s
file:              /tmp/je-bench/journal_440000.xlsx (24,588,508 bytes)
```

Full 440k analysis/result/browser was NOT run; 300k is the largest fully exercised
analysis. The 300k result JSON is 510 MB and browser rendering at that size is NOT
validated.

## Large batch upload memory

Real batch route + multer memory upload, 4 × 24.48 MiB = 97.9 MiB total, stubbed
inspection:

```text
status:       201
upload time:  171 ms
Node RSS:     175.4 MiB baseline -> 300.2 MiB peak
```

No Node OOM at the 100 MB batch boundary. Python inspect/worker memory is separate.

## Database / cleanup / migration

Metadata load in local DB: 10k jobs, 1k batches, 3k batch outputs, 1k split outputs,
100 presets for `bench-load-user`. All bench rows were deleted after measurement.

```text
jobs_history:             1.81 ms  Bitmap Index Scan
batch_history:            4.26 ms
cleanup_expired_jobs:     2.27 ms
batch_output_latest:      0.20 ms
split_latest:             0.01 ms
queued_recovery:          0.09 ms
cleanup dry-run:          41 ms, 200 eligible expired jobs, no deletion
```

No new index was proven necessary. Cleanup unit tests cover actual deletion, retention,
active-artifact protection, and startup generating-output recovery.

Migration rehearsal:

```text
fresh schema 001-006:              PASS (6 tables)
rerun 001-006 on same schema:      PASS
injected failure inside transaction: PASS (rolled back, table absent)
local upgrade 001 -> 002-006:      PASS (existing journal_entry_jobs row preserved)
```

## P0 fixed in Phase 5B

1. **Synchronous large output timeout.** 5 × 100k batch output took 204.68 s, above the
   old 120 s limit. Batch/split generation is now asynchronous (`202` + `generating`),
   with 600 s timeout, UI polling, startup recovery, and failure cleanup.
2. **Completion race.** Worker `status.json` could report `completed` before
   `resultPath`/`exportPath` files were committed, so the browser occasionally
   loaded the result too early and showed “结果尚未生成”. Status polling no longer
   propagates `completed`; completion is written atomically by `finalizeSuccess`.

The race was reproduced by the 100k browser E2E before the fix and passed after it.

## P1 / production verification items

- Production RAM and memory headroom are unverified. Benchmark peaks: 300k analysis
  ~4.51 GiB RSS / ~8.55 GiB footprint; 5 × 100k batch output ~3.87 GiB; 300k split
  ~3.32 GiB. Recommend ≥8 GiB RAM, 16 GiB safer; a 4 GiB host is not sufficient for
  300k analysis.
- Reverse-proxy upload/read/send timeouts are absent from the repository. Verify
  `client_max_body_size >= 100m`, upload/inspect > 60 s, export/download > 600 s.
- 440k full analysis is not validated; recommendation: operational maximum 300k rows
  unless a 440k run is completed on production hardware.
- 300k browser rendering of the 510 MB result is not validated; 100k uses ~315 MiB JS
  heap. Consider a result-size warning or a lower interactive row limit.
- Real server restart with running/queued jobs and `generating` outputs was simulated
  in repository tests, not by killing a production-style server. Export concurrency
  and worker/preview timeout kill behavior were code-reviewed, not load-measured.
- Full 5 × 100k upload → queue → generate path was not run through the API; the
  generator itself was measured directly. Batch upload and normal async outputs pass.
- Result JSON dominates disk growth; no dedicated free-disk guard was added. Monitor
  free space and keep the 72 h retention cleanup scheduled.
- Production PM2 must remain single-instance/fork because the queue is in-process.
  `ecosystem.config.js` currently uses the PM2 default fork/one instance but contains
  a placeholder `SESSION_SECRET`.

## Capacity model

```text
100k job: source 5.6 MB + result 169.7 MB + export 17.8 MB ≈ 193 MB
300k job: source 16.8 MB + result 510.7 MB + export 53.4 MB ≈ 581 MB
5 × 100k batch ZIP: ~63.8 MB; one 100k batch ZIP: ~12.4 MB
300k split ZIP: ~12.6 MB
```

Result JSON is the dominant consumer. 72 h retention at 10 × 300k jobs/day is roughly
5.8 GB of source/result/export before split/batch outputs; at 10 × 100k/day roughly
1.9 GB. The benchmark host had ~90 GiB free; production disk capacity is unverified.

## Regression

```text
Journal Entry Python: 258 passed / 0 failed
Excel Review Python:   79 passed / 0 failed
Journal Entry Node:    53 passed / 0 failed
  routes 18 + batch 16 + queue 2 + splits 9 + presets 3 + cleanup 5
npm test:             458 passed / 0 failed
browser E2E normal:   PASS
browser E2E 100k:     PASS (169,724,548-byte result)
browser E2E 440k:     PASS (upload + inspect only, 26.55 s)
compileall:           PASS
git diff --check:     PASS
```

## Verdict

**PRODUCTION LOAD VALIDATED in the benchmark environment for ≤300k rows**, with the
production-side caveats above. No remaining P0 was found. Deployment approval is
conditional on confirming production RAM/proxy/disk and keeping PM2 single-instance.

## Practical note

The local Node binary currently requires `/opt/homebrew/opt/simdjson/lib/libsimdjson.33.dylib`.
A local symlink was added under Homebrew simdjson 5.0.5 pointing to the 4.6.3
`libsimdjson.33.0.0.dylib`. This is environment-only, not a repo change.

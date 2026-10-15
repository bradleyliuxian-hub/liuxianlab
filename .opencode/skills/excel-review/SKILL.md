---
name: excel-review
description: Use for the Excel Review Assistant / "Excel批注整理" tool at /tools/excel-review — upload, comments extraction, Control Log, review workbook, ZIP/batch upload, filename encoding, history/download. Triggers include "Excel Review", "批注整理", "Control Log", "threaded comment", "review.xlsx", "上传失败", "乱码". Not for the hardcode or decimal tools.
---

# excel-review

Maintain the Excel Review Assistant. Keep the invariants below; load detail from
`docs/agent/excel-review/*` on demand. Do not re-derive rules from memory.

## Scope

- Node: `server/excel-review/` — `routes.js`, `job-factory.js`, `repository.js`,
  `parse-runner.js`, `encoding.js`, `control-log-*.js`, `migrations/*`.
- Python: `services/excel_review/` — `parser.py`, `review_workbook.py`,
  `statistics.py`, `control_log.py`, `control_log_worker.py`, `worker.py`.
- Frontend: `private/tools/excel-review/`.
- Tests: `tests/excel-review/*`, `services/excel_review/tests/*`.

## Invariants (must preserve)

1. **One uploaded .xlsx = one Job** (atomic unit). Multi-file = N jobs.
2. **Control Log is an aggregation layer above Jobs**, backed by its own
   snapshot — never a "multi-file job", never a rebuild of the source.
3. **Threaded reply is NOT a question.** Question = legacy note OR threaded
   root. Replies are preserved for provenance only; never counted.
4. **Single normalized extraction result** feeds web stats, the review
   workbook, and the Control Log — one source of truth for counts.
5. **No automatic write-back, no reply upload, no final.xlsx.** The tool is
   read-only on the source workbook.
6. **A .zip is only an input container.** Each `.xlsx` member becomes a normal
   Job; archive-vs-workbook is decided by route + extension, never by PK magic
   (an .xlsx is itself a ZIP).
7. **Single .xlsx is the canonical upload pipeline.** ZIP/batch/reuse all funnel
   through the same job-creation factory — one implementation, not three.
8. **Encoding**: multipart filenames are UTF-8; never store/emit mojibake.
9. **Owner scope + private download** on every job and Control Log endpoint.

## How to work

- Bug in upload → read `docs/agent/excel-review/upload.md` + Node route +
  `job-factory`; reproduce with a real file; check the DB layer error code.
- Comment/thread parsing → `docs/agent/excel-review/comments.md` + Python
  `parser.py` / `ooxml_threaded_comments.py`.
- Control Log → `docs/agent/excel-review/control-log.md` + `control_log.py`.
- Review workbook layout → `docs/agent/excel-review/workbook.md`.
- Run: `node --test tests/excel-review/*.test.js` and
  `.venv/bin/python -m unittest discover -s services/excel_review/tests -t .`.

## Anti-goals

- Do not restore removed reply/write-back/final.xlsx features.
- Do not change the question definition or the 1-file-1-job model.
- Do not special-case specific filenames, sheets, or cells.
- Do not touch `services/contract_review/`.

## Keep in sync

When behavior changes, update `docs/agent/excel-review/*` and `PROJECT_STATUS.md`.
This skill stays short; put facts in the docs, code, and tests.

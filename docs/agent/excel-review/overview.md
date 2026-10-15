# excel-review / overview

Excel 批注整理 (`/tools/excel-review`): extract legacy notes + Microsoft 365
threaded comments, emit a review workbook and a multi-file Control Log.

- One `.xlsx` upload = one Job (atomic). Control Log aggregates jobs.
- Question = legacy note OR threaded root; threaded reply is not a question.
- Read-only on the source workbook (no write-back / final.xlsx).
- Skill: `.opencode/skills/excel-review/`.

Authority / deep detail: `docs/excel-review-v1{,.1,.2,.3}*.md`,
`docs/excel-review-thread-*.md`, `private/tools/excel-review/DEVLOG.md`, and code.

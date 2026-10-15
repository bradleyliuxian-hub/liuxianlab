# excel-tail-risk / overview

Excel 尾差检查 (`/tools/excel-decimal-check`): find cells whose ACTUAL value has
more than two decimals. A tail-risk finder, not an auto-fixer. Browser-local.

- No auto-fix, no "修正后的 Excel"; source is never modified.
- Exports: 问题清单 + 标黄对比文件 (minimal OOXML patch, shared highlighter).
- Skill: `.opencode/skills/excel-tail-risk/`.

Authority / deep detail: `private/tools/excel-decimal-check/DEVLOG.md` + code.

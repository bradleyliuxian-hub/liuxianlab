---
name: excel-tail-risk
description: Use for the Excel 尾差检查 / decimal-check tool at /tools/excel-decimal-check — cells whose actual value has more than two decimals (尾差/小数/rounding tail). Triggers "尾差检查", "小数检查", "decimal", "两位小数", "标黄对比", "table viewer". Not for hardcode or Excel Review.
---

# excel-tail-risk

Maintain the Excel 尾差检查 (decimal-check) tool. It is a **tail-risk finder**,
not a "two-decimal auto-fixer". Browser-local (Vanilla JS); load detail from
`docs/agent/excel-tail-risk/*` on demand.

## Scope

- Frontend (browser-local): `private/tools/excel-decimal-check/`
  (`decimal-core.js`, `decimal-workbook.js`, `script.js`, `index.html`).
- Shared (also used by this tool): `private/shared/excel-viewer/*`,
  `private/shared/excel-highlight/ooxml-highlight.js`, `private/vendor/fflate/`.
- Tests: `tests/excel-decimal-check/*`.

## Invariants (must preserve)

1. **Detect only.** Find cells whose *actual* value exceeds two decimals; never
   auto-correct, never rewrite the source workbook.
2. **The source file is never modified.** The exported "标黄对比文件" is a COPY
   with a minimal OOXML style patch (yellow fill) — formulas, cached values,
   external links, structure are preserved where untouched.
3. **Actual value, not display format.** `1.23456` shown as `1.23` is still a
   hit; trailing zeros (`10.120`) and JS float noise (`0.1+0.2`) are not.
4. **Percentages are their own case** — never silently coerced.
5. **No cached result ⇒ do not guess.** Formula cells without a readable cached
   value are reported as "不可判定", not normal and not fabricated.
6. **Roles are only this tool's own.** The only classifications here are
   "is this a date-formatted numeric cell" (excluded) and the decimal-places
   check; there is **no formula-constant role model** (control / period / unit /
   business-constant) in this tool — that concept belongs to the *hardcode*
   tool and must not leak in.
7. **Viewer is read-only** and shows the ORIGINAL workbook; yellow areas are an
   overlay and, offline, a minimal OOXML patch. Reveal is one-shot and decoupled
   from the viewport (shared viewer behaviour).
8. **No filename / sheet / cell special-casing.**

## How to work

- Scanner / threshold logic → `docs/agent/excel-tail-risk/rules.md` +
  `decimal-core.js` / `decimal-workbook.js`.
- Highlight export → `docs/agent/excel-tail-risk/overview.md` + shared
  `private/shared/excel-highlight/ooxml-highlight.js`.
- Shared viewer questions → read `docs/agent/excel-hardcode/viewer.md` **on
  demand only**. Do NOT load the `excel-hardcode` skill for this tool.
- Run: `node --test tests/excel-decimal-check/*.test.js`.

## Anti-goals

- Do not reintroduce auto-fix or "修正后的 Excel".
- Do not import the hardcode tool's rule / constant-role concepts.
- Do not add a second highlighting path (reuse the shared OOXML highlighter).
- Do not misinterpret a `.xlsx` (also a ZIP) as an archive.

## Keep in sync

Behavior changes update `docs/agent/excel-tail-risk/*` + `PROJECT_STATUS.md`.
If the docs and code disagree, code wins.

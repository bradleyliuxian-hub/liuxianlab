---
name: excel-tail-risk
description: Use for the Excel 尾差 (decimal-check) tool at /tools/excel-decimal-check — risk-grading cells whose actual value exceeds two decimals (尾差/小数/rounding tail), including hidden-area scan, percentage isolation and direct formula-reference analysis. Triggers "尾差检查", "尾差风险", "小数检查", "decimal", "两位小数", "隐藏区域", "百分比检查", "标黄对比". Not for hardcode or Excel Review.
---

# excel-tail-risk

Maintain the Excel 尾差风险检查 (decimal-check) tool. It is a **tail-risk finder**,
not a "two-decimal auto-fixer". Browser-local (Vanilla JS); load detail from
`docs/agent/excel-tail-risk/*` on demand.

## Scope

- Frontend (browser-local): `private/tools/excel-decimal-check/`
  (`decimal-core.js`, `business-type.js`, `reference-map.js`, `risk-core.js`,
  `decimal-workbook.js`, `issue-filters.js`, `script.js`, `index.html`).
- Shared (also used by this tool): `private/shared/excel-viewer/*`,
  `private/shared/excel-highlight/ooxml-highlight.js`, `private/vendor/fflate/`.
- Tests: `tests/excel-decimal-check/*`.

## Invariants (must preserve)

1. **Detect only.** Find cells whose *actual* value exceeds two decimals; never
   auto-correct, never rewrite the source workbook, never wrap ROUND.
2. **The source file is never modified.** The exported "标黄对比文件" is a COPY
   with a minimal OOXML style patch (yellow fill) — formulas, cached values,
   external links, structure are preserved where untouched.
3. **Actual value, not display format.** `1.23456` shown as `1.23` is still a
   hit; trailing zeros (`10.120`) and JS float noise (`0.1+0.2`) are not.
4. **Percentages are their own category** — decided by Number Format, never
   silently coerced, never mixed into the numeric/formula lists.
5. **Hidden areas are opt-in and separate.** Hidden rows/cols/sheets are only
   scanned when requested, and always classified as 隐藏区域检查 — never mixed
   with the normal categories. A hidden value can still be HIGH risk when a
   visible formula references it.
6. **No cached result ⇒ do not guess.** Formula cells without a readable cached
   value are reported as "公式不可判定", not normal and not fabricated.
7. **Reference analysis is a real forward dependency graph.** `reference-map.js`
   gives the direct reference count AND the unique downstream reach
   (`downstreamReferenceCount`, de-duplicated, cycle-safe, cross-sheet). Do NOT
   claim "reaches a specific visible output" — that endpoint analysis is not
   implemented; wording stays honest.
8. **Ordering is a shared, switchable helper.** `risk-core.js#sortIssues(list,
   mode)` owns all ordering; default `risk` = risk level, then downstream desc,
   then direct desc. The web list and every exported sheet MUST use it, so the
   top of the list is the widest-reaching tail risk.
9. **Filtering is a separate, pure step** (`issue-filters.js#applyFilters`):
   within a field OR, across fields AND, empty array = no filter. Never bake
   filtering into the DOM or the sort; filters never change the scan result nor
   the export range (export always covers the full scan).
9b. **Prev/next navigation follows the filtered + sorted list only.** Feed the
   list to the shared viewer via `model.setFilterList(...)` + `model.reconcile()`
   with `{ cycle: false }`; keep the current issue if it survives a filter/sort
   change. Never navigate `allIssues`.
10. **No hardcode/constant-role semantics.** That concept belongs to the
   excel-hardcode tool and must not leak in; reference extraction is a separate,
   focused module.
10. **Viewer is read-only** and shows the ORIGINAL workbook; yellow areas are an
    overlay and, offline, a minimal OOXML patch. Reveal is one-shot and decoupled
    from the viewport (shared viewer behaviour).
11. **Business type decides the decimal allowance** (normal 2 / exchange_rate 4 /
    exchange_rate_derived 2 / suspected_exchange_rate 2-not-exempted / percentage
    separate). Rate detection is CONTEXT-based (titles, currency pairs, named
    ranges, referenced titles) — NEVER from the value range or decimal count.
12. **Exchange rate propagates only along PURE references.** A formula that is
    exactly one cell/name reference inherits `exchange_rate` (not a formula
    problem; can chain multi-level / cross-sheet). Any real computation on a rate
    (incl. `+0`, `*1`, `ROUND`) becomes `exchange_rate_derived` — no free 4-decimal
    allowance. `business-type.js#pureReference` owns the parse; classify business
    type BEFORE decimal/risk classification.
13. **No filename / sheet / cell special-casing.**

## How to work

- Scanner / category routing / hidden / percentage → `docs/agent/excel-tail-risk/rules.md`
  + `decimal-core.js` / `risk-core.js` / `decimal-workbook.js`.
- Business type / exchange rate → `docs/agent/excel-tail-risk/business-type.md` + `business-type.js`.
- Reference analysis → `docs/agent/excel-tail-risk/dependency-analysis.md` + `reference-map.js`.
- Risk levels / reasons / suggestions → `risk-core.js`.
- Highlight export → `docs/agent/excel-tail-risk/overview.md` + shared
  `private/shared/excel-highlight/ooxml-highlight.js`.
- Shared viewer questions → read `docs/agent/excel-hardcode/viewer.md` **on
  demand only**. Do NOT load the `excel-hardcode` skill for this tool.
- Run: `node --test tests/excel-decimal-check/*.test.js`.

## Anti-goals

- Do not reintroduce auto-fix / ROUND wrapping / "修正后的 Excel".
- Do not detect exchange rates from the value range or decimal count.
- Do not silently exempt a suspected exchange rate.
- Do not mix hidden / percentage / exchange-rate findings into the normal lists.
- Do not import the hardcode tool's rule / constant-role concepts.
- Do not claim "reaches a visible output" endpoint analysis.
- Do not re-implement ordering inline — always route through `sortIssues`.
- Do not add a second highlighting path (reuse the shared OOXML highlighter).
- Do not misinterpret a `.xlsx` (also a ZIP) as an archive.

## Keep in sync

Behavior changes update `docs/agent/excel-tail-risk/*` + `PROJECT_STATUS.md`.
If the docs and code disagree, code wins.

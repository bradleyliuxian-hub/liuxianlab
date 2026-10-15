---
name: excel-hardcode
description: Use for the Excel 死数检查 / hardcode-check tool at /tools/excel-hardcode-check — detecting hardcoded values that break formula patterns (HC001/HC002/HC003/HC006), the in-page Excel viewer, ROUNDING_PLUG, and the OOXML yellow-highlight export. Triggers "死数检查", "hardcode", "HC001", "ROUNDING_PLUG", "viewer", "标黄". Not for the decimal or Excel Review tools.
---

# excel-hardcode

Maintain the Excel 死数检查 tool. Browser-local. Load detail from
`docs/agent/excel-hardcode/*` on demand — never carry the rule list in memory.

## Scope

- Frontend (browser-local): `private/tools/excel-hardcode-check/`
  (`formula-parser.js`, `formula-pattern.js`, `hardcode-core.js`,
  `hardcode-workbook.js`, `script.js`, `index.html`).
- Shared: `private/shared/excel-viewer/*`, `private/shared/excel-highlight/ooxml-highlight.js`,
  `private/vendor/fflate/`, `private/vendor/xlsx/`.
- Benchmark: `scripts/local/hardcode-benchmark.js`. Tests: `tests/excel-hardcode-check/*`.

## Invariants (must preserve)

1. **Precision > Recall.** Never produce noisy hits to catch more. A rule that
   adds false positives is wrong even if it finds a real one.
2. **Structural evidence > the number itself.** Judgment order:
   `structure context > formula pattern > constant position > the literal number`.
   Never "a number appears in a formula ⇒ problem".
3. **Local anomaly > systematic pattern.** A deviation repeated across a
   row/column is intentional, not a hit.
4. **Viewer never modifies the workbook.** Highlighting is a CSS overlay; the
   viewer is read-only; nothing writes `cell.v`/`cell.f`.
5. **Reveal is one-shot.** 定位/上一个/下一个 move the camera once; scrolling
   and the selection are decoupled (no auto-recenter/lock).
6. **OOXML highlight must be a minimal patch** of the original package — add
   one yellow fill + one derived cellXf per original style; never rebuild the
   workbook with XLSX.write; never touch formulas/links/structure.
7. **No special-casing** for specific files, sheets, or cell addresses; rules
   stay general. Thresholds live as named constants.
8. **Unit conversion is not a hit**: `ROUND(x/1000,digits)` is normal; only a
   tail adjustment outside the round body is `ROUNDING_PLUG`.

## How to work

- Add/change a rule → `docs/agent/excel-hardcode/rules-high.md` /
  `rules-suspicious.md` / `rules-notice.md`, then `hardcode-core.js` + tests.
- Parser → `docs/agent/excel-hardcode/formula-parser.md` + `formula-parser.js`.
- Viewer bug → `docs/agent/excel-hardcode/viewer.md` + shared `excel-viewer.js`.
- Highlight export → `docs/agent/excel-hardcode/ooxml-highlight.md`.
- Run: `node --test tests/excel-hardcode-check/*.test.js`; real-file sanity via
  `node scripts/local/hardcode-benchmark.js "<file.xlsx>"`.

## Anti-goals

- Do not lower precision to raise counts, or tune thresholds to a single sample.
- Do not let the viewer mutate the workbook or re-center on every render.
- Do not rebuild the highlighted workbook with SheetJS.
- The stress fixture's expectations are the rule contract — keep them green.

## Keep in sync

Rule/behavior changes update `docs/agent/excel-hardcode/*` + `PROJECT_STATUS.md`.

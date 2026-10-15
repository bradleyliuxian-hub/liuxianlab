# excel-hardcode / ooxml-highlight (shared)

- `private/shared/excel-highlight/ooxml-highlight.js` + vendored `fflate`.
- NEVER rebuild with XLSX.write. Open the original ZIP; add one yellow fill +
  one derived cellXf per original style; change only target cells' `s=`.
- All other entries byte-identical; formulas/links/definedNames preserved.
- Archive vs workbook never decided by magic bytes.

Authority: the module + `tests/excel-hardcode-check/ooxml-highlight.test.js`.

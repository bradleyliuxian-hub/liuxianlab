'use strict';

/*
 * Liuxian Lab — Excel decimal check workbook logic (read-only).
 *
 * XLSX-engine agnostic: the SheetJS namespace is always passed in as the
 * first argument, so this module runs unchanged in the browser and in Node.
 *
 * The tool only *reports* cells whose actual numeric value has more than two
 * decimals. It never fixes or rewrites the workbook; an offline "highlighted
 * copy" is produced separately by a shared OOXML minimal patch.
 */
(function (root, factory) {
  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./decimal-core.js')
    : root.DecimalCheckCore;

  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalWorkbook = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  const TYPE_LABELS = {
    raw: '原始数据异常',
    formula: '公式结果异常',
    unknown: '公式结果不可判定'
  };

  function readOptions(extra) {
    return Object.assign({
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      sheetStubs: true,
      bookVBA: true
    }, extra || {});
  }

  function cellIsNumericDate(XLSX, cell) {
    return cell.t === 'n' && cell.z && typeof XLSX.SSF.is_date === 'function' && XLSX.SSF.is_date(cell.z);
  }

  function isBlankStub(cell) {
    if (cell.f) return false;
    return cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '';
  }

  function makeIssue(type, sheetName, cell, value, decimals, formula, numeric) {
    return {
      type,
      typeLabel: TYPE_LABELS[type],
      sheetName,
      cell,
      goto: core.buildExcelGotoReference(sheetName, cell),
      originalValue: value,
      isNumericValue: Boolean(numeric),
      decimals,
      originalFormula: formula || ''
    };
  }

  /*
   * Scan every worksheet and collect cells whose *actual* numeric value has
   * more than two effective decimal places. Formula cells without a readable
   * cached result are reported separately as "公式结果不可判定" — never
   * guessed, never treated as normal. The workbook is only read.
   */
  function scanWorkbook(XLSX, wb) {
    const issues = [];
    const sheetStats = [];
    let scannedCells = 0;

    wb.SheetNames.forEach(function (name) {
      const ws = wb.Sheets[name];
      let sheetScanned = 0;
      const issuesBefore = issues.length;

      if (ws) {
        Object.keys(ws).forEach(function (key) {
          if (key.charAt(0) === '!') return;
          const cell = ws[key];
          if (!cell) return;
          if (isBlankStub(cell)) return;

          sheetScanned += 1;

          if (cell.f) {
            if (cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '') {
              issues.push(makeIssue('unknown', name, key, null, null, cell.f, false));
              return;
            }
            if (cell.t === 'n' && !cellIsNumericDate(XLSX, cell)) {
              const places = core.effectiveDecimalPlaces(cell.v);
              if (places === null || places > 2) {
                issues.push(makeIssue('formula', name, key, cell.v, places, cell.f, true));
              }
            }
            return;
          }

          if (cell.t === 'n' && !cellIsNumericDate(XLSX, cell)) {
            const places = core.effectiveDecimalPlaces(cell.v);
            if (places === null || places > 2) {
              issues.push(makeIssue('raw', name, key, cell.v, places, '', true));
            }
          }
        });
      }

      scannedCells += sheetScanned;
      sheetStats.push({
        name,
        scanned: sheetScanned,
        issues: issues.length - issuesBefore
      });
    });

    const summary = {
      sheetCount: wb.SheetNames.length,
      scannedCells,
      rawCount: issues.filter(function (i) { return i.type === 'raw'; }).length,
      formulaCount: issues.filter(function (i) { return i.type === 'formula'; }).length,
      unknownCount: issues.filter(function (i) { return i.type === 'unknown'; }).length,
      issueCount: issues.length
    };

    return { issues, sheetStats, summary };
  }

  function formatDecimals(places) {
    return places === null ? '>15' : places;
  }

  /*
   * Rows for the human-facing issue list workbook. One row == one cell that
   * needs attention, with a directly usable F5 reference.
   */
  function buildIssuesAoa(issues) {
    const header = [
      '序号', '异常类型', '工作表', '单元格', 'F5定位地址',
      '原值', '有效小数位', '原公式'
    ];

    const rows = issues.map(function (issue, index) {
      return [
        index + 1,
        issue.typeLabel,
        issue.sheetName,
        issue.cell,
        issue.goto,
        issue.isNumericValue && issue.originalValue !== null ? issue.originalValue : '',
        formatDecimals(issue.decimals),
        issue.originalFormula || ''
      ];
    });

    return [header].concat(rows);
  }

  function buildIssuesWorkbook(XLSX, issues) {
    const aoa = buildIssuesAoa(issues);
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 24 },
      { wch: 16 }, { wch: 8 }, { wch: 28 }
    ];

    if (aoa.length > 1) {
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: aoa.length - 1, c: aoa[0].length - 1 }
        })
      };
    }

    const sanitize = (sheet) => {
      Object.keys(sheet).forEach((key) => {
        if (key.charAt(0) === '!') return;
        const cell = sheet[key];
        if (cell && typeof cell.v === 'string') { cell.t = 's'; delete cell.f; delete cell.F; }
      });
    };
    sanitize(ws);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '问题清单');
    return wb;
  }

  return {
    TYPE_LABELS,
    readOptions,
    scanWorkbook,
    buildIssuesAoa,
    buildIssuesWorkbook,
    formatDecimals
  };
});

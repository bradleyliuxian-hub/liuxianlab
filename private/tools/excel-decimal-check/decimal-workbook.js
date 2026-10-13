'use strict';

/*
 * Liuxian Lab — Excel decimal check workbook logic.
 *
 * XLSX-engine agnostic: the SheetJS namespace is always passed in as the
 * first argument, so this module runs unchanged in the browser and in Node.
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

  const STATUS = {
    fixed: '已自动修正',
    manual: '需要人工处理',
    unknown: '无法判断',
    failed: '处理失败'
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
      originalFormula: formula || '',
      fixedValue: null,
      fixedFormula: '',
      status: '',
      note: ''
    };
  }

  /*
   * Scan every worksheet and collect cells whose *actual* numeric value has
   * more than two effective decimal places. Formula cells without a readable
   * cached result are reported separately as "公式结果不可判定" — never
   * guessed, never treated as normal.
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

  function markFailed(issue, reason) {
    issue.status = STATUS.failed;
    issue.note = reason || '修正过程中发生异常。';
  }

  /*
   * Apply safe automatic fixes on the workbook in place and annotate each
   * issue object with its outcome. This is the single place where an issue's
   * fixedValue / fixedFormula / status / note are decided, so the UI and the
   * issue-list export always read the same final records.
   *
   * Raw numbers are rounded to two decimals; formula cells are wrapped in
   * ROUND(...,2) unless they cannot be changed safely (array formulas,
   * already-rounded formulas with a stale cache, or missing cells).
   */
  function applyFixes(XLSX, wb, issues) {
    issues.forEach(function (issue) {
      try {
        const ws = wb.Sheets[issue.sheetName];
        const cell = ws ? ws[issue.cell] : null;
        if (!cell) {
          markFailed(issue, '未能在工作簿中定位该单元格。');
          return;
        }

        if (issue.type === 'raw') {
          const fixed = core.roundToTwo(issue.originalValue);
          if (!Number.isFinite(fixed) || core.hasMoreThanTwoDecimals(fixed)) {
            issue.status = STATUS.manual;
            issue.note = '该数值无法安全自动修正，请人工核对。';
            return;
          }
          cell.v = fixed;
          cell.t = 'n';
          delete cell.w;
          issue.fixedValue = fixed;
          issue.status = STATUS.fixed;
          issue.note = '';
          return;
        }

        if (issue.type === 'formula') {
          if (cell.F) {
            issue.status = STATUS.manual;
            issue.fixedFormula = issue.originalFormula;
            issue.note = '数组公式，未自动修改，请人工核对。';
            return;
          }
          if (core.isAlreadyRoundedFormula(issue.originalFormula)) {
            issue.status = STATUS.manual;
            issue.fixedFormula = issue.originalFormula;
            issue.note = '公式已包含 ROUND 两位，但缓存结果显示超过两位小数，请人工核对。';
            return;
          }
          const wrapped = core.wrapFormulaWithRound(issue.originalFormula);
          cell.f = wrapped;
          cell.t = 'n';
          if (issue.isNumericValue) {
            const fixed = core.roundToTwo(issue.originalValue);
            cell.v = fixed;
            issue.fixedValue = fixed;
          } else {
            delete cell.v;
          }
          delete cell.w;
          issue.fixedFormula = wrapped;
          issue.status = STATUS.fixed;
          issue.note = '';
          return;
        }

        issue.status = STATUS.unknown;
        issue.note = '当前 Excel 文件未保存可读取的公式计算结果，请在 Excel / WPS 中重新计算并保存后再次检查';
      } catch (error) {
        markFailed(issue, error && error.message ? error.message : '修正过程中发生异常。');
      }
    });

    return issues;
  }

  /*
   * Scan a workbook and immediately resolve each issue's automatic-fix
   * outcome. The returned issues are the final records shared by the page
   * and the issue-list export — never rebuild them separately.
   */
  function analyzeWorkbook(XLSX, wb) {
    const result = scanWorkbook(XLSX, wb);
    applyFixes(XLSX, wb, result.issues);
    return result;
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
      '原值', '有效小数位', '原公式', '修正后值', '修正后公式', '自动处理状态', '备注'
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
        issue.originalFormula || '',
        issue.fixedValue !== null && issue.fixedValue !== undefined ? issue.fixedValue : '',
        issue.fixedFormula || '',
        issue.status || '',
        issue.note || ''
      ];
    });

    return [header].concat(rows);
  }

  function buildIssuesWorkbook(XLSX, issues) {
    const aoa = buildIssuesAoa(issues);
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 24 },
      { wch: 14 }, { wch: 8 }, { wch: 24 }, { wch: 14 }, { wch: 24 },
      { wch: 14 }, { wch: 40 }
    ];

    if (aoa.length > 1) {
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: aoa.length - 1, c: aoa[0].length - 1 }
        })
      };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '问题清单');
    return wb;
  }

  /*
   * Output book type so the corrected file keeps its original family where
   * SheetJS can safely write it. Everything else falls back to .xlsx.
   */
  function fixedOutputType(fileName) {
    const name = String(fileName || '').toLowerCase();
    if (name.endsWith('.xlsm')) return 'xlsm';
    if (name.endsWith('.xlsb')) return 'xlsb';
    return 'xlsx';
  }

  return {
    TYPE_LABELS,
    STATUS,
    readOptions,
    scanWorkbook,
    applyFixes,
    analyzeWorkbook,
    buildIssuesAoa,
    buildIssuesWorkbook,
    fixedOutputType,
    formatDecimals
  };
});

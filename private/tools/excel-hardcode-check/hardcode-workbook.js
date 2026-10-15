'use strict';

/*
 * Liuxian Lab - Excel hardcode check: workbook scan + report.
 *
 * SheetJS-agnostic (the XLSX namespace is passed in). Reads a parsed workbook,
 * builds a cell model, gathers neighbour context, calls the pure rule engine,
 * aggregates de-duplicated issues and builds the standalone report workbook.
 */

(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const core = isNode ? require('./hardcode-core.js') : root.HardcodeCore;
  const api = factory(core);
  if (isNode) module.exports = api;
  else root.HardcodeWorkbook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  const SEVERITY_LABEL = { HIGH: '高风险', SUSPICIOUS: '可疑', HARDCODE_NOTICE: '硬编码提示' };
  const SEVERITY_ORDER = { HIGH: 3, SUSPICIOUS: 2, HARDCODE_NOTICE: 1 };

  function readOptions(extra) {
    return Object.assign({
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      sheetStubs: false,
      bookVBA: false
    }, extra || {});
  }

  function isDateFormatted(XLSX, cell) {
    return cell.t === 'n' && cell.z && typeof XLSX.SSF === 'object'
      && typeof XLSX.SSF.is_date === 'function' && XLSX.SSF.is_date(cell.z);
  }

  function describeCell(XLSX, cell, row, col) {
    if (!cell) return null;
    if (cell.f) {
      const descriptor = core.buildCellDescriptor({ cellType: 'formula', formula: cell.f, row: row + 1, col });
      descriptor.value = cell.v === undefined ? null : cell.v;
      return descriptor;
    }
    if (cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '') return null;
    if (cell.t === 'n') {
      if (isDateFormatted(XLSX, cell)) return { present: true, cellType: 'date', value: cell.v, row: row + 1, col };
      return { present: true, cellType: 'number', value: cell.v, formula: null, row: row + 1, col };
    }
    if (cell.t === 's' || cell.t === 'str') return { present: true, cellType: 'string', value: cell.v, row: row + 1, col };
    if (cell.t === 'b') return { present: true, cellType: 'boolean', value: cell.v, row: row + 1, col };
    if (cell.t === 'e') return { present: true, cellType: 'error', value: cell.v, row: row + 1, col };
    return null;
  }

  function coveredCells(ws) {
    const covered = new Set();
    const merges = Array.isArray(ws['!merges']) ? ws['!merges'] : [];
    merges.forEach((merge) => {
      for (let r = merge.s.r; r <= merge.e.r; r += 1) {
        for (let c = merge.s.c; c <= merge.e.c; c += 1) {
          if (r === merge.s.r && c === merge.s.c) continue;
          covered.add(`${r}:${c}`);
        }
      }
    });
    return covered;
  }

  function buildSheetModel(XLSX, ws) {
    const cells = new Map();
    if (!ws || !ws['!ref']) return cells;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const covered = coveredCells(ws);
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const key = `${r}:${c}`;
        if (covered.has(key)) continue;
        const descriptor = describeCell(XLSX, ws[XLSX.utils.encode_cell({ r, c })], r, c);
        if (descriptor) cells.set(key, descriptor);
      }
    }
    return cells;
  }

  function regionStats(cells, r, c) {
    let effectiveCells = 0;
    let formulaCells = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const descriptor = cells.get(`${r + dr}:${c + dc}`);
        if (!descriptor) continue;
        effectiveCells += 1;
        if (descriptor.cellType === 'formula') formulaCells += 1;
      }
    }
    return { effectiveCells, formulaCells, formulaRatio: effectiveCells ? formulaCells / effectiveCells : 0 };
  }

  function sheetHidden(wb, name) {
    const meta = wb && wb.Workbook && Array.isArray(wb.Workbook.Sheets) ? wb.Workbook.Sheets : [];
    const entry = meta.find((s) => s && s.name === name);
    return Boolean(entry && entry.Hidden);
  }

  function scanWorkbook(XLSX, wb) {
    const issues = [];
    const sheetStats = [];
    let scannedCells = 0;
    let formulaCells = 0;

    (wb.SheetNames || []).forEach((name) => {
      const ws = wb.Sheets[name];
      const hidden = sheetHidden(wb, name);
      if (!ws) { sheetStats.push({ name, hidden, scanned: 0, issues: 0 }); return; }

      const cells = buildSheetModel(XLSX, ws);
      let sheetScanned = 0;
      const before = issues.length;

      cells.forEach((descriptor, key) => {
        sheetScanned += 1;
        if (descriptor.cellType === 'formula') formulaCells += 1;
        if (descriptor.cellType !== 'formula' && descriptor.cellType !== 'number') return;

        const [r, c] = key.split(':').map(Number);
        const at = (rr, cc) => cells.get(`${rr}:${cc}`);
        const address = XLSX.utils.encode_cell({ r, c });
        const context = {
          sheetName: name,
          sheetHidden: hidden,
          cellAddress: address,
          row: r + 1,
          col: c,
          excelAddress: core.buildExcelAddress(name, address),
          cellType: descriptor.cellType,
          value: descriptor.value,
          formula: descriptor.formula,
          parsed: descriptor.parsed,
          pattern: descriptor.pattern,
          horizontal: { left2: at(r, c - 2), left1: at(r, c - 1), right1: at(r, c + 1), right2: at(r, c + 2) },
          vertical: { up2: at(r - 2, c), up1: at(r - 1, c), down1: at(r + 1, c), down2: at(r + 2, c) },
          region: regionStats(cells, r, c)
        };

        const issue = core.evaluate(context);
        if (issue) {
          issue.sheetHidden = hidden;
          issues.push(issue);
        }
      });

      scannedCells += sheetScanned;
      sheetStats.push({
        name,
        hidden,
        scanned: sheetScanned,
        formulaCells: 0,
        issues: issues.length - before
      });
    });

    issues.sort((a, b) => {
      const rank = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (rank !== 0) return rank;
      if (a.sheetName !== b.sheetName) return a.sheetName < b.sheetName ? -1 : 1;
      return 0;
    });

    const summary = {
      sheetCount: (wb.SheetNames || []).length,
      scannedCells,
      formulaCells,
      highCount: issues.filter((i) => i.severity === 'HIGH').length,
      suspiciousCount: issues.filter((i) => i.severity === 'SUSPICIOUS').length,
      noticeCount: issues.filter((i) => i.severity === 'HARDCODE_NOTICE').length,
      roundingPlugCount: issues.filter((i) => i.ruleId === 'HC006').length,
      issueCount: issues.length
    };

    return { issues, summary, sheetStats };
  }

  function sanitizeText(ws) {
    Object.keys(ws).forEach((key) => {
      if (key[0] === '!') return;
      const cell = ws[key];
      if (cell && typeof cell.v === 'string') {
        cell.t = 's';
        delete cell.f;
        delete cell.F;
      }
    });
  }

  const ROLE_LABEL = {
    ROUNDING_PLUG: '人工尾差/勾稽调整',
    LOCAL_OVERRIDE: '局部调整',
    SHARED_BUSINESS_CONSTANT: '共享常量',
    CONTROL_ARGUMENT: '控制参数',
    DATE_ARGUMENT: '日期参数',
    LOGICAL_CONSTANT: '逻辑值',
    BUSINESS_CONSTANT: '业务常量'
  };

  function anomalousText(issue) {
    const details = Array.isArray(issue.constantDetails) ? issue.constantDetails : [];
    const anomalous = details.filter((d) => d.anomalous);
    if (anomalous.length) return anomalous.map((d) => `${d.value}（${ROLE_LABEL[d.role] || d.role}）`).join('、');
    return issue.constants.join('、');
  }

  function rolesText(issue) {
    const details = Array.isArray(issue.constantDetails) ? issue.constantDetails : [];
    return details.map((d) => `${d.value}:${d.role}`).join('、');
  }

  function buildReportWorkbook(XLSX, meta, issues, summary) {
    const generatedAt = meta.generatedAt || new Date().toISOString();
    const dashboardRows = [
      ['Excel 死数检查报告'],
      [],
      ['检查文件', meta.fileName || 'workbook.xlsx'],
      ['工作表数量', summary.sheetCount],
      ['扫描单元格数', summary.scannedCells],
      ['公式单元格数', summary.formulaCells],
      ['高风险数量', summary.highCount],
      ['可疑数量', summary.suspiciousCount],
      ['硬编码提示数量', summary.noticeCount],
      ['人工尾差/勾稽调整数量', summary.roundingPlugCount || 0],
      ['问题总数', summary.issueCount],
      ['生成时间', generatedAt]
    ];
    const dashboard = XLSX.utils.aoa_to_sheet(dashboardRows);
    dashboard['!cols'] = [{ wch: 22 }, { wch: 30 }];

    const header = ['等级', '规则编号', '匹配规则', '工作表', '单元格', 'Excel Address',
      '当前值', '当前公式', '异常常量', '常量角色', '问题描述', '判断依据', '建议', '置信度'];
    const rows = issues.map((issue) => [
      SEVERITY_LABEL[issue.severity] || issue.severity,
      issue.ruleId,
      issue.matchedRules.join('、'),
      issue.sheetName,
      issue.cellAddress,
      issue.excelAddress,
      issue.value === null || issue.value === undefined ? '' : issue.value,
      issue.formula || '',
      anomalousText(issue),
      rolesText(issue),
      core.RULES[issue.ruleId] ? core.RULES[issue.ruleId].title : '',
      issue.evidence.join('；'),
      issue.suggestion,
      issue.confidenceScore
    ]);

    const resultSheet = XLSX.utils.aoa_to_sheet([header].concat(rows));
    resultSheet['!cols'] = [
      { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 24 },
      { wch: 14 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 22 }, { wch: 50 }, { wch: 30 }, { wch: 8 }
    ];
    if (rows.length) {
      resultSheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } })
      };
    }

    sanitizeText(dashboard);
    sanitizeText(resultSheet);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, dashboard, 'Dashboard');
    XLSX.utils.book_append_sheet(wb, resultSheet, '检查结果');
    return wb;
  }

  function buildIssuesAoa(issues) {
    const header = ['等级', '规则编号', '工作表', '单元格', 'Excel Address', '问题描述', '建议'];
    return [header].concat(issues.map((issue) => [
      SEVERITY_LABEL[issue.severity] || issue.severity,
      issue.ruleId,
      issue.sheetName,
      issue.cellAddress,
      issue.excelAddress,
      core.RULES[issue.ruleId] ? core.RULES[issue.ruleId].title : '',
      issue.suggestion
    ]));
  }

  return {
    SEVERITY_LABEL,
    readOptions,
    buildSheetModel,
    regionStats,
    scanWorkbook,
    buildReportWorkbook,
    buildIssuesAoa
  };
});

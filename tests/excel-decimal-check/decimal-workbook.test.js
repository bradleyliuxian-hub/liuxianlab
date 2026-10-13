'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
const DecimalWorkbook = require('../../private/tools/excel-decimal-check/decimal-workbook.js');

function syntheticWorkbook() {
  return {
    SheetNames: ['销售明细', '成本表'],
    Sheets: {
      销售明细: {
        '!ref': 'A1:K1',
        A1: { t: 'n', v: 123.456 },
        B1: { t: 'n', v: 10.12 },
        C1: { t: 'n', v: 0.1 + 0.2 },
        D1: { t: 's', v: 'text 1.234' },
        E1: { t: 'n', v: 45293, z: 'yyyy-mm-dd' },
        F1: { t: 'b', v: true },
        G1: { t: 'e', v: 7 },
        H1: { t: 'n', v: 12.3456, f: 'A1/B1' },
        I1: { t: 'n', v: 10.1, f: 'A1/C1' },
        J1: { t: 'z', v: 0, f: 'A1/0' },
        K1: { t: 'z' }
      },
      成本表: {
        '!ref': 'F26',
        F26: { t: 'n', v: 1.2345 }
      }
    }
  };
}

test('scanWorkbook: classifies every cell kind correctly', () => {
  const result = DecimalWorkbook.scanWorkbook(XLSX, syntheticWorkbook());

  assert.equal(result.summary.sheetCount, 2);
  assert.equal(result.summary.rawCount, 2);
  assert.equal(result.summary.formulaCount, 1);
  assert.equal(result.summary.unknownCount, 1);
  assert.equal(result.summary.issueCount, 4);
  assert.equal(result.summary.scannedCells, 11);

  const byCell = {};
  result.issues.forEach((issue) => { byCell[`${issue.sheetName}!${issue.cell}`] = issue; });

  assert.equal(byCell['销售明细!A1'].type, 'raw');
  assert.equal(byCell['成本表!F26'].type, 'raw');
  assert.equal(byCell['成本表!F26'].goto, '成本表!F26');
  assert.equal(byCell['销售明细!H1'].type, 'formula');
  assert.equal(byCell['销售明细!H1'].originalFormula, 'A1/B1');
  assert.equal(byCell['销售明细!H1'].decimals, 4);
  assert.equal(byCell['销售明细!J1'].type, 'unknown');

  assert.equal(byCell['销售明细!B1'], undefined);
  assert.equal(byCell['销售明细!C1'], undefined);
  assert.equal(byCell['销售明细!E1'], undefined);
  assert.equal(byCell['销售明细!I1'], undefined);
});

test('applyFixes: rounds raw numbers and wraps formulas safely', () => {
  const wb = syntheticWorkbook();
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  DecimalWorkbook.applyFixes(XLSX, wb, issues);

  const raw = issues.find((i) => i.cell === 'A1' && i.sheetName === '销售明细');
  assert.equal(raw.status, DecimalWorkbook.STATUS.fixed);
  assert.equal(raw.fixedValue, 123.46);
  assert.equal(wb.Sheets['销售明细'].A1.v, 123.46);

  const formula = issues.find((i) => i.cell === 'H1');
  assert.equal(formula.status, DecimalWorkbook.STATUS.fixed);
  assert.equal(formula.fixedFormula, 'ROUND((A1/B1),2)');
  assert.equal(wb.Sheets['销售明细'].H1.f, 'ROUND((A1/B1),2)');
  assert.equal(wb.Sheets['销售明细'].H1.v, 12.35);

  const unknown = issues.find((i) => i.cell === 'J1');
  assert.equal(unknown.status, DecimalWorkbook.STATUS.unknown);
  assert.equal(wb.Sheets['销售明细'].J1.f, 'A1/0');
});

test('applyFixes: does not double-wrap or touch array formulas', () => {
  const wb = {
    SheetNames: ['S'],
    Sheets: {
      S: {
        '!ref': 'A1:C1',
        A1: { t: 'n', v: 12.3456, f: 'ROUND(B1/C1,2)' },
        B1: { t: 'n', v: 12.3456, f: 'B1/C1', F: 'B1' },
        C1: { t: 'n', v: 12.3456, f: 'B1/C1' }
      }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  DecimalWorkbook.applyFixes(XLSX, wb, issues);

  const already = issues.find((i) => i.cell === 'A1');
  assert.equal(already.status, DecimalWorkbook.STATUS.manual);
  assert.ok(already.note, 'already-rounded stale case needs a note');
  assert.equal(wb.Sheets.S.A1.f, 'ROUND(B1/C1,2)');

  const array = issues.find((i) => i.cell === 'B1');
  assert.equal(array.status, DecimalWorkbook.STATUS.manual);
  assert.equal(wb.Sheets.S.B1.f, 'B1/C1');

  const wrapped = issues.find((i) => i.cell === 'C1');
  assert.equal(wrapped.fixedFormula, 'ROUND((B1/C1),2)');
});

test('fixed workbook round-trip: anomalies become zero', () => {
  const ws = XLSX.utils.aoa_to_sheet([[123.456, null], [10.12, null]]);
  ws['!ref'] = 'A1:C2';
  ws.B1 = { t: 'n', v: 12.3456, f: 'A1/2' };
  ws.C2 = { t: 'n', v: 10.123, f: 'A1/A2' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, DecimalWorkbook.readOptions({ type: 'buffer' }));
  const before = DecimalWorkbook.scanWorkbook(XLSX, reread);
  assert.equal(before.summary.rawCount, 1);
  assert.equal(before.summary.formulaCount, 2);

  DecimalWorkbook.applyFixes(XLSX, reread, before.issues);
  const fixedBuf = XLSX.write(reread, { type: 'buffer', bookType: 'xlsx' });
  const after = XLSX.read(fixedBuf, DecimalWorkbook.readOptions({ type: 'buffer' }));
  const rescanned = DecimalWorkbook.scanWorkbook(XLSX, after);

  assert.equal(rescanned.summary.rawCount, 0);
  assert.equal(rescanned.summary.formulaCount, 0);
  assert.equal(rescanned.summary.unknownCount, 0);
  assert.equal(after.Sheets.S.B1.f, 'ROUND((A1/2),2)');
  assert.equal(after.Sheets.S.C2.f, 'ROUND((A1/A2),2)');
});

test('issues workbook: one row per issue with a usable F5 reference', () => {
  const wb = {
    SheetNames: ["Brad's Data", '销售明细 10月'],
    Sheets: {
      "Brad's Data": { '!ref': 'C18', C18: { t: 'n', v: 123.456 } },
      '销售明细 10月': { '!ref': 'F26', F26: { t: 'n', v: 12.3456, f: 'A26/B26' } }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  DecimalWorkbook.applyFixes(XLSX, wb, issues);

  const issuesWb = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues);
  const buf = XLSX.write(issuesWb, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  const sheet = reread.Sheets['问题清单'];

  assert.ok(sheet, '问题清单 sheet exists');
  assert.equal(sheet.A1.v, '序号');
  assert.equal(sheet.E1.v, 'F5定位地址');
  assert.equal(sheet.L1.v, '备注');
  assert.equal(sheet.A4, undefined, 'no extra rows');

  const gotos = [sheet.E2, sheet.E3].map((cell) => cell && cell.v);
  assert.deepEqual(gotos.sort(), ["'Brad''s Data'!C18", "'销售明细 10月'!F26"].sort());

  [sheet.E2, sheet.E3].forEach((cell) => {
    assert.equal(cell.t, 's', 'F5 address is stored as text, never a formula');
  });

  assert.equal(sheet.C2.v, "Brad's Data");
  assert.equal(sheet.D2.v, 'C18');
});

test('buildIssuesAoa: rows match the issue list', () => {
  const wb = syntheticWorkbook();
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  DecimalWorkbook.applyFixes(XLSX, wb, issues);
  const aoa = DecimalWorkbook.buildIssuesAoa(issues);

  assert.equal(aoa.length, issues.length + 1);
  assert.equal(aoa[0].length, 12);
  aoa.slice(1).forEach((row, index) => {
    assert.equal(row[0], index + 1);
    assert.equal(row[4], issues[index].goto);
    assert.equal(row[1], issues[index].typeLabel);
  });
});

test('analyzeWorkbook: scan and fix resolve on the same issue records', () => {
  const wb = syntheticWorkbook();
  const result = DecimalWorkbook.analyzeWorkbook(XLSX, wb);

  result.issues.forEach((issue) => {
    assert.ok(issue.status, `issue ${issue.cell} has a final status`);
    if (issue.type === 'raw') {
      assert.equal(issue.status, DecimalWorkbook.STATUS.fixed);
      assert.equal(typeof issue.fixedValue, 'number');
    }
    if (issue.type === 'unknown') {
      assert.equal(issue.status, DecimalWorkbook.STATUS.unknown);
      assert.ok(issue.note.length > 0);
      assert.equal(issue.fixedValue, null);
      assert.equal(issue.fixedFormula, '');
    }
  });
});

function pipelineWorkbook() {
  return {
    SheetNames: ['Raw Numbers', 'Formula Cached', 'Formula No Cache', 'Array Formula'],
    Sheets: {
      'Raw Numbers': {
        '!ref': 'B6:B7',
        B6: { t: 'n', v: 10.123 },
        B7: { t: 'n', v: -12.345 }
      },
      'Formula Cached': {
        '!ref': 'D3',
        D3: { t: 'n', v: 12.3456, f: 'B3/C3' }
      },
      'Formula No Cache': {
        '!ref': 'D3',
        D3: { t: 'z', v: 0, f: 'B3/C3' }
      },
      'Array Formula': {
        '!ref': 'A1',
        A1: { t: 'n', v: 12.3456, f: 'B1/C1', F: 'A1' }
      }
    }
  };
}

test('issue-list export: post-fix columns are populated for every type', () => {
  const wb = pipelineWorkbook();
  const result = DecimalWorkbook.analyzeWorkbook(XLSX, wb);

  const issuesWb = DecimalWorkbook.buildIssuesWorkbook(XLSX, result.issues);
  const buf = XLSX.write(issuesWb, { type: 'buffer', bookType: 'xlsx' });
  const sheet = XLSX.read(buf, { type: 'buffer' }).Sheets['问题清单'];

  const rowIndex = {};
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = 1; r <= range.e.r; r += 1) {
    const sheetName = sheet['C' + (r + 1)].v;
    const cell = sheet['D' + (r + 1)].v;
    rowIndex[`${sheetName}!${cell}`] = r + 1;
  }

  function value(sheetName, cell, column) {
    const address = column + rowIndex[`${sheetName}!${cell}`];
    const c = sheet[address];
    return c === undefined ? '' : c.v;
  }

  // Ordinary number: fixed value + status, empty note.
  assert.equal(value('Raw Numbers', 'B6', 'F'), 10.123);
  assert.equal(value('Raw Numbers', 'B6', 'I'), 10.12);
  assert.equal(value('Raw Numbers', 'B6', 'H'), '');
  assert.equal(value('Raw Numbers', 'B6', 'K'), '已自动修正');
  assert.equal(value('Raw Numbers', 'B6', 'L'), '');

  // Negative number.
  assert.equal(value('Raw Numbers', 'B7', 'I'), -12.35);
  assert.equal(value('Raw Numbers', 'B7', 'K'), '已自动修正');

  // Formula anomaly: original + fixed formula, no static value.
  assert.equal(value('Formula Cached', 'D3', 'H'), 'B3/C3');
  assert.equal(value('Formula Cached', 'D3', 'J'), 'ROUND((B3/C3),2)');
  assert.equal(value('Formula Cached', 'D3', 'K'), '已自动修正');

  // Formula without cached result: unknown, note required, no fabricated fix.
  assert.equal(value('Formula No Cache', 'D3', 'H'), 'B3/C3');
  assert.equal(value('Formula No Cache', 'D3', 'I'), '');
  assert.equal(value('Formula No Cache', 'D3', 'J'), '');
  assert.equal(value('Formula No Cache', 'D3', 'K'), '无法判断');
  assert.ok(String(value('Formula No Cache', 'D3', 'L')).length > 0);

  // Array formula: manual, never falsely marked fixed.
  assert.equal(value('Array Formula', 'A1', 'K'), '需要人工处理');
  assert.ok(String(value('Array Formula', 'A1', 'L')).length > 0);

  // F5 addresses are present and correctly quoted in the sheet.
  assert.equal(value('Raw Numbers', 'B6', 'E'), "'Raw Numbers'!B6");
  assert.equal(value('Formula Cached', 'D3', 'E'), "'Formula Cached'!D3");
});

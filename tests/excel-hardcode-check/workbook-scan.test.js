'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
const HardcodeWorkbook = require('../../private/tools/excel-hardcode-check/hardcode-workbook.js');

function workbook(sheets, metaSheets) {
  return {
    SheetNames: sheets.map((s) => s.name),
    Sheets: sheets.reduce((acc, s) => { acc[s.name] = s.ws; return acc; }, {}),
    Workbook: { Sheets: metaSheets || sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })) }
  };
}

function formula(v, f) { return { t: 'n', v, f }; }

test('scanWorkbook: detects HC001 (value interrupting a formula row)', () => {
  const ws = {
    '!ref': 'B10:F10',
    B10: formula(0, 'B5-B6'),
    C10: formula(0, 'C5-C6'),
    D10: { t: 'n', v: 1250 },
    E10: formula(0, 'E5-E6'),
    F10: formula(0, 'F5-F6')
  };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: '利润表', ws }]));
  const issue = result.issues.find((i) => i.cellAddress === 'D10');
  assert.ok(issue);
  assert.equal(issue.ruleId, 'HC001');
  assert.equal(issue.severity, 'HIGH');
  assert.equal(issue.excelAddress, '利润表!D10');
});

test('scanWorkbook: detects HC002 and a notice in one pass', () => {
  const ws = {
    '!ref': 'A20:E20',
    A30: { t: 'n', v: 1, f: 'A1*1.13' },
    B20: formula(0, 'B1*B5'),
    C20: formula(0, 'C1*C5'),
    D20: formula(0, 'D1*1.2'),
    E20: formula(0, 'E1*E5')
  };
  ws['!ref'] = 'A20:E30';
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: 'Sheet1', ws }]));
  assert.equal(result.issues.find((i) => i.cellAddress === 'D20').ruleId, 'HC002');
  assert.equal(result.issues.find((i) => i.cellAddress === 'A30').ruleId, 'HC202');
  assert.equal(result.summary.highCount, 1);
  assert.equal(result.summary.noticeCount, 1);
});

test('scanWorkbook: skips strings, blanks and date cells', () => {
  const ws = {
    '!ref': 'A1:C1',
    A1: { t: 's', v: 'note 1.234' },
    B1: { t: 'n', v: 45293, z: 'yyyy-mm-dd' },
    C1: { t: 'z' }
  };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: 'S', ws }]));
  assert.equal(result.issues.length, 0);
});

test('scanWorkbook: marks hidden sheets and counts formula cells', () => {
  const ws = {
    '!ref': 'A1:B1',
    A1: formula(0, 'A1+A1'),
    B1: { t: 'n', v: 7 }
  };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: '隐藏表', ws, hidden: true }]));
  assert.equal(result.summary.formulaCells, 1);
  assert.equal(result.summary.scannedCells, 2);
  assert.equal(result.summary.sheetCount, 1);
});

test('scanWorkbook: merged cells produce a single issue (anchor only)', () => {
  const ws = {
    '!ref': 'B10:F10',
    B10: formula(0, 'B5-B6'),
    C10: formula(0, 'C5-C6'),
    D10: { t: 'n', v: 100 },
    E10: formula(0, 'E5-E6'),
    F10: formula(0, 'F5-F6'),
    '!merges': [{ s: { r: 9, c: 3 }, e: { r: 9, c: 3 } }]
  };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: 'S', ws }]));
  assert.equal(result.issues.filter((i) => i.ruleId === 'HC001').length, 1);
});

test('buildReportWorkbook: Dashboard + 检查结果, text kept as text', () => {
  const ws = {
    '!ref': 'B10:F10',
    B10: formula(0, 'B5-B6'),
    C10: formula(0, 'C5-C6'),
    D10: { t: 'n', v: 1250 },
    E10: formula(0, 'E5-E6'),
    F10: formula(0, 'F5-F6')
  };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: '利润表', ws }]));
  const reportWb = HardcodeWorkbook.buildReportWorkbook(XLSX, { fileName: '测试.xlsx', generatedAt: '2026-10-14T00:00:00Z' }, result.issues, result.summary);

  const buffer = XLSX.write(reportWb, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buffer, { type: 'buffer' });

  assert.deepEqual(reread.SheetNames, ['Dashboard', '检查结果']);

  const resultSheet = reread.Sheets['检查结果'];
  assert.equal(resultSheet.A1.v, '等级');
  assert.equal(resultSheet.F1.v, 'Excel Address');

  const addressCell = resultSheet.F2;
  assert.equal(addressCell.t, 's', 'Excel Address stored as text');
  assert.equal(addressCell.v, '利润表!D10');

  const formulaCell = resultSheet.H2;
  assert.equal(formulaCell.t, 's', 'formula text stored as text, never a live formula');
  assert.equal(formulaCell.f, undefined);

  const dashboard = reread.Sheets['Dashboard'];
  assert.equal(dashboard.A1.v, 'Excel 死数检查报告');
});

test('buildIssuesAoa: one row per issue', () => {
  const ws = { '!ref': 'B10:F10', B10: formula(0, 'B5-B6'), C10: formula(0, 'C5-C6'), D10: { t: 'n', v: 1 }, E10: formula(0, 'E5-E6'), F10: formula(0, 'F5-F6') };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: 'S', ws }]));
  const aoa = HardcodeWorkbook.buildIssuesAoa(result.issues);
  assert.equal(aoa.length, result.issues.length + 1);
  assert.equal(aoa[0][0], '等级');
});

test('buildExcelAddress: sheet names with spaces are quoted', () => {
  const ws = { '!ref': 'B1', B1: { t: 'n', v: 1.5, f: 'A1*1.5' } };
  const result = HardcodeWorkbook.scanWorkbook(XLSX, workbook([{ name: '销售 明细', ws }]));
  assert.equal(result.issues[0].excelAddress, "'销售 明细'!B1");
});

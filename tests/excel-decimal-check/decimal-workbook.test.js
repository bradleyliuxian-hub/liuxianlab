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

  // No fix/status fields on the issue model any more.
  assert.equal('status' in byCell['销售明细!A1'], false);
  assert.equal('fixedValue' in byCell['销售明细!A1'], false);
  assert.equal('fixedFormula' in byCell['销售明细!A1'], false);
});

test('scanWorkbook: is read-only (does not modify the workbook)', () => {
  const wb = syntheticWorkbook();
  const snapshot = JSON.stringify(wb);
  DecimalWorkbook.scanWorkbook(XLSX, wb);
  assert.equal(JSON.stringify(wb), snapshot, 'viewer workbook must stay unmodified');
  assert.equal(wb.Sheets['销售明细'].A1.v, 123.456);
  assert.equal(wb.Sheets['销售明细'].H1.f, 'A1/B1');
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

  const issuesWb = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues);
  const buf = XLSX.write(issuesWb, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  const sheet = reread.Sheets['问题清单'];

  assert.ok(sheet, '问题清单 sheet exists');
  assert.equal(sheet.A1.v, '序号');
  assert.equal(sheet.E1.v, 'F5定位地址');
  assert.equal(sheet.H1.v, '原公式');
  assert.equal(sheet.I1, undefined, 'no fix/status columns');
  assert.equal(sheet.A4, undefined, 'no extra rows');

  const gotos = [sheet.E2, sheet.E3].map((cell) => cell && cell.v);
  assert.deepEqual(gotos.sort(), ["'Brad''s Data'!C18", "'销售明细 10月'!F26"].sort());

  [sheet.E2, sheet.E3].forEach((cell) => {
    assert.equal(cell.t, 's', 'F5 address is stored as text, never a formula');
  });

  assert.equal(sheet.C2.v, "Brad's Data");
  assert.equal(sheet.D2.v, 'C18');
});

test('buildIssuesAoa: rows match the issue list (8 columns, no status)', () => {
  const wb = syntheticWorkbook();
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const aoa = DecimalWorkbook.buildIssuesAoa(issues);

  assert.equal(aoa.length, issues.length + 1);
  assert.equal(aoa[0].length, 8);
  aoa.slice(1).forEach((row, index) => {
    assert.equal(row[0], index + 1);
    assert.equal(row[4], issues[index].goto);
    assert.equal(row[1], issues[index].typeLabel);
  });
});

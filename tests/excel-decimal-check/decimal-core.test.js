'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../../private/tools/excel-decimal-check/decimal-core.js');

test('effectiveDecimalPlaces: allowed values', () => {
  assert.equal(core.effectiveDecimalPlaces(10), 0);
  assert.equal(core.effectiveDecimalPlaces(10.0), 0);
  assert.equal(core.effectiveDecimalPlaces(10.1), 1);
  assert.equal(core.effectiveDecimalPlaces(10.12), 2);
  assert.equal(core.effectiveDecimalPlaces(10.120), 2);
  assert.equal(core.effectiveDecimalPlaces(0), 0);
});

test('effectiveDecimalPlaces: anomalies', () => {
  assert.equal(core.effectiveDecimalPlaces(10.123), 3);
  assert.equal(core.effectiveDecimalPlaces(-10.123), 3);
  assert.equal(core.effectiveDecimalPlaces(0.001), 3);
  assert.equal(core.effectiveDecimalPlaces(123.4567), 4);
  assert.equal(core.effectiveDecimalPlaces(1.005), 3);
});

test('effectiveDecimalPlaces: no floating point false positives', () => {
  assert.equal(core.effectiveDecimalPlaces(0.1 + 0.2), 1);
  assert.equal(core.hasMoreThanTwoDecimals(0.1 + 0.2), false);
  assert.equal(core.hasMoreThanTwoDecimals(0.1 + 0.2 - 0.3), false);
});

test('effectiveDecimalPlaces: ignores non-finite input', () => {
  assert.equal(core.effectiveDecimalPlaces(NaN), null);
  assert.equal(core.effectiveDecimalPlaces(Infinity), null);
  assert.equal(core.effectiveDecimalPlaces('1.234'), null);
  assert.equal(core.effectiveDecimalPlaces(null), null);
});

test('hasMoreThanTwoDecimals', () => {
  assert.equal(core.hasMoreThanTwoDecimals(10), false);
  assert.equal(core.hasMoreThanTwoDecimals(10.1), false);
  assert.equal(core.hasMoreThanTwoDecimals(10.12), false);
  assert.equal(core.hasMoreThanTwoDecimals(10.120), false);
  assert.equal(core.hasMoreThanTwoDecimals(10.123), true);
  assert.equal(core.hasMoreThanTwoDecimals(-10.123), true);
  assert.equal(core.hasMoreThanTwoDecimals(0.001), true);
});

test('no auto-fix helpers are exported any more', () => {
  assert.equal(core.roundToTwo, undefined);
  assert.equal(core.wrapFormulaWithRound, undefined);
  assert.equal(core.isAlreadyRoundedFormula, undefined);
});

test('parseCellAddress: basic, absolute, and invalid input', () => {
  assert.deepEqual(core.parseCellAddress('A1'), { row: 0, col: 0 });
  assert.deepEqual(core.parseCellAddress('C18'), { row: 17, col: 2 });
  assert.deepEqual(core.parseCellAddress('$AA$64'), { row: 63, col: 26 });
  assert.deepEqual(core.parseCellAddress('aa1'), { row: 0, col: 26 });
  assert.equal(core.parseCellAddress('A1:B2'), null);
  assert.equal(core.parseCellAddress('hello'), null);
  assert.equal(core.parseCellAddress(''), null);
});

test('buildExcelGotoReference: plain sheet names', () => {
  assert.equal(core.buildExcelGotoReference('Sheet1', 'C18'), 'Sheet1!C18');
  assert.equal(core.buildExcelGotoReference('销售明细', 'C18'), '销售明细!C18');
  assert.equal(core.buildExcelGotoReference('Data_2024', 'AA1'), 'Data_2024!AA1');
});

test('buildExcelGotoReference: quotes names that need it', () => {
  assert.equal(core.buildExcelGotoReference('销售明细 10月', 'C18'), "'销售明细 10月'!C18");
  assert.equal(core.buildExcelGotoReference('2024', 'A1'), "'2024'!A1");
  assert.equal(core.buildExcelGotoReference('A1', 'B2'), "'A1'!B2");
  assert.equal(core.buildExcelGotoReference('总-表', 'C18'), "'总-表'!C18");
});

test('buildExcelGotoReference: escapes embedded single quotes', () => {
  assert.equal(core.buildExcelGotoReference("Brad's Data", 'C18'), "'Brad''s Data'!C18");
  assert.equal(core.buildExcelGotoReference("O'Brien", 'A1'), "'O''Brien'!A1");
});

test('buildExcelGotoReference: cell ranges are preserved', () => {
  assert.equal(core.buildExcelGotoReference('销售明细', 'A1:B2'), '销售明细!A1:B2');
});

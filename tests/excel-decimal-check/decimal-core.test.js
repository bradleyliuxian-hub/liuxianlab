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

test('roundToTwo: reliable half-away-from-zero rounding', () => {
  assert.equal(core.roundToTwo(123.4567), 123.46);
  assert.equal(core.roundToTwo(1.005), 1.01);
  assert.equal(core.roundToTwo(2.675), 2.68);
  assert.equal(core.roundToTwo(-1.005), -1.01);
  assert.equal(core.roundToTwo(-12.345), -12.35);
  assert.equal(core.roundToTwo(0.1 + 0.2), 0.3);
  assert.equal(core.roundToTwo(10), 10);
  assert.equal(core.roundToTwo(10.12), 10.12);
});

test('roundToTwo: output never has more than two decimals', () => {
  [123.4567, 1.005, 99999.999, -0.004, 0.001, 1234567.891234, 3.14159].forEach((value) => {
    assert.equal(core.hasMoreThanTwoDecimals(core.roundToTwo(value)), false);
  });
});

test('isAlreadyRoundedFormula', () => {
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1/B1,2)'), true);
  assert.equal(core.isAlreadyRoundedFormula('=ROUND(A1/B1,2)'), true);
  assert.equal(core.isAlreadyRoundedFormula('round(A1/B1, 2)'), true);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(ROUND(A1,3),2)'), true);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1)'), true);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1,0)'), true);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1/B1,3)'), false);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1/B1,4)'), false);
  assert.equal(core.isAlreadyRoundedFormula('A1/B1'), false);
  assert.equal(core.isAlreadyRoundedFormula('ROUND(A1/B1,2)+1'), false);
  assert.equal(core.isAlreadyRoundedFormula('SUM(ROUND(A1,2),B1)'), false);
  assert.equal(core.isAlreadyRoundedFormula(''), false);
});

test('wrapFormulaWithRound does not double-wrap', () => {
  assert.equal(core.wrapFormulaWithRound('A1/B1'), 'ROUND((A1/B1),2)');
  assert.equal(core.wrapFormulaWithRound('=A1/B1'), 'ROUND((A1/B1),2)');
  assert.equal(core.wrapFormulaWithRound(' SUM(A1:A3)/COUNT(A1:A3) '), 'ROUND((SUM(A1:A3)/COUNT(A1:A3)),2)');
  assert.equal(core.isAlreadyRoundedFormula(core.wrapFormulaWithRound('A1/B1')), true);
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

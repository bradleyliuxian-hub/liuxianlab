'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../../private/tools/excel-hardcode-check/formula-parser.js');

function roles(formula) {
  return P.parse(formula).constants.map((c) => [c.value, c.role]);
}

test('tokenize: references, ranges and sheet-qualified references', () => {
  const tokens = P.tokenize('SUM(A1:B2)+Sheet2!C3+$A$1+A$1+$A1');
  const refs = tokens.filter((t) => t.type === 'ref');
  const ranges = tokens.filter((t) => t.type === 'range');
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start.col, 0);
  assert.equal(ranges[0].end.col, 1);
  assert.equal(refs.length, 4);
  const sheetRef = refs.find((r) => r.sheet === 'Sheet2');
  assert.ok(sheetRef);
  assert.equal(sheetRef.row, 3);
});

test('tokenize: mixed and absolute reference flags', () => {
  const tokens = P.tokenize('$A$1+A$1+$A1');
  const refs = tokens.filter((t) => t.type === 'ref');
  assert.deepEqual(refs.map((r) => [r.colAbs, r.rowAbs]), [[true, true], [false, true], [true, false]]);
});

test('tokenize: strings keep embedded quotes and percent numbers', () => {
  const tokens = P.tokenize('A1&"a""b"&5%');
  assert.equal(tokens.find((t) => t.type === 'string').value, 'a"b');
  const num = tokens.find((t) => t.type === 'number');
  assert.equal(num.value, 5);
  assert.equal(num.percent, true);
});

test('classify: ROUND digits argument is a control argument', () => {
  assert.deepEqual(roles('ROUND(A1,2)'), [[2, 'CONTROL_ARGUMENT']]);
});

test('classify: IFERROR fallback 0 is a control argument', () => {
  assert.deepEqual(roles('IFERROR(A1/B1,0)'), [[0, 'CONTROL_ARGUMENT']]);
});

test('classify: business constant in arithmetic', () => {
  assert.deepEqual(roles('A1*1.13'), [[1.13, 'BUSINESS_CONSTANT']]);
});

test('classify: ROUND(x/1000, digits) is a unit conversion, not a hardcode', () => {
  const div = {};
  P.parse('ROUND(A1/1000,0)').constants.forEach((c) => { div[c.value] = c.role; });
  assert.equal(div[1000], 'UNIT_CONVERSION');
  assert.equal(div[0], 'CONTROL_ARGUMENT');

  const mult = {};
  P.parse('ROUND(A1*1000,2)').constants.forEach((c) => { mult[c.value] = c.role; });
  assert.equal(mult[1000], 'UNIT_CONVERSION');
});

test('classify: a conversion factor outside a rounding call stays a business constant', () => {
  assert.deepEqual(roles('A1/1000'), [[1000, 'BUSINESS_CONSTANT']]);
  assert.deepEqual(roles('ROUND(A1,2)*1.13'), [[2, 'CONTROL_ARGUMENT'], [1.13, 'BUSINESS_CONSTANT']]);
});

test('classify: ROUND(A1*1.13,2) splits business vs control', () => {
  const parsed = P.parse('ROUND(A1*1.13,2)');
  const byValue = {};
  parsed.constants.forEach((c) => { byValue[c.value] = c.role; });
  assert.equal(byValue[1.13], 'BUSINESS_CONSTANT');
  assert.equal(byValue[2], 'CONTROL_ARGUMENT');
});

test('classify: numbers inside strings are string content', () => {
  const parsed = P.parse('A1&"2026"');
  assert.equal(parsed.hasString, true);
  const numeric = parsed.constants.filter((c) => c.role === 'STRING_CONTENT');
  assert.equal(numeric.length, 1);
  assert.equal(numeric[0].value, 2026);
});

test('classify: array constants are flagged', () => {
  const parsed = P.parse('SUM({1,2,3}*A1:A3)');
  assert.equal(parsed.hasArrayConstant, true);
  assert.ok(parsed.constants.every((c) => c.role === 'ARRAY_CONSTANT'));
});

test('classify: date arguments are downgraded', () => {
  assert.deepEqual(roles('DATE(2026,10,14)'), [
    [2026, 'DATE_ARGUMENT'], [10, 'DATE_ARGUMENT'], [14, 'DATE_ARGUMENT']
  ]);
});

test('classify: bare logical constants', () => {
  assert.deepEqual(roles('A1=1'), [[1, 'LOGICAL_CONSTANT']]);
});

test('parse: sheet-qualified and cross-sheet references are captured', () => {
  const parsed = P.parse("'利润表'!B5*2");
  assert.ok(parsed.references.some((r) => r.sheet === '利润表' && r.row === 5));
  assert.equal(parsed.constants[0].value, 2);
});

test('parse: malformed formulas fail gracefully', () => {
  const parsed = P.parse('SUM(A1,B1');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.constants.length, 0);
});

test('parse: bare number and empty formula', () => {
  assert.deepEqual(roles('100'), [[100, 'UNKNOWN_CONSTANT']]);
  assert.equal(P.parse('').ok, false);
});

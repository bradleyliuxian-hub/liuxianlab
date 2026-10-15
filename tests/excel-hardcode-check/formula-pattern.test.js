'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../../private/tools/excel-hardcode-check/formula-parser.js');
const Pattern = require('../../private/tools/excel-hardcode-check/formula-pattern.js');

function pattern(formula, row, col) {
  return Pattern.buildPattern(P.parse(formula), row, col);
}

test('relative pattern: sibling column formulas share a signature', () => {
  // B5-B6 in B10 vs C5-C6 in C10 -> same relative shape.
  const b = pattern('B5-B6', 10, 1);
  const c = pattern('C5-C6', 10, 2);
  assert.equal(b.signature, c.signature);
  assert.ok(Pattern.signatureEquals(b, c));
});

test('relative pattern: vertical siblings share a signature', () => {
  const a = pattern('A1-B1', 5, 0);
  const b = pattern('A2-B2', 6, 0);
  assert.equal(a.signature, b.signature);
});

test('relative pattern: absolute references are position independent', () => {
  const a = pattern('C5*$B$2', 10, 2);
  const b = pattern('D5*$B$2', 10, 3);
  assert.equal(a.signature, b.signature);
  assert.equal(a.sigTokens[2].key, 'R[$1;$2]');
});

test('relative pattern: differing structure differs', () => {
  assert.notEqual(pattern('B5-B6', 10, 1).signature, pattern('B5+B6', 10, 1).signature);
});

test('referenceReplacedByConstant: detects a ref replaced by a number', () => {
  const neighbor = pattern('C5*C8', 10, 2).sigTokens;
  const current = pattern('D5*1.2', 10, 3).sigTokens;
  assert.equal(Pattern.referenceReplacedByConstant(neighbor, current), 2);
});

test('referenceReplacedByConstant: ignores pure constant differences', () => {
  const neighbor = pattern('C5*2', 10, 2).sigTokens;
  const current = pattern('D5*3', 10, 3).sigTokens;
  assert.equal(Pattern.referenceReplacedByConstant(neighbor, current), -1);
});

test('extraConstantAdded: detects an appended fixed value', () => {
  const neighbor = pattern('C5-C6', 10, 2).sigTokens;
  const current = pattern('D5-D6+100', 10, 3).sigTokens;
  const result = Pattern.extraConstantAdded(neighbor, current);
  assert.equal(result.added, true);
  assert.deepEqual(result.values, [100]);
});

test('extraConstantAdded: ignores genuinely different formulas', () => {
  const neighbor = pattern('C5-C6', 10, 2).sigTokens;
  const current = pattern('D5+D6', 10, 3).sigTokens;
  assert.equal(Pattern.extraConstantAdded(neighbor, current).added, false);
});

test('differingConstantPosition: finds the outlier parameter', () => {
  const lists = [
    pattern('B1*1.10', 2, 1).sigTokens,
    pattern('C1*1.10', 2, 2).sigTokens,
    pattern('E1*1.10', 2, 4).sigTokens
  ];
  const current = pattern('D1*1.15', 2, 3).sigTokens;
  assert.equal(Pattern.differingConstantPosition(lists, current), 2);
});

test('differingConstantPosition: no outlier when all equal', () => {
  const lists = [
    pattern('B1*1.10', 2, 1).sigTokens,
    pattern('C1*1.10', 2, 2).sigTokens
  ];
  const current = pattern('D1*1.10', 2, 3).sigTokens;
  assert.equal(Pattern.differingConstantPosition(lists, current), -1);
});

test('referenceReplacedByConstant: named range and cross-sheet refs are operands', () => {
  const named = pattern('C13*TaxRate', 10, 2).sigTokens;
  const current = pattern('D13*0.3', 10, 3).sigTokens;
  assert.equal(Pattern.referenceReplacedByConstant(named, current), 2);

  const cross = pattern("C10*'参数 表'!$B$5", 10, 2).sigTokens;
  const currentCross = pattern('D10*7.5', 10, 3).sigTokens;
  assert.equal(Pattern.referenceReplacedByConstant(cross, currentCross), 2);
});

test('plug: a small additive literal outside the rounding call is flagged', () => {
  const tokens = pattern('ROUND(A1,2)+0.01', 10, 3).sigTokens;
  assert.ok(tokens.some((t) => t.kind === 'N' && t.plug === true));
  assert.ok(!pattern('ROUND(A1,2)', 10, 3).sigTokens.some((t) => t.plug));
  // Inside the rounded body -> part of the value, not a plug.
  assert.ok(!pattern('ROUND(A1+0.01,2)', 10, 3).sigTokens.some((t) => t.plug));
});

test('plug: ROUND(x/1000,0)+1 marks the trailing 1 (not the unit) as a plug', () => {
  const tokens = pattern('ROUND(A1/1000,0)+1', 10, 3).sigTokens;
  const nc = tokens.filter((t) => t.kind === 'NC');
  assert.ok(nc.some((t) => t.value === 1000 && t.role === 'UNIT_CONVERSION'));
  assert.ok(tokens.some((t) => t.kind === 'N' && t.value === 1 && t.plug === true));
});

test('referenceReplacedByConstant: logical constants are not business hardcodes', () => {
  const neighbor = pattern('C9*(1-C7)', 13, 2).sigTokens;
  const current = pattern('D9*(1-B7)', 13, 3).sigTokens;
  // neighbour has a ref where current has a ref too -> no replacement
  assert.equal(Pattern.referenceReplacedByConstant(neighbor, current), -1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const risk = require('../../private/tools/excel-decimal-check/risk-core.js');

test('isPercentageFormat: real percentage formats', () => {
  ['0%', '0.0%', '0.00%', '0.0000%', '#,##0.00%', '0.0%;[Red]-0.0%', '#,##0.00_);(#,##0.00)%'].forEach((fmt) => {
    assert.equal(risk.isPercentageFormat(fmt), true, fmt);
  });
});

test('isPercentageFormat: non-percentage and literal-percent formats', () => {
  ['General', '0.00', '#,##0', 'yyyy-mm-dd', '0.00E+00', '', null, undefined].forEach((fmt) => {
    assert.equal(risk.isPercentageFormat(fmt), false, String(fmt));
  });
  // Escaped / quoted percent signs are literals, not percentage semantics.
  assert.equal(risk.isPercentageFormat('0.00\\%'), false);
  assert.equal(risk.isPercentageFormat('0.00"%"'), false);
});

test('hiddenTypeFor: single and combined hidden states', () => {
  assert.equal(risk.hiddenTypeFor(false, false, false, false), 'none');
  assert.equal(risk.hiddenTypeFor(true, false, false, false), 'row');
  assert.equal(risk.hiddenTypeFor(false, true, false, false), 'column');
  assert.equal(risk.hiddenTypeFor(true, true, false, false), 'row+column');
  assert.equal(risk.hiddenTypeFor(false, false, true, false), 'sheet');
  assert.equal(risk.hiddenTypeFor(false, false, true, true), 'veryHidden');
  // Sheet-level hiding wins over row/column.
  assert.equal(risk.hiddenTypeFor(true, true, true, false), 'sheet');
});

test('computeRisk: visible values are high', () => {
  assert.equal(risk.computeRisk({ category: 'raw', visible: true, isFormula: false, directReferenceCount: 0 }).level, '高');
  assert.equal(risk.computeRisk({ category: 'raw', visible: true, isFormula: false, directReferenceCount: 3 }).level, '高');
  assert.equal(risk.computeRisk({ category: 'formula', visible: true, isFormula: true, directReferenceCount: 0 }).level, '高');
});

test('computeRisk: hidden values depend on references', () => {
  assert.equal(risk.computeRisk({ category: 'hidden', visible: false, isFormula: false, directReferenceCount: 0 }).level, '低');
  assert.equal(risk.computeRisk({ category: 'hidden', visible: false, isFormula: false, directReferenceCount: 2, referrersVisible: false }).level, '中');
  assert.equal(risk.computeRisk({ category: 'hidden', visible: false, isFormula: false, directReferenceCount: 2, referrersVisible: true }).level, '高');
});

test('computeRisk: percentage is its own scale', () => {
  assert.equal(risk.computeRisk({ category: 'percentage', visible: true, directReferenceCount: 0 }).level, '观察');
  assert.equal(risk.computeRisk({ category: 'percentage', visible: true, directReferenceCount: 4 }).level, '中');
  assert.equal(risk.computeRisk({ category: 'percentage', visible: true, directReferenceCount: 4, referrersVisible: true }).level, '高');
});

test('computeRisk: unknown formula result', () => {
  const result = risk.computeRisk({ category: 'unknown', visible: true });
  assert.equal(result.level, '中');
  assert.match(result.reason, /缓存/);
});

test('computeRisk: reasons never promise a concrete fix', () => {
  ['raw', 'formula', 'hidden', 'percentage', 'unknown'].forEach((category) => {
    const r = risk.computeRisk({ category, visible: category !== 'hidden', isFormula: category === 'formula', directReferenceCount: 1, referrersVisible: true });
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0);
    assert.doesNotMatch(r.reason, /改成|改为|修正为/);
  });
});

test('suggestionFor: points at what to check, never a value', () => {
  ['raw', 'formula', 'hidden', 'percentage', 'unknown'].forEach((category) => {
    const text = risk.suggestionFor(category, { visible: true, directReferenceCount: 1 });
    assert.equal(typeof text, 'string');
    assert.doesNotMatch(text, /改成|改为|ROUND/);
  });
});

test('riskRank orders 高 < 中 < 低 < 观察', () => {
  assert.ok(risk.riskRank('高') < risk.riskRank('中'));
  assert.ok(risk.riskRank('中') < risk.riskRank('低'));
  assert.ok(risk.riskRank('低') < risk.riskRank('观察'));
});

test('sortIssues: same risk orders by downstream desc, then direct desc', () => {
  const list = [
    { riskLevel: '高', downstreamReferenceCount: 20, directReferenceCount: 3, sheetName: 'A1', row: 0, col: 0 },
    { riskLevel: '高', downstreamReferenceCount: 3, directReferenceCount: 3, sheetName: 'B1', row: 0, col: 0 },
    { riskLevel: '高', downstreamReferenceCount: 50, directReferenceCount: 1, sheetName: 'C1', row: 0, col: 0 },
    { riskLevel: '高', downstreamReferenceCount: 0, directReferenceCount: 0, sheetName: 'D1', row: 0, col: 0 }
  ];
  const ordered = risk.sortIssues(list, 'risk').map((i) => i.downstreamReferenceCount);
  assert.deepEqual(ordered, [50, 20, 3, 0]);
});

test('sortIssues: risk is the primary key by default', () => {
  const list = [
    { riskLevel: '中', downstreamReferenceCount: 100, sheetName: 's', row: 0, col: 0 },
    { riskLevel: '高', downstreamReferenceCount: 5, sheetName: 's', row: 0, col: 0 }
  ];
  assert.equal(risk.sortIssues(list, 'risk')[0].riskLevel, '高');
});

test('sortIssues: downstream mode ignores risk first', () => {
  const list = [
    { riskLevel: '高', downstreamReferenceCount: 5, sheetName: 's', row: 0, col: 0 },
    { riskLevel: '中', downstreamReferenceCount: 100, sheetName: 's', row: 0, col: 0 }
  ];
  assert.equal(risk.sortIssues(list, 'downstream')[0].downstreamReferenceCount, 100);
});

test('sortIssues: directReferences mode', () => {
  const list = [
    { riskLevel: '高', downstreamReferenceCount: 0, directReferenceCount: 1, sheetName: 's', row: 0, col: 0 },
    { riskLevel: '高', downstreamReferenceCount: 0, directReferenceCount: 9, sheetName: 's', row: 0, col: 0 }
  ];
  assert.equal(risk.sortIssues(list, 'directReferences')[0].directReferenceCount, 9);
});

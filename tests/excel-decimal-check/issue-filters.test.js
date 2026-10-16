'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const filters = require('../../private/tools/excel-decimal-check/issue-filters.js');
const risk = require('../../private/tools/excel-decimal-check/risk-core.js');

function sample() {
  return [
    { riskLevel: '高', category: 'raw', sheetName: 'Sheet1', hiddenType: 'none', businessType: 'normal_number', precisionStatus: '', downstreamReferenceCount: 5, directReferenceCount: 1, row: 0, col: 0 },
    { riskLevel: '中', category: 'formula', sheetName: 'Sheet2', hiddenType: 'none', businessType: 'exchange_rate_derived', precisionStatus: '超出2位', downstreamReferenceCount: 9, directReferenceCount: 2, row: 0, col: 0 },
    { riskLevel: '高', category: 'percentage', sheetName: 'Sheet1', hiddenType: 'none', businessType: 'percentage', precisionStatus: '', downstreamReferenceCount: 0, directReferenceCount: 0, row: 1, col: 0 },
    { riskLevel: '观察', category: 'exchange_rate', sheetName: 'Sheet2', hiddenType: 'none', businessType: 'exchange_rate', precisionStatus: '正常', downstreamReferenceCount: 3, directReferenceCount: 1, row: 1, col: 0 },
    { riskLevel: '低', category: 'hidden', sheetName: '销售明细 10月', hiddenType: 'row', businessType: 'normal_number', precisionStatus: '', downstreamReferenceCount: 0, directReferenceCount: 0, row: 2, col: 0 },
    { riskLevel: '高', category: 'raw', sheetName: "Brad's Data", hiddenType: 'none', businessType: 'normal_number', precisionStatus: '', downstreamReferenceCount: 1, directReferenceCount: 4, row: 3, col: 0 }
  ];
}

test('A: risks = [高, 中] -> OR within the field', () => {
  const f = filters.emptyFilterState();
  f.risks = ['高', '中'];
  const out = filters.applyFilters(sample(), f);
  assert.equal(out.length, 4);
  assert.ok(out.every((i) => i.riskLevel === '高' || i.riskLevel === '中'));
});

test('B: risks AND sheets (OR within each field)', () => {
  const f = filters.emptyFilterState();
  f.risks = ['高', '中'];
  f.sheets = ['Sheet1', 'Sheet2'];
  const out = filters.applyFilters(sample(), f);
  assert.equal(out.length, 3);
  assert.ok(out.every((i) => (i.riskLevel === '高' || i.riskLevel === '中') && (i.sheetName === 'Sheet1' || i.sheetName === 'Sheet2')));
});

test('C: empty state -> show everything', () => {
  assert.equal(filters.applyFilters(sample(), filters.emptyFilterState()).length, sample().length);
  assert.equal(filters.countActive(filters.emptyFilterState()), 0);
});

test('D: businessTypes = [percentage, exchange_rate] -> both appear', () => {
  const f = filters.emptyFilterState();
  f.businessTypes = ['percentage', 'exchange_rate'];
  const out = filters.applyFilters(sample(), f);
  assert.deepEqual(out.map((i) => i.businessType).sort(), ['exchange_rate', 'percentage']);
});

test('E: clearing filters restores all rows', () => {
  const f = filters.emptyFilterState();
  f.risks = ['高'];
  assert.equal(filters.applyFilters(sample(), f).length, 3);
  filters.normalizeList(f.risks).forEach(() => {});
  f.risks = [];
  assert.equal(filters.applyFilters(sample(), f).length, 6);
});

test('F: filtering keeps the downstream-desc ordering step independent', () => {
  const f = filters.emptyFilterState();
  f.risks = ['高', '中'];
  const filtered = filters.applyFilters(sample(), f);
  const sorted = risk.sortIssues(filtered, 'risk');
  // risk first, then downstream desc within the same risk level.
  assert.equal(sorted[0].riskLevel, '高');
  const highs = sorted.filter((i) => i.riskLevel === '高').map((i) => i.downstreamReferenceCount);
  assert.deepEqual(highs, [...highs].sort((a, b) => b - a));
  const mediums = sorted.filter((i) => i.riskLevel === '中').map((i) => i.downstreamReferenceCount);
  assert.deepEqual(mediums, [...mediums].sort((a, b) => b - a));
});

test('G: sheets with CJK + special names filter correctly', () => {
  const f = filters.emptyFilterState();
  f.sheets = ['销售明细 10月', "Brad's Data"];
  const out = filters.applyFilters(sample(), f);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => i.sheetName).sort(), ["Brad's Data", '销售明细 10月'].sort());
});

test('hiddenTypes filter', () => {
  const f = filters.emptyFilterState();
  f.hiddenTypes = ['row'];
  const out = filters.applyFilters(sample(), f);
  assert.equal(out.length, 1);
  assert.equal(out[0].hiddenType, 'row');
});

test('buildOptions: distinct values with counts and logical order', () => {
  const riskOptions = filters.buildOptions(sample(), 'risks', (i) => i.riskLabel, ['高', '中', '低', '观察']);
  assert.deepEqual(riskOptions.map((o) => o.value), ['高', '中', '低', '观察']);
  assert.equal(riskOptions.find((o) => o.value === '高').count, 3);
  const sheetOptions = filters.buildOptions(sample(), 'sheets', (i) => i.sheetName);
  assert.equal(sheetOptions.length, 4);
});

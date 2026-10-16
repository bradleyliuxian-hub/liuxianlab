'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const bt = require('../../private/tools/excel-decimal-check/business-type.js');

test('classify: rate keyword in a nearby title', () => {
  const r = bt.classify({ labels: [{ value: 'USD/CNY 汇率', source: '同行/邻近' }] });
  assert.equal(r.businessType, 'exchange_rate');
  assert.equal(r.confidence, 'high');
});

test('classify: english exchange rate wording', () => {
  assert.equal(bt.classify({ labels: [{ value: 'Exchange Rate', source: '同列' }] }).businessType, 'exchange_rate');
  assert.equal(bt.classify({ labels: [{ value: 'FX Rate (mid)', source: '同列' }] }).businessType, 'exchange_rate');
});

test('classify: currency pair title (no keyword)', () => {
  const r = bt.classify({ labels: [{ value: 'EUR/USD', source: '同列' }] });
  assert.equal(r.businessType, 'exchange_rate');
  assert.match(r.reason, /EUR\/USD/);
});

test('classify: named range implies a rate', () => {
  assert.equal(bt.classify({ names: ['USD_CNY_RATE'] }).businessType, 'exchange_rate');
  assert.equal(bt.classify({ names: ['exchangeRate'] }).businessType, 'exchange_rate');
});

test('classify: referenced source title implies a rate', () => {
  const r = bt.classify({ referencedLabels: [{ value: '港币汇率', source: '引用来源' }] });
  assert.equal(r.businessType, 'exchange_rate');
  assert.equal(r.confidence, 'high');
});

test('classify: weak currency token -> suspected (not exempted)', () => {
  const r = bt.classify({ labels: [{ value: '币种 USD', source: '同行/邻近' }] });
  assert.equal(r.businessType, 'suspected_exchange_rate');
  assert.equal(r.confidence, 'low');
});

test('classify: no evidence -> normal number', () => {
  const r = bt.classify({ labels: [{ value: '数量', source: '同行/邻近' }] });
  assert.equal(r.businessType, 'normal_number');
  assert.equal(r.confidence, 'high');
});

test('allowedDecimalsFor', () => {
  assert.equal(bt.allowedDecimalsFor('normal_number'), 2);
  assert.equal(bt.allowedDecimalsFor('exchange_rate'), 4);
  assert.equal(bt.allowedDecimalsFor('suspected_exchange_rate'), 2);
  assert.equal(bt.allowedDecimalsFor('percentage'), null);
  assert.equal(bt.allowedDecimalsFor('unknown_type'), 2);
});

test('helpers: isRateName / currencyToken / rateTextMatch', () => {
  assert.equal(bt.isRateName('USD_CNY_RATE'), true);
  assert.equal(bt.isRateName('TotalRevenue'), false);
  assert.equal(bt.currencyToken('币种 USD'), 'USD');
  assert.equal(bt.currencyToken('数量'), null);
  assert.deepEqual(bt.rateTextMatch('汇率'), { kind: 'keyword', detail: '汇率' });
  assert.equal(bt.rateTextMatch('USD/CNY').kind, 'pair');
  assert.equal(bt.rateTextMatch('数量'), null);
});

test('detection never relies on value or decimal count', () => {
  // classify() takes no value/decimal input at all.
  const r = bt.classify({ labels: [], names: [], referencedLabels: [] });
  assert.equal(r.businessType, 'normal_number');
});

test('pureReference: single cell references (bare / $ / sheet-qualified)', () => {
  assert.deepEqual(bt.pureReference('=B2'), { kind: 'cell', sheet: null, address: 'B2' });
  assert.deepEqual(bt.pureReference('$B$2'), { kind: 'cell', sheet: null, address: 'B2' });
  assert.deepEqual(bt.pureReference("='FX Rates'!$B$2"), { kind: 'cell', sheet: 'FX Rates', address: 'B2' });
  assert.deepEqual(bt.pureReference("'Brad''s Data'!B2"), { kind: 'cell', sheet: "Brad's Data", address: 'B2' });
  assert.deepEqual(bt.pureReference('汇率表!B2'), { kind: 'cell', sheet: '汇率表', address: 'B2' });
});

test('pureReference: named range', () => {
  assert.deepEqual(bt.pureReference('=USD_CNY_RATE'), { kind: 'name', name: 'USD_CNY_RATE' });
});

test('pureReference: anything computed is NOT pure', () => {
  ['=B2+0', '=B2*1', '=ROUND(B2,4)', '=ABS(B2)', '=SUM(B2)', '=SUM(B2,D2)', '=IF(TRUE,B2,B2)', '=(B2)', '=1/B2', ''].forEach((f) => {
    assert.equal(bt.pureReference(f), null, f);
    assert.equal(bt.isPureReferenceFormula(f), false, f);
  });
});

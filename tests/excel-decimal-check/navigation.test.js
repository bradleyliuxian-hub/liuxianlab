'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const viewerCore = require('../../private/shared/excel-viewer/viewer-core.js');
const filters = require('../../private/tools/excel-decimal-check/issue-filters.js');
const risk = require('../../private/tools/excel-decimal-check/risk-core.js');

function issue(address, extra) {
  return Object.assign({
    sheetName: 'S',
    cellAddress: address,
    riskLevel: '高',
    category: 'raw',
    hiddenType: 'none',
    businessType: 'normal_number',
    precisionStatus: '',
    downstreamReferenceCount: 0,
    directReferenceCount: 0,
    row: 0,
    col: 0
  }, extra || {});
}

function makeModel(issues) {
  const workbook = { SheetNames: ['S'], Sheets: { S: {} } };
  return viewerCore.createViewerModel(workbook, issues, { cycle: false });
}

const addresses = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'];
const all = addresses.map((a) => issue(a));

test('A: next/prev move only within the filtered list (no jump to filtered-out)', () => {
  const model = makeModel(all);
  const subset = [all[1], all[3], all[6]]; // B1, D1, G1
  model.setFilterList(subset);
  model.reconcile();
  assert.equal(model.state().selectedIssue.cellAddress, 'B1');
  model.next();
  assert.equal(model.state().selectedIssue.cellAddress, 'D1');
  model.next();
  assert.equal(model.state().selectedIssue.cellAddress, 'G1');
  model.next(); // clamp at end (no cycle)
  assert.equal(model.state().selectedIssue.cellAddress, 'G1');
});

test('B: current issue still present after re-filter -> keep it, recompute index', () => {
  const model = makeModel(all);
  model.setFilterList([all[1], all[3], all[6]]);
  model.selectIssue(all[3]); // D1
  assert.equal(model.state().listIndex, 1);
  model.setFilterList([all[3], all[6]]); // D1, G1
  model.reconcile();
  assert.equal(model.state().selectedIssue.cellAddress, 'D1');
  assert.equal(model.state().listIndex, 0);
});

test('C: current issue filtered out -> select the first', () => {
  const model = makeModel(all);
  model.selectIssue(all[3]); // D1
  model.setFilterList([all[1], all[6]]); // B1, G1 (no D1)
  model.reconcile();
  assert.equal(model.state().selectedIssue.cellAddress, 'B1');
  assert.equal(model.state().listIndex, 0);
});

test('D: empty filter list -> 0/0, nothing selected, next/prev are no-ops', () => {
  const model = makeModel(all);
  model.selectIssue(all[0]);
  model.setFilterList([]);
  model.reconcile();
  assert.equal(model.filteredIssues().length, 0);
  assert.equal(model.state().listIndex, -1);
  assert.equal(model.state().selectedIssue, null);
  assert.equal(model.next(), null);
  assert.equal(model.prev(), null);
});

test('E: single-item list -> both directions stay on it', () => {
  const model = makeModel(all);
  model.setFilterList([all[4]]); // E1
  model.reconcile();
  assert.equal(model.state().selectedIssue.cellAddress, 'E1');
  model.next();
  assert.equal(model.state().selectedIssue.cellAddress, 'E1');
  model.prev();
  assert.equal(model.state().selectedIssue.cellAddress, 'E1');
});

test('F: navigation follows filter + sort order (risk, downstream desc)', () => {
  const list = [
    issue('A1', { riskLevel: '高', downstreamReferenceCount: 50 }),
    issue('B1', { riskLevel: '中', downstreamReferenceCount: 80 }),
    issue('C1', { riskLevel: '高', downstreamReferenceCount: 20 }),
    issue('D1', { riskLevel: '中', downstreamReferenceCount: 10 }),
    issue('E1', { riskLevel: '低', downstreamReferenceCount: 999 })
  ];
  const f = filters.emptyFilterState();
  f.risks = ['高', '中'];
  const sorted = risk.sortIssues(filters.applyFilters(list, f), 'risk');
  assert.deepEqual(sorted.map((i) => i.cellAddress), ['A1', 'C1', 'B1', 'D1']);

  const model = makeModel(list);
  model.setFilterList(sorted);
  model.reconcile();
  const order = [model.state().selectedIssue.cellAddress];
  model.next(); order.push(model.state().selectedIssue.cellAddress);
  model.next(); order.push(model.state().selectedIssue.cellAddress);
  model.next(); order.push(model.state().selectedIssue.cellAddress);
  assert.deepEqual(order, ['A1', 'C1', 'B1', 'D1']);
});

test('G: sort change keeps the current issue, only updates its index', () => {
  const list = [
    issue('A1', { riskLevel: '高', downstreamReferenceCount: 5 }),
    issue('B1', { riskLevel: '高', downstreamReferenceCount: 9 }),
    issue('C1', { riskLevel: '高', downstreamReferenceCount: 1 })
  ];
  const model = makeModel(list);
  model.setFilterList(risk.sortIssues(list, 'risk'));
  model.selectIssue(list[2]); // C1 (last by risk order)
  assert.equal(model.state().selectedIssue.cellAddress, 'C1');
  // switch to downstream-desc; C1 still present but now index 2 as well? order B1,A1,C1 -> C1 index 2
  model.setFilterList(risk.sortIssues(list, 'downstream'));
  model.reconcile();
  assert.equal(model.state().selectedIssue.cellAddress, 'C1');
  assert.equal(model.filteredIssues()[model.state().listIndex].cellAddress, 'C1');
});

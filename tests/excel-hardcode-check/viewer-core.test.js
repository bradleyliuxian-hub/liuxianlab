'use strict';

/*
 * Excel hardcode check - in-page viewer core (pure logic) tests.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'private', 'shared', 'excel-viewer', 'viewer-core.js'));

function makeWorkbook() {
  return {
    SheetNames: ['20260331 Per MGT-原币', 'Sheet 2', 'GAAP 调整-Group'],
    Sheets: {
      '20260331 Per MGT-原币': {
        '!ref': 'A1:AZ90',
        A1: { t: 'n', v: 10 },
        L85: { t: 'n', v: -0.02, f: 'ROUND(SUM(C85:H85,K85),2)-0.02' }
      },
      'Sheet 2': { '!ref': 'A1:D4', B2: { t: 's', v: 'hi' } },
      'GAAP 调整-Group': { '!ref': 'A1:M40', K12: { t: 'n', v: 5, f: 'J10+J11' } }
    }
  };
}

function makeIssues() {
  return [
    { severity: 'HIGH', ruleId: 'HC006', sheetName: '20260331 Per MGT-原币', cellAddress: 'L85', constantDetails: [{ value: -0.02, role: 'ROUNDING_PLUG', anomalous: true }] },
    { severity: 'HIGH', ruleId: 'HC003', sheetName: 'GAAP 调整-Group', cellAddress: 'K12' },
    { severity: 'SUSPICIOUS', ruleId: 'HC101', sheetName: 'Sheet 2', cellAddress: 'B2' },
    { severity: 'HARDCODE_NOTICE', ruleId: 'HC201', sheetName: '利润表不存在', cellAddress: 'A1' }
  ];
}

test('address math: parse / encode / column labels incl. AA/AZ/BA', () => {
  assert.deepEqual(C.parseAddress('L85'), { row: 84, col: 11 });
  assert.equal(C.encodeAddress(84, 11), 'L85');
  assert.equal(C.columnLabel(26), 'AA');
  assert.equal(C.columnLabel(51), 'AZ');
  assert.equal(C.columnLabel(52), 'BA');
  assert.equal(C.parseAddress('AZ10').col, 51);
  assert.equal(C.parseAddress('BA1').col, 52);
  assert.deepEqual(C.parseAddress('$AA$64'), { row: 63, col: 26 });
  assert.equal(C.parseAddress('not-a-cell'), null);
});

test('decodeRange: bounded, single and whole-column refs', () => {
  assert.deepEqual(C.decodeRange('A1:AZ90'), { s: { r: 0, c: 0 }, e: { r: 89, c: 51 } });
  assert.deepEqual(C.decodeRange('B2'), { s: { r: 1, c: 1 }, e: { r: 1, c: 1 } });
  const col = C.decodeRange('A:C');
  assert.equal(col.s.c, 0);
  assert.equal(col.e.c, 2);
  assert.equal(col.s.r, col.e.r);
});

test('issue index: bySheet map and per-sheet counts (dedupe same cell)', () => {
  const issues = makeIssues();
  issues.push({ severity: 'HARDCODE_NOTICE', ruleId: 'HC201', sheetName: 'GAAP 调整-Group', cellAddress: 'K12' }); // same cell
  const index = C.buildIssueIndex(issues);
  assert.equal(index.countBySheet['GAAP 调整-Group'], 1, 'same cell counts once');
  assert.equal(index.countBySheet['20260331 Per MGT-原币'], 1);
  assert.equal(index.bySheet['GAAP 调整-Group'].K12.ruleId, 'HC003', 'first issue kept');
});

test('focus range: clamps to sheet bounds and never goes negative', () => {
  const meta = C.resolveSheetMeta({ '!ref': 'A1:AZ90' });
  const mid = C.computeFocusRange(84, 11, meta, { padRows: 8, padCols: 5 });
  assert.deepEqual(mid, { rowStart: 76, rowEnd: 89, colStart: 6, colEnd: 16 });
  const topLeft = C.computeFocusRange(0, 0, meta, { padRows: 8, padCols: 5 });
  assert.equal(topLeft.rowStart, 0);
  assert.equal(topLeft.colStart, 0);
  assert.ok(topLeft.rowEnd >= 0 && topLeft.colEnd >= 0);
});

test('focus range: explicit extended bounds allow blanks past the used range', () => {
  const meta = C.resolveSheetMeta({ '!ref': 'A1:M338' });           // used range
  const usedOnly = C.computeFocusRange(331, 10, meta, { padRows: 8, padCols: 5 });
  assert.equal(usedOnly.rowEnd, 337, 'clamped to used range by default');
  const extended = { minRow: 0, maxRow: 438, minCol: 0, maxCol: 32 };
  const withExtra = C.computeFocusRange(331, 10, meta, { padRows: 8, padCols: 5, bounds: extended });
  assert.deepEqual(withExtra, { rowStart: 323, rowEnd: 339, colStart: 5, colEnd: 15 });
  assert.ok(withExtra.rowEnd > usedOnly.rowEnd, 'extra rows below the selection are available');
});

test('sheet meta: bounds, hidden rows/cols and sizes', () => {
  const meta = C.resolveSheetMeta({
    '!ref': 'A1:C3',
    '!cols': [{ wch: 20 }, { hidden: true }],
    '!rows': [{ hpt: 30 }, null, { hidden: true }],
    '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  });
  assert.deepEqual(meta.bounds, { minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
  assert.equal(C.colWidthPx(meta, 0), 145);
  assert.equal(C.colWidthPx(meta, 1), 0, 'hidden col collapses');
  assert.equal(C.rowHeightPx(meta, 0), 40);
  assert.equal(C.rowHeightPx(meta, 2), 0, 'hidden row collapses');
});

test('merge map: covered cells point to the anchor', () => {
  const meta = C.resolveSheetMeta({ '!ref': 'A1:C1', '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] });
  const merge = C.buildMergeMap(meta);
  assert.equal(merge.anchorOf.get('0:1'), '0:0');
  assert.deepEqual(merge.spanOf.get('0:0'), { r0: 0, r1: 0, c0: 0, c1: 2 });
});

test('computeWindow: windowed rows/cols around a scroll position', () => {
  const rowAt = () => 20;
  const colAt = () => 90;
  const win = C.computeWindow(1000, 100, rowAt, colAt, { scrollTop: 400, scrollLeft: 900, height: 200, width: 450 }, { overscanRows: 2, overscanCols: 1 });
  assert.ok(win.rows.length <= 16);
  assert.ok(win.rows[0] <= 18 && win.rows[0] >= 0);
  assert.ok(win.cols.length <= 8);
  assert.equal(win.totalHeight, 20000);
  assert.equal(win.totalWidth, 9000);
});

test('cellValue: reads cached value, formula text and missing cells', () => {
  const ws = makeWorkbook().Sheets['20260331 Per MGT-原币'];
  assert.equal(C.cellValue(ws, 84, 11).formula, 'ROUND(SUM(C85:H85,K85),2)-0.02');
  assert.equal(C.cellValue(ws, 0, 0).raw, 10);
  assert.equal(C.cellValue(ws, 5, 5).empty, true);
});

test('model: selectIssue switches sheet, sets cell and keeps round-trip address', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  const seen = [];
  model.subscribe((s) => seen.push(s.sheetName));
  model.selectIssue(makeIssues()[0]);
  const s = model.state();
  assert.equal(s.sheetName, '20260331 Per MGT-原币');
  assert.deepEqual(s.selected, { row: 84, col: 11 });
  assert.equal(s.selectedIssue.ruleId, 'HC006');
  assert.ok(seen.includes('20260331 Per MGT-原币'));
});

test('model: Chinese and spaced sheet names resolve', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  model.selectIssue({ severity: 'HIGH', sheetName: 'GAAP 调整-Group', cellAddress: 'K12', ruleId: 'HC003' });
  assert.equal(model.state().sheetName, 'GAAP 调整-Group');
  assert.deepEqual(model.state().selected, { row: 11, col: 10 });
});

test('model: next / prev cycle through all issues', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  // filter out the issue whose sheet does not exist by using real sheets only
  const list = model.filteredIssues();
  assert.equal(list.length, 4);
  model.next();
  assert.equal(model.state().selectedIssue.cellAddress, 'L85');
  model.next();
  assert.equal(model.state().selectedIssue.sheetName, 'GAAP 调整-Group');
  model.next();
  assert.equal(model.state().selectedIssue.sheetName, 'Sheet 2');
  model.prev();
  assert.equal(model.state().selectedIssue.sheetName, 'GAAP 调整-Group');
  // prev -> L85 (index 0), then prev wraps to the last issue
  model.prev();
  assert.equal(model.state().selectedIssue.cellAddress, 'L85');
  model.prev();
  assert.equal(model.state().selectedIssue.cellAddress, 'A1', 'wraps to the last issue');
});

test('model: filtered next/prev follows the active filter, not all issues', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  model.setFilterKind('ROUNDING_PLUG');
  assert.equal(model.filteredIssues().length, 1);
  model.next();
  assert.equal(model.state().selectedIssue.ruleId, 'HC006');
  model.next();
  assert.equal(model.state().selectedIssue.ruleId, 'HC006', 'wraps within filtered set');

  model.setFilterKind('HIGH');
  assert.equal(model.filteredIssues().length, 2);
  model.setFilterSheet('GAAP 调整-Group');
  assert.equal(model.filteredIssues().length, 1);
});

test('model: clicking a normal cell clears the issue detail but shows the value; clicking an issue keeps detail', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  model.selectCell('20260331 Per MGT-原币', 0, 0); // A1, no issue
  assert.equal(model.state().selectedIssue, null);
  assert.deepEqual(C.cellValue(model.sheet('20260331 Per MGT-原币'), 0, 0).raw, 10);
  model.selectCell('20260331 Per MGT-原币', 84, 11); // L85, issue
  assert.equal(model.state().selectedIssue.ruleId, 'HC006');
});

test('model: overlay toggle flips without touching workbook data', () => {
  const workbook = makeWorkbook();
  const before = JSON.stringify(workbook);
  const model = C.createViewerModel(workbook, makeIssues());
  model.setOverlay(false);
  assert.equal(model.state().overlay, false);
  model.setOverlay(true);
  assert.equal(model.state().overlay, true);
  assert.equal(JSON.stringify(workbook), before, 'workbook must not change');
});

test('focus token: only explicit navigation requests a viewport reveal', () => {
  const model = C.createViewerModel(makeWorkbook(), makeIssues());
  assert.equal(model.state().focusToken, 0);

  // manual selection (grid click / keyboard in focus already handled as navigate) -> no bump
  model.selectCell('Sheet 2', 1, 1);
  assert.equal(model.state().focusToken, 0, 'manual cell pick does not move the camera');

  // non-navigation state updates -> no bump
  model.setOverlay(false);
  model.setFilterKind('HIGH');
  model.setFilterSheet('Sheet 2');
  model.setSheet('GAAP 调整-Group');
  assert.equal(model.state().focusToken, 0);

  // clear filters so the navigation list is the full set again
  model.setFilterKind('');
  model.setFilterSheet('');

  // explicit navigation -> bump (one-shot reveal)
  model.selectIssue(makeIssues()[0]);
  assert.equal(model.state().focusToken, 1);
  model.next();
  assert.equal(model.state().focusToken, 2);
  model.prev();
  assert.equal(model.state().focusToken, 3);
  model.navigateTo('Sheet 2', 1, 1);
  assert.equal(model.state().focusToken, 4);
  model.reveal();
  assert.equal(model.state().focusToken, 5);

  // re-navigating to the SAME cell still bumps (so 定位 always re-centers)
  model.navigateTo('Sheet 2', 1, 1);
  assert.equal(model.state().focusToken, 6);
});

test('filterIssues: ROUNDING_PLUG matches HC006 or plug constants', () => {
  const issues = [
    { severity: 'HIGH', ruleId: 'HC006', sheetName: 'S', cellAddress: 'A1' },
    { severity: 'HARDCODE_NOTICE', ruleId: 'HC201', sheetName: 'S', cellAddress: 'A2', constantDetails: [{ role: 'ROUNDING_PLUG', anomalous: true }] },
    { severity: 'HIGH', ruleId: 'HC001', sheetName: 'S', cellAddress: 'A3' }
  ];
  assert.equal(C.filterIssues(issues, { kind: 'ROUNDING_PLUG' }).length, 2);
  assert.equal(C.filterIssues(issues, { kind: 'HIGH' }).length, 2);
});

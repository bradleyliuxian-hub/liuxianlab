'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const DecimalWorkbook = require('../../private/tools/excel-decimal-check/decimal-workbook.js');

function colLabel(index) {
  let n = index;
  let label = '';
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

// ~20k multi-decimal numeric cells + 1000+ formula cells across several
// sheets, with hidden rows/columns/sheets, percentages and cross-sheet refs.
function bigWorkbook() {
  const ROWS = 1000;
  const COLS = 20;
  const big = {};
  let index = 1;
  for (let r = 1; r <= ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      big[colLabel(c) + r] = { t: 'n', v: (index / 7) };
      index += 1;
    }
    big['U' + r] = { t: 'n', v: 0, f: 'A' + r + '*2' };
  }
  big['!rows'] = [];
  for (let r = 1; r <= ROWS; r += 100) big['!rows'][r - 1] = { hidden: true };
  big['!cols'] = [];
  big['!cols'][5] = { hidden: true };

  const ref = {};
  for (let r = 1; r <= 500; r += 1) {
    ref['A' + r] = { t: 'n', v: 0, f: "Big!A" + r + "*2" };
  }

  const pct = {};
  for (let r = 1; r <= 500; r += 1) {
    pct['A' + r] = { t: 'n', v: r / 1000, z: '0.00%' };
  }

  const hiddenSheet = {};
  for (let r = 1; r <= 200; r += 1) hiddenSheet['A' + r] = { t: 'n', v: r / 3 };

  const special = {};
  for (let r = 1; r <= 200; r += 1) special['A' + r] = { t: 'n', v: r / 9 };

  return {
    SheetNames: ['Big', 'Ref', 'Pct', 'Hidden', '销售 明细'],
    Sheets: { Big: big, Ref: ref, Pct: pct, Hidden: hiddenSheet, '销售 明细': special },
    Workbook: {
      Sheets: [
        { name: 'Big' }, { name: 'Ref' }, { name: 'Pct' },
        { name: 'Hidden', Hidden: 2 }, { name: '销售 明细' }
      ]
    }
  };
}

test('stress: large workbook scans in linear-ish time (not O(n^2))', () => {
  const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
  const wb = bigWorkbook();

  const started = process.hrtime.bigint();
  const result = DecimalWorkbook.scanWorkbook(XLSX, wb, { includeHidden: true, analyzeReferences: true });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(result.summary.scannedCells >= 20000, 'should scan 20k+ cells');
  assert.ok(result.summary.issueCount > 5000, 'should find many issues');
  assert.ok(result.referenceStats.formulaCells >= 1000, 'should track the formula cells');
  assert.equal(result.referenceStats.unexpandedRanges, 0);
  // Generous ceiling: a quadratic scan over 20k cells x 1k formulas would blow
  // well past this; a linear map-based scan finishes far below it.
  assert.ok(elapsedMs < 8000, `scan took ${elapsedMs.toFixed(0)}ms`);
});

test('stress: reference lookup is bounded (huge range stays a large range)', () => {
  const refMap = require('../../private/tools/excel-decimal-check/reference-map.js');
  const sheet = { A1: { t: 'n', v: 1.234 }, B1: { t: 'n', v: 0, f: 'SUM(A1:A1048576)' } };
  const map = refMap.buildReferenceMap({ SheetNames: ['S'], Sheets: { S: sheet } }, { rangeExpandLimit: 4096 });
  assert.equal(map.stats().unexpandedRanges, 1);
  assert.equal(map.lookup('S', 'A1').hasReference, true);
  assert.equal(map.lookup('S', 'A2').hasReference, true);
});

test('stress: dependency graph (10k numeric + 3k formulas, cross-sheet, fan-out, cycle)', () => {
  const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
  const data = {};
  let index = 1;
  for (let r = 1; r <= 1000; r += 1) {
    for (let c = 0; c < 10; c += 1) {
      data[colLabel(c) + r] = { t: 'n', v: index / 7 };
      index += 1;
    }
  }

  const calc = {};
  for (let r = 1; r <= 1000; r += 1) calc['B' + r] = { t: 'n', v: 0, f: 'Data!A' + r + '*2' };
  for (let r = 1; r <= 1000; r += 1) calc['C' + r] = { t: 'n', v: 0, f: 'B' + r + '+1' };
  for (let r = 1; r <= 1000; r += 1) calc['D' + r] = { t: 'n', v: 0, f: 'C' + r + '*2' };
  for (let r = 1; r <= 500; r += 1) calc['E' + r] = { t: 'n', v: 0, f: 'Data!J1*' + r };
  calc.F1 = { t: 'n', v: 0, f: 'SUM(B1:B1000)' };
  calc.G1 = { t: 'n', v: 0, f: 'H1+1' }; // cycle
  calc.H1 = { t: 'n', v: 0, f: 'G1+1' };

  const wb = { SheetNames: ['Data', 'Calc'], Sheets: { Data: data, Calc: calc } };

  const started = process.hrtime.bigint();
  const result = DecimalWorkbook.scanWorkbook(XLSX, wb, { analyzeReferences: true });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const stats = result.referenceStats;
  // eslint-disable-next-line no-console
  console.log(`[stress] dependency scan ${elapsedMs.toFixed(0)}ms | issues=${result.summary.issueCount} | formulaCells=${stats.formulaCells} | graphEdges=${stats.graphEdges}`);

  assert.ok(result.summary.scannedCells >= 13000);
  assert.ok(stats.formulaCells >= 3500);
  assert.ok(elapsedMs < 15000, `dependency scan took ${elapsedMs.toFixed(0)}ms`);

  // Data!J1 fans out to 500 downstream formula nodes; de-duplicated uniqueness holds.
  const j1 = result.issues.find((i) => i.sheetName === 'Data' && i.cell === 'J1');
  assert.ok(j1, 'Data!J1 is an issue');
  assert.equal(j1.downstreamReferenceCount, 500);
  assert.equal(j1.directReferenceCount, 500);
});


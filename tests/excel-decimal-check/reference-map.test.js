'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const refMap = require('../../private/tools/excel-decimal-check/reference-map.js');

function refs(formula, sheet) {
  return refMap.extractReferences(formula, sheet || 'Sheet1');
}

test('extractReferences: plain and absolute cell references', () => {
  assert.deepEqual(refs('A1*2'), [{ sheet: null, kind: 'cell', address: 'A1', start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }]);
  assert.equal(refs('$A$1+$B2+C$3')[0].address, 'A1');
  assert.equal(refs('$A$1+$B2+C$3').length, 3);
});

test('extractReferences: cross-sheet (quoted, spaces, escaped quotes)', () => {
  assert.equal(refs("'Raw Data'!A1*2")[0].sheet, 'Raw Data');
  assert.equal(refs("'Raw Data'!A1*2")[0].address, 'A1');
  assert.equal(refs("'Brad''s Data'!A1")[0].sheet, "Brad's Data");
  assert.equal(refs('Data_2024!B2+1')[0].sheet, 'Data_2024');
  assert.equal(refs('Data_2024!B2+1')[0].address, 'B2');
});

test('extractReferences: ranges', () => {
  const result = refs('SUM(A1:A3)');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'range');
  assert.deepEqual(result[0].start, { row: 0, col: 0 });
  assert.deepEqual(result[0].end, { row: 2, col: 0 });

  const cross = refs("SUM('销售明细 10月'!B2:D2)")[0];
  assert.equal(cross.sheet, '销售明细 10月');
  assert.equal(cross.kind, 'range');
});

test('extractReferences: function names, booleans and strings are not refs', () => {
  assert.equal(refs('LOG10(A1)').length, 1);
  assert.equal(refs('LOG10(A1)')[0].address, 'A1');
  assert.equal(refs('IF(A1>0,1,2)').length, 1);
  assert.equal(refs('TRUE').length, 0);
  assert.equal(refs('"A1"&B1').length, 1);
  assert.equal(refs('"A1"&B1')[0].address, 'B1');
  assert.equal(refs('NamedRange+1').length, 0);
});

test('extractReferences: defined names are skipped', () => {
  const names = new Set(['ABC123']);
  assert.equal(refMap.extractReferences('ABC123+1', 'Sheet1', names).length, 0);
});

test('buildReferenceMap: direct reference count', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 10.123 },
        B1: { t: 'n', v: 20, f: 'A1*2' },
        C1: { t: 'n', v: 30, f: 'A1+10' }
      }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  const a1 = map.lookup('S1', 'A1');
  assert.equal(a1.hasReference, true);
  assert.equal(a1.directCount, 2);
  assert.equal(a1.crossSheet, false);
  assert.equal(map.lookup('S1', 'B1').directCount, 0);
  assert.equal(map.lookup('S1', 'Z9').directCount, 0);
});

test('buildReferenceMap: cross-sheet references', () => {
  const wb = {
    SheetNames: ['S1', 'S2'],
    Sheets: {
      S1: { A1: { t: 'n', v: 1.234 } },
      S2: { D1: { t: 'n', v: 9, f: 'S1!A1*2' }, E1: { t: 'n', v: 9, f: "'S1'!A1+1" } }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  const a1 = map.lookup('S1', 'A1');
  assert.equal(a1.directCount, 2);
  assert.equal(a1.crossSheet, true);
  assert.equal(a1.crossSheetCount, 2);
});

test('buildReferenceMap: range membership (expanded and large)', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 1.234 },
        A2: { t: 'n', v: 2.345 },
        Z1: { t: 'n', v: 3.456 },
        B1: { t: 'n', v: 0, f: 'SUM(A1:A3)' },
        C1: { t: 'n', v: 0, f: 'SUM(M1:M20)' }
      }
    }
  };
  const map = refMap.buildReferenceMap(wb, { rangeExpandLimit: 4 });
  // A1:A3 area 3 <= 4 -> expanded.
  assert.equal(map.lookup('S1', 'A2').hasReference, true);
  assert.equal(map.lookup('S1', 'A2').directCount, 1);
  // M1:M20 area 20 > 4 -> kept as a large range; membership still works.
  assert.equal(map.lookup('S1', 'M5').hasReference, true);
  assert.equal(map.lookup('S1', 'M21').hasReference, false);
  assert.equal(map.lookup('S1', 'Z1').hasReference, false);
});

test('buildReferenceMap: bounded expansion (no O(n^2) blow-up)', () => {
  const sheet = {};
  for (let r = 1; r <= 200; r += 1) {
    sheet['A' + r] = { t: 'n', v: r + 0.123 };
    sheet['B' + r] = { t: 'n', v: 0, f: 'A' + r + '*2' };
  }
  const map = refMap.buildReferenceMap({ SheetNames: ['S1'], Sheets: { S1: sheet } });
  assert.equal(map.stats().formulaCells, 200);
  assert.equal(map.lookup('S1', 'A5').directCount, 1);
});

test('downstream: linear chain', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 1.234 },
        B1: { t: 'n', v: 0, f: 'A1*2' },
        C1: { t: 'n', v: 0, f: 'B1+1' }
      }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  assert.equal(map.downstream(refMap.makeKey('S1', 'A1')).count, 2);
  assert.equal(map.downstream(refMap.makeKey('S1', 'B1')).count, 1);
  assert.equal(map.downstream(refMap.makeKey('S1', 'C1')).count, 0);
});

test('downstream: diamond de-duplicates (3 not 4)', () => {
  // A1 -> B1 -> D1 and A1 -> C1 -> D1
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 1.234 },
        B1: { t: 'n', v: 0, f: 'A1*2' },
        C1: { t: 'n', v: 0, f: 'A1+1' },
        D1: { t: 'n', v: 0, f: 'B1+C1' }
      }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  const result = map.downstream(refMap.makeKey('S1', 'A1'));
  assert.equal(result.count, 3); // B1, C1, D1
  assert.equal(result.hasCycle, false);
});

test('downstream: cycle is detected and never loops forever', () => {
  // A1 -> B1 -> C1 -> A1
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 1.234, f: 'C1+1' },
        B1: { t: 'n', v: 0, f: 'A1*2' },
        C1: { t: 'n', v: 0, f: 'B1+1' }
      }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  const result = map.downstream(refMap.makeKey('S1', 'A1'));
  assert.equal(result.hasCycle, true);
  assert.equal(result.count, 2); // B1, C1 (each once)
});

test('downstream: cross-sheet and special sheet names', () => {
  const wb = {
    SheetNames: ['Raw Data', 'Calc'],
    Sheets: {
      'Raw Data': { A1: { t: 'n', v: 1.234 } },
      Calc: { B1: { t: 'n', v: 0, f: "'Raw Data'!A1*2" }, C1: { t: 'n', v: 0, f: 'B1+1' } }
    }
  };
  const map = refMap.buildReferenceMap(wb);
  assert.equal(map.downstream(refMap.makeKey('Raw Data', 'A1')).count, 2); // Calc!B1, Calc!C1
});

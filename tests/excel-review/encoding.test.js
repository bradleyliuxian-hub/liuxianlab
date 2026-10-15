'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { repairMojibake } = require(path.join(ROOT, 'server', 'excel-review', 'encoding.js'));

const REAL = '【NEW】 财务复核测试.xlsx';

test('repairMojibake: reverses latin1-decoded UTF-8 filenames', () => {
  const mojibake = Buffer.from(REAL, 'utf8').toString('latin1');
  assert.notEqual(mojibake, REAL);
  assert.equal(repairMojibake(mojibake), REAL);
});

test('repairMojibake: reverses Windows-1252-decoded UTF-8 filenames (the reported â€‹-style case)', () => {
  const bytes = Buffer.from(REAL, 'utf8');
  const mojibake = new TextDecoder('windows-1252').decode(bytes); // single-byte legacy decode
  assert.notEqual(mojibake, REAL);
  assert.equal(repairMojibake(mojibake), REAL);

  // The exact glyph family the user saw (E2 80 8B -> "â€‹") around a name.
  const zwspName = '\u200bNEW\u200b 23-26331.xlsx';
  const zwMojibake = new TextDecoder('windows-1252').decode(Buffer.from(zwspName, 'utf8'));
  assert.ok(zwMojibake.includes('â€‹'), 'produced the reported "â€‹" mojibake');
  assert.equal(repairMojibake(zwMojibake), zwspName);
});

test('repairMojibake: leaves correct text untouched', () => {
  assert.equal(repairMojibake(REAL), REAL);
  assert.equal(repairMojibake('Résumé.xlsx'), 'Résumé.xlsx');
  assert.equal(repairMojibake('2024 report [Final].xlsx'), '2024 report [Final].xlsx');
  assert.equal(repairMojibake("Manager's Review.xlsx"), "Manager's Review.xlsx");
  assert.equal(repairMojibake('日本語テスト.xlsx'), '日本語テスト.xlsx');
  assert.equal(repairMojibake(''), '');
  assert.equal(repairMojibake(null), null);
});

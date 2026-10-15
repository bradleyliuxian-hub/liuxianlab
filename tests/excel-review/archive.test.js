'use strict';

/*
 * Excel Review V1.4.1 - archive (.zip) upload helpers.
 *
 * Verifies the server-side zip expansion is safe and noise-free: only real
 * .xlsx members are accepted, zip-slip / hidden / metadata entries are
 * dropped, and the per-archive file cap is enforced.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));
const review = require(path.join(ROOT, 'server', 'excel-review', 'routes.js'));

function fakeXlsx() {
  const entries = { 'xl/workbook.xml': fflate.strToU8('<x/>') };
  return fflate.zipSync(entries);
}

test('looksLikeZipBuffer: detects the PK signature', () => {
  const zip = fflate.zipSync({ 'a.txt': fflate.strToU8('a') });
  assert.equal(review.looksLikeZipBuffer(Buffer.from(zip)), true);
  assert.equal(review.looksLikeZipBuffer(Buffer.from('nope')), false);
  assert.equal(review.looksLikeZipBuffer(Buffer.alloc(0)), false);
});

test('isXlsxEntryName: accepts real xlsx, rejects noise and unsafe names', () => {
  assert.equal(review.isXlsxEntryName('Book1.xlsx'), true);
  assert.equal(review.isXlsxEntryName('folder/子目录/Book2.XLSX'), true);
  assert.equal(review.isXlsxEntryName('notes.txt'), false);
  assert.equal(review.isXlsxEntryName('folder/'), false);
  assert.equal(review.isXlsxEntryName('.DS_Store'), false);
  assert.equal(review.isXlsxEntryName('__MACOSX/Book.xlsx'), false);
  assert.equal(review.isXlsxEntryName('../evil.xlsx'), false);
  assert.equal(review.isXlsxEntryName('/abs/evil.xlsx'), false);
});

test('extractXlsxEntries: expands xlsx members and skips everything else', () => {
  const xlsx = fakeXlsx();
  const zip = fflate.zipSync({
    'A.xlsx': xlsx,
    'folder/B.xlsx': xlsx,
    'folder/C.XLSX': xlsx,
    '__MACOSX/A.xlsx': xlsx,
    '.DS_Store': fflate.strToU8('junk'),
    'notes.txt': fflate.strToU8('no'),
    'folder/': fflate.strToU8(''),
    '../evil.xlsx': xlsx
  });
  const entries = review.extractXlsxEntries(Buffer.from(zip));
  assert.deepEqual(entries.map((e) => e.name), ['A.xlsx', 'folder/B.xlsx', 'folder/C.XLSX']);
  entries.forEach((entry) => {
    assert.ok(!entry.name.includes('..'), 'no traversal');
    assert.ok(!entry.name.startsWith('/'), 'no absolute');
    assert.ok(/\.xlsx$/i.test(entry.base), 'xlsx only');
    assert.ok(entry.data && entry.data.length > 0, 'has bytes');
  });
});

test('extractXlsxEntries: a non-zip buffer is rejected', () => {
  assert.throws(() => review.extractXlsxEntries(Buffer.from('not a zip')), /无法解压/);
});

test('extractXlsxEntries: caps the number of expanded members', () => {
  const xlsx = fakeXlsx();
  const members = {};
  for (let i = 0; i < 60; i += 1) members[`F${String(i).padStart(3, '0')}.xlsx`] = xlsx;
  const zip = fflate.zipSync(members);
  const entries = review.extractXlsxEntries(Buffer.from(zip));
  assert.equal(entries.length, 50);
});

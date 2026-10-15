'use strict';

/*
 * Excel hardcode check - frozen pressure-test regression.
 *
 * The fixture ships its own "说明与预期" sheet (Sheet / Cell / 预期等级 /
 * 预期规则 / 是否必须命中). This test treats it as the contract:
 *   - every non-IGNORE row must be reported with the exact severity and rule;
 *   - every IGNORE row must NOT be reported.
 *
 * Rules are frozen as of v1.0.0. If a future rule change breaks this test,
 * the change is wrong until the fixture's explicit expectations are met.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
const HardcodeWorkbook = require('../../private/tools/excel-hardcode-check/hardcode-workbook.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'hardcode_stress_v1.xlsx');

function loadFixture() {
  return XLSX.read(require('node:fs').readFileSync(FIXTURE), { type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true });
}

function expectations(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['说明与预期'], { header: 1, blankrows: false }).slice(5);
  return rows
    .filter((row) => row && row[0] && row[1])
    .map((row) => ({
      sheet: String(row[0]),
      cell: String(row[1]),
      level: String(row[2] || '').trim(),
      rule: String(row[3] || '').trim(),
      mustHit: String(row[6] || '').trim() === '是'
    }));
}

function scanIndex() {
  const wb = loadFixture();
  const result = HardcodeWorkbook.scanWorkbook(XLSX, wb);
  const index = {};
  result.issues.forEach((issue) => { index[`${issue.sheetName}!${issue.cellAddress}`] = issue; });
  return { result, index, expected: expectations(wb) };
}

test('pressure test: golden counts', () => {
  const { result, expected } = scanIndex();
  const report = expected.filter((e) => e.level !== 'IGNORE');
  const ignore = expected.filter((e) => e.level === 'IGNORE');
  const must = expected.filter((e) => e.mustHit);

  assert.equal(expected.length, 65, 'fixture exposes 65 explicit expectations');
  assert.equal(report.length, 43, '43 rows must be reported');
  assert.equal(ignore.length, 22, '22 rows must stay IGNORE');
  assert.equal(must.length, 28, '28 must-hit rows');

  assert.equal(result.summary.highCount, 15);
  assert.equal(result.summary.suspiciousCount, 3);
  assert.equal(result.summary.noticeCount, 25);
  assert.equal(result.summary.issueCount, 43);
});

test('pressure test: every report row matches its expected severity + rule', () => {
  const { index, expected } = scanIndex();
  const failures = [];
  expected.filter((e) => e.level !== 'IGNORE').forEach((e) => {
    const issue = index[`${e.sheet}!${e.cell}`];
    if (!issue) { failures.push(`MISSING ${e.sheet}!${e.cell} expected ${e.level}/${e.rule}`); return; }
    if (issue.severity !== e.level) failures.push(`SEVERITY ${e.sheet}!${e.cell} expected ${e.level} got ${issue.severity}`);
    if (issue.ruleId !== e.rule) failures.push(`RULE ${e.sheet}!${e.cell} expected ${e.rule} got ${issue.ruleId}`);
  });
  assert.deepEqual(failures, []);
});

test('pressure test: every IGNORE row stays unreported', () => {
  const { index, expected } = scanIndex();
  const falsePositives = [];
  expected.filter((e) => e.level === 'IGNORE').forEach((e) => {
    const issue = index[`${e.sheet}!${e.cell}`];
    if (issue) falsePositives.push(`${e.sheet}!${e.cell} reported as ${issue.ruleId}`);
  });
  assert.deepEqual(falsePositives, []);
});

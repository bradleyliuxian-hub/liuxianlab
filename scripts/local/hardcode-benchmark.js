'use strict';

/*
 * Liuxian Lab - local hardcode-check benchmark (dev helper, not shipped).
 *
 * Run the frozen rule engine over a workbook and report precision-relevant
 * facts so real-workbook false positives / negatives can be collected.
 *
 * Usage:
 *   node scripts/local/hardcode-benchmark.js <workbook.xlsx>
 *   node scripts/local/hardcode-benchmark.js <workbook.xlsx> --labels <labels.json>
 *
 * Labels file (for real workbooks without an expectation sheet):
 *   {
 *     "report": [ { "sheet": "利润表", "cell": "D10", "rule": "HC001" } ],
 *     "ignore": [ { "sheet": "模式陷阱", "cell": "E7" } ]
 *   }
 *
 * A workbook that contains a "说明与预期" sheet (same columns as the stress
 * fixture) is evaluated automatically; no labels file is needed.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', '..', 'private', 'vendor', 'xlsx', 'xlsx.full.min.js'));
const Work = require(path.join(__dirname, '..', '..', 'private', 'tools', 'excel-hardcode-check', 'hardcode-workbook.js'));

const LEVELS = ['HIGH', 'SUSPICIOUS', 'HARDCODE_NOTICE'];

function key(sheet, cell) { return `${sheet}!${cell}`; }

function severityRank(sev) { return LEVELS.indexOf(sev); }

function loadWorkbook(file) {
  return XLSX.read(fs.readFileSync(file), { type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true });
}

function labelsFromExpectationSheet(wb) {
  const sheet = wb.Sheets['说明与预期'];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).slice(5);
  const report = [];
  const ignore = [];
  rows.filter((r) => r && r[0] && r[1]).forEach((r) => {
    const entry = { sheet: String(r[0]), cell: String(r[1]) };
    if (String(r[2] || '').trim() === 'IGNORE') ignore.push(entry);
    else report.push({ ...entry, rule: String(r[3] || '').trim(), level: String(r[2] || '').trim() });
  });
  return { report, ignore };
}

function evaluate(issues, labels) {
  const index = {};
  issues.forEach((i) => { index[key(i.sheetName, i.cellAddress)] = i; });

  const reportSet = new Map(labels.report.map((r) => [key(r.sheet, r.cell), r]));
  const ignoreSet = new Set(labels.ignore.map((r) => key(r.sheet, r.cell)));

  let tp = 0;
  let ruleMismatch = 0;
  let falsePositives = [];
  const highTotal = issues.filter((i) => i.severity === 'HIGH');
  let highTp = 0;

  issues.forEach((i) => {
    const k = key(i.sheetName, i.cellAddress);
    const expected = reportSet.get(k);
    if (expected) {
      tp += 1;
      if (i.severity === 'HIGH') highTp += 1;
      if (expected.rule && expected.rule !== i.ruleId) { ruleMismatch += 1; console.log(`  rule-mismatch ${k} expected ${expected.rule} got ${i.ruleId}`); }
    } else if (ignoreSet.has(k)) {
      falsePositives.push(i);
    } else {
      falsePositives.push(i); // not labelled as a true report -> counts against precision
    }
  });

  const falseNegatives = labels.report.filter((r) => !index[key(r.sheet, r.cell)]);
  const precision = issues.length ? tp / issues.length : 1;
  const highPrecision = highTotal.length ? highTp / highTotal.length : 1;
  const recall = labels.report.length ? tp / labels.report.length : 1;

  return { tp, falsePositives, falseNegatives, precision, highPrecision, recall, ruleMismatch, highTotal: highTotal.length };
}

function main() {
  const [, , file, flag, labelsFile] = process.argv;
  if (!file) {
    console.error('usage: node scripts/local/hardcode-benchmark.js <workbook.xlsx> [--labels <labels.json>]');
    process.exit(1);
  }

  const wb = loadWorkbook(file);
  const result = Work.scanWorkbook(XLSX, wb);

  console.log(`\nWorkbook: ${path.basename(file)}  (${result.summary.sheetCount} sheets, ${result.summary.scannedCells} cells, ${result.summary.formulaCells} formulas)`);
  console.log(`Issues: ${result.summary.issueCount}  = HIGH ${result.summary.highCount} / SUSPICIOUS ${result.summary.suspiciousCount} / NOTICE ${result.summary.noticeCount}`);
  console.log(`ROUNDING_PLUG: ${result.summary.roundingPlugCount}  (人工尾差 / 勾稽调整)`);
  const byRule = {};
  result.issues.forEach((i) => { byRule[i.ruleId] = (byRule[i.ruleId] || 0) + 1; });
  console.log('by rule: ' + Object.keys(byRule).sort().map((r) => `${r}=${byRule[r]}`).join('  ') + '\n');

  const labels = labelsFromExpectationSheet(wb) || (flag === '--labels' && labelsFile ? JSON.parse(fs.readFileSync(labelsFile, 'utf8')) : null);

  if (labels) {
    const m = evaluate(result.issues, labels);
    console.log('--- evaluation ---');
    console.log(`TP ${m.tp} / FP ${m.falsePositives.length} / FN ${m.falseNegatives.length} / rule-mismatch ${m.ruleMismatch}`);
    console.log(`precision ${(m.precision * 100).toFixed(1)}%  (target >= 90%)`);
    console.log(`HIGH precision ${(m.highPrecision * 100).toFixed(1)}%  (${m.highTotal} HIGH, target >= 95%)`);
    console.log(`recall ${(m.recall * 100).toFixed(1)}%`);
    if (m.falsePositives.length) {
      console.log('\nfalse positives (review):');
      m.falsePositives.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        .forEach((i) => console.log(`  ${i.severity} ${i.ruleId} ${key(i.sheetName, i.cellAddress)}  ${i.formula || i.value}`));
    }
    if (m.falseNegatives.length) {
      console.log('\nfalse negatives:');
      m.falseNegatives.forEach((r) => console.log(`  ${key(r.sheet, r.cell)} expected ${r.level || ''} ${r.rule || ''}`));
    }
  } else {
    console.log('--- issues (no labels; review manually) ---');
    result.issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .forEach((i) => console.log(`  ${i.severity}\t${i.ruleId}\t${key(i.sheetName, i.cellAddress)}\t${i.formula || i.value}\t[${i.constants.join(',')}]`));
  }
  console.log('');
}

main();

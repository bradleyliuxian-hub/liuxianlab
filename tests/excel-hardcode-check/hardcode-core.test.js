'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../../private/tools/excel-hardcode-check/hardcode-core.js');

const EMPTY_REGION = { effectiveCells: 0, formulaCells: 0, formulaRatio: 0 };

function desc(cellType, formula, row, col, value) {
  return Core.buildCellDescriptor({ cellType, formula, row, col, value });
}

function formulaCtx(formula, row, col, neighbours, region) {
  const built = desc('formula', formula, row, col);
  return Object.assign({
    sheetName: '测试', cellAddress: `D${row}`, row, col,
    excelAddress: Core.buildExcelAddress('测试', `D${row}`),
    cellType: 'formula', value: null, formula,
    parsed: built.parsed, pattern: built.pattern,
    horizontal: {}, vertical: {}, region: region || EMPTY_REGION
  }, neighbours || {});
}

function numberCtx(value, row, col, neighbours, region) {
  return Object.assign({
    sheetName: '测试', cellAddress: `D${row}`, row, col,
    excelAddress: Core.buildExcelAddress('测试', `D${row}`),
    cellType: 'number', value, formula: null, parsed: null, pattern: null,
    horizontal: {}, vertical: {}, region: region || EMPTY_REGION
  }, neighbours || {});
}

test('HC001: a fixed value breaks a formula sequence', () => {
  const ctx = numberCtx(100, 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC001');
  assert.equal(issue.severity, 'HIGH');
  assert.equal(issue.direction, 'horizontal');
});

test('HC001: zero interrupting a formula chain is still a hardcode', () => {
  const ctx = numberCtx(0, 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) }
  });
  assert.equal(Core.evaluate(ctx).ruleId, 'HC001');
});

test('HC002: a reference replaced by a fixed number', () => {
  const ctx = formulaCtx('D5*1.2', 10, 3, {
    horizontal: { left1: desc('formula', 'C5*C8', 10, 2), right1: desc('formula', 'E5*E8', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC002');
  assert.equal(issue.severity, 'HIGH');
  assert.deepEqual(issue.constants, [1.2]);
});

test('HC003: extra fixed value added to a sibling formula', () => {
  const ctx = formulaCtx('D5-D6+100', 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC003');
  assert.equal(issue.severity, 'HIGH');
  assert.deepEqual(issue.constants, [100]);
});

test('HC005: structural deviation in a stable region (dominant pattern required)', () => {
  const ctx = formulaCtx('D5*0.5+C5', 10, 3, {
    horizontal: {
      left2: desc('formula', 'B5-B6', 10, 1),
      left1: desc('formula', 'C5-C6', 10, 2),
      right1: desc('formula', 'E5-E6', 10, 4),
      right2: desc('formula', 'F5-F6', 10, 5)
    }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC005');
  assert.equal(issue.severity, 'HIGH');
});

test('HC005: alternating / multi-pattern region is never HIGH', () => {
  // Current formula matches the distance-2 pair, but the immediate neighbours
  // alternate, so no dominant pattern exists -> no HIGH.
  const ctx = formulaCtx('E5+10', 7, 5, {
    horizontal: {
      left2: desc('formula', 'C5+10', 7, 3),
      left1: desc('formula', 'D5*1.1', 7, 4),
      right1: desc('formula', 'F5*1.1', 7, 6),
      right2: desc('formula', 'G5+10', 7, 7)
    }
  });
  assert.equal(Core.evaluate(ctx), null);
});

test('HC102: outlier fixed parameter among identical formulas', () => {
  const ctx = formulaCtx('D1*1.15', 2, 3, {
    horizontal: { left1: desc('formula', 'C1*1.10', 2, 2), right1: desc('formula', 'E1*1.10', 2, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC102');
  assert.equal(issue.severity, 'SUSPICIOUS');
  assert.deepEqual(issue.constants, [1.15]);
});

test('HC101: isolated value inside a crossing run in a dense region', () => {
  const ctx = numberCtx(500, 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) },
    region: { effectiveCells: 9, formulaCells: 8, formulaRatio: 0.875 }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC101');
  assert.equal(issue.severity, 'SUSPICIOUS');
});

test('density alone never triggers (no crossing, no side run)', () => {
  const ctx = numberCtx(500, 10, 3, {
    horizontal: { left1: desc('formula', 'C5+C6', 10, 2) },
    region: { effectiveCells: 9, formulaCells: 8, formulaRatio: 0.875 }
  });
  assert.equal(Core.evaluate(ctx), null);
});

test('HC202: fixed ratio (isolated) is a notice', () => {
  const issue = Core.evaluate(formulaCtx('A1*1.13', 10, 3));
  assert.equal(issue.ruleId, 'HC202');
  assert.equal(issue.severity, 'HARDCODE_NOTICE');
  assert.deepEqual(issue.constants, [1.13]);
});

test('HC202: percentage constant is not auto-exempt', () => {
  const issue = Core.evaluate(formulaCtx('A1*5%', 10, 3));
  assert.equal(issue.ruleId, 'HC202');
});

test('HC204: fixed unit conversion', () => {
  assert.equal(Core.evaluate(formulaCtx('A1/1000', 10, 3)).ruleId, 'HC204');
});

test('HC203: fixed period count', () => {
  assert.equal(Core.evaluate(formulaCtx('A1/12', 10, 3)).ruleId, 'HC203');
});

test('HC201: generic arithmetic constant is a notice', () => {
  assert.equal(Core.evaluate(formulaCtx('A1+100', 10, 3)).ruleId, 'HC201');
});

test('IGNORE: ROUND digits argument only', () => {
  assert.equal(Core.evaluate(formulaCtx('ROUND(A1,2)', 10, 3)), null);
});

test('IGNORE: IFERROR fallback zero', () => {
  assert.equal(Core.evaluate(formulaCtx('IFERROR(A1/B1,0)', 10, 3)), null);
});

test('IGNORE: numbers inside strings', () => {
  assert.equal(Core.evaluate(formulaCtx('A1&"2026"', 10, 3)), null);
});

test('IGNORE: absolute reference is valid parameterisation', () => {
  assert.equal(Core.evaluate(formulaCtx('A1*$B$2', 10, 3)), null);
});

test('IGNORE: array constants are unsupported in v1', () => {
  assert.equal(Core.evaluate(formulaCtx('SUM({1,2,3}*A1:A3)', 10, 3)), null);
});

test('ROUND(A1*1.13,2): 1.13 is a notice, 2 is exempt', () => {
  const parsed = Core.buildCellDescriptor({ cellType: 'formula', formula: 'ROUND(A1*1.13,2)', row: 10, col: 3 }).parsed;
  const roles = {};
  parsed.constants.forEach((c) => { roles[c.value] = c.role; });
  assert.equal(roles[1.13], 'BUSINESS_CONSTANT');
  assert.equal(roles[2], 'CONTROL_ARGUMENT');
  const issue = Core.evaluate(formulaCtx('ROUND(A1*1.13,2)', 10, 3));
  assert.equal(issue.ruleId, 'HC202');
  assert.deepEqual(issue.constants, [1.13]);
});

test('dedupe: one issue per cell, highest severity wins', () => {
  const ctx = formulaCtx('D5-D6+100', 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC003');
  assert.ok(issue.matchedRules.includes('HC003'));
  assert.ok(issue.severity === 'HIGH');
});

test('HC004: horizontal + vertical evidence augments one issue', () => {
  const ctx = formulaCtx('D5-D6+100', 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) },
    vertical: { up1: desc('formula', 'D9-D10', 9, 3), down1: desc('formula', 'D11-D12', 11, 3) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC003');
  assert.ok(issue.matchedRules.includes('HC004'));
});

test('issue shape: ruleId / severity / address / evidence / suggestion', () => {
  const issue = Core.evaluate(formulaCtx('A1*1.13', 10, 3));
  assert.ok(issue.ruleId);
  assert.ok(issue.severity);
  assert.equal(issue.excelAddress, '测试!D10');
  assert.ok(Array.isArray(issue.evidence) && issue.evidence.length > 0);
  assert.ok(issue.suggestion);
  assert.equal(typeof issue.confidenceScore, 'number');
});

test('buildExcelAddress: quoting rules', () => {
  assert.equal(Core.buildExcelAddress('利润表', 'H28'), '利润表!H28');
  assert.equal(Core.buildExcelAddress('销售明细 10月', 'C18'), "'销售明细 10月'!C18");
  assert.equal(Core.buildExcelAddress("Brad's Data", 'C18'), "'Brad''s Data'!C18");
});

// --- Precision phase: semantic exemptions and false-positive suppression ---

test('IGNORE: IF logical zero, MAX floor zero', () => {
  assert.equal(Core.evaluate(formulaCtx('IF(B5>0,B5,0)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('MAX(B10,0)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('IF(B13>0,B13*5%,0)', 10, 3)).ruleId, 'HC202');
});

test('IGNORE: DATE / EOMONTH date arguments and YEAR semantics', () => {
  assert.equal(Core.evaluate(formulaCtx('DATE(2026,12,31)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('EOMONTH(DATE(2026,1,15),12)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('YEAR(DATE(2026,1,1))+1', 10, 3)), null);
});

test('IGNORE: CHOOSE index and unselected branches', () => {
  assert.equal(Core.evaluate(formulaCtx('CHOOSE(2,B11,C11,999)', 10, 3)), null);
});

test('IGNORE: (1 - reference) produces no hardcode notice', () => {
  assert.equal(Core.evaluate(formulaCtx('A1*(1-B1)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('(1-A1)/(1-B1)', 10, 3)), null);
});

test('HC002: named range and cross-sheet reference operands', () => {
  const named = formulaCtx('D13*0.3', 10, 3, {
    horizontal: { left1: desc('formula', 'C13*TaxRate', 10, 2), right1: desc('formula', 'E13*TaxRate', 10, 4) }
  });
  assert.equal(Core.evaluate(named).ruleId, 'HC002');

  const crossSheet = formulaCtx('D10*7.5', 10, 3, {
    horizontal: {
      left1: desc('formula', "C10*'参数 表'!$B$5", 10, 2),
      right1: desc('formula', "E10*'参数 表'!$B$5", 10, 4)
    }
  });
  assert.equal(Core.evaluate(crossSheet).ruleId, 'HC002');

  const absolute = formulaCtx('D5*1.2', 10, 3, {
    horizontal: { left1: desc('formula', 'C5*$B$2', 10, 2), right1: desc('formula', 'E5*$B$2', 10, 4) }
  });
  assert.equal(Core.evaluate(absolute).ruleId, 'HC002');
});

test('HC001 vs HC101: single-axis run is HIGH, dense isolated value is SUSPICIOUS', () => {
  const run = numberCtx(1250, 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) },
    region: { effectiveCells: 3, formulaCells: 2, formulaRatio: 0.67 }
  });
  assert.equal(Core.evaluate(run).ruleId, 'HC001');

  const dense = numberCtx(888, 19, 3, {
    horizontal: { left1: desc('formula', 'C8+19', 19, 2), right1: desc('formula', 'E8+19', 19, 4) },
    region: { effectiveCells: 9, formulaCells: 8, formulaRatio: 0.89 }
  });
  assert.equal(Core.evaluate(dense).ruleId, 'HC101');
  assert.equal(Core.evaluate(dense).severity, 'SUSPICIOUS');
});

test('HC001: a formula run whose constants vary is not "consistent"', () => {
  const ctx = numberCtx(888, 19, 3, {
    horizontal: { left1: desc('formula', 'C8+19', 19, 2), right1: desc('formula', 'E8+19', 19, 4) },
    vertical: { up1: desc('formula', 'D8+18', 18, 3), down1: desc('formula', 'D8+20', 20, 3) },
    region: { effectiveCells: 9, formulaCells: 8, formulaRatio: 0.89 }
  });
  assert.equal(Core.evaluate(ctx).ruleId, 'HC101');
});

test('notices suppressed at an alternating / regime boundary', () => {
  const alternating = formulaCtx('E5+10', 7, 5, {
    horizontal: { left1: desc('formula', 'D5*1.1', 7, 4), right1: desc('formula', 'F5*1.1', 7, 6) }
  });
  assert.equal(Core.evaluate(alternating), null);

  const regime = formulaCtx('F5*1.2', 9, 6, {
    horizontal: { left1: desc('formula', 'E5*1.1', 9, 5), right1: desc('formula', 'G5*1.2', 9, 7) }
  });
  assert.equal(Core.evaluate(regime), null);
});

test('notice classification respects the arithmetic operator', () => {
  assert.equal(Core.evaluate(formulaCtx('IF(B6>1000,B6,C6)', 10, 3)).ruleId, 'HC201');
  assert.equal(Core.evaluate(formulaCtx('B12^2', 10, 3)).ruleId, 'HC201');
  assert.equal(Core.evaluate(formulaCtx('IF(B5>C5,B5*1.2,C5)', 10, 3)).ruleId, 'HC201');
  assert.equal(Core.evaluate(formulaCtx('MIN(B9,100)', 10, 3)).ruleId, 'HC201');
  assert.equal(Core.evaluate(formulaCtx('SUM(B8:C8)+500', 10, 3)).ruleId, 'HC201');
  assert.equal(Core.evaluate(formulaCtx('ROUND((B7-C7)*0.85,2)', 10, 3)).ruleId, 'HC202');
});

// --- Precision phase 2: ROUNDING_PLUG, sequence proof, column role ---

test('HC006 ROUNDING_PLUG: crossing run + small local adjustment is HIGH', () => {
  const ctx = formulaCtx('ROUND(D5,2)+0.02', 10, 3, {
    horizontal: { left1: desc('formula', 'ROUND(C5,2)', 10, 2), right1: desc('formula', 'ROUND(E5,2)', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC006');
  assert.equal(issue.severity, 'HIGH');
  assert.deepEqual(issue.constants, [0.02]);
  const roles = {};
  issue.constantDetails.forEach((d) => { roles[d.value] = [d.role, d.anomalous]; });
  assert.deepEqual(roles[2], ['CONTROL_ARGUMENT', false]);
  assert.deepEqual(roles[0.02], ['ROUNDING_PLUG', true]);
});

test('HC006 ROUNDING_PLUG: +/- 1..5 are plug, not discounted', () => {
  [1, -1, 3, -3, 5, -5].forEach((v) => {
    const ctx = formulaCtx(`ROUND(D5/1000,0)${v > 0 ? '+' : '-'}${Math.abs(v)}`, 10, 3, {
      horizontal: { left1: desc('formula', 'ROUND(C5/1000,0)', 10, 2), right1: desc('formula', 'ROUND(E5/1000,0)', 10, 4) }
    });
    const issue = Core.evaluate(ctx);
    assert.equal(issue.ruleId, 'HC006', `value ${v}`);
    assert.deepEqual(issue.constants, [v]);
    const plug = issue.constantDetails.find((d) => d.role === 'ROUNDING_PLUG');
    assert.ok(plug, `plug role for ${v}`);
  });
});

test('HC006 ROUNDING_PLUG: single-side run is SUSPICIOUS', () => {
  const ctx = formulaCtx('ROUND(D5,2)+3', 10, 3, {
    horizontal: { left2: desc('formula', 'ROUND(B5,2)', 10, 1), left1: desc('formula', 'ROUND(C5,2)', 10, 2) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC006');
  assert.equal(issue.severity, 'SUSPICIOUS');
});

test('HC003: a non-plug extra constant stays HC003 (100 / 500)', () => {
  const big = formulaCtx('D5-D6+100', 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) }
  });
  assert.equal(Core.evaluate(big).ruleId, 'HC003');
});

test('HC006 downgraded when the plug repeats across the whole column', () => {
  const ctx = formulaCtx('ROUND(D5,2)+0.01', 10, 3, {
    horizontal: { left1: desc('formula', 'ROUND(C5,2)', 10, 2), right1: desc('formula', 'ROUND(E5,2)', 10, 4) },
    vertical: { up1: desc('formula', 'ROUND(D4,2)+0.01', 9, 3), down1: desc('formula', 'ROUND(D6,2)+0.01', 11, 3) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC006');
  assert.equal(issue.severity, 'SUSPICIOUS');
});

test('HC001/HC103: zero balance is never a sequence break', () => {
  const zero = numberCtx(0, 10, 3, {
    horizontal: { left2: desc('formula', 'B5-B6', 10, 1), left1: desc('formula', 'C5-C6', 10, 2) }
  });
  assert.equal(Core.evaluate(zero), null);
});

test('HC103 suppressed when the perpendicular line is a data column', () => {
  const upRun = { up1: desc('formula', 'D5-D6', 9, 3), up2: desc('formula', 'D4-D5', 8, 3) };
  const dataRow = numberCtx(1000, 10, 3, {
    vertical: upRun,
    horizontal: { left1: desc('number', null, 10, 2, 5), right1: desc('number', null, 10, 4, 7) }
  });
  assert.equal(Core.evaluate(dataRow), null);

  const edge = numberCtx(1000, 10, 3, { vertical: upRun });
  assert.equal(Core.evaluate(edge).ruleId, 'HC103');
});

test('right/down single-side runs are never reported (data column before formulas)', () => {
  const ctx = numberCtx(1000, 10, 3, {
    horizontal: { right1: desc('formula', 'E5-E6', 10, 4), right2: desc('formula', 'F5-F6', 10, 5) }
  });
  assert.equal(Core.evaluate(ctx), null);
});

// --- Rounding phase: unit conversion (ROUND(x/1000,digits)) and plugs ---

test('unit conversion: ROUND(x/1000, digits) alone is never reported', () => {
  assert.equal(Core.evaluate(formulaCtx('ROUND(A1/1000,0)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('ROUND(A1/1000,2)', 10, 3)), null);
  assert.equal(Core.evaluate(formulaCtx('ROUND(A1*1000,2)', 10, 3)), null);
});

test('unit conversion: 1000 is UNIT_CONVERSION and digits are CONTROL_ARGUMENT', () => {
  const parsed = Core.buildCellDescriptor({ cellType: 'formula', formula: 'ROUND(A1/1000,0)', row: 10, col: 3 }).parsed;
  const roles = {};
  parsed.constants.forEach((c) => { roles[c.value] = c.role; });
  assert.equal(roles[1000], 'UNIT_CONVERSION');
  assert.equal(roles[0], 'CONTROL_ARGUMENT');
});

test('unit conversion: standalone /1000 still stays a HC204 notice', () => {
  assert.equal(Core.evaluate(formulaCtx('A1/1000', 10, 3)).ruleId, 'HC204');
});

test('HC006 ROUNDING_PLUG: ROUND(x/1000,0)+1 crossing run is HIGH', () => {
  const ctx = formulaCtx('ROUND(D5/1000,0)+1', 10, 3, {
    horizontal: { left1: desc('formula', 'ROUND(C5/1000,0)', 10, 2), right1: desc('formula', 'ROUND(E5/1000,0)', 10, 4) }
  });
  const issue = Core.evaluate(ctx);
  assert.equal(issue.ruleId, 'HC006');
  assert.equal(issue.severity, 'HIGH');
  assert.deepEqual(issue.constants, [1]);
  const roles = {};
  issue.constantDetails.forEach((d) => { roles[d.value] = [d.role, d.anomalous]; });
  assert.deepEqual(roles[1000], ['UNIT_CONVERSION', false]);
  assert.deepEqual(roles[1], ['ROUNDING_PLUG', true]);
});

test('HC006 ROUNDING_PLUG: no sibling evidence falls back to SUSPICIOUS', () => {
  const minus = Core.evaluate(formulaCtx('ROUND(D5/1000,0)-2', 10, 3));
  assert.equal(minus.ruleId, 'HC006');
  assert.equal(minus.severity, 'SUSPICIOUS');
  assert.deepEqual(minus.constants, [-2]);

  const cents = Core.evaluate(formulaCtx('ROUND(D5,2)+0.02', 10, 3));
  assert.equal(cents.ruleId, 'HC006');
  assert.equal(cents.severity, 'SUSPICIOUS');
  assert.deepEqual(cents.constants, [0.02]);
});

test('HC006 ROUNDING_PLUG: a literal inside the ROUND body is not a plug', () => {
  const issue = Core.evaluate(formulaCtx('ROUND(D5+3,2)', 10, 3));
  assert.notEqual(issue && issue.ruleId, 'HC006');
});

test('HC103: value beside formula columns in a data column is not reported', () => {
  const ctx = numberCtx(-29551580.75, 10, 3, {
    horizontal: { left2: desc('formula', 'SUM(V96:V99)', 10, 1), left1: desc('formula', 'SUM(W96:W99)', 10, 2) },
    vertical: { up2: desc('number', null, 8, 3, -1591788184.61), up1: desc('number', null, 9, 3, 163502812) }
  });
  assert.equal(Core.evaluate(ctx), null);
});

test('HC101: crossing run whose perpendicular axis is a data column is suppressed', () => {
  const ctx = numberCtx(500, 10, 3, {
    horizontal: { left1: desc('formula', 'C5-C6', 10, 2), right1: desc('formula', 'E5-E6', 10, 4) },
    vertical: { up1: desc('number', null, 9, 3, 11), down1: desc('number', null, 11, 3, 22) },
    region: { effectiveCells: 9, formulaCells: 8, formulaRatio: 0.875 }
  });
  assert.equal(Core.evaluate(ctx), null);
});

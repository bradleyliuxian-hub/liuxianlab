'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const XLSX = require('../../private/vendor/xlsx/xlsx.full.min.js');
const DecimalWorkbook = require('../../private/tools/excel-decimal-check/decimal-workbook.js');

function byCell(issues) {
  const map = {};
  issues.forEach((issue) => { map[`${issue.sheetName}!${issue.cell}`] = issue; });
  return map;
}

function visibleWorkbook() {
  return {
    SheetNames: ['销售明细', '成本表'],
    Sheets: {
      销售明细: {
        '!ref': 'A1:J1',
        A1: { t: 'n', v: 123.456 },
        B1: { t: 'n', v: 10.12 },
        C1: { t: 'n', v: 0.1 + 0.2 },
        D1: { t: 's', v: 'text 1.234' },
        E1: { t: 'n', v: 45293, z: 'yyyy-mm-dd' },
        F1: { t: 'b', v: true },
        G1: { t: 'e', v: 7 },
        H1: { t: 'n', v: 12.3456, f: 'A1/B1' },
        I1: { t: 'n', v: 10.1, f: 'A1/C1' },
        J1: { t: 'z', v: 0, f: 'A1/0' },
        B2: { t: 'n', v: 0.123456, z: '0.00%' },
        B3: { t: 'n', v: 0.246912, f: 'B2*2', z: '0.00%' },
        C3: { t: 'n', v: 1.005, z: '0.00' }
      },
      成本表: {
        '!ref': 'F26',
        F26: { t: 'n', v: 1.2345 }
      }
    }
  };
}

test('scanWorkbook: classifies visible cells into categories', () => {
  const { summary, issues } = DecimalWorkbook.scanWorkbook(XLSX, visibleWorkbook());
  const map = byCell(issues);

  assert.equal(summary.sheetCount, 2);
  assert.equal(map['销售明细!A1'].category, 'raw');
  assert.equal(map['销售明细!C3'].category, 'raw');
  assert.equal(map['成本表!F26'].category, 'raw');
  assert.equal(map['成本表!F26'].goto, '成本表!F26');
  assert.equal(map['销售明细!H1'].category, 'formula');
  assert.equal(map['销售明细!H1'].originalFormula, 'A1/B1');
  assert.equal(map['销售明细!H1'].decimals, 4);
  assert.equal(map['销售明细!J1'].category, 'unknown');

  assert.equal(map['销售明细!B1'], undefined);
  assert.equal(map['销售明细!C1'], undefined);
  assert.equal(map['销售明细!E1'], undefined);
  assert.equal(map['销售明细!I1'], undefined);

  assert.equal(summary.rawCount, 3);
  assert.equal(summary.formulaCount, 1);
  assert.equal(summary.unknownCount, 1);
});

test('scanWorkbook: percentages are their own category, never raw', () => {
  const { issues, summary } = DecimalWorkbook.scanWorkbook(XLSX, visibleWorkbook());
  const map = byCell(issues);
  assert.equal(map['销售明细!B2'].category, 'percentage');
  assert.equal(map['销售明细!B3'].category, 'percentage');
  assert.equal(map['销售明细!B2'].isPercentage, true);
  assert.equal(summary.percentageCount, 2);
  // No percentage leaks into raw or formula categories.
  issues.filter((i) => i.category === 'raw' || i.category === 'formula').forEach((i) => {
    assert.equal(i.isPercentage, false);
  });
});

test('scanWorkbook: direct reference count is recorded', () => {
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
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const a1 = byCell(issues)['S1!A1'];
  assert.equal(a1.directReferenceCount, 2);
  assert.equal(a1.hasReference, true);
  assert.equal(a1.isReferenceTerminal, false);
});

test('scanWorkbook: cross-sheet references and tricky sheet names', () => {
  const wb = {
    SheetNames: ['Raw Data', "Brad's Data"],
    Sheets: {
      'Raw Data': { A1: { t: 'n', v: 10.123 } },
      "Brad's Data": { B1: { t: 'n', v: 1, f: "'Raw Data'!A1*2" } }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const a1 = byCell(issues)["Raw Data!A1"];
  assert.equal(a1.crossSheet, true);
  assert.equal(a1.directReferenceCount, 1);
  assert.equal(a1.goto, "'Raw Data'!A1");
});

test('scanWorkbook: hidden areas excluded by default, included on demand', () => {
  const build = () => ({
    SheetNames: ['S1', 'HiddenSheet'],
    Sheets: {
      S1: {
        '!rows': [], '!cols': [],
        A1: { t: 'n', v: 1.234 },
        A3: { t: 'n', v: 2.345 },
        B1: { t: 'n', v: 3.456 },
        C5: { t: 'n', v: 9, f: 'A3*2' }
      },
      HiddenSheet: { A1: { t: 'n', v: 4.567 } }
    },
    Workbook: { Sheets: [{ name: 'S1' }, { name: 'HiddenSheet', Hidden: 1 }] }
  });

  const offResult = (() => {
    const wb = build();
    wb.Sheets.S1['!rows'][2] = { hidden: true };
    wb.Sheets.S1['!cols'][1] = { hidden: true };
    return DecimalWorkbook.scanWorkbook(XLSX, wb, { includeHidden: false });
  })();
  assert.equal(offResult.summary.issueCount, 1);
  assert.equal(byCell(offResult.issues)['S1!A1'].category, 'raw');
  assert.equal(byCell(offResult.issues)['S1!A3'], undefined);
  assert.equal(byCell(offResult.issues)['S1!B1'], undefined);
  assert.equal(byCell(offResult.issues)['HiddenSheet!A1'], undefined);

  const onResult = (() => {
    const wb = build();
    wb.Sheets.S1['!rows'][2] = { hidden: true };
    wb.Sheets.S1['!cols'][1] = { hidden: true };
    return DecimalWorkbook.scanWorkbook(XLSX, wb, { includeHidden: true, analyzeReferences: true });
  })();
  const map = byCell(onResult.issues);
  assert.equal(map['S1!A3'].category, 'hidden');
  assert.equal(map['S1!A3'].hiddenType, 'row');
  assert.equal(map['S1!B1'].category, 'hidden');
  assert.equal(map['S1!B1'].hiddenType, 'column');
  assert.equal(map['HiddenSheet!A1'].category, 'hidden');
  assert.equal(map['HiddenSheet!A1'].hiddenType, 'sheet');
  assert.equal(onResult.summary.hiddenCount, 3);

  // A hidden value referenced by a VISIBLE formula is high risk.
  assert.equal(map['S1!A3'].riskLevel, '高');
});

test('scanWorkbook: percentage is a distinct dimension even when referenced', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 0.123456, z: '0.00%' },
        B1: { t: 'n', v: 1, f: 'A1*2' }
      }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const a1 = byCell(issues)['S1!A1'];
  assert.equal(a1.category, 'percentage');
  assert.equal(a1.directReferenceCount, 1);
  // A percentage feeding a visible formula is escalated, but stays its own category.
  assert.equal(a1.riskLevel, '高');
  assert.equal(a1.downstreamReferenceCount, 1);
});

test('scanWorkbook + export: same-risk rows ordered by downstream desc', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 'n', v: 10.123 },
        B1: { t: 'n', v: 20, f: 'A1*2' },   // integer cached -> not an issue
        C1: { t: 'n', v: 21, f: 'B1+1' },   // integer cached -> not an issue
        D1: { t: 'n', v: 5.678 }            // visible raw, no references
      }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb, { analyzeReferences: true });
  const map = byCell(issues);
  assert.equal(map['S1!A1'].downstreamReferenceCount, 2);
  assert.equal(map['S1!D1'].downstreamReferenceCount, 0);
  assert.equal(map['S1!A1'].riskLevel, '高');
  assert.equal(map['S1!D1'].riskLevel, '高');

  const out = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues);
  const buf = XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  const raw = reread.Sheets['普通数值问题'];
  assert.equal(raw.D2.v, 'A1');
  assert.equal(raw.D3.v, 'D1');
  assert.equal(raw.I1.v, '直接引用次数');
  assert.equal(raw.J1.v, '下游引用次数');
});

test('scanWorkbook: is read-only (never modifies the workbook)', () => {
  const wb = visibleWorkbook();
  const snapshot = JSON.stringify(wb);
  DecimalWorkbook.scanWorkbook(XLSX, wb, { includeHidden: true });
  assert.equal(JSON.stringify(wb), snapshot);
  assert.equal(wb.Sheets['销售明细'].A1.v, 123.456);
  assert.equal(wb.Sheets['销售明细'].H1.f, 'A1/B1');
});

test('buildIssuesWorkbook: seven sheets in fixed order with headers', () => {
  const wb = visibleWorkbook();
  const { issues, rates } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const out = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues, { rates });
  assert.deepEqual(out.SheetNames, [
    '高风险尾差', '普通数值问题', '公式结果问题', '隐藏区域检查', '百分比检查', '公式不可判定', '汇率检查'
  ]);

  const buf = XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });

  const raw = reread.Sheets['普通数值问题'];
  assert.equal(raw.A1.v, '序号');
  assert.equal(raw.B1.v, '风险等级');
  const rawText = JSON.stringify(raw);
  assert.match(rawText, /123\.456/);
  assert.doesNotMatch(rawText, /0\.123456/, 'percentage value must not leak into raw sheet');

  const pct = reread.Sheets['百分比检查'];
  assert.equal(pct.A1.v, '序号');
  assert.equal(pct.H1.v, 'Number Format');
  assert.match(JSON.stringify(pct), /0\.123456/);

  const high = reread.Sheets['高风险尾差'];
  assert.equal(high.E1.v, '问题类型');
  assert.equal(high.J1.v, '直接引用次数');
  assert.equal(high.K1.v, '下游引用次数');
  assert.equal(high.M1.v, '隐藏类型');
});

test('buildIssuesWorkbook: F5 addresses are text, never formulas', () => {
  const wb = {
    SheetNames: ["Brad's Data", '销售明细 10月'],
    Sheets: {
      "Brad's Data": { C18: { t: 'n', v: 123.456 } },
      '销售明细 10月': { F26: { t: 'n', v: 12.3456 } }
    }
  };
  const { issues } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const out = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues);
  const buf = XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  const raw = reread.Sheets['普通数值问题'];
  const gotos = [raw.E2, raw.E3].map((cell) => cell && cell.v).filter(Boolean);
  assert.deepEqual(gotos.sort(), ["'Brad''s Data'!C18", "'销售明细 10月'!F26"].sort());
  [raw.E2, raw.E3].forEach((cell) => { if (cell) assert.equal(cell.t, 's'); });
});

test('scanWorkbook: exchange rates are detected by title and graded on 4 decimals', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 's', v: 'USD/CNY 汇率' },
        B1: { t: 'n', v: 7.1234 },   // 4 decimals -> normal for a rate
        A2: { t: 's', v: 'USD/CNY 汇率' },
        B2: { t: 'n', v: 7.12345 }   // 5 decimals -> rate precision problem
      }
    }
  };
  const { issues, rates, summary } = DecimalWorkbook.scanWorkbook(XLSX, wb, { analyzeReferences: true });
  const map = byCell(issues);

  assert.equal(summary.rateRowCount, 2);
  assert.equal(summary.exchangeRateCount, 1);

  // B1: precise rate -> tracked as a rate, NOT an issue.
  assert.equal(map['S1!B1'], undefined);
  const b1 = rates.find((r) => r.cell === 'B1');
  assert.equal(b1.businessType, 'exchange_rate');
  assert.equal(b1.allowedDecimals, 4);
  assert.equal(b1.precisionStatus, '正常');
  assert.equal(b1.directReferenceCount, 0);

  // B2: exceeds 4 decimals -> a rate precision issue.
  assert.equal(map['S1!B2'].category, 'exchange_rate');
  assert.equal(map['S1!B2'].businessType, 'exchange_rate');
  assert.equal(map['S1!B2'].allowedDecimals, 4);
  assert.equal(map['S1!B2'].precisionStatus, '超出4位');
  assert.equal(map['S1!B2'].decimals, 5);
});

test('scanWorkbook: suspected exchange rate is flagged, not exempted', () => {
  const wb = {
    SheetNames: ['S2'],
    Sheets: {
      S2: {
        A1: { t: 's', v: '币种 USD' },
        B1: { t: 'n', v: 6.78901 } // 5 decimals; only a weak currency signal
      }
    }
  };
  const { issues, rates } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const map = byCell(issues);
  assert.equal(map['S2!B1'].category, 'exchange_rate');
  assert.equal(map['S2!B1'].businessType, 'suspected_exchange_rate');
  assert.equal(map['S2!B1'].businessTypeConfidence, 'low');
  assert.equal(map['S2!B1'].riskLevel, '观察');
  assert.equal(rates[0].typeLabel, '疑似汇率');
});

test('scanWorkbook: exchange rate via named range; normal numbers unaffected', () => {
  const wb = {
    SheetNames: ['S3', 'S4'],
    Sheets: {
      S3: { H1: { t: 'n', v: 7.125 } },                 // 3 decimals but a named rate
      S4: { A1: { t: 's', v: '数量' }, B1: { t: 'n', v: 12.3456 } }
    },
    Workbook: { Sheets: [{ name: 'S3' }, { name: 'S4' }], Names: [{ Name: 'USD_CNY_RATE', Ref: 'S3!$H$1' }] }
  };
  const { issues, rates } = DecimalWorkbook.scanWorkbook(XLSX, wb);
  const map = byCell(issues);
  assert.equal(map['S3!H1'], undefined);
  assert.equal(rates[0].businessType, 'exchange_rate');
  assert.equal(map['S4!B1'].category, 'raw');
});

test('buildIssuesWorkbook: 汇率检查 sheet is sorted by downstream desc', () => {
  const wb = {
    SheetNames: ['S1'],
    Sheets: {
      S1: {
        A1: { t: 's', v: 'USD/CNY 汇率' },
        B1: { t: 'n', v: 7.1234 },
        A2: { t: 's', v: 'USD/CNY 汇率' },
        B2: { t: 'n', v: 7.12345 },
        C5: { t: 'n', v: 0, f: 'B1*2' }
      }
    }
  };
  const { issues, rates } = DecimalWorkbook.scanWorkbook(XLSX, wb, { analyzeReferences: true });
  const out = DecimalWorkbook.buildIssuesWorkbook(XLSX, issues, { rates });
  const buf = XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
  const reread = XLSX.read(buf, { type: 'buffer' });
  const fx = reread.Sheets['汇率检查'];
  assert.equal(fx.A1.v, '序号');
  assert.equal(fx.E1.v, '当前值');
  assert.equal(fx.G1.v, '类型');
  // B1 has downstream 1, B2 has 0 -> B1 first, then B2.
  assert.equal(fx.C2.v, 'B1');
  assert.equal(fx.C3.v, 'B2');
  assert.equal(fx.L2.v, '正常');
  assert.equal(fx.L3.v, '超出4位');
});

test('exchange-rate lineage: pure refs inherit; computations become derived', () => {
  const wb = {
    SheetNames: ['汇率表', 'Calc', 'Report', 'Amount'],
    Sheets: {
      汇率表: { A2: { t: 's', v: 'USD/CNY 汇率' }, B2: { t: 'n', v: 7.1234 } },
      Calc: {
        C2: { t: 'n', v: 7.1234, f: "'汇率表'!B2" },  // pure cross-sheet ref -> inherit
        D2: { t: 'n', v: 7.1234, f: 'C2' },           // pure ref of a rate -> deeper
        E2: { t: 'n', v: 712.34, f: 'C2*100' },        // computed -> derived (2dp, no issue)
        F2: { t: 'n', v: 7.1234, f: 'C2+0' },          // +0 is a computation -> derived (4dp)
        G2: { t: 'n', v: 7.1234, f: 'ROUND(C2,4)' }    // function -> derived (4dp)
      },
      Report: {
        D5: { t: 'n', v: 7.1234, f: "'汇率表'!B2" },        // pure -> inherit
        H5: { t: 'n', v: 712.34, f: "'汇率表'!B2*Amount!A1" } // computed -> derived
      },
      Amount: { A1: { t: 'n', v: 100 } }
    }
  };
  const { issues, rates } = DecimalWorkbook.scanWorkbook(XLSX, wb, { analyzeReferences: true });
  const map = byCell(issues);
  const rateOf = (sheet, cell) => rates.find((r) => r.sheetName === sheet && r.cell === cell);

  // Raw rate -> exchange_rate, normal, not an issue.
  assert.equal(map['汇率表!B2'], undefined);
  assert.equal(rateOf('汇率表', 'B2').typeLabel, '原始汇率');

  // Pure reference inherits exchange_rate (allowed 4) and is NOT an issue at all.
  assert.equal(map['Calc!C2'], undefined);
  const c2 = rateOf('Calc', 'C2');
  assert.equal(c2.businessType, 'exchange_rate');
  assert.equal(c2.typeLabel, '汇率直接引用');
  assert.equal(c2.allowedDecimals, 4);
  assert.equal(c2.depth, 1);
  assert.equal(c2.sourceGoto, '汇率表!B2');
  assert.ok(!issues.some((i) => i.sheetName === 'Calc' && i.cell === 'C2'));

  // Multi-level pure chain: depth 2, still exchange_rate, still not an issue.
  const d2 = rateOf('Calc', 'D2');
  assert.equal(d2.businessType, 'exchange_rate');
  assert.equal(d2.depth, 2);
  assert.equal(map['Calc!D2'], undefined);

  // Computed on a rate -> exchange_rate_derived (no 4-decimal exemption).
  assert.equal(rateOf('Calc', 'E2').typeLabel, '汇率派生计算');
  assert.equal(map['Calc!E2'], undefined); // 712.34 = 2dp -> no issue
  assert.equal(map['Calc!F2'].businessType, 'exchange_rate_derived');
  assert.equal(map['Calc!F2'].category, 'formula');
  assert.equal(map['Calc!G2'].businessType, 'exchange_rate_derived');
  assert.equal(map['Calc!G2'].category, 'formula');

  // Cross-sheet pure ref inherits (not an issue); cross-sheet computation is derived.
  assert.equal(map['Report!D5'], undefined);
  assert.equal(rateOf('Report', 'D5').businessType, 'exchange_rate');
  assert.equal(rateOf('Report', 'H5').typeLabel, '汇率派生计算');
  assert.equal(map['Report!H5'], undefined); // 712.34 = 2dp -> no issue
});

'use strict';

/*
 * Liuxian Lab - Excel hardcode check: pure rule engine.
 *
 * Consumes a cell context (current cell + neighbours + local region) built by
 * hardcode-workbook.js and returns a single de-duplicated issue (or null).
 * No DOM and no SheetJS file writing live here.
 *
 * RULES ARE FROZEN as of v1.0.0. tests/excel-hardcode-check/stress-regression
 * encodes the pressure-test contract (43 report rows by exact rule/severity,
 * 22 IGNORE rows unreported). Only change rules for reproducible, general
 * patterns, and only while that regression keeps passing.
 */

(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const parser = isNode ? require('./formula-parser.js') : root.HardcodeFormulaParser;
  const pattern = isNode ? require('./formula-pattern.js') : root.HardcodeFormulaPattern;

  const api = factory(parser, pattern);
  if (isNode) module.exports = api;
  else root.HardcodeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (parser, pattern) {
  const SEVERITY = { HIGH: 'HIGH', SUSPICIOUS: 'SUSPICIOUS', HARDCODE_NOTICE: 'HARDCODE_NOTICE', IGNORE: 'IGNORE' };
  const SEVERITY_RANK = { HIGH: 3, SUSPICIOUS: 2, HARDCODE_NOTICE: 1, IGNORE: 0 };

  const RULES = {
    HC001: { severity: SEVERITY.HIGH, priority: 1, title: '公式序列被固定值打断', suggestion: '该单元格为固定值，打断了相邻公式序列，建议确认是否应改为公式。' },
    HC002: { severity: SEVERITY.HIGH, priority: 2, title: '公式引用被固定值替代', suggestion: '同类公式此处本应引用单元格，现为固定值，建议确认是否被硬编码替代。' },
    HC003: { severity: SEVERITY.HIGH, priority: 3, title: '同类公式额外加入固定数值', suggestion: '同类公式额外加入了固定数值，建议确认是否为有意调整。' },
    HC005: { severity: SEVERITY.HIGH, priority: 5, title: '稳定公式区域中的模式偏离', suggestion: '该公式与周围稳定公式模式明显不同，建议人工核对。' },
    HC006: { severity: SEVERITY.HIGH, priority: 6, title: '人工尾差 / 勾稽调整', suggestion: '公式在同类模式基础上额外加入了一个较小的固定调整值，疑似人工尾差 / 勾稽调整，建议核对原始凭证与勾稽关系。' },
    HC101: { severity: SEVERITY.SUSPICIOUS, priority: 11, title: '公式密集区域中的孤立固定值', suggestion: '公式密集区域中出现孤立固定值，建议确认。' },
    HC102: { severity: SEVERITY.SUSPICIOUS, priority: 12, title: '同类公式固定参数异常变化', suggestion: '同类公式的固定参数出现异常差异，建议确认参数来源。' },
    HC103: { severity: SEVERITY.SUSPICIOUS, priority: 13, title: '单侧公式模式异常', suggestion: '单侧相邻公式显示该处可能被固定值打断，建议确认。' },
    HC104: { severity: SEVERITY.SUSPICIOUS, priority: 14, title: '连续结构中的单期固定值', suggestion: '连续结构中出现单期固定值，建议确认。' },
    HC105: { severity: SEVERITY.SUSPICIOUS, priority: 15, title: '公式中存在周围没有的业务常量', suggestion: '公式中存在周围没有的业务常量，建议确认。' },
    HC201: { severity: SEVERITY.HARDCODE_NOTICE, priority: 21, title: '算术表达式直接使用固定数值', suggestion: '公式直接使用固定数值参与计算，建议确认是否应引用参数单元格。' },
    HC202: { severity: SEVERITY.HARDCODE_NOTICE, priority: 22, title: '固定百分比或比例', suggestion: '公式使用固定比例/百分比，建议确认是否应引用统一参数。' },
    HC203: { severity: SEVERITY.HARDCODE_NOTICE, priority: 23, title: '固定期间数', suggestion: '公式使用固定期间数，建议确认。' },
    HC204: { severity: SEVERITY.HARDCODE_NOTICE, priority: 24, title: '固定单位换算值', suggestion: '公式使用固定单位换算值，建议确认。' },
    HC205: { severity: SEVERITY.HARDCODE_NOTICE, priority: 20, title: '大面积重复业务硬编码', suggestion: '多个公式重复使用同一固定值，建议确认是否应引用统一参数单元格。' }
  };

  const PERIOD_VALUES = new Set([2, 3, 4, 7, 12, 24, 26, 30, 52, 365]);
  const UNIT_VALUES = new Set([60, 1000, 3600, 10000, 100000, 1000000, 10000000]);

  const SAFE_SHEET = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*$/;
  const CELL_REF = /^[A-Za-z]{1,3}[0-9]{1,7}$/;

  function buildExcelAddress(sheetName, cellAddress) {
    const name = String(sheetName == null ? '' : sheetName);
    const cell = String(cellAddress == null ? '' : cellAddress);
    const needsQuotes = !SAFE_SHEET.test(name) || CELL_REF.test(name);
    const escaped = name.replace(/'/g, "''");
    return (needsQuotes ? "'" + escaped + "'" : name) + '!' + cell;
  }

  function buildCellDescriptor(info) {
    const cellType = info.cellType;
    const descriptor = {
      present: true,
      cellType,
      value: info.value === undefined ? null : info.value,
      formula: info.formula || null,
      row: info.row,
      col: info.col,
      parsed: null,
      pattern: null
    };
    if (cellType === 'formula' && info.formula) {
      const parsed = parser.parse(info.formula);
      descriptor.parsed = parsed;
      descriptor.pattern = pattern.buildPattern(parsed, info.row, info.col);
    }
    return descriptor;
  }

  function isFormula(desc) {
    return Boolean(desc && desc.present && desc.cellType === 'formula' && desc.pattern && desc.pattern.sigTokens.length);
  }

  function sigOf(desc) {
    return isFormula(desc) ? desc.pattern.sigTokens : null;
  }

  function samePair(a, b) {
    return isFormula(a) && isFormula(b)
      && Boolean(a.pattern.signature)
      && tokensIdentical(a.pattern.sigTokens, b.pattern.sigTokens);
  }

  function tokensIdentical(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].key !== b[i].key) return false;
      if (a[i].kind === 'N' && a[i].value !== b[i].value) return false;
    }
    return true;
  }

  function candidate(ruleId, direction, evidence, constants, confidence, extra) {
    const meta = RULES[ruleId] || { severity: SEVERITY.HARDCODE_NOTICE, priority: 99 };
    return {
      ruleId,
      severity: (extra && extra.severity) || meta.severity,
      direction: direction || null,
      evidence: evidence.slice(),
      constants: (constants || []).slice(),
      constantDetails: (extra && extra.constantDetails) || null,
      confidenceScore: confidence
    };
  }

  // A small local adjustment (a few cents, or +/- 1..5) is a rounding / plug
  // override. Amount must never be discounted just because it is small.
  const PLUG_ABS_MAX = 5;

  function isPlugLike(value) {
    return Number.isFinite(value) && value !== 0 && Math.abs(value) <= PLUG_ABS_MAX;
  }

  function describeValues(values) {
    return values.map((v) => (v > 0 ? `+${v}` : `${v}`)).join('、');
  }

  // Role + anomaly flag for every numeric literal, relative to a reference
  // neighbour pattern: shared constants are not anomalous, local overrides are.
  // Positions listed in extraPositions are literal additions (plugs) even when
  // the value is 0 / 1 / -1.
  function signedValue(tokens, index) {
    const token = tokens[index];
    const prev = tokens[index - 1];
    const sign = prev && prev.kind === 'OP' && prev.key === 'OP[-]' ? -1 : 1;
    return sign * token.value;
  }

  function buildConstantDetails(currentTokens, refTokens, extraPositions) {
    const extras = new Set(extraPositions || []);
    const details = [];
    currentTokens.forEach((token, index) => {
      if (token.kind === 'NC') { details.push({ value: token.value, role: token.role || 'CONTROL_ARGUMENT', anomalous: false }); return; }
      if (token.kind !== 'N') return;
      const value = signedValue(currentTokens, index);
      if (extras.has(index)) {
        details.push({ value, role: isPlugLike(value) ? 'ROUNDING_PLUG' : 'LOCAL_OVERRIDE', anomalous: true });
        return;
      }
      if (token.plug) { details.push({ value, role: 'ROUNDING_PLUG', anomalous: true }); return; }
      if (!token.business) { details.push({ value, role: token.role || 'LOGICAL_CONSTANT', anomalous: false }); return; }
      const ref = refTokens && refTokens[index];
      const shared = ref && ref.kind === 'N' && ref.value === token.value;
      if (shared) { details.push({ value, role: 'SHARED_BUSINESS_CONSTANT', anomalous: false }); return; }
      details.push({ value, role: isPlugLike(value) ? 'ROUNDING_PLUG' : 'LOCAL_OVERRIDE', anomalous: true });
    });
    return details;
  }

  function decimalPlaces(value) {
    if (!Number.isFinite(value)) return 0;
    const text = Math.abs(value).toString();
    if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) return 2;
    const dot = text.indexOf('.');
    return dot === -1 ? 0 : text.length - dot - 1;
  }

  function classifyNotice(value, percent, mathOp) {
    if (percent) return 'HC202';
    const multiplicative = mathOp === '*' || mathOp === '/';
    if (multiplicative && PERIOD_VALUES.has(value)) return 'HC203';
    if (multiplicative && UNIT_VALUES.has(value)) return 'HC204';
    if (Number.isFinite(value) && value > 0 && value < 10 && decimalPlaces(value) >= 2) return 'HC202';
    return 'HC201';
  }

  function businessTokens(sigTokens) {
    return sigTokens.filter((token) => pattern.isBusinessToken(token));
  }

  function dominantPattern(ctx) {
    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    const formulas = [h.left2, h.left1, h.right1, h.right2, v.up2, v.up1, v.down1, v.down2].filter(isFormula);
    const counts = new Map();
    formulas.forEach((d) => counts.set(d.pattern.signature, (counts.get(d.pattern.signature) || 0) + 1));
    let signature = null;
    let count = 0;
    counts.forEach((c, s) => { if (c > count) { count = c; signature = s; } });
    return { signature, count, total: formulas.length };
  }

  // A business "rate" (percent, sub-unit ratio, or >= 2 decimals) is worth a
  // repeated-hardcode notice; a plain additive integer offset is structural.
  function isBusinessRate(value, percent) {
    if (percent) return true;
    if (!Number.isFinite(value)) return false;
    if (value > 0 && value < 1) return true;
    return decimalPlaces(value) >= 2;
  }

  function neighborDescriptors(ctx, count) {
    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    const all = [h.left2, h.left1, h.right1, h.right2, v.up2, v.up1, v.down1, v.down2];
    return count === 4 ? [h.left1, h.right1, v.up1, v.down1] : all;
  }

  // Any neighbour formula that is structurally and numerically identical.
  function hasIdenticalNeighbor(ctx) {
    return neighborDescriptors(ctx, 8).some((d) => isFormula(d) && tokensIdentical(d.pattern.sigTokens, ctx.pattern.sigTokens));
  }

  // True when an adjacent formula references this cell: then it is an input,
  // not a hardcoded override.
  function isReferencedByNeighbors(ctx) {
    return neighborDescriptors(ctx, 8).some((d) => {
      if (!isFormula(d) || !d.parsed || !Array.isArray(d.parsed.references)) return false;
      return d.parsed.references.some((ref) => ref && ref.col === ctx.col && ref.row === ctx.row);
    });
  }
  // A consistent immediate pair whose structure differs from the current cell
  // (regime / alternating boundary) or whose business constant varies.
  function immediatePairConflict(ctx, currentTokens) {
    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    const pairs = [[h.left1, h.right1], [v.up1, v.down1]];
    for (let p = 0; p < pairs.length; p += 1) {
      const a = pairs[p][0];
      const b = pairs[p][1];
      if (!isFormula(a) || !isFormula(b)) continue;
      if (a.pattern.signature !== b.pattern.signature) continue;
      if (a.pattern.signature !== ctx.pattern.signature) return true;
      if (pattern.businessConstantMismatch(a.pattern.sigTokens, currentTokens)) return true;
    }
    return false;
  }

  // The same structural deviation repeating orthogonally means the whole
  // row/column uses that alternate pattern -> not an isolated anomaly.
  function perpendicularRecurrence(ctx, currentTokens) {
    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    return [v.up1, v.down1, h.left1, h.right1].some((d) => isFormula(d) && tokensIdentical(d.pattern.sigTokens, currentTokens));
  }

  function collectFormulaRules(ctx, out) {
    const parsed = ctx.parsed;
    if (!parsed || !parsed.ok) return;
    if (parsed.hasArrayConstant) return; // HC907 - unsupported in v1

    const current = ctx.pattern.sigTokens;
    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    const business = businessTokens(current);

    const hSame = samePair(h.left1, h.right1);
    const vSame = samePair(v.up1, v.down1);

    // Reference neighbour: a crossing pair first, else a consistent side run.
    let refTokens = null;
    let direction = null;
    let crossing = false;
    if (hSame) { refTokens = sigOf(h.left1); direction = 'horizontal'; crossing = true; }
    else if (vSame) { refTokens = sigOf(v.up1); direction = 'vertical'; crossing = true; }
    else {
      const sides = [
        { a: h.left1, b: h.left2, dir: 'horizontal' },
        { a: h.right1, b: h.right2, dir: 'horizontal' },
        { a: v.up1, b: v.up2, dir: 'vertical' },
        { a: v.down1, b: v.down2, dir: 'vertical' }
      ];
      const run = sides.find((s) => samePair(s.a, s.b));
      if (run) { refTokens = sigOf(run.a); direction = run.dir; }
    }

    const recurring = perpendicularRecurrence(ctx, current);
    let matchedHigh = false;

    if (refTokens) {
      const pos = pattern.referenceReplacedByConstant(refTokens, current);
      if (pos !== -1) {
        matchedHigh = true;
        out.push(candidate('HC002', direction, [
          crossing ? '左右/上下相邻单元格属于同一公式模式' : '单侧相邻公式显示同类模式',
          `当前公式该位置本应引用单元格，却写成了固定值 ${current[pos].value}`
        ], [current[pos].value], crossing ? 88 : 80, { constantDetails: buildConstantDetails(current, refTokens) }));
      } else {
        const extra = pattern.extraConstantAdded(refTokens, current);
        if (extra.added) {
          matchedHigh = true;
          const details = buildConstantDetails(current, refTokens, extra.positions);
          const strong = crossing && !recurring;
          const plug = extra.values.every(isPlugLike);
          if (plug) {
            out.push(candidate('HC006', direction, [
              '相邻同类公式没有该调整值',
              `当前公式额外加入 ${describeValues(extra.values)}（疑似人工尾差 / 勾稽调整）`,
              strong ? '左右/上下同类公式高度一致' : '单侧相邻公式显示同类模式'
            ], extra.values, strong ? 90 : 66, {
              severity: strong ? 'HIGH' : 'SUSPICIOUS',
              constantDetails: details
            }));
          } else {
            out.push(candidate('HC003', direction, [
              crossing ? '左右/上下相邻单元格属于同一公式模式' : '单侧相邻公式显示同类模式',
              `当前公式额外包含固定值 ${extra.values.join('、')}`,
              '该固定值未出现在相邻公式中'
            ], extra.values, strong ? 90 : 74, {
              severity: strong ? 'HIGH' : 'SUSPICIOUS',
              constantDetails: details
            }));
          }
        }
      }
    }

    // Rounding plug without sibling evidence: a small additive constant attached
    // to a rounded result (e.g. ROUND(x/1000,0)-1, ROUND(x,2)+0.01) is still a
    // manual-review item. Never discounted just because the amount is small.
    if (!matchedHigh) {
      const plugIndexes = [];
      current.forEach((token, index) => { if (token.kind === 'N' && token.plug) plugIndexes.push(index); });
      if (plugIndexes.length) {
        const values = plugIndexes.map((index) => signedValue(current, index));
        out.push(candidate('HC006', null, [
          `公式在 ROUND 主体之外额外加入 ${describeValues(values)}`,
          '疑似人工尾差 / 勾稽调整，建议核对原始凭证与勾稽关系'
        ], values, 62, {
          severity: SEVERITY.SUSPICIOUS,
          constantDetails: buildConstantDetails(current, null, plugIndexes)
        }));
      }
    }

    if (!matchedHigh && crossing) {
      const baseTokens = refTokens;
      const baseSig = direction === 'horizontal' ? h.left1.pattern.signature : v.up1.pattern.signature;
      const dominant = dominantPattern(ctx);
      const dominantOk = dominant.count >= 3 && dominant.total > 0
        && dominant.count / dominant.total >= 0.6 && dominant.signature === baseSig;
      if (!pattern.keysEqual(baseTokens, current) && business.length && dominantOk) {
        matchedHigh = true;
        out.push(candidate('HC005', direction, [
          '周围存在占主导的稳定公式模式',
          '当前公式结构与相邻公式不一致且包含固定值',
          `固定值 ${business.map((t) => t.value).join('、')}`
        ], business.map((t) => t.value), 82, { constantDetails: buildConstantDetails(current, baseTokens) }));
      }
    }

    if (crossing) {
      const lists = hSame ? [sigOf(h.left1), sigOf(h.right1)] : [sigOf(v.up1), sigOf(v.down1)];
      const pos = pattern.differingConstantPosition(lists, current);
      if (pos !== -1) {
        out.push(candidate('HC102', direction, [
          '相邻单元格使用相同的公式结构',
          `当前固定参数为 ${current[pos].value}，与相邻公式不一致`
        ], [current[pos].value], 68));
      }
    }

    // A formula that repeats its own structure+constants nearby is systematic:
    // business rates become HC205; plain structural constants stay silent.
    const systematic = hasIdenticalNeighbor(ctx);
    const suppressed = immediatePairConflict(ctx, current);

    current.forEach((token) => {
      if (!pattern.isBusinessToken(token)) return;
      if (token.plug) return; // reported as HC006 ROUNDING_PLUG above
      if (systematic) {
        if (isBusinessRate(token.value, token.percent)) {
          out.push(candidate('HC205', null, [
            `固定值 ${token.value} 在多个同类公式中重复出现`,
            '未引用统一参数单元格'
          ], [token.value], 45));
        }
        return;
      }
      if (suppressed) return;
      const ruleId = classifyNotice(token.value, token.percent, token.mathOp);
      out.push(candidate(ruleId, null, [
        `公式直接使用固定数值 ${token.value}${token.percent ? '%' : ''} 参与计算`
      ], [token.value], 35));
    });
  }

  function collectConstantCellRules(ctx, out) {
    // A value referenced by an adjacent formula is an input, not an override.
    if (isReferencedByNeighbors(ctx)) return;

    const h = ctx.horizontal || {};
    const v = ctx.vertical || {};
    const region = ctx.region || {};
    const dense = region.effectiveCells >= 5 && region.formulaRatio >= 0.7;
    const zero = ctx.value === 0;

    const crossingH = samePair(h.left1, h.right1);
    const crossingV = samePair(v.up1, v.down1);

    if (crossingH && crossingV) {
      out.push(candidate('HC001', 'horizontal', [
        `当前单元格为固定值 ${ctx.value}`,
        '上下左右均为同一公式模式',
        '当前单元格打断连续公式序列'
      ], [ctx.value], 92));
      return;
    }
    if (crossingH || crossingV) {
      // A crossing run in a dense region is a suspicious isolated value. It is
      // suppressed when the perpendicular axis is a plain data / input line, so
      // normal data columns are not mistaken for hardcodes.
      const perpendicularRun = crossingH ? [v.up1, v.down1] : [h.left1, h.right1];
      const perpendicularIsData = perpendicularRun.every((d) => d && d.present && d.cellType !== 'formula');
      if (!zero && dense && !perpendicularIsData) {
        out.push(candidate('HC101', null, [
          `当前单元格为固定值 ${ctx.value}`,
          '位于高度一致的公式区域中',
          '公式密集区域中的孤立数值'
        ], [ctx.value], 60));
      } else if (!dense || zero) {
        out.push(candidate('HC001', crossingH ? 'horizontal' : 'vertical', [
          `当前单元格为固定值 ${ctx.value}`,
          crossingH ? '左右单元格属于同一公式模式' : '上下单元格属于同一公式模式',
          '当前单元格打断连续公式序列'
        ], [ctx.value], 90));
      }
      return;
    }

    // A fixed value is only a sequence break if a run of identical formulas
    // actually crosses it. Density alone never triggers; a value at the edge of
    // an input / result / FX / historical column next to formula columns is not
    // a break. Zero is a balance, not a plug, and is never reported here.
    //
    // Single-side evidence is only accepted when the formula run PRECEDES the
    // value (left/up). A value followed by formula columns is the classic
    // "data/result column next to formula columns" case and is not reported.
    if (zero) return;
    const leftRun = samePair(h.left1, h.left2);
    const upRun = samePair(v.up1, v.up2);
    if (!leftRun && !upRun) return;

    const horizontalRun = leftRun && !upRun;
    if (horizontalRun) {
      // A value to the right of a horizontal formula run is only a genuine break
      // when its own column is part of a formula region; otherwise it is a normal
      // data / result column sitting beside formula columns.
      const columnHasFormula = [v.up2, v.up1, v.down1, v.down2].some(isFormula);
      if (!columnHasFormula) return;
    } else {
      const perpendicular = [h.left1, h.right1];
      const perpendicularIsData = perpendicular.every((d) => d && d.present && d.cellType !== 'formula');
      if (perpendicularIsData) return;
    }

    out.push(candidate('HC103', horizontalRun ? 'horizontal' : 'vertical', [
      `当前单元格为固定值 ${ctx.value}`,
      '前列/上方存在连续公式模式',
      '该固定值可能替代了本应继续的公式'
    ], [ctx.value], 55));
  }

  function pickIssue(ctx, candidates) {
    const visible = candidates.filter((c) => c.severity !== SEVERITY.IGNORE);
    if (!visible.length) return null;
    visible.sort((a, b) => {
      const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (rank !== 0) return rank;
      return RULES[a.ruleId].priority - RULES[b.ruleId].priority;
    });
    const primary = visible[0];
    const matchedRules = [...new Set(visible.map((c) => c.ruleId))];
    const evidence = [...new Set(visible.flatMap((c) => c.evidence))];
    const constants = [...new Set(visible.flatMap((c) => c.constants))];
    const constantDetails = primary.constantDetails
      || visible.map((c) => c.constantDetails).find(Boolean)
      || null;

    let confidence = primary.confidenceScore || 0;
    const hasH = matchedRules.some((r) => ['HC001', 'HC002', 'HC003', 'HC005', 'HC006'].includes(r));
    const bothAxes = (samePair((ctx.horizontal || {}).left1, (ctx.horizontal || {}).right1))
      && (samePair((ctx.vertical || {}).up1, (ctx.vertical || {}).down1));
    if (hasH && bothAxes) {
      matchedRules.push('HC004');
      confidence = Math.min(100, confidence + 4);
    }

    return {
      id: `${ctx.sheetName}!${ctx.cellAddress}-${primary.ruleId}`,
      ruleId: primary.ruleId,
      matchedRules,
      severity: primary.severity,
      sheetName: ctx.sheetName,
      cellAddress: ctx.cellAddress,
      excelAddress: ctx.excelAddress || buildExcelAddress(ctx.sheetName, ctx.cellAddress),
      cellType: ctx.cellType,
      value: ctx.value,
      formula: ctx.formula || null,
      constants,
      constantDetails,
      direction: primary.direction,
      evidence,
      suggestion: RULES[primary.ruleId].suggestion,
      confidenceScore: Math.max(0, Math.min(100, confidence))
    };
  }

  function evaluate(ctx) {
    const candidates = [];
    if (ctx.cellType === 'formula') collectFormulaRules(ctx, candidates);
    else if (ctx.cellType === 'number') collectConstantCellRules(ctx, candidates);
    if (!candidates.length) return null;
    return pickIssue(ctx, candidates);
  }

  return {
    SEVERITY,
    SEVERITY_RANK,
    RULES,
    evaluate,
    buildCellDescriptor,
    buildExcelAddress,
    classifyNotice
  };
});

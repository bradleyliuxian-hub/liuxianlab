'use strict';

/*
 * Liuxian Lab — Excel 尾差检查: risk model (pure helpers).
 *
 * Turns raw multi-decimal "facts" into a risk level + an explainable reason.
 * The model is deterministic and explainable; it does NOT use fake
 * confidence scores. Reference analysis is DIRECT-only (see reference-map.js);
 * multi-level propagation is out of scope, so wording stays honest.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalRiskCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RISK = { HIGH: '高', MEDIUM: '中', LOW: '低', WATCH: '观察' };
  const RISK_ORDER = { '高': 0, '中': 1, '低': 2, '观察': 3 };
  const RISK_LABEL = { '高': '高风险', '中': '中风险', '低': '低风险', '观察': '单独观察' };

  const CATEGORY = {
    RAW: 'raw',
    FORMULA: 'formula',
    UNKNOWN: 'unknown',
    HIDDEN: 'hidden',
    PERCENTAGE: 'percentage',
    EXCHANGE_RATE: 'exchange_rate'
  };

  const CATEGORY_LABEL = {
    raw: '普通数值问题',
    formula: '公式结果问题',
    unknown: '公式不可判定',
    hidden: '隐藏区域检查',
    percentage: '百分比检查',
    exchange_rate: '汇率检查'
  };

  const CATEGORY_SHEET = {
    raw: '普通数值问题',
    formula: '公式结果问题',
    unknown: '公式不可判定',
    hidden: '隐藏区域检查',
    percentage: '百分比检查',
    exchange_rate: '汇率检查'
  };

  const HIGH_RISK_SHEET = '高风险尾差';

  const HIDDEN_LABEL = {
    none: '可见',
    row: '隐藏行',
    column: '隐藏列',
    sheet: '隐藏工作表',
    veryHidden: '深度隐藏工作表',
    'row+column': '隐藏行+隐藏列'
  };

  function isPercentageFormat(format) {
    if (format == null) return false;
    const text = String(format);
    if (!text || text.indexOf('%') === -1) return false;
    let inQuote = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') { i += 1; continue; } // escaped literal — skip next char
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (!inQuote && ch === '%') return true;
    }
    return false;
  }

  /*
   * Resolve a single hidden-type token for a cell. Sheet-level hiding wins
   * (a hidden sheet hides everything in it); otherwise row and column combine.
   */
  function hiddenTypeFor(rowHidden, colHidden, sheetHidden, veryHidden) {
    if (sheetHidden) return veryHidden ? 'veryHidden' : 'sheet';
    if (rowHidden && colHidden) return 'row+column';
    if (rowHidden) return 'row';
    if (colHidden) return 'column';
    return 'none';
  }

  function riskRank(level) {
    return RISK_ORDER[level] == null ? 9 : RISK_ORDER[level];
  }

  function yesNo(value) {
    return value ? '是' : '否';
  }

  function propagationText(refs, down, hasCycle) {
    let text = `被 ${refs} 个公式直接引用`;
    if (down > 0) text += `，可进一步影响 ${down} 个下游计算节点`;
    text += '。';
    if (hasCycle) text += '发现循环引用关系，请人工核对。';
    return text;
  }

  /*
   * facts: {
   *   category: 'raw'|'formula'|'unknown'|'hidden'|'percentage',
   *   visible: boolean,               // cell is NOT in a hidden row/col/sheet
   *   isFormula: boolean,
   *   directReferenceCount: number,
   *   downstreamReferenceCount: number,
   *   referrersVisible: boolean,       // at least one direct referrer is visible
   *   hasCircularDependency: boolean
   * }
   * Returns { level, reason }.
   */
  function computeRisk(facts) {
    const f = facts || {};
    const refs = Number(f.directReferenceCount || 0);
    const down = Number(f.downstreamReferenceCount || 0);
    const category = f.category;

    if (category === CATEGORY.UNKNOWN) {
      return {
        level: RISK.MEDIUM,
        reason: '公式存在，但缺少可读取的缓存计算结果，无法判定是否产生尾差' +
          (refs > 0 ? '；' + propagationText(refs, down, f.hasCircularDependency) : '')
      };
    }

    if (category === CATEGORY.PERCENTAGE) {
      if (refs === 0) {
        return { level: RISK.WATCH, reason: '百分比格式单元格保留高精度，可能是业务需要，暂单独观察' };
      }
      if (f.referrersVisible) {
        return { level: RISK.HIGH, reason: '该百分比格式单元格' + propagationText(refs, down, f.hasCircularDependency) + '可能影响最终展示结果。' };
      }
      return { level: RISK.MEDIUM, reason: '该百分比格式单元格' + propagationText(refs, down, f.hasCircularDependency) + '传播路径待人工确认。' };
    }

    // raw / formula / hidden
    if (f.visible) {
      const lead = f.derivedFromRate
        ? '由已识别汇率计算产生的结果存在尾差，'
        : (f.isFormula ? '可见公式结果存在尾差，' : '可见单元格存在多位小数，');
      if (refs > 0) {
        return {
          level: RISK.HIGH,
          reason: lead + propagationText(refs, down, f.hasCircularDependency) + '可能继续向最终展示结果传播。'
        };
      }
      return {
        level: RISK.HIGH,
        reason: f.isFormula
          ? lead + '未被其他公式引用，可能直接作为最终展示结果'
          : '可见单元格的多位小数未被引用，可能是最终展示结果'
      };
    }

    // hidden
    if (refs === 0) {
      return { level: RISK.LOW, reason: '隐藏区域的多位小数当前未被任何公式引用' };
    }
    if (f.referrersVisible) {
      return { level: RISK.HIGH, reason: '隐藏区域的多位小数' + propagationText(refs, down, f.hasCircularDependency) + '可能影响最终展示结果。' };
    }
    return { level: RISK.MEDIUM, reason: '隐藏区域的多位小数' + propagationText(refs, down, f.hasCircularDependency) + '传播路径待人工确认。' };
  }

  /*
   * Risk for an exchange-rate precision problem. Exchange rates are allowed 4
   * decimals; suspected rates are NOT exempted (judged against 2) and stay in
   * 单独观察 for human confirmation.
   */
  function computeExchangeRateRisk(facts) {
    const f = facts || {};
    const refs = Number(f.directReferenceCount || 0);
    const down = Number(f.downstreamReferenceCount || 0);
    const decimals = f.decimals == null ? '>15' : f.decimals;
    if (f.suspected) {
      return {
        level: RISK.WATCH,
        reason: `疑似汇率，请人工确认业务类型；有效小数位 ${decimals} 超出常规 2 位，未按汇率豁免。`
      };
    }
    if (refs > 0) {
      return {
        level: RISK.HIGH,
        reason: `汇率精度超出允许的 4 位（实际 ${decimals} 位），且被 ${refs} 个公式直接引用，可影响 ${down} 个下游计算节点。`
      };
    }
    return { level: RISK.MEDIUM, reason: `汇率精度超出允许的 4 位（实际 ${decimals} 位）。` };
  }

  /*
   * Human-facing handling suggestion. Only ever points at *what to check* —
   * never at a concrete replacement value.
   */
  function suggestionFor(category, facts) {
    const f = facts || {};
    switch (category) {
      case CATEGORY.UNKNOWN:
        return '请在 Excel / WPS 中重新计算并保存工作簿后再次检查。';
      case CATEGORY.PERCENTAGE:
        return '百分比保留高精度可能是业务需要，请结合下游计算判断是否需要调整。';
      case CATEGORY.HIDDEN:
        return f.directReferenceCount > 0
          ? '该隐藏值参与下游计算，请人工核对其对最终结果的影响。'
          : '隐藏区域问题优先级较低，可人工确认为何隐藏以及是否会被使用。';
      case CATEGORY.EXCHANGE_RATE:
        return f.suspected
          ? '疑似汇率但上下文不足，请人工确认业务类型后再判断精度是否合理。'
          : '汇率通常保留 4 位小数，请人工确认该汇率的业务精度要求。';
      case CATEGORY.FORMULA:
        return '建议人工检查该公式的业务含义及最终输出节点，确认尾差是否需要处理。';
      default:
        return f.visible
          ? '建议人工核对该单元格及其下游公式，确认最终展示结果是否需要两位小数。'
          : '优先级较低，可人工确认是否影响最终展示结果。';
    }
  }

  function strcmp(a, b) {
    const x = String(a == null ? '' : a);
    const y = String(b == null ? '' : b);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  const byRisk = (a, b) => riskRank(a.riskLevel) - riskRank(b.riskLevel);
  const byDownstream = (a, b) => num(b.downstreamReferenceCount) - num(a.downstreamReferenceCount);
  const byDirect = (a, b) => num(b.directReferenceCount) - num(a.directReferenceCount);
  const bySheet = (a, b) => strcmp(a.sheetName, b.sheetName) || (num(a.row) - num(b.row)) || (num(a.col) - num(b.col));

  /*
   * Independent comparator chains so the view layer can switch sort mode
   * without re-implementing ordering. `risk` (default) keeps risk first and
   * breaks ties by downstream reach, then direct references.
   */
  const SORT_MODES = {
    risk: [byRisk, byDownstream, byDirect, bySheet],
    downstream: [byDownstream, byRisk, byDirect, bySheet],
    directReferences: [byDirect, byRisk, byDownstream, bySheet],
    sheet: [bySheet, byDownstream, byDirect]
  };

  function compareIssues(a, b, mode) {
    const chain = SORT_MODES[mode] || SORT_MODES.risk;
    for (let i = 0; i < chain.length; i += 1) {
      const result = chain[i](a, b);
      if (result) return result;
    }
    return 0;
  }

  function sortIssues(list, mode) {
    return (Array.isArray(list) ? list.slice() : []).sort((a, b) => compareIssues(a, b, mode));
  }

  return {
    RISK,
    RISK_ORDER,
    RISK_LABEL,
    CATEGORY,
    CATEGORY_LABEL,
    CATEGORY_SHEET,
    HIGH_RISK_SHEET,
    HIDDEN_LABEL,
    SORT_MODES,
    isPercentageFormat,
    hiddenTypeFor,
    riskRank,
    yesNo,
    computeRisk,
    computeExchangeRateRisk,
    suggestionFor,
    compareIssues,
    sortIssues
  };
});

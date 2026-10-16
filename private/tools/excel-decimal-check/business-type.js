'use strict';

/*
 * Liuxian Lab — Excel 尾差检查: business-type detection (pure helpers).
 *
 * Decides whether a numeric cell is a normal number, an exchange rate, a
 * suspected exchange rate, or a percentage — and how many decimals it is
 * allowed to keep. Exchange-rate detection is CONTEXT based (titles, currency
 * pairs, named ranges, referenced-source titles), never based on the value
 * range or the number of decimals.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalBusinessType = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BUSINESS_TYPE = {
    NORMAL_NUMBER: 'normal_number',
    PERCENTAGE: 'percentage',
    EXCHANGE_RATE: 'exchange_rate',
    EXCHANGE_RATE_DERIVED: 'exchange_rate_derived',
    SUSPECTED_EXCHANGE_RATE: 'suspected_exchange_rate'
  };

  const BUSINESS_TYPE_LABEL = {
    normal_number: '普通数值',
    percentage: '百分比',
    exchange_rate: '汇率',
    exchange_rate_derived: '汇率派生计算',
    suspected_exchange_rate: '疑似汇率'
  };

  const ALLOWED_DECIMALS = {
    normal_number: 2,
    percentage: null,          // percentage is analysed separately
    exchange_rate: 4,
    exchange_rate_derived: 2,  // no free 4-decimal allowance
    suspected_exchange_rate: 2 // NOT exempted — flagged for human confirmation
  };

  const CURRENCIES = 'USD|CNY|RMB|EUR|HKD|JPY|GBP|AUD|CAD|CHF|SGD|KRW|TWD|THB|NZD|MOP|BRL|INR|RUB';

  const RATE_KEYWORD_RE = /(汇率|兑换率|汇价|exchange\s*rate|fx\s*rate|forex\s*rate|currency\s*rate)/i;
  const CURRENCY_PAIR_RE = new RegExp('\\b(?:' + CURRENCIES + ')\\s*[\\/\\-_]\\s*(?:' + CURRENCIES + ')\\b', 'i');
  const CURRENCY_TOKEN_RE = new RegExp('\\b(?:' + CURRENCIES + ')\\b', 'i');
  const RATE_NAME_RE = /(exchange[_ ]?rate|fx[_ ]?rate|currency[_ ]?rate|forex[_ ]?rate|[A-Za-z]{3}[_\-][A-Za-z]{3}(?:[_\-]rate)?)/i;

  function rateTextMatch(text) {
    if (text == null) return null;
    const value = String(text);
    if (!value) return null;
    if (RATE_KEYWORD_RE.test(value)) return { kind: 'keyword', detail: value };
    const pair = CURRENCY_PAIR_RE.exec(value);
    if (pair) return { kind: 'pair', detail: pair[0] };
    return null;
  }

  function currencyToken(text) {
    if (text == null) return null;
    const m = CURRENCY_TOKEN_RE.exec(String(text));
    return m ? m[0] : null;
  }

  function isRateName(name) {
    return RATE_NAME_RE.test(String(name == null ? '' : name));
  }

  function firstRateName(names) {
    for (let i = 0; i < names.length; i += 1) {
      if (isRateName(names[i])) return names[i];
    }
    return null;
  }

  /*
   * evidence: {
   *   labels:            [{ value, source }]  // nearby row / column titles
   *   names:             [string]             // workbook defined names on this cell
   *   referencedLabels:  [{ value, source }]  // titles of referenced source cells
   * }
   * Returns { businessType, confidence: 'high'|'low', reason }.
   */
  function classify(evidence) {
    const labels = (evidence && evidence.labels) || [];
    const names = (evidence && evidence.names) || [];
    const referencedLabels = (evidence && evidence.referencedLabels) || [];

    // 1. Strong: nearby / same-row / same-column title contains rate semantics.
    for (let i = 0; i < labels.length; i += 1) {
      const match = rateTextMatch(labels[i].value);
      if (match) {
        const reason = match.kind === 'pair'
          ? `${labels[i].source}标题包含币种对 ${match.detail}`
          : `${labels[i].source}标题包含汇率字样：“${match.detail}”`;
        return { businessType: BUSINESS_TYPE.EXCHANGE_RATE, confidence: 'high', reason };
      }
    }

    // 2. Strong: Excel named range clearly names a rate.
    const name = firstRateName(names);
    if (name) {
      return { businessType: BUSINESS_TYPE.EXCHANGE_RATE, confidence: 'high', reason: `命名范围「${name}」表明为汇率` };
    }

    // 3. Strong: a referenced source cell's title is a rate.
    for (let i = 0; i < referencedLabels.length; i += 1) {
      const match = rateTextMatch(referencedLabels[i].value);
      if (match) {
        const reason = match.kind === 'pair'
          ? `${referencedLabels[i].source}标题包含币种对 ${match.detail}`
          : `${referencedLabels[i].source}标题包含汇率字样：“${match.detail}”`;
        return { businessType: BUSINESS_TYPE.EXCHANGE_RATE, confidence: 'high', reason };
      }
    }

    // 4. Weak: a currency code appears nearby — do NOT exempt, flag for review.
    const weakTexts = labels.concat(referencedLabels);
    for (let i = 0; i < weakTexts.length; i += 1) {
      const token = currencyToken(weakTexts[i].value);
      if (token) {
        return {
          businessType: BUSINESS_TYPE.SUSPECTED_EXCHANGE_RATE,
          confidence: 'low',
          reason: `${weakTexts[i].source}出现币种代码 ${token}，疑似汇率，请人工确认业务类型`
        };
      }
    }
    for (let i = 0; i < names.length; i += 1) {
      const token = currencyToken(names[i]);
      if (token) {
        return {
          businessType: BUSINESS_TYPE.SUSPECTED_EXCHANGE_RATE,
          confidence: 'low',
          reason: `命名范围「${names[i]}」含币种代码 ${token}，疑似汇率，请人工确认业务类型`
        };
      }
    }

    return { businessType: BUSINESS_TYPE.NORMAL_NUMBER, confidence: 'high', reason: '' };
  }

  function allowedDecimalsFor(businessType) {
    const value = ALLOWED_DECIMALS[businessType];
    return value === undefined ? ALLOWED_DECIMALS.normal_number : value;
  }

  function isExchangeLike(businessType) {
    return businessType === BUSINESS_TYPE.EXCHANGE_RATE || businessType === BUSINESS_TYPE.SUSPECTED_EXCHANGE_RATE;
  }

  /*
   * A "pure reference" formula is one whose body is exactly a single cell
   * reference (bare / $ / sheet-qualified) or a single named range — no
   * operators, no functions, no parentheses. `=B2`, `=$B$2`, `='FX'!$B$2`,
   * `=USD_CNY_RATE`. `=B2+0`, `=B2*1`, `=ROUND(B2,4)`, `=ABS(B2)`, `=(B2)` are
   * NOT pure (they were computed).
   *
   * Returns { kind:'cell', sheet, address } | { kind:'name', name } | null.
   */
  const PURE_CELL_RE = /^(?:('(?:[^']|'')+'|[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7})$/;
  const PURE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

  function pureReference(formula) {
    const body = String(formula == null ? '' : formula).replace(/^=/, '').trim();
    if (!body) return null;
    const ref = PURE_CELL_RE.exec(body);
    if (ref) {
      let sheet = ref[1] || null;
      if (sheet && sheet.charAt(0) === "'") sheet = sheet.slice(1, -1).replace(/''/g, "'");
      return { kind: 'cell', sheet, address: ref[2].replace(/\$/g, '').toUpperCase() };
    }
    if (PURE_NAME_RE.test(body)) return { kind: 'name', name: body };
    return null;
  }

  function isPureReferenceFormula(formula) {
    return pureReference(formula) != null;
  }

  return {
    BUSINESS_TYPE,
    BUSINESS_TYPE_LABEL,
    ALLOWED_DECIMALS,
    rateTextMatch,
    currencyToken,
    isRateName,
    classify,
    allowedDecimalsFor,
    isExchangeLike,
    pureReference,
    isPureReferenceFormula
  };
});

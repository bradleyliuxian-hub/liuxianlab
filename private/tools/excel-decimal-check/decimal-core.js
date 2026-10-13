'use strict';

/*
 * Liuxian Lab — Excel decimal check core.
 *
 * Pure, dependency-free helpers shared by the browser tool and the
 * Node test-suite. No DOM and no XLSX dependency lives here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalCheckCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_DECIMALS = 15;

  /*
   * Number of *effective* decimal places of a real numeric value.
   *
   * Trailing zeros never count: 10.120 is the same value as 10.12.
   * Binary floating point noise never creates a false positive:
   * 0.1 + 0.2 (= 0.30000000000000004) is treated as 0.3.
   *
   * Returns 0..15, or null when it cannot be resolved within 15 places
   * (which callers treat as "more than two decimals").
   */
  function effectiveDecimalPlaces(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return 0;

    const abs = Math.abs(value);
    for (let d = 0; d <= MAX_DECIMALS; d += 1) {
      const scaled = abs * Math.pow(10, d);
      if (!Number.isFinite(scaled)) break;
      const rounded = Math.round(scaled);
      const tolerance = Math.max(Number.EPSILON * Math.abs(scaled) * 4, 1e-12);
      if (Math.abs(scaled - rounded) <= tolerance) return d;
    }
    return null;
  }

  /*
   * True when the value has more than two effective decimal places.
   * null (undeterminable within 15 places) also counts as "too many".
   */
  function hasMoreThanTwoDecimals(value) {
    const places = effectiveDecimalPlaces(value);
    return places === null || places > 2;
  }

  /*
   * Round a number to two decimals, half away from zero, the way Excel's
   * ROUND behaves. Uses a 15-significant-digit string so binary noise such
   * as 1.005 (stored as 1.00499999999999989) still rounds to 1.01.
   */
  function roundToTwo(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;

    const negative = value < 0;
    const magnitude = Math.abs(value);
    if (magnitude === 0) return 0;

    let scaled;
    if (!Number.isInteger(magnitude) && /e/i.test(magnitude.toPrecision(MAX_DECIMALS))) {
      scaled = Math.round(magnitude * 100);
    } else if (Number.isInteger(magnitude)) {
      return value;
    } else {
      scaled = Math.round(Number(magnitude.toPrecision(MAX_DECIMALS) + 'e2'));
    }

    const result = scaled / 100;
    return negative ? -result : result;
  }

  function stripLeadingEquals(formula) {
    return String(formula == null ? '' : formula).trim().replace(/^=/, '').trim();
  }

  function findMatchingParen(text, openIndex) {
    let depth = 0;
    let inString = false;
    for (let i = openIndex; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (ch === '"') {
          if (text[i + 1] === '"') i += 1;
          else inString = false;
        }
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function splitTopLevelArgs(text) {
    const args = [];
    let depth = 0;
    let inString = false;
    let current = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        current += ch;
        if (ch === '"') {
          if (text[i + 1] === '"') {
            current += text[i + 1];
            i += 1;
          } else {
            inString = false;
          }
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        current += ch;
      } else if (ch === '(') {
        depth += 1;
        current += ch;
      } else if (ch === ')') {
        depth -= 1;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        args.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '' || args.length > 0) args.push(current);
    return args;
  }

  /*
   * True when a formula is already a single top-level ROUND(...) that
   * guarantees at most two decimals, e.g. =ROUND(A1/B1,2) or =ROUND(A1).
   * Used to avoid generating =ROUND((ROUND(A1/B1,2)),2).
   */
  function isAlreadyRoundedFormula(formula) {
    const text = stripLeadingEquals(formula);
    if (!/^ROUND\s*\(/i.test(text)) return false;

    const open = text.indexOf('(');
    const close = findMatchingParen(text, open);
    if (close === -1 || close !== text.length - 1) return false;

    const args = splitTopLevelArgs(text.slice(open + 1, close));
    if (args.length === 1) return true;

    const digits = Number(args[1].trim());
    return Number.isFinite(digits) && Number.isInteger(digits) && digits >= 0 && digits <= 2;
  }

  /*
   * Wrap a formula so its result is rounded to two decimals.
   * SheetJS stores formulas without the leading "="; the returned string
   * follows the same convention.
   */
  function wrapFormulaWithRound(formula) {
    return 'ROUND((' + stripLeadingEquals(formula) + '),2)';
  }

  const CELL_REFERENCE = /^[A-Za-z]{1,3}[0-9]{1,7}$/;
  const SAFE_SHEET_NAME = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*$/;

  function looksLikeCellReference(name) {
    return CELL_REFERENCE.test(name);
  }

  /*
   * Build an Excel "Go To" reference that can be pasted into the F5 / Ctrl+G
   * reference box to jump straight to a cell.
   *
   *   buildExcelGotoReference('Sheet1', 'C18')            -> Sheet1!C18
   *   buildExcelGotoReference('销售明细', 'C18')           -> 销售明细!C18
   *   buildExcelGotoReference('销售明细 10月', 'C18')      -> '销售明细 10月'!C18
   *   buildExcelGotoReference("Brad's Data", 'C18')       -> 'Brad''s Data'!C18
   */
  function buildExcelGotoReference(sheetName, cellAddress) {
    const name = String(sheetName == null ? '' : sheetName);
    const cell = String(cellAddress == null ? '' : cellAddress);
    const needsQuotes = !SAFE_SHEET_NAME.test(name) || looksLikeCellReference(name);
    const escaped = name.replace(/'/g, "''");
    return (needsQuotes ? "'" + escaped + "'" : name) + '!' + cell;
  }

  return {
    MAX_DECIMALS,
    effectiveDecimalPlaces,
    hasMoreThanTwoDecimals,
    roundToTwo,
    isAlreadyRoundedFormula,
    wrapFormulaWithRound,
    buildExcelGotoReference,
    looksLikeCellReference
  };
});

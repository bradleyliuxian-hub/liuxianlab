'use strict';

/*
 * Liuxian Lab — Excel 尾差检查 core (pure helpers).
 *
 * Dependency-free, no DOM, no XLSX. Shared by the browser tool and the
 * Node test-suite.
 *
 * This tool DETECTS ONLY: it never rounds, never rewrites a value and never
 * generates a "corrected" workbook. There is deliberately no auto-fix helper
 * here (no roundToTwo / no formula wrapping).
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

  const CELL_REFERENCE = /^[A-Za-z]{1,3}[0-9]{1,7}$/;
  const SAFE_SHEET_NAME = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_.\u4e00-\u9fff]*$/;

  function looksLikeCellReference(name) {
    return CELL_REFERENCE.test(name);
  }

  /*
   * Parse an A1-style cell address (optionally with absolute $ markers) into
   * zero-based { row, col }. Returns null when unparseable.
   */
  function parseCellAddress(address) {
    const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(address == null ? '' : address).trim());
    if (!match) return null;
    const letters = match[1].toUpperCase();
    let col = 0;
    for (let i = 0; i < letters.length; i += 1) col = col * 26 + (letters.charCodeAt(i) - 64);
    return { row: Number(match[2]) - 1, col: col - 1 };
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
    parseCellAddress,
    buildExcelGotoReference,
    looksLikeCellReference
  };
});

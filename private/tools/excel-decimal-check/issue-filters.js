'use strict';

/*
 * Liuxian Lab — Excel 尾差检查: issue filter engine (pure).
 *
 * filterState fields (all arrays; empty array = do NOT filter that field):
 *   { risks, categories, sheets, hiddenTypes, businessTypes, precisionStatuses }
 *
 * Semantics: WITHIN a field the values are OR; ACROSS fields it is AND.
 * Filtering is independent of sorting — callers filter, then sort.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DecimalIssueFilters = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FIELD_VALUE = {
    risks: (i) => i.riskLevel,
    categories: (i) => i.category,
    sheets: (i) => i.sheetName,
    hiddenTypes: (i) => i.hiddenType,
    businessTypes: (i) => i.businessType,
    precisionStatuses: (i) => i.precisionStatus
  };

  function emptyFilterState() {
    return { risks: [], categories: [], sheets: [], hiddenTypes: [], businessTypes: [], precisionStatuses: [] };
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value.filter((v) => v != null && v !== '') : [];
  }

  function inSet(list, value) {
    return list.length === 0 || list.indexOf(value) !== -1;
  }

  function matchIssue(issue, filterState) {
    if (!issue) return false;
    const f = filterState || emptyFilterState();
    return Object.keys(FIELD_VALUE).every((field) => inSet(normalizeList(f[field]), FIELD_VALUE[field](issue)));
  }

  function applyFilters(issues, filterState) {
    const list = Array.isArray(issues) ? issues : [];
    return list.filter((issue) => matchIssue(issue, filterState));
  }

  function countActive(filterState) {
    const f = filterState || emptyFilterState();
    return Object.keys(FIELD_VALUE).reduce((sum, field) => sum + normalizeList(f[field]).length, 0);
  }

  /*
   * Build distinct options for a field from the actual issues (dynamic; never
   * hard-coded). `order` (optional) fixes a logical order for known values.
   */
  function buildOptions(issues, field, labelOf, order, excludeValues) {
    const valueFn = FIELD_VALUE[field];
    if (!valueFn) return [];
    const exclude = excludeValues || [];
    const map = new Map();
    (Array.isArray(issues) ? issues : []).forEach((issue) => {
      const value = valueFn(issue);
      if (value == null || value === '') return;
      if (exclude.indexOf(value) !== -1) return;
      let entry = map.get(value);
      if (!entry) { entry = { value, label: labelOf ? labelOf(issue) : value, count: 0 }; map.set(value, entry); }
      entry.count += 1;
    });
    const list = [...map.values()];
    if (order && order.length) {
      list.sort((a, b) => {
        const ia = order.indexOf(a.value);
        const ib = order.indexOf(b.value);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
      });
    } else {
      list.sort((a, b) => (a.label < b.label ? -1 : (a.label > b.label ? 1 : 0)));
    }
    return list;
  }

  return {
    FIELD_VALUE,
    emptyFilterState,
    normalizeList,
    matchIssue,
    applyFilters,
    countActive,
    buildOptions
  };
});

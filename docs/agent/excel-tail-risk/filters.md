# excel-tail-risk / filters (多选筛选)

The review page filters are multi-select dropdowns driven by one central
`filterState`:

```
{ risks, categories, sheets, hiddenTypes, businessTypes, precisionStatuses }
```

- **Within a field = OR; across fields = AND.** e.g.
  `risks IN [高,中] AND sheets IN [销售明细,成本表]`.
- **Empty array = do not filter that field** (so "未选择" means 全部, not "0 条").
- Filtering is a separate step from sorting: `allIssues → applyFilters() →
  sortIssues() → renderIssues()`. The default sort stays risk-first, then
  downstream desc, then direct desc.
- **Exports are unaffected by filters** — 「下载问题清单 Excel」always covers the
  full scan result (`state.issues`), never the filtered subset.
- Options are generated dynamically from the actual issues (`buildOptions`), with
  counts; the sheet picker is searchable. `hiddenType` excludes `none`.
- `issue-filters.js` is the pure engine (`applyFilters`, `matchIssue`,
  `emptyFilterState`, `countActive`, `buildOptions`); `script.js` owns the
  reusable `createMultiSelect` DOM component (chips, search, 全选/清空, one
  shared 清空筛选 button). The result count shows `当前 / 总数`.

Read when: changing filtering / result list behaviour.
Authority: `issue-filters.js`, `script.js`, `tests/excel-decimal-check/issue-filters.test.js`.

## Navigation (上一个 / 下一个)

The viewer toolbar's `← 上一个 / 下一个 →` navigates the **filtered + sorted**
list, never `allIssues`:

- `script.js` computes `state.filtered = sortIssues(applyFilters(...))` and calls
  `model.setFilterList(state.filtered)` + `model.reconcile()`.
- The counter shows `当前位次 / 筛选数量` (e.g. `18 / 126`); the filter row shows
  `筛选结果 / 总数` (e.g. `126 / 3591`).
- `reconcile()` keeps the current issue if it is still in the list (only its
  index is recomputed); otherwise it selects the first. Empty list ⇒ nothing
  selected.
- The model is created with `{ cycle: false }`: no wrap-around. Viewer-core
  clamps at the ends and excel-viewer disables 上一个 at the first item, 下一个
  at the last, and both for 0 or 1 item.

Shared-viewer API added for this (backward compatible): `viewer-core.js`
`setFilterList(list)`, `reconcile()`, and the `cycle` option; `excel-viewer.js`
end-aware button disabling (only when `cycle === false`).

'use strict';

/*
 * Liuxian Lab - Excel hardcode check: in-page review viewer core (pure logic).
 *
 * No DOM, no XLSX dependency. Provides cell-address math, the issue index,
 * sheet metrics, focus/window computation and a read-only ViewerModel that
 * drives navigation. The rendering layer (excel-viewer.js) consumes this.
 *
 * The Viewer NEVER mutates the workbook: it only reads cells and computes
 * view state.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    // Neutral alias + legacy alias, so any tool can load this shared module.
    root.ExcelViewerCore = api;
    root.HardcodeViewerCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_COL_WIDTH = 8.43; // Excel default column width (chars)
  const DEFAULT_ROW_HEIGHT = 15;  // Excel default row height (points)
  const ROW_HEADER_WIDTH = 48;
  const COL_HEADER_HEIGHT = 24;
  const OVERSCAN_ROWS = 8;
  const OVERSCAN_COLS = 4;

  function columnIndex(label) {
    const text = String(label || '').toUpperCase();
    let n = 0;
    for (let i = 0; i < text.length; i += 1) n = n * 26 + (text.charCodeAt(i) - 64);
    return n - 1;
  }

  function columnLabel(index) {
    let n = Number(index);
    let label = '';
    while (n >= 0) {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }

  // "L85" / "$AA$64" -> { row, col } (0-based). null when unparseable.
  function parseAddress(address) {
    const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(address == null ? '' : address).trim());
    if (!match) return null;
    return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
  }

  function encodeAddress(row, col) {
    return columnLabel(col) + (Number(row) + 1);
  }

  function parseRefToken(token) {
    const match = /^(\$?)([A-Za-z]{0,3})(\$?)(\d{0,7})$/.exec(String(token == null ? '' : token).trim());
    if (!match) return null;
    const col = match[2] ? columnIndex(match[2]) : null;
    const row = match[4] ? Number(match[4]) - 1 : null;
    return { col, row };
  }

  // "A1:C3" / "A1" / "A:C" / "1:3" -> { s:{r,c}, e:{r,c} } (may contain nulls).
  function decodeRange(ref) {
    if (!ref) return null;
    const parts = String(ref).split(':');
    const a = parseRefToken(parts[0]);
    const b = parts[1] ? parseRefToken(parts[1]) : a;
    if (!a || !b) return null;
    const s = { r: a.row, c: a.col };
    const e = { r: b.row == null ? a.row : b.row, c: b.col == null ? a.col : b.col };
    return { s, e };
  }

  function buildIssueIndex(issues) {
    const list = [];
    const bySheet = {};
    const countBySheet = {};
    (issues || []).forEach((issue) => {
      if (!issue || !issue.sheetName || !issue.cellAddress) return;
      list.push(issue);
      const address = String(issue.cellAddress).toUpperCase();
      if (!bySheet[issue.sheetName]) bySheet[issue.sheetName] = {};
      if (bySheet[issue.sheetName][address]) return; // one primary issue per cell
      bySheet[issue.sheetName][address] = issue;
      countBySheet[issue.sheetName] = (countBySheet[issue.sheetName] || 0) + 1;
    });
    return { list, bySheet, countBySheet };
  }

  function isRoundingPlug(issue) {
    if (!issue) return false;
    if (issue.ruleId === 'HC006') return true;
    const details = Array.isArray(issue.constantDetails) ? issue.constantDetails : [];
    return details.some((d) => d && d.role === 'ROUNDING_PLUG');
  }

  // kind: '' | 'HIGH' | 'SUSPICIOUS' | 'HARDCODE_NOTICE' | 'ROUNDING_PLUG'
  function filterIssues(issues, filter) {
    const f = filter || {};
    return (issues || []).filter((issue) => {
      if (!issue) return false;
      if (f.sheet && issue.sheetName !== f.sheet) return false;
      if (!f.kind) return true;
      if (f.kind === 'ROUNDING_PLUG') return isRoundingPlug(issue);
      return issue.severity === f.kind;
    });
  }

  function colWidthPx(meta, c) {
    const info = meta && meta.cols ? meta.cols[c] : null;
    if (info && info.hidden) return 0;
    let chars = info && info.wch != null ? info.wch : (info && info.width != null ? info.width / 7 : null);
    if (chars == null) chars = DEFAULT_COL_WIDTH;
    return Math.max(24, Math.round(chars * 7) + 5);
  }

  function rowHeightPx(meta, r) {
    const info = meta && meta.rows ? meta.rows[r] : null;
    if (info && info.hidden) return 0;
    const pt = info && info.hpt != null ? info.hpt : DEFAULT_ROW_HEIGHT;
    return Math.max(12, Math.round(pt * 96 / 72));
  }

  function resolveSheetMeta(ws) {
    let bounds = { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 };
    if (ws && ws['!ref']) {
      const range = decodeRange(ws['!ref']);
      if (range && range.s.r != null && range.e.r != null && range.s.c != null && range.e.c != null) {
        bounds = {
          minRow: Math.min(range.s.r, range.e.r),
          maxRow: Math.max(range.s.r, range.e.r),
          minCol: Math.min(range.s.c, range.e.c),
          maxCol: Math.max(range.s.c, range.e.c)
        };
      }
    }
    const merges = ((ws && ws['!merges']) || []).map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }));
    return {
      bounds,
      merges,
      cols: (ws && ws['!cols']) || [],
      rows: (ws && ws['!rows']) || [],
      ref: (ws && ws['!ref']) || null
    };
  }

  function buildMergeMap(meta) {
    const anchorOf = new Map(); // "r:c" covered -> anchor "r:c"
    const spanOf = new Map();   // anchor "r:c" -> {r0,r1,c0,c1}
    (meta ? meta.merges : []).forEach((m) => {
      const r0 = Math.min(m.s.r, m.e.r);
      const r1 = Math.max(m.s.r, m.e.r);
      const c0 = Math.min(m.s.c, m.e.c);
      const c1 = Math.max(m.s.c, m.e.c);
      const anchor = `${r0}:${c0}`;
      spanOf.set(anchor, { r0, r1, c0, c1 });
      for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
          if (r === r0 && c === c0) continue;
          anchorOf.set(`${r}:${c}`, anchor);
        }
      }
    });
    return { anchorOf, spanOf };
  }

  // Bounds default to the worksheet used range, but callers may pass an
  // explicit (extended) `options.bounds` so a focus window can extend past the
  // used range into the blank virtual grid (keeping the selection centred).
  function computeFocusRange(row, col, meta, options) {
    const opts = options || {};
    const padRows = opts.padRows == null ? 8 : opts.padRows;
    const padCols = opts.padCols == null ? 5 : opts.padCols;
    const b = opts.bounds || (meta ? meta.bounds : { minRow: row, maxRow: row, minCol: col, maxCol: col });
    const hasBounds = Boolean(opts.bounds) || Boolean(meta && meta.ref);
    const clampRow = (v) => (hasBounds ? Math.max(b.minRow, Math.min(b.maxRow, v)) : Math.max(0, v));
    const clampCol = (v) => (hasBounds ? Math.max(b.minCol, Math.min(b.maxCol, v)) : Math.max(0, v));
    return {
      rowStart: clampRow(Math.max(0, row - padRows)),
      rowEnd: clampRow(row + padRows),
      colStart: clampCol(Math.max(0, col - padCols)),
      colEnd: clampCol(col + padCols)
    };
  }

  function buildOffsets(startIndex, endIndex, sizeFn) {
    const offsets = new Array(endIndex - startIndex + 2);
    offsets[0] = 0;
    for (let i = startIndex; i <= endIndex; i += 1) offsets[i - startIndex + 1] = offsets[i - startIndex] + sizeFn(i);
    return offsets; // offsets[k] = pixel offset of index startIndex + k
  }

  function firstVisible(offsets, from, to, pos) {
    let lo = from;
    let hi = to;
    let result = from;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= pos) { result = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return result;
  }

  function computeWindow(rowCount, colCount, rowAt, colAt, viewport, options) {
    const opts = options || {};
    const overscanRows = opts.overscanRows == null ? OVERSCAN_ROWS : opts.overscanRows;
    const overscanCols = opts.overscanCols == null ? OVERSCAN_COLS : opts.overscanCols;
    const rowOffsets = buildOffsets(0, Math.max(0, rowCount - 1), rowAt);
    const colOffsets = buildOffsets(0, Math.max(0, colCount - 1), colAt);
    const vp = viewport || { scrollTop: 0, scrollLeft: 0, height: 400, width: 800 };
    const lastRow = Math.max(0, rowCount - 1);
    const lastCol = Math.max(0, colCount - 1);
    const rFirst = Math.max(0, firstVisible(rowOffsets, 0, lastRow, vp.scrollTop) - overscanRows);
    const cFirst = Math.max(0, firstVisible(colOffsets, 0, lastCol, vp.scrollLeft) - overscanCols);
    let rLast = rFirst;
    while (rLast < lastRow && rowOffsets[rLast + 1] < vp.scrollTop + vp.height) rLast += 1;
    rLast = Math.min(lastRow, rLast + overscanRows);
    let cLast = cFirst;
    while (cLast < lastCol && colOffsets[cLast + 1] < vp.scrollLeft + vp.width) cLast += 1;
    cLast = Math.min(lastCol, cLast + overscanCols);
    return {
      rows: rangeList(rFirst, rLast),
      cols: rangeList(cFirst, cLast),
      rowOffset: (r) => rowOffsets[r],
      colOffset: (c) => colOffsets[c],
      totalHeight: rowOffsets[lastRow + 1],
      totalWidth: colOffsets[lastCol + 1]
    };
  }

  function rangeList(from, to) {
    const list = [];
    for (let i = from; i <= to; i += 1) list.push(i);
    return list;
  }

  function cellValue(ws, row, col) {
    const address = encodeAddress(row, col);
    const cell = ws ? ws[address] : null;
    if (!cell) return { address, empty: true, text: '', formula: null, raw: null, type: null };
    let text = '';
    if (cell.w != null) text = String(cell.w);
    else if (cell.v != null) text = String(cell.v);
    return { address, empty: false, text, formula: cell.f || null, raw: cell.v == null ? null : cell.v, type: cell.t || null };
  }

  function createViewerModel(workbook, issues, options) {
    const opts = options || {};
    const sheetNames = (workbook && workbook.SheetNames) || [];
    const issueIndex = buildIssueIndex(issues);
    const listeners = [];
    const firstSheetWithIssues = sheetNames.find((name) => issueIndex.countBySheet[name] > 0);

    const state = {
      sheetName: opts.sheetName || firstSheetWithIssues || sheetNames[0] || '',
      selected: null,          // { row, col }
      selectedIssue: null,
      filterSheet: '',
      filterKind: '',
      listIndex: -1,
      overlay: opts.overlay !== false,
      mode: 'focus',           // 'focus' | 'sheet'
      // Navigation order override (an explicit, ordered list of issues). When
      // set, filteredIssues() returns exactly this list, so prev/next and the
      // position counter follow the caller's filter + sort order.
      filterList: null,
      // When false, prev/next do not wrap around (clamp at the ends). Tools
      // that want no-cycle navigation pass { cycle: false }.
      cycle: opts.cycle !== false,
      // One-shot reveal signal. Incremented ONLY by explicit navigation
      // (定位 / 上一个 / 下一个 / 名称框 / 回到当前问题). The viewer scrolls the
      // selected cell into view once per token bump, then the viewport is free:
      // scrolling never bumps this token, so selection and viewport stay decoupled.
      focusToken: 0
    };

    function snapshot() { return Object.assign({}, state, { selected: state.selected && Object.assign({}, state.selected) }); }
    function emit() { const s = snapshot(); listeners.forEach((fn) => fn(s)); }

    function sheet(name) { return workbook && workbook.Sheets ? workbook.Sheets[name] : null; }
    function metaFor(name) { return resolveSheetMeta(sheet(name)); }
    function issuesForSheet(name) { return issueIndex.bySheet[name] || {}; }
    function issueAt(name, address) { return issuesForSheet(name)[String(address).toUpperCase()] || null; }
    function filtered() {
      if (state.filterList) return state.filterList;
      return filterIssues(issueIndex.list, { sheet: state.filterSheet, kind: state.filterKind });
    }

    function setSelection(name, row, col) {
      state.sheetName = name;
      state.selected = { row, col };
      const address = encodeAddress(row, col);
      const issue = issueAt(name, address);
      state.selectedIssue = issue || null;
      if (issue) {
        const list = filtered();
        state.listIndex = list.indexOf(issue);
      }
      return state.selectedIssue;
    }

    // Manual cell pick (grid click / keyboard). Moves the selection border only;
    // it never requests a viewport reveal, so the user can keep browsing freely.
    function selectCell(name, row, col) {
      const issue = setSelection(name, row, col);
      emit();
      return issue;
    }

    // Explicit navigation: move camera to the target once (bumps focusToken).
    // The sheet need not exist (the viewer renders an empty state); selection
    // is always recorded so issue state stays consistent.
    function navigateTo(name, row, col) {
      if (!name) return null;
      const issue = setSelection(name, row, col);
      state.focusToken += 1;
      emit();
      return issue;
    }

    function goTo(issue, mode) {
      if (!issue) return;
      const pos = parseAddress(issue.cellAddress);
      if (!pos) return;
      state.mode = mode || 'focus';
      navigateTo(issue.sheetName, pos.row, pos.col);
    }

    function selectIndex(i) {
      const list = filtered();
      if (!list.length) { state.listIndex = -1; return; }
      const idx = state.cycle
        ? ((i % list.length) + list.length) % list.length
        : Math.max(0, Math.min(list.length - 1, i));
      state.listIndex = idx;
      goTo(list[idx], state.mode);
    }

    return {
      state: snapshot,
      subscribe(fn) { listeners.push(fn); return () => { const k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); }; },
      issueIndex() { return issueIndex; },
      sheetNames() { return sheetNames.slice(); },
      sheet,
      sheetMeta: metaFor,
      issueAt,
      issuesForSheet,
      filteredIssues: filtered,
      countForSheet(name) { return issueIndex.countBySheet[name] || 0; },
      setSheet(name) { if (name && name !== state.sheetName) { state.sheetName = name; state.selected = null; state.selectedIssue = null; emit(); } },
      setFilterSheet(name) { state.filterSheet = name || ''; emit(); },
      setFilterKind(kind) { state.filterKind = kind || ''; emit(); },
      setFilterList(list) { state.filterList = Array.isArray(list) ? list : null; emit(); },
      /*
       * Re-align selection after the filter/sort list changed:
       *   - empty list  -> nothing selected;
       *   - current issue still in the list -> keep it (no camera move), just
       *     recompute its index;
       *   - current issue filtered out (or none) -> select the first item.
       */
      reconcile() {
        const list = filtered();
        if (!list.length) {
          state.listIndex = -1;
          state.selected = null;
          state.selectedIssue = null;
          emit();
          return;
        }
        const idx = state.selectedIssue ? list.indexOf(state.selectedIssue) : -1;
        if (idx >= 0) { state.listIndex = idx; emit(); return; }
        state.listIndex = 0;
        goTo(list[0], state.mode);
      },
      setOverlay(value) { state.overlay = Boolean(value); emit(); },
      setMode(mode) { state.mode = mode === 'sheet' ? 'sheet' : 'focus'; emit(); },
      selectCell,
      navigateTo,
      // Re-run the one-shot camera move to the current selection (「回到当前问题」),
      // without changing what is selected or listened to afterwards.
      reveal() { if (state.selected) { state.focusToken += 1; emit(); } },
      selectIssue(issue) { goTo(issue, state.mode); },
      selectIndex,
      next() { const list = filtered(); if (!list.length) return null; selectIndex(state.listIndex < 0 ? 0 : state.listIndex + 1); return state.selectedIssue; },
      prev() { const list = filtered(); if (!list.length) return null; selectIndex(state.listIndex < 0 ? list.length - 1 : state.listIndex - 1); return state.selectedIssue; }
    };
  }

  return {
    DEFAULT_COL_WIDTH,
    DEFAULT_ROW_HEIGHT,
    ROW_HEADER_WIDTH,
    COL_HEADER_HEIGHT,
    OVERSCAN_ROWS,
    OVERSCAN_COLS,
    columnIndex,
    columnLabel,
    parseAddress,
    encodeAddress,
    decodeRange,
    buildIssueIndex,
    isRoundingPlug,
    filterIssues,
    resolveSheetMeta,
    buildMergeMap,
    colWidthPx,
    rowHeightPx,
    computeFocusRange,
    buildOffsets,
    computeWindow,
    rangeList,
    cellValue,
    createViewerModel
  };
});

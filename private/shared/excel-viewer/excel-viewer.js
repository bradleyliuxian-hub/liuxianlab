'use strict';

/*
 * Liuxian Lab - Excel hardcode check: in-page read-only review viewer.
 *
 * Renders a single workbook with an "issues overlay". Focus mode shows a small
 * window around the selected issue; sheet mode renders the used range with
 * windowed (virtual) rows and columns. Clicking a cell only updates the shared
 * ViewerModel - the workbook is never modified.
 */

(function (globalRoot, factory) {
  const core = (typeof module !== 'undefined' && module.exports)
    ? require('./viewer-core.js')
    : (globalRoot.ExcelViewerCore || globalRoot.HardcodeViewerCore);
  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    globalRoot.ExcelViewer = api;
    globalRoot.HardcodeExcelViewer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  const ROW_HEADER_WIDTH = core.ROW_HEADER_WIDTH;
  const COL_HEADER_HEIGHT = core.COL_HEADER_HEIGHT;
  const MAX_ROWS = 20000; // guards offset arrays for pathologically large sheets

  // The viewer keeps scrolling past the worksheet used range so the grid feels
  // like a real worksheet window instead of stopping at the last data cell.
  const VIEWER_EXTRA_ROWS = 100;
  const VIEWER_EXTRA_COLS = 20;
  const APPROX_ROW_PX = 20;
  const APPROX_COL_PX = 64;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createExcelViewer(options) {
    const rootEl = options.root;
    const model = options.model;

    rootEl.textContent = '';
    rootEl.classList.add('excel-viewer');
    rootEl.tabIndex = 0;

    const toolbar = el('div', 'vwr-toolbar');
    const row1 = el('div', 'vwr-toolrow');
    const row2 = el('div', 'vwr-toolrow vwr-toolrow--formula');

    const sheetWrap = el('label', 'vwr-field');
    sheetWrap.appendChild(el('span', 'vwr-label', 'Sheet'));
    const sheetSelect = el('select', 'vwr-sheet');
    sheetWrap.appendChild(sheetSelect);

    const nameWrap = el('label', 'vwr-field vwr-field--name');
    nameWrap.appendChild(el('span', 'vwr-label', '单元格'));
    const nameBox = el('input', 'vwr-namebox');
    nameBox.placeholder = '如 E163';
    nameBox.title = '输入单元格地址后回车定位';
    nameWrap.appendChild(nameBox);

    const navWrap = el('div', 'vwr-nav');
    const prevBtn = el('button', 'vwr-nav-btn', '← 上一个');
    prevBtn.type = 'button';
    const navLabel = el('span', 'vwr-nav-label', '0 / 0');
    const nextBtn = el('button', 'vwr-nav-btn', '下一个 →');
    nextBtn.type = 'button';
    navWrap.appendChild(prevBtn);
    navWrap.appendChild(navLabel);
    navWrap.appendChild(nextBtn);

    const revealBtn = el('button', 'vwr-reveal-btn', '回到当前问题');
    revealBtn.type = 'button';
    revealBtn.title = '把镜头移回当前选中的问题单元格';

    row1.appendChild(sheetWrap);
    row1.appendChild(nameWrap);
    row1.appendChild(revealBtn);
    row1.appendChild(navWrap);

    const formulaWrap = el('div', 'vwr-formula');
    const fx = el('span', 'vwr-fx', 'fx');
    formulaWrap.appendChild(fx);
    const formulaBar = el('code', 'vwr-formula-text', '');
    formulaWrap.appendChild(formulaBar);

    const overlayWrap = el('label', 'vwr-toggle');
    const overlayCheck = el('input');
    overlayCheck.type = 'checkbox';
    overlayCheck.checked = true;
    overlayWrap.appendChild(overlayCheck);
    overlayWrap.appendChild(el('span', null, '问题标记'));

    const modeBtn = el('button', 'vwr-mode-btn', '查看完整工作表');
    modeBtn.type = 'button';

    row2.appendChild(formulaWrap);
    row2.appendChild(overlayWrap);
    row2.appendChild(modeBtn);

    toolbar.appendChild(row1);
    toolbar.appendChild(row2);

    const tabs = el('div', 'vwr-tabs');

    const frame = el('div', 'vwr-frame');
    const corner = el('div', 'vwr-corner');
    const colHead = el('div', 'vwr-colhead');
    const colHeadCanvas = el('div', 'vwr-headcanvas');
    colHead.appendChild(colHeadCanvas);
    const rowHead = el('div', 'vwr-rowhead');
    const rowHeadCanvas = el('div', 'vwr-headcanvas');
    rowHead.appendChild(rowHeadCanvas);
    const body = el('div', 'vwr-body');
    const canvas = el('div', 'vwr-canvas');
    body.appendChild(canvas);
    frame.appendChild(corner);
    frame.appendChild(colHead);
    frame.appendChild(rowHead);
    frame.appendChild(body);

    const empty = el('div', 'vwr-empty', '当前工作表没有可显示的内容。');
    empty.hidden = true;

    rootEl.appendChild(toolbar);
    rootEl.appendChild(tabs);
    rootEl.appendChild(frame);
    rootEl.appendChild(empty);

    let rafId = 0;
    let rendering = false;
    // Viewport is only moved by explicit navigation. These track the last
    // navigation token / sheet / mode so a normal render never re-centres.
    let lastFocusToken = -1;
    let lastSheetName = null;
    let lastMode = null;

    function schedule() {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => { rafId = 0; render(); });
    }

    // Virtual render range. It must at least fill the viewport and must keep
    // extending as the user scrolls, so the grid never ends inside the card.
    //   maxRow = max(used+EXTRA, selection, current viewport bottom, scroll-grown)
    // It is viewer-only: workbook / worksheet["!ref"] are never touched.
    function viewBounds(meta, state) {
      const b = meta.bounds;
      const sel = state && state.selected;
      const viewH = body.clientHeight || 400;
      const viewW = body.clientWidth || 800;
      const needRows = Math.ceil(viewH / APPROX_ROW_PX) + core.OVERSCAN_ROWS;
      const needCols = Math.ceil(viewW / APPROX_COL_PX) + core.OVERSCAN_COLS;
      // Rows/cols already scrolled past (approx) so scrolling extends the range.
      const scrollRow = Math.floor((body.scrollTop || 0) / APPROX_ROW_PX);
      const scrollCol = Math.floor((body.scrollLeft || 0) / APPROX_COL_PX);
      let maxRow = Math.max(
        b.maxRow + VIEWER_EXTRA_ROWS,
        b.minRow + needRows - 1,
        sel ? sel.row : b.minRow,
        scrollRow + needRows + VIEWER_EXTRA_ROWS
      );
      let maxCol = Math.max(
        b.maxCol + VIEWER_EXTRA_COLS,
        b.minCol + needCols - 1,
        sel ? sel.col : b.minCol,
        scrollCol + needCols + VIEWER_EXTRA_COLS
      );
      maxRow = Math.min(maxRow, b.minRow + MAX_ROWS - 1);
      return { minRow: b.minRow, maxRow, minCol: b.minCol, maxCol };
    }

    function renderToolbar(state) {
      // sheet select
      const names = model.sheetNames();
      if (sheetSelect.options.length !== names.length) {
        sheetSelect.textContent = '';
        names.forEach((name) => {
          const opt = document.createElement('option');
          const count = model.countForSheet(name);
          opt.value = name;
          opt.textContent = count > 0 ? `${name} · ${count}` : name;
          sheetSelect.appendChild(opt);
        });
      }
      sheetSelect.value = state.sheetName;

      if (document.activeElement !== nameBox) {
        nameBox.value = state.selected ? core.encodeAddress(state.selected.row, state.selected.col) : '';
      }

      const ws = model.sheet(state.sheetName);
      if (state.selected && ws) {
        const cell = core.cellValue(ws, state.selected.row, state.selected.col);
        if (cell.formula) {
          formulaBar.textContent = '=' + String(cell.formula).replace(/^=/, '');
          formulaBar.classList.add('is-formula');
        } else {
          formulaBar.textContent = cell.empty ? '' : cell.text;
          formulaBar.classList.remove('is-formula');
        }
      } else {
        formulaBar.textContent = '';
        formulaBar.classList.remove('is-formula');
      }

      const list = model.filteredIssues();
      const pos = state.listIndex >= 0 && list.length ? state.listIndex + 1 : 0;
      navLabel.textContent = `${pos} / ${list.length}`;
      prevBtn.disabled = list.length === 0;
      nextBtn.disabled = list.length === 0;

      overlayCheck.checked = state.overlay;
      modeBtn.textContent = state.mode === 'sheet' ? '问题聚焦' : '查看完整工作表';

      renderTabs(state);
    }

    function renderTabs(state) {
      const names = model.sheetNames();
      if (names.length > 12) { tabs.textContent = ''; tabs.hidden = true; return; }
      tabs.hidden = false;
      tabs.textContent = '';
      names.forEach((name) => {
        const count = model.countForSheet(name);
        const tab = el('button', 'vwr-tab', name);
        tab.type = 'button';
        if (name === state.sheetName) tab.classList.add('active');
        if (count > 0) {
          const badge = el('span', 'vwr-tab-badge', String(count));
          tab.appendChild(badge);
        }
        tab.addEventListener('click', () => { body.scrollTop = 0; body.scrollLeft = 0; model.setSheet(name); });
        tabs.appendChild(tab);
      });
    }

    function render() {
      if (rendering) return;
      rendering = true;
      try {
        const state = model.state();
        renderToolbar(state);
        const ws = model.sheet(state.sheetName);
        if (!ws) { frame.hidden = true; empty.hidden = false; return; }
        frame.hidden = false;
        empty.hidden = true;
        const meta = model.sheetMeta(state.sheetName);
        const merge = core.buildMergeMap(meta);
        // A reveal happens only when the explicit navigation token or the mode
        // changed. Manual scroll/click/overlay/filter renders never reveal.
        const tokenChanged = state.focusToken !== lastFocusToken;
        const modeChanged = state.mode !== lastMode;
        const sheetChanged = state.sheetName !== lastSheetName;
        lastFocusToken = state.focusToken;
        lastMode = state.mode;
        lastSheetName = state.sheetName;
        const reveal = Boolean(state.selected) && (tokenChanged || modeChanged);
        if (sheetChanged && !tokenChanged) { body.scrollTop = 0; body.scrollLeft = 0; }
        if (state.mode === 'focus' && state.selected) {
          renderFocus(state, ws, meta, merge, reveal);
        } else {
          renderSheet(state, ws, meta, merge, reveal);
        }
      } finally {
        rendering = false;
      }
    }

    function putCells(state, ws, meta, merge, rows, cols, rowOffsetOf, colOffsetOf, vp) {
      const frag = document.createDocumentFragment();
      const issues = model.issuesForSheet(state.sheetName);
      const overlay = state.overlay;
      const sel = state.selected;
      const rowSize = (r) => core.rowHeightPx(meta, r);
      const colSize = (c) => core.colWidthPx(meta, c);
      const rowEnd = rows[rows.length - 1];
      const colEnd = cols[cols.length - 1];

      rows.forEach((r, ri) => {
        if (rowSize(r) === 0) return;
        cols.forEach((c, ci) => {
          if (colSize(c) === 0) return;
          const key = `${r}:${c}`;
          if (merge.anchorOf.has(key)) return; // covered by a merge anchor
          const value = core.cellValue(ws, r, c);
          const issue = issues[value.address];
          const span = merge.spanOf.get(key);
          let left = colOffsetOf(c);
          let top = rowOffsetOf(r);
          let width = colSize(c);
          let height = rowSize(r);
          if (span) {
            let w = 0;
            for (let cc = span.c0; cc <= Math.min(span.c1, colEnd); cc += 1) w += colSize(cc);
            let h = 0;
            for (let rr = span.r0; rr <= Math.min(span.r1, rowEnd); rr += 1) h += rowSize(rr);
            width = w; height = h;
            left = colOffsetOf(span.c0);
            top = rowOffsetOf(span.r0);
          }
          const node = el('div', 'vwr-cell');
          node.style.left = left + 'px';
          node.style.top = top + 'px';
          node.style.width = width + 'px';
          node.style.height = height + 'px';
          node.dataset.r = String(r);
          node.dataset.c = String(c);
          if (!value.empty) node.textContent = value.formula && value.text === '' ? '' : value.text;
          if (value.formula) node.classList.add('is-formula');
          if (overlay && issue) {
            node.classList.add('is-issue');
            if (issue.severity) node.classList.add(`is-${String(issue.severity).toLowerCase()}`);
          }
          if (sel && sel.row === r && sel.col === c) node.classList.add('is-active');
          if (span) node.classList.add('is-merged');
          frag.appendChild(node);
        });
      });
      canvas.textContent = '';
      canvas.appendChild(frag);
    }

    function renderHeaders(rows, cols, rowOffsetOf, colOffsetOf, meta) {
      const cfrag = document.createDocumentFragment();
      cols.forEach((c) => {
        const w = core.colWidthPx(meta, c);
        if (w === 0) return;
        const node = el('div', 'vwr-colhead-cell', core.columnLabel(c));
        node.style.left = colOffsetOf(c) + 'px';
        node.style.width = w + 'px';
        cfrag.appendChild(node);
      });
      colHeadCanvas.textContent = '';
      colHeadCanvas.appendChild(cfrag);

      const rfrag = document.createDocumentFragment();
      rows.forEach((r) => {
        const h = core.rowHeightPx(meta, r);
        if (h === 0) return;
        const node = el('div', 'vwr-rowhead-cell', String(r + 1));
        node.style.top = rowOffsetOf(r) + 'px';
        node.style.height = h + 'px';
        rfrag.appendChild(node);
      });
      rowHeadCanvas.textContent = '';
      rowHeadCanvas.appendChild(rfrag);
    }

    function setCanvas(totalWidth, totalHeight) {
      canvas.style.width = totalWidth + 'px';
      canvas.style.height = totalHeight + 'px';
      colHeadCanvas.style.width = totalWidth + 'px';
      rowHeadCanvas.style.height = totalHeight + 'px';
    }

    function syncHeaders() {
      colHeadCanvas.style.transform = `translateX(${-1 * (body.scrollLeft || 0)}px)`;
      rowHeadCanvas.style.transform = `translateY(${-1 * (body.scrollTop || 0)}px)`;
    }

    function clampWindowToBounds(start, end, min, max) {
      let s = start;
      let e = end;
      if (s < min) { e += (min - s); s = min; }
      if (e > max) { s -= (e - max); e = max; }
      s = Math.max(min, s);
      e = Math.min(max, e);
      return { start: s, end: e };
    }

    // Focus window: centred on the selection but sized to at least fill the
    // viewport (with a small buffer), so the card shows a full worksheet grid
    // instead of a small preview floating in blank space.
    function focusWindow(sel, bounds) {
      const viewH = body.clientHeight || 400;
      const viewW = body.clientWidth || 800;
      const fillRows = Math.max(2 * 8 + 1, Math.ceil(viewH / APPROX_ROW_PX) + 4);
      const fillCols = Math.max(2 * 5 + 1, Math.ceil(viewW / APPROX_COL_PX) + 3);
      const halfR = Math.floor(fillRows / 2);
      const halfC = Math.floor(fillCols / 2);
      const rows = clampWindowToBounds(sel.row - halfR, sel.row - halfR + fillRows - 1, bounds.minRow, bounds.maxRow);
      const cols = clampWindowToBounds(sel.col - halfC, sel.col - halfC + fillCols - 1, bounds.minCol, bounds.maxCol);
      return { rowStart: rows.start, rowEnd: rows.end, colStart: cols.start, colEnd: cols.end };
    }

    function renderFocus(state, ws, meta, merge, reveal) {
      const bounds = viewBounds(meta, state);
      const focus = focusWindow(state.selected, bounds);
      const rows = core.rangeList(focus.rowStart, focus.rowEnd);
      const cols = core.rangeList(focus.colStart, focus.colEnd);
      const rowOffsets = core.buildOffsets(focus.rowStart, focus.rowEnd, (r) => core.rowHeightPx(meta, r));
      const colOffsets = core.buildOffsets(focus.colStart, focus.colEnd, (c) => core.colWidthPx(meta, c));
      const rowOffsetOf = (r) => rowOffsets[r - focus.rowStart];
      const colOffsetOf = (c) => colOffsets[c - focus.colStart];
      const totalW = colOffsets[colOffsets.length - 1];
      const totalH = rowOffsets[rowOffsets.length - 1];
      setCanvas(totalW, totalH);
      renderHeaders(rows, cols, rowOffsetOf, colOffsetOf, meta);
      putCells(state, ws, meta, merge, rows, cols, rowOffsetOf, colOffsetOf);
      // Only (re)position on an explicit reveal; a plain render leaves the
      // user's scroll position untouched so the viewport stays free.
      if (reveal) {
        const viewH = body.clientHeight || 400;
        const viewW = body.clientWidth || 800;
        body.scrollTop = Math.max(0, rowOffsetOf(state.selected.row) - viewH / 2 + core.rowHeightPx(meta, state.selected.row) / 2);
        body.scrollLeft = Math.max(0, colOffsetOf(state.selected.col) - viewW / 2 + core.colWidthPx(meta, state.selected.col) / 2);
      }
      syncHeaders();
    }

    function renderSheet(state, ws, meta, merge, reveal) {
      const bounds = viewBounds(meta, state);
      const rowCount = bounds.maxRow - bounds.minRow + 1;
      const colCount = bounds.maxCol - bounds.minCol + 1;
      const rowAt = (k) => core.rowHeightPx(meta, bounds.minRow + k);
      const colAt = (k) => core.colWidthPx(meta, bounds.minCol + k);
      const rowOffsets = core.buildOffsets(bounds.minRow, bounds.maxRow, (r) => core.rowHeightPx(meta, r));
      const colOffsets = core.buildOffsets(bounds.minCol, bounds.maxCol, (c) => core.colWidthPx(meta, c));
      const viewH = body.clientHeight || 400;
      const viewW = body.clientWidth || 800;
      // One-shot reveal only (explicit navigation). Scrolling never re-centres.
      if (reveal && state.selected) {
        const r = Math.min(Math.max(state.selected.row, bounds.minRow), bounds.maxRow);
        const c = Math.min(Math.max(state.selected.col, bounds.minCol), bounds.maxCol);
        body.scrollTop = Math.max(0, rowOffsets[r - bounds.minRow] - viewH / 2 + core.rowHeightPx(meta, r) / 2);
        body.scrollLeft = Math.max(0, colOffsets[c - bounds.minCol] - viewW / 2 + core.colWidthPx(meta, c) / 2);
      }
      const win = core.computeWindow(rowCount, colCount, rowAt, colAt, {
        scrollTop: body.scrollTop || 0,
        scrollLeft: body.scrollLeft || 0,
        height: viewH,
        width: viewW
      });
      const rows = win.rows.map((k) => bounds.minRow + k);
      const cols = win.cols.map((k) => bounds.minCol + k);
      const rowOffsetOf = (r) => rowOffsets[r - bounds.minRow];
      const colOffsetOf = (c) => colOffsets[c - bounds.minCol];
      setCanvas(colOffsets[colOffsets.length - 1], rowOffsets[rowOffsets.length - 1]);
      renderHeaders(rows, cols, rowOffsetOf, colOffsetOf, meta);
      putCells(state, ws, meta, merge, rows, cols, rowOffsetOf, colOffsetOf);
      syncHeaders();
    }

    // --- events ---
    sheetSelect.addEventListener('change', () => { body.scrollTop = 0; body.scrollLeft = 0; model.setSheet(sheetSelect.value); });
    overlayCheck.addEventListener('change', () => model.setOverlay(overlayCheck.checked));
    modeBtn.addEventListener('click', () => model.setMode(model.state().mode === 'sheet' ? 'focus' : 'sheet'));
    prevBtn.addEventListener('click', () => model.prev());
    nextBtn.addEventListener('click', () => model.next());
    revealBtn.addEventListener('click', () => model.reveal());
    nameBox.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const state = model.state();
      const parsed = core.parseAddress(nameBox.value.trim());
      if (parsed && state.sheetName) model.navigateTo(state.sheetName, parsed.row, parsed.col);
      else nameBox.value = state.selected ? core.encodeAddress(state.selected.row, state.selected.col) : '';
    });
    nameBox.addEventListener('blur', () => {
      const state = model.state();
      nameBox.value = state.selected ? core.encodeAddress(state.selected.row, state.selected.col) : '';
    });
    body.addEventListener('scroll', () => { syncHeaders(); schedule(); });
    body.addEventListener('click', (event) => {
      const cell = event.target.closest('.vwr-cell');
      if (!cell) return;
      // Manual pick: move the selection border only, never the viewport.
      model.selectCell(model.state().sheetName, Number(cell.dataset.r), Number(cell.dataset.c));
    });
    rootEl.addEventListener('keydown', (event) => {
      const state = model.state();
      if (!state.selected) return;
      const map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const delta = map[event.key];
      if (!delta) return;
      event.preventDefault();
      // Deliberate keyboard move -> one-shot reveal (still free afterwards).
      model.navigateTo(state.sheetName, Math.max(0, state.selected.row + delta[0]), Math.max(0, state.selected.col + delta[1]));
    });

    const unsubscribe = model.subscribe(schedule);
    const onResize = () => schedule();
    window.addEventListener('resize', onResize);
    // Re-fill the grid when the viewer (or its container / splitter) resizes.
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => schedule());
      resizeObserver.observe(body);
    }

    // initial paint
    schedule();

    return {
      refresh: schedule,
      focus: () => rootEl.focus(),
      destroy() {
        unsubscribe();
        window.removeEventListener('resize', onResize);
        if (resizeObserver) resizeObserver.disconnect();
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  }

  return { createExcelViewer };
});

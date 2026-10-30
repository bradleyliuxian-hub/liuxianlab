'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const API = '/api/journal-entry-standard-exports';
  const CHILD_API = '/api/journal-entry-analyses';
  const BATCH_API = '/api/journal-entry-batches';
  const MAX_EXPLICIT = 5000;

  const dom = {
    back: $('#standardBack'), scopeTitle: $('#scopeTitle'), scopeSubtitle: $('#scopeSubtitle'),
    scopeBadge: $('#scopeBadge'), scopeError: $('#scopeError'),
    columnHint: $('#columnHint'), columnCount: $('#columnCount'), columnGroups: $('#columnGroups'),
    columnOrder: $('#columnOrder'), recommendedColumns: $('#recommendedColumns'),
    removeEmptyColumns: $('#removeEmptyColumns'), selectAllColumns: $('#selectAllColumns'),
    clearAllColumns: $('#clearAllColumns'), resetColumns: $('#resetColumns'),
    previewCard: $('#previewCard'), previewSubtitle: $('#previewSubtitle'), previewLimit: $('#previewLimit'),
    rowStatus: $('#rowStatus'), rowTableWrap: $('#rowTableWrap'), rowPagination: $('#rowPagination'),
    rowPagePrev: $('#rowPagePrev'), rowPageNext: $('#rowPageNext'), rowPageInfo: $('#rowPageInfo'),
    rowPageSize: $('#rowPageSize'), selectionNotice: $('#selectionNotice'),
    excludePage: $('#excludePage'), restorePage: $('#restorePage'), onlyPage: $('#onlyPage'),
    restoreAllRows: $('#restoreAllRows'), widePreview: $('#widePreview'),
    standardMetrics: $('#standardMetrics'), standardWarning: $('#standardWarning'),
    standardExportButton: $('#standardExportButton'), previewError: $('#previewError'),
    toast: $('#standardToast'), reportNotice: $('#reportModeNotice'),
    pageHeading: $('#pageHeading'), pageIntro: $('#pageIntro'),
    openColumnSettings: $('#openColumnSettings'), closeColumnSettings: $('#closeColumnSettings'),
    columnDialog: $('#columnDialog')
  };

  const state = {
    reportMode: false,
    scopeType: '', scopeId: '', scope: null, meta: null,
    columnDefs: [], columnGroups: [], defaultColumnOrder: [], columns: [], columnsDirty: false,
    columnStats: null, rows: [], page: 1, pageSize: 50, totalPages: 0,
    candidateLines: 0, includedLines: 0, excludedLines: 0,
    candidateVouchers: 0, includedVouchers: 0, sourceFiles: 0,
    selectionMode: 'all_except', excludedRows: new Map(), includedRows: new Map(),
    rowsLoading: false, refreshTimer: null, requestToken: 0,
    expectedCandidateLines: null, wide: false, exporting: false, toastTimer: null
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) { if (node) node.replaceChildren(); }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 3000);
  }

  function showError(message) {
    dom.previewError.textContent = message || '';
    dom.previewError.hidden = !message;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(path, { ...options, headers }).then(async (response) => {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('登录已过期。');
      }
      if (!response.ok) {
        const error = new Error(payload.error || `请求失败 (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    });
  }

  function rowKey(ref) { return `${ref.job_id || ''}\u0000${ref.internal_line_key || ''}`; }
  function rowRef(row) { return { job_id: row.job_id, internal_line_key: row.internal_line_key }; }
  function selectionSize() {
    return state.selectionMode === 'only_selected' ? state.includedRows.size : state.excludedRows.size;
  }

  function resetRowSelection() {
    state.excludedRows.clear();
    state.includedRows.clear();
    state.selectionMode = 'all_except';
  }

  function columnLabel(id) {
    return state.columnDefs.find((item) => item.id === id)?.label || id;
  }

  function columnStatText(id) {
    const stat = state.columnStats?.[id];
    if (!stat) return { text: '预览后检测', tone: '' };
    if (!stat.total_count || !stat.non_empty_count) return { text: '全空', tone: 'empty' };
    const ratio = stat.non_empty_count / stat.total_count;
    if (ratio >= 1) return { text: '100% 有值', tone: 'partial' };
    return { text: `${Math.round(ratio * 100)}% 有值`, tone: 'partial' };
  }

  function setColumns(columns, { dirty = true } = {}) {
    state.columns = [...new Set(columns)].filter((id) => state.columnDefs.some((item) => item.id === id));
    state.columnsDirty = dirty;
    renderColumns();
    renderRowTable();
    renderPagination();
  }

  function recommendedColumnIds() {
    const selected = [];
    for (const id of state.defaultColumnOrder) {
      const definition = state.columnDefs.find((item) => item.id === id);
      if (!definition) continue;
      if (definition.default) selected.push(id);
      else if (definition.defaultIfData && state.columnStats && !state.columnStats[id]?.entirely_empty) {
        selected.push(id);
      }
    }
    return selected;
  }

  function renderColumns() {
    if (!state.columnDefs.length) return;
    const selected = new Set(state.columns);
    dom.columnCount.textContent = `${state.columns.length} / ${state.columnDefs.length} 列`;
    const emptyCount = state.columnStats
      ? state.columns.filter((id) => state.columnStats[id]?.entirely_empty).length
      : 0;
    dom.removeEmptyColumns.textContent = emptyCount
      ? `取消勾选全部空白列（${emptyCount}）`
      : '取消勾选全部空白列';
    dom.removeEmptyColumns.disabled = !state.columnStats;
    dom.columnHint.textContent = state.columnStats
      ? `已选 ${state.columns.length} 列；空白统计基于最终保留的 ${state.includedLines} 行。`
      : '预览后基于最终保留行检测空白列。';

    clear(dom.columnGroups);
    for (const group of state.columnGroups) {
      const box = el('div', 'column-group');
      box.append(el('h3', '', group.label));
      state.columnDefs.filter((item) => item.group === group.id).forEach((definition) => {
        const row = el('div', 'column-row');
        const label = el('label');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(definition.id);
        checkbox.addEventListener('change', () => {
          const next = new Set(state.columns);
          if (checkbox.checked) next.add(definition.id);
          else next.delete(definition.id);
          setColumns([...next]);
        });
        label.append(checkbox, el('span', '', definition.label));
        const status = columnStatText(definition.id);
        row.append(label, el('span', `column-stat ${status.tone}`.trim(), status.text));
        box.append(row);
      });
      dom.columnGroups.append(box);
    }

    clear(dom.columnOrder);
    state.columns.forEach((id, index) => {
      const chip = el('span', 'column-chip');
      chip.append(el('span', '', columnLabel(id)));
      const up = el('button', '', '▲');
      up.type = 'button';
      up.disabled = index === 0;
      up.addEventListener('click', () => {
        if (index === 0) return;
        const next = state.columns.slice();
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        setColumns(next);
      });
      const down = el('button', '', '▼');
      down.type = 'button';
      down.disabled = index === state.columns.length - 1;
      down.addEventListener('click', () => {
        if (index === state.columns.length - 1) return;
        const next = state.columns.slice();
        [next[index + 1], next[index]] = [next[index], next[index + 1]];
        setColumns(next);
      });
      const remove = el('button', 'remove', '×');
      remove.type = 'button';
      remove.addEventListener('click', () => setColumns(state.columns.filter((item) => item !== id)));
      chip.append(up, down, remove);
      dom.columnOrder.append(chip);
    });
    dom.standardExportButton.disabled = state.exporting
      || state.rowsLoading
      || !state.columns.length
      || !state.includedLines;
  }

  function initColumns() {
    const meta = state.meta || {};
    state.columnDefs = Array.isArray(meta.columns) ? meta.columns : [];
    state.columnGroups = Array.isArray(meta.columnGroups) ? meta.columnGroups : [];
    state.defaultColumnOrder = Array.isArray(meta.defaultColumnOrder)
      ? meta.defaultColumnOrder
      : state.columnDefs.map((item) => item.id);
    state.columns = state.columnDefs.filter((item) => item.default).map((item) => item.id);
    renderColumns();
  }

  function collectSpec() {
    return {
      scopeType: state.scopeType,
      scopeId: state.scopeId,
      columns: state.columnsDirty ? state.columns.slice() : undefined,
      rowSelectionMode: state.selectionMode,
      excludedRows: state.selectionMode === 'all_except' ? [...state.excludedRows.values()] : [],
      includedRows: state.selectionMode === 'only_selected' ? [...state.includedRows.values()] : []
    };
  }

  async function loadScope() {
    const params = new URLSearchParams(window.location.search);
    state.reportMode = params.get('mode') === 'report';
    if (state.reportMode) {
      document.title = '完整分析报告导出设置 · Liuxian Lab';
      dom.pageHeading.textContent = '配置完整分析报告。';
      dom.pageIntro.textContent = '标准序时账 Sheet 使用这里选择的行和列；其他分析 Sheet 仍使用完整分析结果。';
      dom.reportNotice.hidden = false;
    }
    state.scopeType = params.get('scopeType') || 'job';
    state.scopeId = params.get('scopeId') || '';
    if (!/^[0-9a-f-]{36}$/i.test(state.scopeId) || !['job', 'batch'].includes(state.scopeType)) {
      dom.scopeError.textContent = '数据范围无效。';
      dom.scopeError.hidden = false;
      return false;
    }
    try {
      if (state.scopeType === 'job') {
        const payload = await api(`${CHILD_API}/${encodeURIComponent(state.scopeId)}`);
        state.scope = payload.job;
        if (payload.job.status !== 'completed') throw new Error('该任务尚未完成，无法导出。');
        dom.scopeTitle.textContent = payload.job.originalFilename || '单文件任务';
        dom.scopeSubtitle.textContent = `单文件 · 已完成 · ${payload.job.sheetName || ''}`;
        dom.scopeBadge.textContent = 'JOB';
        dom.back.href = `index.html?job=${encodeURIComponent(state.scopeId)}`;
      } else {
        const payload = await api(`${BATCH_API}/${encodeURIComponent(state.scopeId)}`);
        state.scope = payload.batch;
        if (!payload.batch.completedCount) throw new Error('批量任务没有已完成文件。');
        dom.scopeTitle.textContent = payload.batch.name || '批量任务';
        dom.scopeSubtitle.textContent = `批量 · 已完成 ${payload.batch.completedCount} / ${payload.batch.totalCount} 个文件`;
        dom.scopeBadge.textContent = 'BATCH';
        dom.back.href = `batch.html?batch=${encodeURIComponent(state.scopeId)}`;
      }
      return true;
    } catch (error) {
      dom.scopeError.textContent = error.message || '无法加载数据范围。';
      dom.scopeError.hidden = false;
      return false;
    }
  }

  function applyPreviewPayload(payload) {
    state.columnStats = payload.column_stats || null;
    if (!state.columnsDirty && Array.isArray(payload.columns)) {
      state.columns = payload.columns.slice();
      state.columnsDirty = true;
    }
    state.candidateLines = Number(payload.candidate_line_count || 0);
    state.includedLines = Number(payload.included_line_count || 0);
    state.excludedLines = Number(payload.excluded_line_count || 0);
    state.candidateVouchers = Number(payload.candidate_voucher_count || 0);
    state.includedVouchers = Number(payload.included_voucher_count || 0);
    state.sourceFiles = Number(payload.source_file_count || 0);
    state.page = Number(payload.page || 1);
    state.totalPages = Number(payload.total_pages || 0);
    state.rows = Array.isArray(payload.rows) ? payload.rows : [];
    state.selectionMode = payload.row_selection_mode || 'all_except';
    state.excludedRows = new Map((payload.excluded_rows || []).map((ref) => [rowKey(ref), ref]));
    state.includedRows = new Map((payload.included_rows || []).map((ref) => [rowKey(ref), ref]));
    state.expectedCandidateLines = state.candidateLines;
    if (state.scopeType === 'batch' && !state.columns.includes('original_filename')) {
      state.columns = [...state.columns, 'original_filename'];
    }
  }

  function displayCell(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  function renderRowTable() {
    clear(dom.rowTableWrap);
    if (!state.rows.length) {
      dom.rowTableWrap.append(el('div', 'table-skeleton',
        state.rowsLoading ? '正在加载导出预览…' : '当前数据范围没有可导出的行。'));
      return;
    }
    const table = el('table', 'row-preview-table');
    const thead = el('thead');
    const head = el('tr');
    head.append(el('th', 'select-cell', '保留'));
    state.columns.forEach((id) => head.append(el('th', '', columnLabel(id))));
    thead.append(head);
    table.append(thead);
    const tbody = el('tbody');
    state.rows.forEach((row, index) => {
      const tr = el('tr');
      if (!row.included) tr.classList.add('excluded');
      const selectCell = el('td', 'select-cell');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = row.included;
      checkbox.setAttribute('aria-label', `保留第 ${index + 1} 行`);
      checkbox.addEventListener('change', () => toggleRow(index, checkbox.checked));
      selectCell.append(checkbox);
      tr.append(selectCell);
      state.columns.forEach((id) => {
        const definition = state.columnDefs.find((item) => item.id === id) || {};
        const cell = el('td', '', displayCell(row.values?.[id]));
        if (definition.kind === 'amount') cell.classList.add('amount-cell', 'num');
        else if (definition.kind === 'date') cell.classList.add('date-cell');
        else if (id === 'voucher_id') cell.classList.add('voucher-cell');
        else if (id === 'description') cell.classList.add('desc-cell');
        else if (definition.kind === 'key') cell.classList.add('key-cell');
        cell.title = displayCell(row.values?.[id]);
        tr.append(cell);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    dom.rowTableWrap.append(table);
  }

  function renderPagination() {
    const pages = state.totalPages || (state.candidateLines ? 1 : 0);
    dom.rowPageInfo.textContent = pages
      ? `第 ${state.page} / ${pages} 页 · 共 ${state.candidateLines} 行`
      : '没有可预览的行';
    dom.rowPagePrev.disabled = state.page <= 1 || state.rowsLoading;
    dom.rowPageNext.disabled = !pages || state.page >= pages || state.rowsLoading;
    dom.rowPageSize.value = String(state.pageSize);
  }

  function metric(label, value, note, key) {
    const box = el('div', 'metric');
    if (key) box.dataset.metric = key;
    box.append(el('span', '', label));
    box.append(el('strong', '', value));
    if (note) box.append(el('small', '', note));
    return box;
  }

  function renderSummary() {
    clear(dom.standardMetrics);
    dom.standardMetrics.append(
      metric('候选行', state.candidateLines, '', 'candidateLines'),
      metric('保留行', state.includedLines, '', 'matchedLines'),
      metric('排除行', state.excludedLines, '', 'excludedLines'),
      metric('保留凭证', state.includedVouchers, '', 'matchedVouchers'),
      metric('列', state.columns.length, '', 'columns'),
      metric('来源文件', state.sourceFiles, '', 'sourceFiles')
    );
    dom.rowStatus.replaceChildren();
    const parts = [
      ['筛选匹配', state.candidateLines, ' 行'],
      ['已保留', state.includedLines, ' 行'],
      ['已排除', state.excludedLines, ' 行'],
      ['涉及凭证', state.includedVouchers, '']
    ];
    parts.forEach(([label, value, suffix]) => {
      dom.rowStatus.append(
        document.createTextNode(`${label} `),
        el('strong', '', `${value}${suffix}`),
        document.createTextNode(' · ')
      );
    });
    dom.rowStatus.append(
      document.createTextNode('模式：'),
      el('strong', '', state.selectionMode === 'only_selected' ? '仅保留选中' : '全部保留')
    );
    if (state.rowsLoading) dom.rowStatus.append(document.createTextNode(' · '), el('strong', '', '正在重新计算…'));
    dom.previewSubtitle.textContent = state.candidateLines
      ? `候选中保留 ${state.includedLines} 行 · ${state.includedVouchers} 张凭证 · ${state.columns.length} 列`
      : '当前数据范围没有可导出的行。';
    dom.previewLimit.textContent = state.includedLines ? '可以导出' : '无保留行';
    dom.standardWarning.hidden = !state.excludedLines;
    dom.standardWarning.textContent = state.excludedLines
      ? `已手工排除 ${state.excludedLines} 行；这些行不会进入标准序时账。`
      : '';
    dom.excludePage.disabled = state.rowsLoading || !state.rows.length;
    dom.restorePage.disabled = state.rowsLoading || !state.rows.length || selectionSize() === 0;
    dom.onlyPage.disabled = state.rowsLoading || !state.rows.length;
    dom.restoreAllRows.disabled = state.rowsLoading || selectionSize() === 0;
    dom.standardExportButton.disabled = state.exporting || state.rowsLoading
      || !state.columns.length || !state.includedLines;
    dom.standardExportButton.textContent = state.exporting
      ? '正在生成…'
      : state.reportMode
        ? `导出完整分析报告（${state.includedLines} 行）`
        : `导出标准序时账（${state.includedLines} 行）`;
  }

  function renderAll() {
    renderColumns();
    renderRowTable();
    renderPagination();
    renderSummary();
  }

  async function loadPreview({ page = 1, scroll = false } = {}) {
    showError('');
    let spec;
    try { spec = collectSpec(); } catch (error) { showError(error.message); return; }
    const token = ++state.requestToken;
    state.rowsLoading = true;
    renderAll();
    try {
      const payload = await api(`${API}/preview`, {
        method: 'POST',
        body: JSON.stringify({ ...spec, page, pageSize: state.pageSize })
      });
      if (token !== state.requestToken) return;
      applyPreviewPayload(payload);
      if (scroll) dom.previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (token !== state.requestToken) return;
      showError('无法加载导出预览，请重试。');
    } finally {
      if (token === state.requestToken) {
        state.rowsLoading = false;
        renderAll();
      }
    }
  }

  async function refreshSelection() {
    let spec;
    try { spec = collectSpec(); } catch (error) { showError(error.message); return; }
    const token = ++state.requestToken;
    state.rowsLoading = true;
    renderSummary();
    try {
      const payload = await api(`${API}/preview`, {
        method: 'POST',
        body: JSON.stringify({ ...spec, page: state.page, pageSize: state.pageSize })
      });
      if (token !== state.requestToken) return;
      applyPreviewPayload(payload);
    } catch (error) {
      if (token !== state.requestToken) return;
      showError('无法刷新导出预览，请重试。');
    } finally {
      if (token === state.requestToken) {
        state.rowsLoading = false;
        renderAll();
      }
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.rowsLoading = true;
    renderSummary();
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      refreshSelection();
    }, 180);
  }

  function toggleRow(index, checked) {
    const row = state.rows[index];
    if (!row) return;
    const ref = rowRef(row);
    const key = rowKey(ref);
    if (state.selectionMode === 'all_except') {
      if (checked) state.excludedRows.delete(key);
      else state.excludedRows.set(key, ref);
    } else {
      if (checked) {
        if (state.includedRows.size >= MAX_EXPLICIT) {
          showToast('最多手工保留 5000 行，请改用筛选条件。');
          renderRowTable();
          return;
        }
        state.includedRows.set(key, ref);
      } else {
        if (state.includedRows.size <= 1) {
          showToast('至少保留 1 行。');
          renderRowTable();
          return;
        }
        state.includedRows.delete(key);
      }
    }
    row.included = checked;
    renderRowTable();
    renderSummary();
    scheduleRefresh();
  }

  function pageRefs() { return state.rows.map(rowRef); }

  function excludeCurrentPage() {
    if (!state.rows.length) return;
    if (state.selectionMode === 'all_except') {
      for (const ref of pageRefs()) state.excludedRows.set(rowKey(ref), ref);
    } else {
      const next = new Map(state.includedRows);
      for (const ref of pageRefs()) next.delete(rowKey(ref));
      if (!next.size) {
        showToast('至少保留 1 行；请改用筛选条件。');
        return;
      }
      state.includedRows = next;
    }
    refreshSelection();
  }

  function restoreCurrentPage() {
    if (!state.rows.length) return;
    if (state.selectionMode === 'all_except') {
      for (const ref of pageRefs()) state.excludedRows.delete(rowKey(ref));
    } else {
      for (const ref of pageRefs()) {
        if (state.includedRows.size >= MAX_EXPLICIT) break;
        state.includedRows.set(rowKey(ref), ref);
      }
    }
    refreshSelection();
  }

  function onlyCurrentPage() {
    if (!state.rows.length) return;
    if (state.candidateLines > state.rows.length) {
      if (!window.confirm(`仅保留当前页 ${state.rows.length} 行，其余 ${state.candidateLines - state.rows.length} 行将被排除。继续？`)) return;
    }
    state.selectionMode = 'only_selected';
    state.excludedRows.clear();
    state.includedRows = new Map(pageRefs().map((ref) => [rowKey(ref), ref]));
    refreshSelection();
  }

  function restoreAllRows() {
    resetRowSelection();
    dom.selectionNotice.hidden = true;
    refreshSelection();
  }

  async function exportStandard() {
    if (state.exporting || !state.includedLines) return;
    const spec = collectSpec();
    state.exporting = true;
    showError('');
    renderSummary();
    try {
      const response = await fetch(`${API}/${state.reportMode ? 'report' : 'export'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...spec,
          expectedCandidateLineCount: state.expectedCandidateLines
        })
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (response.status === 409) {
        showError('数据或筛选结果已变化，请重新预览后再导出。');
        return;
      }
      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        showError(payload.error || '导出失败，请重试。');
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      let filename = state.reportMode ? '分析报告.xlsx' : '标准序时账.xlsx';
      const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
        || /filename="?([^";]+)"?/i.exec(disposition);
      if (match) {
        try { filename = decodeURIComponent(match[1]); } catch (_) { filename = match[1]; }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showToast(state.reportMode ? '完整分析报告已生成，正在下载。' : '标准序时账已生成，正在下载。');
    } catch (error) {
      showError('导出失败，请重试。');
    } finally {
      state.exporting = false;
      renderSummary();
    }
  }

  function bind() {
    dom.recommendedColumns.addEventListener('click', () => setColumns(recommendedColumnIds()));
    dom.removeEmptyColumns.addEventListener('click', () => {
      if (!state.columnStats) return showToast('请先加载预览，再检测空白列。');
      setColumns(state.columns.filter((id) => !state.columnStats[id]?.entirely_empty));
    });
    dom.selectAllColumns.addEventListener('click', () => setColumns(state.defaultColumnOrder));
    dom.clearAllColumns.addEventListener('click', () => setColumns([]));
    dom.resetColumns.addEventListener('click', () => setColumns(recommendedColumnIds()));
    dom.excludePage.addEventListener('click', excludeCurrentPage);
    dom.restorePage.addEventListener('click', restoreCurrentPage);
    dom.onlyPage.addEventListener('click', onlyCurrentPage);
    dom.restoreAllRows.addEventListener('click', restoreAllRows);
    dom.openColumnSettings.addEventListener('click', () => {
      if (typeof dom.columnDialog.showModal === 'function') dom.columnDialog.showModal();
      else dom.columnDialog.setAttribute('open', '');
      renderColumns();
    });
    dom.closeColumnSettings.addEventListener('click', () => {
      if (typeof dom.columnDialog.close === 'function') dom.columnDialog.close();
      else dom.columnDialog.removeAttribute('open');
    });
    dom.columnDialog.addEventListener('click', (event) => {
      if (event.target === dom.columnDialog) dom.closeColumnSettings.click();
    });
    dom.standardExportButton.addEventListener('click', exportStandard);
    dom.rowPagePrev.addEventListener('click', () => {
      if (state.page > 1) loadPreview({ page: state.page - 1 });
    });
    dom.rowPageNext.addEventListener('click', () => {
      if (state.page < state.totalPages) loadPreview({ page: state.page + 1 });
    });
    dom.rowPageSize.addEventListener('change', () => {
      state.pageSize = Number(dom.rowPageSize.value) || 50;
      loadPreview({ page: 1 });
    });
    dom.widePreview.addEventListener('click', () => {
      state.wide = !state.wide;
      dom.previewCard.classList.toggle('wide', state.wide);
      dom.widePreview.textContent = state.wide ? '退出宽屏' : '宽屏预览';
    });
  }

  async function init() {
    bind();
    try {
      state.meta = await api(`${API}/meta`);
    } catch (_) {
      state.meta = null;
    }
    initColumns();
    const loaded = await loadScope();
    if (!loaded) return;
    await loadPreview({ page: 1 });
  }

  init();
})();

'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const API = '/api/journal-entry-splits';
  const CHILD_API = '/api/journal-entry-analyses';
  const BATCH_API = '/api/journal-entry-batches';
  const DIMENSION_FIELDS = {
    source: 'source_file',
    entity: 'entity',
    month: 'month',
    period: 'period',
    account: 'account',
    customer: 'customer',
    supplier: 'supplier',
    counterparty: 'counterparty'
  };
  const GROUP_LABELS = {
    account: '科目', customer: '客户', supplier: '供应商', counterparty: '往来单位',
    month: '月份', period: '会计期间', entity: '主体', source_file: '来源文件'
  };
  const LABELS = {
    source: '来源文件', entity: '主体', month: '月份', period: '会计期间',
    account: '科目', customer: '客户', supplier: '供应商', counterparty: '往来单位'
  };

  const dom = {
    scopeTitle: $('#scopeTitle'), scopeSubtitle: $('#scopeSubtitle'), scopeBadge: $('#scopeBadge'),
    scopeError: $('#scopeError'), back: $('#splitBackLink'),
    groupLevels: $('#groupLevels'), addGroupLevel: $('#addGroupLevel'),
    accountPrefixControl: $('#accountPrefixControl'),
    accountPrefixLength: $('#accountPrefixLength'), outputMode: $('#outputMode'),
    presetSelect: $('#presetSelect'), applyPreset: $('#applyPreset'),
    savePreset: $('#savePreset'), managePresets: $('#managePresets'),
    presetBackdrop: $('#presetBackdrop'), presetSaveModal: $('#presetSaveModal'),
    presetName: $('#presetName'), presetSaveError: $('#presetSaveError'),
    confirmPresetSave: $('#confirmPresetSave'), cancelPresetSave: $('#cancelPresetSave'),
    closePresetSave: $('#closePresetSave'), presetManageModal: $('#presetManageModal'),
    presetList: $('#presetList'), closePresetManage: $('#closePresetManage'),
    rowMode: $('#rowMode'), groupHint: $('#groupHint'),
    columnHint: $('#columnHint'), columnCount: $('#columnCount'), columnGroups: $('#columnGroups'),
    columnOrder: $('#columnOrder'), recommendedColumns: $('#recommendedColumns'),
    removeEmptyColumns: $('#removeEmptyColumns'), selectAllColumns: $('#selectAllColumns'),
    clearAllColumns: $('#clearAllColumns'), resetColumns: $('#resetColumns'),
    previewButton: $('#previewButton'), generateButton: $('#generateSplitButton'),
    splitError: $('#splitError'), previewCard: $('#previewCard'), previewSubtitle: $('#previewSubtitle'),
    previewLimit: $('#previewLimit'), splitMetrics: $('#splitMetrics'),
    splitWarning: $('#splitWarning'), splitGroupTable: $('#splitGroupTable'),
    outputCard: $('#outputCard'), outputMeta: $('#outputMeta'), download: $('#splitDownload'),
    deleteOutput: $('#deleteSplitOutput'),
    toast: $('#splitToast'), dateFrom: $('#dateFrom'), dateTo: $('#dateTo'),
    debitMin: $('#debitMin'), debitMax: $('#debitMax'), creditMin: $('#creditMin'), creditMax: $('#creditMax'),
    rowStatus: $('#rowStatus'), rowTableWrap: $('#rowTableWrap'), rowPagination: $('#rowPagination'),
    rowPagePrev: $('#rowPagePrev'), rowPageNext: $('#rowPageNext'), rowPageInfo: $('#rowPageInfo'),
    rowPageSize: $('#rowPageSize'), selectionNotice: $('#selectionNotice'),
    excludePage: $('#excludePage'), restorePage: $('#restorePage'), onlyPage: $('#onlyPage'),
    restoreAllRows: $('#restoreAllRows'), widePreview: $('#widePreview'),
    previewCard: $('#previewCard'), generateButton: $('#generateSplitButton')
  };

  const GROUP_OPTIONS = [
    ['account', '按科目'], ['customer', '按客户'], ['supplier', '按供应商'],
    ['counterparty', '按往来单位'], ['month', '按月份'], ['period', '按会计期间'],
    ['entity', '按主体'], ['source_file', '按来源文件']
  ];

  const state = {
    scopeType: '',
    scopeId: '',
    scope: null,
    meta: null,
    selected: {},
    labels: {},
    multiRender: {},
    levels: ['account'],
    preview: null,
    output: null,
    generating: false,
    groupAvailability: {},
    unavailableGroups: [],
    columnDefs: [],
    columnGroups: [],
    defaultColumnOrder: [],
    columns: [],
    columnStats: null,
    columnsDirty: false,
    rows: [],
    page: 1,
    pageSize: 50,
    totalPages: 0,
    candidateLines: 0,
    includedLines: 0,
    excludedLines: 0,
    candidateVouchers: 0,
    includedVouchers: 0,
    selectionMode: 'all_except',
    excludedRows: new Map(),
    includedRows: new Map(),
    rowsLoading: false,
    refreshTimer: null,
    requestToken: 0,
    expectedCandidateLines: null,
    wide: false,
    presets: [],
    builtinPresets: [],
    presetId: null,
    presetName: null,
    toastTimer: null,
    debounce: {}
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

  function showError(node, message) {
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
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
        const error = new Error(payload.error || payload.message || `请求失败 (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    });
  }

  function rowKey(ref) {
    return `${ref.job_id || ''}\u0000${ref.internal_line_key || ''}`;
  }

  function rowRef(row) {
    return { job_id: row.job_id, internal_line_key: row.internal_line_key };
  }

  function selectionSize() {
    return state.selectionMode === 'only_selected'
      ? state.includedRows.size
      : state.excludedRows.size;
  }

  function resetRowSelection() {
    state.excludedRows.clear();
    state.includedRows.clear();
    state.selectionMode = 'all_except';
  }

  function invalidatePreview({ resetSelection = false, notice = '' } = {}) {
    if (resetSelection && selectionSize()) {
      resetRowSelection();
      showSelectionNotice(notice || '筛选条件已变化，之前的手工行排除已重置。');
    } else if (resetSelection) {
      resetRowSelection();
    }
    state.preview = null;
    state.columnStats = null;
    state.rows = [];
    state.page = 1;
    state.totalPages = 0;
    state.candidateLines = 0;
    state.includedLines = 0;
    state.excludedLines = 0;
    state.expectedCandidateLines = null;
    renderColumns();
    dom.previewCard.hidden = true;
    dom.generateButton.disabled = true;
    dom.generateButton.textContent = '生成拆分文件';
    showError(dom.splitError, '');
  }

  function showSelectionNotice(message) {
    if (!dom.selectionNotice) return;
    dom.selectionNotice.textContent = message || '';
    dom.selectionNotice.hidden = !message;
  }

  function previewErrorMessage(error) {
    if (!error) return '无法加载导出预览，请重试。';
    if (/failed to fetch|networkerror|load failed/i.test(String(error.message || ''))) {
      return '无法加载导出预览，请重试。';
    }
    return error.message || '无法加载导出预览，请重试。';
  }

  function makeMulti(container, key) {
    const inputId = `filter-${key}-input`;
    const box = el('div', 'multi-box');
    const input = el('input');
    input.id = inputId;
    input.type = 'text';
    input.placeholder = `搜索${LABELS[key]}…`;
    input.autocomplete = 'off';
    const suggestions = el('div', 'split-suggestions');
    suggestions.hidden = true;
    const selectedContainer = el('span');
    selectedContainer.style.display = 'contents';
    box.append(selectedContainer, input);
    container.append(box, suggestions);
    state.selected[key] = new Map();

    function renderChips() {
      clear(selectedContainer);
      state.selected[key].forEach((label, value) => {
        const chip = el('span', 'split-chip');
        chip.dataset.value = value;
        chip.append(document.createTextNode(label || value));
        const remove = el('button', '', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `移除 ${label || value}`);
        remove.addEventListener('click', () => {
          state.selected[key].delete(value);
          renderChips();
          invalidatePreview({ resetSelection: true });
        });
        chip.append(remove);
        selectedContainer.append(chip);
      });
    }

    async function search() {
      const q = input.value.trim();
      try {
        const payload = await api(
          `${API}/dimensions?scopeType=${encodeURIComponent(state.scopeType)}&scopeId=${encodeURIComponent(state.scopeId)}&dimension=${encodeURIComponent(DIMENSION_FIELDS[key])}&q=${encodeURIComponent(q)}&limit=30`
        );
        clear(suggestions);
        if (!payload.options.length) {
          suggestions.append(el('div', 'split-suggestion empty', '没有匹配选项'));
        } else {
          payload.options.forEach((option) => {
            if (state.selected[key].has(option.value)) return;
            const button = el('button', 'split-suggestion');
            button.type = 'button';
            button.dataset.value = option.value;
            button.append(el('span', '', option.label || option.value));
            button.append(el('small', '', `${option.count}`));
            button.addEventListener('click', () => {
              state.selected[key].set(option.value, option.label || option.value);
              renderChips();
              input.value = '';
              suggestions.hidden = true;
              invalidatePreview({ resetSelection: true });
            });
            suggestions.append(button);
          });
        }
        suggestions.hidden = false;
      } catch (error) {
        clear(suggestions);
        suggestions.append(el('div', 'split-suggestion empty', error.message || '加载失败'));
        suggestions.hidden = false;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(state.debounce[key]);
      state.debounce[key] = setTimeout(search, 250);
    });
    input.addEventListener('focus', search);
    input.addEventListener('blur', () => setTimeout(() => { suggestions.hidden = true; }, 160));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') suggestions.hidden = true;
    });
    return { renderChips };
  }

  function selectedValues(key) {
    return [...(state.selected[key]?.keys() || [])];
  }

  function collectFilters() {
    const filters = {};
    Object.keys(DIMENSION_FIELDS).forEach((key) => {
      const values = selectedValues(key);
      if (!values.length) return;
      if (key === 'source') filters.source_files = values;
      else if (key === 'entity') filters.entities = values;
      else if (key === 'month') filters.months = values;
      else if (key === 'period') filters.periods = values;
      else filters[`${key}_values`] = values;
    });
    if (dom.dateFrom.value) filters.date_from = dom.dateFrom.value;
    if (dom.dateTo.value) filters.date_to = dom.dateTo.value;
    if (dom.debitMin.value) filters.debit_min = dom.debitMin.value;
    if (dom.debitMax.value) filters.debit_max = dom.debitMax.value;
    if (dom.creditMin.value) filters.credit_min = dom.creditMin.value;
    if (dom.creditMax.value) filters.credit_max = dom.creditMax.value;
    return filters;
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

  function emptySelectedCount() {
    if (!state.columnStats) return 0;
    return state.columns.filter((id) => state.columnStats[id]?.entirely_empty).length;
  }

  function setColumns(columns, { dirty = true } = {}) {
    state.columns = [...new Set(columns)].filter((id) => state.columnDefs.some((item) => item.id === id));
    state.columnsDirty = dirty;
    renderColumns();
    if (state.preview) {
      renderRowTable();
      renderPagination();
    }
  }

  function recommendedColumnIds() {
    if (!state.columnDefs.length) return [];
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
    const emptyCount = emptySelectedCount();
    dom.removeEmptyColumns.textContent = emptyCount
      ? `取消勾选全部空白列（${emptyCount}）`
      : '取消勾选全部空白列';
    dom.removeEmptyColumns.disabled = !state.columnStats;
    dom.columnHint.textContent = state.columnStats
      ? `已选 ${state.columns.length} 列。空白统计基于当前筛选后的 ${state.columnStats[state.columnDefs[0].id]?.total_count ?? 0} 条分录。`
      : '预览后将基于筛选后的数据检测空白列；推荐列会自动包含有数据的业务字段。';

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
        const stat = el('span', `column-stat ${status.tone}`.trim(), status.text);
        row.append(label, stat);
        box.append(row);
      });
      dom.columnGroups.append(box);
    }

    clear(dom.columnOrder);
    if (!state.columns.length) {
      dom.columnOrder.append(el('span', 'empty-note', '至少选择 1 个导出字段。'));
    }
    state.columns.forEach((id, index) => {
      const chip = el('span', 'column-chip');
      chip.append(el('span', '', columnLabel(id)));
      const up = el('button', '', '▲');
      up.type = 'button';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `上移 ${columnLabel(id)}`);
      up.addEventListener('click', () => {
        if (index === 0) return;
        const next = state.columns.slice();
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        setColumns(next);
      });
      const down = el('button', '', '▼');
      down.type = 'button';
      down.disabled = index === state.columns.length - 1;
      down.setAttribute('aria-label', `下移 ${columnLabel(id)}`);
      down.addEventListener('click', () => {
        if (index === state.columns.length - 1) return;
        const next = state.columns.slice();
        [next[index + 1], next[index]] = [next[index], next[index + 1]];
        setColumns(next);
      });
      const remove = el('button', 'remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除 ${columnLabel(id)}`);
      remove.addEventListener('click', () => setColumns(state.columns.filter((item) => item !== id)));
      chip.append(up, down, remove);
      dom.columnOrder.append(chip);
    });
    if (state.preview) {
      dom.generateButton.disabled = !state.columns.length
        || state.preview.limit_exceeded
        || !state.includedLines
        || state.generating
        || state.rowsLoading;
      dom.generateButton.textContent = generateButtonLabel();
      renderRowTable();
    }
    dom.previewButton.disabled = !state.columns.length || state.unavailableGroups.length > 0;
  }

  function initColumns() {
    const meta = state.meta || {};
    state.columnDefs = Array.isArray(meta.columns) ? meta.columns : [];
    state.columnGroups = Array.isArray(meta.columnGroups) ? meta.columnGroups : [];
    state.defaultColumnOrder = Array.isArray(meta.defaultColumnOrder)
      ? meta.defaultColumnOrder
      : state.columnDefs.map((item) => item.id);
    state.columns = state.columnDefs.filter((item) => item.default).map((item) => item.id);
    state.columnStats = null;
    state.columnsDirty = false;
    renderColumns();
  }

  function collectSpec() {
    const groupOptions = {};
    if (state.levels.includes('account') && dom.accountPrefixLength.value) {
      const prefix = Number(dom.accountPrefixLength.value);
      if (!Number.isInteger(prefix) || prefix < 1 || prefix > 20) {
        throw new Error('科目级次必须在 1–20 之间。');
      }
      groupOptions.account_prefix_length = prefix;
    }
    return {
      scopeType: state.scopeType,
      scopeId: state.scopeId,
      filters: collectFilters(),
      groupBy: state.levels.slice(),
      groupOptions,
      rowMode: 'matched_only',
      outputMode: dom.outputMode.value,
      columns: state.columnsDirty ? state.columns.slice() : undefined,
      rowSelectionMode: state.selectionMode,
      excludedRows: state.selectionMode === 'all_except'
        ? [...state.excludedRows.values()]
        : [],
      includedRows: state.selectionMode === 'only_selected'
        ? [...state.includedRows.values()]
        : []
    };
  }

  function buildSpecPayload() {
    return collectSpec();
  }

  function renderScope() {
    const scope = state.scope;
    if (!scope) return;
    if (state.scopeType === 'job') {
      dom.scopeTitle.textContent = scope.originalFilename || '单文件任务';
      dom.scopeSubtitle.textContent = `单文件 · 已完成 · ${scope.sheetName || ''} · ${scope.completedAt ? new Date(scope.completedAt).toLocaleString('zh-CN') : ''}`;
      dom.scopeBadge.textContent = 'JOB';
      dom.back.href = `index.html?job=${encodeURIComponent(state.scopeId)}`;
    } else {
      dom.scopeTitle.textContent = scope.name || '批量任务';
      dom.scopeSubtitle.textContent = `批量 · 已完成 ${scope.completedCount} / ${scope.totalCount} 个文件`;
      dom.scopeBadge.textContent = 'BATCH';
      dom.back.href = `batch.html?batch=${encodeURIComponent(state.scopeId)}`;
    }
  }

  async function loadScope() {
    const params = new URLSearchParams(window.location.search);
    state.scopeType = params.get('scopeType') || 'job';
    state.scopeId = params.get('scopeId') || '';
    if (!/^[0-9a-f-]{36}$/i.test(state.scopeId) || !['job', 'batch'].includes(state.scopeType)) {
      showError(dom.scopeError, '数据范围无效。');
      return false;
    }
    try {
      if (state.scopeType === 'job') {
        const payload = await api(`${CHILD_API}/${encodeURIComponent(state.scopeId)}`);
        state.scope = payload.job;
        if (payload.job.status !== 'completed') {
          showError(dom.scopeError, '该任务尚未完成，无法筛选拆分。');
          return false;
        }
      } else {
        const payload = await api(`${BATCH_API}/${encodeURIComponent(state.scopeId)}`);
        state.scope = payload.batch;
        if (!payload.batch.completedCount) {
          showError(dom.scopeError, '批量任务没有已完成文件，无法筛选拆分。');
          return false;
        }
      }
      renderScope();
      return true;
    } catch (error) {
      showError(dom.scopeError, error.message || '无法加载数据范围。');
      return false;
    }
  }

  async function ensureDimensionAvailability(dimension) {
    if (!['account', 'customer', 'supplier', 'counterparty'].includes(dimension)) return;
    if (state.groupAvailability[dimension]) return;
    try {
      const payload = await api(
        `${API}/dimensions?scopeType=${encodeURIComponent(state.scopeType)}&scopeId=${encodeURIComponent(state.scopeId)}&dimension=${encodeURIComponent(dimension)}&limit=1`
      );
      state.groupAvailability[dimension] = payload;
    } catch (_) {
      state.groupAvailability[dimension] = { options: [], blank_count: 0 };
    }
  }

  async function loadGroupAvailability() {
    const entries = [...new Set(state.levels.filter((dimension) => (
      ['account', 'customer', 'supplier', 'counterparty'].includes(dimension)
    )))];
    await Promise.all(entries.map((dimension) => ensureDimensionAvailability(dimension)));
    updateGroupOptions();
  }

  function dimensionAvailable(dimension) {
    const info = state.groupAvailability[dimension];
    if (!info) return true;
    if (['customer', 'supplier', 'counterparty', 'account'].includes(dimension)) {
      return !(info.options.length === 0 && info.blank_count > 0);
    }
    return true;
  }

  function renderGroupLevels() {
    clear(dom.groupLevels);
    state.levels.forEach((dimension, index) => {
      const row = el('div', 'split-level');
      row.append(el('span', 'level-no', index + 1));
      const select = el('select');
      select.dataset.levelIndex = String(index);
      GROUP_OPTIONS.forEach(([value, label]) => {
        const option = el('option', '', label);
        option.value = value;
        option.disabled = !dimensionAvailable(value);
        select.append(option);
      });
      select.value = dimension;
      select.addEventListener('change', () => {
        state.levels[index] = select.value;
        updateGroupHint();
        renderGroupLevels();
        ensureDimensionAvailability(select.value).then(() => {
          if (state.levels[index] === select.value) updateGroupOptions();
        });
      });
      row.append(select);
      const actions = el('div', 'level-actions');
      const up = el('button', '', '▲');
      up.type = 'button';
      up.setAttribute('aria-label', '上移');
      up.disabled = index === 0;
      up.addEventListener('click', () => {
        [state.levels[index - 1], state.levels[index]] = [state.levels[index], state.levels[index - 1]];
        renderGroupLevels();
        updateGroupHint();
      });
      const down = el('button', '', '▼');
      down.type = 'button';
      down.setAttribute('aria-label', '下移');
      down.disabled = index === state.levels.length - 1;
      down.addEventListener('click', () => {
        [state.levels[index + 1], state.levels[index]] = [state.levels[index], state.levels[index + 1]];
        renderGroupLevels();
        updateGroupHint();
      });
      const remove = el('button', '', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', '删除层级');
      remove.disabled = state.levels.length === 1;
      remove.addEventListener('click', () => {
        state.levels.splice(index, 1);
        renderGroupLevels();
        updateGroupHint();
      });
      actions.append(up, down, remove);
      row.append(actions);
      dom.groupLevels.append(row);
    });
    dom.addGroupLevel.disabled = state.levels.length >= 3;
  }

  function updateGroupOptions() {
    state.unavailableGroups = state.levels.filter((dimension) => !dimensionAvailable(dimension));
    renderGroupLevels();
    updateGroupHint({ invalidate: false });
  }

  function updateGroupHint({ invalidate = true } = {}) {
    dom.accountPrefixControl.hidden = !state.levels.includes('account');
    state.unavailableGroups = state.levels.filter((dimension) => !dimensionAvailable(dimension));
    if (state.unavailableGroups.length) {
      const names = state.unavailableGroups.map((dimension) => GROUP_LABELS[dimension]).join('、');
      dom.groupHint.textContent = `当前数据未映射${names}字段，无法按所选维度拆分。请返回字段映射后重新分析，或调整拆分层级。`;
      dom.previewButton.disabled = true;
    } else if (state.levels.includes('account')) {
      dom.groupHint.textContent = '科目拆分按编码优先；填写前 N 位可合并明细科目。留空表示完整科目。';
      dom.previewButton.disabled = false;
    } else {
      const blanks = state.levels.filter((dimension) => {
        const info = state.groupAvailability[dimension];
        return info && info.blank_count > 0;
      });
      dom.groupHint.textContent = blanks.length
        ? `${blanks.map((dimension) => GROUP_LABELS[dimension]).join('、')}存在空值，将进入“未指定”分组。`
        : '';
      dom.previewButton.disabled = false;
    }
    if (invalidate) invalidatePreview({ resetSelection: false });
  }

  function renderPresetSelect() {
    if (!dom.presetSelect) return;
    const current = dom.presetSelect.value;
    dom.presetSelect.replaceChildren();
    const blank = el('option', '', '选择模板…');
    blank.value = '';
    dom.presetSelect.append(blank);
    if (state.builtinPresets.length) {
      const group = el('optgroup');
      group.label = '内置模板';
      state.builtinPresets.forEach((preset) => {
        const option = el('option', '', preset.name);
        option.value = `builtin:${preset.id}`;
        group.append(option);
      });
      dom.presetSelect.append(group);
    }
    if (state.presets.length) {
      const group = el('optgroup');
      group.label = '我的模板';
      state.presets.forEach((preset) => {
        const option = el('option', '', preset.name);
        option.value = `user:${preset.id}`;
        group.append(option);
      });
      dom.presetSelect.append(group);
    }
    if ([...dom.presetSelect.options].some((option) => option.value === current)) {
      dom.presetSelect.value = current;
    }
  }

  async function loadPresets() {
    state.builtinPresets = state.meta?.builtinPresets || [];
    try {
      const payload = await api('/api/journal-entry-split-presets');
      state.presets = payload.presets || [];
    } catch (_) {
      state.presets = [];
    }
    renderPresetSelect();
  }

  function resetFilterSelections() {
    Object.keys(state.selected).forEach((key) => state.selected[key].clear());
    Object.values(state.multiRender).forEach((render) => render());
    [dom.dateFrom, dom.dateTo, dom.debitMin, dom.debitMax, dom.creditMin, dom.creditMax].forEach((input) => {
      input.value = '';
    });
  }

  function applyFilterSpec(filters) {
    const map = {
      source_files: 'source', entities: 'entity', months: 'month', periods: 'period',
      account_values: 'account', customer_values: 'customer',
      supplier_values: 'supplier', counterparty_values: 'counterparty'
    };
    Object.entries(map).forEach(([key, dimension]) => {
      (filters?.[key] || []).forEach((value) => {
        state.selected[dimension].set(String(value), String(value));
      });
    });
    Object.values(state.multiRender).forEach((render) => render());
    dom.dateFrom.value = filters?.date_from || '';
    dom.dateTo.value = filters?.date_to || '';
    dom.debitMin.value = filters?.debit_min ?? '';
    dom.debitMax.value = filters?.debit_max ?? '';
    dom.creditMin.value = filters?.credit_min ?? '';
    dom.creditMax.value = filters?.credit_max ?? '';
  }

  async function applyPreset() {
    const value = dom.presetSelect.value;
    if (!value) return;
    const [kind, id] = value.split(':');
    const preset = kind === 'builtin'
      ? state.builtinPresets.find((item) => String(item.id) === id)
      : state.presets.find((item) => String(item.id) === id);
    if (!preset) return;
    resetRowSelection();
    showSelectionNotice('');
    const spec = preset.spec || {};
    const groupBy = Array.isArray(spec.groupBy) ? spec.groupBy : [spec.groupBy || 'account'];
    resetFilterSelections();
    applyFilterSpec(spec.filters || {});
    state.levels = groupBy.filter(Boolean).slice(0, 3);
    if (!state.levels.length) state.levels = ['account'];
    dom.accountPrefixLength.value = spec.groupOptions?.account_prefix_length || '';
    dom.outputMode.value = spec.outputMode || 'multi_sheet';
    dom.rowMode.value = 'matched_only';
    state.presetId = preset.id;
    state.presetName = preset.name;
    state.columnStats = null;
    if (Array.isArray(spec.columns) && spec.columns.length) {
      state.columns = spec.columns.slice();
      state.columnsDirty = true;
    } else {
      state.columns = state.columnDefs.filter((item) => item.default).map((item) => item.id);
      state.columnsDirty = false;
    }
    renderColumns();
    renderGroupLevels();
    await Promise.all(state.levels.map((dimension) => ensureDimensionAvailability(dimension)));
    updateGroupOptions();
    if (state.unavailableGroups.length) {
      const names = state.unavailableGroups.map((dimension) => GROUP_LABELS[dimension]).join('、');
      showError(dom.splitError, `该模板需要${names}字段，但当前数据未映射，无法预览。`);
    }
    showToast(`已应用模板：${preset.name}。请重新预览。`);
  }

  function openPresetSave() {
    dom.presetName.value = state.presetName || '';
    showError(dom.presetSaveError, '');
    dom.presetBackdrop.hidden = false;
    dom.presetSaveModal.hidden = false;
    dom.presetName.focus();
  }

  function closePresetSave() {
    dom.presetBackdrop.hidden = true;
    dom.presetSaveModal.hidden = true;
  }

  async function savePreset() {
    const name = dom.presetName.value.trim();
    if (!name) {
      showError(dom.presetSaveError, '请输入模板名称。');
      return;
    }
    let spec;
    try {
      spec = collectSpec();
    } catch (error) {
      showError(dom.presetSaveError, error.message);
      return;
    }
    const body = {
      name,
      spec: {
        filters: spec.filters,
        groupBy: spec.groupBy,
        groupOptions: spec.groupOptions,
        rowMode: spec.rowMode,
        outputMode: spec.outputMode,
        columns: state.columns.slice()
      }
    };
    dom.confirmPresetSave.disabled = true;
    try {
      const payload = await api('/api/journal-entry-split-presets', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      state.presetId = payload.preset.id;
      state.presetName = payload.preset.name;
      await loadPresets();
      dom.presetSelect.value = `user:${payload.preset.id}`;
      closePresetSave();
      showToast('拆分模板已保存。');
    } catch (error) {
      showError(dom.presetSaveError, error.message || '保存模板失败。');
    } finally {
      dom.confirmPresetSave.disabled = false;
    }
  }

  function renderPresetList() {
    clear(dom.presetList);
    if (!state.presets.length) {
      dom.presetList.append(el('div', 'preset-empty', '还没有保存的模板。'));
      return;
    }
    state.presets.forEach((preset) => {
      const row = el('div', 'preset-row');
      const info = el('div');
      info.append(el('strong', '', preset.name));
      const groupBy = (preset.spec?.groupBy || []).map((dimension) => GROUP_LABELS[dimension] || dimension).join(' + ');
      info.append(el('small', '', `${groupBy || '—'} · ${preset.spec?.outputMode || 'multi_sheet'}`));
      row.append(info);
      const actions = el('div', 'preset-actions');
      const rename = el('button', '', '重命名');
      rename.type = 'button';
      rename.addEventListener('click', async () => {
        const next = window.prompt('新的模板名称', preset.name);
        if (!next || !next.trim()) return;
        try {
          await api(`/api/journal-entry-split-presets/${encodeURIComponent(preset.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: next.trim() })
          });
          await loadPresets();
          renderPresetList();
          showToast('模板已重命名。');
        } catch (error) {
          showToast(error.message || '重命名失败。');
        }
      });
      const remove = el('button', '', '删除');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`删除模板「${preset.name}」？`)) return;
        try {
          await api(`/api/journal-entry-split-presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' });
          if (state.presetId === preset.id) { state.presetId = null; state.presetName = null; }
          await loadPresets();
          renderPresetList();
          showToast('模板已删除。');
        } catch (error) {
          showToast(error.message || '删除失败。');
        }
      });
      actions.append(rename, remove);
      row.append(actions);
      dom.presetList.append(row);
    });
  }

  async function openPresetManage() {
    await loadPresets();
    renderPresetList();
    dom.presetBackdrop.hidden = false;
    dom.presetManageModal.hidden = false;
  }

  function closePresetManage() {
    dom.presetBackdrop.hidden = true;
    dom.presetManageModal.hidden = true;
  }

  function metric(label, value, note, key) {
    const box = el('div', 'metric');
    if (key) box.dataset.metric = key;
    box.append(el('span', '', label));
    box.append(el('strong', '', value));
    if (note) box.append(el('small', '', note));
    return box;
  }

  function displayCell(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  function renderRowTable() {
    if (!dom.rowTableWrap) return;
    clear(dom.rowTableWrap);
    if (!state.preview) {
      dom.rowTableWrap.append(el('div', 'table-skeleton', '正在加载导出预览…'));
      return;
    }
    if (!state.rows.length) {
      dom.rowTableWrap.append(el('div', 'table-skeleton', '当前筛选结果没有数据。'));
      return;
    }
    const table = el('table', 'row-preview-table');
    const thead = el('thead');
    const head = el('tr');
    head.append(el('th', 'select-cell', '保留'));
    state.columns.forEach((id) => {
      head.append(el('th', '', columnLabel(id)));
    });
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
        if (!row.included) {
          const tag = el('span', 'excluded-tag', '已排除');
          cell.append(tag);
        }
        cell.title = displayCell(row.values?.[id]);
        tr.append(cell);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    dom.rowTableWrap.append(table);
  }

  function renderPagination() {
    if (!dom.rowPagination) return;
    const pages = state.totalPages || (state.candidateLines ? 1 : 0);
    dom.rowPageInfo.textContent = pages
      ? `第 ${state.page} / ${pages} 页 · 共 ${state.candidateLines} 行`
      : '没有可预览的行';
    dom.rowPagePrev.disabled = state.page <= 1 || state.rowsLoading;
    dom.rowPageNext.disabled = !pages || state.page >= pages || state.rowsLoading;
    dom.rowPageSize.value = String(state.pageSize);
  }

  function renderSelectionSummary() {
    if (!state.preview) return;
    const modeLabel = state.selectionMode === 'only_selected' ? '仅保留选中' : '全部保留';
    dom.rowStatus.innerHTML = '';
    const parts = [
      ['筛选匹配', state.candidateLines, ' 行'],
      ['已保留', state.includedLines, ' 行'],
      ['已排除', state.excludedLines, ' 行'],
      ['涉及凭证', state.includedVouchers, '']
    ];
    parts.forEach(([label, value, suffix]) => {
      const item = el('span', '');
      item.append(document.createTextNode(`${label} `));
      item.append(el('strong', '', `${value}${suffix}`));
      dom.rowStatus.append(item, document.createTextNode(' · '));
    });
    const mode = el('span', '');
    mode.append(document.createTextNode('模式：'));
    mode.append(el('strong', '', modeLabel));
    dom.rowStatus.append(mode);
    if (state.rowsLoading) {
      dom.rowStatus.append(document.createTextNode(' · '), el('strong', '', '正在重新计算…'));
    }
    dom.excludePage.disabled = state.rowsLoading || !state.rows.length;
    dom.restorePage.disabled = state.rowsLoading || !state.rows.length || selectionSize() === 0;
    dom.onlyPage.disabled = state.rowsLoading || !state.rows.length;
    dom.restoreAllRows.disabled = state.rowsLoading || selectionSize() === 0;
  }

  function generateButtonLabel() {
    if (state.generating) return '正在生成…';
    if (dom.outputMode.value === 'zip') {
      const count = state.preview?.group_count ?? 0;
      return `生成 ZIP（${count} 个文件）`;
    }
    return '生成多 Sheet Excel';
  }

  function renderPreview() {
    const preview = state.preview;
    if (!preview) return;
    dom.previewCard.hidden = false;
    dom.previewSubtitle.textContent = `${state.candidateLines} 条候选中保留 ${state.includedLines} 条 · ${state.includedVouchers} 张凭证 · ${preview.group_count} 个组合分组`;
    dom.previewLimit.textContent = preview.limit_exceeded
      ? `超过上限 ${preview.limits.max_groups}`
      : state.includedLines
        ? '可以生成'
        : '无保留行';
    clear(dom.splitMetrics);
    dom.splitMetrics.append(
      metric('候选行', state.candidateLines, '', 'candidateLines'),
      metric('保留行', state.includedLines, '', 'matchedLines'),
      metric('排除行', state.excludedLines, '', 'excludedLines'),
      metric('保留凭证', state.includedVouchers, '', 'matchedVouchers'),
      metric('分组', preview.group_count, '', 'groupCount'),
      metric('来源文件', preview.completed_files || 1, '', 'completedFiles')
    );
    renderSelectionSummary();
    dirWarnings(preview);
    renderRowTable();
    renderPagination();
    renderColumns();
    dom.generateButton.disabled = state.generating
      || state.rowsLoading
      || !state.includedLines
      || !state.columns.length
      || preview.limit_exceeded;
    dom.generateButton.textContent = generateButtonLabel();
  }

  function dirWarnings(preview) {
    const warnings = [];
    if (preview.limit_exceeded) {
      warnings.push(`预计生成 ${preview.group_count} 个分组，超过当前输出上限 ${preview.limits.max_groups}。请增加筛选条件或选择更高层级分组。`);
    }
    if (preview.excluded && (preview.excluded.draft || preview.excluded.active || preview.excluded.failed)) {
      warnings.push(`批量中 ${preview.excluded.draft + preview.excluded.active + preview.excluded.failed} 个文件未参与（未完成 ${preview.excluded.draft} / 进行中 ${preview.excluded.active} / 失败 ${preview.excluded.failed}）。`);
    }
    if (preview.warnings?.includes('blank_group_included')) {
      warnings.push('存在空维度值，已归入“未指定”分组。');
    }
    if (state.excludedLines) {
      warnings.push(`已手工排除 ${state.excludedLines} 行；这些行不会进入任何 Excel 或 ZIP。`);
    }
    dom.splitWarning.hidden = warnings.length === 0;
    dom.splitWarning.textContent = warnings.join(' ');
    clear(dom.splitGroupTable);
    const table = el('table', 'split-table');
    const thead = el('thead');
    const head = el('tr');
    const dimensions = preview.dimensions || preview.groupBy || [];
    dimensions.forEach((dimension) => head.append(el('th', '', GROUP_LABELS[dimension] || dimension)));
    ['行数', '凭证数', '借方合计', '贷方合计'].forEach((label) => head.append(el('th', '', label)));
    thead.append(head);
    const tbody = el('tbody');
    if (!preview.groups.length) {
      const row = el('tr');
      const cell = el('td', 'empty', '没有匹配数据。');
      cell.colSpan = Math.max(5, dimensions.length + 4);
      row.append(cell);
      tbody.append(row);
    } else {
      preview.groups.forEach((group) => {
        const row = el('tr');
        dimensions.forEach((dimension) => {
          const value = group.values?.[dimension] ?? group.display_name ?? '—';
          row.append(el('td', 'split-group-name', value));
        });
        row.append(el('td', 'num', group.line_count));
        row.append(el('td', 'num', group.voucher_count));
        row.append(el('td', 'num', formatAmount(group.debit_total)));
        row.append(el('td', 'num', formatAmount(group.credit_total)));
        tbody.append(row);
      });
    }
    table.append(thead, tbody);
    dom.splitGroupTable.append(table);
  }

  function renderOutput() {
    const output = state.output;
    if (output?.status === 'generating') {
      dom.outputCard.hidden = false;
      dom.download.hidden = true;
      if (dom.deleteOutput) dom.deleteOutput.hidden = true;
      dom.outputMeta.textContent = '正在生成拆分文件…页面会自动刷新状态。';
      dom.generateButton.disabled = true;
      dom.generateButton.textContent = '正在生成…';
      setTimeout(() => {
        if (state.output?.status === 'generating') loadLatest();
      }, 2000);
      return;
    }
    if (!output || output.status !== 'completed') {
      dom.outputCard.hidden = !output;
      dom.download.hidden = true;
      if (dom.deleteOutput) dom.deleteOutput.hidden = !output || output.status === 'generating';
      if (output?.status === 'failed') {
        dom.outputCard.hidden = false;
        dom.outputMeta.textContent = output.error || '生成失败。';
      }
      return;
    }
    if (output.expired) {
      dom.outputCard.hidden = false;
      dom.download.hidden = true;
      if (dom.deleteOutput) dom.deleteOutput.hidden = true;
      dom.outputMeta.textContent = '拆分输出文件已过期，请重新生成。';
      if (!state.preview && !state.generating) {
        dom.generateButton.disabled = true;
      }
      return;
    }
    dom.outputCard.hidden = false;
    const snapshot = output.snapshot || {};
    const excluded = snapshot.excluded || {};
    const excludedCount = (excluded.draft || 0) + (excluded.active || 0) + (excluded.failed || 0);
    dom.outputMeta.textContent = `${output.completedAt ? new Date(output.completedAt).toLocaleString('zh-CN') : ''} · 包含 ${snapshot.matched_lines ?? '—'} 条分录 / ${snapshot.group_count ?? '—'} 个分组${excludedCount ? ` · ${excludedCount} 个文件未包含` : ''}`;
    dom.download.hidden = false;
    dom.download.href = output.download;
    if (dom.deleteOutput) dom.deleteOutput.hidden = false;
    if (!state.preview && !state.generating) {
      dom.generateButton.disabled = true;
      if (state.output?.status === 'completed') dom.generateButton.textContent = generateButtonLabel();
    }
  }

  async function loadLatest() {
    try {
      const payload = await api(`${API}/latest?scopeType=${encodeURIComponent(state.scopeType)}&scopeId=${encodeURIComponent(state.scopeId)}`);
      state.output = payload.output || null;
      renderOutput();
    } catch (_) {
      state.output = null;
      renderOutput();
    }
  }

  function applyPreviewPayload(payload) {
    state.preview = payload;
    state.columnStats = payload.column_stats || payload.columnStats || null;
    if (!state.columnsDirty && Array.isArray(payload.columns || payload.selected_columns)) {
      state.columns = (payload.columns || payload.selected_columns).slice();
      state.columnsDirty = true;
    }
    state.candidateLines = Number(payload.candidate_line_count || 0);
    state.includedLines = Number(payload.included_line_count || 0);
    state.excludedLines = Number(payload.excluded_line_count || 0);
    state.candidateVouchers = Number(payload.candidate_voucher_count || 0);
    state.includedVouchers = Number(payload.included_voucher_count || 0);
    state.page = Number(payload.page || 1);
    state.totalPages = Number(payload.total_pages || 0);
    state.rows = Array.isArray(payload.rows) ? payload.rows : [];
    state.selectionMode = payload.row_selection_mode || 'all_except';
    state.excludedRows = new Map(
      (payload.excluded_rows || []).map((ref) => [rowKey(ref), ref])
    );
    state.includedRows = new Map(
      (payload.included_rows || []).map((ref) => [rowKey(ref), ref])
    );
    state.expectedCandidateLines = state.candidateLines;
  }

  async function loadPreview({ page = 1, scroll = false } = {}) {
    showError(dom.splitError, '');
    if (state.unavailableGroups.length) {
      showError(dom.splitError, '所选拆分维度当前数据未映射，无法预览。');
      return;
    }
    let spec;
    try {
      spec = buildSpecPayload();
    } catch (error) {
      showError(dom.splitError, error.message);
      return;
    }
    const token = ++state.requestToken;
    state.rowsLoading = true;
    dom.previewButton.disabled = true;
    dom.previewButton.textContent = '正在加载预览…';
    dom.generateButton.disabled = true;
    try {
      const payload = await api(`${API}/preview-rows`, {
        method: 'POST',
        body: JSON.stringify({ ...spec, page, pageSize: state.pageSize })
      });
      if (token !== state.requestToken) return;
      applyPreviewPayload(payload);
      if (scroll) dom.previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (token !== state.requestToken) return;
      state.preview = null;
      state.rows = [];
      dom.previewCard.hidden = true;
      showError(dom.splitError, previewErrorMessage(error));
    } finally {
      if (token === state.requestToken) {
        state.rowsLoading = false;
        dom.previewButton.disabled = false;
        dom.previewButton.textContent = '加载导出预览';
        renderPreview();
      }
    }
  }

  async function preview() {
    await loadPreview({ page: 1, scroll: true });
  }

  async function refreshSelection() {
    if (!state.preview) return;
    let spec;
    try {
      spec = buildSpecPayload();
    } catch (error) {
      showError(dom.splitError, error.message);
      return;
    }
    const token = ++state.requestToken;
    state.rowsLoading = true;
    renderPreview();
    try {
      const payload = await api(`${API}/preview-rows`, {
        method: 'POST',
        body: JSON.stringify({
          ...spec,
          page: state.page,
          pageSize: state.pageSize
        })
      });
      if (token !== state.requestToken) return;
      applyPreviewPayload(payload);
    } catch (error) {
      if (token !== state.requestToken) return;
      showError(dom.splitError, previewErrorMessage(error));
    } finally {
      if (token === state.requestToken) {
        state.rowsLoading = false;
        renderPreview();
      }
    }
  }

  function scheduleSelectionRefresh() {
    clearTimeout(state.refreshTimer);
    state.rowsLoading = true;
    renderPreview();
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
        if (state.includedRows.size >= 5000) {
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
    renderSelectionSummary();
    scheduleSelectionRefresh();
  }

  function currentPageRefs() {
    return state.rows.map(rowRef);
  }

  function excludeCurrentPage() {
    if (!state.rows.length) return;
    if (state.selectionMode === 'all_except') {
      for (const ref of currentPageRefs()) state.excludedRows.set(rowKey(ref), ref);
    } else {
      for (const ref of currentPageRefs()) state.includedRows.delete(rowKey(ref));
      if (state.includedRows.size === 0) {
        showToast('至少保留 1 行；请改用筛选条件缩小范围。');
        refreshSelection();
        return;
      }
    }
    refreshSelection();
  }

  function restoreCurrentPage() {
    if (!state.rows.length) return;
    if (state.selectionMode === 'all_except') {
      for (const ref of currentPageRefs()) state.excludedRows.delete(rowKey(ref));
    } else {
      for (const ref of currentPageRefs()) {
        if (state.includedRows.size >= 5000) break;
        state.includedRows.set(rowKey(ref), ref);
      }
    }
    refreshSelection();
  }

  function onlyCurrentPage() {
    if (!state.rows.length) return;
    if (state.candidateLines > state.rows.length) {
      const ok = window.confirm(
        `仅保留当前页 ${state.rows.length} 行，其余 ${state.candidateLines - state.rows.length} 行将被排除。继续？`
      );
      if (!ok) return;
    }
    state.selectionMode = 'only_selected';
    state.excludedRows.clear();
    state.includedRows = new Map(currentPageRefs().map((ref) => [rowKey(ref), ref]));
    refreshSelection();
  }

  function restoreAllRows() {
    resetRowSelection();
    showSelectionNotice('');
    refreshSelection();
  }

  async function generate() {
    if (!state.preview || dom.generateButton.disabled) return;
    if (!state.includedLines) {
      showError(dom.splitError, '最终保留行为 0，无法生成。');
      return;
    }
    if (state.preview.group_count > 100 || state.includedLines > 50000) {
      const ok = window.confirm(
        `将生成 ${state.preview.group_count} 个分组 / 文件，共 ${state.includedLines} 行。继续生成？`
      );
      if (!ok) return;
    }
    let spec;
    try {
      spec = buildSpecPayload();
    } catch (error) {
      showError(dom.splitError, error.message);
      return;
    }
    state.generating = true;
    dom.generateButton.disabled = true;
    dom.generateButton.textContent = '正在生成…';
    dom.previewButton.disabled = true;
    showError(dom.splitError, '');
    try {
      const payload = await api(API, {
        method: 'POST',
        body: JSON.stringify({
          ...spec,
          expectedIncludedJobIds: state.preview.included_job_ids,
          expectedCandidateLineCount: state.expectedCandidateLines,
          presetId: state.presetId || undefined,
          presetName: state.presetName || undefined
        })
      });
      state.output = payload.output;
      renderOutput();
      showToast('拆分文件已提交后台生成。');
      dom.outputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (error.status === 409) {
        state.preview = null;
        dom.previewCard.hidden = true;
        dom.generateButton.disabled = true;
        showError(dom.splitError, '数据或筛选结果已变化，请重新预览后再生成。');
      } else {
        showError(dom.splitError, error.message || '生成失败。');
      }
    } finally {
      state.generating = false;
      dom.previewButton.disabled = false;
      if (state.preview) renderPreview();
      else {
        dom.generateButton.disabled = true;
        dom.generateButton.textContent = generateButtonLabel();
      }
      renderOutput();
    }
  }

  async function deleteSplitOutput() {
    if (!state.output) return;
    if (!window.confirm('删除此拆分输出文件？原分析结果和模板不会删除。')) return;
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.output.id)}`, { method: 'DELETE' });
      state.output = payload.output || null;
      renderOutput();
      showToast('拆分输出已删除。');
    } catch (error) {
      showError(dom.splitError, error.message || '删除拆分输出失败。');
    }
  }

  function bindEvents() {
    const multi = {};
    multi.source = makeMulti($('#filterSource'), 'source');
    multi.entity = makeMulti($('#filterEntity'), 'entity');
    multi.month = makeMulti($('#filterMonth'), 'month');
    multi.period = makeMulti($('#filterPeriod'), 'period');
    multi.account = makeMulti($('#filterAccount'), 'account');
    multi.customer = makeMulti($('#filterCustomer'), 'customer');
    multi.supplier = makeMulti($('#filterSupplier'), 'supplier');
    multi.counterparty = makeMulti($('#filterCounterparty'), 'counterparty');
    Object.entries(multi).forEach(([key, item]) => {
      state.multiRender[key] = item.renderChips;
    });

    [dom.dateFrom, dom.dateTo, dom.debitMin, dom.debitMax, dom.creditMin, dom.creditMax].forEach((input) => {
      input.addEventListener('input', () => invalidatePreview({ resetSelection: true }));
    });
    dom.addGroupLevel.addEventListener('click', () => {
      if (state.levels.length >= 3) return;
      const next = GROUP_OPTIONS.find(([dimension]) => !state.levels.includes(dimension));
      state.levels.push(next ? next[0] : 'month');
      renderGroupLevels();
      updateGroupHint();
      ensureDimensionAvailability(state.levels[state.levels.length - 1]).then(updateGroupOptions);
    });
    dom.accountPrefixLength.addEventListener('input', () => invalidatePreview({ resetSelection: false }));
    dom.outputMode.addEventListener('change', () => invalidatePreview({ resetSelection: false }));
    dom.recommendedColumns.addEventListener('click', () => setColumns(recommendedColumnIds()));
    dom.removeEmptyColumns.addEventListener('click', () => {
      if (!state.columnStats) return showToast('请先预览分组，再检测空白列。');
      setColumns(state.columns.filter((id) => !state.columnStats[id]?.entirely_empty));
    });
    dom.selectAllColumns.addEventListener('click', () => setColumns(state.defaultColumnOrder));
    dom.clearAllColumns.addEventListener('click', () => setColumns([]));
    dom.resetColumns.addEventListener('click', () => setColumns(recommendedColumnIds()));
    dom.previewButton.addEventListener('click', preview);
    dom.generateButton.addEventListener('click', generate);
    dom.excludePage.addEventListener('click', excludeCurrentPage);
    dom.restorePage.addEventListener('click', restoreCurrentPage);
    dom.onlyPage.addEventListener('click', onlyCurrentPage);
    dom.restoreAllRows.addEventListener('click', restoreAllRows);
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
    dom.download.addEventListener('click', () => showToast('正在下载拆分文件…'));
    dom.deleteOutput.addEventListener('click', deleteSplitOutput);
    dom.applyPreset.addEventListener('click', applyPreset);
    dom.savePreset.addEventListener('click', openPresetSave);
    dom.managePresets.addEventListener('click', openPresetManage);
    dom.confirmPresetSave.addEventListener('click', savePreset);
    dom.cancelPresetSave.addEventListener('click', closePresetSave);
    dom.closePresetSave.addEventListener('click', closePresetSave);
    dom.closePresetManage.addEventListener('click', closePresetManage);
    dom.presetBackdrop.addEventListener('click', () => {
      closePresetSave();
      closePresetManage();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePresetSave();
        closePresetManage();
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      state.meta = await api(`${API}/meta`);
    } catch (_) {
      state.meta = null;
    }
    initColumns();
    const loaded = await loadScope();
    if (!loaded) return;
    renderGroupLevels();
    await Promise.all([
      loadGroupAvailability(),
      loadLatest(),
      loadPresets()
    ]);
    updateGroupHint();
  }

  init();
})();

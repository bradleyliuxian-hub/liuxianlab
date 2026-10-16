'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);

  const fileInput = $('#fileInput');
  const dropZone = $('#dropZone');
  const selectedFile = $('#selectedFile');
  const fileName = $('#fileName');
  const fileMeta = $('#fileMeta');
  const clearFileButton = $('#clearFileButton');
  const startButton = $('#startButton');
  const newJobButton = $('#newJobButton');
  const uploadPanel = $('#uploadPanel');
  const processPanel = $('#processPanel');
  const resultsPanel = $('#resultsPanel');
  const processMessage = $('#processMessage');
  const jobStatus = $('#jobStatus');
  const progressBar = $('#progressBar');
  const errorBox = $('#errorBox');
  const toast = $('#toast');

  const optVisible = $('#optVisible');
  const optHidden = $('#optHidden');
  const optReferences = $('#optReferences');

  const statSheets = $('#statSheets');
  const statCells = $('#statCells');
  const statRates = $('#statRates');
  const statHigh = $('#statHigh');
  const statRaw = $('#statRaw');
  const statFormula = $('#statFormula');
  const statHidden = $('#statHidden');
  const statPercentage = $('#statPercentage');
  const statUnknown = $('#statUnknown');
  const statTotal = $('#statTotal');
  const unknownNotice = $('#unknownNotice');
  const resultSubtitle = $('#resultSubtitle');
  const formatNote = $('#formatNote');

  const downloadHighlightButton = $('#downloadHighlightButton');
  const downloadIssuesButton = $('#downloadIssuesButton');
  const highlightStatus = $('#highlightStatus');

  const filterCountLabel = $('#filterCountLabel');
  const sortMode = $('#sortMode');
  const clearFiltersButton = $('#clearFilters');
  const issueList = $('#issueList');
  const issuesEmpty = $('#issuesEmpty');
  const pagination = $('#pagination');
  const loadMoreButton = $('#loadMoreButton');
  const pageLabel = $('#pageLabel');
  const issueCountChip = $('#issueCountChip');

  const excelViewerHost = $('#excelViewer');
  const reviewShell = $('#reviewShell');
  const reviewSplitter = $('#reviewSplitter');

  const PAGE_SIZE = 50;
  const SUPPORTED_EXT = ['xlsx', 'xlsm', 'xlsb', 'xls'];
  const riskCore = (typeof DecimalRiskCore !== 'undefined') ? DecimalRiskCore : null;
  const filters = (typeof DecimalIssueFilters !== 'undefined') ? DecimalIssueFilters : null;

  const RISK_ORDER = ['高', '中', '低', '观察'];
  const CATEGORY_ORDER = ['raw', 'formula', 'unknown', 'hidden', 'percentage', 'exchange_rate'];

  const state = {
    file: null,
    baseName: 'workbook',
    workbook: null,
    issues: [],
    rates: [],
    summary: null,
    sheetStats: [],
    filtered: [],
    visible: 0,
    leftPaneWidth: 0,
    model: null,
    viewer: null,
    suppressFilterRender: false,
    filterState: filters ? filters.emptyFilterState() : {}
  };

  // ---- reusable multi-select dropdown --------------------------------------
  function createMultiSelect(config) {
    const root = config.root;
    const store = { values: new Set(), options: [] };
    root.classList.add('ms');
    root.textContent = '';

    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'ms-control';
    const chips = document.createElement('span');
    chips.className = 'ms-chips';
    const caret = document.createElement('span');
    caret.className = 'ms-caret';
    caret.textContent = '▾';
    control.appendChild(chips);
    control.appendChild(caret);
    root.appendChild(control);

    const panel = document.createElement('div');
    panel.className = 'ms-panel ms-panel--portal';
    panel.hidden = true;
    // Portal: render the dropdown at <body> level and position it with fixed
    // coordinates so it is never clipped by an ancestor's overflow and never
    // affects the layout of the risk list / Excel viewer.
    document.body.appendChild(panel);

    let search = null;
    if (config.searchable) {
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'ms-search';
      search.placeholder = '搜索…';
      panel.appendChild(search);
    }

    const actions = document.createElement('div');
    actions.className = 'ms-actions';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'ms-act';
    selectAllBtn.textContent = '全选';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'ms-act';
    clearBtn.textContent = '清空';
    actions.appendChild(selectAllBtn);
    actions.appendChild(clearBtn);
    panel.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'ms-list';
    panel.appendChild(list);

    function labelFor(value) {
      const opt = store.options.find((o) => o.value === value);
      return opt ? opt.label : value;
    }

    function renderChips() {
      chips.textContent = '';
      const values = [...store.values];
      if (!values.length) {
        const ph = document.createElement('span');
        ph.className = 'ms-placeholder';
        ph.textContent = config.placeholder || '全部';
        chips.appendChild(ph);
        return;
      }
      const max = 2;
      values.slice(0, max).forEach((value) => {
        const chip = document.createElement('span');
        chip.className = 'ms-chip';
        chip.appendChild(document.createTextNode(labelFor(value)));
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ms-chip-x';
        x.textContent = '×';
        x.setAttribute('aria-label', '移除');
        x.addEventListener('click', (event) => {
          event.stopPropagation();
          store.values.delete(value);
          emit();
        });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      if (values.length > max) {
        const more = document.createElement('span');
        more.className = 'ms-chip ms-chip--more';
        more.textContent = `已选择 ${values.length} 项`;
        chips.appendChild(more);
      }
    }

    function emit() {
      renderChips();
      if (config.onChange) config.onChange([...store.values]);
    }

    function renderList() {
      const query = search && search.value ? search.value.trim().toLowerCase() : '';
      list.textContent = '';
      store.options
        .filter((o) => !query || o.label.toLowerCase().indexOf(query) !== -1)
        .forEach((o) => {
          const row = document.createElement('label');
          row.className = 'ms-option';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = store.values.has(o.value);
          cb.addEventListener('change', () => {
            if (cb.checked) store.values.add(o.value); else store.values.delete(o.value);
            emit();
          });
          const text = document.createElement('span');
          text.className = 'ms-option-label';
          text.textContent = o.label;
          const count = document.createElement('span');
          count.className = 'ms-count';
          count.textContent = o.count;
          row.appendChild(cb);
          row.appendChild(text);
          row.appendChild(count);
          list.appendChild(row);
        });
      if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'ms-empty';
        empty.textContent = '无匹配项';
        list.appendChild(empty);
      }
    }

    function positionPanel() {
      const rect = control.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const width = Math.max(rect.width, 260);
      panel.style.minWidth = `${width}px`;
      panel.style.left = `${Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin))}px`;
      // Measure after it is visible, then flip above when there is no room below.
      const panelHeight = panel.offsetHeight || 280;
      let top = rect.bottom + gap;
      if (top + panelHeight > window.innerHeight - margin) {
        const above = rect.top - panelHeight - gap;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - panelHeight - margin);
      }
      panel.style.top = `${top}px`;
    }

    function open() {
      panel.hidden = false;
      control.classList.add('is-open');
      renderList();
      positionPanel();
      if (search) setTimeout(() => search.focus(), 0);
    }
    function close() {
      panel.hidden = true;
      control.classList.remove('is-open');
    }
    function onViewportChange() { if (!panel.hidden) positionPanel(); }

    control.addEventListener('click', () => { if (panel.hidden) open(); else close(); });
    document.addEventListener('click', (event) => {
      if (!root.contains(event.target) && !panel.contains(event.target)) close();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    if (search) search.addEventListener('input', renderList);
    selectAllBtn.addEventListener('click', () => {
      store.options.forEach((o) => store.values.add(o.value));
      emit();
      renderList();
    });
    clearBtn.addEventListener('click', () => {
      store.values.clear();
      emit();
      renderList();
    });

    function setOptions(options) {
      store.options = options || [];
      const present = new Set(store.options.map((o) => o.value));
      [...store.values].forEach((v) => { if (!present.has(v)) store.values.delete(v); });
      renderChips();
      if (!panel.hidden) renderList();
    }

    return {
      getValues: () => [...store.values],
      setOptions,
      clear() { store.values.clear(); emit(); if (!panel.hidden) renderList(); },
      setVisible(visible) { root.hidden = !visible; },
      root
    };
  }

  const filterFields = [
    { key: 'risks', id: '#riskFilter', field: 'risks', label: (i) => i.riskLabel, order: RISK_ORDER, placeholder: '全部风险' },
    { key: 'categories', id: '#categoryFilter', field: 'categories', label: (i) => i.categoryLabel, order: CATEGORY_ORDER, placeholder: '全部类型' },
    { key: 'sheets', id: '#sheetFilter', field: 'sheets', label: (i) => i.sheetName, searchable: true, placeholder: '全部工作表' },
    { key: 'businessTypes', id: '#businessFilter', field: 'businessTypes', label: (i) => i.businessTypeLabel, placeholder: '全部业务类型' },
    { key: 'hiddenTypes', id: '#hiddenFilter', field: 'hiddenTypes', label: (i) => i.hiddenLabel, exclude: ['none'], placeholder: '全部隐藏类型' },
    { key: 'precisionStatuses', id: '#precisionFilter', field: 'precisionStatuses', label: (i) => i.precisionStatus, placeholder: '全部精度状态' }
  ];

  const filterControls = [];
  filterFields.forEach((def) => {
    const root = $(def.id);
    if (!root) return;
    const component = createMultiSelect({
      root,
      placeholder: def.placeholder,
      searchable: Boolean(def.searchable),
      onChange(values) {
        state.filterState[def.field] = values;
        if (!state.suppressFilterRender) renderIssues(true);
      }
    });
    filterControls.push({ def, component });
  });

  function rebuildFilterOptions() {
    filterControls.forEach(({ def, component }) => {
      const options = filters
        ? filters.buildOptions(state.issues, def.field, def.label, def.order, def.exclude)
        : [];
      component.setOptions(options);
      component.setVisible(options.length > 0);
    });
  }

  function clearAllFilters() {
    state.suppressFilterRender = true;
    filterControls.forEach(({ component }) => component.clear());
    state.suppressFilterRender = false;
    renderIssues(true);
  }

  // ---- file / scan ---------------------------------------------------------
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__decimalCheckToast);
    window.__decimalCheckToast = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const size = value / (1024 ** index);
    return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
  }

  function extensionOf(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  }

  function isSupported(file) {
    return file && SUPPORTED_EXT.includes(extensionOf(file.name));
  }

  function setFile(file) {
    if (!file) return clearFile();
    if (!isSupported(file)) {
      showToast('仅支持 .xlsx / .xlsm / .xlsb / .xls 文件。');
      return;
    }
    state.file = file;
    state.baseName = String(file.name).replace(/\.[a-z0-9]+$/i, '') || 'workbook';
    fileName.textContent = file.name;
    fileMeta.textContent = `${formatBytes(file.size)} · ${extensionOf(file.name).toUpperCase()} 工作簿`;
    selectedFile.hidden = false;
    startButton.disabled = false;
    resetResults();
  }

  function clearFile() {
    state.file = null;
    fileInput.value = '';
    selectedFile.hidden = true;
    startButton.disabled = true;
  }

  fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
  clearFileButton.addEventListener('click', clearFile);
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer.files?.[0]));

  function readScanOptions() {
    return {
      includeVisible: optVisible ? optVisible.checked : true,
      includeHidden: optHidden ? optHidden.checked : false,
      analyzeReferences: optReferences ? optReferences.checked : true
    };
  }

  function setProgress(percent) {
    const safe = Math.max(0, Math.min(100, Number(percent || 0)));
    progressBar.style.width = `${safe}%`;
  }

  function showError(message) {
    errorBox.textContent = message || '处理失败，请稍后重试。';
    errorBox.hidden = false;
    jobStatus.textContent = 'FAILED';
  }

  function resetResults() {
    state.issues = [];
    state.rates = [];
    state.summary = null;
    state.workbook = null;
    state.sheetStats = [];
    state.filtered = [];
    state.visible = 0;
    if (state.viewer && typeof state.viewer.destroy === 'function') state.viewer.destroy();
    state.model = null;
    state.viewer = null;
    resultsPanel.hidden = true;
    processPanel.hidden = true;
    errorBox.hidden = true;
    if (excelViewerHost) excelViewerHost.textContent = '';
    setProgress(0);
  }

  function riskClass(level) {
    return { '高': 'high', '中': 'medium', '低': 'low', '观察': 'watch' }[level] || 'watch';
  }

  function sortIssues(list, mode) {
    if (riskCore && typeof riskCore.sortIssues === 'function') return riskCore.sortIssues(list, mode);
    return list.slice();
  }

  function formatValue(issue) {
    if (issue.category === 'unknown') return '不可读取';
    if (issue.originalValue !== null && issue.originalValue !== undefined) return String(issue.originalValue);
    return '—';
  }

  function decimalsLabel(issue) {
    if (issue.category === 'unknown') return '—';
    return DecimalWorkbook.formatDecimals(issue.decimals);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function field(label, value, code) {
    const wrap = document.createElement('div');
    wrap.className = 'issue-field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const node = document.createElement(code ? 'code' : 'strong');
    node.textContent = value;
    wrap.appendChild(caption);
    wrap.appendChild(node);
    return wrap;
  }

  function makeIssueNode(issue) {
    const item = document.createElement('article');
    item.className = 'issue-item';
    item.dataset.risk = riskClass(issue.riskLevel);

    const top = document.createElement('div');
    top.className = 'issue-top';

    const loc = document.createElement('div');
    loc.className = 'issue-loc';

    const sheet = document.createElement('span');
    sheet.className = 'issue-sheet';
    sheet.textContent = `工作表：${issue.sheetName}`;
    loc.appendChild(sheet);

    const cell = document.createElement('span');
    cell.className = 'issue-cell';
    cell.textContent = issue.cell;
    loc.appendChild(cell);

    const riskBadge = document.createElement('span');
    riskBadge.className = `risk-badge risk-${riskClass(issue.riskLevel)}`;
    riskBadge.textContent = issue.riskLabel;
    loc.appendChild(riskBadge);

    const badge = document.createElement('span');
    badge.className = `type-badge is-${issue.category}`;
    badge.textContent = issue.categoryLabel;
    loc.appendChild(badge);
    top.appendChild(loc);
    item.appendChild(top);

    const refStats = document.createElement('div');
    refStats.className = 'issue-refstats';
    const down = document.createElement('span');
    down.className = 'refstat refstat--down';
    down.textContent = `下游引用 ${issue.downstreamReferenceCount}`;
    refStats.appendChild(down);
    const direct = document.createElement('span');
    direct.className = 'refstat';
    direct.textContent = `直接引用 ${issue.directReferenceCount}`;
    refStats.appendChild(direct);
    if (issue.crossSheet) {
      const cross = document.createElement('span');
      cross.className = 'refstat';
      cross.textContent = '跨表引用';
      refStats.appendChild(cross);
    }
    if (issue.hasCircularDependency) {
      const cycle = document.createElement('span');
      cycle.className = 'refstat refstat--cycle';
      cycle.textContent = '存在循环引用';
      refStats.appendChild(cycle);
    }
    item.appendChild(refStats);

    const body = document.createElement('div');
    body.className = 'issue-body';

    body.appendChild(field('F5 定位地址', issue.goto, true));
    body.appendChild(field('当前值 / 公式结果', formatValue(issue), false));
    body.appendChild(field('有效小数位', decimalsLabel(issue), false));
    body.appendChild(field('直接引用数', String(issue.directReferenceCount), false));
    body.appendChild(field('下游引用数', String(issue.downstreamReferenceCount), false));
    body.appendChild(field('是否引用终点', issue.isReferenceTerminal ? '是（可能是输出终点）' : '否', false));
    if (issue.hiddenType && issue.hiddenType !== 'none') {
      body.appendChild(field('隐藏类型', issue.hiddenLabel, false));
    }
    if (issue.isPercentage) {
      body.appendChild(field('是否百分比', '是（底层按数值存储）', false));
    }
    if (issue.category === 'exchange_rate') {
      body.appendChild(field('识别类型', issue.businessTypeLabel + (issue.businessTypeConfidence === 'low' ? '（低可信度）' : ''), false));
      body.appendChild(field('识别依据', issue.businessTypeReason || '—', false));
      body.appendChild(field('允许小数位', String(issue.allowedDecimals), false));
      body.appendChild(field('精度状态', issue.precisionStatus || '—', false));
      if (issue.exchangeRateSource) {
        body.appendChild(field('来源汇率', issue.exchangeRateSource, true));
      }
      if (issue.exchangeRatePassthrough) {
        body.appendChild(field('传递层级', String(issue.exchangeRatePassthroughDepth), false));
      }
    }
    if (issue.businessType === 'exchange_rate_derived' && issue.category !== 'exchange_rate') {
      body.appendChild(field('业务类型', '由汇率计算派生', false));
      if (issue.exchangeRateSource) {
        body.appendChild(field('来源汇率', issue.exchangeRateSource, true));
      }
    }
    if (issue.originalFormula) {
      body.appendChild(field('公式', issue.originalFormula, true));
    }
    item.appendChild(body);

    const reason = document.createElement('p');
    reason.className = 'issue-reason';
    const reasonLabel = document.createElement('span');
    reasonLabel.textContent = '风险原因：';
    reason.appendChild(reasonLabel);
    reason.appendChild(document.createTextNode(issue.riskReason));
    item.appendChild(reason);

    const suggestion = document.createElement('p');
    suggestion.className = 'issue-suggestion';
    const sugLabel = document.createElement('span');
    sugLabel.textContent = '人工处理建议：';
    suggestion.appendChild(sugLabel);
    suggestion.appendChild(document.createTextNode(issue.suggestion));
    item.appendChild(suggestion);

    const actions = document.createElement('div');
    actions.className = 'issue-actions';
    const locateButton = document.createElement('button');
    locateButton.type = 'button';
    locateButton.className = 'locate-button';
    locateButton.textContent = '定位';
    locateButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.model) state.model.selectIssue(issue);
    });
    actions.appendChild(locateButton);
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-button';
    copyButton.textContent = '复制地址';
    copyButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      const ok = await copyText(issue.goto);
      showToast(ok ? `已复制：${issue.goto}` : '复制失败，请手动选择文本。');
    });
    actions.appendChild(copyButton);
    item.appendChild(actions);

    item.dataset.key = `${issue.sheetName}!${issue.cell}`;
    item.classList.add('issue-item--clickable');
    item.addEventListener('click', () => { if (state.model) state.model.selectIssue(issue); });

    return item;
  }

  function highlightActiveIssue() {
    const selected = state.model ? state.model.state().selectedIssue : null;
    const key = selected ? `${selected.sheetName}!${selected.cellAddress}` : '';
    [...issueList.querySelectorAll('.issue-item')].forEach((node) => {
      const active = Boolean(key) && node.dataset.key === key;
      node.classList.toggle('is-active', active);
      if (active && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function currentFiltered() {
    return filters ? filters.applyFilters(state.issues, state.filterState) : state.issues.slice();
  }

  function renderIssues(resetVisible) {
    state.filtered = sortIssues(currentFiltered(), sortMode ? sortMode.value : 'risk');
    if (resetVisible) state.visible = 0;

    const total = state.filtered.length;
    const shown = Math.min(total, Math.max(PAGE_SIZE, state.visible || PAGE_SIZE));
    state.visible = shown;

    filterCountLabel.textContent = `${total} / ${state.issues.length} 条`;
    issueCountChip.textContent = `${state.issues.length} 条`;

    issueList.textContent = '';
    const slice = state.filtered.slice(0, shown);
    const fragment = document.createDocumentFragment();
    slice.forEach((issue) => fragment.appendChild(makeIssueNode(issue)));
    issueList.appendChild(fragment);

    issuesEmpty.hidden = total !== 0;
    issueList.hidden = total === 0;
    const hasMore = shown < total;
    pagination.hidden = !hasMore;
    pageLabel.textContent = hasMore ? `已显示 ${shown} / ${total}` : '';

    // Prev/next navigation follows THIS filtered + sorted list (never allIssues).
    if (state.model && typeof state.model.setFilterList === 'function') {
      state.model.setFilterList(state.filtered);
      state.model.reconcile();
    }

    highlightActiveIssue();
  }

  function renderSummary(summary) {
    statSheets.textContent = String(summary.sheetCount);
    statCells.textContent = String(summary.scannedCells);
    if (statRates) statRates.textContent = String(summary.rateRowCount || 0);
    statHigh.textContent = String(summary.highRiskCount);
    statRaw.textContent = String(summary.rawCount);
    statFormula.textContent = String(summary.formulaCount);
    statHidden.textContent = String(summary.hiddenCount);
    statPercentage.textContent = String(summary.percentageCount);
    statUnknown.textContent = String(summary.unknownCount);
    statTotal.textContent = String(summary.issueCount);

    unknownNotice.hidden = summary.unknownCount === 0;

    resultSubtitle.textContent = summary.issueCount === 0
      ? `已扫描 ${summary.sheetCount} 个工作表、${summary.scannedCells} 个单元格，未发现多位小数风险。`
      : `${summary.sheetCount} 个工作表 · ${summary.scannedCells} 个单元格 · 共 ${summary.issueCount} 条风险，其中高风险 ${summary.highRiskCount} 条。`;
  }

  function buildFormatNote() {
    const ext = extensionOf(state.file ? state.file.name : '');
    const canHighlight = ext === 'xlsx' || ext === 'xlsm';
    formatNote.textContent = canHighlight
      ? '说明：标黄对比文件基于原始文件生成副本，仅对问题单元格添加黄色填充，' +
        '公式、外部链接、命名范围、隐藏状态、图表等保持不变；原上传文件不会被修改。'
      : '说明：当前文件为 .' + ext + '，暂不支持生成标黄对比文件（仅支持 .xlsx / .xlsm）。' +
        '问题清单与网页内复核仍可正常使用。';
    formatNote.hidden = false;
    if (downloadHighlightButton) {
      downloadHighlightButton.disabled = !canHighlight;
      downloadHighlightButton.title = canHighlight ? '' : '仅支持 .xlsx / .xlsm 原文件';
    }
  }

  function initViewer() {
    if (!excelViewerHost) return;
    if (typeof ExcelViewerCore === 'undefined' || typeof ExcelViewer === 'undefined') {
      excelViewerHost.textContent = '';
      const note = document.createElement('div');
      note.className = 'vwr-empty';
      note.textContent = '网页内定位组件未能加载，请刷新页面后重试。';
      excelViewerHost.appendChild(note);
      return;
    }
    state.model = ExcelViewerCore.createViewerModel(state.workbook, state.issues, { cycle: false });
    state.viewer = ExcelViewer.createExcelViewer({ root: excelViewerHost, model: state.model });
    state.model.subscribe(() => { highlightActiveIssue(); });
    const first = state.model.filteredIssues()[0];
    if (first) state.model.selectIssue(first);
  }

  async function runScan() {
    if (!state.file) return;
    const options = readScanOptions();
    if (!options.includeVisible && !options.includeHidden) {
      showToast('请至少选择「检查可见单元格」或「检查隐藏区域」。');
      return;
    }

    startButton.disabled = true;
    errorBox.hidden = true;
    resultsPanel.hidden = true;
    processPanel.hidden = false;
    processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    processMessage.textContent = '正在读取工作簿…';
    jobStatus.textContent = 'READING';
    setProgress(15);

    try {
      const buffer = await state.file.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 30));
      processMessage.textContent = options.analyzeReferences
        ? '正在扫描工作表并分析公式引用关系…'
        : '正在扫描所有工作表…';
      jobStatus.textContent = 'SCANNING';
      setProgress(55);

      let wb;
      try {
        wb = XLSX.read(new Uint8Array(buffer), DecimalWorkbook.readOptions({ type: 'array' }));
      } catch (readError) {
        throw new Error('无法解析该文件。请确认它是有效的 Excel 工作簿，且未加密或损坏。');
      }

      const result = DecimalWorkbook.scanWorkbook(XLSX, wb, options);
      state.workbook = wb;
      state.issues = result.issues.map((issue) => Object.assign({}, issue, {
        cellAddress: issue.cell,
        severity: issue.category,
        ruleId: issue.category,
        cellType: issue.isFormula ? 'formula' : 'number',
        formula: issue.originalFormula || null,
        value: issue.originalValue
      }));
      state.summary = result.summary;
      state.sheetStats = result.sheetStats;
      state.rates = result.rates || [];

      setProgress(100);
      processMessage.textContent = '扫描完成';
      jobStatus.textContent = 'DONE';

      renderSummary(result.summary);
      clearAllFilters();
      rebuildFilterOptions();
      initViewer();
      renderIssues(true);
      buildFormatNote();

      resultsPanel.hidden = false;
      startButton.disabled = false;
      resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      startButton.disabled = false;
      showError(error && error.message ? error.message : '处理失败，请稍后重试。');
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'
  };

  const HIGHLIGHT_BUTTON_HTML = downloadHighlightButton ? downloadHighlightButton.innerHTML : '';

  function setHighlightStatus(message, isError) {
    if (!highlightStatus) return;
    if (!message) { highlightStatus.hidden = true; highlightStatus.textContent = ''; highlightStatus.classList.remove('is-error'); return; }
    highlightStatus.hidden = false;
    highlightStatus.textContent = message;
    highlightStatus.classList.toggle('is-error', Boolean(isError));
  }

  async function downloadHighlight() {
    if (!state.file || !state.summary) return;
    if (typeof ExcelOoxmlHighlight === 'undefined' || typeof fflate === 'undefined') {
      setHighlightStatus('对比文件生成失败，原文件未受影响。', true);
      showToast('对比文件生成失败，原文件未受影响。');
      return;
    }
    downloadHighlightButton.disabled = true;
    downloadHighlightButton.textContent = '正在生成对比文件…';
    setHighlightStatus('正在生成对比文件…', false);
    try {
      const buffer = await state.file.arrayBuffer();
      const { data } = ExcelOoxmlHighlight.buildHighlightedWorkbook(fflate, new Uint8Array(buffer), state.issues, {});
      const blob = new Blob([data], { type: MIME.xlsx });
      downloadBlob(blob, `${state.baseName}_尾差标黄对比版.xlsx`);
      setHighlightStatus('已生成标黄对比文件。', false);
      showToast('已生成标黄对比文件。');
    } catch (error) {
      setHighlightStatus('对比文件生成失败，原文件未受影响。', true);
      showToast('对比文件生成失败，原文件未受影响。');
    } finally {
      downloadHighlightButton.disabled = false;
      downloadHighlightButton.innerHTML = HIGHLIGHT_BUTTON_HTML;
    }
  }

  // Export always covers the FULL scan result (filters do not change exports).
  async function downloadIssues() {
    if (!state.summary) return;
    downloadIssuesButton.disabled = true;
    try {
      const wb = DecimalWorkbook.buildIssuesWorkbook(XLSX, state.issues, { rates: state.rates });
      const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      const blob = new Blob([output], { type: MIME.xlsx });
      downloadBlob(blob, `${state.baseName}_尾差问题清单.xlsx`);
      showToast('已生成问题清单 Excel。');
    } catch (error) {
      showToast('生成问题清单失败，请重试。');
    } finally {
      downloadIssuesButton.disabled = false;
    }
  }

  startButton.addEventListener('click', runScan);
  downloadHighlightButton.addEventListener('click', downloadHighlight);
  downloadIssuesButton.addEventListener('click', downloadIssues);
  if (sortMode) sortMode.addEventListener('change', () => {
    if (typeof DecimalWorkbook !== 'undefined' && state.filtered.length) {
      state.filtered = sortIssues(currentFiltered(), sortMode.value);
    }
    renderIssues(true);
  });
  if (clearFiltersButton) clearFiltersButton.addEventListener('click', clearAllFilters);
  loadMoreButton.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderIssues(false);
  });
  newJobButton.addEventListener('click', () => {
    clearFile();
    resetResults();
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const LEFT_MIN = 280;
  const LEFT_MAX = 520;
  const VIEWER_MIN = 700;
  const SPLITTER_GAP = 16;

  function leftBounds() {
    const shellWidth = (reviewShell && reviewShell.clientWidth) || 1440;
    const max = Math.max(LEFT_MIN, Math.min(LEFT_MAX, shellWidth - 8 - 24 - VIEWER_MIN));
    return { min: LEFT_MIN, max };
  }

  function setLeftWidth(px) {
    if (!reviewShell) return 0;
    const bounds = leftBounds();
    const width = Math.max(bounds.min, Math.min(bounds.max, Math.round(px)));
    reviewShell.style.setProperty('--hv-left-w', `${width}px`);
    state.leftPaneWidth = width;
    try { localStorage.setItem('hv-left-w', String(width)); } catch (_) {}
    return width;
  }

  function currentLeftWidth() {
    if (!reviewShell) return 340;
    const inline = parseFloat(reviewShell.style.getPropertyValue('--hv-left-w'));
    if (Number.isFinite(inline) && inline > 0) return inline;
    if (Number.isFinite(state.leftPaneWidth) && state.leftPaneWidth > 0) return state.leftPaneWidth;
    return 340;
  }

  (function initSplitter() {
    if (!reviewSplitter || !reviewShell) return;
    let saved = 0;
    try { saved = Number(localStorage.getItem('hv-left-w')) || 0; } catch (_) {}
    setLeftWidth(saved > 0 ? saved : 340);

    let dragging = false;
    const refresh = () => { if (state.viewer && state.viewer.refresh) state.viewer.refresh(); };
    const move = (event) => {
      if (!dragging) return;
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const rect = reviewShell.getBoundingClientRect();
      setLeftWidth(clientX - rect.left - SPLITTER_GAP);
      refresh();
    };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      reviewSplitter.classList.remove('is-dragging');
      reviewShell.classList.remove('is-resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', stop);
      refresh();
    };
    const start = (event) => {
      if (event.button != null && event.button !== 0) return;
      dragging = true;
      reviewSplitter.classList.add('is-dragging');
      reviewShell.classList.add('is-resizing');
      if (event.preventDefault) event.preventDefault();
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', stop);
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', stop);
    };
    reviewSplitter.addEventListener('mousedown', start);
    reviewSplitter.addEventListener('touchstart', start, { passive: false });
    reviewSplitter.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setLeftWidth(currentLeftWidth() + (event.key === 'ArrowLeft' ? 24 : -24));
      refresh();
    });
    window.addEventListener('resize', () => setLeftWidth(currentLeftWidth()));
  })();

  if (typeof XLSX === 'undefined') {
    startButton.disabled = true;
    showError('未能加载本地 Excel 引擎，请刷新页面后重试。');
  }
})();

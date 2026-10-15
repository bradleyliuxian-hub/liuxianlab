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

  const statSheets = $('#statSheets');
  const statCells = $('#statCells');
  const statRaw = $('#statRaw');
  const statFormula = $('#statFormula');
  const statUnknown = $('#statUnknown');
  const statTotal = $('#statTotal');
  const unknownNotice = $('#unknownNotice');
  const resultSubtitle = $('#resultSubtitle');
  const formatNote = $('#formatNote');

  const downloadHighlightButton = $('#downloadHighlightButton');
  const downloadIssuesButton = $('#downloadIssuesButton');
  const highlightStatus = $('#highlightStatus');

  const sheetFilter = $('#sheetFilter');
  const typeFilter = $('#typeFilter');
  const filterCountLabel = $('#filterCountLabel');
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

  const state = {
    file: null,
    baseName: 'workbook',
    workbook: null,
    issues: [],
    summary: null,
    sheetStats: [],
    filtered: [],
    visible: 0,
    leftPaneWidth: 0,
    model: null,
    viewer: null
  };

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

  function plural(value) {
    return String(value);
  }

  function formatValue(issue) {
    if (issue.type === 'unknown') return '不可读取';
    if (issue.isNumericValue && issue.originalValue !== null) return String(issue.originalValue);
    return '—';
  }

  function decimalsLabel(issue) {
    if (issue.type === 'unknown') return '—';
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

  function makeIssueNode(issue) {
    const item = document.createElement('article');
    item.className = 'issue-item';

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

    const badge = document.createElement('span');
    badge.className = `type-badge is-${issue.type}`;
    badge.textContent = issue.typeLabel;
    loc.appendChild(badge);
    top.appendChild(loc);
    item.appendChild(top);

    const body = document.createElement('div');
    body.className = 'issue-body';

    const fields = [
      { label: 'F5 定位地址', value: issue.goto, code: true },
      { label: '当前值 / 公式结果', value: formatValue(issue), code: false },
      { label: '有效小数位', value: decimalsLabel(issue), code: false },
      { label: '公式', value: issue.originalFormula || '—', code: true }
    ];

    fields.forEach((field) => {
      const wrap = document.createElement('div');
      wrap.className = 'issue-field';
      const label = document.createElement('span');
      label.textContent = field.label;
      const value = document.createElement(field.code ? 'code' : 'strong');
      value.textContent = field.value;
      wrap.appendChild(label);
      wrap.appendChild(value);
      body.appendChild(wrap);
    });

    item.appendChild(body);

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

  function applyFiltersToModel() {
    if (!state.model) return;
    state.model.setFilterKind(typeFilter.value || '');
    state.model.setFilterSheet(sheetFilter.value || '');
  }

  function currentFiltered() {
    const sheet = sheetFilter.value;
    const type = typeFilter.value;
    return state.issues.filter((issue) => {
      if (sheet && issue.sheetName !== sheet) return false;
      if (type && issue.type !== type) return false;
      return true;
    });
  }

  function renderIssues(resetVisible) {
    state.filtered = currentFiltered();
    if (resetVisible) state.visible = 0;

    const total = state.filtered.length;
    const shown = Math.min(total, Math.max(PAGE_SIZE, state.visible || PAGE_SIZE));
    state.visible = shown;

    filterCountLabel.textContent = `${total} 条`;
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

    highlightActiveIssue();
  }

  function populateSheetFilter() {
    sheetFilter.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = '全部工作表';
    sheetFilter.appendChild(all);
    state.sheetStats.forEach((sheet) => {
      const option = document.createElement('option');
      option.value = sheet.name;
      option.textContent = sheet.issues > 0 ? `${sheet.name}（${sheet.issues}）` : sheet.name;
      sheetFilter.appendChild(option);
    });
  }

  function renderSummary(summary) {
    statSheets.textContent = plural(summary.sheetCount);
    statCells.textContent = plural(summary.scannedCells);
    statRaw.textContent = plural(summary.rawCount);
    statFormula.textContent = plural(summary.formulaCount);
    statUnknown.textContent = plural(summary.unknownCount);
    statTotal.textContent = plural(summary.issueCount);

    unknownNotice.hidden = summary.unknownCount === 0;

    resultSubtitle.textContent = summary.issueCount === 0
      ? '未发现超过两位小数的单元格。'
      : `共发现 ${summary.issueCount} 个需要关注的单元格。`;
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
    state.model = ExcelViewerCore.createViewerModel(state.workbook, state.issues);
    state.viewer = ExcelViewer.createExcelViewer({ root: excelViewerHost, model: state.model });
    state.model.subscribe(() => { highlightActiveIssue(); });
    applyFiltersToModel();
    const first = state.model.filteredIssues()[0];
    if (first) state.model.selectIssue(first);
  }

  async function runScan() {
    if (!state.file) return;
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
      processMessage.textContent = '正在扫描所有工作表…';
      jobStatus.textContent = 'SCANNING';
      setProgress(55);

      let wb;
      try {
        wb = XLSX.read(new Uint8Array(buffer), DecimalWorkbook.readOptions({ type: 'array' }));
      } catch (readError) {
        throw new Error('无法解析该文件。请确认它是有效的 Excel 工作簿，且未加密或损坏。');
      }

      // Read-only scan: the viewer shows the ORIGINAL (unmodified) workbook,
      // with yellow highlights overlaid. The workbook is never rewritten.
      const result = DecimalWorkbook.scanWorkbook(XLSX, wb);
      state.workbook = wb;
      // Extend each issue with the fields the shared viewer expects, without
      // dropping any original field used by the list / exports.
      state.issues = result.issues.map((issue) => Object.assign({}, issue, {
        cellAddress: issue.cell,
        severity: issue.type,
        ruleId: issue.type,
        cellType: issue.originalFormula ? 'formula' : 'number',
        formula: issue.originalFormula || null,
        value: issue.originalValue
      }));
      state.summary = result.summary;
      state.sheetStats = result.sheetStats;

      setProgress(100);
      processMessage.textContent = '扫描完成';
      jobStatus.textContent = 'DONE';

      renderSummary(result.summary);
      populateSheetFilter();
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

  // Same OOXML minimal patch as the hardcode check: highlights the issue cells
  // in a COPY of the original file. The workbook is never rebuilt and the
  // original upload is never modified.
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
      const { data } = ExcelOoxmlHighlight.buildHighlightedWorkbook(
        fflate,
        new Uint8Array(buffer),
        state.issues,
        {}
      );
      const blob = new Blob([data], { type: MIME.xlsx });
      downloadBlob(blob, `${state.baseName}_小数标黄对比版.xlsx`);
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

  async function downloadIssues() {
    if (!state.summary) return;
    downloadIssuesButton.disabled = true;
    try {
      const wb = DecimalWorkbook.buildIssuesWorkbook(XLSX, state.issues);
      const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      const blob = new Blob([output], { type: MIME.xlsx });
      downloadBlob(blob, `${state.baseName}_decimal_issues.xlsx`);
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
  sheetFilter.addEventListener('change', () => { renderIssues(true); applyFiltersToModel(); });
  typeFilter.addEventListener('change', () => { renderIssues(true); applyFiltersToModel(); });
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

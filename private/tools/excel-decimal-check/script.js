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

  const downloadFixedButton = $('#downloadFixedButton');
  const downloadIssuesButton = $('#downloadIssuesButton');

  const sheetFilter = $('#sheetFilter');
  const typeFilter = $('#typeFilter');
  const filterCountLabel = $('#filterCountLabel');
  const issueList = $('#issueList');
  const issuesEmpty = $('#issuesEmpty');
  const pagination = $('#pagination');
  const loadMoreButton = $('#loadMoreButton');
  const pageLabel = $('#pageLabel');
  const issueCountChip = $('#issueCountChip');

  const PAGE_SIZE = 50;
  const SUPPORTED_EXT = ['xlsx', 'xlsm', 'xlsb', 'xls'];

  const state = {
    file: null,
    baseName: 'workbook',
    issues: [],
    summary: null,
    sheetStats: [],
    filtered: [],
    visible: 0
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
    state.sheetStats = [];
    state.filtered = [];
    state.visible = 0;
    resultsPanel.hidden = true;
    processPanel.hidden = true;
    errorBox.hidden = true;
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

  function statusClass(status) {
    if (status === DecimalWorkbook.STATUS.manual) return ' is-manual';
    if (status === DecimalWorkbook.STATUS.unknown) return ' is-unknown';
    if (status === DecimalWorkbook.STATUS.failed) return ' is-failed';
    return '';
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

    const status = document.createElement('span');
    status.className = `status-badge${statusClass(issue.status)}`;
    status.textContent = issue.status || '';
    top.appendChild(status);
    item.appendChild(top);

    const body = document.createElement('div');
    body.className = 'issue-body';

    const fields = [
      { label: 'F5 定位地址', value: issue.goto, code: true },
      { label: '当前值 / 公式结果', value: formatValue(issue), code: false },
      { label: '有效小数位', value: decimalsLabel(issue), code: false },
      { label: '处理状态', value: issue.status || '—', code: false },
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
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-button';
    copyButton.textContent = '复制地址';
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(issue.goto);
      showToast(ok ? `已复制：${issue.goto}` : '复制失败，请手动选择文本。');
    });
    actions.appendChild(copyButton);
    item.appendChild(actions);

    return item;
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
    const macronote = ext === 'xlsm'
      ? '。原文件为 .xlsm，修正版会尽量保留 VBA 宏，但请自行确认宏完整。'
      : ext === 'xls'
        ? '。原文件为老版 .xls，修正版将输出为 .xlsx，公式与结构会保留，部分样式可能丢失。'
        : ext === 'xlsb'
          ? '。原文件为 .xlsb，修正版将以 .xlsb 输出。'
          : '';
    formatNote.textContent =
      '说明：修正版会保留数值、公式、合并单元格、列宽与隐藏工作表等结构；' +
      '受浏览器端 Excel 引擎限制，字体、填充等样式与冻结窗格可能无法完全保留。' + macronote;
    formatNote.hidden = false;
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

      const result = DecimalWorkbook.analyzeWorkbook(XLSX, wb);
      state.issues = result.issues;
      state.summary = result.summary;
      state.sheetStats = result.sheetStats;

      setProgress(100);
      processMessage.textContent = '扫描完成';
      jobStatus.textContent = 'DONE';

      renderSummary(result.summary);
      populateSheetFilter();
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

  async function downloadFixed() {
    if (!state.file) return;
    downloadFixedButton.disabled = true;
    try {
      const buffer = await state.file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), DecimalWorkbook.readOptions({ type: 'array' }));
      DecimalWorkbook.analyzeWorkbook(XLSX, wb);

      const bookType = DecimalWorkbook.fixedOutputType(state.file.name);
      const output = XLSX.write(wb, { bookType, type: 'array', compression: true });
      const blob = new Blob([output], { type: MIME[bookType] || MIME.xlsx });
      downloadBlob(blob, `${state.baseName}_decimal_fixed.${bookType}`);
      showToast('已生成修正后的 Excel。');
    } catch (error) {
      showToast('生成修正版失败，请重试。');
    } finally {
      downloadFixedButton.disabled = false;
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
  downloadFixedButton.addEventListener('click', downloadFixed);
  downloadIssuesButton.addEventListener('click', downloadIssues);
  sheetFilter.addEventListener('change', () => renderIssues(true));
  typeFilter.addEventListener('change', () => renderIssues(true));
  loadMoreButton.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderIssues(false);
  });
  newJobButton.addEventListener('click', () => {
    clearFile();
    resetResults();
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if (typeof XLSX === 'undefined') {
    startButton.disabled = true;
    showError('未能加载本地 Excel 引擎，请刷新页面后重试。');
  }
})();

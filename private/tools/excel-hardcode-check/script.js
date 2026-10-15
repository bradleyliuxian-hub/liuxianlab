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
  const statFormula = $('#statFormula');
  const statHigh = $('#statHigh');
  const statSuspicious = $('#statSuspicious');
  const statNotice = $('#statNotice');
  const resultSubtitle = $('#resultSubtitle');

  const downloadReportButton = $('#downloadReportButton');
  const downloadHighlightButton = $('#downloadHighlightButton');
  const highlightStatus = $('#highlightStatus');

  const sheetFilter = $('#sheetFilter');
  const severityTabs = $('#severityTabs');
  const filterCountLabel = $('#filterCountLabel');
  const issueList = $('#issueList');
  const issuesEmpty = $('#issuesEmpty');
  const pagination = $('#pagination');
  const loadMoreButton = $('#loadMoreButton');
  const pageLabel = $('#pageLabel');
  const issueCountChip = $('#issueCountChip');

  const excelViewerHost = $('#excelViewer');
  const reviewShell = $('.review-shell');
  const reviewSplitter = $('#reviewSplitter');

  const PAGE_SIZE = 50;

  const state = {
    file: null,
    baseName: 'workbook',
    originalBytes: null,
    workbook: null,
    issues: [],
    summary: null,
    sheetStats: [],
    filterKind: '',
    visible: 0,
    leftPaneWidth: 0,
    model: null,
    viewer: null
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__hardcodeToast);
    window.__hardcodeToast = setTimeout(() => toast.classList.remove('show'), 2800);
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
    return Boolean(file) && extensionOf(file.name) === 'xlsx';
  }

  function setFile(file) {
    if (!file) return clearFile();
    if (!isSupported(file)) {
      showToast('当前版本仅支持 .xlsx 文件。');
      return;
    }
    state.file = file;
    state.baseName = String(file.name).replace(/\.[a-z0-9]+$/i, '') || 'workbook';
    fileName.textContent = file.name;
    fileMeta.textContent = `${formatBytes(file.size)} · XLSX 工作簿`;
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
    state.originalBytes = null;
    state.workbook = null;
    state.sheetStats = [];
    state.visible = 0;
    if (state.viewer && typeof state.viewer.destroy === 'function') state.viewer.destroy();
    state.model = null;
    state.viewer = null;
    resultsPanel.hidden = true;
    processPanel.hidden = true;
    errorBox.hidden = true;
    if (excelViewerHost) excelViewerHost.textContent = '';
    if (highlightStatus) { highlightStatus.hidden = true; highlightStatus.textContent = ''; }
    setProgress(0);
  }

  function severityLabel(severity) {
    if (severity === 'HIGH') return '高风险';
    if (severity === 'SUSPICIOUS') return '可疑';
    if (severity === 'HARDCODE_NOTICE') return '硬编码提示';
    return severity;
  }

  function severityClass(severity) {
    if (severity === 'HIGH') return 'is-high';
    if (severity === 'SUSPICIOUS') return 'is-suspicious';
    return 'is-notice';
  }

  function ruleTitle(issue) {
    if (typeof HardcodeCore !== 'undefined' && HardcodeCore.RULES[issue.ruleId]) {
      return HardcodeCore.RULES[issue.ruleId].title;
    }
    return issue.ruleId;
  }

  const ROLE_LABEL = {
    ROUNDING_PLUG: '人工尾差/勾稽调整',
    LOCAL_OVERRIDE: '局部调整',
    SHARED_BUSINESS_CONSTANT: '共享常量',
    CONTROL_ARGUMENT: '控制参数',
    DATE_ARGUMENT: '日期参数',
    LOGICAL_CONSTANT: '逻辑值',
    BUSINESS_CONSTANT: '业务常量'
  };

  function constantsText(issue) {
    const details = Array.isArray(issue.constantDetails) ? issue.constantDetails : [];
    const anomalous = details.filter((d) => d.anomalous);
    if (anomalous.length) return anomalous.map((d) => `${d.value}（${ROLE_LABEL[d.role] || d.role}）`).join('、');
    return issue.constants.length ? issue.constants.join('、') : '—';
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

  function issueBrief(issue) {
    if (issue.cellType === 'formula') return issue.formula || '—';
    return issue.value === null || issue.value === undefined ? '—' : String(issue.value);
  }

  function makeIssueNode(issue) {
    const item = document.createElement('article');
    item.className = 'issue-item';

    const top = document.createElement('div');
    top.className = 'issue-top';

    const loc = document.createElement('div');
    loc.className = 'issue-loc';

    const sev = document.createElement('span');
    sev.className = `sev-badge ${severityClass(issue.severity)}`;
    sev.textContent = severityLabel(issue.severity);
    loc.appendChild(sev);

    const rule = document.createElement('span');
    rule.className = 'rule-badge';
    rule.textContent = issue.ruleId;
    loc.appendChild(rule);

    const cell = document.createElement('span');
    cell.className = 'issue-cell';
    cell.textContent = issue.cellAddress;
    loc.appendChild(cell);
    top.appendChild(loc);
    item.appendChild(top);

    const sheet = document.createElement('span');
    sheet.className = 'issue-sheet';
    sheet.textContent = `${issue.sheetName}${issue.sheetHidden ? '（隐藏）' : ''}`;
    item.appendChild(sheet);

    const body = document.createElement('div');
    body.className = 'issue-body';

    const brief = document.createElement('div');
    brief.className = 'issue-field';
    const bl = document.createElement('span');
    bl.textContent = '当前值 / 公式';
    const bv = document.createElement('code');
    bv.textContent = issueBrief(issue);
    brief.appendChild(bl);
    brief.appendChild(bv);
    body.appendChild(brief);

    const typeWrap = document.createElement('div');
    typeWrap.className = 'issue-field';
    const tl = document.createElement('span');
    tl.textContent = '问题类型';
    const tv = document.createElement('strong');
    tv.textContent = ruleTitle(issue);
    typeWrap.appendChild(tl);
    typeWrap.appendChild(tv);
    body.appendChild(typeWrap);

    const constants = constantsText(issue);
    if (constants && constants !== '—') {
      const cWrap = document.createElement('div');
      cWrap.className = 'issue-field';
      const cl = document.createElement('span');
      cl.textContent = '异常常量';
      const cv = document.createElement('code');
      cv.textContent = constants;
      cWrap.appendChild(cl);
      cWrap.appendChild(cv);
      body.appendChild(cWrap);
    }

    const evidence = (issue.evidence || []).slice(0, 2);
    if (evidence.length) {
      const eWrap = document.createElement('div');
      eWrap.className = 'issue-field issue-evidence';
      const el = document.createElement('span');
      el.textContent = '判断依据';
      const ul = document.createElement('ul');
      evidence.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      eWrap.appendChild(el);
      eWrap.appendChild(ul);
      body.appendChild(eWrap);
    }

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
      const ok = await copyText(issue.excelAddress);
      showToast(ok ? `已复制：${issue.excelAddress}` : '复制失败，请手动选择文本。');
    });
    actions.appendChild(copyButton);
    item.appendChild(actions);

    item.dataset.key = `${issue.sheetName}!${issue.cellAddress}`;
    item.classList.add('issue-item--clickable');
    item.addEventListener('click', () => { if (state.model) state.model.selectIssue(issue); });

    return item;
  }

  function issueIsPlug(issue) {
    if (typeof HardcodeViewerCore !== 'undefined') return HardcodeViewerCore.isRoundingPlug(issue);
    if (issue.ruleId === 'HC006') return true;
    const details = Array.isArray(issue.constantDetails) ? issue.constantDetails : [];
    return details.some((d) => d && d.role === 'ROUNDING_PLUG');
  }

  function currentFiltered() {
    const sheet = sheetFilter.value;
    const kind = state.filterKind;
    return state.issues.filter((issue) => {
      if (sheet && issue.sheetName !== sheet) return false;
      if (!kind) return true;
      if (kind === 'ROUNDING_PLUG') return issueIsPlug(issue);
      return issue.severity === kind;
    });
  }

  function highlightActiveIssue() {
    const selected = state.model ? state.model.state().selectedIssue : null;
    const key = selected ? `${selected.sheetName}!${selected.cellAddress}` : '';
    issueList.querySelectorAll('.issue-item').forEach((node) => {
      const active = Boolean(key) && node.dataset.key === key;
      node.classList.toggle('is-active', active);
      if (active && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderIssues(resetVisible) {
    const filtered = currentFiltered();
    if (resetVisible) state.visible = 0;
    const total = filtered.length;
    const shown = Math.min(total, Math.max(PAGE_SIZE, state.visible || PAGE_SIZE));
    state.visible = shown;

    filterCountLabel.textContent = `${total} 条`;
    issueCountChip.textContent = `${state.issues.length} 条`;

    issueList.textContent = '';
    const fragment = document.createDocumentFragment();
    filtered.slice(0, shown).forEach((issue) => fragment.appendChild(makeIssueNode(issue)));
    issueList.appendChild(fragment);

    issuesEmpty.hidden = total !== 0;
    issueList.hidden = total === 0;
    const hasMore = shown < total;
    pagination.hidden = !hasMore;
    pageLabel.textContent = hasMore ? `已显示 ${shown} / ${total}` : '';

    highlightActiveIssue();
  }

  function applyFiltersToModel() {
    if (!state.model) return;
    state.model.setFilterKind(state.filterKind);
    state.model.setFilterSheet(sheetFilter.value || '');
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
    statSheets.textContent = summary.sheetCount;
    statCells.textContent = summary.scannedCells;
    statFormula.textContent = summary.formulaCells;
    statHigh.textContent = summary.highCount;
    statSuspicious.textContent = summary.suspiciousCount;
    statNotice.textContent = summary.noticeCount;
    resultSubtitle.textContent = summary.issueCount === 0
      ? '未发现疑似死数。'
      : `共发现 ${summary.issueCount} 个疑似问题（高风险 ${summary.highCount} · 可疑 ${summary.suspiciousCount} · 硬编码提示 ${summary.noticeCount} · 人工尾差/勾稽调整 ${summary.roundingPlugCount || 0}）。`;
  }

  function initViewer() {
    if (!excelViewerHost) return;
    if (typeof HardcodeViewerCore === 'undefined' || typeof HardcodeExcelViewer === 'undefined') {
      excelViewerHost.textContent = '';
      const note = document.createElement('div');
      note.className = 'vwr-empty';
      note.textContent = '网页内定位组件未能加载，请刷新页面后重试。';
      excelViewerHost.appendChild(note);
      return;
    }
    state.model = HardcodeViewerCore.createViewerModel(state.workbook, state.issues);
    state.viewer = HardcodeExcelViewer.createExcelViewer({ root: excelViewerHost, model: state.model });
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
      state.originalBytes = new Uint8Array(buffer.slice(0));
      await new Promise((resolve) => setTimeout(resolve, 30));
      processMessage.textContent = '正在扫描工作表与公式…';
      jobStatus.textContent = 'SCANNING';
      setProgress(55);

      let wb;
      try {
        wb = XLSX.read(new Uint8Array(buffer), HardcodeWorkbook.readOptions({ type: 'array' }));
      } catch (_) {
        throw new Error('无法解析该文件。请确认它是有效的 .xlsx 工作簿，且未加密或损坏。');
      }

      const result = HardcodeWorkbook.scanWorkbook(XLSX, wb);
      state.workbook = wb;
      state.issues = result.issues;
      state.summary = result.summary;
      state.sheetStats = result.sheetStats;
      state.filterKind = '';
      state.visible = 0;

      setProgress(100);
      processMessage.textContent = '扫描完成';
      jobStatus.textContent = 'DONE';

      renderSummary(result.summary);
      populateSheetFilter();
      initViewer();
      renderIssues(true);

      resultsPanel.hidden = false;
      startButton.disabled = false;
      downloadReportButton.disabled = false;
      downloadHighlightButton.disabled = false;
      if (highlightStatus) { highlightStatus.hidden = true; highlightStatus.textContent = ''; highlightStatus.classList.remove('is-error'); }
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

  async function downloadReport() {
    if (!state.summary) return;
    downloadReportButton.disabled = true;
    try {
      const wb = HardcodeWorkbook.buildReportWorkbook(
        XLSX,
        { fileName: state.file ? state.file.name : 'workbook.xlsx', generatedAt: new Date().toISOString() },
        state.issues,
        state.summary
      );
      const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(blob, `${state.baseName}_死数检查报告.xlsx`);
      showToast('已生成死数检查报告。');
    } catch (_) {
      showToast('生成报告失败，请重试。');
    } finally {
      downloadReportButton.disabled = false;
    }
  }

  const HIGHLIGHT_BUTTON_HTML = downloadHighlightButton.innerHTML;

  function setHighlightStatus(message, isError) {
    if (!highlightStatus) return;
    if (!message) { highlightStatus.hidden = true; highlightStatus.textContent = ''; highlightStatus.classList.remove('is-error'); return; }
    highlightStatus.hidden = false;
    highlightStatus.textContent = message;
    highlightStatus.classList.toggle('is-error', Boolean(isError));
  }

  // Independent of the report export: a failure here never blocks the report.
  async function downloadHighlight() {
    if (!state.summary || !state.originalBytes) return;
    if (typeof HardcodeOoxmlHighlight === 'undefined' || typeof fflate === 'undefined') {
      setHighlightStatus('对比文件生成失败，原文件未受影响。', true);
      showToast('对比文件生成失败，原文件未受影响。');
      return;
    }
    downloadHighlightButton.disabled = true;
    downloadHighlightButton.textContent = '正在生成对比文件…';
    setHighlightStatus('正在生成对比文件…', false);
    try {
      const { data } = HardcodeOoxmlHighlight.buildHighlightedWorkbook(
        fflate,
        state.originalBytes,
        state.issues,
        {}
      );
      const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(blob, `${state.baseName}_死数标黄对比版.xlsx`);
      setHighlightStatus('已生成标黄对比文件。', false);
      showToast('已生成标黄对比文件。');
    } catch (_) {
      setHighlightStatus('对比文件生成失败，原文件未受影响。', true);
      showToast('对比文件生成失败，原文件未受影响。');
    } finally {
      downloadHighlightButton.disabled = false;
      downloadHighlightButton.innerHTML = HIGHLIGHT_BUTTON_HTML;
    }
  }

  startButton.addEventListener('click', runScan);
  downloadReportButton.addEventListener('click', downloadReport);
  downloadHighlightButton.addEventListener('click', downloadHighlight);
  sheetFilter.addEventListener('change', () => { renderIssues(true); applyFiltersToModel(); });
  severityTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.severity-tab');
    if (!button) return;
    state.filterKind = button.dataset.filter || '';
    [...severityTabs.querySelectorAll('.severity-tab')].forEach((tab) => {
      tab.classList.toggle('active', tab === button);
    });
    renderIssues(true);
    applyFiltersToModel();
  });
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
  const SPLITTER_GAP = 16; // left grid gap + half splitter width

  function leftBounds() {
    const shellWidth = (reviewShell && reviewShell.clientWidth) || 1440;
    const max = Math.max(LEFT_MIN, Math.min(LEFT_MAX, shellWidth - 8 - 24 - VIEWER_MIN));
    return { min: LEFT_MIN, max };
  }

  // Persist the user's chosen list width on the shell element (and localStorage).
  // Nothing else rewrites this variable, so it never snaps back after renders.
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

  function refreshViewerSoon() {
    if (state.viewer && state.viewer.refresh) state.viewer.refresh();
  }

  (function initSplitter() {
    if (!reviewSplitter || !reviewShell) return;
    let saved = 0;
    try { saved = Number(localStorage.getItem('hv-left-w')) || 0; } catch (_) {}
    setLeftWidth(saved > 0 ? saved : 340);

    let dragging = false;
    let rafPending = false;
    const scheduleRefresh = () => {
      if (rafPending) return;
      rafPending = true;
      window.requestAnimationFrame(() => { rafPending = false; refreshViewerSoon(); });
    };
    const move = (event) => {
      if (!dragging) return;
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const rect = reviewShell.getBoundingClientRect();
      setLeftWidth(clientX - rect.left - SPLITTER_GAP);
      scheduleRefresh();
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
      refreshViewerSoon();
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
      refreshViewerSoon();
    });
    window.addEventListener('resize', () => setLeftWidth(currentLeftWidth()));
  })();

  if (typeof XLSX === 'undefined') {
    startButton.disabled = true;
    showError('未能加载本地 Excel 引擎，请刷新页面后重试。');
  }
})();

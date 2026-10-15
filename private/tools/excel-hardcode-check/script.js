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

  const sheetFilter = $('#sheetFilter');
  const severityTabs = $('#severityTabs');
  const filterCountLabel = $('#filterCountLabel');
  const issueList = $('#issueList');
  const issuesEmpty = $('#issuesEmpty');
  const pagination = $('#pagination');
  const loadMoreButton = $('#loadMoreButton');
  const pageLabel = $('#pageLabel');
  const issueCountChip = $('#issueCountChip');

  const PAGE_SIZE = 50;

  const state = {
    file: null,
    baseName: 'workbook',
    issues: [],
    summary: null,
    sheetStats: [],
    severity: '',
    visible: 0
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
    state.sheetStats = [];
    state.visible = 0;
    resultsPanel.hidden = true;
    processPanel.hidden = true;
    errorBox.hidden = true;
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

    const sheet = document.createElement('span');
    sheet.className = 'issue-sheet';
    sheet.textContent = `工作表：${issue.sheetName}${issue.sheetHidden ? '（隐藏）' : ''}`;
    loc.appendChild(sheet);

    const cell = document.createElement('span');
    cell.className = 'issue-cell';
    cell.textContent = issue.cellAddress;
    loc.appendChild(cell);
    top.appendChild(loc);
    item.appendChild(top);

    const body = document.createElement('div');
    body.className = 'issue-body';

    const current = issue.cellType === 'formula'
      ? (issue.formula || '—')
      : (issue.value === null || issue.value === undefined ? '—' : String(issue.value));

    const fields = [
      { label: '当前值 / 公式', value: current, code: issue.cellType === 'formula' },
      { label: '固定数值', value: constantsText(issue), code: true },
      { label: '问题类型', value: ruleTitle(issue), code: false },
      { label: 'Excel Address', value: issue.excelAddress, code: true },
      { label: '建议', value: issue.suggestion, code: false }
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

    const evidence = document.createElement('div');
    evidence.className = 'issue-field issue-evidence';
    const evidenceLabel = document.createElement('span');
    evidenceLabel.textContent = '判断依据';
    const list = document.createElement('ul');
    issue.evidence.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    });
    evidence.appendChild(evidenceLabel);
    evidence.appendChild(list);
    body.appendChild(evidence);

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'issue-actions';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-button';
    copyButton.textContent = '复制地址';
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(issue.excelAddress);
      showToast(ok ? `已复制：${issue.excelAddress}` : '复制失败，请手动选择文本。');
    });
    actions.appendChild(copyButton);
    item.appendChild(actions);

    return item;
  }

  function currentFiltered() {
    const sheet = sheetFilter.value;
    return state.issues.filter((issue) => {
      if (sheet && issue.sheetName !== sheet) return false;
      if (state.severity && issue.severity !== state.severity) return false;
      return true;
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
      state.issues = result.issues;
      state.summary = result.summary;
      state.sheetStats = result.sheetStats;

      setProgress(100);
      processMessage.textContent = '扫描完成';
      jobStatus.textContent = 'DONE';

      renderSummary(result.summary);
      populateSheetFilter();
      renderIssues(true);

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

  startButton.addEventListener('click', runScan);
  downloadReportButton.addEventListener('click', downloadReport);
  sheetFilter.addEventListener('change', () => renderIssues(true));
  severityTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.severity-tab');
    if (!button) return;
    state.severity = button.dataset.severity || '';
    [...severityTabs.querySelectorAll('.severity-tab')].forEach((tab) => {
      tab.classList.toggle('active', tab === button);
    });
    renderIssues(true);
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

  if (typeof XLSX === 'undefined') {
    startButton.disabled = true;
    showError('未能加载本地 Excel 引擎，请刷新页面后重试。');
  }
})();

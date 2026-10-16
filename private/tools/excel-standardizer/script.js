'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
const progressBar = $('#progressBar');
const progressValue = $('#progressValue');
const processMessage = $('#processMessage');
const jobStatus = $('#jobStatus');
const jobIdLabel = $('#jobIdLabel');
const errorBox = $('#errorBox');
const toast = $('#toast');
const featureCount = $('#featureCount');
const featureHint = $('#featureHint');
const featureInputs = $$('[data-feature]');

const FEATURE_KEYS = [
  'trim_text',
  'normalize_dates',
  'normalize_datetime',
  'header_style',
  'autofit_columns',
  'freeze_header',
  'auto_filter',
  'remove_empty_rows'
];

const FEATURE_LABELS = {
  trim_text: '\u53bb\u9664\u6587\u672c\u9996\u5c3e\u7a7a\u683c',
  normalize_dates: '\u7edf\u4e00\u65e5\u671f\u683c\u5f0f',
  normalize_datetime: '\u7edf\u4e00\u65e5\u671f\u65f6\u95f4\u683c\u5f0f',
  header_style: '\u7edf\u4e00\u8868\u5934\u6837\u5f0f',
  autofit_columns: '\u81ea\u52a8\u8c03\u6574\u5217\u5bbd',
  freeze_header: '\u51bb\u7ed3\u8868\u5934',
  auto_filter: '\u6dfb\u52a0\u81ea\u52a8\u7b5b\u9009',
  remove_empty_rows: '\u5220\u9664\u7a7a\u767d\u884c'
};

const RECOMMENDED_SELECTION = Object.freeze({
  trim_text: true,
  normalize_dates: true,
  normalize_datetime: false,
  header_style: true,
  autofit_columns: true,
  freeze_header: true,
  auto_filter: true,
  remove_empty_rows: false
});

const state = {
  file: null,
  jobId: null,
  job: null,
  selection: { ...RECOMMENDED_SELECTION },
  pollTimer: null,
  changes: { page: 1, pageSize: 30, total: 0 },
  preview: null
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__xlsToast);
  window.__xlsToast = setTimeout(() => toast.classList.remove('show'), 2300);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / (1024 ** index);
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function readSelection() {
  const selection = {};
  featureInputs.forEach((input) => { selection[input.dataset.feature] = input.checked; });
  return selection;
}

function selectedFeatureKeys(selection = state.selection) {
  return FEATURE_KEYS.filter((key) => selection?.[key] === true);
}

function applySelection(selection) {
  featureInputs.forEach((input) => {
    input.checked = selection?.[input.dataset.feature] === true;
  });
  state.selection = readSelection();
  updateSelectionUI();
}

function updateStartButton() {
  const hasFile = Boolean(state.file);
  const hasFeature = selectedFeatureKeys(readSelection()).length > 0;
  startButton.disabled = !(hasFile && hasFeature);
}

function updateSelectionUI() {
  state.selection = readSelection();
  const count = selectedFeatureKeys().length;
  featureCount.textContent = `\u5df2\u9009\u62e9 ${count} / ${FEATURE_KEYS.length} \u9879`;
  featureHint.textContent = count ? '\u4ec5\u6267\u884c\u672c\u6b21\u5df2\u52fe\u9009\u7684\u529f\u80fd' : '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u529f\u80fd';
  featureHint.classList.toggle('warning', count === 0);
  updateStartButton();
}

function setFile(file) {
  if (!file) return clearFile();
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showToast('\u5f53\u524d\u7248\u672c\u53ea\u652f\u6301 .xlsx \u6587\u4ef6\u3002');
    return;
  }
  state.file = file;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} \u00b7 XLSX \u5de5\u4f5c\u7c3f`;
  selectedFile.hidden = false;
  updateStartButton();
}

function clearFile() {
  state.file = null;
  fileInput.value = '';
  selectedFile.hidden = true;
  updateStartButton();
}

fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
clearFileButton.addEventListener('click', clearFile);
['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
}));
dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer.files?.[0]));

function uploadFile(file, selection) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('profile', 'default');
    form.append('selection', JSON.stringify(selection));

    xhr.open('POST', '/api/excel/jobs');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(12, Math.max(1, Math.round((event.loaded / event.total) * 12)));
      setProgress(percent, '\u6b63\u5728\u4e0a\u4f20\u6587\u4ef6\u2026', 'UPLOADING');
    });
    xhr.addEventListener('load', () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok) return resolve(payload);
      reject(new Error(payload.message || `\u4e0a\u4f20\u5931\u8d25 (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('\u7f51\u7edc\u9519\u8bef\uff0c\u4e0a\u4f20\u5931\u8d25\u3002')));
    xhr.send(form);
  });
}

function setProgress(progress, message, status) {
  const safe = Math.max(0, Math.min(100, Number(progress || 0)));
  progressBar.style.width = `${safe}%`;
  progressValue.textContent = `${safe}%`;
  if (message) processMessage.textContent = message;
  if (status) jobStatus.textContent = String(status).toUpperCase();
}

function updateStages(stage, status) {
  const normalizedStage = stage === 'saving' ? 'checking' : (stage === 'starting' || stage === 'processing' ? 'validating' : stage);
  const selected = selectedFeatureKeys(state.job?.selection || state.selection);
  const activeOrder = ['validating', ...selected, 'checking', 'reporting', 'completed'];
  const currentIndex = activeOrder.indexOf(normalizedStage);

  $$('#stageGrid [data-stage]').forEach((item) => {
    const itemStage = item.dataset.stage;
    const isFeature = item.hasAttribute('data-feature-stage');
    const skipped = isFeature && !selected.includes(itemStage);
    const index = activeOrder.indexOf(itemStage);
    item.classList.toggle('skipped', skipped);
    item.classList.toggle('done', !skipped && (status === 'completed' || (currentIndex >= 0 && index >= 0 && index < currentIndex)));
    item.classList.toggle('active', !skipped && status !== 'completed' && itemStage === normalizedStage);
  });
}

async function startJob() {
  const selection = readSelection();
  const selected = selectedFeatureKeys(selection);
  if (!state.file) return;
  if (!selected.length) {
    showToast('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u6807\u51c6\u5316\u529f\u80fd\u3002');
    updateStartButton();
    return;
  }

  state.selection = selection;
  startButton.disabled = true;
  processPanel.hidden = false;
  resultsPanel.hidden = true;
  errorBox.hidden = true;
  processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setProgress(1, '\u6b63\u5728\u4e0a\u4f20\u6587\u4ef6\u2026', 'UPLOADING');
  updateStages('validating', 'queued');

  try {
    const payload = await uploadFile(state.file, selection);
    state.jobId = payload.job.id;
    state.job = payload.job;
    localStorage.setItem('liuxianlab-last-excel-job', state.jobId);
    jobIdLabel.textContent = state.jobId;
    renderJob(state.job);
    startPolling();
  } catch (error) {
    updateStartButton();
    showJobError(error.message);
  }
}

function showJobError(message) {
  errorBox.textContent = message || '\u5904\u7406\u5931\u8d25\u3002';
  errorBox.hidden = false;
  setProgress(100, '\u4efb\u52a1\u5931\u8d25', 'FAILED');
}

function renderJob(job) {
  state.job = job;
  if (job.selection) state.selection = { ...job.selection };
  setProgress(job.progress, job.message, job.status);
  jobIdLabel.textContent = job.id || state.jobId || '';
  updateStages(job.stage, job.status);
  if (job.status === 'failed') {
    stopPolling();
    updateStartButton();
    showJobError(job.error || job.message || 'Excel \u5904\u7406\u5931\u8d25\u3002');
  }
  if (job.status === 'completed') {
    stopPolling();
    renderResults(job);
  }
}

async function fetchJob() {
  if (!state.jobId) return;
  const response = await fetch(`/api/excel/jobs/${encodeURIComponent(state.jobId)}`, { headers: { Accept: 'application/json' } });
  if (response.status === 401) return window.location.replace('/login');
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || '\u65e0\u6cd5\u8bfb\u53d6\u4efb\u52a1\u72b6\u6001\u3002');
  renderJob(payload.job);
}

function startPolling() {
  stopPolling();
  fetchJob().catch((error) => showJobError(error.message));
  state.pollTimer = setInterval(() => fetchJob().catch((error) => showJobError(error.message)), 1200);
}
function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

function typeCount(summary, ...types) {
  return types.reduce((total, type) => total + Number(summary?.byType?.[type] || 0), 0);
}

async function renderResults(job) {
  processPanel.hidden = false;
  resultsPanel.hidden = false;
  const summary = job.summary || {};
  $('#totalChanges').textContent = Number(summary.totalChanges || 0);
  $('#valueChanges').textContent = typeCount(summary, 'value');
  $('#formatChanges').textContent = typeCount(summary, 'format', 'style');
  $('#structureChanges').textContent = typeCount(summary, 'dimension', 'sheet', 'structure');
  $('#resultSubtitle').textContent = `${job.outputName || 'standardized.xlsx'} \u00b7 ${formatBytes(summary.outputBytes || job.outputBytes)}`;
  $('#downloadButton').href = `/api/excel/jobs/${encodeURIComponent(job.id)}/download`;
  populateSummary(summary);
  populateSheetFilter(summary);
  await Promise.allSettled([loadChanges(1), loadPreview()]);
  resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateSummary(summary) {
  const sheetSummary = $('#sheetSummary');
  const ruleSummary = $('#ruleSummary');
  sheetSummary.replaceChildren();
  ruleSummary.replaceChildren();

  (summary.sheets || []).forEach((sheet) => {
    const row = document.createElement('div'); row.className = 'summary-line';
    const name = document.createElement('span'); name.textContent = sheet.name;
    const meta = document.createElement('strong'); meta.textContent = `${sheet.rows} \u884c \u00d7 ${sheet.columns} \u5217`;
    row.append(name, meta); sheetSummary.appendChild(row);
  });

  const selection = summary.selection || state.job?.selection || state.selection;
  FEATURE_KEYS.forEach((key) => {
    const row = document.createElement('div'); row.className = 'summary-line';
    const name = document.createElement('span'); name.textContent = FEATURE_LABELS[key] || key;
    const meta = document.createElement('strong');
    if (selection?.[key]) {
      meta.textContent = `${Number(summary.byRule?.[key] || 0)} \u9879`;
      row.classList.add('selected-rule');
    } else {
      meta.textContent = '\u672a\u9009\u62e9';
      row.classList.add('unselected-rule');
    }
    row.append(name, meta); ruleSummary.appendChild(row);
  });
}

function populateSheetFilter(summary) {
  const filter = $('#sheetFilter');
  filter.replaceChildren(new Option('\u5168\u90e8\u5de5\u4f5c\u8868', ''));
  (summary.sheets || []).forEach((sheet) => filter.add(new Option(sheet.name, sheet.name)));
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '\u2014';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

async function loadChanges(page = 1) {
  if (!state.jobId) return;
  const params = new URLSearchParams({ page: String(page), pageSize: String(state.changes.pageSize) });
  const type = $('#typeFilter').value;
  const sheet = $('#sheetFilter').value;
  if (type) params.set('type', type);
  if (sheet) params.set('sheet', sheet);
  const response = await fetch(`/api/excel/jobs/${encodeURIComponent(state.jobId)}/changes?${params}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || '\u65e0\u6cd5\u8bfb\u53d6\u53d8\u66f4\u8bb0\u5f55\u3002');
  state.changes.page = payload.page;
  state.changes.total = payload.total;
  renderChanges(payload.items || []);
  renderPagination();
}

function renderChanges(items) {
  const list = $('#changeList');
  list.replaceChildren();
  $('#changeCountLabel').textContent = `${state.changes.total} \u6761\u8bb0\u5f55`;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'change-item'; empty.textContent = '\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\u4e0b\u6ca1\u6709\u53d8\u66f4\u8bb0\u5f55\u3002'; list.appendChild(empty); return;
  }
  items.forEach((item) => {
    const article = document.createElement('article'); article.className = 'change-item';
    const head = document.createElement('div'); head.className = 'change-head';
    const title = document.createElement('strong'); title.textContent = `${item.sheet} / ${item.target}`;
    const type = document.createElement('span'); type.className = 'change-type'; type.textContent = item.type;
    head.append(title, type);
    const reason = document.createElement('p'); reason.className = 'change-reason'; reason.textContent = item.reason || FEATURE_LABELS[item.rule] || item.rule;
    const compare = document.createElement('div'); compare.className = 'before-after';
    ['before', 'after'].forEach((key) => {
      const box = document.createElement('div');
      const label = document.createElement('span'); label.textContent = key === 'before' ? '\u4fee\u6539\u524d' : '\u4fee\u6539\u540e';
      const code = document.createElement('code'); code.textContent = displayValue(item[key]);
      box.append(label, code); compare.appendChild(box);
    });
    article.append(head, reason, compare); list.appendChild(article);
  });
}

function renderPagination() {
  const pages = Math.max(1, Math.ceil(state.changes.total / state.changes.pageSize));
  $('#pagination').hidden = pages <= 1;
  $('#pageLabel').textContent = `${state.changes.page} / ${pages}`;
  $('#prevPage').disabled = state.changes.page <= 1;
  $('#nextPage').disabled = state.changes.page >= pages;
}

async function loadPreview() {
  if (!state.jobId) return;
  const response = await fetch(`/api/excel/jobs/${encodeURIComponent(state.jobId)}/preview`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return;
  state.preview = await response.json();
  const select = $('#previewSheetSelect');
  select.replaceChildren();
  (state.preview.sheets || []).forEach((sheet, index) => select.add(new Option(sheet.name, String(index))));
  renderPreviewSheet(0);
}

function excelColumnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) { const rem = (n - 1) % 26; name = String.fromCharCode(65 + rem) + name; n = Math.floor((n - 1) / 26); }
  return name;
}

function renderPreviewSheet(index) {
  const container = $('#sheetPreview');
  container.replaceChildren();
  const sheet = state.preview?.sheets?.[Number(index)];
  if (!sheet) return;
  const table = document.createElement('table');
  const thead = document.createElement('thead'); const headerRow = document.createElement('tr');
  const corner = document.createElement('th'); corner.className = 'row-index'; corner.textContent = '#'; headerRow.appendChild(corner);
  for (let col = 0; col < sheet.previewColumns; col += 1) { const th = document.createElement('th'); th.textContent = excelColumnName(col); headerRow.appendChild(th); }
  thead.appendChild(headerRow); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  (sheet.rows || []).forEach((row, rowIndex) => {
    const tr = document.createElement('tr'); const indexCell = document.createElement('td'); indexCell.className = 'row-index'; indexCell.textContent = String(rowIndex + 1); tr.appendChild(indexCell);
    row.forEach((value) => { const td = document.createElement('td'); td.textContent = displayValue(value); td.title = displayValue(value); tr.appendChild(td); });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); container.appendChild(table);
}

function resetView() {
  stopPolling();
  state.jobId = null; state.job = null; state.preview = null; state.changes.page = 1; state.changes.total = 0;
  localStorage.removeItem('liuxianlab-last-excel-job');
  clearFile();
  applySelection(RECOMMENDED_SELECTION);
  processPanel.hidden = true; resultsPanel.hidden = true; errorBox.hidden = true;
  setProgress(0, '\u6b63\u5728\u51c6\u5907\u4efb\u52a1\u2026', 'QUEUED');
  $$('#stageGrid>div').forEach((item) => item.classList.remove('done', 'active', 'skipped'));
  uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function tryResumeLastJob() {
  const jobId = localStorage.getItem('liuxianlab-last-excel-job');
  if (!jobId) return;
  try {
    const response = await fetch(`/api/excel/jobs/${encodeURIComponent(jobId)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return localStorage.removeItem('liuxianlab-last-excel-job');
    const payload = await response.json();
    if (!payload.ok) return;
    state.jobId = jobId;
    if (payload.job.selection) applySelection(payload.job.selection);
    processPanel.hidden = false;
    renderJob(payload.job);
    if (!['completed', 'failed'].includes(payload.job.status)) startPolling();
  } catch (_) {}
}

featureInputs.forEach((input) => input.addEventListener('change', updateSelectionUI));
$('#selectAllFeatures').addEventListener('click', () => {
  applySelection(Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])));
});
$('#recommendedFeatures').addEventListener('click', () => applySelection(RECOMMENDED_SELECTION));
startButton.addEventListener('click', startJob);
newJobButton.addEventListener('click', resetView);
$('#sheetFilter').addEventListener('change', () => loadChanges(1).catch((error) => showToast(error.message)));
$('#typeFilter').addEventListener('change', () => loadChanges(1).catch((error) => showToast(error.message)));
$('#prevPage').addEventListener('click', () => loadChanges(state.changes.page - 1).catch((error) => showToast(error.message)));
$('#nextPage').addEventListener('click', () => loadChanges(state.changes.page + 1).catch((error) => showToast(error.message)));
$('#previewSheetSelect').addEventListener('change', (event) => renderPreviewSheet(event.target.value));
$$('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  $$('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
  const tab = button.dataset.tab;
  $('#changesView').hidden = tab !== 'changes';
  $('#previewView').hidden = tab !== 'preview';
  $('#summaryView').hidden = tab !== 'summary';
}));

applySelection(RECOMMENDED_SELECTION);
tryResumeLastJob();

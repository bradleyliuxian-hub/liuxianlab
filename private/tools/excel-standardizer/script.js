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

const state = {
  file: null,
  jobId: null,
  job: null,
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

function setFile(file) {
  if (!file) return clearFile();
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showToast('当前版本只支持 .xlsx 文件。');
    return;
  }
  state.file = file;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · XLSX 工作簿`;
  selectedFile.hidden = false;
  startButton.disabled = false;
}

function clearFile() {
  state.file = null;
  fileInput.value = '';
  selectedFile.hidden = true;
  startButton.disabled = true;
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

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('profile', 'default');

    xhr.open('POST', '/api/excel/jobs');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(12, Math.max(1, Math.round((event.loaded / event.total) * 12)));
      setProgress(percent, '正在上传文件…', 'UPLOADING');
    });
    xhr.addEventListener('load', () => {
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok) return resolve(payload);
      reject(new Error(payload.message || `上传失败 (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败。')));
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

const stageOrder = ['validating', 'trim_text', 'normalize_dates', 'header_style', 'autofit_columns', 'sheet_settings', 'checking', 'reporting', 'completed'];
function updateStages(stage, status) {
  const normalizedStage = stage === 'saving' || stage === 'starting' ? 'checking' : stage;
  const currentIndex = stageOrder.indexOf(normalizedStage);
  $$('#stageGrid [data-stage]').forEach((item) => {
    const index = stageOrder.indexOf(item.dataset.stage);
    item.classList.toggle('done', status === 'completed' || (currentIndex >= 0 && index < currentIndex));
    item.classList.toggle('active', status !== 'completed' && item.dataset.stage === normalizedStage);
  });
}

async function startJob() {
  if (!state.file) return;
  startButton.disabled = true;
  processPanel.hidden = false;
  resultsPanel.hidden = true;
  errorBox.hidden = true;
  processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setProgress(1, '正在上传文件…', 'UPLOADING');
  try {
    const payload = await uploadFile(state.file);
    state.jobId = payload.job.id;
    state.job = payload.job;
    localStorage.setItem('liuxianlab-last-excel-job', state.jobId);
    jobIdLabel.textContent = state.jobId;
    renderJob(state.job);
    startPolling();
  } catch (error) {
    startButton.disabled = false;
    showJobError(error.message);
  }
}

function showJobError(message) {
  errorBox.textContent = message || '处理失败。';
  errorBox.hidden = false;
  setProgress(100, '任务失败', 'FAILED');
}

function renderJob(job) {
  state.job = job;
  setProgress(job.progress, job.message, job.status);
  jobIdLabel.textContent = job.id || state.jobId || '';
  updateStages(job.stage, job.status);
  if (job.status === 'failed') {
    stopPolling();
    startButton.disabled = false;
    showJobError(job.error || job.message || 'Excel 处理失败。');
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
  if (!response.ok || !payload.ok) throw new Error(payload.message || '无法读取任务状态。');
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
  $('#resultSubtitle').textContent = `${job.outputName || 'standardized.xlsx'} · ${formatBytes(summary.outputBytes || job.outputBytes)}`;
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
    const meta = document.createElement('strong'); meta.textContent = `${sheet.rows} 行 × ${sheet.columns} 列`;
    row.append(name, meta); sheetSummary.appendChild(row);
  });
  (summary.rulesApplied || []).forEach((rule) => {
    const row = document.createElement('div'); row.className = 'summary-line';
    const name = document.createElement('span'); name.textContent = rule;
    const count = document.createElement('strong'); count.textContent = `${summary.byRule?.[rule] || 0} 项`;
    row.append(name, count); ruleSummary.appendChild(row);
  });
}

function populateSheetFilter(summary) {
  const filter = $('#sheetFilter');
  filter.replaceChildren(new Option('全部工作表', ''));
  (summary.sheets || []).forEach((sheet) => filter.add(new Option(sheet.name, sheet.name)));
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
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
  if (!response.ok || !payload.ok) throw new Error(payload.message || '无法读取变更记录。');
  state.changes.page = payload.page;
  state.changes.total = payload.total;
  renderChanges(payload.items || []);
  renderPagination();
}

function renderChanges(items) {
  const list = $('#changeList');
  list.replaceChildren();
  $('#changeCountLabel').textContent = `${state.changes.total} 条记录`;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'change-item'; empty.textContent = '当前筛选条件下没有变更记录。'; list.appendChild(empty); return;
  }
  items.forEach((item) => {
    const article = document.createElement('article'); article.className = 'change-item';
    const head = document.createElement('div'); head.className = 'change-head';
    const title = document.createElement('strong'); title.textContent = `${item.sheet} / ${item.target}`;
    const type = document.createElement('span'); type.className = 'change-type'; type.textContent = item.type;
    head.append(title, type);
    const reason = document.createElement('p'); reason.className = 'change-reason'; reason.textContent = item.reason || item.rule;
    const compare = document.createElement('div'); compare.className = 'before-after';
    ['before', 'after'].forEach((key) => {
      const box = document.createElement('div');
      const label = document.createElement('span'); label.textContent = key === 'before' ? '修改前' : '修改后';
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
  processPanel.hidden = true; resultsPanel.hidden = true; errorBox.hidden = true;
  setProgress(0, '正在准备任务…', 'QUEUED');
  $$('#stageGrid>div').forEach((item) => item.classList.remove('done', 'active'));
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
    processPanel.hidden = false;
    renderJob(payload.job);
    if (!['completed', 'failed'].includes(payload.job.status)) startPolling();
  } catch (_) {}
}

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

tryResumeLastJob();

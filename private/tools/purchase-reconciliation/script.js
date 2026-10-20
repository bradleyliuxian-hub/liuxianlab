'use strict';

const API = '/api/purchase-reconciliations';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  meta: null,
  file: null,
  job: null,
  inspection: null,
  summary: null,
  tab: 'overview',
  subTab: 'segments',
  pageSize: 50,
  matched: { page: 1, search: '', sort: 'matchId', direction: '' },
  remaining: { page: 1, search: '', sort: 'sourceRow', direction: '' },
  unmatched: { page: 1, search: '', sort: 'sourceRow' },
  pollTimer: null,
  xlsxTimer: null,
  redetectTimer: null,
  toastTimer: null
};

const els = {
  fileInput: $('#fileInput'),
  dropZone: $('#dropZone'),
  selectedFile: $('#selectedFile'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  clearFileButton: $('#clearFileButton'),
  uploadProgress: $('#uploadProgress'),
  uploadProgressBar: $('#uploadProgressBar'),
  uploadProgressText: $('#uploadProgressText'),
  uploadButton: $('#uploadButton'),
  uploadError: $('#uploadError'),
  detectPanel: $('#detectPanel'),
  detectSubtitle: $('#detectSubtitle'),
  detectStatus: $('#detectStatus'),
  sheetSelect: $('#sheetSelect'),
  headerRowInput: $('#headerRowInput'),
  redetectButton: $('#redetectButton'),
  detectedRows: $('#detectedRows'),
  detectedFields: $('#detectedFields'),
  fieldGrid: $('#fieldGrid'),
  fieldWarnings: $('#fieldWarnings'),
  sampleTable: $('#sampleTable'),
  sampleMeta: $('#sampleMeta'),
  detectError: $('#detectError'),
  rulePanel: $('#rulePanel'),
  ruleMatchFields: $('#ruleMatchFields'),
  startButton: $('#startButton'),
  startError: $('#startError'),
  processPanel: $('#processPanel'),
  processMessage: $('#processMessage'),
  jobStatus: $('#jobStatus'),
  progressBar: $('#progressBar'),
  progressValue: $('#progressValue'),
  jobIdLabel: $('#jobIdLabel'),
  processNote: $('#processNote'),
  processError: $('#processError'),
  resultPanel: $('#resultPanel'),
  resultSubtitle: $('#resultSubtitle'),
  resultMetrics: $('#resultMetrics'),
  conservationBanner: $('#conservationBanner'),
  csvButton: $('#csvButton'),
  xlsxButton: $('#xlsxButton'),
  primaryDownloadButton: $('#primaryDownloadButton'),
  refreshResultButton: $('#refreshResultButton'),
  overviewPanel: $('#overviewPanel'),
  matchedPanel: $('#matchedPanel'),
  remainingPanel: $('#remainingPanel'),
  unmatchedPanel: $('#unmatchedPanel'),
  amountBars: $('#amountBars'),
  movementTable: $('#movementTable'),
  overviewNotes: $('#overviewNotes'),
  matchedSearch: $('#matchedSearch'),
  matchedSort: $('#matchedSort'),
  pageSizeSelect: $('#pageSizeSelect'),
  matchedTable: $('#matchedTable'),
  matchedPager: $('#matchedPager'),
  remainingSearch: $('#remainingSearch'),
  remainingDirection: $('#remainingDirection'),
  remainingSort: $('#remainingSort'),
  remainingPageSize: $('#remainingPageSize'),
  remainingTable: $('#remainingTable'),
  remainingPager: $('#remainingPager'),
  unmatchedSearch: $('#unmatchedSearch'),
  unmatchedSort: $('#unmatchedSort'),
  unmatchedTable: $('#unmatchedTable'),
  unmatchedSummary: $('#unmatchedSummary'),
  unmatchedPager: $('#unmatchedPager'),
  historyList: $('#historyList'),
  refreshHistoryButton: $('#refreshHistoryButton'),
  newJobButton: $('#newJobButton'),
  uploadPanel: $('#uploadPanel'),
  detailBackdrop: $('#detailBackdrop'),
  detailDrawer: $('#detailDrawer'),
  detailTitle: $('#detailTitle'),
  detailSubtitle: $('#detailSubtitle'),
  detailBody: $('#detailBody'),
  closeDetailButton: $('#closeDetailButton'),
  toast: $('#toast')
};

const SORT_OPTIONS = {
  segments: [
    ['matchId', '匹配ID'],
    ['positiveSourceRow', '正向行号'],
    ['negativeSourceRow', '负向行号'],
    ['matchedQuantity', '对抵数量'],
    ['matchedAmount', '对抵金额'],
    ['positiveDate', '正向日期']
  ],
  records: [
    ['sourceRow', '原始行号'],
    ['matchedQuantity', '已对抵数量'],
    ['matchedAmount', '已对抵金额']
  ],
  remaining: [
    ['sourceRow', '原始行号'],
    ['remainingQuantity', '剩余数量'],
    ['remainingAmount', '剩余金额'],
    ['originalAmount', '原始金额'],
    ['deliveryDate', '送货日期'],
    ['supplier', '供应商'],
    ['purchaseOrder', '采购订单']
  ]
};

/* ------------------------------------------------------------------ utils */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function fmtInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '—';
}

function fmtMoney(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}

function fmtQty(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
    : '—';
}

function fmtBytes(bytes) {
  const number = Number(bytes) || 0;
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(2)} MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${number} B`;
}

function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function showError(node, message) {
  if (!node) return;
  if (!message) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('请先登录。');
  }
  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  }
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function badge(text, tone = 'gray') {
  return el('span', { class: `badge ${tone}`, text });
}

function statusLabel(status) {
  return {
    draft: '待确认',
    queued: '已排队',
    running: '处理中',
    completed: '已完成',
    failed: '失败'
  }[status] || status || '—';
}

function statusTone(status) {
  return {
    draft: 'gray',
    queued: 'blue',
    running: 'blue',
    completed: 'green',
    failed: 'red'
  }[status] || 'gray';
}

function setJobStatus(node, status) {
  if (!node) return;
  node.textContent = String(status || '—').toUpperCase();
  node.className = `job-status ${status || ''}`;
}

function rawValue(row, keys) {
  const raw = row?.raw || {};
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function stopTimers() {
  clearInterval(state.pollTimer);
  clearInterval(state.xlsxTimer);
  state.pollTimer = null;
  state.xlsxTimer = null;
}

/* ---------------------------------------------------------------- upload */

function validateFile(file) {
  if (!file) return '请选择文件。';
  const name = String(file.name || '').toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    return '仅支持 .xlsx / .xlsm 文件。';
  }
  const max = state.meta?.maxFileSizeBytes || 50 * 1024 * 1024;
  if (file.size > max) return `文件超过 ${fmtBytes(max)} 限制。`;
  return '';
}

function setFile(file) {
  const error = validateFile(file);
  if (error) {
    showError(els.uploadError, error);
    return;
  }
  state.file = file;
  showError(els.uploadError, '');
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${fmtBytes(file.size)} · 等待上传与字段识别`;
  els.selectedFile.hidden = false;
  els.uploadButton.disabled = false;
}

function clearFile() {
  state.file = null;
  els.fileInput.value = '';
  els.selectedFile.hidden = true;
  els.uploadButton.disabled = true;
  showError(els.uploadError, '');
}

function uploadFile() {
  if (!state.file) return;
  els.uploadButton.disabled = true;
  els.uploadProgress.hidden = false;
  els.uploadProgressBar.style.width = '0%';
  els.uploadProgressText.textContent = '正在上传…';
  showError(els.uploadError, '');

  const form = new FormData();
  form.append('file', state.file);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', API);
  xhr.responseType = 'json';
  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 80);
    els.uploadProgressBar.style.width = `${percent}%`;
    els.uploadProgressText.textContent = `正在上传… ${percent}%`;
  });
  xhr.addEventListener('load', () => {
    els.uploadProgress.hidden = true;
    els.uploadButton.disabled = false;
    const payload = xhr.response || {};
    if (xhr.status === 401) return location.replace('/login');
    if (xhr.status !== 201) {
      return showError(els.uploadError, payload.error || `上传失败（${xhr.status}）`);
    }
    handleUploaded(payload);
  });
  xhr.addEventListener('error', () => {
    els.uploadProgress.hidden = true;
    els.uploadButton.disabled = false;
    showError(els.uploadError, '上传失败，请检查网络后重试。');
  });
  xhr.send(form);
}

function handleUploaded(payload) {
  state.job = payload.job || null;
  state.inspection = payload.inspection || null;
  if (!state.job) return;
  if (!state.inspection || !state.inspection.ok) {
    els.detectPanel.hidden = false;
    els.rulePanel.hidden = true;
    els.detectSubtitle.textContent = '自动识别没有完成，请选择工作表与表头行后重新识别。';
    setJobStatus(els.detectStatus, 'draft');
    showError(els.detectError, state.inspection?.error || '无法自动识别表头，请手动指定。');
    populateSheets();
    els.headerRowInput.value = state.job.headerRow || 1;
    clear(els.fieldGrid);
    clear(els.sampleTable);
    return;
  }
  renderInspection(state.inspection);
  els.detectPanel.hidden = false;
  els.rulePanel.hidden = false;
  els.detectPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateSheets() {
  const sheets = state.inspection?.sheets || [];
  clear(els.sheetSelect);
  if (!sheets.length) {
    els.sheetSelect.append(el('option', { value: '', text: '未识别到工作表' }));
    return;
  }
  for (const sheet of sheets) {
    els.sheetSelect.append(el('option', {
      value: sheet.name,
      text: `${sheet.name}${sheet.state && sheet.state !== 'visible' ? `（${sheet.state}）` : ''}`
    }));
  }
  const selected = state.inspection?.selectedSheet || state.job?.sheetName;
  if (selected) els.sheetSelect.value = selected;
}

function renderInspection(inspection) {
  state.inspection = inspection;
  populateSheets();
  els.headerRowInput.value = inspection.headerRow || 1;
  els.detectedRows.textContent = fmtInt(inspection.dataRowCount);
  const schema = inspection.fieldSchema || state.meta?.fieldSchema || [];
  const mapping = inspection.mapping || {};
  const missing = new Set(inspection.missing || []);
  els.detectedFields.textContent = `${schema.length - missing.size} / ${schema.length}`;
  showError(els.detectError, '');

  clear(els.fieldGrid);
  for (const field of schema) {
    const header = mapping[field.key] || '';
    const card = el('div', {
      class: `field-card${field.required ? ' required' : ''}${missing.has(field.key) ? ' missing' : ''}`
    }, [
      el('div', { class: 'field-top' }, [
        el('strong', { text: field.label }),
        el('span', { class: 'tag', text: field.required ? '必需' : '可选' })
      ]),
      el('code', { text: header || (missing.has(field.key) ? '缺少该字段' : '未匹配') })
    ]);
    els.fieldGrid.append(card);
  }

  clear(els.fieldWarnings);
  if (missing.size) {
    const labels = (inspection.missingLabels || []).join('、');
    els.fieldWarnings.append(el('div', {
      class: 'warning-line error',
      text: `缺少必要字段：${labels}。请检查表头行或更换工作表。`
    }));
  }
  if (inspection.ambiguous && Object.keys(inspection.ambiguous).length) {
    els.fieldWarnings.append(el('div', {
      class: 'warning-line',
      text: '部分字段存在多个候选列，系统已按最明确的一列匹配；如结果异常请检查源文件表头。'
    }));
  }

  renderSampleTable(inspection);
  const canStart = !missing.size && (inspection.dataRowCount || 0) > 0;
  els.startButton.disabled = !canStart;
  if (!canStart) {
    els.detectSubtitle.textContent = missing.size
      ? '字段不完整，暂时无法开始对抵。'
      : '没有检测到数据行。';
  } else {
    els.detectSubtitle.textContent = `已检测到 ${fmtInt(inspection.dataRowCount)} 行数据；确认字段后开始对抵。`;
  }
}

function renderSampleTable(inspection) {
  clear(els.sampleTable);
  const headers = inspection.headers || [];
  const rows = inspection.sampleRows || [];
  if (!headers.length) {
    els.sampleTable.append(el('p', { class: 'empty-state', text: '暂无预览数据。' }));
    return;
  }
  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const header of headers) headRow.append(el('th', { text: header }));
  thead.append(headRow);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const header of headers) {
      const value = row[header];
      tr.append(el('td', { text: value === null || value === undefined ? '' : String(value) }));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  els.sampleTable.append(table);
  els.sampleMeta.textContent = `前 ${rows.length} 行 · 共 ${headers.length} 列`;
}

async function redetect() {
  if (!state.job) return;
  const sheetName = els.sheetSelect.value;
  const headerRow = Number(els.headerRowInput.value) || 1;
  if (!sheetName) return;
  els.redetectButton.disabled = true;
  showError(els.detectError, '');
  try {
    const payload = await api(`/${state.job.id}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetName, headerRow })
    });
    state.job = payload.job || state.job;
    renderInspection(payload.inspection);
    els.rulePanel.hidden = false;
  } catch (error) {
    showError(els.detectError, error.message);
    els.startButton.disabled = true;
  } finally {
    els.redetectButton.disabled = false;
  }
}

function scheduleRedetect() {
  clearTimeout(state.redetectTimer);
  state.redetectTimer = setTimeout(redetect, 450);
}

/* ------------------------------------------------------------------ start */

async function startReconciliation() {
  if (!state.job) return;
  els.startButton.disabled = true;
  showError(els.startError, '');
  const mapping = state.inspection?.mapping || {};
  try {
    const payload = await api(`/${state.job.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: els.sheetSelect.value,
        headerRow: Number(els.headerRowInput.value) || 1,
        matchFields: state.meta?.defaultMatchFields || [
          'supplier', 'purchase_order', 'purchase_order_item',
          'material_code', 'order_unit', 'unit_price', 'per'
        ],
        mapping
      })
    });
    state.job = payload.job;
    showProcess();
    pollJob();
  } catch (error) {
    if (error.payload?.inspection) renderInspection(error.payload.inspection);
    showError(els.startError, error.message);
    els.startButton.disabled = false;
  }
}

function showProcess() {
  els.processPanel.hidden = false;
  els.processError.hidden = true;
  els.processMessage.textContent = '任务已提交，正在排队…';
  setJobStatus(els.jobStatus, state.job?.status || 'queued');
  els.progressBar.style.width = '0%';
  els.progressValue.textContent = '0%';
  els.jobIdLabel.textContent = state.job?.id ? `任务 ${state.job.id.slice(0, 8)}` : '';
  els.processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pollJob() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const payload = await api(`/${state.job.id}`);
      const job = payload.job;
      state.job = job;
      updateProcess(job);
      if (job.status === 'completed') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        await loadResult(job);
        return;
      }
      if (job.status === 'failed') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        showError(els.processError, job.error || '对抵失败，请重新开始。');
        els.startButton.disabled = false;
      }
    } catch (error) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      showError(els.processError, error.message);
      els.startButton.disabled = false;
    }
  }, 1200);
}

function updateProcess(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  els.progressBar.style.width = `${progress}%`;
  els.progressValue.textContent = `${progress}%`;
  els.processMessage.textContent = job.progressMessage || '正在处理…';
  setJobStatus(els.jobStatus, job.status);
  if (job.status === 'completed') {
    els.processNote.textContent = '对抵完成；结果与下载已就绪。';
  }
}

async function loadResult(job) {
  try {
    const summary = await api(`/${job.id}/summary`);
    state.summary = summary;
    renderResult(job, summary);
    await loadHistory();
  } catch (error) {
    showError(els.processError, error.message);
  }
}

/* ----------------------------------------------------------------- result */

function metricValue(summary, key) {
  return summary?.metrics?.[key];
}

function renderResult(job, summary) {
  state.job = job;
  state.summary = summary;
  els.resultPanel.hidden = false;
  els.resultSubtitle.textContent = `${summary.source?.filename || job.originalFilename} · ${summary.source?.sheetName || job.sheetName || ''} · ${fmtInt(metricValue(summary, 'original_record_count'))} 条原始记录`;
  renderMetrics(summary);
  renderConservation(summary);
  renderBars(summary);
  renderMovementTable(summary);
  renderOverviewNotes(summary);
  renderUnmatchedSummary(summary);
  renderDownloads(job);
  updateTabs();
  switchTab('overview');
  els.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  startXlsxPolling(job);
}

function renderMetrics(summary) {
  const metrics = summary.metrics || {};
  const cards = [
    ['原始记录数', 'original_record_count', fmtInt, ''],
    ['原始正向金额', 'original_positive_amount', fmtMoney, ''],
    ['原始负向金额', 'original_negative_amount_abs', fmtMoney, ''],
    ['成功对抵金额', 'matched_amount', fmtMoney, 'accent'],
    ['对抵配对段', 'match_segment_count', fmtInt, ''],
    ['参与对抵记录', 'matched_record_count', fmtInt, ''],
    ['对抵后剩余记录', 'remaining_record_count', fmtInt, ''],
    ['最终净金额', 'final_net_amount', fmtMoney, 'accent'],
    ['未匹配负向金额', 'unmatched_negative_amount_abs', fmtMoney, 'warn'],
    ['金额守恒差异', 'conservation_difference', fmtMoney, 'ok']
  ];
  clear(els.resultMetrics);
  for (const [label, key, formatter, tone] of cards) {
    const value = metrics[key];
    const card = el('div', { class: `metric ${tone}`.trim() }, [
      el('span', { text: label }),
      el('strong', { text: value === undefined ? '—' : formatter(value) }),
      el('small', { text: tone === 'ok' ? '应为 0.00' : '' })
    ]);
    els.resultMetrics.append(card);
  }
}

function renderConservation(summary) {
  const diff = Number(metricValue(summary, 'conservation_difference'));
  const ok = Number.isFinite(diff) && Math.abs(diff) < 0.005;
  els.conservationBanner.hidden = false;
  els.conservationBanner.className = `conservation ${ok ? 'ok' : 'warn'}`;
  clear(els.conservationBanner);
  els.conservationBanner.append(el('b', { text: ok ? '金额守恒校验通过' : '金额守恒存在差异' }));
  els.conservationBanner.append(el('span', {
    text: ok
      ? `原始净金额与最终剩余净金额一致，差异 ${fmtMoney(diff)}。`
      : `差异 ${fmtMoney(diff)}，请检查导出明细与原始数据；如非精度原因，请勿直接使用该结果。`
  }));
}

function renderBars(summary) {
  const values = [
    ['原始正向金额', Number(metricValue(summary, 'original_positive_amount')), ''],
    ['原始负向金额', Number(metricValue(summary, 'original_negative_amount_abs')), 'negative'],
    ['成功对抵金额', Number(metricValue(summary, 'matched_amount')), 'matched'],
    ['未匹配负向金额', Number(metricValue(summary, 'unmatched_negative_amount_abs')), 'negative'],
    ['最终净金额', Number(metricValue(summary, 'final_net_amount')), 'neutral']
  ];
  const max = Math.max(...values.map((item) => Math.abs(item[1]) || 0), 1);
  clear(els.amountBars);
  for (const [label, value, tone] of values) {
    const width = Math.max(1.5, (Math.abs(value) / max) * 100);
    els.amountBars.append(el('div', { class: 'bar-row' }, [
      el('div', { class: 'bar-head' }, [
        el('span', { text: label }),
        el('strong', { text: fmtMoney(value) })
      ]),
      el('div', { class: 'bar-track' }, [
        el('span', { class: `bar-fill ${tone}`.trim(), style: `width:${width}%` })
      ])
    ]));
  }
}

function renderMovementTable(summary) {
  clear(els.movementTable);
  const rows = summary.movement_summary || [];
  if (!rows.length) {
    els.movementTable.append(el('p', { class: 'empty-state', text: '暂无移动类型数据。' }));
    return;
  }
  const columns = [
    ['移动类型', 'movement_type', 'text'],
    ['记录数', 'record_count', 'int'],
    ['原始数量', 'original_quantity', 'qty'],
    ['原始金额', 'original_amount', 'money'],
    ['已对抵数量', 'matched_quantity', 'qty'],
    ['剩余数量', 'remaining_quantity', 'qty'],
    ['剩余金额', 'remaining_amount', 'money']
  ];
  const table = el('table');
  const head = el('tr');
  for (const [label] of columns) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const [, key, type] of columns) {
      const value = row[key];
      const formatter = type === 'money' ? fmtMoney : type === 'qty' ? fmtQty : type === 'int' ? fmtInt : (item) => item ?? '—';
      tr.append(el('td', { class: type === 'text' ? '' : 'cell-num', text: formatter(value) }));
    }
    body.append(tr);
  }
  table.append(body);
  els.movementTable.append(table);
}

function renderUnmatchedSummary(summary) {
  if (!els.unmatchedSummary) return;
  const quantity = summary?.metrics?.unmatched_negative_quantity_abs;
  const amount = summary?.metrics?.unmatched_negative_amount_abs;
  els.unmatchedSummary.textContent = `未匹配负向数量 ${fmtQty(quantity)}，未匹配负向金额 ${fmtMoney(amount)}。这些记录在业务键内没有足够的正向数量可对抵，需要业务人工核查；不一定是程序错误。`;
}

function renderOverviewNotes(summary) {
  const metrics = summary.metrics || {};
  clear(els.overviewNotes);
  const notes = [
    `正向 ${fmtInt(metrics.positive_record_count)} 条 / 负向 ${fmtInt(metrics.negative_record_count)} 条 / 零数量 ${fmtInt(metrics.zero_quantity_record_count)} 条，共 ${fmtInt(metrics.business_key_count)} 个业务键。`,
    `完全对抵 ${fmtInt(metrics.fully_matched_record_count)} 条；剩余记录 ${fmtInt(metrics.remaining_record_count)} 条。`,
    `本次处理耗时 ${summary.durationSeconds ?? '—'} 秒；CSV 可立即下载，XLSX 在后台生成。`
  ];
  for (const text of notes) els.overviewNotes.append(el('div', { class: 'overview-note', text }));
}

function renderDownloads(job) {
  const csvUrl = `${API}/${job.id}/download?format=zip`;
  const xlsxUrl = `${API}/${job.id}/download?format=xlsx`;
  els.csvButton.hidden = false;
  els.csvButton.href = csvUrl;
  els.xlsxButton.hidden = false;
  els.primaryDownloadButton.hidden = false;
  setXlsxButton(job);
  const xlsxReady = job.xlsxStatus === 'ready';
  els.primaryDownloadButton.href = xlsxReady ? xlsxUrl : csvUrl;
  els.primaryDownloadButton.innerHTML = xlsxReady ? '下载 XLSX <span>↓</span>' : '下载 CSV ZIP <span>↓</span>';
}

function setXlsxButton(job) {
  const status = job.xlsxStatus;
  const primary = els.primaryDownloadButton;
  if (status === 'ready') {
    const url = `${API}/${job.id}/download?format=xlsx`;
    els.xlsxButton.href = url;
    els.xlsxButton.removeAttribute('aria-disabled');
    els.xlsxButton.textContent = '下载 XLSX';
    els.xlsxButton.style.pointerEvents = '';
    els.xlsxButton.style.opacity = '';
    primary.href = url;
    primary.innerHTML = '下载 XLSX <span>↓</span>';
    return;
  }
  const csvUrl = `${API}/${job.id}/download?format=zip`;
  els.xlsxButton.removeAttribute('href');
  els.xlsxButton.setAttribute('aria-disabled', 'true');
  els.xlsxButton.textContent = status === 'error' ? 'XLSX 生成失败' : 'XLSX 生成中';
  els.xlsxButton.style.pointerEvents = 'none';
  els.xlsxButton.style.opacity = '.5';
  primary.href = csvUrl;
  primary.innerHTML = '下载 CSV ZIP <span>↓</span>';
}

function startXlsxPolling(job) {
  clearInterval(state.xlsxTimer);
  state.xlsxTimer = null;
  if (job.xlsxStatus === 'ready' || job.xlsxStatus === 'error') {
    setXlsxButton(job);
    return;
  }
  state.xlsxTimer = setInterval(async () => {
    try {
      const payload = await api(`/${state.job.id}`);
      state.job = payload.job;
      setXlsxButton(payload.job);
      if (payload.job.xlsxStatus === 'ready' || payload.job.xlsxStatus === 'error') {
        clearInterval(state.xlsxTimer);
        state.xlsxTimer = null;
      }
    } catch (_) {
      clearInterval(state.xlsxTimer);
      state.xlsxTimer = null;
    }
  }, 2500);
}

/* ------------------------------------------------------------------- tabs */

function updateTabs() {
  $$('.result-tab').forEach((tab) => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $$('.sub-tab').forEach((tab) => {
    const active = tab.dataset.subtab === state.subTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

function switchTab(tab) {
  state.tab = tab;
  updateTabs();
  els.overviewPanel.hidden = tab !== 'overview';
  els.matchedPanel.hidden = tab !== 'matched';
  els.remainingPanel.hidden = tab !== 'remaining';
  els.unmatchedPanel.hidden = tab !== 'unmatched';
  if (tab === 'matched') loadMatched();
  if (tab === 'remaining') loadRemaining();
  if (tab === 'unmatched') loadUnmatched();
}

function switchSubTab(subTab) {
  state.subTab = subTab;
  state.matched.page = 1;
  if (subTab === 'segments') {
    state.matched.sort = 'matchId';
    fillSort(els.matchedSort, SORT_OPTIONS.segments, state.matched.sort);
  } else {
    state.matched.sort = 'sourceRow';
    fillSort(els.matchedSort, SORT_OPTIONS.records, state.matched.sort);
  }
  updateTabs();
  loadMatched();
}

/* --------------------------------------------------------------- table load */

async function loadMatched() {
  if (!state.job || state.job.status !== 'completed') return;
  const query = new URLSearchParams({
    page: String(state.matched.page),
    pageSize: String(state.pageSize),
    search: state.matched.search,
    sort: state.matched.sort
  });
  if (state.matched.direction) query.set('direction', state.matched.direction);
  try {
    if (state.subTab === 'segments') {
      const payload = await api(`/${state.job.id}/matches?${query}`);
      renderSegmentTable(payload.rows);
      renderPager(els.matchedPager, payload, (page) => {
        state.matched.page = page;
        loadMatched();
      });
    } else {
      const payload = await api(`/${state.job.id}/matched?${query}`);
      renderRecordTable(payload.rows, 'matched');
      renderPager(els.matchedPager, payload, (page) => {
        state.matched.page = page;
        loadMatched();
      });
    }
  } catch (error) {
    renderTableError(els.matchedTable, error.message);
    clear(els.matchedPager);
  }
}

async function loadRemaining() {
  if (!state.job || state.job.status !== 'completed') return;
  const query = new URLSearchParams({
    page: String(state.remaining.page),
    pageSize: String(state.pageSize),
    search: state.remaining.search,
    sort: state.remaining.sort
  });
  if (state.remaining.direction) query.set('direction', state.remaining.direction);
  try {
    const payload = await api(`/${state.job.id}/remaining?${query}`);
    renderRecordTable(payload.rows, 'remaining');
    renderPager(els.remainingPager, payload, (page) => {
      state.remaining.page = page;
      loadRemaining();
    });
  } catch (error) {
    renderTableError(els.remainingTable, error.message);
    clear(els.remainingPager);
  }
}

async function loadUnmatched() {
  if (!state.job || state.job.status !== 'completed') return;
  const query = new URLSearchParams({
    page: String(state.unmatched.page),
    pageSize: String(state.pageSize),
    search: state.unmatched.search,
    sort: state.unmatched.sort,
    unmatched: '1'
  });
  try {
    const payload = await api(`/${state.job.id}/remaining?${query}`);
    renderRecordTable(payload.rows, 'unmatched');
    renderPager(els.unmatchedPager, payload, (page) => {
      state.unmatched.page = page;
      loadUnmatched();
    });
  } catch (error) {
    renderTableError(els.unmatchedTable, error.message);
    clear(els.unmatchedPager);
  }
}

function fillSort(select, options, selected) {
  clear(select);
  for (const [value, label] of options) {
    const option = el('option', { value, text: label });
    if (value === selected) option.selected = true;
    select.append(option);
  }
}

function renderPager(node, payload, onPage) {
  clear(node);
  const total = payload.total || 0;
  const page = payload.page || 1;
  const pageCount = payload.pageCount || 1;
  node.append(el('span', {
    text: total ? `第 ${page} / ${pageCount} 页 · 共 ${fmtInt(total)} 条` : '没有匹配的记录'
  }));
  const actions = el('div', { class: 'pager-actions' });
  const prev = el('button', { type: 'button', text: '上一页' });
  const next = el('button', { type: 'button', text: '下一页' });
  prev.disabled = page <= 1;
  next.disabled = page >= pageCount;
  prev.addEventListener('click', () => onPage(page - 1));
  next.addEventListener('click', () => onPage(page + 1));
  actions.append(prev, next);
  node.append(actions);
}

function renderTableError(node, message) {
  clear(node);
  node.append(el('p', { class: 'empty-state', text: message }));
}

function originalHeaders() {
  return state.summary?.source?.headers || state.inspection?.headers || [];
}

function renderSegmentTable(rows) {
  clear(els.matchedTable);
  const headers = [
    '匹配ID', '业务键', '正向行号', '负向行号', '正向移动', '负向移动',
    '正向日期', '负向日期', '对抵数量', '对抵金额', '负向金额绝对值'
  ];
  const table = el('table');
  const head = el('tr');
  for (const label of headers) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  if (!rows.length) {
    body.append(el('tr', {}, [el('td', { colspan: String(headers.length), class: 'empty-state', text: '暂无配对段。' })]));
  }
  for (const row of rows) {
    const tr = el('tr', { class: 'clickable' });
    const cells = [
      ['cell-match', row.matchId],
      ['cell-muted', row.businessKey],
      ['cell-num', row.positiveSourceRow],
      ['cell-num', row.negativeSourceRow],
      ['', row.positiveMovementType],
      ['', row.negativeMovementType],
      ['cell-nowrap', row.positiveDate || '—'],
      ['cell-nowrap', row.negativeDate || '—'],
      ['cell-num', fmtQty(row.matchedQuantity)],
      ['cell-num', fmtMoney(row.matchedAmount)],
      ['cell-num', fmtMoney(row.negativeAmountAbs)]
    ];
    for (const [className, value] of cells) tr.append(el('td', { class: className, text: value }));
    tr.addEventListener('click', () => openSegmentDetail(row.matchId));
    body.append(tr);
  }
  table.append(body);
  els.matchedTable.append(table);
}

function renderRecordTable(rows, mode) {
  const node = mode === 'matched' ? els.matchedTable : mode === 'remaining' ? els.remainingTable : els.unmatchedTable;
  clear(node);
  const headers = originalHeaders();
  const audit = mode === 'matched'
    ? ['原始行号', '方向', '已对抵数量', '已对抵金额', '匹配ID']
    : ['原始行号', '方向', '原始数量', '已对抵数量', '剩余数量', '原始金额', '剩余金额', '匹配ID'];
  const table = el('table');
  table.style.minWidth = `${Math.max(900, (headers.length + audit.length) * 96)}px`;
  const head = el('tr');
  for (const label of [...audit, ...headers]) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  if (!rows.length) {
    body.append(el('tr', {}, [el('td', {
      colspan: String(audit.length + headers.length),
      class: 'empty-state',
      text: '暂无记录。'
    })]));
  }
  for (const row of rows) {
    const tr = el('tr', { class: 'clickable' });
    if (mode === 'matched') {
      tr.append(
        el('td', { class: 'cell-num', text: row.sourceRow }),
        el('td', {}, [badge(row.direction, row.direction === '正向' ? 'green' : 'amber')]),
        el('td', { class: 'cell-num', text: fmtQty(row.matchedQuantity) }),
        el('td', { class: 'cell-num', text: fmtMoney(row.matchedAmount) }),
        el('td', { class: 'cell-match', text: (row.matchIds || []).join('、') })
      );
    } else {
      tr.append(
        el('td', { class: 'cell-num', text: row.sourceRow }),
        el('td', {}, [badge(row.direction, row.direction === '正向' ? 'green' : 'amber')]),
        el('td', { class: 'cell-num', text: fmtQty(row.originalQuantity) }),
        el('td', { class: 'cell-num', text: fmtQty(row.matchedQuantity) }),
        el('td', { class: 'cell-num', text: fmtQty(row.remainingQuantity) }),
        el('td', { class: 'cell-num', text: fmtMoney(row.originalAmount) }),
        el('td', { class: 'cell-num cell-strong', text: fmtMoney(row.remainingAmount) }),
        el('td', { class: 'cell-match', text: (row.matchIds || []).join('、') || '—' })
      );
    }
    for (const header of headers) {
      const value = row.raw?.[header];
      tr.append(el('td', { text: value === null || value === undefined ? '' : String(value) }));
    }
    tr.addEventListener('click', () => openRecordDetail(row, mode));
    body.append(tr);
  }
  table.append(body);
  node.append(table);
}

/* ----------------------------------------------------------------- drawer */

function openDrawer(title, subtitle) {
  els.detailTitle.textContent = title;
  els.detailSubtitle.textContent = subtitle || '';
  clear(els.detailBody);
  els.detailDrawer.hidden = false;
  els.detailBackdrop.hidden = false;
  document.body.classList.add('drawer-open');
  els.closeDetailButton.focus();
}

function closeDrawer() {
  els.detailDrawer.hidden = true;
  els.detailBackdrop.hidden = true;
  document.body.classList.remove('drawer-open');
}

function kvSection(title, pairs) {
  const grid = el('div', { class: 'detail-kv' });
  for (const [label, value] of pairs) {
    grid.append(el('div', {}, [
      el('span', { text: label }),
      el('strong', { text: value === null || value === undefined || value === '' ? '—' : String(value) })
    ]));
  }
  return section(title, grid);
}

function section(title, content) {
  return el('div', { class: 'detail-section' }, [
    el('h3', { text: title }),
    el('div', { class: 'detail-section-body' }, [content])
  ]);
}

function rawTable(row) {
  const headers = originalHeaders();
  const table = el('table', { class: 'detail-table' });
  const body = el('tbody');
  for (const header of headers) {
    const value = row.raw?.[header];
    body.append(el('tr', {}, [
      el('th', { text: header }),
      el('td', { text: value === null || value === undefined ? '' : String(value) })
    ]));
  }
  table.append(body);
  return table;
}

function matchLinks(matchIds) {
  if (!Array.isArray(matchIds) || !matchIds.length) {
    return el('p', { class: 'detail-empty', text: '没有参与对抵。' });
  }
  const wrap = el('div');
  for (const id of matchIds) {
    const button = el('button', { type: 'button', class: 'match-link', text: id });
    button.addEventListener('click', () => openSegmentDetail(id));
    wrap.append(button);
  }
  return wrap;
}

function openRecordDetail(row, mode) {
  openDrawer(`原始行 ${row.sourceRow}`, row.businessKey || '');
  const pairs = [
    ['原始行号', row.sourceRow],
    ['方向', row.direction],
    ['原始数量', fmtQty(row.originalQuantity)],
    ['已对抵数量', fmtQty(row.matchedQuantity)],
    ['原始金额', fmtMoney(row.originalAmount)]
  ];
  if (mode === 'matched') {
    pairs.push(['已对抵金额', fmtMoney(row.matchedAmount)]);
  } else {
    pairs.push(['剩余数量', fmtQty(row.remainingQuantity)], ['剩余金额', fmtMoney(row.remainingAmount)]);
  }
  els.detailBody.append(
    kvSection('记录摘要', pairs),
    section('参与过的匹配', matchLinks(row.matchIds)),
    section('原始字段', rawTable(row))
  );
}

async function openSegmentDetail(matchId) {
  openDrawer(`匹配 ${matchId}`, '正在读取配对详情…');
  try {
    const payload = await api(`/${state.job.id}/matches/${encodeURIComponent(matchId)}`);
    const segment = payload.segment;
    els.detailSubtitle.textContent = segment.businessKey || '';
    clear(els.detailBody);
    els.detailBody.append(kvSection('配对摘要', [
      ['匹配ID', segment.matchId],
      ['对抵数量', fmtQty(segment.matchedQuantity)],
      ['对抵金额', fmtMoney(segment.matchedAmount)],
      ['负向对应金额绝对值', fmtMoney(segment.negativeAmountAbs)],
      ['正向数量', fmtQty(segment.positiveQuantity)],
      ['负向数量', fmtQty(segment.negativeQuantity)]
    ]));
    if (payload.positiveRecord) {
      els.detailBody.append(section(
        `正向原始记录 · 行 ${payload.positiveRecord.sourceRow} · ${payload.positiveRecord.raw?.['移动类型'] || ''}`,
        rawTable(payload.positiveRecord)
      ));
    }
    if (payload.negativeRecord) {
      els.detailBody.append(section(
        `负向原始记录 · 行 ${payload.negativeRecord.sourceRow} · ${payload.negativeRecord.raw?.['移动类型'] || ''}`,
        rawTable(payload.negativeRecord)
      ));
    }
  } catch (error) {
    clear(els.detailBody);
    els.detailBody.append(el('div', { class: 'error-box', text: error.message }));
  }
}

/* ----------------------------------------------------------------- history */

async function loadHistory() {
  try {
    const payload = await api('');
    clear(els.historyList);
    if (!payload.jobs?.length) {
      els.historyList.append(el('p', { class: 'empty-note', text: '还没有对抵任务。' }));
      return;
    }
    for (const job of payload.jobs) {
      const metrics = job.summary?.metrics || {};
      const row = el('div', { class: 'history-row' }, [
        el('div', { class: 'history-main' }, [
          el('strong', { text: job.originalFilename || '未命名文件' }),
          el('small', {
            text: `${fmtTime(job.createdAt)} · ${statusLabel(job.status)}${metrics.match_segment_count !== undefined ? ` · ${fmtInt(metrics.match_segment_count)} 个配对段 · ${fmtInt(metrics.remaining_record_count)} 条剩余` : ''}`
          })
        ]),
        el('div', {}, [badge(statusLabel(job.status), statusTone(job.status))]),
        el('div', { class: 'history-actions' })
      ]);
      const actions = row.querySelector('.history-actions');
      if (job.status === 'completed') {
        const open = el('button', { type: 'button', text: '打开' });
        open.addEventListener('click', () => openHistoryJob(job));
        actions.append(open);
      }
      if (!['queued', 'running'].includes(job.status)) {
        const remove = el('button', { type: 'button', text: '删除', class: 'danger' });
        remove.addEventListener('click', () => deleteJob(job));
        actions.append(remove);
      }
      els.historyList.append(row);
    }
  } catch (error) {
    clear(els.historyList);
    els.historyList.append(el('p', { class: 'empty-note', text: `历史任务加载失败：${error.message}` }));
  }
}

async function openHistoryJob(job) {
  stopTimers();
  state.job = job;
  state.inspection = null;
  state.summary = null;
  els.uploadPanel.hidden = true;
  els.detectPanel.hidden = true;
  els.rulePanel.hidden = true;
  showProcess();
  updateProcess(job);
  await loadResult(job);
}

async function deleteJob(job) {
  if (!window.confirm(`删除任务「${job.originalFilename}」及其结果文件？`)) return;
  try {
    await api(`/${job.id}`, { method: 'DELETE' });
    toast('任务已删除。');
    if (state.job?.id === job.id) resetWorkspace();
    await loadHistory();
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------------- reset */

function resetWorkspace() {
  stopTimers();
  closeDrawer();
  state.file = null;
  state.job = null;
  state.inspection = null;
  state.summary = null;
  state.tab = 'overview';
  state.subTab = 'segments';
  state.matched = { page: 1, search: '', sort: 'matchId', direction: '' };
  state.remaining = { page: 1, search: '', sort: 'sourceRow', direction: '' };
  state.unmatched = { page: 1, search: '', sort: 'sourceRow' };
  els.fileInput.value = '';
  els.selectedFile.hidden = true;
  els.uploadButton.disabled = true;
  els.uploadProgress.hidden = true;
  els.detectPanel.hidden = true;
  els.rulePanel.hidden = true;
  els.processPanel.hidden = true;
  els.resultPanel.hidden = true;
  els.uploadPanel.hidden = false;
  els.matchedSort.innerHTML = '';
  els.remainingSort.innerHTML = '';
  els.unmatchedSort.innerHTML = '';
  els.matchedSearch.value = '';
  els.remainingSearch.value = '';
  els.unmatchedSearch.value = '';
  els.remainingDirection.value = '';
  showError(els.uploadError, '');
  showError(els.detectError, '');
  showError(els.startError, '');
  showError(els.processError, '');
  els.uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -------------------------------------------------------------------- init */

function renderRuleChips() {
  const fields = state.meta?.matchFieldOptions || [];
  clear(els.ruleMatchFields);
  for (const field of fields) {
    els.ruleMatchFields.append(el('span', { class: 'rule-chip' }, [
      el('i', { text: '✓' }),
      field.label
    ]));
  }
}

function debounce(fn, delay = 350) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function wireEvents() {
  els.fileInput.addEventListener('change', () => setFile(els.fileInput.files?.[0]));
  els.clearFileButton.addEventListener('click', clearFile);
  els.uploadButton.addEventListener('click', uploadFile);

  ['dragenter', 'dragover'].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragover');
    });
  });
  els.dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer?.files?.[0]));

  els.sheetSelect.addEventListener('change', redetect);
  els.headerRowInput.addEventListener('change', redetect);
  els.headerRowInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      redetect();
    }
  });
  els.redetectButton.addEventListener('click', redetect);
  els.startButton.addEventListener('click', startReconciliation);

  $$('.result-tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
  $$('.sub-tab').forEach((tab) => tab.addEventListener('click', () => switchSubTab(tab.dataset.subtab)));

  els.matchedSearch.addEventListener('input', debounce(() => {
    state.matched.search = els.matchedSearch.value.trim();
    state.matched.page = 1;
    loadMatched();
  }));
  els.matchedSort.addEventListener('change', () => {
    state.matched.sort = els.matchedSort.value;
    state.matched.page = 1;
    loadMatched();
  });
  els.pageSizeSelect.addEventListener('change', () => {
    state.pageSize = Number(els.pageSizeSelect.value) || 50;
    els.remainingPageSize.value = String(state.pageSize);
    state.matched.page = 1;
    state.remaining.page = 1;
    state.unmatched.page = 1;
    if (state.tab === 'matched') loadMatched();
    if (state.tab === 'remaining') loadRemaining();
    if (state.tab === 'unmatched') loadUnmatched();
  });

  els.remainingSearch.addEventListener('input', debounce(() => {
    state.remaining.search = els.remainingSearch.value.trim();
    state.remaining.page = 1;
    loadRemaining();
  }));
  els.remainingDirection.addEventListener('change', () => {
    state.remaining.direction = els.remainingDirection.value;
    state.remaining.page = 1;
    loadRemaining();
  });
  els.remainingSort.addEventListener('change', () => {
    state.remaining.sort = els.remainingSort.value;
    state.remaining.page = 1;
    loadRemaining();
  });
  els.remainingPageSize.addEventListener('change', () => {
    state.pageSize = Number(els.remainingPageSize.value) || 50;
    els.pageSizeSelect.value = String(state.pageSize);
    state.remaining.page = 1;
    loadRemaining();
  });

  els.unmatchedSearch.addEventListener('input', debounce(() => {
    state.unmatched.search = els.unmatchedSearch.value.trim();
    state.unmatched.page = 1;
    loadUnmatched();
  }));
  els.unmatchedSort.addEventListener('change', () => {
    state.unmatched.sort = els.unmatchedSort.value;
    state.unmatched.page = 1;
    loadUnmatched();
  });

  els.refreshResultButton.addEventListener('click', async () => {
    if (!state.job) return;
    try {
      const payload = await api(`/${state.job.id}`);
      state.job = payload.job;
      if (payload.job.status === 'completed') await loadResult(payload.job);
      toast('已刷新。');
    } catch (error) {
      toast(error.message);
    }
  });

  els.newJobButton.addEventListener('click', resetWorkspace);
  els.refreshHistoryButton.addEventListener('click', loadHistory);
  els.closeDetailButton.addEventListener('click', closeDrawer);
  els.detailBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });
}

async function init() {
  wireEvents();
  fillSort(els.matchedSort, SORT_OPTIONS.segments, state.matched.sort);
  fillSort(els.remainingSort, SORT_OPTIONS.remaining, state.remaining.sort);
  fillSort(els.unmatchedSort, SORT_OPTIONS.remaining, state.unmatched.sort);
  try {
    state.meta = await api('/meta');
    renderRuleChips();
  } catch (error) {
    toast(error.message);
  }
  await loadHistory();
}

init();

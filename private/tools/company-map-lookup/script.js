'use strict';

(() => {
  const API_BASE = '/api/company-map-lookup';
  const CURRENT_VERSION = 'v1.1.0';
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const RESULT_LIMIT = 50;
  const STATUS_LABELS = {
    queued: '排队中',
    searching: '查询中',
    matched: '已匹配',
    review: '待确认',
    not_found: '未找到',
    error: '失败',
    cancelled: '已取消'
  };
  const JOB_STATUS_LABELS = {
    queued: '排队中',
    running: '查询中',
    completed: '已完成',
    cancelled: '已取消'
  };
  const FILTER_LABELS = {
    all: '全部',
    matched: '已匹配',
    review: '待确认',
    not_found: '未找到',
    error: '失败',
    cancelled: '已取消'
  };
  const VERSION_NOTES = [{
    version: 'v1.1.0',
    date: '2026-10-28',
    current: true,
    notes: [
      '新增标准 Excel 模板下载（公司名单 + 填写说明），模板只保留表头，避免误带示例数据。',
      '支持在网页临时填写自己的高德 Web 服务 Key / 百度地图 AK，并可先「验证 API」；Key 不写入浏览器存储、数据库、Job、日志或导出文件。',
      '用户 Key 优先于服务端 AMAP_WEB_SERVICE_KEY / BAIDU_MAP_AK；留空时回退到服务端配置。',
      '新增地图服务商选择与数据预览（总数 / 有效 / 无效 / 重复）；重复公司合并为一次查询，导出时仍逐行对应原始记录。'
    ]
  }, {
    version: 'v1.0.0',
    date: '2026-10-26',
    current: false,
    notes: [
      '首版：批量粘贴、XLSX/CSV 导入、列映射与文件预览；原始文件只在浏览器内读取，不上传、不覆盖。',
      '高德 V5 / 百度 Place V3 Provider 抽象；统一输出 GCJ-02，百度显式请求 gcj02ll。',
      '异步 Job、统一进度轮询、取消、review 候选人工确认，以及 XLSX / CSV 结果导出。',
      'owner scope 复用登录 Session；Job 为进程内内存存储，Node/PM2 重启后未完成任务和结果不保留。'
    ]
  }];

  const PROVIDER_INFO = {
    amap: { label: '高德地图', keyLabel: '高德 Web 服务 Key', placeholder: '粘贴高德 Web 服务 Key' },
    baidu: { label: '百度地图', keyLabel: '百度地图 AK', placeholder: '粘贴百度地图 AK' }
  };

  const KEY_STATUS_TEXT = {
    MAP_API_KEY_REQUIRED: '请输入地图 API Key 后再开始查询。',
    MAP_API_KEY_INVALID: 'API Key 无效或当前账号无法使用地点搜索服务，请检查后重试。',
    MAP_API_QUOTA_EXCEEDED: '地图 API 配额或调用频率已达上限，请稍后重试。',
    MAP_API_FORBIDDEN: '当前 API Key 无权使用地点搜索服务，请检查服务与白名单配置。',
    MAP_API_TIMEOUT: '地图服务请求超时，请稍后重试。'
  };

  class ApiError extends Error {
    constructor(message, { code = 'API_ERROR', status = 0, details } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  const state = {
    meta: null,
    maxBatch: 500,
    providerReady: false,
    providerMode: 'auto',
    provider: 'amap',
    keyVerified: false,
    pastedItems: [],
    importedItems: [],
    items: [],
    file: null,
    workbook: null,
    sheetNames: [],
    sheetName: '',
    matrix: [],
    headerRow: 1,
    headers: [],
    dataRows: [],
    mapping: { company: -1, region: -1 },
    importSeq: 0,
    primaryOf: new Map(),
    dedupeGroups: new Map(),
    jobId: null,
    job: null,
    results: [],
    offset: 0,
    limit: RESULT_LIMIT,
    total: 0,
    filter: 'all',
    q: '',
    pollTimer: null,
    pollFailures: 0,
    lastProcessed: -1,
    loadingResults: false,
    reviewItem: null,
    selectedCandidate: -1,
    busy: false,
    lastFocus: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {};

  function cacheElements() {
    const ids = [
      'versionButton', 'newJobButton', 'providerStrip', 'providerStatus', 'persistenceNote',
      'apiPanel', 'providerSelect', 'providerKey', 'toggleKeyButton', 'validateKeyButton',
      'keyStatus', 'keyFieldLabel', 'keyModeChip', 'keyError', 'downloadTemplateButton',
      'inputPanel', 'inputCountChip', 'companyText', 'clearTextButton', 'defaultRegion',
      'strictRegion', 'dropZone', 'fileInput', 'selectedFile', 'fileName', 'fileMeta',
      'resetFileButton', 'mappingPanel', 'mappingMeta', 'sheetSelect', 'headerRowInput',
      'companyColumn', 'regionColumn', 'mappedCount', 'previewSummary', 'previewTotal',
      'previewValid', 'previewInvalid', 'previewDuplicate', 'filePreview', 'importFileButton',
      'fileError', 'inputError', 'inputSummary', 'itemCount', 'regionCount', 'duplicateCount',
      'startButton',
      'progressPanel', 'progressMessage', 'jobStatus', 'progressBar', 'progressValue',
      'jobIdLabel', 'progressMetrics', 'cancelButton', 'progressError', 'resultPanel',
      'resultSubtitle', 'refreshResultsButton', 'exportCsvButton', 'exportXlsxButton',
      'resultMetrics', 'filterTabs', 'resultSearch', 'tableMeta', 'resultBody', 'pagerText',
      'prevPage', 'nextPage', 'candidateBackdrop', 'candidateDrawer', 'candidateTitle',
      'candidateSubtitle', 'closeCandidateButton', 'candidateBody', 'confirmCandidateButton',
      'versionBackdrop', 'versionDialog', 'closeVersionButton', 'versionList', 'footerVersionButton', 'toast'
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
  }

  async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(API_BASE + path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });

    let payload = null;
    try { payload = await response.json(); } catch (_) { /* normalized below */ }

    if (response.status === 401) {
      window.location.replace('/login');
      throw new ApiError('登录已过期。', { code: 'UNAUTHORIZED', status: 401 });
    }

    if (!response.ok || !payload || payload.ok !== true) {
      const raw = payload && payload.error;
      const error = raw && typeof raw === 'object' ? raw : {};
      throw new ApiError(
        error.message || (typeof raw === 'string' ? raw : `请求失败（HTTP ${response.status}）`),
        { code: error.code || 'API_ERROR', status: response.status, details: error.details }
      );
    }
    return payload.data;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function clearError(element) {
    if (!element) return;
    element.textContent = '';
    element.hidden = true;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
  }

  function confidenceText(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    return `${Math.round(number * 100)}%`;
  }

  function coordinateText(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(6) : '—';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function statusClass(status) {
    return ['matched', 'review', 'not_found', 'error', 'cancelled', 'queued', 'searching'].includes(status)
      ? status
      : 'not_found';
  }

  function jobStatusClass(status) {
    if (status === 'running') return 'running';
    if (status === 'completed') return 'completed';
    if (status === 'cancelled') return 'cancelled';
    return 'queued';
  }

  function metricHtml(label, value, cls = '') {
    return `<div class="metric ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function countsOf(job) {
    return {
      matched: 0,
      review: 0,
      not_found: 0,
      error: 0,
      cancelled: 0,
      ...((job && job.counts) || {})
    };
  }

  function renderMetrics(job) {
    const counts = countsOf(job);
    const html = [
      metricHtml('总数', formatNumber(job?.total || 0)),
      metricHtml('已匹配', formatNumber(counts.matched), 'ok'),
      metricHtml('待确认', formatNumber(counts.review), 'warn'),
      metricHtml('未找到', formatNumber(counts.not_found)),
      metricHtml('失败', formatNumber(counts.error), 'bad'),
      metricHtml('已取消', formatNumber(counts.cancelled))
    ].join('');
    if (els.progressMetrics) els.progressMetrics.innerHTML = html;
    if (els.resultMetrics) els.resultMetrics.innerHTML = html;

    $$('[data-filter]', els.filterTabs).forEach((button) => {
      const key = button.dataset.filter;
      const count = key === 'all' ? (job?.total || 0) : (counts[key] || 0);
      button.textContent = `${FILTER_LABELS[key] || key} ${count}`;
    });
  }

  function renderProviderStrip() {
    if (!els.providerStrip) return;
    const meta = state.meta;
    const configured = Array.isArray(meta?.configuredProviders) ? meta.configuredProviders : [];
    state.providerReady = configured.length > 0;
    state.providerMode = meta?.providerMode || 'auto';
    els.providerStrip.classList.toggle('ok', state.providerReady);
    els.providerStrip.classList.toggle('warn', !state.providerReady);

    if (!meta) {
      els.providerStatus.textContent = '无法读取地图 Provider 状态；你仍可在步骤 01 填写自己的 API Key 后查询。';
      els.persistenceNote.textContent = '请确认服务端已启动并已登录。';
      return;
    }

    const batchNote = `最多 ${state.maxBatch} 家`;
    if (!state.providerReady) {
      els.providerStatus.textContent = '服务端未配置 fallback Key：请在步骤 01 填写自己的高德 / 百度 API Key。';
      els.persistenceNote.textContent = '浏览器不会直接请求地图 API，Key 只发送给 Liuxian Lab 后端。';
      return;
    }

    const providerNames = configured.map((name) => name === 'amap' ? '高德' : name === 'baidu' ? '百度' : name);
    const modeText = state.providerMode === 'amap'
      ? '高德 · 全国关键词搜索'
      : state.providerMode === 'baidu'
        ? '百度 · 需要城市/地区'
        : '自动 · 高德优先，百度需地区';
    els.providerStatus.textContent = `${modeText} · 服务端已配置 ${providerNames.join(' / ')} · ${batchNote} · 也支持页面临时 Key`;
    els.persistenceNote.textContent = meta.persistence === 'memory'
      ? '任务保存在当前 Node 进程内，服务重启后未完成任务会消失。'
      : `任务持久化：${meta.persistence || 'unknown'}。`;
  }

  function readProviderKey() {
    return els.providerKey ? String(els.providerKey.value || '').trim() : '';
  }

  function setKeyStatus(kind, text) {
    if (!els.keyStatus) return;
    els.keyStatus.className = `key-status ${kind}`;
    els.keyStatus.textContent = text;
  }

  function keyErrorMessage(error) {
    if (error && KEY_STATUS_TEXT[error.code]) return KEY_STATUS_TEXT[error.code];
    return (error && error.message) || '地图 API 请求失败。';
  }

  function updateProviderUi() {
    const provider = els.providerSelect && els.providerSelect.value === 'baidu' ? 'baidu' : 'amap';
    state.provider = provider;
    const info = PROVIDER_INFO[provider] || PROVIDER_INFO.amap;
    if (els.keyFieldLabel) els.keyFieldLabel.textContent = info.keyLabel;
    if (els.providerKey) els.providerKey.placeholder = `${info.placeholder}，仅本次查询使用`;
    if (els.keyModeChip) els.keyModeChip.textContent = `${info.label} · 临时 Key`;
    state.keyVerified = false;
    setKeyStatus('idle', '未验证');
    clearError(els.keyError);
    updateInputSummary();
  }

  function toggleKeyVisibility() {
    if (!els.providerKey) return;
    const show = els.providerKey.type === 'password';
    els.providerKey.type = show ? 'text' : 'password';
    if (els.toggleKeyButton) {
      els.toggleKeyButton.textContent = show ? '隐藏' : '显示';
      els.toggleKeyButton.setAttribute('aria-pressed', String(show));
    }
  }

  async function validateProviderKey() {
    if (!els.providerSelect) return;
    const provider = els.providerSelect.value === 'baidu' ? 'baidu' : 'amap';
    const apiKey = readProviderKey();
    clearError(els.keyError);
    setKeyStatus('checking', '验证中…');
    if (els.validateKeyButton) els.validateKeyButton.disabled = true;
    try {
      await api('/provider/validate', {
        method: 'POST',
        body: { provider, ...(apiKey ? { apiKey } : {}) }
      });
      state.keyVerified = true;
      setKeyStatus('ok', '✓ API 可用');
      showToast('地图 API 验证成功。');
    } catch (error) {
      state.keyVerified = false;
      if (error.status === 401) return;
      setKeyStatus('bad', '⚠ 验证失败');
      showError(els.keyError, keyErrorMessage(error));
    } finally {
      if (els.validateKeyButton) els.validateKeyButton.disabled = false;
    }
  }

  function downloadTemplate() {
    if (typeof XLSX === 'undefined' || !window.CompanyMapTemplate) {
      showToast('Excel 模板组件未加载，请刷新页面后重试。');
      return;
    }
    try {
      const workbook = window.CompanyMapTemplate.buildWorkbook(XLSX);
      XLSX.writeFile(workbook, window.CompanyMapTemplate.FILE_NAME, { compression: true });
      showToast('已下载 Excel 模板。');
    } catch (error) {
      showToast(`模板生成失败：${error.message}`);
    }
  }

  async function loadMeta() {
    try {
      const meta = await api('/meta');
      state.meta = meta;
      state.maxBatch = Math.min(500, Math.max(1, Number(meta.maxBatchSize) || 500));
      if (els.providerSelect) {
        els.providerSelect.value = meta.defaultProvider === 'baidu' ? 'baidu' : 'amap';
      }
      updateProviderUi();
      renderProviderStrip();
    } catch (error) {
      if (error.status === 401) return;
      state.meta = null;
      state.providerReady = false;
      renderProviderStrip();
      showToast(`地图能力读取失败：${error.message}`);
    }
    updateInputSummary();
  }

  function parsePastedItems() {
    const text = els.companyText.value;
    const defaultRegion = els.defaultRegion.value.trim().slice(0, 64);
    const strict = els.strictRegion.checked;
    const items = [];
    const errors = [];

    text.split(/\r?\n/).forEach((line, index) => {
      const raw = line.trim();
      if (!raw) return;
      let company = raw;
      let region = '';
      const separator = raw.includes('\t') ? '\t' : raw.includes('|') ? '|' : '';
      if (separator) {
        const parts = raw.split(separator);
        company = (parts.shift() || '').trim();
        region = parts.join(' ').trim();
      }
      if (!company) return;
      if (company.length > 200) {
        errors.push(`第 ${index + 1} 行公司名称超过 200 字符，未加入。`);
        return;
      }
      if (region.length > 64) {
        errors.push(`第 ${index + 1} 行地区超过 64 字符，未加入。`);
        return;
      }
      items.push({
        clientId: `paste-${index + 1}`,
        companyName: company,
        region: region || defaultRegion,
        strictRegion: strict
      });
    });

    state.pastedItems = items;
    if (errors.length) showError(els.inputError, errors.slice(0, 4).join('\n'));
    else clearError(els.inputError);
  }

  function normalizeDuplicateKey(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '').toLowerCase();
  }

  function countDuplicateItems(items) {
    const seen = new Set();
    let duplicates = 0;
    items.forEach((item) => {
      const key = `${normalizeDuplicateKey(item.companyName)}|${normalizeDuplicateKey(item.region)}`;
      if (seen.has(key)) duplicates += 1;
      else seen.add(key);
    });
    return duplicates;
  }

  function planDedupe(items) {
    const primaryByKey = new Map();
    const primaryOf = new Map();
    const groups = new Map();
    const uniqueItems = [];

    items.forEach((item) => {
      const key = `${normalizeDuplicateKey(item.companyName)}|${normalizeDuplicateKey(item.region)}`;
      const existingPrimary = primaryByKey.get(key);
      if (!existingPrimary) {
        primaryByKey.set(key, item.clientId);
        primaryOf.set(item.clientId, item.clientId);
        groups.set(item.clientId, [item]);
        uniqueItems.push(item);
        return;
      }
      primaryOf.set(item.clientId, existingPrimary);
      groups.get(existingPrimary).push(item);
    });

    return { uniqueItems, primaryOf, groups };
  }

  function updateInputSummary() {
    parsePastedItems();
    state.items = [...state.pastedItems, ...state.importedItems];
    const total = state.items.length;
    const regionCount = state.items.filter((item) => item.region).length;
    const duplicateCount = countDuplicateItems(state.items);
    if (els.inputCountChip) els.inputCountChip.textContent = `${total} 家`;
    if (els.itemCount) els.itemCount.textContent = String(total);
    if (els.regionCount) els.regionCount.textContent = String(regionCount);
    if (els.duplicateCount) els.duplicateCount.textContent = String(duplicateCount);
    if (els.inputSummary) els.inputSummary.hidden = total === 0;

    if (total > state.maxBatch) {
      showError(els.inputError, `当前 ${total} 家，超过单批上限 ${state.maxBatch} 家；请减少名单后再开始。`);
    }

    const disabled = state.busy || total === 0 || total > state.maxBatch;
    if (els.startButton) els.startButton.disabled = disabled;
  }

  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function resetFile() {
    state.file = null;
    state.sourceName = state.sourceName || '';
    state.workbook = null;
    state.sheetNames = [];
    state.sheetName = '';
    state.matrix = [];
    state.headerRow = 1;
    state.headers = [];
    state.dataRows = [];
    state.mapping = { company: -1, region: -1 };
    if (els.fileInput) els.fileInput.value = '';
    if (els.selectedFile) els.selectedFile.hidden = true;
    if (els.resetFileButton) els.resetFileButton.hidden = true;
    if (els.mappingPanel) els.mappingPanel.hidden = true;
    if (els.filePreview) els.filePreview.innerHTML = '';
    updatePreviewCounts({ total: 0, valid: 0, invalid: 0, duplicate: 0 });
    clearError(els.fileError);
  }

  async function handleFile(file) {
    clearError(els.fileError);
    if (!file) return;
    const ext = extensionOf(file.name);
    if (!['xlsx', 'xlsm', 'csv'].includes(ext)) {
      showError(els.fileError, '仅支持 .xlsx / .xlsm / .csv 文件。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError(els.fileError, `文件超过 ${formatBytes(MAX_FILE_BYTES)}，请先拆分。`);
      return;
    }
    if (typeof XLSX === 'undefined') {
      showError(els.fileError, 'Excel 解析组件未加载，请刷新页面后重试。');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      let workbook;
      try {
        workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
      } catch (_) {
        const text = new TextDecoder('utf-8').decode(buffer);
        workbook = XLSX.read(text, { type: 'string' });
      }
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('没有可读取的工作表。');
      }

      state.file = file;
      state.sourceName = file.name;
      state.workbook = workbook;
      state.sheetNames = workbook.SheetNames.slice();
      state.sheetName = state.sheetNames[0];
      state.headerRow = 1;
      if (els.headerRowInput) els.headerRowInput.value = '1';
      state.importSeq += 1;

      if (els.selectedFile) els.selectedFile.hidden = false;
      if (els.fileName) els.fileName.textContent = file.name;
      if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(file.size)} · ${state.sheetNames.length} 个工作表 · 只在浏览器内读取`;
      if (els.resetFileButton) els.resetFileButton.hidden = false;
      if (els.mappingPanel) els.mappingPanel.hidden = false;

      renderSheetSelect();
      parseSheet();
    } catch (error) {
      resetFile();
      showError(els.fileError, `无法解析该文件：${error.message}`);
    }
  }

  function renderSheetSelect() {
    if (!els.sheetSelect) return;
    els.sheetSelect.innerHTML = state.sheetNames
      .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
      .join('');
    els.sheetSelect.value = state.sheetName;
  }

  function headerLabel(value, index) {
    const text = String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
    return text || `列 ${index + 1}`;
  }

  function buildHeaders(row) {
    const seen = new Map();
    return row.map((value, index) => {
      const base = headerLabel(value, index);
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      return count > 1 ? `${base} (${count})` : base;
    });
  }

  function parseSheet() {
    if (!state.workbook) return;
    const worksheet = state.workbook.Sheets[state.sheetName];
    if (!worksheet) return;

    const matrix = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false
    });
    state.matrix = Array.isArray(matrix) ? matrix : [];

    const maxHeaderRow = Math.max(1, state.matrix.length);
    const headerRow = Math.min(Math.max(1, Number(els.headerRowInput?.value) || 1), maxHeaderRow);
    state.headerRow = headerRow;
    if (els.headerRowInput) els.headerRowInput.value = String(headerRow);

    const headerIndex = headerRow - 1;
    state.headers = buildHeaders(state.matrix[headerIndex] || []);
    state.dataRows = state.matrix.slice(headerRow).filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell == null ? '' : cell).trim() !== '')
    );

    autoDetectColumns();
    renderColumnSelects();
    renderFilePreview();
    if (els.mappingMeta) {
      els.mappingMeta.textContent = `${state.sheetName} · 表头第 ${state.headerRow} 行 · ${state.dataRows.length} 行数据`;
    }
  }

  function autoDetectColumns() {
    const headers = state.headers;
    if (!headers.length) {
      state.mapping = { company: -1, region: -1 };
      return;
    }
    let company = headers.findIndex((header) => /(公司|企业|单位|客户|商户|名称)/.test(header));
    if (company < 0) company = 0;
    let region = headers.findIndex((header) => /(城市|地区|省市|省|市|区县|区|地址)/.test(header));
    if (region === company) region = -1;
    state.mapping = { company, region };
  }

  function renderColumnSelects() {
    if (!els.companyColumn || !els.regionColumn) return;
    const options = state.headers
      .map((header, index) => `<option value="${index}">${esc(header)}</option>`)
      .join('');
    els.companyColumn.innerHTML = `<option value="">请选择公司名称列</option>${options}`;
    els.regionColumn.innerHTML = `<option value="">不使用地区列</option>${options}`;
    els.companyColumn.value = state.mapping.company >= 0 ? String(state.mapping.company) : '';
    els.regionColumn.value = state.mapping.region >= 0 ? String(state.mapping.region) : '';
    updateMappedCount();
  }

  function valueAt(row, index) {
    if (index < 0) return '';
    const value = row[index];
    return String(value == null ? '' : value).trim();
  }

  function updateMappedCount() {
    const value = els.companyColumn?.value;
    if (value === undefined || value === '') {
      if (els.mappedCount) els.mappedCount.textContent = '0';
      return;
    }
    const companyIndex = Number(value);
    const count = state.dataRows.filter((row) => valueAt(row, companyIndex)).length;
    if (els.mappedCount) els.mappedCount.textContent = String(count);
  }

  function mappedColumnIndexes() {
    const companyIndex = els.companyColumn?.value === '' || els.companyColumn?.value === undefined
      ? -1
      : Number(els.companyColumn.value);
    const regionIndex = els.regionColumn?.value === '' || els.regionColumn?.value === undefined
      ? -1
      : Number(els.regionColumn.value);
    return { companyIndex, regionIndex };
  }

  function computePreview() {
    const { companyIndex, regionIndex } = mappedColumnIndexes();
    const defaultRegion = (els.defaultRegion?.value || '').trim().slice(0, 64);
    const seen = new Set();
    const rows = [];
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;

    state.dataRows.forEach((row, index) => {
      const company = valueAt(row, companyIndex);
      const region = (regionIndex >= 0 ? valueAt(row, regionIndex) : '') || defaultRegion;
      let status = '有效';
      let cls = 'ok';

      if (!company || company.length > 200 || region.length > 64) {
        status = '无效';
        cls = 'bad';
        invalid += 1;
      } else {
        valid += 1;
        const key = `${normalizeDuplicateKey(company)}|${normalizeDuplicateKey(region)}`;
        if (seen.has(key)) {
          status = '重复';
          cls = 'warn';
          duplicate += 1;
        } else {
          seen.add(key);
        }
      }

      rows.push({ index, company, region, status, cls });
    });

    return { total: state.dataRows.length, valid, invalid, duplicate, rows };
  }

  function updatePreviewCounts(stats) {
    if (els.previewSummary) els.previewSummary.hidden = stats.total === 0;
    if (els.previewTotal) els.previewTotal.textContent = String(stats.total);
    if (els.previewValid) els.previewValid.textContent = String(stats.valid);
    if (els.previewInvalid) els.previewInvalid.textContent = String(stats.invalid);
    if (els.previewDuplicate) els.previewDuplicate.textContent = String(stats.duplicate);
  }

  function renderFilePreview() {
    if (!els.filePreview) return;
    if (!state.headers.length || !state.dataRows.length) {
      updatePreviewCounts({ total: 0, valid: 0, invalid: 0, duplicate: 0 });
      els.filePreview.innerHTML = '<div class="empty-state">没有可预览的数据行。</div>';
      return;
    }

    const stats = computePreview();
    updatePreviewCounts(stats);
    const body = stats.rows.slice(0, 8).map((row) => `<tr>
      <td class="cell-strong">${esc(row.company || '—')}</td>
      <td>${esc(row.region || '—')}</td>
      <td><span class="preview-status ${row.cls}">${esc(row.status)}</span></td>
    </tr>`).join('');

    els.filePreview.innerHTML = `<table><thead><tr><th>公司名称</th><th>城市/地区</th><th>数据状态</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function importFileRows() {
    clearError(els.fileError);
    if (!state.file) return;
    const companyValue = els.companyColumn?.value;
    if (companyValue === undefined || companyValue === '') {
      showError(els.fileError, '请先选择公司名称列。');
      return;
    }
    const companyIndex = Number(companyValue);
    if (!Number.isInteger(companyIndex) || companyIndex < 0) {
      showError(els.fileError, '请先选择公司名称列。');
      return;
    }
    const regionIndex = els.regionColumn.value === '' ? -1 : Number(els.regionColumn.value);
    const defaultRegion = els.defaultRegion.value.trim().slice(0, 64);
    const strict = els.strictRegion.checked;
    const items = [];
    const errors = [];

    state.dataRows.forEach((row, rowIndex) => {
      const company = valueAt(row, companyIndex);
      if (!company) return;
      if (company.length > 200) {
        errors.push(`数据第 ${rowIndex + 1} 行公司名称超过 200 字符，未导入。`);
        return;
      }
      const region = (regionIndex >= 0 ? valueAt(row, regionIndex) : '') || defaultRegion;
      if (region.length > 64) {
        errors.push(`数据第 ${rowIndex + 1} 行地区超过 64 字符，未导入。`);
        return;
      }
      items.push({
        clientId: `file-${state.importSeq}-${rowIndex + 1}`,
        companyName: company,
        region,
        strictRegion: strict
      });
    });

    if (!items.length) {
      showError(els.fileError, errors.length ? errors.slice(0, 4).join('\n') : '没有可导入的公司名称。');
      return;
    }

    const existing = state.pastedItems.length + state.importedItems.length;
    const remaining = Math.max(0, state.maxBatch - existing);
    const accepted = items.slice(0, remaining);
    if (!accepted.length) {
      showError(els.fileError, `查询名单已达 ${state.maxBatch} 家上限，未导入。`);
      return;
    }
    state.importedItems.push(...accepted);
    updateInputSummary();
    resetFile();
    const note = accepted.length < items.length
      ? `已导入前 ${accepted.length} 条；其余 ${items.length - accepted.length} 条超过单批上限。`
      : `已导入 ${accepted.length} 条公司记录。`;
    showToast(errors.length ? `${note} ${errors.length} 行未通过校验。` : note);
  }

  function renderJob(job) {
    if (!job) return;
    state.job = job;
    const total = Number(job.total) || 0;
    const processed = Number(job.processed) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    if (els.jobStatus) {
      els.jobStatus.textContent = JOB_STATUS_LABELS[job.status] || job.status || '—';
      els.jobStatus.className = `job-status ${jobStatusClass(job.status)}`;
    }
    if (els.progressBar) els.progressBar.style.width = `${percent}%`;
    if (els.progressValue) els.progressValue.textContent = `${processed} / ${total}`;
    if (els.jobIdLabel) els.jobIdLabel.textContent = `Job ${String(job.jobId || state.jobId || '').slice(0, 8)}…`;
    if (els.progressMessage) {
      els.progressMessage.textContent = job.status === 'completed'
        ? `查询完成：${countsOf(job).review} 条需要人工确认。`
        : job.status === 'cancelled'
          ? '任务已取消；已完成的结果仍可查看和导出。'
          : job.status === 'running'
            ? '正在逐条查询官方地图 POI…'
            : '任务已创建，等待查询…';
    }
    if (els.cancelButton) {
      els.cancelButton.disabled = !['queued', 'running'].includes(job.status);
    }
    if (els.resultSubtitle) {
      els.resultSubtitle.textContent = `${total} 家 · ${JOB_STATUS_LABELS[job.status] || job.status} · Job ${String(job.jobId || state.jobId || '').slice(0, 8)}…`;
    }
    renderMetrics(job);
    if (els.progressMetrics) {
      els.progressMetrics.hidden = ['completed', 'cancelled'].includes(job.status);
    }
    updateExportState();
  }

  function renderResults() {
    if (!els.resultBody) return;
    const rows = state.results || [];
    if (!rows.length) {
      const message = state.total === 0 && state.filter !== 'all'
        ? '当前筛选没有记录。'
        : state.total === 0 && state.job && ['queued', 'running'].includes(state.job.status)
          ? '正在等待第一批结果…'
          : state.total === 0
            ? '没有查询结果。'
            : '当前筛选没有记录。';
      els.resultBody.innerHTML = `<tr><td colspan="16"><div class="empty-state">${esc(message)}</div></td></tr>`;
    } else {
      els.resultBody.innerHTML = rows.map((item) => {
        const match = item.match || {};
        const input = item.input || {};
        const poiId = match.poiId || '';
        const address = match.address || '';
        const action = item.status === 'review' && Array.isArray(item.candidates) && item.candidates.length
          ? `<button class="row-action primary" type="button" data-action="review" data-item-id="${esc(item.itemId)}">确认地点</button>`
          : item.status === 'matched' && address
            ? `<button class="row-action" type="button" data-action="copy-address" data-address="${esc(address)}">复制地址</button>`
            : '—';
        return `<tr>
          <td class="cell-strong">${esc(input.companyName || '')}</td>
          <td>${esc(input.region || '—')}</td>
          <td>${item.status === 'review' && Array.isArray(item.candidates) && item.candidates.length
            ? `<button class="status-badge review" type="button" data-action="review" data-item-id="${esc(item.itemId)}" title="查看候选地点">${esc(statusLabel(item.status))}</button>`
            : `<span class="status-badge ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span>`}</td>
          <td class="cell-num confidence">${esc(confidenceText(item.confidence))}</td>
          <td>${esc(match.name || '—')}</td>
          <td class="cell-address">${esc(address || '—')}</td>
          <td>${esc(match.province || '—')}</td>
          <td>${esc(match.city || '—')}</td>
          <td>${esc(match.district || '—')}</td>
          <td class="cell-num">${esc(coordinateText(match.longitude))}</td>
          <td class="cell-num">${esc(coordinateText(match.latitude))}</td>
          <td>${esc(match.coordinateSystem || '—')}</td>
          <td>${esc(item.provider || '—')}</td>
          <td class="cell-poi" title="${esc(poiId)}">${esc(poiId || '—')}</td>
          <td>${item.selectedByUser ? '<span class="manual-badge">是</span>' : '否'}</td>
          <td>${action}</td>
        </tr>`;
      }).join('');
    }

    const start = state.total === 0 ? 0 : state.offset + 1;
    const end = Math.min(state.offset + state.results.length, state.total);
    if (els.tableMeta) {
      els.tableMeta.textContent = `本页 ${formatNumber(start)}–${formatNumber(end)} / 共 ${formatNumber(state.total)} 条${state.q ? ` · 搜索“${state.q}”` : ''} · 表格可左右滚动`;
    }
    if (els.pagerText) {
      els.pagerText.textContent = `第 ${Math.floor(state.offset / state.limit) + 1} 页 · 共 ${Math.max(1, Math.ceil(state.total / state.limit))} 页`;
    }
    if (els.prevPage) els.prevPage.disabled = state.offset <= 0;
    if (els.nextPage) els.nextPage.disabled = state.offset + state.limit >= state.total;
  }

  async function loadResults({ reset = false, silent = false } = {}) {
    if (!state.jobId || state.loadingResults) return;
    if (reset) state.offset = 0;
    state.loadingResults = true;
    let retry = false;
    try {
      const params = new URLSearchParams({
        offset: String(state.offset),
        limit: String(state.limit)
      });
      if (state.filter !== 'all') params.set('status', state.filter);
      if (state.q) params.set('q', state.q);
      const data = await api(`/jobs/${encodeURIComponent(state.jobId)}/results?${params.toString()}`);
      state.job = data.job;
      state.results = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total) || 0;
      if (state.offset >= state.total && state.offset > 0) {
        state.offset = Math.max(0, Math.floor(Math.max(0, state.total - 1) / state.limit) * state.limit);
        retry = true;
      }
      renderJob(state.job);
      renderResults();
    } catch (error) {
      if (error.status !== 401 && !silent) showToast(`结果加载失败：${error.message}`);
    } finally {
      state.loadingResults = false;
      if (retry) loadResults();
    }
  }

  function schedulePoll(delay = 1200) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollJob, delay);
  }

  async function pollJob() {
    if (!state.jobId) return;
    try {
      const job = await api(`/jobs/${encodeURIComponent(state.jobId)}`);
      state.pollFailures = 0;
      clearError(els.progressError);
      const previousStatus = state.job?.status;
      renderJob(job);

      const terminal = ['completed', 'cancelled'].includes(job.status);
      if (terminal) {
        if (previousStatus !== job.status || job.processed !== state.lastProcessed || !state.results.length) {
          state.lastProcessed = job.processed;
          await loadResults();
        }
        if (previousStatus !== job.status) {
          showToast(job.status === 'completed' ? '查询完成。' : '任务已取消。');
        }
        return;
      }

      if (job.processed !== state.lastProcessed || !state.results.length) {
        state.lastProcessed = job.processed;
        await loadResults();
      }
      schedulePoll(1400);
    } catch (error) {
      if (error.status === 401) return;
      state.pollFailures += 1;
      if (state.pollFailures <= 5) {
        const delay = Math.min(8000, 1200 * state.pollFailures);
        showError(els.progressError, `网络暂时中断，${Math.round(delay / 1000)} 秒后重试当前 Job；不会创建新 Job。`);
        schedulePoll(delay);
      } else {
        showError(els.progressError, '连续无法连接服务器。请保留此页面，恢复网络后点“刷新结果”，不要重复创建任务。');
      }
    }
  }

  async function refreshJob() {
    if (!state.jobId) return;
    try {
      const job = await api(`/jobs/${encodeURIComponent(state.jobId)}`);
      renderJob(job);
      await loadResults();
    } catch (error) {
      if (error.status !== 401) showToast(`刷新失败：${error.message}`);
    }
  }

  async function startJob() {
    if (state.busy) return;
    updateInputSummary();
    if (!state.items.length) {
      showError(els.inputError, '请先输入或导入公司名称。');
      return;
    }
    if (state.items.length > state.maxBatch) {
      showError(els.inputError, `单批最多 ${state.maxBatch} 家，请减少名单。`);
      return;
    }

    const provider = els.providerSelect && els.providerSelect.value === 'baidu' ? 'baidu' : 'amap';
    const apiKey = readProviderKey();
    if (!apiKey && !state.providerReady) {
      showError(els.inputError, '请输入地图 API Key 后再开始查询，或联系管理员配置服务端 Provider Key。');
      return;
    }

    clearError(els.inputError);
    state.busy = true;
    if (els.startButton) els.startButton.disabled = true;

    const { uniqueItems, primaryOf, groups } = planDedupe(state.items);
    state.primaryOf = primaryOf;
    state.dedupeGroups = groups;
    const body = { provider, items: uniqueItems };
    if (apiKey) body.apiKey = apiKey;

    try {
      const job = await api('/jobs', { method: 'POST', body });
      state.jobId = job.jobId;
      state.job = job;
      state.results = [];
      state.offset = 0;
      state.total = 0;
      state.filter = 'all';
      state.q = '';
      state.lastProcessed = -1;
      state.pollFailures = 0;
      if (els.resultSearch) els.resultSearch.value = '';
      setActiveFilter('all');
      renderJob(job);
      if (els.inputPanel) els.inputPanel.hidden = true;
      if (els.progressPanel) els.progressPanel.hidden = false;
      if (els.resultPanel) els.resultPanel.hidden = false;
      els.progressPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const merged = uniqueItems.length < state.items.length ? `（合并 ${state.items.length - uniqueItems.length} 条重复记录）` : '';
      showToast(`已创建查询任务${merged}。`);
      schedulePoll(700);
    } catch (error) {
      showError(els.inputError, `创建任务失败：${keyErrorMessage(error)}\n如果刚才网络中断，请先刷新页面确认任务是否已创建，避免重复提交。`);
    } finally {
      state.busy = false;
      updateInputSummary();
    }
  }

  async function cancelJob() {
    if (!state.jobId) return;
    if (els.cancelButton) els.cancelButton.disabled = true;
    try {
      const job = await api(`/jobs/${encodeURIComponent(state.jobId)}/cancel`, { method: 'POST', body: {} });
      renderJob(job);
      showToast('已请求取消；正在进行的单条请求可能完成。');
      schedulePoll(500);
    } catch (error) {
      if (error.status !== 401) showError(els.progressError, `取消失败：${error.message}`);
      if (els.cancelButton) els.cancelButton.disabled = false;
    }
  }

  function setActiveFilter(filter) {
    state.filter = filter;
    $$('[data-filter]', els.filterTabs).forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function onFilterClick(event) {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    setActiveFilter(button.dataset.filter || 'all');
    loadResults({ reset: true });
  }

  let searchTimer;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = els.resultSearch.value.trim().slice(0, 100);
      loadResults({ reset: true });
    }, 320);
  }

  function onTableClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'review') {
      const item = state.results.find((entry) => entry.itemId === button.dataset.itemId);
      if (item) openCandidateDrawer(item, button);
    } else if (button.dataset.action === 'copy-address') {
      copyText(button.dataset.address || '', '地址已复制。');
    }
  }

  async function copyText(text, message) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(message);
      return;
    } catch (_) { /* fallback below */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      showToast(message);
    } catch (_) {
      showToast('复制失败，请手动选择文本。');
    } finally {
      area.remove();
    }
  }

  function openCandidateDrawer(item, trigger) {
    state.reviewItem = item;
    state.selectedCandidate = -1;
    state.lastFocus = trigger || document.activeElement;
    renderCandidates();
    if (els.candidateBackdrop) els.candidateBackdrop.hidden = false;
    if (els.candidateDrawer) els.candidateDrawer.hidden = false;
    document.body.classList.add('drawer-open');
    els.closeCandidateButton?.focus();
  }

  function closeCandidateDrawer() {
    if (els.candidateDrawer) els.candidateDrawer.hidden = true;
    if (els.candidateBackdrop) els.candidateBackdrop.hidden = true;
    document.body.classList.remove('drawer-open');
    state.reviewItem = null;
    state.selectedCandidate = -1;
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
    state.lastFocus = null;
  }

  function renderCandidates() {
    const item = state.reviewItem;
    if (!item || !els.candidateBody) return;
    const input = item.input || {};
    if (els.candidateSubtitle) {
      els.candidateSubtitle.textContent = `${input.companyName || '—'}${input.region ? ` · ${input.region}` : ''} · 请从服务端返回的候选地点中选择`;
    }
    if (els.confirmCandidateButton) els.confirmCandidateButton.innerHTML = '确认选择 <span>→</span>';
    const candidates = Array.isArray(item.candidates) ? item.candidates : [];
    if (!candidates.length) {
      els.candidateBody.innerHTML = '<div class="candidate-empty">该条目没有可确认的候选地点。</div>';
      if (els.confirmCandidateButton) els.confirmCandidateButton.disabled = true;
      return;
    }
    els.candidateBody.innerHTML = candidates.map((candidate, index) => {
      const canSelect = Boolean(candidate.poiId);
      const meta = [
        [candidate.province, candidate.city, candidate.district].filter(Boolean).join(' / ') || '行政区未提供',
        `经度 ${coordinateText(candidate.longitude)} · 纬度 ${coordinateText(candidate.latitude)}`,
        `分数 ${confidenceText(candidate.matchScore)}`,
        candidate.source || '—'
      ];
      return `<label class="candidate-card" data-candidate-index="${index}">
        <input type="radio" name="candidate" value="${index}" ${canSelect ? '' : 'disabled'} />
        <div class="candidate-main">
          <strong>${esc(candidate.name || '未命名地点')}</strong>
          <span>${esc(candidate.address || '地址未提供')}</span>
          <div class="candidate-meta">${meta.map((value) => `<span>${esc(value)}</span>`).join('')}</div>
          <span>POI ID：${esc(candidate.poiId || '缺少 POI ID，无法确认')}</span>
        </div>
      </label>`;
    }).join('');
    if (els.confirmCandidateButton) els.confirmCandidateButton.disabled = true;
  }

  function onCandidateChange(event) {
    const input = event.target.closest('input[name="candidate"]');
    if (!input || input.disabled) return;
    state.selectedCandidate = Number(input.value);
    $$('.candidate-card', els.candidateBody).forEach((card) => {
      card.classList.toggle('selected', Number(card.dataset.candidateIndex) === state.selectedCandidate);
    });
    if (els.confirmCandidateButton) els.confirmCandidateButton.disabled = state.selectedCandidate < 0;
  }

  async function confirmCandidate() {
    if (!state.jobId || !state.reviewItem || state.selectedCandidate < 0) return;
    const candidate = (state.reviewItem.candidates || [])[state.selectedCandidate];
    if (!candidate || !candidate.poiId) {
      showToast('该候选缺少 POI ID，不能确认。');
      return;
    }
    if (els.confirmCandidateButton) {
      els.confirmCandidateButton.disabled = true;
      els.confirmCandidateButton.textContent = '确认中…';
    }
    try {
      await api(
        `/jobs/${encodeURIComponent(state.jobId)}/items/${encodeURIComponent(state.reviewItem.itemId)}/resolve`,
        { method: 'POST', body: { poiId: candidate.poiId } }
      );
      closeCandidateDrawer();
      showToast('已保存为人工确认。');
      await refreshJob();
    } catch (error) {
      if (error.status !== 401) showToast(`确认失败：${error.message}`);
      if (els.confirmCandidateButton) {
        els.confirmCandidateButton.disabled = false;
        els.confirmCandidateButton.innerHTML = '确认选择 <span>→</span>';
      }
    }
  }

  function updateExportState() {
    const ready = Boolean(state.jobId && state.job && ['completed', 'cancelled'].includes(state.job.status) && Number(state.job.total) > 0);
    if (els.exportCsvButton) els.exportCsvButton.disabled = !ready;
    if (els.exportXlsxButton) els.exportXlsxButton.disabled = !ready;
    if (els.refreshResultsButton) els.refreshResultsButton.disabled = !state.jobId;
  }

  async function fetchAllResults() {
    if (!state.jobId) return [];
    const all = [];
    let offset = 0;
    const total = Number(state.job?.total) || 0;
    while (offset < total || offset === 0) {
      const data = await api(`/jobs/${encodeURIComponent(state.jobId)}/results?offset=${offset}&limit=500`);
      const items = Array.isArray(data.items) ? data.items : [];
      all.push(...items);
      if (!items.length) break;
      offset += items.length;
      if (offset >= total) break;
    }
    return all;
  }

  function safeExportCell(value) {
    const text = String(value == null ? '' : value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function exportRows(items) {
    const header = [
      '原始公司名称', '原始地区', '地图匹配名称', '地图地址', '省', '市', '区',
      '经度', '纬度', '坐标系', '匹配状态', '置信度', 'Provider', 'POI ID', '是否人工确认'
    ];
    const rows = items.map((item) => {
      const input = item.input || {};
      const match = item.match || {};
      return [
        safeExportCell(input.companyName || ''),
        safeExportCell(input.region || ''),
        safeExportCell(match.name || ''),
        safeExportCell(match.address || ''),
        safeExportCell(match.province || ''),
        safeExportCell(match.city || ''),
        safeExportCell(match.district || ''),
        Number.isFinite(Number(match.longitude)) ? Number(match.longitude) : '',
        Number.isFinite(Number(match.latitude)) ? Number(match.latitude) : '',
        'GCJ-02',
        safeExportCell(statusLabel(item.status)),
        safeExportCell(confidenceText(item.confidence)),
        safeExportCell(item.provider || ''),
        safeExportCell(match.poiId || ''),
        item.selectedByUser ? '是' : '否'
      ];
    });
    return [header, ...rows];
  }

  function exportFileName(extension) {
    const base = state.sourceName
      ? String(state.sourceName).replace(/\.[^.]+$/, '')
      : '公司地图地址查询';
    const safe = base.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || '公司地图地址查询';
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0')
    ].join('');
    return `${safe}_地图地址结果_${stamp}.${extension}`;
  }

  function exportMetadata(items) {
    const counts = countsOf(state.job);
    return [
      ['工具', '公司地图地址查询'],
      ['版本', CURRENT_VERSION],
      ['导出时间', new Date().toISOString()],
      ['坐标系统', 'GCJ-02'],
      ['Job ID', state.jobId || ''],
      ['结果总数', items.length],
      ['已匹配', counts.matched],
      ['待确认', counts.review],
      ['未找到', counts.not_found],
      ['失败', counts.error],
      ['已取消', counts.cancelled],
      ['任务存储', 'memory（Node/PM2 重启后不保留）'],
      ['说明', '地图 POI 地址不是工商注册地址；review 行未确认时匹配字段为空。']
    ];
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function expandExportItems(results) {
    const list = Array.isArray(results) ? results : [];
    if (!state.primaryOf || !state.primaryOf.size) return list;

    const byClientId = new Map();
    list.forEach((item) => {
      const clientId = item && item.input ? item.input.clientId : '';
      if (clientId) byClientId.set(clientId, item);
    });

    const included = new Set();
    const expanded = [];
    state.items.forEach((original) => {
      const primaryId = state.primaryOf.get(original.clientId) || original.clientId;
      const result = byClientId.get(primaryId) || byClientId.get(original.clientId);
      if (!result) return;
      const resultId = result.input ? result.input.clientId : '';
      if (resultId) included.add(resultId);
      expanded.push({
        ...result,
        input: {
          ...(result.input || {}),
          clientId: original.clientId,
          companyName: original.companyName,
          region: original.region
        }
      });
    });

    list.forEach((item) => {
      const clientId = item && item.input ? item.input.clientId : '';
      if (clientId && !included.has(clientId)) expanded.push(item);
    });

    return expanded;
  }

  async function exportResults(format) {
    if (!state.job || !['completed', 'cancelled'].includes(state.job.status)) {
      showToast('请等待任务完成或取消后再导出。');
      return;
    }
    if (typeof XLSX === 'undefined') {
      showToast('Excel 导出组件未加载，请刷新页面。');
      return;
    }
    try {
      const items = expandExportItems(await fetchAllResults());
      if (!items.length) {
        showToast('没有可导出的结果。');
        return;
      }
      const data = exportRows(items);
      const sheet = XLSX.utils.aoa_to_sheet(data);
      sheet['!cols'] = [
        { wch: 26 }, { wch: 14 }, { wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 9 },
        { wch: 10 }, { wch: 28 }, { wch: 10 }
      ];
      if (format === 'csv') {
        const csv = '\ufeff' + XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\r\n' });
        downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportFileName('csv'));
      } else {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, '地图地址结果');
        const metaSheet = XLSX.utils.aoa_to_sheet(exportMetadata(items));
        metaSheet['!cols'] = [{ wch: 14 }, { wch: 80 }];
        XLSX.utils.book_append_sheet(workbook, metaSheet, '导出说明');
        XLSX.writeFile(workbook, exportFileName('xlsx'), { compression: true });
      }
      showToast(`已导出 ${items.length} 条结果。`);
    } catch (error) {
      if (error.status !== 401) showToast(`导出失败：${error.message}`);
    }
  }

  function resetWorkspace() {
    if (state.job && ['queued', 'running'].includes(state.job.status)) {
      if (!window.confirm('当前任务仍在进行，确定新建查询？')) return;
    }
    clearTimeout(state.pollTimer);
    state.jobId = null;
    state.job = null;
    state.results = [];
    state.offset = 0;
    state.total = 0;
    state.filter = 'all';
    state.q = '';
    state.pollFailures = 0;
    state.lastProcessed = -1;
    state.loadingResults = false;
    state.pastedItems = [];
    state.importedItems = [];
    state.items = [];
    state.sourceName = '';
    state.importSeq = 0;
    state.primaryOf = new Map();
    state.dedupeGroups = new Map();
    state.keyVerified = false;
    if (els.companyText) els.companyText.value = '';
    if (els.defaultRegion) els.defaultRegion.value = '';
    if (els.strictRegion) els.strictRegion.checked = false;
    if (els.providerKey) {
      els.providerKey.value = '';
      els.providerKey.type = 'password';
    }
    if (els.toggleKeyButton) {
      els.toggleKeyButton.textContent = '显示';
      els.toggleKeyButton.setAttribute('aria-pressed', 'false');
    }
    setKeyStatus('idle', '未验证');
    clearError(els.keyError);
    if (els.resultSearch) els.resultSearch.value = '';
    if (els.progressBar) els.progressBar.style.width = '0';
    if (els.progressValue) els.progressValue.textContent = '0 / 0';
    resetFile();
    clearError(els.inputError);
    clearError(els.fileError);
    clearError(els.progressError);
    setActiveFilter('all');
    if (els.inputPanel) els.inputPanel.hidden = false;
    if (els.progressPanel) els.progressPanel.hidden = true;
    if (els.resultPanel) els.resultPanel.hidden = true;
    closeCandidateDrawer();
    updateInputSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderVersionNotes() {
    if (!els.versionList) return;
    els.versionList.innerHTML = VERSION_NOTES.map((note) => `
      <div class="version-item${note.current ? ' current' : ''}">
        <div class="version-item-head"><strong>${esc(note.version)}</strong><span>${esc(note.date)}</span></div>
        <ul>${note.notes.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      </div>
    `).join('');
    if (els.versionButton) els.versionButton.textContent = CURRENT_VERSION;
  }

  function openVersionDialog() {
    if (els.versionBackdrop) els.versionBackdrop.hidden = false;
    if (els.versionDialog) els.versionDialog.hidden = false;
    els.closeVersionButton?.focus();
  }

  function closeVersionDialog() {
    if (els.versionBackdrop) els.versionBackdrop.hidden = true;
    if (els.versionDialog) els.versionDialog.hidden = true;
  }

  function bindEvents() {
    els.companyText?.addEventListener('input', updateInputSummary);
    els.defaultRegion?.addEventListener('input', () => {
      updateInputSummary();
      if (state.workbook) renderFilePreview();
    });
    els.strictRegion?.addEventListener('change', updateInputSummary);
    els.clearTextButton?.addEventListener('click', () => {
      if (els.companyText) els.companyText.value = '';
      updateInputSummary();
    });

    els.providerSelect?.addEventListener('change', updateProviderUi);
    els.providerKey?.addEventListener('input', () => {
      state.keyVerified = false;
      setKeyStatus('idle', '未验证');
      clearError(els.keyError);
    });
    els.toggleKeyButton?.addEventListener('click', toggleKeyVisibility);
    els.validateKeyButton?.addEventListener('click', validateProviderKey);
    els.downloadTemplateButton?.addEventListener('click', downloadTemplate);

    els.fileInput?.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) handleFile(file);
    });
    ['dragenter', 'dragover'].forEach((name) => {
      els.dropZone?.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      els.dropZone?.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropZone.classList.remove('dragover');
      });
    });
    els.dropZone?.addEventListener('drop', (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    els.resetFileButton?.addEventListener('click', resetFile);

    els.sheetSelect?.addEventListener('change', () => {
      state.sheetName = els.sheetSelect.value;
      state.headerRow = 1;
      if (els.headerRowInput) els.headerRowInput.value = '1';
      parseSheet();
    });
    els.headerRowInput?.addEventListener('change', parseSheet);
    els.companyColumn?.addEventListener('change', () => {
      state.mapping.company = els.companyColumn.value === '' ? -1 : Number(els.companyColumn.value);
      renderFilePreview();
      updateMappedCount();
    });
    els.regionColumn?.addEventListener('change', () => {
      state.mapping.region = els.regionColumn.value === '' ? -1 : Number(els.regionColumn.value);
      renderFilePreview();
      updateMappedCount();
    });
    els.importFileButton?.addEventListener('click', importFileRows);

    els.startButton?.addEventListener('click', startJob);
    els.cancelButton?.addEventListener('click', cancelJob);
    els.refreshResultsButton?.addEventListener('click', refreshJob);
    els.exportCsvButton?.addEventListener('click', () => exportResults('csv'));
    els.exportXlsxButton?.addEventListener('click', () => exportResults('xlsx'));
    els.filterTabs?.addEventListener('click', onFilterClick);
    els.resultSearch?.addEventListener('input', onSearchInput);
    els.resultBody?.addEventListener('click', onTableClick);
    els.prevPage?.addEventListener('click', () => {
      state.offset = Math.max(0, state.offset - state.limit);
      loadResults();
    });
    els.nextPage?.addEventListener('click', () => {
      state.offset += state.limit;
      loadResults();
    });

    els.closeCandidateButton?.addEventListener('click', closeCandidateDrawer);
    els.candidateBackdrop?.addEventListener('click', closeCandidateDrawer);
    els.candidateBody?.addEventListener('change', onCandidateChange);
    els.candidateBody?.addEventListener('click', (event) => {
      if (event.target.matches('input[type="radio"]')) return;
      const card = event.target.closest('.candidate-card');
      if (!card) return;
      const radio = card.querySelector('input[type="radio"]');
      if (radio && !radio.disabled) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    els.confirmCandidateButton?.addEventListener('click', confirmCandidate);

    els.versionButton?.addEventListener('click', openVersionDialog);
    els.footerVersionButton?.addEventListener('click', openVersionDialog);
    els.closeVersionButton?.addEventListener('click', closeVersionDialog);
    els.versionBackdrop?.addEventListener('click', closeVersionDialog);
    els.newJobButton?.addEventListener('click', resetWorkspace);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (els.candidateDrawer && !els.candidateDrawer.hidden) closeCandidateDrawer();
      if (els.versionDialog && !els.versionDialog.hidden) closeVersionDialog();
    });
  }

  async function init() {
    cacheElements();
    renderVersionNotes();
    bindEvents();
    updateProviderUi();
    renderMetrics({ total: 0, counts: {} });
    updateInputSummary();
    await loadMeta();
  }

  init().catch((error) => {
    console.error(error);
    showToast('页面初始化失败，请刷新重试。');
  });
})();

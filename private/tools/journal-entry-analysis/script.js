'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const API = '/api/journal-entry-analyses';

  const FALLBACK_FIELDS = [
    ['date', '日期'], ['voucher_id', '凭证号'], ['account_code', '科目编码'],
    ['account_name', '科目名称'], ['description', '摘要'], ['currency', '币种'],
    ['direction', '方向/借贷'], ['debit', '借方金额'], ['credit', '贷方金额'],
    ['amount', '金额（方向+金额）'], ['original_amount', '原币金额']
  ];

  const STATUS_LABEL = {
    draft: '待确认', queued: '排队中', running: '分析中',
    completed: '已完成', failed: '失败'
  };

  const TAB_LABEL = {
    vouchers: '凭证汇总', business: '业务分类',
    contra: '对方科目', anomaly: '异常凭证'
  };

  const dom = {
    fileInput: $('#fileInput'), dropZone: $('#dropZone'), selectedFile: $('#selectedFile'),
    fileName: $('#fileName'), fileMeta: $('#fileMeta'), clearFileButton: $('#clearFileButton'),
    uploadButton: $('#uploadButton'), uploadError: $('#uploadError'),
    uploadProgress: $('#uploadProgress'), uploadProgressBar: $('#uploadProgressBar'),
    uploadProgressText: $('#uploadProgressText'),
    uploadPanel: $('#uploadPanel'), mappingPanel: $('#mappingPanel'), previewPanel: $('#previewPanel'),
    processPanel: $('#processPanel'), resultPanel: $('#resultPanel'), historyPanel: $('#historyPanel'),
    sheetSelect: $('#sheetSelect'), headerRowInput: $('#headerRowInput'),
    redetectButton: $('#redetectButton'), amountLayoutSelect: $('#amountLayoutSelect'),
    positiveSideControl: $('#positiveSideControl'), positiveSideSelect: $('#positiveSideSelect'),
    headerCandidates: $('#headerCandidates'), mappingHints: $('#mappingHints'),
    mappingGrid: $('#mappingGrid'), mappingError: $('#mappingError'),
    previewButton: $('#previewButton'), previewSubtitle: $('#previewSubtitle'),
    previewCanStart: $('#previewCanStart'), previewMetrics: $('#previewMetrics'),
    previewIssues: $('#previewIssues'), previewSamples: $('#previewSamples'),
    startButton: $('#startButton'), mappingJobStatus: $('#mappingJobStatus'),
    processMessage: $('#processMessage'), jobStatus: $('#jobStatus'),
    progressBar: $('#progressBar'), progressValue: $('#progressValue'),
    jobIdLabel: $('#jobIdLabel'), processNote: $('#processNote'), processError: $('#processError'),
    resultSubtitle: $('#resultSubtitle'), resultMetrics: $('#resultMetrics'),
    resultWarnings: $('#resultWarnings'), resultFilters: $('#resultFilters'),
    resultTableWrap: $('#resultTableWrap'), resultPager: $('#resultPager'),
    exportButton: $('#exportButton'), refreshResultButton: $('#refreshResultButton'),
    refreshHistoryButton: $('#refreshHistoryButton'), historyList: $('#historyList'),
    newJobButton: $('#newJobButton'), toast: $('#toast'),
    detailBackdrop: $('#detailBackdrop'), detailDrawer: $('#detailDrawer'),
    detailTitle: $('#detailTitle'), detailSubtitle: $('#detailSubtitle'),
    detailBody: $('#detailBody'), closeDetailButton: $('#closeDetailButton')
  };

  const state = {
    meta: null,
    file: null,
    job: null,
    inspection: null,
    preview: null,
    result: null,
    tab: 'vouchers',
    page: 0,
    pageSize: 50,
    filters: {},
    pollTimer: null,
    uploadXhr: null,
    detailVoucher: null,
    findingsByVoucher: new Map()
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
    clearTimeout(window.__jeToast);
    window.__jeToast = setTimeout(() => dom.toast.classList.remove('show'), 2800);
  }

  function showError(node, message) {
    if (!node) return;
    node.textContent = message || '发生错误。';
    node.hidden = !message;
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = text || '处理中…';
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const size = value / (1024 ** index);
    return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${(number * 100).toFixed(2)}%`;
  }

  function statusLabel(status) { return STATUS_LABEL[status] || status || '—'; }

  function statusTone(status) {
    if (status === 'completed') return 'green';
    if (status === 'running' || status === 'queued') return 'blue';
    if (status === 'failed') return 'red';
    return 'gray';
  }

  function badge(text, tone) {
    return el('span', `badge ${tone || 'gray'}`, text);
  }

  function fieldList() {
    const fields = state.meta?.mappingFields;
    if (Array.isArray(fields) && fields.length) {
      return fields.map((field) => [field.key, field.label]);
    }
    return FALLBACK_FIELDS;
  }

  function fieldLabel(name) {
    const found = fieldList().find(([key]) => key === name);
    return found ? found[1] : name;
  }

  function columnLetter(index) {
    let value = Number(index);
    let output = '';
    while (value > 0) {
      value -= 1;
      output = String.fromCharCode(65 + (value % 26)) + output;
      value = Math.floor(value / 26);
    }
    return output || '?';
  }

  function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(path, { ...options, headers }).then(async (response) => {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (!response.ok) {
        const error = new Error(payload.error || payload.message || `请求失败 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return payload;
    });
  }

  function resetState() {
    state.file = null;
    state.job = null;
    state.inspection = null;
    state.preview = null;
    state.result = null;
    state.tab = 'vouchers';
    state.page = 0;
    state.filters = {};
    state.findingsByVoucher = new Map();
    state.detailVoucher = null;
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function setFile(file) {
    if (!file) return clearFile();
    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx')) {
      showToast('仅支持 .xls / .xlsx 文件。');
      return clearFile();
    }
    state.file = file;
    dom.selectedFile.hidden = false;
    dom.fileName.textContent = file.name;
    dom.fileMeta.textContent = `${formatBytes(file.size)} · ${name.endsWith('.xlsx') ? 'XLSX 工作簿' : 'XLS 工作簿'}`;
    dom.uploadButton.disabled = false;
    showError(dom.uploadError, '');
  }

  function clearFile() {
    state.file = null;
    dom.fileInput.value = '';
    dom.selectedFile.hidden = true;
    dom.uploadButton.disabled = true;
  }

  function setUploadProgress(percent, text) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    dom.uploadProgress.hidden = false;
    dom.uploadProgressBar.style.width = `${safe}%`;
    dom.uploadProgressText.textContent = text || `正在上传… ${safe}%`;
  }

  function uploadSelected() {
    if (!state.file) return;
    if (state.uploadXhr) state.uploadXhr.abort();
    showError(dom.uploadError, '');
    setBusy(dom.uploadButton, true, '上传中…');
    setUploadProgress(0, '正在上传…');
    const form = new FormData();
    form.append('file', state.file, state.file.name);
    const xhr = new XMLHttpRequest();
    state.uploadXhr = xhr;
    xhr.open('POST', API);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress(Math.round((event.loaded / event.total) * 100), `正在上传… ${Math.round((event.loaded / event.total) * 100)}%`);
    });
    xhr.addEventListener('load', () => {
      state.uploadXhr = null;
      setBusy(dom.uploadButton, false);
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && payload.job) {
        state.job = payload.job;
        state.inspection = payload.inspection;
        dom.uploadProgress.hidden = true;
        dom.uploadPanel.hidden = true;
        dom.mappingPanel.hidden = false;
        dom.previewPanel.hidden = true;
        dom.processPanel.hidden = true;
        dom.resultPanel.hidden = true;
        renderMapping();
        dom.mappingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        loadHistory();
        return;
      }
      setUploadProgress(100, '上传失败');
      showError(dom.uploadError, payload.error || `上传失败 (${xhr.status})`);
      setBusy(dom.uploadButton, false);
    });
    xhr.addEventListener('error', () => {
      state.uploadXhr = null;
      setBusy(dom.uploadButton, false);
      setUploadProgress(100, '网络错误');
      showError(dom.uploadError, '网络错误，上传失败。');
    });
    xhr.send(form);
  }

  function suggestedIndex(field) {
    const inspection = state.inspection || {};
    const explicit = inspection.explicitMapping?.[field];
    if (Number.isInteger(Number(explicit)) && Number(explicit) > 0) return String(Number(explicit));
    const suggested = inspection.suggestedMapping?.[field];
    const index = suggested?.column_index;
    if (Number.isInteger(Number(index)) && Number(index) > 0) return String(Number(index));
    return '';
  }

  function headerOptions(select, selected) {
    select.replaceChildren();
    const blank = el('option', '', '未映射');
    blank.value = '';
    select.append(blank);
    const headers = state.inspection?.headers || [];
    headers.forEach((header, index) => {
      const option = el('option', '', `${columnLetter(index + 1)} · ${header || '（空列）'}`);
      option.value = String(index + 1);
      select.append(option);
    });
    select.value = selected || '';
  }

  function renderMapping() {
    const inspection = state.inspection || {};
    const job = state.job || {};
    dom.mappingJobStatus.textContent = statusLabel(job.status);
    dom.mappingJobStatus.className = `job-status ${job.status || ''}`;
    showError(dom.mappingError, '');

    const sheets = inspection.sheets || [];
    dom.sheetSelect.replaceChildren();
    sheets.forEach((sheet) => {
      const option = el('option', '', `${sheet.name}（${sheet.max_row} 行）`);
      option.value = sheet.name;
      dom.sheetSelect.append(option);
    });
    if (!sheets.length) {
      dom.sheetSelect.append(el('option', '', inspection.selectedSheet || job.sheetName || '默认工作表'));
    }
    dom.sheetSelect.value = inspection.selectedSheet || job.sheetName || sheets[0]?.name || '';
    dom.sheetSelect.disabled = !sheets.length;

    dom.headerRowInput.value = inspection.headerRow || job.headerRow || 1;
    dom.amountLayoutSelect.value = inspection.amountLayout?.layout || job.amountLayout || 'direction_amount';
    updatePositiveSideVisibility();

    clear(dom.headerCandidates);
    const candidates = inspection.headerCandidates || [];
    if (candidates.length) {
      dom.headerCandidates.append(el('span', 'label', '候选表头行：'));
      candidates.slice(0, 5).forEach((candidate) => {
        const button = el('button', 'candidate-chip', `第 ${candidate.row_number} 行 · ${Number(candidate.score || 0).toFixed(2)}`);
        button.type = 'button';
        button.title = (candidate.values || []).slice(0, 8).join(' · ');
        button.addEventListener('click', () => {
          dom.headerRowInput.value = candidate.row_number;
          inspectMapping({ headerRow: candidate.row_number });
        });
        dom.headerCandidates.append(button);
      });
    }

    clear(dom.mappingHints);
    if (inspection.mappingError) {
      const message = inspection.mappingError.message || inspection.mappingError || '自动识别失败，请手动选择字段。';
      const hint = el('div', 'hint error', message);
      dom.mappingHints.append(hint);
    }
    (inspection.warnings || []).forEach((warning) => {
      dom.mappingHints.append(el('div', 'hint warn', warning));
    });
    if (inspection.sheetCount > 1) {
      dom.mappingHints.append(el('div', 'hint', `工作簿包含 ${inspection.sheetCount} 个工作表；当前使用「${inspection.selectedSheet || job.sheetName}」。`));
    }
    if (inspection.dataRowCount !== undefined) {
      dom.mappingHints.append(el('div', 'hint', `当前表头下识别到 ${inspection.dataRowCount} 行数据。`));
    }

    clear(dom.mappingGrid);
    fieldList().forEach(([name, label]) => {
      const box = el('div', 'mapping-field');
      if (['date', 'voucher_id', 'account_code', 'account_name', 'amount'].includes(name)) box.classList.add('required');
      const top = el('div', 'field-top');
      top.append(el('label', '', label));
      top.append(el('span', 'field-tag', name));
      box.append(top);
      const select = el('select');
      select.dataset.field = name;
      select.dataset.mapping = '1';
      headerOptions(select, suggestedIndex(name));
      box.append(select);

      const ambiguous = inspection.ambiguous?.[name];
      const choices = inspection.ambiguousCandidates?.[name] || [];
      if (Array.isArray(ambiguous) && choices.length) {
        const row = el('div', 'candidate-row');
        row.append(el('span', 'field-tag', '候选：'));
        choices.forEach((choice) => {
          if (!choice || choice.column_index === undefined) return;
          const button = el('button', '', `${columnLetter(choice.column_index)} ${choice.header || ''}`.trim());
          button.type = 'button';
          button.addEventListener('click', () => {
            select.value = String(choice.column_index);
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
          row.append(button);
        });
        box.append(row);
      }
      dom.mappingGrid.append(box);
    });
    updatePositiveSideVisibility();
  }

  function applyFieldVisibility() {
    const layout = dom.amountLayoutSelect.value;
    const visible = layout === 'debit_credit'
      ? new Set(['date', 'voucher_id', 'account_code', 'account_name', 'description', 'currency', 'debit', 'credit', 'original_amount'])
      : new Set(['date', 'voucher_id', 'account_code', 'account_name', 'description', 'currency', 'direction', 'amount', 'original_amount']);
    dom.mappingGrid.querySelectorAll('.mapping-field').forEach((field) => {
      const select = field.querySelector('select[data-field]');
      if (!select) return;
      field.hidden = !visible.has(select.dataset.field);
    });
  }

  function updatePositiveSideVisibility() {
    const layout = dom.amountLayoutSelect.value;
    dom.positiveSideControl.hidden = layout !== 'direction_amount';
    applyFieldVisibility();
  }

  function collectMapping() {
    const mapping = {};
    dom.mappingGrid.querySelectorAll('select[data-field]').forEach((select) => {
      const field = select.closest('.mapping-field');
      if (field && field.hidden) return;
      if (!select.value) return;
      mapping[select.dataset.field] = Number(select.value);
    });
    return mapping;
  }

  function collectRequest() {
    return {
      sheetName: dom.sheetSelect.value,
      headerRow: Number(dom.headerRowInput.value),
      amountLayout: dom.amountLayoutSelect.value,
      positiveSide: dom.positiveSideSelect.value || undefined,
      mapping: collectMapping()
    };
  }

  async function inspectMapping(overrides = {}) {
    if (!state.job) return;
    dom.previewPanel.hidden = true;
    dom.startButton.disabled = true;
    showError(dom.mappingError, '');
    const request = { ...collectRequest(), ...overrides };
    if (request.headerRow === null || request.headerRow === undefined || request.headerRow === '') {
      delete request.headerRow;
    }
    setBusy(dom.redetectButton, true, '识别中…');
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.job.id)}/inspect`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      state.job = payload.job || state.job;
      state.inspection = payload.inspection || state.inspection;
      renderMapping();
      showToast('已重新识别工作表和字段。');
    } catch (error) {
      showError(dom.mappingError, error.message || '重新识别失败。');
    } finally {
      setBusy(dom.redetectButton, false);
    }
  }

  async function runPreview() {
    if (!state.job) return;
    showError(dom.mappingError, '');
    const request = collectRequest();
    if (!request.headerRow || request.headerRow < 1) {
      showError(dom.mappingError, '请填写正确的表头行号。');
      return;
    }
    setBusy(dom.previewButton, true, '校验中…');
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.job.id)}/preview`, {
        method: 'POST',
        body: JSON.stringify(request)
      });
      state.job = payload.job || state.job;
      state.preview = payload.preview;
      dom.previewPanel.hidden = false;
      renderPreview();
      dom.previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showError(dom.mappingError, error.message || '映射校验失败。');
    } finally {
      setBusy(dom.previewButton, false);
    }
  }

  function metricBox(label, value, note) {
    const box = el('div', 'metric');
    box.append(el('span', '', label));
    box.append(el('strong', '', value));
    if (note) box.append(el('small', '', note));
    return box;
  }

  function renderPreview() {
    const preview = state.preview || {};
    const summary = preview.cleaningSummary || {};
    dom.previewSubtitle.textContent = preview.canStart
      ? '当前映射可以开始分析；请先核对下面的清洗摘要。'
      : '当前映射无法生成有效凭证，请返回检查表头和字段。';
    dom.previewCanStart.textContent = preview.canStart ? '可以开始' : '需要修正';
    dom.previewCanStart.className = `profile-chip ${preview.canStart ? 'can-start' : 'can-not-start'}`;

    clear(dom.previewMetrics);
    [
      ['原始行', summary.rawRowCount ?? '—'],
      ['清洗后分录', summary.lineCount ?? '—'],
      ['凭证数', summary.voucherCount ?? '—'],
      ['问题数', summary.issueCount ?? '—'],
      ['完全平衡', summary.exactly_balanced_voucher_count ?? '—'],
      ['不平衡', summary.unbalanced_voucher_count ?? '—']
    ].forEach(([label, value]) => dom.previewMetrics.append(metricBox(label, value)));

    clear(dom.previewIssues);
    const issues = preview.issues || [];
    const warnings = preview.rowWarnings || [];
    if (issues.length || warnings.length || preview.issuesTotal > issues.length) {
      const block = el('div', 'preview-block');
      block.append(el('h3', '', `数据问题（${preview.issuesTotal ?? issues.length}）`));
      const body = el('div', 'block-body');
      const list = el('ul', 'issue-list');
      issues.slice(0, 80).forEach((issue) => {
        const bits = [issue.code, issue.message, issue.voucher_id ? `凭证 ${issue.voucher_id}` : '', issue.source_row ? `行 ${issue.source_row}` : ''];
        list.append(el('li', '', bits.filter(Boolean).join(' · ')));
      });
      warnings.slice(0, 30).forEach((warning) => {
        const bits = ['行警告', warning.code, warning.message, warning.source_row ? `行 ${warning.source_row}` : ''];
        list.append(el('li', '', bits.filter(Boolean).join(' · ')));
      });
      if (preview.issuesTotal > issues.length) {
        list.append(el('li', '', `仅展示前 ${issues.length} 条，共 ${preview.issuesTotal} 条。`));
      }
      if (!list.children.length) list.append(el('li', '', '没有阻断性问题。'));
      body.append(list);
      block.append(body);
      dom.previewIssues.append(block);
    }

    clear(dom.previewSamples);
    const samples = preview.sampleVouchers || [];
    if (samples.length) {
      const block = el('div', 'preview-block');
      block.append(el('h3', '', '样本凭证'));
      const body = el('div', 'block-body');
      samples.forEach((voucher) => {
        const item = el('div', 'sample-voucher');
        item.append(el('strong', '', voucher.voucher_id || '—'));
        item.append(el('small', '', `${voucher.date || '—'} · ${(voucher.lines || []).length} 行 · 借 ${formatAmount(voucher.total_debit)} / 贷 ${formatAmount(voucher.total_credit)}`));
        const lines = (voucher.lines || []).slice(0, 4).map((line) => {
          const account = [line.account_code, line.account_name].filter(Boolean).join(' ');
          return `${account} 借 ${formatAmount(line.debit)} 贷 ${formatAmount(line.credit)}${line.description ? ` · ${line.description}` : ''}`;
        });
        if (lines.length) item.append(el('p', '', lines.join('；')));
        body.append(item);
      });
      block.append(body);
      dom.previewSamples.append(block);
    }

    dom.startButton.disabled = !preview.canStart;
  }

  async function startAnalysis() {
    if (!state.job || dom.startButton.disabled) return;
    setBusy(dom.startButton, true, '提交中…');
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.job.id)}/start`, {
        method: 'POST',
        body: JSON.stringify(collectRequest())
      });
      state.job = payload.job || state.job;
      dom.mappingPanel.hidden = true;
      dom.previewPanel.hidden = true;
      showProcess();
      updateProcess(state.job);
      pollJob(state.job.id);
    } catch (error) {
      showError(dom.mappingError, error.message || '无法开始分析。');
      showToast(error.message || '无法开始分析。');
    } finally {
      setBusy(dom.startButton, false);
    }
  }

  function showProcess() {
    dom.uploadPanel.hidden = true;
    dom.mappingPanel.hidden = true;
    dom.previewPanel.hidden = true;
    dom.resultPanel.hidden = true;
    dom.processPanel.hidden = false;
    dom.processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateProcess(job) {
    const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
    dom.progressBar.style.width = `${progress}%`;
    dom.progressValue.textContent = `${progress}%`;
    dom.processMessage.textContent = job?.progressMessage || '正在分析…';
    dom.jobStatus.textContent = statusLabel(job?.status).toUpperCase();
    dom.jobStatus.className = `job-status ${job?.status || ''}`;
    dom.jobIdLabel.textContent = job?.id ? `任务 ${job.id.slice(0, 8)}…` : '';
    showError(dom.processError, job?.status === 'failed' ? (job.error || '分析失败。') : '');
    dom.processNote.textContent = job?.status === 'failed'
      ? '任务未完成；可在历史任务中删除后重新上传。'
      : '页面会自动刷新进度；关闭页面后任务仍会继续。';
  }

  function pollJob(jobId) {
    stopPolling();
    const tick = async () => {
      try {
        const payload = await api(`${API}/${encodeURIComponent(jobId)}`);
        const job = payload.job;
        state.job = job;
        updateProcess(job);
        if (job.status === 'completed') {
          stopPolling();
          await loadResult(job.id);
          return;
        }
        if (job.status === 'failed') {
          stopPolling();
          showToast('分析失败，请查看错误信息。');
          loadHistory();
          return;
        }
        state.pollTimer = setTimeout(tick, 1200);
      } catch (error) {
        if (error.status === 404) {
          stopPolling();
          showError(dom.processError, '任务不存在或已过期。');
          return;
        }
        showError(dom.processError, error.message || '获取进度失败，稍后重试。');
        state.pollTimer = setTimeout(tick, 2500);
      }
    };
    tick();
  }

  async function loadResult(jobId) {
    try {
      const result = await api(`${API}/${encodeURIComponent(jobId)}/result`);
      state.result = result;
      state.findingsByVoucher = new Map();
      (result.findings || []).forEach((finding) => {
        if (!state.findingsByVoucher.has(finding.voucher_key)) state.findingsByVoucher.set(finding.voucher_key, []);
        state.findingsByVoucher.get(finding.voucher_key).push(finding);
      });
      dom.processPanel.hidden = true;
      dom.resultPanel.hidden = false;
      dom.exportButton.hidden = false;
      dom.exportButton.href = `${API}/${encodeURIComponent(jobId)}/export`;
      state.tab = 'vouchers';
      state.page = 0;
      state.filters = {};
      renderResult();
      dom.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadHistory();
    } catch (error) {
      showError(dom.processError, `结果加载失败：${error.message || '请稍后重试。'}`);
      showToast('结果加载失败。');
    }
  }

  function voucherStatus(voucher) {
    if (voucher.exactly_balanced) return ['完全平衡', 'green'];
    if (voucher.is_within_tolerance) return ['容差内', 'amber'];
    return ['不平衡', 'red'];
  }

  function renderResult() {
    const result = state.result;
    if (!result) return;
    const cleaning = result.cleaning_summary || {};
    const voucherSummary = result.voucher_summary || {};
    const business = result.business_classification_summary || {};
    const anomaly = result.anomaly_summary || {};
    const contra = result.contra_summary || {};

    dom.resultSubtitle.textContent = `${result.input_metadata?.source_filename || '序时账'} · ${result.input_metadata?.sheet_name || ''} · ${formatDate(result.generated_at)}`;
    clear(dom.resultMetrics);
    [
      ['凭证', voucherSummary.voucher_count ?? cleaning.voucher_count ?? '—', `原始行 ${cleaning.raw_row_count ?? '—'}`],
      ['分录', cleaning.line_count ?? '—', `最大凭证 ${cleaning.largest_voucher_line_count ?? '—'} 行`],
      ['完全平衡', voucherSummary.exact_balanced_voucher_count ?? '—', `不平衡 ${voucherSummary.unbalanced_voucher_count ?? '—'}`],
      ['已分类', business.classified_count ?? '—', `其他 ${business.other_count ?? '—'}`],
      ['对方科目', contra.with_allocations_voucher_count ?? '—', `未分配 ${contra.unallocated_voucher_count ?? '—'}`],
      ['异常发现', anomaly.finding_count ?? '—', `复核率 ${formatPercent(anomaly.review_rate)}`]
    ].forEach(([label, value, note]) => dom.resultMetrics.append(metricBox(label, value, note)));

    clear(dom.resultWarnings);
    const warnings = result.warnings || [];
    dom.resultWarnings.hidden = !warnings.length;
    if (warnings.length) dom.resultWarnings.textContent = `分析提示：${warnings.join(' · ')}`;

    renderFilters();
    renderTable();
  }

  function makeFilter(label, options, value, onChange) {
    const wrap = el('label', '', label);
    const select = el('select');
    options.forEach(([optionValue, optionLabel]) => {
      const option = el('option', '', optionLabel);
      option.value = optionValue;
      select.append(option);
    });
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    wrap.append(select);
    return wrap;
  }

  function businessOptions() {
    const summary = state.result?.business_classification_summary || {};
    const counts = summary.business_counts || {};
    const labels = summary.business_labels || {};
    return [
      ['', '全部业务分类'],
      ...Object.keys(counts).filter((code) => counts[code] > 0).map((code) => [code, `${code} · ${labels[code] || code}（${counts[code]}）`])
    ];
  }

  function anomalyCodeOptions() {
    const counts = state.result?.anomaly_summary?.code_counts || {};
    return [['', '全部异常规则'], ...Object.keys(counts).filter((code) => counts[code] > 0).map((code) => [code, `${code}（${counts[code]}）`])];
  }

  function anomalySeverityOptions() {
    const counts = state.result?.anomaly_summary?.finding_severity_counts || {};
    return [['', '全部严重度'], ...Object.keys(counts).filter((key) => counts[key] > 0).map((key) => [key, `${key}（${counts[key]}）`])];
  }

  function renderFilters() {
    clear(dom.resultFilters);
    const tab = state.tab;
    if (tab === 'vouchers') {
      state.filters.vouchers = state.filters.vouchers || '';
      dom.resultFilters.append(makeFilter('平衡状态', [
        ['', '全部凭证'], ['unbalanced', '仅不平衡'], ['within', '仅容差内'], ['balanced', '仅完全平衡']
      ], state.filters.vouchers, (value) => { state.filters.vouchers = value; state.page = 0; renderTable(); }));
    } else if (tab === 'business') {
      state.filters.business = state.filters.business || '';
      state.filters.confidence = state.filters.confidence || '';
      dom.resultFilters.append(makeFilter('业务分类', businessOptions(), state.filters.business, (value) => { state.filters.business = value; state.page = 0; renderTable(); }));
      dom.resultFilters.append(makeFilter('置信度', [['', '全部置信度'], ['HIGH', 'HIGH'], ['MEDIUM', 'MEDIUM'], ['LOW', 'LOW']], state.filters.confidence, (value) => { state.filters.confidence = value; state.page = 0; renderTable(); }));
    } else if (tab === 'contra') {
      state.filters.contra = state.filters.contra || '';
      dom.resultFilters.append(makeFilter('分配状态', [
        ['', '全部分析凭证'], ['allocated', '有分配'], ['unallocated', '有未分配'], ['ambiguous', '多解/歧义'], ['limited', '复杂度限制']
      ], state.filters.contra, (value) => { state.filters.contra = value; state.page = 0; renderTable(); }));
    } else if (tab === 'anomaly') {
      state.filters.anomalyCode = state.filters.anomalyCode || '';
      state.filters.anomalySeverity = state.filters.anomalySeverity || '';
      dom.resultFilters.append(makeFilter('异常规则', anomalyCodeOptions(), state.filters.anomalyCode, (value) => { state.filters.anomalyCode = value; state.page = 0; renderTable(); }));
      dom.resultFilters.append(makeFilter('严重度', anomalySeverityOptions(), state.filters.anomalySeverity, (value) => { state.filters.anomalySeverity = value; state.page = 0; renderTable(); }));
    }
  }

  function currentRows() {
    const result = state.result;
    if (!result) return [];
    const vouchers = result.vouchers || [];
    if (state.tab === 'vouchers') {
      const filter = state.filters.vouchers;
      return vouchers.filter((voucher) => {
        if (filter === 'unbalanced') return !voucher.is_within_tolerance;
        if (filter === 'within') return !voucher.exactly_balanced && voucher.is_within_tolerance;
        if (filter === 'balanced') return voucher.exactly_balanced;
        return true;
      });
    }
    if (state.tab === 'business') {
      return vouchers.filter((voucher) => {
        const classification = voucher.business_classification;
        if (!classification) return false;
        if (state.filters.business && classification.business_code !== state.filters.business) return false;
        if (state.filters.confidence && classification.confidence_level !== state.filters.confidence) return false;
        return true;
      });
    }
    if (state.tab === 'contra') {
      return vouchers.filter((voucher) => {
        const contra = voucher.contra;
        if (!contra) return false;
        const filter = state.filters.contra;
        if (filter === 'allocated' && !(contra.allocations || []).length) return false;
        if (filter === 'unallocated' && !(contra.unallocated_debit || []).length && !(contra.unallocated_credit || []).length) return false;
        if (filter === 'ambiguous' && !contra.ambiguous) return false;
        if (filter === 'limited' && !contra.complexity_limited && !contra.solution_limit_reached) return false;
        return true;
      });
    }
    return (result.findings || []).filter((finding) => {
      if (state.filters.anomalyCode && finding.code !== state.filters.anomalyCode) return false;
      if (state.filters.anomalySeverity && finding.severity !== state.filters.anomalySeverity) return false;
      return true;
    });
  }

  function makeTable(headers) {
    const table = el('table');
    const thead = el('thead');
    const row = el('tr');
    headers.forEach(([label, className]) => {
      const cell = el('th', className || '', label);
      row.append(cell);
    });
    thead.append(row);
    const tbody = el('tbody');
    table.append(thead, tbody);
    return { table, tbody };
  }

  function td(content, className) {
    const cell = el('td', className || '');
    if (content instanceof Node) cell.append(content);
    else cell.textContent = content === undefined || content === null || content === '' ? '—' : String(content);
    return cell;
  }

  function classificationCell(voucher) {
    const classification = voucher.business_classification;
    if (!classification) return el('span', 'cell-muted', '未分类');
    return el('span', '', `${classification.business_code} · ${classification.business_label}`);
  }

  function renderTable() {
    const rows = currentRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page >= totalPages) state.page = totalPages - 1;
    const start = state.page * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);
    clear(dom.resultTableWrap);
    if (!rows.length) {
      dom.resultTableWrap.append(el('div', 'empty-state', '当前筛选条件下没有记录。'));
      clear(dom.resultPager);
      return;
    }

    if (state.tab === 'vouchers') {
      const { table, tbody } = makeTable([
        ['凭证号'], ['日期'], ['行数', 'cell-num'], ['借方合计', 'cell-num'], ['贷方合计', 'cell-num'],
        ['差额', 'cell-num'], ['状态'], ['业务分类']
      ]);
      pageRows.forEach((voucher) => {
        const row = el('tr', 'clickable');
        row.append(td(voucher.voucher_id, 'cell-strong cell-nowrap'));
        row.append(td(voucher.date, 'cell-nowrap'));
        row.append(td(voucher.line_count, 'cell-num'));
        row.append(td(formatAmount(voucher.total_debit), 'cell-num'));
        row.append(td(formatAmount(voucher.total_credit), 'cell-num'));
        row.append(td(formatAmount(voucher.imbalance), 'cell-num'));
        const [label, tone] = voucherStatus(voucher);
        row.append(td(badge(label, tone)));
        row.append(td(classificationCell(voucher), 'cell-wrap'));
        row.addEventListener('click', () => openDetail(voucher.voucher_key));
        tbody.append(row);
      });
      table.append(tbody);
      dom.resultTableWrap.append(table);
    } else if (state.tab === 'business') {
      const { table, tbody } = makeTable([
        ['凭证号'], ['日期'], ['业务分类'], ['编码'], ['置信度'], ['分数', 'cell-num'], ['理由']
      ]);
      pageRows.forEach((voucher) => {
        const classification = voucher.business_classification;
        const row = el('tr', 'clickable');
        row.append(td(voucher.voucher_id, 'cell-strong cell-nowrap'));
        row.append(td(voucher.date, 'cell-nowrap'));
        row.append(td(classification.business_label, 'cell-wrap'));
        row.append(td(classification.business_code, 'cell-nowrap'));
        row.append(td(badge(classification.confidence_level, classification.confidence_level === 'HIGH' ? 'green' : classification.confidence_level === 'LOW' ? 'amber' : 'blue')));
        row.append(td(classification.score, 'cell-num'));
        row.append(td(classification.reason, 'cell-wrap'));
        row.addEventListener('click', () => openDetail(voucher.voucher_key));
        tbody.append(row);
      });
      dom.resultTableWrap.append(table);
    } else if (state.tab === 'contra') {
      const { table, tbody } = makeTable([
        ['凭证号'], ['日期'], ['分配数', 'cell-num'], ['未分配', 'cell-num'], ['方法'], ['置信度', 'cell-num'], ['状态'], ['说明']
      ]);
      pageRows.forEach((voucher) => {
        const contra = voucher.contra;
        const unallocated = (contra.unallocated_debit || []).length + (contra.unallocated_credit || []).length;
        const row = el('tr', 'clickable');
        row.append(td(voucher.voucher_id, 'cell-strong cell-nowrap'));
        row.append(td(voucher.date, 'cell-nowrap'));
        row.append(td((contra.allocations || []).length, 'cell-num'));
        row.append(td(unallocated, 'cell-num'));
        row.append(td(contra.method, 'cell-nowrap'));
        row.append(td(contra.confidence ?? '—', 'cell-num'));
        const flags = [];
        if (contra.ambiguous) flags.push('歧义');
        if (contra.complexity_limited) flags.push('复杂度限制');
        if (contra.solution_limit_reached) flags.push('解数量上限');
        row.append(td(flags.length ? badge(flags.join(' / '), 'amber') : badge('正常', 'green')));
        row.append(td((contra.warnings || []).join('；'), 'cell-wrap'));
        row.addEventListener('click', () => openDetail(voucher.voucher_key));
        tbody.append(row);
      });
      dom.resultTableWrap.append(table);
    } else {
      const { table, tbody } = makeTable([
        ['凭证号'], ['日期'], ['规则'], ['严重度'], ['风险分', 'cell-num'], ['业务组'], ['原因']
      ]);
      pageRows.forEach((finding) => {
        const row = el('tr', 'clickable');
        row.append(td(finding.voucher_id, 'cell-strong cell-nowrap'));
        row.append(td(finding.date, 'cell-nowrap'));
        row.append(td(finding.code, 'cell-nowrap'));
        const tone = finding.severity === 'HIGH' ? 'red' : finding.severity === 'MEDIUM' ? 'amber' : 'blue';
        row.append(td(badge(finding.severity, tone)));
        row.append(td(finding.risk_score, 'cell-num'));
        row.append(td(finding.business_group, 'cell-nowrap'));
        row.append(td(finding.reason, 'cell-wrap'));
        row.addEventListener('click', () => openDetail(finding.voucher_key));
        tbody.append(row);
      });
      dom.resultTableWrap.append(table);
    }

    clear(dom.resultPager);
    const info = el('span', '', `第 ${state.page + 1} / ${totalPages} 页 · 共 ${rows.length} 条`);
    const actions = el('div', 'pager-actions');
    const prev = el('button', 'mini-button', '上一页');
    prev.type = 'button';
    prev.disabled = state.page <= 0;
    prev.addEventListener('click', () => { if (state.page > 0) { state.page -= 1; renderTable(); } });
    const next = el('button', 'mini-button', '下一页');
    next.type = 'button';
    next.disabled = state.page >= totalPages - 1;
    next.addEventListener('click', () => { if (state.page < totalPages - 1) { state.page += 1; renderTable(); } });
    actions.append(prev, next);
    dom.resultPager.append(info, actions);
  }

  function switchTab(tab) {
    if (!TAB_LABEL[tab]) return;
    state.tab = tab;
    state.page = 0;
    document.querySelectorAll('.result-tab').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderFilters();
    renderTable();
  }

  function detailSection(title) {
    const section = el('section', 'detail-section');
    section.append(el('h3', '', title));
    const body = el('div', 'detail-section-body');
    section.append(body);
    return { section, body };
  }

  function kvGrid(items) {
    const grid = el('div', 'detail-kv');
    items.forEach(([label, value]) => {
      const item = el('div');
      item.append(el('span', '', label));
      item.append(el('strong', '', value === undefined || value === null || value === '' ? '—' : String(value)));
      grid.append(item);
    });
    return grid;
  }

  function openDetail(voucherKey) {
    const voucher = state.result?.vouchers?.find((item) => item.voucher_key === voucherKey);
    if (!voucher) return;
    state.detailVoucher = voucher;
    dom.detailTitle.textContent = `凭证 ${voucher.voucher_id}`;
    dom.detailSubtitle.textContent = `${voucher.date || '日期未知'} · ${voucher.line_count} 行 · ${voucher.exactly_balanced ? '完全平衡' : voucher.is_within_tolerance ? '容差内' : '不平衡'}`;
    clear(dom.detailBody);

    const summary = detailSection('凭证摘要');
    summary.body.append(kvGrid([
      ['借方合计', formatAmount(voucher.total_debit)],
      ['贷方合计', formatAmount(voucher.total_credit)],
      ['差额', formatAmount(voucher.imbalance)],
      ['期间', voucher.period],
      ['主体', voucher.entity],
      ['校验标记', (voucher.validation_flags || []).join(' / ')]
    ]));
    dom.detailBody.append(summary.section);

    const lines = detailSection(`分录明细（${(voucher.lines || []).length}）`);
    const lineTable = el('table', 'detail-table');
    const head = el('thead');
    const headRow = el('tr');
    ['源行', '科目', '借方', '贷方', '摘要'].forEach((label) => headRow.append(el('th', '', label)));
    head.append(headRow);
    const body = el('tbody');
    (voucher.lines || []).forEach((line) => {
      const row = el('tr');
      row.append(el('td', '', line.source_row));
      row.append(el('td', '', [line.account_code, line.account_name].filter(Boolean).join(' ') || '—'));
      row.append(el('td', 'num', formatAmount(line.debit)));
      row.append(el('td', 'num', formatAmount(line.credit)));
      row.append(el('td', '', line.description || '—'));
      body.append(row);
    });
    lineTable.append(head, body);
    lines.body.append(lineTable);
    dom.detailBody.append(lines.section);

    const classification = voucher.business_classification;
    const business = detailSection('业务分类');
    if (classification) {
      business.body.append(kvGrid([
        ['分类', `${classification.business_code} · ${classification.business_label}`],
        ['分数', classification.score],
        ['置信度', `${classification.confidence_level}（${classification.confidence}）`],
        ['硬规则', classification.is_hard_rule ? '是' : '否'],
        ['理由', classification.reason]
      ]));
      if (classification.professional_interpretation) {
        business.body.append(el('p', 'evidence', classification.professional_interpretation));
      }
      const candidates = classification.candidates || [];
      if (candidates.length) {
        business.body.append(el('h3', '', '候选分类'));
        const list = el('div', 'candidate-list');
        candidates.slice(0, 6).forEach((candidate) => {
          const item = el('div', 'candidate-item');
          item.append(el('strong', '', `${candidate.code} · ${candidate.label}`));
          item.append(el('span', '', `score ${candidate.score}`));
          list.append(item);
        });
        business.body.append(list);
      }
    } else {
      business.body.append(el('p', 'empty-note', '该凭证没有业务分类结果。'));
    }
    dom.detailBody.append(business.section);

    const contra = voucher.contra;
    const contraSection = detailSection('对方科目');
    if (contra) {
      contraSection.body.append(kvGrid([
        ['方法', contra.method],
        ['置信度', contra.confidence ?? '—'],
        ['分配数', (contra.allocations || []).length],
        ['解数量', contra.solution_count],
        ['节点数', contra.node_count],
        ['状态', contra.ambiguous ? '歧义' : contra.complexity_limited ? '复杂度限制' : '正常']
      ]));
      const lineMap = new Map();
      (voucher.lines || []).forEach((line) => {
        lineMap.set(line.line_id, line);
        lineMap.set(line.internal_line_key, line);
      });
      const lineLabel = (lineId, fallback) => {
        const line = lineMap.get(lineId);
        if (!line) return fallback || lineId || '—';
        return [line.account_code, line.account_name].filter(Boolean).join(' ') || fallback || lineId;
      };
      const allocations = contra.allocations || [];
      if (allocations.length) {
        const table = el('table', 'detail-table');
        const head = el('thead');
        const headRow = el('tr');
        ['来源', '对方科目', '金额', '方法'].forEach((label) => headRow.append(el('th', '', label)));
        head.append(headRow);
        const body = el('tbody');
        allocations.slice(0, 80).forEach((allocation) => {
          const row = el('tr');
          row.append(el('td', '', lineLabel(allocation.source_line_id, allocation.source_internal_key)));
          row.append(el('td', '', lineLabel(allocation.target_line_id, allocation.target_internal_key)));
          row.append(el('td', 'num', formatAmount(allocation.amount)));
          row.append(el('td', '', allocation.method || '—'));
          body.append(row);
        });
        table.append(head, body);
        contraSection.body.append(table);
        if (allocations.length > 80) contraSection.body.append(el('p', 'empty-note', `仅展示前 80 条分配，共 ${allocations.length} 条。`));
      } else {
        contraSection.body.append(el('p', 'empty-note', '没有可展示的分配。'));
      }
      const unallocatedDebit = contra.unallocated_debit || [];
      const unallocatedCredit = contra.unallocated_credit || [];
      if (unallocatedDebit.length || unallocatedCredit.length) {
        contraSection.body.append(el('h3', '', '未分配金额'));
        const list = el('ul', 'detail-list');
        [...unallocatedDebit.map((item) => ['借方', item]), ...unallocatedCredit.map((item) => ['贷方', item])].forEach(([side, item]) => {
          list.append(el('li', 'warn', `${side} · ${item.account_name || item.node_id || '—'} · ${formatAmount(item.amount)}`));
        });
        contraSection.body.append(list);
      }
      if ((contra.warnings || []).length) {
        const list = el('ul', 'detail-list');
        contra.warnings.forEach((warning) => list.append(el('li', 'warn', warning)));
        contraSection.body.append(list);
      }
    } else {
      contraSection.body.append(el('p', 'empty-note', '该凭证没有对方科目分析结果。'));
    }
    dom.detailBody.append(contraSection.section);

    const anomalySection = detailSection('异常凭证');
    if (voucher.anomaly) {
      anomalySection.body.append(kvGrid([
        ['风险分', voucher.anomaly.risk_score],
        ['风险等级', voucher.anomaly.risk_level],
        ['业务组', voucher.anomaly.business_group],
        ['命中规则', (voucher.anomaly.finding_codes || []).join(' / ') || '—']
      ]));
      const components = voucher.anomaly.components || {};
      if (Object.keys(components).length) {
        const list = el('ul', 'detail-list');
        Object.entries(components).forEach(([key, value]) => {
          if (Number(value) > 0) list.append(el('li', '', `${key}：${value}`));
        });
        if (list.children.length) anomalySection.body.append(list);
      }
    }
    const findings = state.findingsByVoucher.get(voucher.voucher_key) || [];
    if (findings.length) {
      const list = el('ul', 'detail-list');
      findings.forEach((finding) => {
        const item = el('li', 'red');
        item.append(el('strong', '', `${finding.code} · ${finding.severity} · 风险分 ${finding.risk_score}`));
        item.append(el('div', '', finding.reason || ''));
        if (finding.evidence && Object.keys(finding.evidence).length) {
          const pre = el('pre', 'evidence', JSON.stringify(finding.evidence, null, 2));
          item.append(pre);
        }
        if (finding.professional_interpretation) item.append(el('div', '', finding.professional_interpretation));
        list.append(item);
      });
      anomalySection.body.append(list);
    } else if (!voucher.anomaly) {
      anomalySection.body.append(el('p', 'empty-note', '该凭证没有异常评分或发现。'));
    }
    dom.detailBody.append(anomalySection.section);

    dom.detailBackdrop.hidden = false;
    dom.detailDrawer.hidden = false;
    document.body.classList.add('drawer-open');
    dom.closeDetailButton.focus();
  }

  function closeDetail() {
    dom.detailBackdrop.hidden = true;
    dom.detailDrawer.hidden = true;
    document.body.classList.remove('drawer-open');
    state.detailVoucher = null;
  }

  function renderHistory(jobs) {
    clear(dom.historyList);
    if (!jobs.length) {
      dom.historyList.append(el('p', 'empty-note', '暂无历史任务。'));
      return;
    }
    jobs.forEach((job) => {
      const row = el('div', 'history-row');
      const main = el('div', 'history-main');
      main.append(el('strong', '', job.originalFilename || 'workbook.xlsx'));
      const summary = job.summary || {};
      const cleaning = summary.cleaning_summary || summary;
      const anomaly = summary.anomaly_summary || {};
      const bits = [formatDate(job.createdAt), statusLabel(job.status)];
      const voucherCount = cleaning.voucher_count ?? summary.voucher_count;
      const findingCount = anomaly.finding_count ?? summary.finding_count;
      if (voucherCount !== undefined) bits.push(`凭证 ${voucherCount}`);
      if (findingCount !== undefined) bits.push(`异常 ${findingCount}`);
      if (job.error) bits.push(job.error);
      main.append(el('small', '', bits.join(' · ')));
      row.append(main);

      const status = el('span', `badge ${statusTone(job.status)} history-status`, statusLabel(job.status));
      row.append(status);

      const actions = el('div', 'history-actions');
      if (job.status === 'completed') {
        const open = el('button', '', '打开结果');
        open.type = 'button';
        open.addEventListener('click', () => openHistoryJob(job.id));
        actions.append(open);
        if (job.hasExport) {
          const exportLink = el('a', 'mini-button', '导出');
          exportLink.href = `${API}/${encodeURIComponent(job.id)}/export`;
          actions.append(exportLink);
        }
      } else if (job.status === 'draft') {
        const resume = el('button', '', '继续映射');
        resume.type = 'button';
        resume.addEventListener('click', () => openHistoryJob(job.id));
        actions.append(resume);
      } else if (job.status === 'queued' || job.status === 'running') {
        const view = el('button', '', '查看进度');
        view.type = 'button';
        view.addEventListener('click', () => openHistoryJob(job.id));
        actions.append(view);
      } else {
        const view = el('button', '', '查看错误');
        view.type = 'button';
        view.addEventListener('click', () => openHistoryJob(job.id));
        actions.append(view);
      }
      if (job.status !== 'queued' && job.status !== 'running') {
        const remove = el('button', 'danger', '删除');
        remove.type = 'button';
        remove.addEventListener('click', () => deleteJob(job));
        actions.append(remove);
      }
      row.append(actions);
      dom.historyList.append(row);
    });
  }

  async function loadHistory() {
    try {
      const payload = await api(API);
      renderHistory(payload.jobs || []);
    } catch (error) {
      clear(dom.historyList);
      dom.historyList.append(el('p', 'empty-note', `历史任务加载失败：${error.message || '请稍后重试。'}`));
    }
  }

  async function openHistoryJob(jobId) {
    stopPolling();
    try {
      const payload = await api(`${API}/${encodeURIComponent(jobId)}`);
      const job = payload.job;
      state.job = job;
      if (job.status === 'completed') {
        showProcess();
        updateProcess(job);
        await loadResult(job.id);
        return;
      }
      if (job.status === 'queued' || job.status === 'running') {
        showProcess();
        updateProcess(job);
        pollJob(job.id);
        return;
      }
      if (job.status === 'draft') {
        dom.uploadPanel.hidden = true;
        dom.mappingPanel.hidden = false;
        dom.previewPanel.hidden = true;
        dom.processPanel.hidden = true;
        dom.resultPanel.hidden = true;
        dom.mappingJobStatus.textContent = statusLabel(job.status);
        setBusy(dom.redetectButton, true, '识别中…');
        try {
          const inspected = await api(`${API}/${encodeURIComponent(job.id)}/inspect`, {
            method: 'POST',
            body: JSON.stringify({ sheetName: job.sheetName || '', headerRow: job.headerRow || undefined, mapping: {} })
          });
          state.job = inspected.job || job;
          state.inspection = inspected.inspection;
          renderMapping();
          dom.mappingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } finally {
          setBusy(dom.redetectButton, false);
        }
        return;
      }
      if (job.status === 'failed') {
        showProcess();
        updateProcess(job);
        showToast('该任务已失败，可删除后重新上传。');
      }
    } catch (error) {
      showToast(error.message || '无法打开任务。');
    }
  }

  async function deleteJob(job) {
    if (!job || !job.id) return;
    if (!window.confirm(`删除任务「${job.originalFilename || 'workbook.xlsx'}」及其结果文件？`)) return;
    try {
      await api(`${API}/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      showToast('任务已删除。');
      if (state.job?.id === job.id) resetToUpload();
      await loadHistory();
    } catch (error) {
      showToast(error.message || '删除失败。');
    }
  }

  function resetToUpload() {
    stopPolling();
    resetState();
    clearFile();
    dom.uploadPanel.hidden = false;
    dom.mappingPanel.hidden = true;
    dom.previewPanel.hidden = true;
    dom.processPanel.hidden = true;
    dom.resultPanel.hidden = true;
    dom.uploadProgress.hidden = true;
    dom.exportButton.hidden = true;
    showError(dom.uploadError, '');
    showError(dom.mappingError, '');
    showError(dom.processError, '');
    closeDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindEvents() {
    dom.fileInput.addEventListener('change', () => setFile(dom.fileInput.files?.[0]));
    dom.clearFileButton.addEventListener('click', clearFile);
    dom.uploadButton.addEventListener('click', uploadSelected);

    ['dragenter', 'dragover'].forEach((name) => dom.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dom.dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((name) => dom.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dom.dropZone.classList.remove('dragover');
    }));
    dom.dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer?.files?.[0]));

    dom.sheetSelect.addEventListener('change', () => inspectMapping({ sheetName: dom.sheetSelect.value, headerRow: undefined }));
    dom.headerRowInput.addEventListener('change', () => inspectMapping({ headerRow: dom.headerRowInput.value }));
    dom.redetectButton.addEventListener('click', () => inspectMapping({ headerRow: dom.headerRowInput.value }));
    dom.amountLayoutSelect.addEventListener('change', () => {
      updatePositiveSideVisibility();
      dom.previewPanel.hidden = true;
    });
    dom.positiveSideSelect.addEventListener('change', () => { dom.previewPanel.hidden = true; });
    dom.mappingGrid.addEventListener('change', () => { dom.previewPanel.hidden = true; });
    dom.previewButton.addEventListener('click', runPreview);
    dom.startButton.addEventListener('click', startAnalysis);
    dom.newJobButton.addEventListener('click', resetToUpload);
    dom.refreshHistoryButton.addEventListener('click', loadHistory);
    dom.refreshResultButton.addEventListener('click', () => {
      if (state.job?.status === 'completed') loadResult(state.job.id);
      else if (state.job) pollJob(state.job.id);
    });

    document.querySelectorAll('.result-tab').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });

    dom.closeDetailButton.addEventListener('click', closeDetail);
    dom.detailBackdrop.addEventListener('click', closeDetail);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dom.detailDrawer.hidden) closeDetail();
    });
  }

  async function init() {
    bindEvents();
    try {
      state.meta = await api(`${API}/meta`);
    } catch (_) {
      state.meta = null;
    }
    loadHistory();
  }

  init();
})();

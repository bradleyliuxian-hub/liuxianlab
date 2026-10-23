'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const API = '/api/journal-entry-batches';
  const CHILD_API = '/api/journal-entry-analyses';
  const DEFAULT_LIMITS = { maxFiles: 20, maxFileSizeBytes: 25 * 1024 * 1024, maxTotalSizeBytes: 100 * 1024 * 1024 };
  const JOB_STATUS_LABEL = { draft: '待配置', queued: '排队中', running: '分析中', completed: '已完成', failed: '失败' };
  const BATCH_STATUS_LABEL = {
    draft: '待配置', queued: '已排队', running: '分析中',
    completed: '全部完成', partial_failed: '部分失败', failed: '全部失败'
  };

  const dom = {
    fileInput: $('#batchFileInput'), dropZone: $('#batchDropZone'), fileList: $('#batchFileList'),
    limits: $('#batchLimits'), uploadButton: $('#batchUploadButton'),
    uploadProgress: $('#batchUploadProgress'), uploadBar: $('#batchUploadBar'), uploadText: $('#batchUploadText'),
    uploadError: $('#batchError'), uploadPanel: $('#batchUploadPanel'),
    workspace: $('#batchWorkspacePanel'), title: $('#batchTitle'), subtitle: $('#batchSubtitle'),
    status: $('#batchStatus'), progressBar: $('#batchProgressBar'), progressValue: $('#batchProgressValue'),
    progressMeta: $('#batchProgressMeta'), metrics: $('#batchMetrics'), tableWrap: $('#batchTableWrap'),
    summaryMetrics: $('#batchSummaryMetrics'), summaryBasis: $('#batchSummaryBasis'),
    readyMeta: $('#batchReadyMeta'), notice: $('#batchNotice'),
    outputPanel: $('#batchOutputPanel'), outputMeta: $('#batchOutputMeta'),
    outputError: $('#batchOutputError'), generateOutputButton: $('#batchGenerateOutput'),
    downloadSummary: $('#downloadSummary'), downloadMerged: $('#downloadMerged'), downloadZip: $('#downloadZip'),
    startButton: $('#batchStartButton'), refreshButton: $('#batchRefreshButton'), error: $('#batchWorkspaceError'),
    splitLink: $('#batchSplitLink'),
    standardExportLink: $('#batchStandardExportLink'), deleteBatchButton: $('#deleteBatchButton'),
    deleteBatchOutput: $('#deleteBatchOutput'),
    historyList: $('#batchHistoryList'), refreshHistoryButton: $('#batchRefreshHistoryButton'),
    configBackdrop: $('#configBackdrop'), configModal: $('#configModal'), configFrame: $('#configFrame'),
    configTitle: $('#configTitle'), closeConfigButton: $('#closeConfigButton'),
    toast: $('#batchToast')
  };

  const state = {
    meta: null,
    files: [],
    batch: null,
    pollTimer: null,
    polling: false,
    configJobId: null,
    output: null,
    generatingOutput: false,
    toastTimer: null
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) { if (node) node.replaceChildren(); }

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2800);
  }

  function showError(node, message) {
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function formatBytes(value) {
    const size = Number(value || 0);
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
    const amount = size / (1024 ** index);
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function limits() {
    return { ...DEFAULT_LIMITS, ...(state.meta || {}) };
  }

  function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(path, { ...options, headers }).then(async (response) => {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('登录已过期。');
      }
      if (!response.ok) {
        const error = new Error(payload.error || payload.message || `请求失败 (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    });
  }

  function layoutLabel(layout) {
    if (!layout) return '—';
    const found = (state.meta?.amountLayouts || []).find((item) => item.value === layout);
    return found?.label || layout;
  }

  function jobStatusLabel(status) { return JOB_STATUS_LABEL[status] || status || '—'; }
  function batchStatusLabel(status) { return BATCH_STATUS_LABEL[status] || status || '—'; }
  function statusTone(status) {
    if (status === 'completed') return 'green';
    if (status === 'queued' || status === 'running') return 'blue';
    if (status === 'failed' || status === 'partial_failed') return 'red';
    return 'gray';
  }

  function badge(text, tone) { return el('span', `badge ${tone || 'gray'}`, text); }

  function addFiles(list) {
    const config = limits();
    const incoming = [...list];
    const errors = [];
    for (const file of incoming) {
      const name = String(file.name || '').toLowerCase();
      if (!name.endsWith('.xls') && !name.endsWith('.xlsx')) {
        errors.push(`${file.name}：仅支持 .xls / .xlsx。`);
        continue;
      }
      if (file.size > config.maxFileSizeBytes) {
        errors.push(`${file.name}：超过 ${formatBytes(config.maxFileSizeBytes)}。`);
        continue;
      }
      if (state.files.length >= config.maxFiles) {
        errors.push(`一次最多 ${config.maxFiles} 个文件。`);
        break;
      }
      const total = state.files.reduce((sum, item) => sum + item.size, 0) + file.size;
      if (total > config.maxTotalSizeBytes) {
        errors.push(`批量总大小不能超过 ${formatBytes(config.maxTotalSizeBytes)}。`);
        break;
      }
      state.files.push(file);
    }
    renderFiles();
    showError(dom.uploadError, errors.join('\n'));
  }

  function renderFiles() {
    clear(dom.fileList);
    state.files.forEach((file, index) => {
      const row = el('div', 'batch-file-row');
      const info = el('div', 'batch-file-name');
      info.append(el('strong', '', file.name));
      info.append(el('small', '', `${formatBytes(file.size)} · ${file.name.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'XLS'}`));
      row.append(info);
      row.append(el('span', 'field-tag', `#${index + 1}`));
      const remove = el('button', 'batch-file-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      remove.addEventListener('click', () => {
        state.files.splice(index, 1);
        renderFiles();
      });
      row.append(remove);
      dom.fileList.append(row);
    });
    dom.uploadButton.disabled = state.files.length === 0;
    dom.uploadButton.textContent = state.files.length
      ? `上传 ${state.files.length} 个文件并创建批量任务`
      : '上传并创建批量任务';
    const total = state.files.reduce((sum, file) => sum + file.size, 0);
    dom.limits.textContent = `最多 ${limits().maxFiles} 个文件，单个 ${formatBytes(limits().maxFileSizeBytes)}，总计 ${formatBytes(limits().maxTotalSizeBytes)}。当前 ${state.files.length} 个 / ${formatBytes(total)}。`;
  }

  function setUploadProgress(percent, text) {
    dom.uploadProgress.hidden = false;
    dom.uploadBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    dom.uploadText.textContent = text || '正在上传…';
  }

  function uploadFiles() {
    if (!state.files.length) return;
    const form = new FormData();
    state.files.forEach((file) => form.append('files', file, file.name));
    const xhr = new XMLHttpRequest();
    dom.uploadButton.disabled = true;
    showError(dom.uploadError, '');
    setUploadProgress(0, '正在上传…');
    xhr.open('POST', API);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress(Math.round((event.loaded / event.total) * 100), `正在上传… ${Math.round((event.loaded / event.total) * 100)}%`);
    });
    xhr.addEventListener('load', () => {
      dom.uploadButton.disabled = false;
      let payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && payload.batch) {
        state.files = [];
        renderFiles();
        dom.fileInput.value = '';
        dom.uploadProgress.hidden = true;
        state.batch = payload.batch;
        state.output = null;
        renderBatch();
        loadLatestOutput(payload.batch.id);
        loadHistory();
        showToast('批量任务已创建。');
        dom.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      dom.uploadProgress.hidden = true;
      const fileErrors = Array.isArray(payload.files) && payload.files.length
        ? `\n${payload.files.map((item) => `${item.filename || '文件'}：${item.error}`).join('\n')}`
        : '';
      showError(dom.uploadError, `${payload.error || `上传失败 (${xhr.status})`}${fileErrors}`);
    });
    xhr.addEventListener('error', () => {
      dom.uploadButton.disabled = false;
      dom.uploadProgress.hidden = true;
      showError(dom.uploadError, '网络错误，批量上传失败。');
    });
    xhr.send(form);
  }

  function metric(label, value, note, key) {
    const box = el('div', 'metric');
    if (key) box.dataset.metric = key;
    box.append(el('span', '', label));
    box.append(el('strong', '', value));
    if (note) box.append(el('small', '', note));
    return box;
  }

  function percent(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${(number * 100).toFixed(2)}%`;
  }

  function summaryValue(value) {
    return value === null || value === undefined ? '—' : value;
  }

  function renderSummary() {
    const summary = state.batch?.summary;
    clear(dom.summaryMetrics);
    if (!summary) {
      dom.summaryBasis.textContent = '尚无已完成文件。';
      return;
    }
    const available = summary.available || {};
    dom.summaryMetrics.append(
      metric('已完成文件', `${summary.completedFileCount} / ${summary.totalFileCount}`, '', 'completedFiles'),
      metric('有效分录', summaryValue(summary.lineCount), '', 'lineCount'),
      metric('凭证', summaryValue(summary.voucherCount), '', 'voucherCount'),
      metric('业务覆盖', percent(summary.businessCoverage), '', 'businessCoverage'),
      metric('异常发现', summaryValue(summary.findingCount), '', 'findingCount'),
      metric('异常凭证', summaryValue(summary.findingVoucherCount), '', 'findingVoucherCount'),
      metric('Review Rate', percent(summary.reviewRate), '', 'reviewRate')
    );
    const missing = Object.entries(available)
      .filter(([key, value]) => value === false && !['businessCoverage', 'reviewRate'].includes(key))
      .map(([key]) => key);
    const suffix = missing.length ? '；部分旧任务摘要字段不可用。' : '';
    dom.summaryBasis.textContent = `统计基于 ${summary.completedFileCount} / ${summary.totalFileCount} 个已完成文件${suffix}`;
  }

  function outputSnapshotText(snapshot) {
    if (!snapshot) return '';
    const excluded = Number(snapshot.excluded_files || 0);
    const draft = Number(snapshot.excluded_draft || 0);
    const active = Number(snapshot.excluded_active || 0);
    const failed = Number(snapshot.excluded_failed || 0);
    if (!excluded) return `本次导出包含 ${snapshot.included_files} 个已完成文件。`;
    const parts = [];
    if (draft) parts.push(`待配置 ${draft}`);
    if (active) parts.push(`分析中 ${active}`);
    if (failed) parts.push(`失败 ${failed}`);
    return `本次导出包含 ${snapshot.included_files} 个已完成文件；${excluded} 个未包含（${parts.join(' / ')}）。`;
  }

  function renderOutput() {
    if (!dom.outputPanel) return;
    const completed = Number(state.batch?.completedCount || 0);
    const output = state.output;
    if (output?.status === 'generating') {
      dom.outputPanel.hidden = false;
      Object.values({ summary: dom.downloadSummary, merged: dom.downloadMerged, zip: dom.downloadZip })
        .forEach((node) => { if (node) node.hidden = true; });
      if (dom.deleteBatchOutput) dom.deleteBatchOutput.hidden = true;
      dom.outputMeta.textContent = '正在生成批量输出…页面会自动刷新状态。';
      dom.generateOutputButton.disabled = true;
      dom.generateOutputButton.textContent = '正在生成…';
      setTimeout(() => {
        if (state.batch && state.output?.status === 'generating') loadLatestOutput(state.batch.id);
      }, 2000);
      return;
    }
    const links = {
      summary: dom.downloadSummary,
      merged: dom.downloadMerged,
      zip: dom.downloadZip
    };
    const canDownload = output?.status === 'completed' && output.downloads && !output.expired;
    Object.entries(links).forEach(([type, node]) => {
      if (!node) return;
      if (canDownload) {
        node.href = output.downloads[type];
        node.hidden = false;
      } else {
        node.hidden = true;
        node.removeAttribute('href');
      }
    });
    const generating = state.generatingOutput;
    dom.generateOutputButton.disabled = generating || completed === 0;
    dom.generateOutputButton.textContent = generating
      ? '正在生成…'
      : completed === 0
        ? '没有已完成文件可导出'
        : '生成/刷新批量输出';
    showError(dom.outputError, '');
    if (output?.status === 'failed') {
      showError(dom.outputError, output.error || '上次批量输出生成失败，请重新生成。');
    }
    if (dom.deleteBatchOutput) {
      dom.deleteBatchOutput.hidden = !output || output.status === 'generating' || output.expired;
    }
    if (canDownload) {
      let text = `${formatDate(output.completedAt)} · ${outputSnapshotText(output.snapshot)}`;
      if (Number(output.snapshot?.included_files || 0) < completed) {
        text += ' 当前已完成文件已变化，可刷新导出。';
      }
      dom.outputMeta.textContent = text;
    } else if (output?.expired) {
      dom.outputMeta.textContent = `${outputSnapshotText(output.snapshot)} 文件已过期，请重新生成。`;
    } else if (output?.status === 'failed') {
      dom.outputMeta.textContent = outputSnapshotText(output.snapshot) || '批量输出生成失败。';
    } else {
      dom.outputMeta.textContent = completed
        ? '尚未生成批量输出。生成后会包含当前所有已完成文件。'
        : '没有已完成文件可导出。';
    }
  }

  async function loadLatestOutput(batchId) {
    try {
      const payload = await api(`${API}/${encodeURIComponent(batchId)}/exports/latest`);
      state.output = payload.output || null;
    } catch (_) {
      state.output = null;
    }
    renderOutput();
  }

  async function generateOutput() {
    if (!state.batch || state.generatingOutput || !state.batch.completedCount) return;
    state.generatingOutput = true;
    renderOutput();
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.batch.id)}/exports`, {
        method: 'POST',
        body: '{}'
      });
      state.output = payload.output;
      renderOutput();
      showToast('批量输出已提交后台生成。');
    } catch (error) {
      showError(dom.outputError, error.message || '批量输出生成失败。');
      await loadLatestOutput(state.batch.id);
      showError(dom.outputError, error.message || '批量输出生成失败。');
    } finally {
      state.generatingOutput = false;
      renderOutput();
    }
  }

  function renderBatch() {
    const batch = state.batch;
    if (!batch) return;
    dom.workspace.hidden = false;
    dom.title.textContent = batch.name || '批量任务';
    dom.subtitle.textContent = `${formatDate(batch.createdAt)} · ${batch.totalCount} 个文件 · 逐文件独立结果`;
    dom.status.textContent = batchStatusLabel(batch.status);
    dom.status.className = `badge ${statusTone(batch.status)}`;
    if (dom.standardExportLink) {
      dom.standardExportLink.hidden = !batch.completedCount;
      if (batch.completedCount) {
        dom.standardExportLink.href = `standard-preview.html?scopeType=batch&scopeId=${encodeURIComponent(batch.id)}`;
      }
    }
    if (dom.splitLink) {
      dom.splitLink.hidden = !batch.completedCount;
      if (batch.completedCount) {
        const splitUrl = new URL('split.html', window.location.href);
        splitUrl.searchParams.set('scopeType', 'batch');
        splitUrl.searchParams.set('scopeId', batch.id);
        dom.splitLink.href = `${splitUrl.pathname}${splitUrl.search}`;
      }
    }
    if (dom.deleteBatchButton) {
      dom.deleteBatchButton.disabled = Boolean(batch.queuedCount || batch.runningCount);
    }
    dom.progressBar.style.width = `${batch.progress}%`;
    dom.progressValue.textContent = `${batch.progress}%`;
    dom.progressMeta.textContent = `${batch.completedCount + batch.failedCount}/${batch.totalCount} 已结束`;
    clear(dom.metrics);
    [
      ['文件', batch.totalCount],
      ['待配置', batch.draftCount],
      ['排队中', batch.queuedCount],
      ['分析中', batch.runningCount],
      ['已完成', batch.completedCount],
      ['失败', batch.failedCount]
    ].forEach(([label, value]) => dom.metrics.append(metric(label, value)));

    const drafts = batch.items.filter((item) => item.job.status === 'draft');
    const readyDrafts = drafts.filter((item) => item.job.configured);
    const pendingDrafts = drafts.length - readyDrafts.length;
    dom.readyMeta.textContent = drafts.length
      ? `${readyDrafts.length} 个可启动 · ${pendingDrafts} 个待配置`
      : '';
    if (drafts.length === 0) {
      dom.startButton.disabled = true;
      dom.startButton.textContent = '没有待开始文件';
    } else if (readyDrafts.length === 0) {
      dom.startButton.disabled = true;
      dom.startButton.textContent = '没有可启动文件';
    } else {
      dom.startButton.disabled = false;
      dom.startButton.textContent = `开始全部已就绪（${readyDrafts.length}）`;
    }
    renderSummary();
    renderOutput();
    renderTable();
  }

  function renderTable() {
    const batch = state.batch;
    clear(dom.tableWrap);
    const table = el('table', 'batch-table');
    const thead = el('thead');
    const headRow = el('tr');
    ['文件名', '大小', '类型', 'Sheet', '表头', '金额布局', '映射', '状态', '进度', '操作'].forEach((label) => headRow.append(el('th', '', label)));
    thead.append(headRow);
    const tbody = el('tbody');
    batch.items.forEach((item) => {
      const job = item.job;
      const row = el('tr');
      row.dataset.jobId = job.id;
      row.dataset.status = job.status;
      const fileCell = el('td', 'col-file');
      fileCell.append(el('strong', '', item.originalFilename));
      row.append(fileCell);
      row.append(el('td', 'cell-nowrap', formatBytes(item.fileSize)));
      row.append(el('td', 'cell-nowrap', (item.originalFilename.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'XLS')));
      row.append(el('td', 'cell-nowrap', job.sheetName || '—'));
      row.append(el('td', 'cell-nowrap', job.headerRow || '—'));
      row.append(el('td', 'cell-nowrap', layoutLabel(job.amountLayout)));
      row.append(el('td', 'cell-nowrap', job.configured ? '已配置' : (job.status === 'failed' ? '—' : '未配置')));
      const statusCell = el('td');
      statusCell.append(badge(jobStatusLabel(job.status), statusTone(job.status)));
      row.append(statusCell);
      const progressCell = el('td', 'batch-row-progress');
      const track = el('div', 'progress-track');
      const bar = el('span');
      bar.style.width = `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`;
      track.append(bar);
      progressCell.append(track, el('small', '', `${job.progress || 0}%`));
      row.append(progressCell);
      const actions = el('td', 'batch-actions');
      if (job.status === 'draft') {
        const config = el('button', '', '配置');
        config.type = 'button';
        config.dataset.action = 'configure';
        config.addEventListener('click', () => openConfig(item));
        actions.append(config);
      } else if (job.status === 'failed') {
        const view = el('a', '', '查看错误');
        view.href = `index.html?job=${encodeURIComponent(job.id)}`;
        view.target = '_blank';
        view.rel = 'noopener';
        actions.append(view);
      } else if (job.status === 'completed') {
        const open = el('a', '', '打开结果');
        open.href = `index.html?job=${encodeURIComponent(job.id)}`;
        open.target = '_blank';
        open.rel = 'noopener';
        actions.append(open);
        const exportLink = el('a', '', '导出');
        exportLink.href = `${CHILD_API}/${encodeURIComponent(job.id)}/export`;
        actions.append(exportLink);
      } else {
        const view = el('a', '', '查看进度');
        view.href = `index.html?job=${encodeURIComponent(job.id)}`;
        view.target = '_blank';
        view.rel = 'noopener';
        actions.append(view);
      }
      row.append(actions);
      tbody.append(row);
    });
    table.append(thead, tbody);
    dom.tableWrap.append(table);
  }

  function startPolling() {
    if (state.pollTimer || !state.batch) return;
    const tick = async () => {
      state.pollTimer = null;
      if (!state.batch || state.polling) return;
      state.polling = true;
      try {
        const payload = await api(`${API}/${encodeURIComponent(state.batch.id)}`);
        state.batch = payload.batch;
        renderBatch();
        if (!payload.batch.queuedCount && !payload.batch.runningCount) {
          loadHistory();
          return;
        }
      } catch (_) {
        // Keep the last successful batch view; retry once while active.
      } finally {
        state.polling = false;
      }
      if (state.batch && (state.batch.queuedCount || state.batch.runningCount)) {
        state.pollTimer = setTimeout(tick, 1500);
      }
    };
    state.pollTimer = setTimeout(tick, 800);
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  async function loadBatch(batchId) {
    try {
      const payload = await api(`${API}/${encodeURIComponent(batchId)}`);
      stopPolling();
      state.batch = payload.batch;
      state.output = null;
      dom.notice.hidden = true;
      renderBatch();
      await loadLatestOutput(payload.batch.id);
      if (payload.batch.queuedCount || payload.batch.runningCount) startPolling();
    } catch (error) {
      showToast(error.message || '无法打开批量任务。');
    }
  }

  async function startBatch() {
    if (!state.batch || dom.startButton.disabled) return;
    dom.startButton.disabled = true;
    showError(dom.error, '');
    dom.notice.hidden = true;
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.batch.id)}/start`, { method: 'POST', body: '{}' });
      state.batch = payload.batch;
      renderBatch();
      startPolling();
      if (payload.skippedCount) {
        const reasons = (payload.notReady || [])
          .map((item) => `${item.filename || '文件'}：${item.reason || '未就绪'}`)
          .join('；');
        dom.notice.textContent = `已启动 ${payload.startedCount} 个文件；${payload.skippedCount} 个仍待配置或未通过校验。${reasons ? ` ${reasons}` : ''}`;
        dom.notice.hidden = false;
      } else {
        showToast('批量任务已提交。');
      }
    } catch (error) {
      const reasons = Array.isArray(error.payload?.notReady) && error.payload.notReady.length
        ? `\n${error.payload.notReady.map((item) => `${item.filename || '文件'}：${item.reason || '未就绪'}`).join('\n')}`
        : '';
      showError(dom.error, `${error.message || '无法开始批量分析。'}${reasons}`);
      renderBatch();
    }
  }

  function openConfig(item) {
    state.configJobId = item.job.id;
    dom.configTitle.textContent = item.originalFilename;
    dom.configFrame.src = `index.html?job=${encodeURIComponent(item.job.id)}&embedded=1`;
    dom.configBackdrop.hidden = false;
    dom.configModal.hidden = false;
    document.body.classList.add('drawer-open');
  }

  function closeConfig() {
    dom.configBackdrop.hidden = true;
    dom.configModal.hidden = true;
    dom.configFrame.src = 'about:blank';
    state.configJobId = null;
    document.body.classList.remove('drawer-open');
    if (state.batch) loadBatch(state.batch.id);
  }

  async function deleteBatch() {
    if (!state.batch) return;
    if (!window.confirm('删除此批次及批次输出？\n\n将删除：批次记录、批量汇总/合并/ZIP、关联拆分输出。\n不会删除：独立的单文件分析结果。')) return;
    try {
      await api(`${API}/${encodeURIComponent(state.batch.id)}`, { method: 'DELETE' });
      state.batch = null;
      state.output = null;
      dom.workspace.hidden = true;
      dom.uploadPanel.hidden = false;
      showToast('批次已删除；单文件分析结果仍保留。');
      await loadHistory();
    } catch (error) {
      showError(dom.error, error.message || '删除批次失败。');
    }
  }

  async function deleteBatchOutput() {
    if (!state.batch || !state.output) return;
    if (!window.confirm('删除此批量输出文件？原分析任务不会删除。')) return;
    try {
      const payload = await api(`${API}/${encodeURIComponent(state.batch.id)}/exports/${encodeURIComponent(state.output.id)}`, { method: 'DELETE' });
      state.output = payload.output || null;
      renderOutput();
      showToast('批量输出已删除。');
    } catch (error) {
      showError(dom.outputError, error.message || '删除批量输出失败。');
    }
  }

  async function loadHistory() {
    try {
      const payload = await api(API);
      clear(dom.historyList);
      if (!payload.batches.length) {
        dom.historyList.append(el('p', 'empty-note', '暂无批量任务。'));
        return;
      }
      payload.batches.forEach((batch) => {
        const row = el('div', 'history-row batch-history-row');
        const main = el('div', 'history-main');
        main.append(el('strong', '', batch.name || '批量任务'));
        main.append(el('small', '', `${formatDate(batch.createdAt)} · ${batchStatusLabel(batch.status)} · ${batch.totalCount} 个文件（完成 ${batch.completedCount} / 失败 ${batch.failedCount}）`));
        row.append(main);
        row.append(el('span', `badge ${statusTone(batch.status)} history-status`, batchStatusLabel(batch.status)));
        const progress = el('span', 'batch-meta', `${batch.progress}%`);
        row.append(progress);
        row.addEventListener('click', () => {
          loadBatch(batch.id);
          dom.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        dom.historyList.append(row);
      });
    } catch (error) {
      clear(dom.historyList);
      dom.historyList.append(el('p', 'empty-note', `批量历史加载失败：${error.message || '请稍后重试。'}`));
    }
  }

  function bindEvents() {
    dom.fileInput.addEventListener('change', () => {
      addFiles(dom.fileInput.files || []);
      dom.fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach((name) => dom.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dom.dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((name) => dom.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dom.dropZone.classList.remove('dragover');
    }));
    dom.dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files || []));
    dom.uploadButton.addEventListener('click', uploadFiles);
    dom.startButton.addEventListener('click', startBatch);
    dom.generateOutputButton.addEventListener('click', generateOutput);
    dom.deleteBatchButton.addEventListener('click', deleteBatch);
    dom.deleteBatchOutput.addEventListener('click', deleteBatchOutput);
    dom.refreshButton.addEventListener('click', () => state.batch && loadBatch(state.batch.id));
    dom.refreshHistoryButton.addEventListener('click', loadHistory);
    dom.closeConfigButton.addEventListener('click', closeConfig);
    dom.configBackdrop.addEventListener('click', closeConfig);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dom.configModal.hidden) closeConfig();
    });
  }

  async function init() {
    bindEvents();
    try {
      state.meta = await api(`${API}/meta`);
    } catch (_) {
      state.meta = null;
    }
    renderFiles();
    loadHistory();
    const batchId = new URLSearchParams(window.location.search).get('batch');
    if (batchId) loadBatch(batchId);
  }

  init();
})();

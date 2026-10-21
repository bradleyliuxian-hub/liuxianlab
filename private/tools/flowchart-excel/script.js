(() => {
  'use strict';

  const COMING_SOON = true;
  const API = '/api/flowchart-excel';
  const TERMINAL = new Set(['external_helpers_ready', 'review_required', 'failed', 'cancelled']);
  const STATUS_LABEL = {
    uploaded: '已上传',
    validating_image: '校验图片',
    validating_package: '校验 ZIP',
    normalizing: '规范化',
    validating_graph: '校验结构',
    building_helpers: '生成辅助文件',
    external_helpers_ready: '已导入',
    review_required: '待人工复核',
    failed: '失败',
    cancelled: '已取消'
  };
  const $ = (id) => document.getElementById(id);
  const state = {
    image: null,
    packageFile: null,
    imageUrl: null,
    jobId: null,
    pollTimer: null,
    pollStartedAt: 0,
    busy: false
  };

  const els = {
    imageInput: $('imageInput'),
    packageInput: $('packageInput'),
    imageDrop: $('imageDrop'),
    packageDrop: $('packageDrop'),
    imageSelected: $('imageSelected'),
    packageSelected: $('packageSelected'),
    imageFileName: $('imageFileName'),
    imageFileMeta: $('imageFileMeta'),
    packageFileName: $('packageFileName'),
    packageFileMeta: $('packageFileMeta'),
    clearImageButton: $('clearImageButton'),
    clearPackageButton: $('clearPackageButton'),
    imagePreview: $('imagePreview'),
    previewImage: $('previewImage'),
    uploadButton: $('uploadButton'),
    uploadError: $('uploadError'),
    newJobButton: $('newJobButton'),
    refreshHistoryButton: $('refreshHistoryButton'),
    jobPanel: $('jobPanel'),
    jobSubtitle: $('jobSubtitle'),
    jobStatus: $('jobStatus'),
    jobIdLabel: $('jobIdLabel'),
    jobMode: $('jobMode'),
    unresolvedCount: $('unresolvedCount'),
    warningCount: $('warningCount'),
    exportReadyLabel: $('exportReadyLabel'),
    jobProgressBar: $('jobProgressBar'),
    jobProgressValue: $('jobProgressValue'),
    jobMessage: $('jobMessage'),
    reviewNotice: $('reviewNotice'),
    exportNotice: $('exportNotice'),
    reviewAction: $('reviewAction'),
    openReviewLink: $('openReviewLink'),
    artifactList: $('artifactList'),
    validationSummary: $('validationSummary'),
    jobError: $('jobError'),
    historyList: $('historyList'),
    historyEmpty: $('historyEmpty'),
    historyLoading: $('historyLoading'),
    historyError: $('historyError')
  };

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showError(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function clearJobError() {
    showError(els.jobError, '');
    showError(els.uploadError, '');
  }

  function clearPreview() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
    els.previewImage.removeAttribute('src');
    els.imagePreview.hidden = true;
  }

  function setSelectedFile(kind) {
    const image = kind === 'image' ? state.image : null;
    const packageFile = kind === 'package' ? state.packageFile : null;
    const selected = image || packageFile;
    const wrapper = image ? els.imageSelected : els.packageSelected;
    const name = image ? els.imageFileName : els.packageFileName;
    const meta = image ? els.imageFileMeta : els.packageFileMeta;
    if (!selected) {
      wrapper.hidden = true;
      name.textContent = '';
      meta.textContent = '';
      return;
    }
    wrapper.hidden = false;
    name.textContent = selected.name;
    meta.textContent = `${formatBytes(selected.size)} · ${image ? '原始流程图' : '外部 AI 辅助文件'}`;
  }

  function refreshUploadState() {
    els.uploadButton.disabled = state.busy || !state.image || !state.packageFile;
  }

  function setBusy(value) {
    state.busy = value;
    els.uploadButton.textContent = value ? '上传中…' : '上传并校验 →';
    refreshUploadState();
  }

  function validateImage(file) {
    if (!file) return '请选择原始流程图图片。';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      return '仅支持 PNG / JPG / JPEG / WebP 图片。';
    }
    if (file.size > 25 * 1024 * 1024) return '图片超过 25 MiB 限制。';
    return '';
  }

  function validatePackage(file) {
    if (!file) return '请选择外部 AI 辅助文件 ZIP。';
    if (!/\.zip$/i.test(file.name)) return '辅助文件必须是 .zip。';
    if (file.size > 15 * 1024 * 1024) return 'ZIP 超过 15 MiB 限制。';
    return '';
  }

  function chooseImage(file) {
    const error = validateImage(file);
    if (error) {
      showError(els.uploadError, error);
      return;
    }
    state.image = file;
    clearPreview();
    state.imageUrl = URL.createObjectURL(file);
    els.previewImage.src = state.imageUrl;
    els.imagePreview.hidden = false;
    setSelectedFile('image');
    clearJobError();
    refreshUploadState();
  }

  function choosePackage(file) {
    const error = validatePackage(file);
    if (error) {
      showError(els.uploadError, error);
      return;
    }
    state.packageFile = file;
    setSelectedFile('package');
    clearJobError();
    refreshUploadState();
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('请先登录。');
    }
    if (!response.ok) throw new Error(body.message || body.error || `请求失败（${response.status}）。`);
    return body;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    return parseResponse(response);
  }

  async function upload() {
    if (state.busy || !state.image || !state.packageFile) return;
    clearJobError();
    setBusy(true);
    try {
      const form = new FormData();
      form.append('image', state.image, state.image.name);
      form.append('package', state.packageFile, state.packageFile.name);
      form.append('generationMode', 'external_ai');
      const response = await fetch(`${API}/jobs/import-helper-package`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin'
      });
      const body = await parseResponse(response);
      state.jobId = body.job.id;
      showJob(body.job);
      startPolling();
      await loadHistory();
    } catch (error) {
      showError(els.uploadError, error.message || '上传失败。');
    } finally {
      setBusy(false);
    }
  }

  function statusTone(status) {
    if (status === 'failed' || status === 'cancelled') return 'failed';
    if (status === 'review_required' || status === 'review_in_progress') return 'review';
    if (status === 'review_approved') return 'ready';
    if (status === 'external_helpers_ready') return 'ready';
    return 'running';
  }

  function showJob(job) {
    els.jobPanel.hidden = false;
    els.jobIdLabel.textContent = job.id || '—';
    els.jobMode.textContent = job.workerMode || 'external_import';
    els.unresolvedCount.textContent = String(job.unresolvedCount ?? 0);
    els.warningCount.textContent = String(Array.isArray(job.warnings) ? job.warnings.length : 0);
    els.exportReadyLabel.textContent = job.exportReady ? '已开放' : '未开放';
    els.exportReadyLabel.classList.toggle('ok', job.exportReady === true);
    els.jobStatus.textContent = STATUS_LABEL[job.status] || job.status || '—';
    els.jobStatus.className = `job-status ${statusTone(job.status)}`;
    const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
    els.jobProgressBar.style.width = `${progress}%`;
    els.jobProgressValue.textContent = `${progress}%`;
    els.jobMessage.textContent = job.progressMessage || '—';
    els.jobSubtitle.textContent = job.originalFilename
      ? `${job.originalFilename} · ${job.templateProfileId || 'trade_purchase_cn'} · edit_as=${job.editAs || 'pending'}`
      : '外部 AI 辅助文件导入任务';
    const needsReview = job.status === 'review_required';
    els.reviewNotice.hidden = !needsReview;
    els.reviewNotice.classList.toggle('warn', needsReview);
    els.reviewNotice.textContent = needsReview
      ? `存在 ${job.unresolvedCount ?? 0} 个待确认项。下一步需要人工复核；Excel 导出仍未开放。`
      : '';
    els.exportNotice.textContent = 'Excel 导出尚未开放：edit_as 仍为 pending，exportReady=false。';
    const canReview = ['review_required', 'review_in_progress', 'review_approved'].includes(job.status);
    els.reviewAction.hidden = !canReview;
    if (canReview) {
      els.openReviewLink.href = `/app/tools/flowchart-excel/review.html?job=${encodeURIComponent(job.id)}`;
    }
    if (job.errorCode) showError(els.jobError, `任务失败：${job.errorCode}`);
    if (Array.isArray(job.artifacts)) renderArtifacts(job.id, job.artifacts);
    if (TERMINAL.has(job.status)) {
      stopPolling();
      loadArtifacts(job.id).catch(() => {});
    }
  }

  function renderArtifacts(jobId, artifacts) {
    els.artifactList.replaceChildren();
    const list = Array.isArray(artifacts) ? artifacts : [];
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '任务进入终态后会显示可下载文件。';
      els.artifactList.append(empty);
      return;
    }
    for (const artifact of list) {
      const row = document.createElement('div');
      row.className = 'artifact-item';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = 'FILE';
      const copy = document.createElement('div');
      copy.className = 'artifact-copy';
      const name = document.createElement('strong');
      name.textContent = artifact.name || artifact.id || 'artifact';
      const meta = document.createElement('small');
      meta.textContent = `${artifact.kind || 'artifact'} · ${formatBytes(artifact.bytes)} · ${artifact.isMock ? 'mock' : 'external import'}`;
      copy.append(name, meta);
      const link = document.createElement('a');
      link.href = `${API}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.id)}`;
      link.textContent = '下载 ↓';
      link.setAttribute('download', artifact.name || '');
      row.append(icon, copy, link);
      els.artifactList.append(row);
    }
  }

  async function loadArtifacts(jobId) {
    if (!jobId) return;
    const body = await fetchJson(`${API}/jobs/${encodeURIComponent(jobId)}/artifacts`);
    renderArtifacts(jobId, body.artifacts || []);
    const reportArtifact = (body.artifacts || []).find((artifact) => artifact.id === 'import-validation-report');
    if (reportArtifact) {
      const response = await fetch(`${API}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(reportArtifact.id)}`, {
        credentials: 'same-origin'
      });
      if (response.ok) renderValidationSummary(await response.json().catch(() => null));
    }
  }

  function renderValidationSummary(report) {
    if (!report) {
      els.validationSummary.hidden = true;
      return;
    }
    const counts = report.counts || {};
    const lines = [
      `外部 AI：${report.generationMode || 'external_ai'}`,
      `网站执行 AI：${report.aiExtractionPerformedByWebsite === true ? '是' : '否'}`,
      `Schema：${report.schemaValid ? '通过' : '未通过'}；引用校验：${report.referencesValid ? '通过' : '未通过'}`,
      `节点 ${counts.nodes ?? 0} · 连线 ${counts.edges ?? 0} · 泳道 ${counts.lanes ?? 0}`,
      `待确认 ${Array.isArray(report.unresolved) ? report.unresolved.length : 0} · 警告 ${Array.isArray(report.warnings) ? report.warnings.length : 0}`,
      `Excel 导出：${report.exportReady ? '已开放' : '未开放（edit_as=pending）'}`
    ];
    els.validationSummary.textContent = lines.join('\n');
    els.validationSummary.hidden = false;
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    state.pollStartedAt = Date.now();
    state.pollTimer = setInterval(async () => {
      if (!state.jobId) return;
      if (Date.now() - state.pollStartedAt > 5 * 60 * 1000) {
        stopPolling();
        showError(els.jobError, '任务轮询超时。请稍后刷新历史任务。');
        return;
      }
      try {
        const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}`);
        showJob(body.job);
      } catch (error) {
        showError(els.jobError, error.message || '无法读取任务状态。');
      }
    }, 1500);
  }

  async function loadJob(jobId) {
    clearJobError();
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(jobId)}`);
      state.jobId = jobId;
      showJob(body.job);
      if (!TERMINAL.has(body.job.status)) startPolling();
      els.jobPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showError(els.jobError, error.message || '无法读取任务。');
      els.jobPanel.hidden = false;
    }
  }

  async function loadHistory() {
    els.historyLoading.hidden = false;
    els.historyEmpty.hidden = true;
    showError(els.historyError, '');
    try {
      const body = await fetchJson(`${API}/jobs`);
      const jobs = Array.isArray(body.jobs) ? body.jobs : [];
      els.historyList.replaceChildren();
      if (!jobs.length) {
        els.historyEmpty.hidden = false;
        return;
      }
      for (const job of jobs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        const main = document.createElement('div');
        main.className = 'history-main';
        const title = document.createElement('strong');
        title.textContent = job.originalFilename || job.id;
        const meta = document.createElement('small');
        meta.textContent = `${job.id} · ${job.progress ?? 0}% · ${job.exportReady ? 'export ready' : 'export closed'}`;
        main.append(title, meta);
        const status = document.createElement('span');
        status.className = 'history-status';
        status.textContent = STATUS_LABEL[job.status] || job.status || '';
        button.append(main, status);
        button.addEventListener('click', () => loadJob(job.id));
        els.historyList.append(button);
      }
    } catch (error) {
      showError(els.historyError, error.message || '无法读取历史任务。');
    } finally {
      els.historyLoading.hidden = true;
    }
  }

  function resetFiles() {
    state.image = null;
    state.packageFile = null;
    state.jobId = null;
    clearPreview();
    els.imageInput.value = '';
    els.packageInput.value = '';
    els.imageSelected.hidden = true;
    els.packageSelected.hidden = true;
    els.imageFileName.textContent = '';
    els.imageFileMeta.textContent = '';
    els.packageFileName.textContent = '';
    els.packageFileMeta.textContent = '';
    els.jobPanel.hidden = true;
    els.reviewAction.hidden = true;
    els.artifactList.replaceChildren();
    els.validationSummary.hidden = true;
    clearJobError();
    stopPolling();
    refreshUploadState();
  }

  function bindFileInput(input, dropZone, choose) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) choose(file);
    });
    for (const type of ['dragenter', 'dragover']) {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
      });
    }
    dropZone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) choose(file);
    });
  }

  bindFileInput(els.imageInput, els.imageDrop, chooseImage);
  bindFileInput(els.packageInput, els.packageDrop, choosePackage);
  els.clearImageButton.addEventListener('click', () => {
    state.image = null;
    clearPreview();
    els.imageInput.value = '';
    els.imageSelected.hidden = true;
    refreshUploadState();
  });
  els.clearPackageButton.addEventListener('click', () => {
    state.packageFile = null;
    els.packageInput.value = '';
    els.packageSelected.hidden = true;
    refreshUploadState();
  });
  els.uploadButton.addEventListener('click', upload);
  els.newJobButton.addEventListener('click', resetFiles);
  els.refreshHistoryButton.addEventListener('click', loadHistory);
  window.addEventListener('beforeunload', () => {
    stopPolling();
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  });

  if (COMING_SOON) {
    els.uploadButton.disabled = true;
    els.uploadButton.textContent = 'Coming Soon';
    els.newJobButton.hidden = true;
    els.newJobButton.disabled = true;
    els.refreshHistoryButton.disabled = true;
    return;
  }

  refreshUploadState();
  loadHistory();
})();

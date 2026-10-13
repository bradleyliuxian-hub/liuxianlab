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
  const reviewPanel = $('#reviewPanel');
  const progressBar = $('#progressBar');
  const progressValue = $('#progressValue');
  const processMessage = $('#processMessage');
  const jobStatus = $('#jobStatus');
  const jobIdLabel = $('#jobIdLabel');
  const countRow = $('#countRow');
  const itemCount = $('#itemCount');
  const errorBox = $('#errorBox');
  const downloadReviewButton = $('#downloadReviewButton');
  const summarySubtitle = $('#summarySubtitle');
  const summaryMetrics = $('#summaryMetrics');
  const authorBlock = $('#authorBlock');
  const authorList = $('#authorList');
  const toast = $('#toast');

  const STORAGE_KEY = 'liuxianlab-last-excel-review-job';
  const TERMINAL = ['review_ready', 'completed', 'failed'];

  const state = {
    file: null,
    jobId: null,
    pollTimer: null
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__excelReviewToast);
    window.__excelReviewToast = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const size = value / (1024 ** index);
    return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
  }

  function isXlsx(file) {
    return file && file.name.toLowerCase().endsWith('.xlsx');
  }

  function setFile(file) {
    if (!file) return clearFile();
    if (!isXlsx(file)) {
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
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer.files?.[0]));

  function upload(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.open('POST', url);
      xhr.setRequestHeader('Accept', 'application/json');
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (!event.lengthComputable) return;
          onProgress(Math.round((event.loaded / event.total) * 100));
        });
      }
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

  function renderCounts(job) {
    const hasCount = job.itemCount !== null && job.itemCount !== undefined;
    countRow.hidden = !hasCount;
    if (hasCount) itemCount.textContent = String(job.itemCount);
  }

  function renderSummary(job) {
    const stats = job.stats;
    if (!stats) {
      summarySubtitle.textContent = '分析结果';
      summaryMetrics.replaceChildren();
      authorBlock.hidden = true;
      return;
    }
    summarySubtitle.textContent = `共发现 ${stats.questions_total} 个问题`;
    const metrics = [
      ['Microsoft 365 新版批注', stats.threaded_questions],
      ['传统批注 / Note', stats.legacy_questions],
      ['问题提出人', stats.authors_total]
    ];
    summaryMetrics.replaceChildren();
    metrics.forEach(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'metric';
      const name = document.createElement('span');
      name.textContent = label;
      const count = document.createElement('strong');
      count.textContent = String(value);
      box.append(name, count);
      summaryMetrics.append(box);
    });

    authorList.replaceChildren();
    const authors = stats.authors || [];
    authors.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'author-row';
      const name = document.createElement('span');
      name.textContent = entry.author;
      const count = document.createElement('strong');
      count.textContent = String(entry.questions);
      row.append(name, count);
      authorList.append(row);
    });
    authorBlock.hidden = authors.length === 0;
  }

  function renderJob(job) {
    state.jobId = job.id;
    setProgress(job.progress, job.progressMessage, job.status);
    jobIdLabel.textContent = job.id || '';
    renderCounts(job);

    if (job.status === 'review_ready' || job.status === 'completed') {
      reviewPanel.hidden = false;
      downloadReviewButton.href = `/api/excel-reviews/${encodeURIComponent(job.id)}/review-file`;
      renderSummary(job);
    } else {
      reviewPanel.hidden = true;
    }

    if (job.status === 'failed') {
      stopPolling();
      startButton.disabled = false;
      showJobError(job.error || '处理失败。');
    }

    if (TERMINAL.includes(job.status)) stopPolling();
  }

  function showJobError(message) {
    errorBox.textContent = message || '处理失败。';
    errorBox.hidden = false;
    setProgress(100, '任务失败', 'FAILED');
  }

  function fetchJob() {
    return fetch(`/api/excel-reviews/${encodeURIComponent(state.jobId)}`, {
      headers: { Accept: 'application/json' }
    }).then((response) => {
      if (response.status === 401) {
        window.location.replace('/login');
        throw new Error('未登录');
      }
      return response.json().then((payload) => {
        if (!response.ok || !payload.ok) throw new Error(payload.message || '无法读取任务状态。');
        renderJob(payload.job);
        return payload.job;
      });
    });
  }

  function startPolling() {
    stopPolling();
    fetchJob().catch((error) => showJobError(error.message));
    state.pollTimer = setInterval(() => {
      fetchJob().catch((error) => showJobError(error.message));
    }, 1200);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function startJob() {
    if (!state.file) return;
    startButton.disabled = true;
    errorBox.hidden = true;
    reviewPanel.hidden = true;
    countRow.hidden = true;
    processPanel.hidden = false;
    processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setProgress(1, '正在上传文件…', 'UPLOADING');
    try {
      const payload = await upload('/api/excel-reviews', state.file, (percent) => {
        setProgress(Math.max(1, Math.round(percent * 0.1)), '正在上传文件…', 'UPLOADING');
      });
      state.jobId = payload.job.id;
      localStorage.setItem(STORAGE_KEY, state.jobId);
      jobIdLabel.textContent = state.jobId;
      renderJob(payload.job);
      startPolling();
    } catch (error) {
      startButton.disabled = false;
      showJobError(error.message);
    }
  }

  function resetView() {
    stopPolling();
    state.jobId = null;
    localStorage.removeItem(STORAGE_KEY);
    clearFile();
    processPanel.hidden = true;
    reviewPanel.hidden = true;
    errorBox.hidden = true;
    countRow.hidden = true;
    summaryMetrics.replaceChildren();
    authorBlock.hidden = true;
    setProgress(0, '正在准备任务…', 'QUEUED');
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function tryResume() {
    const jobId = localStorage.getItem(STORAGE_KEY);
    if (!jobId) return;
    try {
      const response = await fetch(`/api/excel-reviews/${encodeURIComponent(jobId)}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const payload = await response.json();
      if (!payload.ok) return;
      processPanel.hidden = false;
      renderJob(payload.job);
      if (!TERMINAL.includes(payload.job.status)) startPolling();
    } catch (_) {}
  }

  startButton.addEventListener('click', startJob);
  newJobButton.addEventListener('click', resetView);

  window.ExcelReviewPage = {
    refreshHistory: () => {
      if (window.ExcelReviewHistory && typeof window.ExcelReviewHistory.refresh === 'function') {
        window.ExcelReviewHistory.refresh();
      }
    }
  };

  tryResume();
})();

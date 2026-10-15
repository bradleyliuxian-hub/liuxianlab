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
  const batchList = $('#batchList');
  const errorBox = $('#errorBox');
  const summarySubtitle = $('#summarySubtitle');
  const summaryMetrics = $('#summaryMetrics');
  const authorBlock = $('#authorBlock');
  const authorList = $('#authorList');
  const createControlLogButton = $('#createControlLogButton');
  const toast = $('#toast');

  const BATCH_KEY = 'liuxianlab-excel-review-batch';
  const TERMINAL = ['review_ready', 'completed', 'failed'];
  const DONE = ['review_ready', 'completed'];

  const STATUS_LABEL = {
    uploading: '上传中',
    queued: '排队中',
    processing: '提取中',
    review_ready: '已完成',
    completed: '已完成',
    failed: '失败'
  };

  const state = {
    files: [],
    jobs: [],
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

  function isArchive(file) {
    return file && file.name.toLowerCase().endsWith('.zip');
  }

  function isAccepted(file) {
    return isXlsx(file) || isArchive(file);
  }

  function setFiles(list) {
    const incoming = [...(list || [])];
    if (!incoming.length) return clearFiles();
    const rejected = incoming.filter((file) => !isAccepted(file));
    if (rejected.length) showToast('已忽略非 .xlsx / .zip 文件。');
    const accepted = incoming.filter(isAccepted);
    if (!accepted.length) return clearFiles();
    state.files = accepted;
    renderSelectedFiles();
    startButton.disabled = false;
    reviewPanel.hidden = true;
    batchList.replaceChildren();
    errorBox.hidden = true;
  }

  function renderSelectedFiles() {
    const files = state.files;
    selectedFile.hidden = files.length === 0;
    if (!files.length) return;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length === 1) {
      fileName.textContent = files[0].name;
      fileMeta.textContent = `${formatBytes(files[0].size)} · ${isArchive(files[0]) ? 'ZIP 压缩包（将解压为多个任务）' : 'XLSX 工作簿'}`;
    } else {
      fileName.textContent = `${files.length} 个文件`;
      fileMeta.textContent = `${files.map((file) => file.name).join('、').slice(0, 80)} · 共 ${formatBytes(total)}`;
    }
  }

  function clearFiles() {
    state.files = [];
    fileInput.value = '';
    selectedFile.hidden = true;
    startButton.disabled = true;
  }

  fileInput.addEventListener('change', () => setFiles(fileInput.files));
  clearFileButton.addEventListener('click', clearFiles);
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (event) => setFiles(event.dataTransfer?.files));

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
        const error = new Error(payload.message || `上传失败 (${xhr.status})`);
        if (payload.code) error.code = payload.code;
        reject(error);
      });
      xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败。')));
      xhr.send(form);
    });
  }

  const ERROR_MESSAGES = {
    INVALID_XLSX: '文件不是有效的 .xlsx 工作簿。',
    INVALID_ARCHIVE: '压缩包无效或无法解压。',
    EMPTY_ARCHIVE: '压缩包内没有 .xlsx 文件。',
    NO_VALID_XLSX: '压缩包内没有可处理的 .xlsx 文件。',
    UPLOAD_TOO_LARGE: '文件过大（xlsx ≤ 20MB，zip ≤ 50MB）。',
    INVALID_FILE_TYPE: '文件类型不支持（仅支持 .xlsx / .zip）。',
    UPLOAD_REJECTED: '文件上传被拒绝。',
    NO_FILE: '请选择文件。',
    UNAUTHENTICATED: '登录已失效，请重新登录。',
    DB_UNAVAILABLE: '数据库暂时不可用，请稍后重试。',
    JOB_CREATE_FAILED: '无法创建任务，请稍后重试。',
    STORAGE_WRITE_FAILED: '服务器无法保存文件。',
    WORKER_ENQUEUE_FAILED: '任务队列启动失败。'
  };

  function errorMessage(error) {
    if (!error) return '处理失败。';
    return ERROR_MESSAGES[error.code] || error.message || '处理失败。';
  }

  function setProgress(progress, message, status) {
    const safe = Math.max(0, Math.min(100, Number(progress || 0)));
    progressBar.style.width = `${safe}%`;
    progressValue.textContent = `${safe}%`;
    if (message) processMessage.textContent = message;
    if (status) jobStatus.textContent = String(status).toUpperCase();
  }

  function doneCount() {
    return state.jobs.filter((job) => DONE.includes(job.status)).length;
  }

  function renderBatch() {
    batchList.replaceChildren();
    state.jobs.forEach((job) => {
      const row = document.createElement('div');
      row.className = 'batch-row';
      const name = document.createElement('span');
      name.className = 'batch-name';
      name.textContent = job.filename;
      const meta = document.createElement('span');
      meta.className = 'batch-meta';
      const bits = [STATUS_LABEL[job.status] || job.status];
      if (job.status === 'processing' && job.progress) bits[0] += ` ${job.progress}%`;
      if (job.itemCount !== null && job.itemCount !== undefined) bits.push(`问题 ${job.itemCount} 个`);
      if (job.status === 'failed' && job.error) bits.push(job.error);
      meta.textContent = bits.join(' · ');
      row.append(name, meta);
      if (DONE.includes(job.status) && job.hasReview && job.id) {
        const link = document.createElement('a');
        link.className = 'erh-action';
        link.href = `/api/excel-reviews/${encodeURIComponent(job.id)}/review-file`;
        link.textContent = '下载 Review';
        row.append(link);
      }
      batchList.append(row);
    });

    const completed = doneCount();
    const total = state.jobs.length;
    const questions = state.jobs.reduce((sum, job) => sum + (Number(job.itemCount) || 0), 0);
    if (total) setProgress(Math.round((completed / total) * 100), `${completed} / ${total} 个文件已完成`, undefined);

    renderSummary(completed, total, questions);
  }

  function aggregateAuthors() {
    const counts = new Map();
    state.jobs.forEach((job) => {
      const authors = (job.stats && job.stats.authors) || [];
      authors.forEach((entry) => counts.set(entry.author, (counts.get(entry.author) || 0) + entry.questions));
    });
    return [...counts.entries()].map(([author, questions]) => ({ author, questions }))
      .sort((a, b) => b.questions - a.questions || (a.author < b.author ? -1 : 1));
  }

  function renderSummary(completed, total, questions) {
    const threaded = state.jobs.reduce((sum, job) => sum + (job.stats ? job.stats.threaded_questions : 0), 0);
    const legacy = state.jobs.reduce((sum, job) => sum + (job.stats ? job.stats.legacy_questions : 0), 0);
    const metrics = [
      ['文件', total],
      ['已完成', completed],
      ['问题总数', questions],
      ['Microsoft 365 新版批注', threaded],
      ['传统批注 / Note', legacy]
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
    summarySubtitle.textContent = completed
      ? `已完成 ${completed} / ${total} 个文件，共发现 ${questions} 个问题`
      : '正在提取批注…';

    const authors = aggregateAuthors();
    authorList.replaceChildren();
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

    createControlLogButton.hidden = completed === 0;
    createControlLogButton.textContent = completed > 1
      ? `基于 ${completed} 个已完成文件创建 Control Log →`
      : '创建 Control Log →';
  }

  function jobEntry(job) {
    return {
      id: job.id,
      filename: job.originalFilename || job.filename || 'workbook.xlsx',
      size: job.size || 0,
      status: job.status,
      progress: job.progress || 0,
      itemCount: job.itemCount === undefined ? null : job.itemCount,
      error: job.error || '',
      hasReview: Boolean(job.hasReview),
      stats: job.stats || null
    };
  }

  function jobIdOf(job) { return job.id; }

  async function startBatch() {
    if (!state.files.length) return;
    startButton.disabled = true;
    errorBox.hidden = true;
    reviewPanel.hidden = true;
    batchList.replaceChildren();
    processPanel.hidden = false;
    processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setProgress(0, '正在上传文件…', 'UPLOADING');

    state.jobs = [];
    renderBatch();

    for (const file of state.files) {
      if (isArchive(file)) {
        // One .zip -> one job per contained .xlsx (server expands safely).
        try {
          const payload = await upload('/api/excel-reviews/archive', file, (percent) => {
            processMessage.textContent = `正在上传压缩包 ${file.name}… ${percent}%`;
          });
          (payload.jobs || []).forEach((job) => state.jobs.push(jobEntry(job)));
          if (payload.skipped && payload.skipped.length) {
            showToast(`${file.name}：已跳过 ${payload.skipped.length} 个无法处理的成员。`);
          }
        } catch (error) {
          state.jobs.push({
            id: null, filename: `${file.name}（压缩包）`, size: file.size, status: 'failed',
            progress: 0, itemCount: null, error: errorMessage(error), hasReview: false, stats: null
          });
        }
      } else {
        const placeholder = {
          id: null, filename: file.name, size: file.size, status: 'uploading',
          progress: 0, itemCount: null, error: '', hasReview: false, stats: null
        };
        state.jobs.push(placeholder);
        renderBatch();
        try {
          const payload = await upload('/api/excel-reviews', file, (percent) => {
            placeholder.progress = percent;
            renderBatch();
          });
          Object.assign(placeholder, jobEntry(payload.job));
        } catch (error) {
          Object.assign(placeholder, { status: 'failed', error: errorMessage(error) });
        }
      }
      renderBatch();
    }
    startPolling();
  }

  function fetchJob(job) {
    return fetch(`/api/excel-reviews/${encodeURIComponent(job.id)}`, {
      headers: { Accept: 'application/json' }
    }).then((response) => {
      if (response.status === 401) { window.location.replace('/login'); throw new Error('未登录'); }
      return response.json().then((payload) => {
        if (!response.ok || !payload.ok) throw new Error(payload.message || '无法读取任务状态。');
        return payload.job;
      });
    });
  }

  async function pollOnce() {
    const pending = state.jobs.filter((job) => job.id && !TERMINAL.includes(job.status));
    await Promise.all(pending.map(async (job) => {
      try {
        const fresh = await fetchJob(job);
        Object.assign(job, {
          status: fresh.status, progress: fresh.progress, itemCount: fresh.itemCount,
          hasReview: fresh.hasReview, error: fresh.error || '', stats: fresh.stats || job.stats
        });
      } catch (error) {
        job.error = error.message;
      }
    }));
    renderBatch();
    renderResults();
    if (!state.jobs.some((job) => job.id && !TERMINAL.includes(job.status))) stopPolling();
  }

  function renderResults() {
    if (doneCount() > 0) reviewPanel.hidden = false;
    localStorage.setItem(BATCH_KEY, JSON.stringify(state.jobs.map(jobIdOf).filter(Boolean)));
  }

  function startPolling() {
    stopPolling();
    pollOnce().catch(() => {});
    state.pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, 1200);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function createControlLog() {
    const jobIds = state.jobs.filter((job) => job.id && DONE.includes(job.status)).map(jobIdOf);
    if (!jobIds.length) return;
    createControlLogButton.disabled = true;
    const original = createControlLogButton.textContent;
    createControlLogButton.textContent = '正在生成 Control Log…';
    try {
      const response = await fetch('/api/excel-review-control-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jobIds })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || '生成失败。');
      showToast(`已创建 Control Log：${payload.controlLog.name}`);
      if (window.ExcelReviewHistory && typeof window.ExcelReviewHistory.refreshControlLogs === 'function') {
        window.ExcelReviewHistory.refreshControlLogs();
      }
    } catch (error) {
      showToast(error.message || '生成 Control Log 失败。');
    } finally {
      createControlLogButton.disabled = false;
      createControlLogButton.textContent = original;
    }
  }

  function resetView() {
    stopPolling();
    state.jobs = [];
    localStorage.removeItem(BATCH_KEY);
    clearFiles();
    processPanel.hidden = true;
    reviewPanel.hidden = true;
    errorBox.hidden = true;
    batchList.replaceChildren();
    summaryMetrics.replaceChildren();
    authorBlock.hidden = true;
    setProgress(0, '正在准备任务…', 'QUEUED');
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function tryResume() {
    let ids = [];
    try { ids = JSON.parse(localStorage.getItem(BATCH_KEY) || '[]'); } catch (_) {}
    if (!Array.isArray(ids) || !ids.length) return;
    const jobs = [];
    for (const id of ids) {
      try {
        const response = await fetch(`/api/excel-reviews/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) continue;
        const payload = await response.json();
        if (payload.ok && payload.job) {
          jobs.push({
            id: payload.job.id, filename: payload.job.originalFilename, status: payload.job.status,
            progress: payload.job.progress, itemCount: payload.job.itemCount,
            hasReview: payload.job.hasReview, error: payload.job.error || '', stats: payload.job.stats || null
          });
        }
      } catch (_) {}
    }
    if (!jobs.length) { localStorage.removeItem(BATCH_KEY); return; }
    state.jobs = jobs;
    processPanel.hidden = false;
    renderBatch();
    renderResults();
    if (state.jobs.some((job) => !TERMINAL.includes(job.status))) startPolling();
  }

  startButton.addEventListener('click', startBatch);
  newJobButton.addEventListener('click', resetView);
  createControlLogButton.addEventListener('click', createControlLog);

  window.ExcelReviewPage = {
    refreshHistory: () => {
      if (window.ExcelReviewHistory && typeof window.ExcelReviewHistory.refresh === 'function') {
        window.ExcelReviewHistory.refresh();
      }
    }
  };

  tryResume();
})();

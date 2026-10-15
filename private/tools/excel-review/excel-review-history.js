'use strict';

(() => {
  const STATUS_META = {
    queued: { label: '排队中', className: '' },
    processing: { label: '提取中', className: 'is-processing' },
    review_ready: { label: '已完成', className: 'is-completed' },
    completed: { label: '已完成', className: 'is-completed' },
    failed: { label: '失败', className: 'is-failed' }
  };
  const DONE = ['review_ready', 'completed'];

  let panel = null;
  let list = null;
  let selectionBar = null;
  let controlsPanel = null;
  let controlList = null;
  let refreshing = false;
  let refreshingControls = false;

  const selected = new Set();
  let jobsById = new Map();

  function statusMeta(job) {
    const meta = STATUS_META[job.status] || { label: job.status, className: '' };
    if (job.status === 'processing' && job.progress) {
      return { label: `${meta.label} ${job.progress}%`, className: meta.className };
    }
    return meta;
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function actionButton(label, { href, danger, onClick } = {}) {
    if (href) {
      const link = document.createElement('a');
      link.className = 'erh-action';
      link.href = href;
      link.textContent = label;
      return link;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `erh-action${danger ? ' is-danger' : ''}`;
    button.textContent = label;
    if (onClick) button.addEventListener('click', onClick);
    return button;
  }

  /* ----------------------------- jobs history ----------------------------- */

  function renderSelectionBar() {
    if (!selectionBar) return;
    const chosen = [...selected];
    const questions = chosen.reduce((sum, id) => sum + (Number(jobsById.get(id)?.itemCount) || 0), 0);
    selectionBar.replaceChildren();
    const info = document.createElement('span');
    info.className = 'erh-selection-info';
    info.textContent = chosen.length
      ? `已选择 ${chosen.length} 个文件 · 共 ${questions} 个问题`
      : '勾选已完成的任务以创建 Control Log';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'primary-button erh-create';
    create.textContent = '创建 Control Log';
    create.disabled = chosen.length === 0;
    create.addEventListener('click', createControlLog);
    selectionBar.append(info, create);
  }

  function renderItem(job) {
    const article = document.createElement('article');
    article.className = 'erh-item';

    const top = document.createElement('div');
    top.className = 'erh-item-top';

    const left = document.createElement('div');
    left.className = 'erh-item-left';
    const selectable = DONE.includes(job.status) && job.hasReview;
    if (selectable) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'erh-check';
      checkbox.checked = selected.has(job.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(job.id); else selected.delete(job.id);
        renderSelectionBar();
      });
      left.append(checkbox);
    }

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'erh-name';
    name.textContent = job.originalFilename || '未命名.xlsx';
    const meta = document.createElement('div');
    meta.className = 'erh-meta';
    const bits = [formatTime(job.createdAt)];
    if (job.itemCount !== null && job.itemCount !== undefined) bits.push(`问题 ${job.itemCount} 个`);
    if (job.status === 'failed' && job.error) bits.push(job.error);
    meta.textContent = bits.filter(Boolean).join(' · ');
    info.append(name, meta);
    left.append(info);

    const meta2 = statusMeta(job);
    const badge = document.createElement('span');
    badge.className = `erh-status ${meta2.className}`.trim();
    badge.textContent = meta2.label;
    top.append(left, badge);

    const actions = document.createElement('div');
    actions.className = 'erh-actions';
    if (DONE.includes(job.status) && job.hasReview) {
      actions.append(actionButton('下载 Review', {
        href: `/api/excel-reviews/${encodeURIComponent(job.id)}/review-file`
      }));
    }
    if (job.status !== 'processing') {
      actions.append(actionButton('删除', {
        danger: true,
        onClick: () => removeJob(job.id, name.textContent)
      }));
    }

    article.append(top, actions);
    return article;
  }

  function render(jobs) {
    jobsById = new Map(jobs.map((job) => [job.id, job]));
    for (const id of [...selected]) if (!jobsById.has(id)) selected.delete(id);
    list.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement('div');
      empty.className = 'erh-empty';
      empty.textContent = '还没有任务，上传一个 Excel 开始。';
      list.append(empty);
    } else {
      jobs.forEach((job) => list.append(renderItem(job)));
    }
    renderSelectionBar();
  }

  async function refresh() {
    if (!panel || refreshing) return;
    refreshing = true;
    try {
      const response = await fetch('/api/excel-reviews', { headers: { Accept: 'application/json' } });
      if (response.status === 401) return;
      const payload = await response.json();
      if (response.ok && payload.ok) render(payload.jobs || []);
    } catch (_) {
      // Keep the previous list on transient errors.
    } finally {
      refreshing = false;
    }
  }

  async function removeJob(jobId, displayName) {
    if (!window.confirm(`确定删除任务「${displayName}」及其文件吗？`)) return;
    try {
      const response = await fetch(`/api/excel-reviews/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        window.alert(payload.message || '删除失败。');
        return;
      }
      selected.delete(jobId);
      await refresh();
    } catch (_) {
      window.alert('网络错误，删除失败。');
    }
  }

  async function createControlLog() {
    const jobIds = [...selected];
    if (!jobIds.length) return;
    try {
      const response = await fetch('/api/excel-review-control-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jobIds })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        window.alert(payload.message || '创建 Control Log 失败。');
        return;
      }
      selected.clear();
      renderSelectionBar();
      await refreshControlLogs();
      if (controlsPanel) controlsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) {
      window.alert('网络错误，创建 Control Log 失败。');
    }
  }

  /* ------------------------------ control logs ---------------------------- */

  function renderControlItem(record) {
    const article = document.createElement('article');
    article.className = 'erh-item';

    const top = document.createElement('div');
    top.className = 'erh-item-top';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'erh-name';
    name.textContent = record.name || 'Control Log';
    const meta = document.createElement('div');
    meta.className = 'erh-meta';
    const bits = [formatTime(record.createdAt)];
    bits.push(`${record.fileCount} 个文件`);
    bits.push(`${record.questionCount} 个问题`);
    if (record.threadedCount || record.legacyCount) {
      bits.push(`新版 ${record.threadedCount} · 旧版 ${record.legacyCount}`);
    }
    meta.textContent = bits.filter(Boolean).join(' · ');
    info.append(name, meta);

    const badge = document.createElement('span');
    const statusClass = record.status === 'review_ready' ? 'is-completed' : (record.status === 'failed' ? 'is-failed' : 'is-processing');
    badge.className = `erh-status ${statusClass}`;
    badge.textContent = record.status === 'review_ready' ? '可下载' : (record.status === 'failed' ? '失败' : '生成中');
    top.append(info, badge);

    const actions = document.createElement('div');
    actions.className = 'erh-actions';
    if (record.status === 'review_ready' && record.hasFile) {
      actions.append(actionButton('下载', {
        href: `/api/excel-review-control-logs/${encodeURIComponent(record.id)}/file`
      }));
    }
    if (record.status !== 'processing') {
      actions.append(actionButton('删除', {
        danger: true,
        onClick: () => removeControlLog(record.id, record.name)
      }));
    }

    article.append(top, actions);
    return article;
  }

  function renderControlLogs(records) {
    if (!controlList) return;
    controlList.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'erh-empty';
      empty.textContent = '还没有 Control Log。勾选多个已完成任务即可创建。';
      controlList.append(empty);
      return;
    }
    records.forEach((record) => controlList.append(renderControlItem(record)));
  }

  async function refreshControlLogs() {
    if (!controlsPanel || refreshingControls) return;
    refreshingControls = true;
    try {
      const response = await fetch('/api/excel-review-control-logs', { headers: { Accept: 'application/json' } });
      if (response.status === 401) return;
      const payload = await response.json();
      if (response.ok && payload.ok) renderControlLogs(payload.controlLogs || []);
    } catch (_) {
      // Keep the previous list on transient errors.
    } finally {
      refreshingControls = false;
    }
  }

  async function removeControlLog(id, displayName) {
    if (!window.confirm(`确定删除 Control Log「${displayName}」吗？源 Excel 任务不会被删除。`)) return;
    try {
      const response = await fetch(`/api/excel-review-control-logs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        window.alert(payload.message || '删除失败。');
        return;
      }
      await refreshControlLogs();
    } catch (_) {
      window.alert('网络错误，删除失败。');
    }
  }

  /* --------------------------------- build -------------------------------- */

  function buildSection(number, title, subtitle) {
    const section = document.createElement('section');
    section.className = 'erh-panel';
    const head = document.createElement('div');
    head.className = 'erh-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'erh-title';
    const step = document.createElement('span');
    step.className = 'step-no';
    step.textContent = number;
    const copy = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const p = document.createElement('p');
    p.textContent = subtitle;
    copy.append(h2, p);
    titleWrap.append(step, copy);
    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'erh-refresh';
    refreshButton.textContent = '刷新';
    head.append(titleWrap, refreshButton);
    const body = document.createElement('div');
    body.className = 'erh-list';
    section.append(head, body);
    return { section, refreshButton, body };
  }

  function build() {
    const main = document.querySelector('.tool-main');
    if (!main) return;

    const jobs = buildSection('04', '历史记录', '仅显示当前账号上传的任务；勾选可创建 Control Log。');
    panel = jobs.section;
    list = jobs.body;
    jobs.refreshButton.addEventListener('click', refresh);
    selectionBar = document.createElement('div');
    selectionBar.className = 'erh-selection';
    panel.append(selectionBar);

    const controls = buildSection('05', 'Control Log', '多文件汇总。删除 Control Log 不会删除源任务。');
    controlsPanel = controls.section;
    controlList = controls.body;
    controls.refreshButton.addEventListener('click', refreshControlLogs);

    main.append(panel, controlsPanel);
    renderSelectionBar();
  }

  window.ExcelReviewHistory = { refresh, refreshControlLogs };

  build();
  refresh();
  refreshControlLogs();
  setInterval(() => {
    if (!document.hidden) { refresh(); refreshControlLogs(); }
  }, 8000);
})();

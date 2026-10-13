'use strict';

(() => {
  const STATUS_META = {
    queued: { label: '排队中', className: '' },
    processing: { label: '提取中', className: 'is-processing' },
    review_ready: { label: '已完成', className: 'is-completed' },
    completed: { label: '已完成', className: 'is-completed' },
    failed: { label: '失败', className: 'is-failed' }
  };

  let panel = null;
  let list = null;
  let refreshing = false;

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

  function renderItem(job) {
    const article = document.createElement('article');
    article.className = 'erh-item';

    const top = document.createElement('div');
    top.className = 'erh-item-top';

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

    const meta2 = statusMeta(job);
    const badge = document.createElement('span');
    badge.className = `erh-status ${meta2.className}`.trim();
    badge.textContent = meta2.label;

    top.append(info, badge);

    const actions = document.createElement('div');
    actions.className = 'erh-actions';

    const canDownloadReview = ['review_ready', 'completed'].includes(job.status) && job.hasReview;
    if (canDownloadReview) {
      actions.append(actionButton('下载 Review', {
        href: `/api/excel-reviews/${encodeURIComponent(job.id)}/review-file`
      }));
    }
    const deletable = job.status !== 'processing';
    if (deletable) {
      actions.append(actionButton('删除', {
        danger: true,
        onClick: () => removeJob(job.id, name.textContent)
      }));
    }

    article.append(top, actions);
    return article;
  }

  function render(jobs) {
    list.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement('div');
      empty.className = 'erh-empty';
      empty.textContent = '还没有任务，上传一个 Excel 开始。';
      list.append(empty);
      return;
    }
    jobs.forEach((job) => list.append(renderItem(job)));
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
        if (window.ExcelReviewPage) window.ExcelReviewPage.refreshHistory();
        window.alert(payload.message || '删除失败。');
        return;
      }
      await refresh();
    } catch (_) {
      window.alert('网络错误，删除失败。');
    }
  }

  function build() {
    const main = document.querySelector('.tool-main');
    if (!main) return;

    panel = document.createElement('section');
    panel.className = 'erh-panel';

    const head = document.createElement('div');
    head.className = 'erh-head';

    const title = document.createElement('div');
    title.className = 'erh-title';
    const number = document.createElement('span');
    number.className = 'step-no';
    number.textContent = '04';
    const copy = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = '历史记录';
    const p = document.createElement('p');
    p.textContent = '仅显示当前账号上传的任务。';
    copy.append(h2, p);
    title.append(number, copy);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'erh-refresh';
    refreshButton.textContent = '刷新';
    refreshButton.addEventListener('click', refresh);

    head.append(title, refreshButton);

    list = document.createElement('div');
    list.className = 'erh-list';

    panel.append(head, list);
    main.append(panel);
  }

  window.ExcelReviewHistory = { refresh };

  build();
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 8000);
})();

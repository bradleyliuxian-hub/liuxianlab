(() => {
  'use strict';

  const COMING_SOON = true;

  const API = '/api/flowchart-excel';
  const STATUS_LABEL = {
    review_required: '待人工复核',
    review_in_progress: '复核中',
    review_approved: '复核已完成'
  };
  const SEVERITY_LABEL = { high: '高', medium: '中', low: '低', info: '提示' };
  const ISSUE_STATUS_LABEL = { pending: '待处理', resolved: '已解决', waived: '已豁免', notice: '提示' };
  const SHAPES = ['terminator', 'process', 'decision', 'predefined_process', 'document', 'input_output', 'database', 'connector', 'note', 'manual_input', 'delay', 'display', 'off_page_connector', 'other'];
  const EDGE_KINDS = ['sequence', 'branch', 'loopback', 'document_output', 'exception', 'other'];
  const ROUTE_HINTS = ['straight_horizontal', 'straight_vertical', 'orthogonal_vertical_first', 'orthogonal_horizontal_first', 'loopback', 'manual_review'];
  const PORTS = [['', '未确定'], ['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左']];
  const CONFIDENCE = [['high', '高'], ['medium', '中'], ['low', '低']];
  const REVIEW_STATUSES = [['pending', '待处理'], ['confirmed', '已确认'], ['rejected', '已拒绝']];
  const CONTROL_KINDS = ['CA', 'PRP', 'TOE'];
  const CONTROL_DISPLAYS = [['badge', '徽标'], ['inline_text', '行内文字'], ['separate_shape', '独立形状']];
  const CONTROL_ATTRIBUTIONS = [['confirmed', '已确认'], ['inferred', '推断'], ['unresolved', '未解决'], ['needs_review', '需复核']];

  const $ = (id) => document.getElementById(id);
  const state = {
    jobId: null,
    review: null,
    graph: null,
    originalGraph: null,
    revision: 0,
    selected: null,
    issue: null,
    propertyMode: null,
    tab: 'issues',
    dirty: false,
    busy: false,
    zoom: 1,
    revisions: null,
    reviewFilesReady: false
  };

  const els = {
    loading: $('reviewLoading'),
    error: $('reviewError'),
    app: $('reviewApp'),
    sourceName: $('sourceName'),
    jobId: $('jobId'),
    reviewStatus: $('reviewStatus'),
    graphCounts: $('graphCounts'),
    issueProgress: $('issueProgress'),
    warningCount: $('warningCount'),
    profileLabel: $('profileLabel'),
    exportLabel: $('exportLabel'),
    revisionLabel: $('revisionLabel'),
    reviewHint: $('reviewHint'),
    approveHint: $('approveHint'),
    reviewFileLinks: $('reviewFileLinks'),
    listCount: $('listCount'),
    issueList: $('issueList'),
    issueEmpty: $('issueEmpty'),
    objectList: $('objectList'),
    warningList: $('warningList'),
    statusFilter: $('statusFilter'),
    severityFilter: $('severityFilter'),
    groupFilter: $('groupFilter'),
    tabButtons: [...document.querySelectorAll('.tab')],
    issuesTab: $('issuesTab'),
    objectsTab: $('objectsTab'),
    warningsTab: $('warningsTab'),
    historyTab: $('historyTab'),
    historyList: $('historyList'),
    historyEmpty: $('historyEmpty'),
    propertySubtitle: $('propertySubtitle'),
    propertyBody: $('propertyBody'),
    dirtyBadge: $('dirtyBadge'),
    saveButton: $('saveButton'),
    approveButton: $('approveButton'),
    bulkReviewButton: $('bulkReviewButton'),
    exportButton: $('exportButton'),
    reloadButton: $('reloadButton'),
    addEdgeButton: $('addEdgeButton'),
    canvasMeta: $('canvasMeta'),
    sourceImage: $('sourceImage'),
    overlayImage: $('overlayImage'),
    overlaySvg: $('overlaySvg'),
    overlayToggle: $('overlayToggle'),
    zoomLabel: $('zoomLabel'),
    zoomInButton: $('zoomInButton'),
    zoomOutButton: $('zoomOutButton'),
    canvasStage: $('canvasStage'),
    viewport: $('imageViewport'),
    toast: $('toast')
  };

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
    return node;
  }

  function showError(message) {
    els.error.textContent = message || '';
    els.error.hidden = !message;
  }

  function showToast(message, tone = '') {
    els.toast.textContent = message || '';
    els.toast.className = `review-toast ${tone}`.trim();
    els.toast.hidden = !message;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
  }

  function setLoading(value) {
    els.loading.hidden = !value;
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('请先登录。');
    }
    if (!response.ok) {
      const error = new Error(body.message || `请求失败（${response.status}）。`);
      error.code = body.code;
      error.details = body.details;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    return parseResponse(response);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function findObject(type, id) {
    const collection = type === 'lane' ? 'lanes' : type === 'node' ? 'nodes' : type === 'edge' ? 'edges' : null;
    if (!collection || !state.graph) return null;
    return (state.graph[collection] || []).find((item) => item.id === id) || null;
  }

  function findIssueObject(issue) {
    if (!issue || !Array.isArray(issue.related_ids)) return null;
    for (const id of issue.related_ids) {
      const node = findObject('node', id);
      if (node) return { type: 'node', id, object: node };
      const edge = findObject('edge', id);
      if (edge) return { type: 'edge', id, object: edge };
      const lane = findObject('lane', id);
      if (lane) return { type: 'lane', id, object: lane };
    }
    return null;
  }

  function setSelected(type, id) {
    state.selected = type && id ? { type, id } : null;
    renderObjectLists();
    renderCanvas();
  }

  function selectIssue(issue) {
    state.issue = issue;
    state.propertyMode = 'issue';
    const related = findIssueObject(issue);
    state.selected = related ? { type: related.type, id: related.id } : null;
    renderIssueList();
    renderObjectLists();
    renderCanvas();
    renderProperty();
  }

  function selectObject(type, id) {
    state.issue = null;
    state.propertyMode = 'object';
    setSelected(type, id);
    renderIssueList();
    renderProperty();
  }

  function selectRelatedObject() {
    if (!state.issue) return;
    const related = findIssueObject(state.issue);
    if (!related) {
      showToast('该问题没有可直接定位的节点/连线/泳道。');
      return;
    }
    selectObject(related.type, related.id);
  }

  function renderSummary() {
    const review = state.review;
    const job = review.job || {};
    const progress = review.progress || {};
    state.revision = review.reviewMeta?.revision ?? state.revision;
    els.sourceName.textContent = job.originalFilename || review.graph?.document?.title || '未命名流程图';
    els.jobId.textContent = state.jobId;
    els.reviewStatus.textContent = STATUS_LABEL[review.reviewMeta?.status] || review.reviewMeta?.status || job.status || '—';
    els.graphCounts.textContent = `${review.graph?.lanes?.length ?? 0} / ${review.graph?.nodes?.length ?? 0} / ${review.graph?.edges?.length ?? 0}`;
    els.issueProgress.textContent = `${(progress.resolved || 0) + (progress.waived || 0)} / ${progress.total || 0} 已处理 · ${progress.pending || 0} 待处理`;
    els.warningCount.textContent = `${review.warnings?.length ?? 0} 条`;
    els.profileLabel.textContent = `${review.profile?.templateProfileId || 'trade_purchase_cn'} · edit_as=${review.profile?.editAs || 'pending'}`;
    els.exportLabel.textContent = review.profile?.exportReady ? '已开放' : '未开放（exportReady=false）';
    els.revisionLabel.textContent = `#${state.revision}`;
    const blocking = progress.blockingPending || 0;
    els.approveHint.textContent = blocking
      ? `${blocking} 条阻断级问题待处理；完成复核不会解锁 Excel 导出。`
      : '阻断级问题已处理；完成复核只记录复核状态，不会解锁 Excel 导出。';
    els.approveButton.disabled = COMING_SOON || state.busy || state.dirty || !review.canApprove;
    els.bulkReviewButton.disabled = COMING_SOON || state.busy || state.dirty || !(review.progress?.pending > 0);
    els.exportButton.disabled = COMING_SOON || state.busy || state.dirty || review.reviewMeta?.status !== 'review_approved';
    els.saveButton.disabled = COMING_SOON || state.busy || !state.dirty;
    els.dirtyBadge.hidden = !state.dirty;
    renderReviewFileLinks();
    renderExportLinks();
    els.listCount.textContent = state.tab === 'warnings'
      ? String(review.warnings?.length || 0)
      : state.tab === 'history'
        ? String(state.revisions?.length ?? '—')
        : state.tab === 'objects'
          ? String((review.graph?.lanes?.length || 0) + (review.graph?.nodes?.length || 0) + (review.graph?.edges?.length || 0))
          : String(review.issues?.length || 0);
  }

  function renderExportLinks() {
    if (!Array.isArray(state.review?.exportArtifacts) || !state.review.exportArtifacts.length) return;
    for (const artifact of state.review.exportArtifacts) {
      const link = el('a', '', `下载 ${artifact.name} ↓`);
      link.href = `${API}/jobs/${encodeURIComponent(state.jobId)}/artifacts/${encodeURIComponent(artifact.id)}`;
      link.setAttribute('download', artifact.name || '');
      link.className = 'export-link';
      els.reviewFileLinks.append(link);
    }
    els.reviewFileLinks.hidden = false;
  }

  function renderReviewFileLinks() {
    els.reviewFileLinks.replaceChildren();
    if (state.revision < 1 || !state.reviewFilesReady) {
      els.reviewFileLinks.hidden = true;
      return;
    }
    const files = [
      ['flowchart.reviewed.json', '复核流程图 JSON'],
      ['nodes.reviewed.csv', '复核节点 CSV'],
      ['edges.reviewed.csv', '复核连线 CSV'],
      ['style.reviewed.json', '复核样式 JSON']
    ];
    for (const [name, label] of files) {
      const link = el('a', '', `${label} ↓`);
      link.href = `${API}/jobs/${encodeURIComponent(state.jobId)}/review/files/${encodeURIComponent(name)}`;
      link.setAttribute('download', name);
      els.reviewFileLinks.append(link);
    }
    els.reviewFileLinks.hidden = false;
  }

  function severityPill(severity) {
    return el('span', `pill ${severity}`, SEVERITY_LABEL[severity] || severity || '—');
  }

  function statusPill(status) {
    return el('span', `pill ${status}`, ISSUE_STATUS_LABEL[status] || status || '—');
  }

  function issueMatches(issue) {
    const status = els.statusFilter.value;
    const severity = els.severityFilter.value;
    const group = els.groupFilter.value;
    if (status !== 'all' && issue.status !== status) return false;
    if (severity !== 'all' && issue.severity !== severity) return false;
    if (group !== 'all' && issue.group !== group) return false;
    return true;
  }

  function renderIssueList() {
    els.issueList.replaceChildren();
    const issues = (state.review?.issues || []).filter(issueMatches);
    els.issueEmpty.hidden = issues.length > 0;
    const groups = new Map();
    for (const issue of issues) {
      if (!groups.has(issue.groupLabel)) groups.set(issue.groupLabel, []);
      groups.get(issue.groupLabel).push(issue);
    }
    for (const [label, groupIssues] of groups) {
      const section = el('section', 'issue-group');
      section.append(el('h3', '', label));
      for (const issue of groupIssues) {
        const button = el('button', 'issue-item');
        button.type = 'button';
        if (state.issue?.id === issue.id) button.classList.add('active');
        const top = el('div', 'issue-top');
        top.append(el('span', 'issue-id', issue.id), severityPill(issue.severity));
        const desc = el('p', 'issue-desc', issue.description || '（无描述）');
        const meta = el('div', 'issue-meta');
        meta.append(el('span', 'issue-type', issue.type));
        meta.append(statusPill(issue.status));
        if (issue.blocking) meta.append(el('span', 'pill blocking', '阻断'));
        if (issue.related_ids?.length) meta.append(el('span', 'pill', `关联 ${issue.related_ids.length}`));
        button.append(top, desc, meta);
        button.addEventListener('click', () => selectIssue(issue));
        section.append(button);
      }
      els.issueList.append(section);
    }
  }

  function objectGroups() {
    const graph = state.graph || {};
    return [
      ['泳道', 'lane', graph.lanes || []],
      ['节点', 'node', graph.nodes || []],
      ['连线', 'edge', graph.edges || []]
    ];
  }

  function renderObjectLists() {
    els.objectList.replaceChildren();
    for (const [label, type, items] of objectGroups()) {
      const section = el('section', 'object-group');
      section.append(el('h3', '', `${label} · ${items.length}`));
      for (const item of items) {
        const button = el('button', 'object-item');
        button.type = 'button';
        if (state.selected?.type === type && state.selected.id === item.id) button.classList.add('active');
        const top = el('div', 'object-top');
        top.append(el('span', 'object-id', item.id), el('span', 'object-type', type));
        const text = el('p', 'object-label', item.label || (type === 'edge' ? `${item.source_node_id} → ${item.target_node_id}` : '（无标签）'));
        const meta = el('div', 'issue-meta');
        if (type === 'node') {
          meta.append(el('span', 'pill', item.shape || '—'));
          meta.append(el('span', `pill ${item.confidence || 'low'}`, SEVERITY_LABEL[item.confidence] || item.confidence || '—'));
        } else if (type === 'edge') {
          meta.append(el('span', 'pill', item.kind || '—'));
          meta.append(el('span', 'pill', `${item.source_node_id} → ${item.target_node_id}`));
        } else {
          meta.append(el('span', 'pill', item.orientation || '—'));
        }
        button.append(top, text, meta);
        button.addEventListener('click', () => selectObject(type, item.id));
        section.append(button);
      }
      els.objectList.append(section);
    }
  }

  function renderWarnings() {
    els.warningList.replaceChildren();
    const warnings = state.review?.warnings || [];
    if (!warnings.length) {
      els.warningList.append(el('div', 'empty-state', '没有导入 warning。'));
      return;
    }
    for (const warning of warnings) {
      const item = el('div', 'warning-item');
      item.append(el('strong', '', warning.id));
      item.append(el('p', '', warning.description));
      item.append(el('small', '', '警告只读；Windows Excel 验收不能在此工作台伪造。'));
      els.warningList.append(item);
    }
  }

  function revisionActionLabel(action) {
    return {
      graph_saved: '保存图修改',
      issue_updated: '更新问题状态',
      review_approved: '完成人工复核'
    }[action] || action || '修订';
  }

  function renderHistory() {
    els.historyList.replaceChildren();
    const revisions = state.revisions || [];
    els.historyEmpty.hidden = revisions.length > 0 || state.revisions === null;
    for (const record of revisions) {
      const item = el('div', 'history-item');
      item.append(el('strong', '', `#${record.revision} · ${revisionActionLabel(record.action)}`));
      const target = record.target ? `${record.target.type || ''} ${record.target.id || ''}`.trim() : '—';
      item.append(el('small', '', `${target} · ${record.changes?.length || 0} 项变更 · ${record.actor || '—'} · ${record.created_at || ''}`));
      if (record.reason) item.append(el('p', '', record.reason));
      els.historyList.append(item);
    }
  }

  async function loadHistory() {
    if (state.revisions !== null) return;
    els.historyList.replaceChildren(el('div', 'empty-state', '正在读取修订历史…'));
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review/revisions`);
      state.revisions = Array.isArray(body.revisions) ? body.revisions : [];
      renderHistory();
      renderSummary();
    } catch (error) {
      els.historyList.replaceChildren();
      showToast(error.message || '无法读取修订历史。', 'error');
    }
  }

  function renderTabs() {
    for (const button of els.tabButtons) {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
    els.issuesTab.hidden = state.tab !== 'issues';
    els.objectsTab.hidden = state.tab !== 'objects';
    els.warningsTab.hidden = state.tab !== 'warnings';
    els.historyTab.hidden = state.tab !== 'history';
    els.addEdgeButton.hidden = state.tab !== 'objects';
  }

  function imageDimensions() {
    const document = state.graph?.document || {};
    const width = Number(state.review?.job?.imageWidth || document.source_image_size_px?.width || 0);
    const height = Number(state.review?.job?.imageHeight || document.source_image_size_px?.height || 0);
    return { width: width > 0 ? width : 1, height: height > 0 ? height : 1 };
  }

  function isRelated(id) {
    return Boolean(state.issue?.related_ids?.includes(id));
  }

  function addSvgTitle(node, text) {
    const title = svgEl('title');
    title.textContent = text;
    node.append(title);
  }

  function edgeCenters(edge) {
    const source = findObject('node', edge.source_node_id);
    const target = findObject('node', edge.target_node_id);
    if (!source?.bbox || !target?.bbox) return null;
    return {
      x1: (source.bbox.x + source.bbox.width / 2) * imageDimensions().width,
      y1: (source.bbox.y + source.bbox.height / 2) * imageDimensions().height,
      x2: (target.bbox.x + target.bbox.width / 2) * imageDimensions().width,
      y2: (target.bbox.y + target.bbox.height / 2) * imageDimensions().height
    };
  }

  function renderCanvas() {
    if (!state.graph) return;
    const { width, height } = imageDimensions();
    const graph = state.graph;
    els.overlaySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    els.overlaySvg.setAttribute('preserveAspectRatio', 'none');
    els.overlaySvg.replaceChildren();
    els.canvasMeta.textContent = `${width} × ${height} px · 坐标基准：source_pixels / normalized · ${graph.lanes?.length || 0} 泳道、${graph.nodes?.length || 0} 节点、${graph.edges?.length || 0} 连线`;

    const laneLayer = svgEl('g', { 'aria-label': '泳道' });
    for (const lane of graph.lanes || []) {
      if (!lane.bbox) continue;
      const rect = svgEl('rect', {
        x: lane.bbox.x * width,
        y: lane.bbox.y * height,
        width: lane.bbox.width * width,
        height: lane.bbox.height * height,
        class: `lane-box${state.selected?.type === 'lane' && state.selected.id === lane.id ? ' active' : ''}`
      });
      addSvgTitle(rect, `${lane.id} · ${lane.label || ''}`);
      rect.addEventListener('click', (event) => {
        event.stopPropagation();
        selectObject('lane', lane.id);
      });
      laneLayer.append(rect);
    }
    els.overlaySvg.append(laneLayer);

    const edgeLayer = svgEl('g', { 'aria-label': '连线' });
    for (const edge of graph.edges || []) {
      const centers = edgeCenters(edge);
      if (!centers) continue;
      const active = state.selected?.type === 'edge' && state.selected.id === edge.id;
      const related = isRelated(edge.id);
      const line = svgEl('line', {
        x1: centers.x1, y1: centers.y1, x2: centers.x2, y2: centers.y2,
        class: `edge-line ${edge.confidence || 'low'}${active ? ' active' : ''}${related ? ' related' : ''}`
      });
      const hit = svgEl('line', {
        x1: centers.x1, y1: centers.y1, x2: centers.x2, y2: centers.y2,
        class: 'edge-hit'
      });
      addSvgTitle(hit, `${edge.id} · ${edge.source_node_id} → ${edge.target_node_id}${edge.label ? ` · ${edge.label}` : ''}`);
      hit.addEventListener('click', (event) => {
        event.stopPropagation();
        selectObject('edge', edge.id);
      });
      edgeLayer.append(line, hit);
    }
    els.overlaySvg.append(edgeLayer);

    const nodeLayer = svgEl('g', { 'aria-label': '节点' });
    for (const node of graph.nodes || []) {
      if (!node.bbox) continue;
      const active = state.selected?.type === 'node' && state.selected.id === node.id;
      const related = isRelated(node.id);
      const rect = svgEl('rect', {
        x: node.bbox.x * width,
        y: node.bbox.y * height,
        width: node.bbox.width * width,
        height: node.bbox.height * height,
        rx: Math.min(8, node.bbox.width * width * 0.08),
        class: `node-box ${node.confidence || 'low'}${active ? ' active' : ''}${related ? ' related' : ''}`
      });
      addSvgTitle(rect, `${node.id} · ${node.label || ''} · ${node.shape || ''}`);
      rect.addEventListener('click', (event) => {
        event.stopPropagation();
        selectObject('node', node.id);
      });
      nodeLayer.append(rect);
      if (active || related) {
        const label = svgEl('text', {
          x: node.bbox.x * width + 2,
          y: node.bbox.y * height - 3,
          class: 'node-label'
        });
        label.textContent = `${node.id} ${String(node.label || '').slice(0, 24)}`;
        nodeLayer.append(label);
      }
    }
    els.overlaySvg.append(nodeLayer);
  }

  function appendField(parent, label, control, full = false) {
    const wrapper = el('label', `field${full ? ' full' : ''}`);
    wrapper.append(el('span', '', label), control);
    parent.append(wrapper);
    return wrapper;
  }

  function inputField(parent, label, value, onChange, options = {}) {
    const input = el('input');
    input.type = options.type || 'text';
    input.value = value === null || value === undefined ? '' : String(value);
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    if (options.readOnly) input.readOnly = true;
    input.addEventListener('change', () => onChange(input.value));
    appendField(parent, label, input);
    return input;
  }

  function selectField(parent, label, value, pairs, onChange) {
    const select = el('select');
    for (const [key, text] of pairs) {
      const option = el('option', '', text);
      option.value = key;
      if (String(value || '') === key) option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    appendField(parent, label, select);
    return select;
  }

  function bboxFields(parent, object) {
    const grid = el('div', 'field-grid');
    for (const key of ['x', 'y', 'width', 'height']) {
      inputField(grid, key, object.bbox?.[key], (value) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        object.bbox = { ...(object.bbox || {}), [key]: number, coordinate_space: 'normalized' };
        mutate();
      }, { type: 'number', min: 0, max: 1, step: '0.000001' });
    }
    parent.append(grid);
  }

  function mutate() {
    state.dirty = true;
    renderSummary();
    renderCanvas();
  }

  function nodeForm(node) {
    const body = els.propertyBody;
    body.replaceChildren();
    const section = el('section', 'property-section');
    section.append(el('h3', '', '节点属性'));
    inputField(section, 'label', node.label, (value) => { node.label = value; mutate(); });
    selectField(section, 'shape', node.shape, SHAPES.map((value) => [value, value]), (value) => { node.shape = value; mutate(); });
    selectField(section, 'lane_id', node.lane_id || '', [['', '未归属'], ...(state.graph.lanes || []).map((lane) => [lane.id, `${lane.id} · ${lane.label || ''}`])], (value) => { node.lane_id = value || null; mutate(); });
    selectField(section, 'confidence', node.confidence, CONFIDENCE, (value) => { node.confidence = value; mutate(); });
    selectField(section, 'review_status', node.review_status, REVIEW_STATUSES, (value) => { node.review_status = value; mutate(); });
    const bbox = el('section', 'property-section');
    bbox.append(el('h3', '', '归一化 bbox（0..1）'));
    bboxFields(bbox, node);
    body.append(section, bbox);

    const controls = el('section', 'property-section');
    controls.append(el('h3', '', '控制标记'));
    node.controls = Array.isArray(node.controls) ? node.controls : [];
    if (!node.controls.length) controls.append(el('div', 'muted-note', '当前没有规范控制标记。非规范标记会保留在 unresolved 中，需人工确认后手动添加。'));
    node.controls.forEach((control, index) => {
      const row = el('div', 'control-row');
      selectField(row, 'kind', control.kind, CONTROL_KINDS.map((value) => [value, value]), (value) => { control.kind = value; mutate(); });
      inputField(row, 'code', control.code, (value) => { control.code = value; mutate(); });
      selectField(row, 'display', control.display, CONTROL_DISPLAYS, (value) => { control.display = value; mutate(); });
      selectField(row, 'attribution', control.attribution_status, CONTROL_ATTRIBUTIONS, (value) => { control.attribution_status = value; mutate(); });
      const remove = el('button', 'control-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', '移除控制标记');
      remove.addEventListener('click', () => {
        node.controls.splice(index, 1);
        mutate();
        renderProperty();
      });
      row.append(remove);
      controls.append(row);
    });
    const addControl = el('button', 'ghost-button small', '添加控制标记');
    addControl.type = 'button';
    addControl.addEventListener('click', () => {
      node.controls.push({ kind: 'CA', code: 'CA1', display: 'badge', attribution_status: 'needs_review' });
      mutate();
      renderProperty();
    });
    controls.append(addControl);
    body.append(controls);

    const invalid = node.extensions?.legacy?.invalid_controls;
    if (Array.isArray(invalid) && invalid.length) {
      const note = el('div', 'muted-note');
      note.append(el('strong', '', '导入时未自动映射的控制标记'));
      note.append(el('p', '', invalid.map((item) => `${item.kind || '?'} ${item.code || ''}`.trim()).join('、')));
      note.append(el('p', '', '请按原图确认后再添加规范控制标记；不要根据外观自动假设 CA/PRP/TOE。'));
      body.append(note);
    }
    els.propertySubtitle.textContent = `节点 ${node.id}`;
  }

  function edgeForm(edge) {
    const body = els.propertyBody;
    body.replaceChildren();
    const section = el('section', 'property-section');
    section.append(el('h3', '', '连线属性'));
    const nodePairs = (state.graph.nodes || []).map((node) => [node.id, `${node.id} · ${node.label || ''}`]);
    selectField(section, 'source_node_id', edge.source_node_id, nodePairs, (value) => { edge.source_node_id = value; mutate(); });
    selectField(section, 'target_node_id', edge.target_node_id, nodePairs, (value) => { edge.target_node_id = value; mutate(); });
    selectField(section, 'source_port', edge.source_port || '', PORTS, (value) => { edge.source_port = value || null; mutate(); });
    selectField(section, 'target_port', edge.target_port || '', PORTS, (value) => { edge.target_port = value || null; mutate(); });
    selectField(section, 'kind', edge.kind, EDGE_KINDS.map((value) => [value, value]), (value) => { edge.kind = value; mutate(); });
    inputField(section, 'label（是/否等）', edge.label || '', (value) => { edge.label = value.trim() || null; mutate(); });
    selectField(section, 'route_hint', edge.route_hint, ROUTE_HINTS.map((value) => [value, value]), (value) => { edge.route_hint = value; mutate(); });
    selectField(section, 'confidence', edge.confidence, CONFIDENCE, (value) => { edge.confidence = value; mutate(); });
    selectField(section, 'review_status', edge.review_status, REVIEW_STATUSES, (value) => { edge.review_status = value; mutate(); });
    body.append(section);
    const note = el('div', 'muted-note', edge.kind === 'branch'
      ? '分支连线必须人工确认 target 与“是/否”等 label；没有真实目标时不要新增连线。'
      : '端口不确定时保留“未确定”；保存会进行 Schema 与引用校验。');
    body.append(note);
    els.propertySubtitle.textContent = `连线 ${edge.id}`;
  }

  function laneForm(lane) {
    const body = els.propertyBody;
    body.replaceChildren();
    const section = el('section', 'property-section');
    section.append(el('h3', '', '泳道属性'));
    inputField(section, 'label', lane.label, (value) => { lane.label = value; mutate(); });
    inputField(section, 'order', lane.order, (value) => { lane.order = Number(value); mutate(); }, { type: 'number', min: 0, step: 1 });
    selectField(section, 'orientation', lane.orientation, [['horizontal', 'horizontal'], ['vertical', 'vertical']], (value) => { lane.orientation = value; mutate(); });
    body.append(section);
    const bbox = el('section', 'property-section');
    bbox.append(el('h3', '', '归一化 bbox（0..1）'));
    bboxFields(bbox, lane);
    body.append(bbox);

    const otherLanes = (state.graph.lanes || []).filter((item) => item.id !== lane.id);
    if (otherLanes.length) {
      const merge = el('section', 'property-section');
      merge.append(el('h3', '', '泳道结构处理'));
      const select = el('select');
      for (const item of otherLanes) {
        const option = el('option', '', `${item.id} · ${item.label || ''}`);
        option.value = item.id;
        select.append(option);
      }
      appendField(merge, '将本泳道节点移动到', select);
      const button = el('button', 'ghost-button small', '移动节点（不删除泳道）');
      button.type = 'button';
      button.addEventListener('click', () => {
        const target = select.value;
        if (!target) return;
        let moved = 0;
        for (const node of state.graph.nodes || []) {
          if (node.lane_id === lane.id) {
            node.lane_id = target;
            moved += 1;
          }
        }
        mutate();
        showToast(`已移动 ${moved} 个节点到 ${target}；空泳道仍保留，需人工确认后处理。`);
      });
      merge.append(button);
      merge.append(el('p', 'muted-note', '不会自动删除泳道或节点；移动后请保存并复核引用。'));
      body.append(merge);
    }
    els.propertySubtitle.textContent = `泳道 ${lane.id}`;
  }

  function issueEditor() {
    const issue = state.issue;
    const body = els.propertyBody;
    body.replaceChildren();
    const editor = el('div', 'issue-editor');
    editor.append(el('h3', '', `${issue.id} · ${issue.groupLabel}`));
    editor.append(el('p', 'issue-desc', issue.description || ''));
    const action = el('div', 'issue-object-link');
    action.append(el('strong', '', '建议动作'));
    action.append(el('p', '', issue.action || '请人工确认。'));
    if (issue.related_ids?.length) {
      action.append(el('code', '', issue.related_ids.join(', ')));
      const locate = el('button', 'ghost-button small', '定位关联对象');
      locate.type = 'button';
      locate.addEventListener('click', selectRelatedObject);
      action.append(locate);
    }
    editor.append(action);
    selectField(editor, '问题状态', issue.status, [
      ['pending', '待处理'],
      ['resolved', '已解决'],
      ['waived', '已豁免']
    ], (value) => { issue._draftStatus = value; });
    const resolution = el('textarea');
    resolution.value = issue.resolution || '';
    resolution.placeholder = '记录处理说明、证据或豁免理由。标记已解决/已豁免时必填。';
    appendField(editor, '处理说明', resolution);
    const note = el('textarea');
    note.value = issue.note || '';
    note.placeholder = '内部备注（可选）';
    appendField(editor, '备注', note);
    if (state.dirty) editor.append(el('div', 'muted-note', '你有未保存的图修改；请先保存图，再更新问题状态，避免 revision 冲突。'));
    const save = el('button', 'primary-button', '保存问题状态');
    save.type = 'button';
    save.disabled = state.dirty;
    save.addEventListener('click', () => saveIssue(issue, resolution.value, note.value));
    editor.append(save);
    body.append(editor);
    els.propertySubtitle.textContent = `待确认项 ${issue.id}`;
  }

  function renderProperty() {
    if (!state.review) return;
    if (state.propertyMode === 'issue' && state.issue) return issueEditor();
    if (!state.selected) {
      els.propertySubtitle.textContent = '选择一个对象或问题。';
      els.propertyBody.replaceChildren(el('div', 'empty-state', '从左侧问题、对象列表或原图选择一个对象。'));
      return;
    }
    const object = findObject(state.selected.type, state.selected.id);
    if (!object) {
      els.propertySubtitle.textContent = '对象不存在。';
      els.propertyBody.replaceChildren(el('div', 'empty-state', '该对象已不存在，请刷新复核数据。'));
      return;
    }
    if (state.selected.type === 'node') return nodeForm(object);
    if (state.selected.type === 'edge') return edgeForm(object);
    return laneForm(object);
  }

  async function saveGraph() {
    if (state.busy || !state.dirty) return;
    state.busy = true;
    renderSummary();
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review/graph`, {
        method: 'PUT',
        body: JSON.stringify({ expectedRevision: state.revision, graph: state.graph })
      });
      state.graph = body.graph;
      state.originalGraph = clone(body.graph);
      state.review.graph = body.graph;
      state.revision = body.revision;
      state.review.reviewMeta = body.reviewMeta;
      state.review.job.status = 'review_in_progress';
      state.dirty = false;
      state.revisions = null;
      state.reviewFilesReady = true;
      showToast(`已保存修订 #${state.revision}`, 'success');
      renderSummary();
      renderCanvas();
      renderProperty();
    } catch (error) {
      const details = Array.isArray(error.details)
        ? `：${error.details.slice(0, 3).map((item) => `${item.instancePath || ''} ${item.message || ''}`.trim()).join('；')}`
        : '';
      showToast(`${error.message}${details}`, 'error');
    } finally {
      state.busy = false;
      renderSummary();
    }
  }

  async function saveIssue(issue, resolution, note) {
    if (state.busy) return;
    if (state.dirty) {
      showToast('请先保存图修改，再更新问题状态。', 'error');
      return;
    }
    const status = issue._draftStatus || issue.status;
    if (status !== 'pending' && !String(resolution || '').trim()) {
      showToast('标记已解决或已豁免时必须填写处理说明。', 'error');
      return;
    }
    state.busy = true;
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review/issues/${encodeURIComponent(issue.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ expectedRevision: state.revision, status, resolution, note })
      });
      state.revision = body.revision;
      state.review.reviewMeta = body.reviewMeta;
      state.review.job.status = 'review_in_progress';
      const index = state.review.issues.findIndex((item) => item.id === issue.id);
      if (index >= 0) state.review.issues[index] = { ...state.review.issues[index], ...body.issue };
      state.issue = state.review.issues.find((item) => item.id === issue.id) || state.issue;
      state.review.progress = recalculateProgress(state.review.issues);
      state.review.canApprove = state.review.progress.blockingPending === 0;
      state.review.blockers = state.review.issues.filter((item) => item.blocking && item.status === 'pending').map((item) => item.id);
      state.revisions = null;
      showToast('问题状态已保存', 'success');
      renderSummary();
      renderIssueList();
      renderProperty();
    } catch (error) {
      showToast(error.message || '问题状态保存失败。', 'error');
    } finally {
      state.busy = false;
      renderSummary();
    }
  }

  function recalculateProgress(issues) {
    const unresolved = issues.filter((item) => item.kind === 'unresolved');
    return {
      total: unresolved.length,
      resolved: unresolved.filter((item) => item.status === 'resolved').length,
      waived: unresolved.filter((item) => item.status === 'waived').length,
      pending: unresolved.filter((item) => item.status === 'pending').length,
      blockingPending: unresolved.filter((item) => item.blocking && item.status === 'pending').length
    };
  }

  async function bulkReview() {
    if (state.busy || state.dirty) return;
    const pending = state.review?.progress?.pending || 0;
    if (!pending) {
      showToast('当前没有待处理问题。', 'error');
      return;
    }
    const confirmed = window.confirm(
      `将把当前 ${pending} 条待处理问题标记为“已复核保留”。\n\n` +
      '不会修改节点、连线、控制码，也不会伪造 Windows 验收；\n' +
      '之后仍需单独点击“完成复核”，Excel 导出仍保持关闭。\n\n继续？'
    );
    if (!confirmed) return;
    state.busy = true;
    renderSummary();
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review/bulk-review`, {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: state.revision,
          confirm: true,
          resolution: '一键复核：用户确认保留当前识别结果；未修改图结构、控制码或连线。仍需完成模板/Windows 验收。'
        })
      });
      showToast(`已一键复核 ${body.updated?.length || pending} 条问题（保留原结果）`, 'success');
      await loadReview();
    } catch (error) {
      showToast(error.message || '一键复核失败。', 'error');
    } finally {
      state.busy = false;
      renderSummary();
    }
  }

  async function exportExcel() {
    if (state.busy || state.dirty) return;
    state.busy = true;
    renderSummary();
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/export-xlsx`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'experimental', anchor: 'default' })
      });
      if (!Array.isArray(state.review.exportArtifacts)) state.review.exportArtifacts = [];
      state.review.exportArtifacts = state.review.exportArtifacts.filter((item) => item.id !== body.artifact.id);
      state.review.exportArtifacts.unshift(body.artifact);
      showToast('已生成实验 XLSX；正式 exportReady 仍为 false。', 'success');
      renderSummary();
    } catch (error) {
      showToast(error.message || 'Excel 导出失败。', 'error');
    } finally {
      state.busy = false;
      renderSummary();
    }
  }

  async function approveReview() {
    if (state.busy || state.dirty) return;
    state.busy = true;
    renderSummary();
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review/approve`, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: state.revision })
      });
      state.revision = body.revision;
      state.review.reviewMeta = body.reviewMeta;
      state.review.job.status = 'review_approved';
      state.revisions = null;
      showToast('当前版本人工复核已完成；Excel 导出仍未开放。', 'success');
      renderSummary();
    } catch (error) {
      showToast(error.message || '完成复核失败。', 'error');
    } finally {
      state.busy = false;
      renderSummary();
    }
  }

  function addEdge() {
    if (!state.graph?.nodes?.length) {
      showToast('没有可用于新增连线的节点。', 'error');
      return;
    }
    const source = state.selected?.type === 'node' ? state.selected.id : state.graph.nodes[0].id;
    const target = state.graph.nodes.find((node) => node.id !== source)?.id || source;
    let id = `manual_edge_${Date.now()}`;
    while (state.graph.edges.some((edge) => edge.id === id)) id = `manual_edge_${Date.now()}_1`;
    const edge = {
      id,
      source_node_id: source,
      target_node_id: target,
      source_port: null,
      target_port: null,
      kind: 'sequence',
      label: null,
      route_hint: 'manual_review',
      confidence: 'low',
      review_status: 'pending',
      provenance: { source: 'manual_edit', source_ref: 'review_workbench', notes: '人工新增连线，待复核。' },
      extensions: { legacy: { created_in_review: true } }
    };
    state.graph.edges.push(edge);
    selectObject('edge', edge.id);
    mutate();
    showToast('已新增一条待确认连线；请选择真实目标与分支文字。');
  }

  function setZoom(delta) {
    state.zoom = Math.max(0.5, Math.min(3, Math.round((state.zoom + delta) * 10) / 10));
    els.canvasStage.style.width = `${Math.round(state.zoom * 100)}%`;
    els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function initImage() {
    if (!state.review?.sourceUrl) return;
    if (els.sourceImage.getAttribute('src') !== state.review.sourceUrl) {
      els.sourceImage.src = state.review.sourceUrl;
    }
    if (state.review.overlayUrl) {
      els.overlayImage.src = state.review.overlayUrl;
      els.overlayToggle.disabled = false;
    } else {
      els.overlayToggle.disabled = true;
      els.overlayToggle.checked = false;
      els.overlayImage.hidden = true;
    }
  }

  function renderAll() {
    initImage();
    renderTabs();
    renderSummary();
    renderIssueList();
    renderObjectLists();
    renderWarnings();
    renderCanvas();
    renderProperty();
  }

  async function loadReview() {
    setLoading(true);
    showError('');
    try {
      const body = await fetchJson(`${API}/jobs/${encodeURIComponent(state.jobId)}/review`);
      state.review = body;
      state.graph = clone(body.graph);
      state.originalGraph = clone(body.graph);
      state.revision = body.reviewMeta?.revision || 0;
      state.reviewFilesReady = body.source === 'reviewed';
      state.issue = null;
      state.selected = null;
      state.propertyMode = null;
      state.dirty = false;
      state.revisions = null;
      if (body.invalid) {
        showError('复核图当前未通过 Schema 或引用校验，请检查导入文件。');
      }
      els.app.hidden = false;
      renderAll();
    } catch (error) {
      els.app.hidden = true;
      const details = Array.isArray(error.details)
        ? ` ${error.details.slice(0, 3).map((item) => item.message || '').join('；')}`
        : '';
      showError(`${error.message || '无法读取复核数据。'}${details}`);
    } finally {
      setLoading(false);
    }
  }

  els.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      renderTabs();
      renderSummary();
      if (state.tab === 'history') loadHistory();
    });
  });
  els.statusFilter.addEventListener('change', renderIssueList);
  els.severityFilter.addEventListener('change', renderIssueList);
  els.groupFilter.addEventListener('change', renderIssueList);
  els.saveButton.addEventListener('click', saveGraph);
  els.approveButton.addEventListener('click', approveReview);
  els.bulkReviewButton.addEventListener('click', bulkReview);
  els.exportButton.addEventListener('click', exportExcel);
  els.reloadButton.addEventListener('click', () => {
    if (state.dirty && !window.confirm('有未保存的修改，确定重新读取吗？')) return;
    loadReview();
  });
  els.addEdgeButton.addEventListener('click', addEdge);
  els.zoomInButton.addEventListener('click', () => setZoom(0.1));
  els.zoomOutButton.addEventListener('click', () => setZoom(-0.1));
  els.overlayToggle.addEventListener('change', () => {
    els.overlayImage.hidden = !els.overlayToggle.checked;
  });
  els.overlaySvg.addEventListener('click', () => {
    state.issue = null;
    state.propertyMode = null;
    state.selected = null;
    renderIssueList();
    renderObjectLists();
    renderCanvas();
    renderProperty();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  const jobId = new URLSearchParams(window.location.search).get('job');
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    setLoading(false);
    showError('缺少有效 job 参数。请从导入任务详情打开复核工作台。');
  } else {
    state.jobId = jobId;
    els.jobId.textContent = jobId;
    loadReview();
  }
})();

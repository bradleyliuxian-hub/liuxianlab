'use strict';

const API = '/api/equity-structures';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const CURRENT_VERSION = 'v1.0.8';
const VERSION_NOTES = [
  {
    version: 'v1.0.8',
    date: '2026-10-20',
    items: [
      '补全全部功能的版本更新记录：上传识别、OCR、节点/连线/比例、字典、注销过滤、编辑器、导出与版本说明。',
      '版本说明按版本号归档，后续每次功能更新继续追加。'
    ]
  },
  {
    version: 'v1.0.7',
    date: '2026-10-20',
    items: [
      '新增页面“版本更新”入口，版本号与工具卡片同步。',
      '每次版本更新在页面记录优化内容，不再只在对话中说明。'
    ]
  },
  {
    version: 'v1.0.6',
    date: '2026-10-20',
    items: [
      'PNG 改为服务端 CairoSVG 生成，移除 SVG → Image → Canvas 链路。',
      '修复 CairoSVG 中文字体方框，统一跨平台字体回退。',
      '保留英文机构名称内部空格，新增“调试 SVG”下载。',
      '超宽图限制 20000px / 1.2 亿像素，超限自动降低 scale。'
    ]
  },
  {
    version: 'v1.0.5',
    date: '2026-10-20',
    items: [
      '新增 POST /api/equity-structures/export/png。',
      'PNG/PDF 严格使用当前编辑器布局，不重新排版。',
      '布局保存到 manual-layout.json，刷新后恢复。'
    ]
  },
  {
    version: 'v1.0.4',
    date: '2026-10-20',
    items: [
      '新增可视化股权结构编辑器。',
      '节点/比例标签独立拖动，连线、总线实时跟随。',
      '支持 Undo/Redo、Zoom 25%–300%、Pan、适应窗口、键盘微调。',
      '支持节点锁定、Shift 多选、顶部/居中对齐、水平均分、四角 Resize。',
      '自动扩画布，拖到右侧/底部不会被裁切。'
    ]
  },
  {
    version: 'v1.0.3',
    date: '2026-10-20',
    items: [
      '顶部股东连接核心主体改为单条公共总线。',
      '核心主体到直接投资公司改为单条下级总线。',
      '比例标签重新布局并增加碰撞检测、边界保护。',
      '英文机构名保留词间空格并按单词换行。',
      'SVG 宽度动态计算，页面横向滚动不压缩、不裁切。'
    ]
  },
  {
    version: 'v1.0.2',
    date: '2026-10-20',
    items: [
      '新增统一下载窗口：SVG / PNG / Excel / PDF。',
      '导出前自动保存当前人工修改。'
    ]
  },
  {
    version: 'v1.0.1',
    date: '2026-10-20',
    items: [
      '支持待确认草稿“继续识别”，上传后直接进入字段确认。',
      '修复上传后看起来卡在“待确认”的交互问题。'
    ]
  },
  {
    version: 'v1.0.0',
    date: '2026-10-20',
    items: [
      '初始版本：大图上传、SHA256 缓存、历史任务、进度轮询。',
      'OOXML 大图切片、多尺度 PaddleOCR、重叠去重。',
      '节点框检测（暖色节点、白底蓝框、橙色个人股东）。',
      '横线/竖线检测、显式线段拓扑、层级聚类、核心主体识别。',
      '持股比例全局 OCR + 二次裁图多版本投票。',
      '公司字典 RapidFuzz 纠错、注销企业识别与出图过滤。',
      '结果 JSON、Dashboard、节点/关系/OCR 文字/纠错/排除展示。',
      'Excel、PDF、SVG、PNG 导出初版。'
    ]
  }
];

const state = {
  meta: null,
  file: null,
  job: null,
  data: null,
  zoom: 1,
  tab: 'nodes',
  nodeSearch: '',
  edgeSearch: '',
  pollTimer: null,
  toastTimer: null,
  dirty: false,
  editor: {
    nodes: {},
    labels: {},
    buses: {},
    selectedNodes: new Set(),
    selectedLabel: null,
    history: [],
    future: [],
    drag: null,
    renderInfo: null,
    panning: false,
    spaceDown: false,
    saveTimer: null,
    raf: null,
    zoom: 1
  }
};

const els = {
  fileInput: $('#fileInput'), dropZone: $('#dropZone'), selectedFile: $('#selectedFile'),
  fileName: $('#fileName'), fileMeta: $('#fileMeta'), clearFileButton: $('#clearFileButton'),
  uploadProgress: $('#uploadProgress'), uploadProgressBar: $('#uploadProgressBar'),
  uploadProgressText: $('#uploadProgressText'), uploadButton: $('#uploadButton'),
  uploadError: $('#uploadError'), imagePreview: $('#imagePreview'), previewImage: $('#previewImage'),
  uploadPanel: $('#uploadPanel'), startPanel: $('#startPanel'), startSubtitle: $('#startSubtitle'),
  startPreview: $('#startPreview'), startPreviewImage: $('#startPreviewImage'),
  draftStatus: $('#draftStatus'), startButton: $('#startButton'), startError: $('#startError'),
  processPanel: $('#processPanel'), processMessage: $('#processMessage'), jobStatus: $('#jobStatus'),
  progressBar: $('#progressBar'), progressValue: $('#progressValue'), jobIdLabel: $('#jobIdLabel'),
  processNote: $('#processNote'), processError: $('#processError'),
  resultPanel: $('#resultPanel'), resultSubtitle: $('#resultSubtitle'), resultMetrics: $('#resultMetrics'),
  resultWarnings: $('#resultWarnings'), chartWrap: $('#chartWrap'), chartMeta: $('#chartMeta'),
  zoomLabel: $('#zoomLabel'), zoomIn: $('#zoomIn'), zoomOut: $('#zoomOut'), zoomReset: $('#zoomReset'),
  saveButton: $('#saveButton'), redrawButton: $('#redrawButton'), svgButton: $('#svgButton'),
  pngButton: $('#pngButton'), xlsxButton: $('#xlsxButton'), pdfButton: $('#pdfButton'),
  sourceLink: $('#sourceLink'), nodeSearch: $('#nodeSearch'), nodeTable: $('#nodeTable'),
  edgeSearch: $('#edgeSearch'), edgeTable: $('#edgeTable'), ocrText: $('#ocrText'),
  reviewGrid: $('#reviewGrid'), correctionsList: $('#correctionsList'), excludedList: $('#excludedList'),
  correctionForm: $('#correctionForm'), correctionOriginal: $('#correctionOriginal'),
  correctionCorrected: $('#correctionCorrected'), jsonEditor: $('#jsonEditor'),
  applyJsonButton: $('#applyJsonButton'), jsonError: $('#jsonError'),
  downloadButton: $('#downloadButton'), downloadBackdrop: $('#downloadBackdrop'),
  downloadDialog: $('#downloadDialog'), closeDownloadButton: $('#closeDownloadButton'),
  downloadStatus: $('#downloadStatus'), downloadSvgButton: $('#downloadSvgButton'),
  downloadPngButton: $('#downloadPngButton'), downloadXlsxButton: $('#downloadXlsxButton'),
  downloadPdfButton: $('#downloadPdfButton'), downloadDebugSvgButton: $('#downloadDebugSvgButton'),
  historyList: $('#historyList'), refreshHistoryButton: $('#refreshHistoryButton'),
  newJobButton: $('#newJobButton'), toast: $('#toast'),
  undoButton: $('#undoButton'), redoButton: $('#redoButton'),
  fitButton: $('#fitButton'), saveLayoutButton: $('#saveLayoutButton'),
  resetLayoutButton: $('#resetLayoutButton'), layoutStatus: $('#layoutStatus'),
  alignTopButton: $('#alignTopButton'), alignCenterButton: $('#alignCenterButton'), distributeButton: $('#distributeButton'),
  versionButton: $('#versionButton'), versionBackdrop: $('#versionBackdrop'), versionDialog: $('#versionDialog'),
  closeVersionButton: $('#closeVersionButton'), versionList: $('#versionList')
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[char]));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function fmtBytes(bytes) {
  const number = Number(bytes) || 0;
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(2)} MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${number} B`;
}
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}
function showError(node, message) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || '';
}
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) { location.replace('/login'); throw new Error('请先登录。'); }
  let payload = null;
  if ((response.headers.get('content-type') || '').includes('application/json')) {
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
function badge(text, tone = 'gray') { return el('span', { class: `badge ${tone}`, text }); }
function statusLabel(status) {
  return { draft: '待识别', queued: '已排队', running: '识别中', completed: '已完成', failed: '失败' }[status] || status || '—';
}
function statusTone(status) {
  return { draft: 'gray', queued: 'blue', running: 'blue', completed: 'green', failed: 'red' }[status] || 'gray';
}
function setJobStatus(node, status) {
  if (!node) return;
  node.textContent = String(status || '—').toUpperCase();
  node.className = `job-status ${status || ''}`;
}
function stopPolling() { clearInterval(state.pollTimer); state.pollTimer = null; }

/* ---------------------------------------------------------------- upload */

function validateFile(file) {
  if (!file) return '请选择图片。';
  const name = String(file.name || '').toLowerCase();
  if (!/\.(png|jpe?g|webp)$/.test(name)) return '仅支持 PNG / JPG / WebP 图片。';
  const max = state.meta?.maxFileSizeBytes || 100 * 1024 * 1024;
  if (file.size > max) return `图片超过 ${fmtBytes(max)} 限制。`;
  return '';
}

function setFile(file) {
  const error = validateFile(file);
  if (error) return showError(els.uploadError, error);
  state.file = file;
  showError(els.uploadError, '');
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${fmtBytes(file.size)} · 等待上传`;
  els.selectedFile.hidden = false;
  els.uploadButton.disabled = false;
  els.previewImage.src = URL.createObjectURL(file);
  els.imagePreview.hidden = false;
}

function clearFile() {
  state.file = null;
  els.fileInput.value = '';
  els.selectedFile.hidden = true;
  els.imagePreview.hidden = true;
  els.uploadButton.disabled = true;
}

function uploadFile() {
  if (!state.file) return;
  els.uploadButton.disabled = true;
  els.uploadProgress.hidden = false;
  els.uploadProgressBar.style.width = '0%';
  showError(els.uploadError, '');
  const form = new FormData();
  form.append('file', state.file);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', API);
  xhr.responseType = 'json';
  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 90);
    els.uploadProgressBar.style.width = `${percent}%`;
    els.uploadProgressText.textContent = `正在上传… ${percent}%`;
  });
  xhr.addEventListener('load', () => {
    els.uploadProgress.hidden = true;
    els.uploadButton.disabled = false;
    if (xhr.status === 401) return location.replace('/login');
    const payload = xhr.response || {};
    if (xhr.status !== 200 && xhr.status !== 201) {
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

function setPreview(job) {
  const url = `${API}/${job.id}/source?ts=${Date.now()}`;
  els.startPreviewImage.src = url;
  els.startPreview.hidden = false;
  els.sourceLink.href = url;
  els.sourceLink.hidden = false;
}

function handleUploaded(payload) {
  state.job = payload.job;
  if (!state.job) return;
  els.uploadPanel.hidden = true;
  els.startPanel.hidden = false;
  els.processPanel.hidden = true;
  els.resultPanel.hidden = true;
  setJobStatus(els.draftStatus, state.job.status);
  setPreview(state.job);
  if (state.job.status === 'completed') {
    els.startPanel.hidden = true;
    els.startButton.disabled = false;
    loadResult(state.job);
    return;
  }
  els.startSubtitle.textContent = payload.cached
    ? '已找到相同图片的历史结果，正在打开…'
    : '图片已就绪。识别可能需要数分钟，页面会显示实时进度。';
  els.startButton.disabled = false;
  showError(els.startError, '');
  els.startPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ----------------------------------------------------------------- start */

async function startRecognition() {
  if (!state.job) return;
  els.startButton.disabled = true;
  showError(els.startError, '');
  try {
    const payload = await api(`/${state.job.id}/start`, { method: 'POST' });
    state.job = payload.job;
    els.startPanel.hidden = true;
    showProcess();
    pollJob();
  } catch (error) {
    showError(els.startError, error.message);
    els.startButton.disabled = false;
  }
}

function showProcess() {
  els.processPanel.hidden = false;
  els.processError.hidden = true;
  setJobStatus(els.jobStatus, state.job?.status || 'queued');
  updateProcess(state.job || { progress: 0, status: 'queued' });
  els.processPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateProcess(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  els.progressBar.style.width = `${progress}%`;
  els.progressValue.textContent = `${progress}%`;
  els.processMessage.textContent = job.progressMessage || '正在处理…';
  setJobStatus(els.jobStatus, job.status);
  if (job.id) els.jobIdLabel.textContent = `任务 ${job.id.slice(0, 8)}`;
}

function pollJob() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    try {
      const payload = await api(`/${state.job.id}`);
      state.job = payload.job;
      updateProcess(state.job);
      if (state.job.status === 'completed') {
        stopPolling();
        await loadResult(state.job);
      } else if (state.job.status === 'failed') {
        stopPolling();
        showError(els.processError, state.job.error || '识别失败，请重新开始。');
        els.startButton.disabled = false;
      }
    } catch (error) {
      stopPolling();
      showError(els.processError, error.message);
      els.startButton.disabled = false;
    }
  }, 1500);
}

async function loadResult(job) {
  state.job = job;
  try {
    const data = await api(`/${job.id}/result`);
    state.data = data;
    const layoutPayload = await api(`/${job.id}/layout`).catch(() => null);
    const savedLayout = layoutPayload && layoutPayload.layout ? layoutPayload.layout : null;
    state.editor.nodes = savedLayout && savedLayout.nodes ? savedLayout.nodes : {};
    state.editor.labels = savedLayout && savedLayout.labels ? savedLayout.labels : {};
    state.editor.buses = savedLayout && savedLayout.buses ? savedLayout.buses : {};
    state.editor.selectedNodes = new Set();
    state.editor.selectedLabel = null;
    state.editor.history = [];
    state.editor.future = [];
    state.editor.zoom = 1;
    state.dirty = false;
    els.processPanel.hidden = true;
    els.startPanel.hidden = true;
    els.resultPanel.hidden = false;
    setPreview(job);
    renderResult();
    await loadHistory();
  } catch (error) {
    showError(els.processError, error.message);
  }
}

/* ----------------------------------------------------------------- result */

function renderResult() {
  const data = state.data;
  if (!data) return;
  ensureEdgeIds(data);
  els.resultSubtitle.textContent = `${data.title || '股权结构图'} · ${data.diagnostics?.image_width || '?'}×${data.diagnostics?.image_height || '?'} · ${data.nodes?.length || 0} 个节点 / ${data.edges?.length || 0} 条关系`;
  renderMetrics();
  renderWarnings();
  renderChart();
  renderNodeTable();
  renderEdgeTable();
  renderOcrText();
  renderReview();
  renderCorrections();
  renderExcluded();
  syncJsonEditor();
  els.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMetrics() {
  const data = state.data;
  const activeNodes = (data.nodes || []).filter((node) => node.status !== 'excluded_cancelled').length;
  const cards = [
    ['节点', String(data.nodes?.length || 0), ''],
    ['有效节点', String(activeNodes), 'accent'],
    ['投资关系', String(data.edges?.length || 0), ''],
    ['核心主体', data.core_company || '—', 'accent'],
    ['总体置信度', data.quality?.overall_confidence ?? '—', 'ok'],
    ['已排除', String(data.excluded?.length || 0), 'warn'],
    ['字典纠错', String(data.dictionary_corrections?.length || 0), ''],
    ['切片数', String(data.diagnostics?.tile_count || 0), '']
  ];
  clear(els.resultMetrics);
  for (const [label, value, tone] of cards) {
    els.resultMetrics.append(el('div', { class: `metric ${tone}`.trim() }, [
      el('span', { text: label }),
      el('strong', { text: value }),
      el('small', { text: tone === 'ok' ? '人工复核后再用于底稿' : '' })
    ]));
  }
}

function renderWarnings() {
  const warnings = state.data.warnings || [];
  els.resultWarnings.hidden = warnings.length === 0;
  els.resultWarnings.textContent = warnings.join('；');
}

const LAYOUT = {
  chartPaddingX: 80,
  chartPaddingY: 50,
  siblingGap: 18,
  levelGap: 160,
  shareholderBusRatio: 0.42,
  directChildBusRatio: 0.45,
  minBusGap: 30,
  nodePaddingX: 18,
  nodePaddingY: 12,
  minNodeWidth: 130,
  minNodeHeight: 48,
  maxNodeWidth: 300,
  coreNodeWidth: 430,
  edgeLabelOffsetX: 8,
  edgeLabelPaddingX: 5,
  edgeLabelPaddingY: 3,
  labelCollisionGap: 6,
  labelHeight: 17,
  maxCanvasDimension: 16000,
  maxCanvasPixels: 120000000
};

function normalizeDisplayText(value) {
  let text = String(value ?? '').normalize('NFKC')
    .replace(/％/g, '%')
    .replace(/[—–－]/g, '-')
    .replace(/\u00a0/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  // Remove spaces inside Chinese text, but never remove spaces between Latin words.
  text = text.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
  return text;
}

function wrapWords(text, maxChars) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > maxChars) {
      if (line) { lines.push(line); line = ''; }
      for (let index = 0; index < word.length; index += maxChars) {
        const piece = word.slice(index, index + maxChars);
        if (piece.length === maxChars) lines.push(piece);
        else line = piece;
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function wrapName(text, maxChars) {
  const normalized = normalizeDisplayText(text);
  if (!normalized) return [''];
  const cjkCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (normalized.match(/[A-Za-z]/g) || []).length;
  if (latinCount > 0 && (cjkCount === 0 || normalized.includes(' '))) {
    return wrapWords(normalized, maxChars);
  }
  const lines = [];
  for (let index = 0; index < normalized.length; index += maxChars) {
    lines.push(normalized.slice(index, index + maxChars));
  }
  return lines.length ? lines : [''];
}

function nodeCenter(node) {
  if (Array.isArray(node.bbox) && node.bbox.length === 4) {
    return [(Number(node.bbox[0]) + Number(node.bbox[2])) / 2, (Number(node.bbox[1]) + Number(node.bbox[3])) / 2];
  }
  return [0, 0];
}

function ensureEdgeIds(data) {
  (data.edges || []).forEach((edge, index) => {
    if (!edge.__id) edge.__id = `e${index + 1}`;
  });
}

function buildLayout() {
  const data = state.data;
  const active = (data.nodes || []).filter((node) => node.status !== 'excluded_cancelled');
  if (!active.length) return { width: 1200, height: 400, positions: new Map(), levels: [] };
  const levels = {};
  for (const node of active) {
    const level = Number(node.level) || 1;
    (levels[level] ||= []).push(node);
  }
  const levelKeys = Object.keys(levels).map(Number).sort((a, b) => a - b);
  for (const level of levelKeys) {
    levels[level].sort((a, b) => {
      const [ax] = nodeCenter(a);
      const [bx] = nodeCenter(b);
      if (ax !== bx) return ax - bx;
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
  }

  const rows = [];
  for (const level of levelKeys) {
    const entries = levels[level].map((node) => {
      const core = node.name === data.core_company;
      const chars = core ? 26 : 16;
      const lines = wrapName(node.name, chars);
      const charWidth = core ? 19 : 14;
      const width = Math.max(
        core ? LAYOUT.coreNodeWidth : LAYOUT.minNodeWidth,
        Math.min(LAYOUT.maxNodeWidth, Math.max(...lines.map((line) => line.length)) * charWidth + LAYOUT.nodePaddingX * 2 + 12)
      );
      const lineHeight = core ? 28 : 22;
      const height = Math.max(core ? 90 : 70, lines.length * lineHeight + LAYOUT.nodePaddingY * 2);
      return { node, lines, width, height, core };
    });
    const total = entries.reduce((sum, entry) => sum + entry.width, 0) + LAYOUT.siblingGap * Math.max(0, entries.length - 1);
    rows.push({ level, entries, total });
  }
  const maxWidth = Math.max(...rows.map((row) => row.total), LAYOUT.minNodeWidth);
  const width = Math.max(1000, maxWidth + LAYOUT.chartPaddingX * 2);
  const top = LAYOUT.chartPaddingY + 36;
  const bottomLevel = levelKeys[levelKeys.length - 1];
  const maxRowHeight = Math.max(...rows.flatMap((row) => row.entries.map((entry) => entry.height)), 70);
  const height = top + (bottomLevel - 1) * LAYOUT.levelGap + maxRowHeight + LAYOUT.chartPaddingY + 42;
  const positions = new Map();
  for (const row of rows) {
    let x = (width - row.total) / 2;
    const y = top + (row.level - 1) * LAYOUT.levelGap;
    for (const entry of row.entries) {
      positions.set(entry.node.id, { ...entry, x, y });
      x += entry.width + LAYOUT.siblingGap;
    }
  }

  for (const [id, override] of Object.entries(state.editor.nodes || {})) {
    const position = positions.get(id);
    if (!position || !override) continue;
    const x = Number.isFinite(Number(override.x)) ? Number(override.x) : position.x;
    const y = Number.isFinite(Number(override.y)) ? Number(override.y) : position.y;
    const width = Math.max(LAYOUT.minNodeWidth, Number(override.width) || position.width);
    const height = Math.max(LAYOUT.minNodeHeight, Number(override.height) || position.height);
    const charWidth = position.core ? 19 : 14;
    const charsPerLine = Math.max(8, Math.floor((width - LAYOUT.nodePaddingX * 2) / charWidth));
    const lines = wrapName(position.node.name, charsPerLine);
    positions.set(id, { ...position, x, y, width, height, lines, manual: true, locked: Boolean(override.locked) });
  }

  let maxRight = 0;
  let maxBottom = 0;
  for (const position of positions.values()) {
    maxRight = Math.max(maxRight, position.x + position.width);
    maxBottom = Math.max(maxBottom, position.y + position.height);
  }
  return {
    width: Math.max(width, maxRight + LAYOUT.chartPaddingX),
    height: Math.max(height, maxBottom + LAYOUT.chartPaddingY + 30),
    positions,
    levels: levelKeys
  };
}

function edgePoints(parent, child) {
  const x1 = parent.x + parent.width / 2;
  const y1 = parent.y + parent.height;
  const x2 = child.x + child.width / 2;
  const y2 = child.y;
  const mid = y1 + Math.max(36, (y2 - y1) / 2);
  return { x1, y1, x2, y2, mid };
}

function boxesOverlap(a, b, gap = 0) {
  return !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y);
}

function makeLabel(text, x, y, width, height) {
  return { text, x, y, width, height };
}

function placeLabel(label, placed, nodeBoxes, layout, preferredDirection = 'up') {
  const attempts = [
    [0, 0], [10, 0], [-10, 0], [0, -10], [0, 10],
    [-10, -10], [10, 10], [0, -18], [0, 18], [-18, 0], [18, 0]
  ];
  const minX = LAYOUT.chartPaddingX;
  const maxX = layout.width - LAYOUT.chartPaddingX - label.width;
  const minY = LAYOUT.chartPaddingY;
  const maxY = layout.height - LAYOUT.chartPaddingY - label.height;
  for (const [dx, dy] of attempts) {
    const candidate = {
      ...label,
      x: Math.max(minX, Math.min(maxX, label.x + dx)),
      y: Math.max(minY, Math.min(maxY, label.y + dy))
    };
    if (placed.some((box) => boxesOverlap(candidate, box, LAYOUT.labelCollisionGap))) continue;
    if (nodeBoxes.some((box) => boxesOverlap(candidate, box, 4))) continue;
    if (preferredDirection === 'up' && candidate.y + candidate.height > label.busY - 4) continue;
    if (preferredDirection === 'down' && candidate.y < label.busY + 4) continue;
    placed.push(candidate);
    return candidate;
  }
  const fallback = {
    ...label,
    x: Math.max(minX, Math.min(maxX, label.x)),
    y: Math.max(minY, Math.min(maxY, label.y))
  };
  placed.push(fallback);
  return fallback;
}

function buildRoutes(layout, exportMode = false) {
  const data = state.data;
  const positions = layout.positions;
  const edges = (data.edges || []).filter((edge) => positions.has(edge.source) && positions.has(edge.target));
  const core = (data.nodes || []).find((node) => node.name === data.core_company)
    || (data.nodes || []).find((node) => Number(node.level) === 2 && node.status !== 'excluded_cancelled');
  const corePosition = core ? positions.get(core.id) : null;
  const used = new Set();
  const paths = [];
  const rawLabels = [];
  const nodeBoxes = [...positions.values()].map((position) => ({
    x: position.x, y: position.y, width: position.width, height: position.height
  }));

  const addArrow = (x, y) => {
    paths.push(`<polygon points="${x - 4},${y - 8} ${x + 4},${y - 8} ${x},${y}" fill="#777d83"/>`);
  };
  const addLabel = (edge, x, y, busY, direction) => {
    if (!edge || !edge.percentage) return;
    const width = Math.max(34, normalizeDisplayText(edge.percentage).length * 7 + LAYOUT.edgeLabelPaddingX * 2);
    rawLabels.push({
      id: edge.__id,
      text: edge.percentage,
      x,
      y: y - LAYOUT.labelHeight + 4,
      width,
      height: LAYOUT.labelHeight,
      busY,
      direction
    });
  };

  if (corePosition) {
    const shareholderEdges = edges.filter((edge) => edge.relation === 'shareholder_to_core');
    const shareholders = [...new Map(shareholderEdges.map((edge) => [edge.source, positions.get(edge.source)])).values()];
    if (shareholders.length) {
      shareholderEdges.forEach((edge) => used.add(edge));
      const bottomMax = Math.max(...shareholders.map((position) => position.y + position.height));
      const availableGap = Math.max(LAYOUT.minBusGap * 2, corePosition.y - bottomMax);
      let busY = bottomMax + availableGap * LAYOUT.shareholderBusRatio;
      busY = Math.max(busY, bottomMax + LAYOUT.minBusGap);
      busY = Math.min(busY, corePosition.y - 35);
      if (busY <= bottomMax) busY = (bottomMax + corePosition.y) / 2;
      const shareholderBus = state.editor.buses.shareholder;
      if (shareholderBus && shareholderBus.manual && Number.isFinite(Number(shareholderBus.y))) {
        busY = Number(shareholderBus.y);
      }

      const xs = shareholders.map((position) => position.x + position.width / 2);
      const coreX = corePosition.x + corePosition.width / 2;
      for (const position of shareholders) {
        const x = position.x + position.width / 2;
        paths.push(`<path d="M${x} ${position.y + position.height} V${busY}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
      }
      paths.push(`<path data-role="shareholder-bus" d="M${Math.min(...xs)} ${busY} H${Math.max(...xs)}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
      paths.push(`<path data-role="shareholder-core" d="M${coreX} ${busY} V${corePosition.y}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
      addArrow(coreX, corePosition.y);

      for (const edge of shareholderEdges) {
        const position = positions.get(edge.source);
        const x = position.x + position.width / 2;
        const segmentLength = busY - (position.y + position.height);
        if (!edge.percentage) continue;
        const y = segmentLength <= 22 ? busY - 10 : position.y + position.height + segmentLength * 0.55;
        addLabel(edge, x + LAYOUT.edgeLabelOffsetX, y, busY, 'up');
      }
    }

    const directEdges = edges.filter((edge) => !used.has(edge) && edge.source === core.id && edge.relation === 'investment');
    const directChildren = [...new Map(directEdges.map((edge) => [edge.target, positions.get(edge.target)])).values()];
    if (directChildren.length) {
      directEdges.forEach((edge) => used.add(edge));
      const coreBottom = corePosition.y + corePosition.height;
      const childTopMin = Math.min(...directChildren.map((position) => position.y));
      const availableGap = Math.max(LAYOUT.minBusGap * 2, childTopMin - coreBottom);
      let childBusY = coreBottom + availableGap * LAYOUT.directChildBusRatio;
      childBusY = Math.max(childBusY, coreBottom + LAYOUT.minBusGap);
      childBusY = Math.min(childBusY, childTopMin - LAYOUT.minBusGap);
      if (childBusY <= coreBottom) childBusY = (coreBottom + childTopMin) / 2;
      const directBus = state.editor.buses.direct;
      if (directBus && directBus.manual && Number.isFinite(Number(directBus.y))) {
        childBusY = Number(directBus.y);
      }

      const xs = directChildren.map((position) => position.x + position.width / 2);
      const coreX = corePosition.x + corePosition.width / 2;
      paths.push(`<path data-role="direct-core" d="M${coreX} ${coreBottom} V${childBusY}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
      paths.push(`<path data-role="direct-bus" d="M${Math.min(...xs, coreX)} ${childBusY} H${Math.max(...xs, coreX)}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
      for (const position of directChildren) {
        const x = position.x + position.width / 2;
        paths.push(`<path d="M${x} ${childBusY} V${position.y}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
        addArrow(x, position.y);
      }
      for (const edge of directEdges) {
        const position = positions.get(edge.target);
        const x = position.x + position.width / 2;
        const segmentLength = position.y - childBusY;
        if (!edge.percentage) continue;
        const y = childBusY + Math.max(10, segmentLength * 0.55);
        addLabel(edge, x + LAYOUT.edgeLabelOffsetX, y, childBusY, 'down');
      }
    }
  }

  for (const edge of edges) {
    if (used.has(edge)) continue;
    const parent = positions.get(edge.source);
    const child = positions.get(edge.target);
    const { x1, y1, x2, y2, mid } = edgePoints(parent, child);
    paths.push(`<path d="M${x1} ${y1} V${mid} H${x2} V${y2}" fill="none" stroke="#777d83" stroke-width="1.4"/>`);
    addArrow(x2, y2);
    if (edge.percentage) {
      const segmentLength = Math.abs(y2 - mid);
      const y = segmentLength <= 22 ? y2 - 10 : mid + (y2 - mid) * 0.55;
      addLabel(edge, (Math.abs(x2 - x1) < 12 ? x2 : (x1 + x2) / 2) + LAYOUT.edgeLabelOffsetX, y, mid, 'down');
    }
  }

  const placed = [];
  const labelItems = [];
  const labels = rawLabels.map((label) => {
    const manual = state.editor.labels[label.id];
    let placedLabel;
    if (manual && manual.manual && Number.isFinite(Number(manual.x)) && Number.isFinite(Number(manual.y))) {
      placedLabel = {
        ...label,
        x: Math.max(LAYOUT.chartPaddingX, Math.min(layout.width - LAYOUT.chartPaddingX - label.width, Number(manual.x))),
        y: Math.max(LAYOUT.chartPaddingY, Math.min(layout.height - LAYOUT.chartPaddingY - label.height, Number(manual.y)))
      };
      placed.push(placedLabel);
    } else {
      placedLabel = placeLabel(label, placed, nodeBoxes, layout, label.direction);
    }
    labelItems.push(placedLabel);
    const selected = !exportMode && state.editor.selectedLabel === label.id;
    return `<g class="percentage-label${selected ? ' is-selected' : ''}" data-edge-id="${esc(label.id)}"><rect x="${placedLabel.x}" y="${placedLabel.y}" width="${placedLabel.width}" height="${placedLabel.height}" rx="3" fill="#ffffff"/>
<text x="${placedLabel.x + LAYOUT.edgeLabelPaddingX}" y="${placedLabel.y + placedLabel.height - 5}" font-size="11" fill="#333333">${esc(placedLabel.text)}</text></g>`;
  });
  return { paths, labels, labelItems };
}

function buildSvgString(exportMode = false) {
  const data = state.data;
  const layout = buildLayout();
  const positions = layout.positions;
  const routes = buildRoutes(layout, exportMode);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="PingFang SC, Noto Sans CJK SC, Noto Sans SC, Microsoft YaHei, Arial Unicode MS, WenQuanYi Zen Hei, sans-serif">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="${layout.width / 2}" y="${LAYOUT.chartPaddingY + 2}" text-anchor="middle" font-size="28" font-weight="700" fill="#17191c">${esc(data.title || '股权结构图')}</text>`
  ];
  parts.push(...routes.paths);
  parts.push(...routes.labels);
  for (const node of data.nodes || []) {
    if (node.status === 'excluded_cancelled') continue;
    const position = positions.get(node.id);
    if (!position) continue;
    const fill = position.core ? '#fff2db' : '#fff8ee';
    const stroke = position.core ? '#c67d18' : '#d49a43';
    const selected = !exportMode && state.editor.selectedNodes.has(node.id);
    parts.push(`<g class="node-group${selected ? ' is-selected' : ''}" data-node-id="${esc(node.id)}" data-name="${esc(node.name)}" aria-label="${esc(node.name)}"><title>${esc(node.name)}</title>`);
    parts.push(`<rect x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${position.core ? 2 : 1.35}"/>`);
    const fontSize = position.core ? 21 : 15;
    const lineHeight = position.core ? 28 : 22;
    const startY = position.y + position.height / 2 - (position.lines.length * lineHeight) / 2 + fontSize;
    position.lines.forEach((line, index) => {
      parts.push(`<text x="${position.x + position.width / 2}" y="${startY + index * lineHeight}" text-anchor="middle" font-size="${fontSize}" font-weight="${position.core ? 700 : 500}" fill="#17191c">${esc(line)}</text>`);
    });
    if (!exportMode && selected) {
      const corners = [
        ['nw', position.x, position.y],
        ['ne', position.x + position.width, position.y],
        ['sw', position.x, position.y + position.height],
        ['se', position.x + position.width, position.y + position.height]
      ];
      for (const [corner, hx, hy] of corners) {
        parts.push(`<rect class="resize-handle" data-resize="${corner}" data-node-id="${esc(node.id)}" x="${hx - 5}" y="${hy - 5}" width="10" height="10" rx="2" fill="#ffffff" stroke="#1261d6" stroke-width="1.5"/>`);
      }
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return { svg: parts.join('\n'), width: layout.width, height: layout.height, layout, labelItems: routes.labelItems };
}

function scheduleRender() {
  if (state.editor.raf) return;
  state.editor.raf = requestAnimationFrame(() => {
    state.editor.raf = null;
    renderChart();
  });
}

function renderChart() {
  if (!state.data || !(state.data.nodes || []).some((node) => node.status !== 'excluded_cancelled')) {
    els.chartWrap.innerHTML = '<div class="empty-state">没有可绘制的有效节点。</div>';
    els.chartMeta.textContent = '—';
    return;
  }
  const built = buildSvgString(false);
  state.editor.renderInfo = built;
  const existing = els.chartWrap.querySelector('svg');
  if (existing) {
    existing.setAttribute('width', String(built.width));
    existing.setAttribute('height', String(built.height));
    existing.setAttribute('viewBox', `0 0 ${built.width} ${built.height}`);
    const inner = built.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    existing.innerHTML = inner;
    existing.style.width = `${built.width * state.editor.zoom}px`;
    existing.style.height = `${built.height * state.editor.zoom}px`;
  } else {
    els.chartWrap.innerHTML = built.svg;
    const target = els.chartWrap.querySelector('svg');
    if (target) {
      target.style.width = `${built.width * state.editor.zoom}px`;
      target.style.height = `${built.height * state.editor.zoom}px`;
    }
  }
  els.zoomLabel.textContent = `${Math.round(state.editor.zoom * 100)}%`;
  els.chartMeta.textContent = `${built.width}×${built.height} · 可拖动节点/比例 · 可滚动、缩放`;
}

function snapshotLayout() {
  return {
    nodes: JSON.parse(JSON.stringify(state.editor.nodes || {})),
    labels: JSON.parse(JSON.stringify(state.editor.labels || {})),
    buses: JSON.parse(JSON.stringify(state.editor.buses || {}))
  };
}

function restoreLayout(snapshot) {
  state.editor.nodes = snapshot.nodes || {};
  state.editor.labels = snapshot.labels || {};
  state.editor.buses = snapshot.buses || {};
  state.editor.selectedNodes = new Set([...state.editor.selectedNodes].filter((id) => state.editor.nodes[id] || true));
  renderChart();
}

function pushHistory(before) {
  if (!before) return;
  const after = snapshotLayout();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  state.editor.history.push(before);
  if (state.editor.history.length > 50) state.editor.history.shift();
  state.editor.future = [];
}

function undoLayout() {
  const previous = state.editor.history.pop();
  if (!previous) return;
  state.editor.future.push(snapshotLayout());
  restoreLayout(previous);
  scheduleLayoutSave();
  setLayoutStatus('已撤销。', '');
}

function redoLayout() {
  const next = state.editor.future.pop();
  if (!next) return;
  state.editor.history.push(snapshotLayout());
  restoreLayout(next);
  scheduleLayoutSave();
  setLayoutStatus('已重做。', '');
}

function setLayoutStatus(message, tone = '') {
  if (!els.layoutStatus) return;
  els.layoutStatus.textContent = message;
  els.layoutStatus.className = `editor-hint ${tone}`.trim();
}

function layoutPayload() {
  const info = state.editor.renderInfo;
  return {
    version: 1,
    nodes: state.editor.nodes,
    labels: state.editor.labels,
    buses: state.editor.buses,
    canvas: info ? { width: info.width, height: info.height } : {}
  };
}

async function saveLayout({ silent = false } = {}) {
  if (!state.job || !state.data) return false;
  try {
    setLayoutStatus('正在保存布局…', 'saving');
    await api(`/${state.job.id}/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layoutPayload())
    });
    setLayoutStatus('布局已保存。', 'saved');
    if (!silent) toast('布局已保存。');
    return true;
  } catch (error) {
    setLayoutStatus(`布局保存失败：${error.message}`, 'error');
    if (!silent) toast(`布局保存失败：${error.message}`);
    return false;
  }
}

function scheduleLayoutSave() {
  clearTimeout(state.editor.saveTimer);
  setLayoutStatus('有未保存的布局调整…', '');
  state.editor.saveTimer = setTimeout(() => saveLayout({ silent: true }), 1400);
}

function screenToSvg(event) {
  const svg = els.chartWrap.querySelector('svg');
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  return point.matrixTransform(matrix.inverse());
}

function nodeLayoutPosition(id) {
  const info = state.editor.renderInfo;
  return info && info.layout ? info.layout.positions.get(id) : null;
}

function selectNode(id, additive) {
  if (!additive) state.editor.selectedNodes.clear();
  if (additive && state.editor.selectedNodes.has(id)) state.editor.selectedNodes.delete(id);
  else state.editor.selectedNodes.add(id);
  state.editor.selectedLabel = null;
  renderChart();
}

function selectLabel(id) {
  state.editor.selectedNodes.clear();
  state.editor.selectedLabel = id;
  renderChart();
}

function onCanvasPointerDown(event) {
  if (!state.data) return;
  const target = event.target;
  const resizeHandle = target.closest('.resize-handle');
  const labelGroup = target.closest('.percentage-label');
  const nodeGroup = target.closest('.node-group');
  const svg = els.chartWrap.querySelector('svg');
  if (!svg) return;

  // Background: pan with Space or middle mouse; otherwise clear selection.
  if (!labelGroup && !nodeGroup) {
    if (state.editor.spaceDown || event.button === 1) {
      event.preventDefault();
      startPan(event, svg);
      return;
    }
    if (event.button === 0) {
      state.editor.selectedNodes.clear();
      state.editor.selectedLabel = null;
      renderChart();
    }
    return;
  }

  if (resizeHandle) {
    const id = resizeHandle.dataset.nodeId;
    const position = nodeLayoutPosition(id);
    if (!position || position.locked) return;
    event.preventDefault();
    event.stopPropagation();
    startDrag(event, 'resize', { id, corner: resizeHandle.dataset.resize });
    return;
  }

  if (labelGroup) {
    const id = labelGroup.dataset.edgeId;
    const label = (state.editor.renderInfo?.labelItems || []).find((item) => item.id === id);
    if (!label) return;
    selectLabel(id);
    startDrag(event, 'label', { id, x: label.x, y: label.y });
    return;
  }

  if (nodeGroup) {
    const id = nodeGroup.dataset.nodeId;
    const position = nodeLayoutPosition(id);
    if (!position) return;
    if (!event.shiftKey && !state.editor.selectedNodes.has(id)) {
      state.editor.selectedNodes.clear();
    }
    if (event.shiftKey) {
      if (state.editor.selectedNodes.has(id)) state.editor.selectedNodes.delete(id);
      else state.editor.selectedNodes.add(id);
    } else {
      state.editor.selectedNodes.add(id);
    }
    state.editor.selectedLabel = null;
    renderChart();
    startDrag(event, 'node', { id });
  }
}

function startDrag(event, type, payload) {
  const svg = els.chartWrap.querySelector('svg');
  if (!svg) return;
  const start = screenToSvg(event);
  if (!start) return;
  event.preventDefault();
  try { svg.setPointerCapture(event.pointerId); } catch (_) {}
  const before = snapshotLayout();
  const positions = {};
  if (type === 'resize') {
    const position = nodeLayoutPosition(payload.id);
    if (!position || position.locked) return;
    positions[payload.id] = { x: position.x, y: position.y, width: position.width, height: position.height };
  } else {
    for (const id of state.editor.selectedNodes) {
      const position = nodeLayoutPosition(id);
      if (!position || position.locked) continue;
      positions[id] = { x: position.x, y: position.y, width: position.width, height: position.height };
    }
  }
  state.editor.drag = {
    type, payload, start, positions, before,
    pointerId: event.pointerId, moved: false
  };
  const onMove = (moveEvent) => {
    if (!state.editor.drag || moveEvent.pointerId !== state.editor.drag.pointerId) return;
    const drag = state.editor.drag;
    const current = screenToSvg(moveEvent);
    if (!current) return;
    let dx = current.x - drag.start.x;
    let dy = current.y - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    if (drag.type === 'resize') {
      const original = drag.positions[drag.payload.id];
      if (!original) return;
      let x = original.x;
      let y = original.y;
      let width = original.width;
      let height = original.height;
      if (drag.payload.corner.includes('e')) width = original.width + dx;
      if (drag.payload.corner.includes('s')) height = original.height + dy;
      if (drag.payload.corner.includes('w')) {
        width = original.width - dx;
        x = original.x + dx;
      }
      if (drag.payload.corner.includes('n')) {
        height = original.height - dy;
        y = original.y + dy;
      }
      width = Math.max(100, Math.round(width / 5) * 5);
      height = Math.max(48, Math.round(height / 5) * 5);
      if (drag.payload.corner.includes('w')) x = original.x + original.width - width;
      if (drag.payload.corner.includes('n')) y = original.y + original.height - height;
      state.editor.nodes[drag.payload.id] = {
        ...(state.editor.nodes[drag.payload.id] || {}),
        x, y, width, height, manualPosition: true
      };
      scheduleRender();
      return;
    }
    if (drag.type === 'label') {
      const manual = state.editor.labels[drag.payload.id] || {};
      state.editor.labels[drag.payload.id] = {
        ...manual,
        x: drag.payload.x + dx,
        y: drag.payload.y + dy,
        manual: true
      };
    } else {
      const snap = (value) => Math.round(value / 5) * 5;
      for (const [id, original] of Object.entries(drag.positions)) {
        const manual = state.editor.nodes[id] || {};
        state.editor.nodes[id] = {
          ...manual,
          x: Math.max(10, snap(original.x + dx)),
          y: Math.max(10, snap(original.y + dy)),
          width: manual.width || original.width,
          height: manual.height || original.height,
          manualPosition: true
        };
      }
      setLayoutStatus('正在调整布局…', '');
    }
    scheduleRender();
  };
  const onUp = (upEvent) => {
    if (!state.editor.drag || upEvent.pointerId !== state.editor.drag.pointerId) return;
    const drag = state.editor.drag;
    try { svg.releasePointerCapture(upEvent.pointerId); } catch (_) {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    state.editor.drag = null;
    renderChart();
    if (drag.moved) {
      pushHistory(drag.before);
      scheduleLayoutSave();
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function startPan(event, svg) {
  const startX = event.clientX;
  const startY = event.clientY;
  const left = els.chartWrap.scrollLeft;
  const top = els.chartWrap.scrollTop;
  try { svg.setPointerCapture(event.pointerId); } catch (_) {}
  const onMove = (moveEvent) => {
    els.chartWrap.scrollLeft = left - (moveEvent.clientX - startX);
    els.chartWrap.scrollTop = top - (moveEvent.clientY - startY);
  };
  const onUp = (upEvent) => {
    try { svg.releasePointerCapture(upEvent.pointerId); } catch (_) {}
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function selectedPositions() {
  return [...state.editor.selectedNodes]
    .map((id) => ({ id, position: nodeLayoutPosition(id) }))
    .filter((entry) => entry.position && !entry.position.locked);
}

function alignSelected(mode) {
  const entries = selectedPositions();
  if (entries.length < 2) return toast('请先按住 Shift 选择至少两个节点。');
  const before = snapshotLayout();
  const target = mode === 'top'
    ? Math.min(...entries.map((entry) => entry.position.y))
    : entries.reduce((sum, entry) => sum + entry.position.y + entry.position.height / 2, 0) / entries.length;
  for (const { id, position } of entries) {
    const y = mode === 'top' ? target : target - position.height / 2;
    state.editor.nodes[id] = {
      ...(state.editor.nodes[id] || {}),
      x: position.x, y: Math.round(y / 5) * 5,
      width: position.width, height: position.height,
      manualPosition: true
    };
  }
  pushHistory(before);
  renderChart();
  scheduleLayoutSave();
}

function distributeSelected() {
  const entries = selectedPositions().sort((a, b) => a.position.x - b.position.x);
  if (entries.length < 3) return toast('请先选择至少三个节点进行水平均分。');
  const before = snapshotLayout();
  const left = entries[0].position.x;
  const right = entries[entries.length - 1].position.x + entries[entries.length - 1].position.width;
  const totalWidth = entries.reduce((sum, entry) => sum + entry.position.width, 0);
  const gap = (right - left - totalWidth) / (entries.length - 1);
  let x = left;
  for (const { id, position } of entries) {
    state.editor.nodes[id] = {
      ...(state.editor.nodes[id] || {}),
      x: Math.round(x / 5) * 5, y: position.y,
      width: position.width, height: position.height,
      manualPosition: true
    };
    x += position.width + gap;
  }
  pushHistory(before);
  renderChart();
  scheduleLayoutSave();
}

function setZoom(value) {
  state.editor.zoom = Math.max(0.25, Math.min(3, value));
  renderChart();
}

function fitViewport() {
  if (!state.editor.renderInfo) return;
  const info = state.editor.renderInfo;
  const width = Math.max(1, els.chartWrap.clientWidth - 8);
  const height = Math.max(1, els.chartWrap.clientHeight - 8);
  setZoom(Math.min(width / info.width, height / info.height, 1));
  els.chartWrap.scrollLeft = 0;
  els.chartWrap.scrollTop = 0;
}

function resetAutoLayout() {
  if (!state.data) return;
  if (!window.confirm('将清除所有人工位置调整并恢复自动排版，是否继续？')) return;
  const before = snapshotLayout();
  state.editor.nodes = {};
  state.editor.labels = {};
  state.editor.buses = {};
  state.editor.selectedNodes.clear();
  state.editor.selectedLabel = null;
  pushHistory(before);
  renderChart();
  scheduleLayoutSave();
  toast('已恢复自动排版。');
}

function renderNodeTable() {
  clear(els.nodeTable);
  const query = state.nodeSearch.toLowerCase();
  const rows = (state.data.nodes || []).filter((node) => {
    if (!query) return true;
    return [node.name, node.entity_type, node.status, node.level].join(' ').toLowerCase().includes(query);
  });
  const table = el('table');
  const head = el('tr');
  for (const label of ['层级', '实体名称', '类型', '状态', '锁定', '置信度', ''] ) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  if (!rows.length) {
    body.append(el('tr', {}, [el('td', { colspan: '7', class: 'empty-state', text: '没有匹配的节点。' })]));
  }
  rows.forEach((node) => {
    const tr = el('tr');
    const levelInput = el('input', { type: 'number', min: '1', value: String(node.level || 1) });
    levelInput.addEventListener('change', () => { node.level = Math.max(1, Number(levelInput.value) || 1); markDirty(); });
    const nameInput = el('input', { type: 'text', value: node.name || '' });
    nameInput.addEventListener('change', () => { node.name = nameInput.value.trim(); markDirty(); });
    const typeSelect = el('select');
    for (const [value, label] of [['company', '公司'], ['person', '个人'], ['fund', '基金/机构'], ['other', '其他']]) {
      typeSelect.append(el('option', { value, text: label, ...(node.entity_type === value ? { selected: 'selected' } : {}) }));
    }
    typeSelect.addEventListener('change', () => { node.entity_type = typeSelect.value; markDirty(); });
    const statusSelect = el('select');
    for (const [value, label] of [['active', '有效'], ['excluded_cancelled', '已注销/排除'], ['unknown', '未知']]) {
      statusSelect.append(el('option', { value, text: label, ...(node.status === value ? { selected: 'selected' } : {}) }));
    }
    statusSelect.addEventListener('change', () => { node.status = statusSelect.value; markDirty(); });
    const confidence = Number(node.confidence) || 0;
    const lockInput = el('input', { type: 'checkbox', title: '锁定位置' });
    lockInput.checked = Boolean(state.editor.nodes[node.id]?.locked || nodeLayoutPosition(node.id)?.locked);
    lockInput.addEventListener('change', () => {
      const before = snapshotLayout();
      const position = nodeLayoutPosition(node.id);
      if (!position) return;
      state.editor.nodes[node.id] = {
        ...(state.editor.nodes[node.id] || {}),
        x: position.x, y: position.y, width: position.width, height: position.height,
        locked: lockInput.checked,
        manualPosition: Boolean(state.editor.nodes[node.id]?.manualPosition)
      };
      pushHistory(before);
      scheduleLayoutSave();
      renderChart();
    });
    tr.append(
      el('td', {}, [levelInput]),
      el('td', {}, [nameInput]),
      el('td', {}, [typeSelect]),
      el('td', {}, [statusSelect]),
      el('td', {}, [lockInput]),
      el('td', {}, [badge(confidence.toFixed(2), confidence < 0.86 ? 'amber' : 'green')]),
      el('td', { class: 'cell-muted', text: Array.isArray(node.bbox) ? node.bbox.map(Math.round).join(',') : '' })
    );
    body.append(tr);
  });
  table.append(body);
  els.nodeTable.append(table);
}

function renderEdgeTable() {
  clear(els.edgeTable);
  const nodes = state.data.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const query = state.edgeSearch.toLowerCase();
  const edges = (state.data.edges || []).filter((edge) => {
    if (!query) return true;
    const text = [byId.get(edge.source)?.name, byId.get(edge.target)?.name, edge.percentage, edge.relation].join(' ');
    return text.toLowerCase().includes(query);
  });
  const toolbar = el('div', { class: 'table-toolbar' }, [
    el('span', { class: 'toolbar-note', text: `${edges.length} 条关系` }),
    el('button', { class: 'ghost-button', type: 'button', text: '添加关系', onclick: addEdge })
  ]);
  const table = el('table');
  const head = el('tr');
  for (const label of ['出资方', '被投资方', '持股比例', '关系', '置信度', '比例来源', '']) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  if (!edges.length) body.append(el('tr', {}, [el('td', { colspan: '7', class: 'empty-state', text: '没有匹配的关系。' })]));
  for (const edge of edges) {
    const tr = el('tr');
    const sourceSelect = nodeSelect(nodes, edge.source, (value) => { edge.source = value; markDirty(); });
    const targetSelect = nodeSelect(nodes, edge.target, (value) => { edge.target = value; markDirty(); });
    const percentage = el('input', { type: 'text', value: edge.percentage || '', placeholder: '如 54%' });
    percentage.addEventListener('change', () => {
      edge.percentage = percentage.value.trim();
      edge.percentage_source = edge.percentage ? 'manual' : 'missing';
      markDirty();
    });
    const relation = el('select');
    for (const [value, label] of [['shareholder_to_core', '股东 → 核心'], ['investment', '投资'], ['subsidiary', '子公司']]) {
      relation.append(el('option', { value, text: label, ...(edge.relation === value ? { selected: 'selected' } : {}) }));
    }
    relation.addEventListener('change', () => { edge.relation = relation.value; markDirty(); });
    const confidence = el('input', { type: 'number', min: '0', max: '1', step: '0.01', value: String(edge.confidence ?? 0) });
    confidence.addEventListener('change', () => { edge.confidence = Math.max(0, Math.min(1, Number(confidence.value) || 0)); markDirty(); });
    const source = el('select');
    for (const value of ['secondary_crop_ocr', 'global_ocr', 'manual', 'missing']) {
      source.append(el('option', { value, text: value, ...(edge.percentage_source === value ? { selected: 'selected' } : {}) }));
    }
    source.addEventListener('change', () => { edge.percentage_source = source.value; markDirty(); });
    const remove = el('button', { type: 'button', class: 'mini-button', text: '删除' });
    remove.addEventListener('click', () => {
      state.data.edges = state.data.edges.filter((item) => item !== edge);
      markDirty();
      renderEdgeTable();
    });
    tr.append(el('td', {}, [sourceSelect]), el('td', {}, [targetSelect]), el('td', {}, [percentage]),
      el('td', {}, [relation]), el('td', {}, [confidence]), el('td', {}, [source]), el('td', {}, [remove]));
    body.append(tr);
  }
  table.append(body);
  clear(els.edgeTable);
  els.edgeTable.append(toolbar, table);
}

function nodeSelect(nodes, selected, onChange) {
  const select = el('select');
  for (const node of nodes) {
    select.append(el('option', { value: node.id, text: node.name, ...(node.id === selected ? { selected: 'selected' } : {}) }));
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function addEdge() {
  const nodes = state.data.nodes || [];
  if (nodes.length < 2) return toast('至少需要两个节点。');
  state.data.edges = state.data.edges || [];
  state.data.edges.push({
    source: nodes[0].id, target: nodes[1].id, percentage: '',
    relation: 'investment', confidence: 0.5, percentage_source: 'manual'
  });
  markDirty();
  renderEdgeTable();
}

function renderOcrText() {
  clear(els.ocrText);
  const texts = state.data.all_visible_text || [];
  if (!texts.length) {
    els.ocrText.append(el('div', { class: 'empty-state', text: '没有 OCR 文字。' }));
    return;
  }
  for (const text of texts) els.ocrText.append(el('div', { class: 'text-line', text }));
}

function renderReview() {
  clear(els.reviewGrid);
  const quality = state.data.quality || {};
  const items = [
    ['总体置信度', String(quality.overall_confidence ?? '—'), ''],
    ['低置信度项', (quality.low_confidence_items || []).join('；') || '无', (quality.low_confidence_items || []).length ? 'warn' : ''],
    ['识别警告', (state.data.warnings || []).join('；') || '无', (state.data.warnings || []).length ? 'warn' : ''],
    ['复核建议', (quality.review_notes || []).join('；') || '无', ''],
    ['诊断', `切片 ${state.data.diagnostics?.tile_count || 0}；节点框 ${state.data.diagnostics?.detected_node_boxes || 0}；横线 ${state.data.diagnostics?.detected_horizontal_lines || 0}；竖线 ${state.data.diagnostics?.detected_vertical_lines || 0}；耗时 ${state.data.diagnostics?.duration_seconds || 0}s`, '']
  ];
  for (const [label, value, tone] of items) {
    els.reviewGrid.append(el('div', { class: `review-item ${tone}`.trim() }, [
      el('strong', { text: label }),
      el('div', { text: value })
    ]));
  }
}

function renderCorrections() {
  clear(els.correctionsList);
  const corrections = state.data.dictionary_corrections || [];
  if (!corrections.length) {
    els.correctionsList.append(el('div', { class: 'review-item', text: '没有自动字典纠错记录。' }));
    return;
  }
  corrections.forEach((item) => {
    els.correctionsList.append(el('div', { class: 'review-item' }, [
      el('strong', { text: `${item.original} → ${item.corrected}` }),
      el('div', { text: `相似度 ${item.similarity}` })
    ]));
  });
}

function renderExcluded() {
  clear(els.excludedList);
  const excluded = state.data.excluded || [];
  if (!excluded.length) {
    els.excludedList.append(el('div', { class: 'review-item', text: '没有被排除的注销企业。' }));
    return;
  }
  excluded.forEach((item) => {
    els.excludedList.append(el('div', { class: 'review-item warn' }, [
      el('strong', { text: item.name }),
      el('div', { text: item.reason })
    ]));
  });
}

function syncJsonEditor() {
  els.jsonEditor.value = JSON.stringify(state.data, null, 2);
  showError(els.jsonError, '');
}

function markDirty() {
  state.dirty = true;
  els.chartMeta.textContent = '有未应用的修改';
}

function applyEdits({ redraw = true } = {}) {
  if (!state.data) return;
  state.data.edges = (state.data.edges || []).filter((edge) => edge.source !== edge.target);
  state.dirty = false;
  renderMetrics();
  renderWarnings();
  if (redraw) renderChart();
  renderNodeTable();
  renderEdgeTable();
  renderReview();
  renderCorrections();
  renderExcluded();
  syncJsonEditor();
}

function applyJson() {
  try {
    const parsed = JSON.parse(els.jsonEditor.value);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error('JSON 必须包含 nodes 与 edges 数组。');
    }
    state.data = parsed;
    showError(els.jsonError, '');
    applyEdits();
    toast('已应用 JSON 修改。');
  } catch (error) {
    showError(els.jsonError, error.message);
  }
}

/* ----------------------------------------------------------------- export */

async function saveEdits({ silent = false } = {}) {
  if (!state.job || !state.data) return false;
  try {
    await api(`/${state.job.id}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.data)
    });
    state.dirty = false;
    if (!silent) toast('修改已保存。');
    return true;
  } catch (error) {
    showError(els.jsonError, error.message);
    toast(`保存失败：${error.message}`);
    return false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setDownloadStatus(message, tone = '') {
  if (!els.downloadStatus) return;
  els.downloadStatus.textContent = message;
  els.downloadStatus.className = `download-status ${tone}`.trim();
}

function renderVersionNotes() {
  if (!els.versionList) return;
  clear(els.versionList);
  for (const note of VERSION_NOTES) {
    const item = el('div', { class: `version-item${note.version === CURRENT_VERSION ? ' current' : ''}` }, [
      el('div', { class: 'version-item-head' }, [
        el('strong', { text: note.version }),
        el('small', { text: note.date || '' })
      ]),
      el('ul', {}, note.items.map((text) => el('li', { text })))
    ]);
    els.versionList.append(item);
  }
}

function openVersionDialog() {
  els.versionDialog.hidden = false;
  els.versionBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  els.closeVersionButton.focus();
}

function closeVersionDialog() {
  els.versionDialog.hidden = true;
  els.versionBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
}

function openDownloadDialog() {
  if (!state.data) return toast('请先完成识别。');
  els.downloadDialog.hidden = false;
  els.downloadBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  setDownloadStatus('请选择下载格式。');
  els.closeDownloadButton.focus();
}

function closeDownloadDialog() {
  els.downloadDialog.hidden = true;
  els.downloadBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
}

function setDownloadBusy(busy, label = '') {
  const buttons = [els.downloadSvgButton, els.downloadPngButton, els.downloadXlsxButton, els.downloadPdfButton];
  for (const button of buttons) {
    if (!button) continue;
    button.disabled = busy;
    if (busy && label && button.textContent.includes(label)) button.textContent = '生成中…';
  }
}

function exportSvgFile() {
  const built = buildSvgString(true);
  downloadBlob(new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' }), '股权结构图.svg');
  return 'SVG 已下载。';
}

function exportPngFile() {
  return new Promise((resolve, reject) => {
    if (!state.editor.renderInfo) return reject(new Error('未找到股权图布局，请稍后重试。'));
    const built = buildSvgString(true);
    const svgWidth = built.width;
    const svgHeight = built.height;
    if (!svgWidth || !svgHeight) return reject(new Error('SVG 尺寸无效，无法导出 PNG。'));
    const svgText = built.svg;
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(svgUrl);
    image.onload = async () => {
      try {
        let scale = 2;
        const maxPixels = LAYOUT.maxCanvasPixels;
        scale = Math.min(
          scale,
          LAYOUT.maxCanvasDimension / svgWidth,
          LAYOUT.maxCanvasDimension / svgHeight,
          Math.sqrt(maxPixels / Math.max(1, svgWidth * svgHeight))
        );
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(svgWidth * scale));
        canvas.height = Math.max(1, Math.round(svgHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建 Canvas Context。');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngBlob = await new Promise((resolveBlob, rejectBlob) => {
          try {
            canvas.toBlob((blob) => {
              if (blob) resolveBlob(blob);
              else rejectBlob(new Error('Canvas toBlob 返回空，图片可能过大。'));
            }, 'image/png', 1.0);
          } catch (error) {
            rejectBlob(error);
          }
        });
        downloadBlob(pngBlob, '股权结构图.png');
        cleanup();
        resolve('PNG 已下载。');
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('PNG 导出失败。'));
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('SVG 转换 Image 失败，请改用 SVG 导出。'));
    };
    image.src = svgUrl;
  });
}

async function exportPngFromServer() {
  if (!state.data) throw new Error('请先完成识别。');
  const built = buildSvgString(true);
  const response = await fetch(`${API}/export/png`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ svg: built.svg, scale: 2, filename: `${state.data.core_company || '股权结构图'}.png` })
  });
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('请先登录。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || payload?.error || `PNG 生成失败（${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob || blob.size === 0) throw new Error('服务器返回空 PNG。');
  downloadBlob(blob, `${state.data.core_company || '股权结构图'}.png`);
  return 'PNG 已下载。';
}

function downloadDebugSvg() {
  const built = buildSvgString(true);
  downloadBlob(new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' }), '股权结构图-调试.svg');
  setDownloadStatus('调试 SVG 已下载。', 'ok');
}

async function exportServerFile(format) {
  if (!state.data) throw new Error('请先完成识别。');
  const saved = await saveEdits({ silent: true });
  if (!saved) throw new Error('保存当前修改失败，未导出。');
  const layoutSaved = await saveLayout({ silent: true });
  if (!layoutSaved) throw new Error('保存当前布局失败，未导出。');
  const response = await fetch(`${API}/${state.job.id}/export?format=${format}`, { credentials: 'same-origin' });
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('请先登录。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `导出失败（${response.status}）`);
  }
  const blob = await response.blob();
  const filename = format === 'xlsx' ? '股权结构图数据.xlsx' : '股权结构图.pdf';
  downloadBlob(blob, filename);
  return format === 'xlsx' ? 'Excel 已下载。' : 'PDF 已下载。';
}

async function runDownload(kind) {
  if (!state.data) return toast('请先完成识别。');
  const labels = { svg: 'SVG', png: 'PNG', xlsx: 'Excel', pdf: 'PDF' };
  setDownloadBusy(true, labels[kind] || '');
  setDownloadStatus(`正在生成 ${labels[kind] || ''}…`);
  try {
    let message = '';
    if (kind === 'svg') message = exportSvgFile();
    else if (kind === 'png') message = await exportPngFromServer();
    else message = await exportServerFile(kind);
    setDownloadStatus(message, 'ok');
    toast(message);
  } catch (error) {
    setDownloadStatus(error.message, 'error');
    toast(error.message);
  } finally {
    setDownloadBusy(false);
    // Rebuild card labels after a busy state.
    els.downloadSvgButton.textContent = '下载 SVG';
    els.downloadPngButton.textContent = '下载 PNG';
    els.downloadXlsxButton.textContent = '下载 Excel';
    els.downloadPdfButton.textContent = '下载 PDF';
  }
}

/* ------------------------------------------------------------------ tabs */

function switchTab(tab) {
  state.tab = tab;
  $$('.result-tab').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const panels = { nodes: '#nodesPanel', edges: '#edgesPanel', text: '#textPanel', review: '#reviewPanel', corrections: '#correctionsPanel', excluded: '#excludedPanel', advanced: '#advancedPanel' };
  for (const [key, selector] of Object.entries(panels)) {
    const panel = $(selector);
    if (panel) panel.hidden = key !== tab;
  }
  if (tab === 'advanced') syncJsonEditor();
}

/* ---------------------------------------------------------------- history */

async function loadHistory() {
  try {
    const payload = await api('');
    clear(els.historyList);
    if (!payload.jobs?.length) {
      els.historyList.append(el('p', { class: 'empty-note', text: '还没有识别任务。' }));
      return;
    }
    for (const job of payload.jobs) {
      const summary = job.summary || {};
      const row = el('div', { class: 'history-row' }, [
        el('div', { class: 'history-main' }, [
          el('strong', { text: job.originalFilename || '未命名图片' }),
          el('small', {
            text: `${fmtTime(job.createdAt)} · ${statusLabel(job.status)}${summary.node_count !== undefined ? ` · ${summary.node_count} 节点 / ${summary.edge_count} 关系` : ''}`
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
      } else if (job.status === 'draft' || job.status === 'failed') {
        const resume = el('button', { type: 'button', text: job.status === 'failed' ? '重新识别' : '继续识别' });
        resume.addEventListener('click', () => openHistoryJob(job));
        actions.append(resume);
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
  stopPolling();
  state.job = job;
  state.data = null;
  els.resultPanel.hidden = true;
  els.processPanel.hidden = true;
  if (job.status === 'completed') {
    await loadResult(job);
    return;
  }
  els.uploadPanel.hidden = true;
  els.startPanel.hidden = false;
  els.startButton.disabled = false;
  setJobStatus(els.draftStatus, job.status);
  setPreview(job);
  els.startSubtitle.textContent = job.status === 'failed'
    ? `上次识别失败：${job.error || '未知错误'}。可以重新开始。`
    : '图片已就绪，点击开始识别。';
  els.startPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteJob(job) {
  if (!window.confirm(`删除任务「${job.originalFilename}」及其结果？`)) return;
  try {
    await api(`/${job.id}`, { method: 'DELETE' });
    toast('任务已删除。');
    if (state.job?.id === job.id) resetWorkspace();
    await loadHistory();
  } catch (error) {
    toast(error.message);
  }
}

/* ----------------------------------------------------------------- reset */

function resetWorkspace() {
  stopPolling();
  closeDownloadDialog();
  state.file = null;
  state.job = null;
  state.data = null;
  state.dirty = false;
  state.editor.nodes = {};
  state.editor.labels = {};
  state.editor.buses = {};
  state.editor.selectedNodes.clear();
  state.editor.selectedLabel = null;
  state.editor.history = [];
  state.editor.future = [];
  state.editor.zoom = 1;
  els.fileInput.value = '';
  els.selectedFile.hidden = true;
  els.imagePreview.hidden = true;
  els.startPreview.hidden = true;
  els.uploadButton.disabled = true;
  els.uploadProgress.hidden = true;
  els.uploadPanel.hidden = false;
  els.startPanel.hidden = true;
  els.processPanel.hidden = true;
  els.resultPanel.hidden = true;
  els.sourceLink.hidden = true;
  els.startButton.disabled = false;
  showError(els.uploadError, '');
  showError(els.startError, '');
  showError(els.processError, '');
  els.uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireEvents() {
  els.fileInput.addEventListener('change', () => setFile(els.fileInput.files?.[0]));
  els.clearFileButton.addEventListener('click', clearFile);
  els.uploadButton.addEventListener('click', uploadFile);
  ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
  }));
  els.dropZone.addEventListener('drop', (event) => setFile(event.dataTransfer?.files?.[0]));
  els.startButton.addEventListener('click', startRecognition);
  els.redrawButton.addEventListener('click', () => { applyEdits(); toast('已重绘。'); });
  els.saveButton.addEventListener('click', () => saveEdits());
  els.svgButton.addEventListener('click', () => runDownload('svg'));
  els.pngButton.addEventListener('click', () => runDownload('png'));
  els.xlsxButton.addEventListener('click', () => runDownload('xlsx'));
  els.pdfButton.addEventListener('click', () => runDownload('pdf'));
  els.downloadButton.addEventListener('click', openDownloadDialog);
  els.versionButton.addEventListener('click', openVersionDialog);
  els.closeVersionButton.addEventListener('click', closeVersionDialog);
  els.versionBackdrop.addEventListener('click', closeVersionDialog);
  els.closeDownloadButton.addEventListener('click', closeDownloadDialog);
  els.downloadBackdrop.addEventListener('click', closeDownloadDialog);
  els.downloadSvgButton.addEventListener('click', () => runDownload('svg'));
  els.downloadPngButton.addEventListener('click', () => runDownload('png'));
  els.downloadXlsxButton.addEventListener('click', () => runDownload('xlsx'));
  els.downloadPdfButton.addEventListener('click', () => runDownload('pdf'));
  els.downloadDebugSvgButton.addEventListener('click', downloadDebugSvg);
  els.zoomIn.addEventListener('click', () => setZoom(state.editor.zoom + 0.1));
  els.zoomOut.addEventListener('click', () => setZoom(state.editor.zoom - 0.1));
  els.zoomReset.addEventListener('click', () => setZoom(1));
  els.fitButton.addEventListener('click', fitViewport);
  els.alignTopButton.addEventListener('click', () => alignSelected('top'));
  els.alignCenterButton.addEventListener('click', () => alignSelected('center'));
  els.distributeButton.addEventListener('click', distributeSelected);
  els.undoButton.addEventListener('click', undoLayout);
  els.redoButton.addEventListener('click', redoLayout);
  els.saveLayoutButton.addEventListener('click', () => saveLayout());
  els.resetLayoutButton.addEventListener('click', resetAutoLayout);
  els.chartWrap.addEventListener('pointerdown', onCanvasPointerDown);
  $$('.result-tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  els.nodeSearch.addEventListener('input', () => { state.nodeSearch = els.nodeSearch.value.trim(); renderNodeTable(); });
  els.edgeSearch.addEventListener('input', () => { state.edgeSearch = els.edgeSearch.value.trim(); renderEdgeTable(); });
  els.applyJsonButton.addEventListener('click', applyJson);
  els.correctionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const original = els.correctionOriginal.value.trim();
    const corrected = els.correctionCorrected.value.trim();
    if (!original || !corrected) return;
    try {
      await api('/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, corrected, jobId: state.job?.id })
      });
      state.data.dictionary_corrections = state.data.dictionary_corrections || [];
      state.data.dictionary_corrections.push({ original, corrected, similarity: 100 });
      renderCorrections();
      els.correctionForm.reset();
      toast('修正记录已保存。');
    } catch (error) {
      toast(error.message);
    }
  });
  els.refreshHistoryButton.addEventListener('click', loadHistory);
  els.newJobButton.addEventListener('click', resetWorkspace);
}

async function init() {
  wireEvents();
  try {
    state.meta = await api('/meta');
  } catch (error) {
    toast(error.message);
  }
  els.versionButton.textContent = CURRENT_VERSION;
  renderVersionNotes();
  await loadHistory();
}

init();

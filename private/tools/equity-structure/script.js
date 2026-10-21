'use strict';

const API = '/api/equity-structures';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const CURRENT_VERSION = 'v1.2.2';
const VERSION_NOTES = [
  {
    version: 'v1.2.2',
    date: '2026-10-21',
    items: [
      '修复“一级股东再添加上游股东”只生成节点、不形成新层级的问题。',
      '当上游目标 level=1 时自动 rebase 全图层级：所有节点 level+1，人工布局整体下移一层，新节点占用新的 level 1。',
      '新增更高层后画布 bounds 自动增加一行高度；标题、总线、比例标签和导出使用同一布局。',
      '核心主体 shareholder bus 仍只有一条；一级股东以上的父层使用 investment 局部树状分支，不并入总 bus。'
    ]
  },
  {
    version: 'v1.2.1',
    date: '2026-10-21',
    items: [
      '重做标题区、内容区、背景区的布局关系：标题基线上移，内容顶部固定留白，背景随内容 bounds 自动扩展。',
      '上游股东默认从内容顶部开始排布，不再贴标题；下游公司保留更大的底部 footer 留白。',
      '加载旧 layout 时，如果人工节点/标签高于内容顶部，会整体下移并保留 manualPosition 相对关系。',
      '拖动/属性修改节点时限制在标题区下方；导出 SVG/PNG/PDF 使用同一套新布局常量。'
    ]
  },
  {
    version: 'v1.2.0',
    date: '2026-10-21',
    items: [
      '新增“＋关联公司”：一次创建上游股东或下游被投资公司、股权关系和持股比例。',
      '关联对象默认使用当前选中节点，也可在弹窗中选择；关系和比例方向明确。',
      '支持 0–100% 高精度比例（如 12.3456%），保留输入精度；非法/空值阻止创建。',
      '一键创建复用现有节点/edge/标签/样式/布局数据模型，Undo/Redo 一次恢复整套关系。',
      '保留独立添加节点、添加连线、添加比例、复制、删除、属性编辑和导出功能。'
    ]
  },
  {
    version: 'v1.1.1',
    date: '2026-10-21',
    items: [
      '导出前新增保存队列与 flushSaves 同步：取消防抖计时、串行等待旧保存、保存当前快照并复核未发生新编辑后再导出。',
      'PDF/Excel 不再在自动保存未完成时读取旧数据；保存失败会明确阻止导出。',
      '自动保存失败会显示可见错误状态；连续保存请求串行执行，避免旧响应覆盖新状态。',
      '补充真实/专用环境验收记录：PNG API、样式保存、Headless Chrome 交互冒烟与 PDF 样式渲染；真实登录验收状态按实际结果标记。',
      '未新增框选、手动 bend point、总线拖动或多人并发功能。'
    ]
  },
  {
    version: 'v1.1.0',
    date: '2026-10-21',
    items: [
      '新增公司/个人/基金/机构/其他节点工具，可在画布中直接添加、复制和删除。',
      '新增连线与比例工具：选择源/目标节点创建关系，比例标签可独立编辑、拖动、隐藏和恢复自动位置。',
      '新增属性面板：节点/连线/比例/画布的颜色、字体、边框、圆角、线型、箭头和坐标可编辑。',
      '新增审计米金、简约灰白、蓝灰商务主题；支持仅新建默认或应用到整张图。',
      'Undo/Redo 覆盖新增/删除、名称/比例、布局、尺寸和颜色；支持 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、Delete、Esc。',
      '业务数据、布局与样式分离保存；SVG/PNG/PDF 使用当前编辑布局和样式。'
    ]
  },
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
    styles: { nodes: {}, edges: {}, labels: {}, canvas: {}, theme: 'audit' },
    selectedNodes: new Set(),
    selectedEdge: null,
    selectedLabel: null,
    linkMode: null,
    panelBefore: null,
    defaultTheme: 'audit',
    history: [],
    future: [],
    drag: null,
    renderInfo: null,
    panning: false,
    spaceDown: false,
    saveTimer: null,
    resultSaveTimer: null,
    saveChains: { result: Promise.resolve(), layout: Promise.resolve() },
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
  editorToolbar: $('#editorToolbar'), propertyPanel: $('#propertyPanel'),
  addCompanyButton: $('#addCompanyButton'), addPersonButton: $('#addPersonButton'),
  addFundButton: $('#addFundButton'), addInstitutionButton: $('#addInstitutionButton'),
  addOtherButton: $('#addOtherButton'), addRelatedButton: $('#addRelatedButton'),
  addEdgeButton: $('#addEdgeButton'), addLabelButton: $('#addLabelButton'),
  duplicateButton: $('#duplicateButton'), deleteButton: $('#deleteButton'),
  relatedBackdrop: $('#relatedBackdrop'), relatedDialog: $('#relatedDialog'),
  closeRelatedButton: $('#closeRelatedButton'), cancelRelatedButton: $('#cancelRelatedButton'),
  relatedForm: $('#relatedForm'), relatedTarget: $('#relatedTarget'), relatedName: $('#relatedName'),
  relatedType: $('#relatedType'), relatedPercentage: $('#relatedPercentage'),
  relatedPreview: $('#relatedPreview'), relatedError: $('#relatedError'),
  createRelatedButton: $('#createRelatedButton'), relatedTargetField: $('#relatedTargetField'),
  relatedPercentageField: $('#relatedPercentageField'),
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
    state.editor.styles = savedLayout && savedLayout.styles
      ? savedLayout.styles
      : { nodes: {}, edges: {}, labels: {}, canvas: {}, theme: 'audit' };
    state.editor.defaultTheme = savedLayout?.defaultTheme || state.editor.styles.theme || 'audit';
    editorStyles();
    const layoutShifted = normalizeManualLayout();
    state.editor.selectedNodes = new Set();
    state.editor.selectedEdge = null;
    state.editor.selectedLabel = null;
    state.editor.linkMode = null;
    state.editor.history = [];
    state.editor.future = [];
    state.editor.zoom = 1;
    state.dirty = false;
    els.processPanel.hidden = true;
    els.startPanel.hidden = true;
    els.resultPanel.hidden = false;
    setPreview(job);
    renderResult();
    if (layoutShifted) scheduleLayoutSave();
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
  renderPropertyPanel();
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
  chartPaddingX: 90,
  titleTopPadding: 24,
  titleBaseline: 54,
  contentTop: 120,
  footerPadding: 80,
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

const BASE_NODE_STYLE = {
  fill: '#fff8ee', stroke: '#d49a43', textColor: '#17191c',
  fontSize: 15, fontWeight: 500, strokeWidth: 1.35, radius: 10
};
const CORE_NODE_STYLE = {
  fill: '#fff2db', stroke: '#c67d18', textColor: '#17191c',
  fontSize: 21, fontWeight: 700, strokeWidth: 2, radius: 10
};
const BASE_EDGE_STYLE = {
  stroke: '#777d83', strokeWidth: 1.4, dash: 'none', arrow: true
};
const BASE_LABEL_STYLE = {
  color: '#333333', background: '#ffffff', fontSize: 11,
  fontWeight: 400, paddingX: 5, paddingY: 3, radius: 3, hidden: false
};
const THEMES = {
  audit: {
    name: '审计米金',
    nodes: { fill: '#fff8ee', stroke: '#d49a43', textColor: '#17191c' },
    edges: { stroke: '#777d83' },
    labels: { color: '#333333', background: '#ffffff' },
    canvas: { background: '#ffffff' }
  },
  minimal: {
    name: '简约灰白',
    nodes: { fill: '#ffffff', stroke: '#cfd5dd', textColor: '#17202a' },
    edges: { stroke: '#98a2b3' },
    labels: { color: '#344054', background: '#ffffff' },
    canvas: { background: '#ffffff' }
  },
  business: {
    name: '蓝灰商务',
    nodes: { fill: '#eef4ff', stroke: '#84adff', textColor: '#102a56' },
    edges: { stroke: '#667085' },
    labels: { color: '#1849a9', background: '#ffffff' },
    canvas: { background: '#f8fafc' }
  },
  custom: {
    name: '自定义主题',
    nodes: {}, edges: {}, labels: {}, canvas: {}
  }
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function editorStyles() {
  if (!state.editor.styles || typeof state.editor.styles !== 'object') {
    state.editor.styles = { nodes: {}, edges: {}, labels: {}, canvas: {}, theme: 'audit' };
  }
  const styles = state.editor.styles;
  for (const key of ['nodes', 'edges', 'labels', 'canvas']) {
    if (!styles[key] || typeof styles[key] !== 'object' || Array.isArray(styles[key])) styles[key] = {};
  }
  if (!styles.theme) styles.theme = 'audit';
  return styles;
}

function nodeStyle(node) {
  const core = node && node.name === state.data?.core_company;
  return { ...BASE_NODE_STYLE, ...(core ? CORE_NODE_STYLE : {}), ...(editorStyles().nodes[node?.id] || {}) };
}

function edgeStyle(edgeId) {
  return { ...BASE_EDGE_STYLE, ...(editorStyles().edges[edgeId] || {}) };
}

function labelStyle(edgeId) {
  return { ...BASE_LABEL_STYLE, ...(editorStyles().labels[edgeId] || {}) };
}

function canvasStyle() {
  return { background: '#ffffff', ...(editorStyles().canvas || {}) };
}

function styleValue(style, key, fallback) {
  const value = style && style[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function strokeAttrs(style, extra = '') {
  const dash = style.dash && style.dash !== 'none' ? ` stroke-dasharray="${esc(style.dash)}"` : '';
  return `stroke="${esc(style.stroke || BASE_EDGE_STYLE.stroke)}" stroke-width="${Number(style.strokeWidth) || BASE_EDGE_STYLE.strokeWidth}"${dash}${extra}`;
}

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

function normalizeManualLayout() {
  const nodeYs = Object.values(state.editor.nodes || {})
    .map((node) => Number(node?.y))
    .filter(Number.isFinite);
  const labelYs = Object.values(state.editor.labels || {})
    .map((label) => Number(label?.y))
    .filter(Number.isFinite);
  const minY = Math.min(...nodeYs, ...labelYs);
  if (!Number.isFinite(minY) || minY >= LAYOUT.contentTop) return false;
  const delta = LAYOUT.contentTop - minY;
  for (const node of Object.values(state.editor.nodes || {})) {
    if (Number.isFinite(Number(node?.y))) node.y = Math.round(Number(node.y) + delta);
  }
  for (const label of Object.values(state.editor.labels || {})) {
    if (Number.isFinite(Number(label?.y))) label.y = Math.round(Number(label.y) + delta);
  }
  for (const bus of Object.values(state.editor.buses || {})) {
    if (Number.isFinite(Number(bus?.y))) bus.y = Math.round(Number(bus.y) + delta);
  }
  return true;
}

function buildLayout() {
  const data = state.data;
  const active = (data.nodes || []).filter((node) => node.status !== 'excluded_cancelled');
  if (!active.length) return { width: 1200, height: 500, positions: new Map(), levels: [], titleY: LAYOUT.titleBaseline };
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
  const width = Math.max(1100, maxWidth + LAYOUT.chartPaddingX * 2);
  const top = LAYOUT.contentTop;
  const bottomLevel = levelKeys[levelKeys.length - 1];
  const maxRowHeight = Math.max(...rows.flatMap((row) => row.entries.map((entry) => entry.height)), 70);
  const height = top + (bottomLevel - 1) * LAYOUT.levelGap + maxRowHeight + LAYOUT.footerPadding;
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
    const style = editorStyles().nodes[id] || {};
    const fontSize = Number(style.fontSize || (position.core ? CORE_NODE_STYLE.fontSize : BASE_NODE_STYLE.fontSize));
    const minHeight = lines.length * Math.max(18, fontSize * 1.42) + LAYOUT.nodePaddingY * 2;
    positions.set(id, {
      ...position, x, y, width, height: Math.max(height, minHeight),
      lines, manual: true, locked: Boolean(override.locked)
    });
  }

  let maxRight = 0;
  let maxBottom = 0;
  for (const position of positions.values()) {
    maxRight = Math.max(maxRight, position.x + position.width);
    maxBottom = Math.max(maxBottom, position.y + position.height);
  }
  const titleText = String(data.title || '股权结构图');
  const titleWidth = [...titleText].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 30 : 16.8), 0) + LAYOUT.chartPaddingX * 2;
  return {
    width: Math.max(width, maxRight + LAYOUT.chartPaddingX, titleWidth),
    height: Math.max(height, maxBottom + LAYOUT.footerPadding),
    positions,
    levels: levelKeys,
    titleY: LAYOUT.titleBaseline
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
  const minY = LAYOUT.contentTop;
  const maxY = layout.height - LAYOUT.footerPadding - label.height;
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

  const addArrow = (x, y, style) => {
    const line = style || BASE_EDGE_STYLE;
    if (line.arrow === false) return;
    paths.push(`<polygon points="${x - 4},${y - 8} ${x + 4},${y - 8} ${x},${y}" fill="${esc(line.stroke || BASE_EDGE_STYLE.stroke)}"/>`);
  };
  const addLabel = (edge, x, y, busY, direction) => {
    if (!edge || !edge.percentage) return;
    const style = labelStyle(edge.__id);
    if (style.hidden) return;
    const text = normalizeDisplayText(edge.percentage);
    const fontSize = Number(style.fontSize) || BASE_LABEL_STYLE.fontSize;
    const padX = Number(style.paddingX ?? BASE_LABEL_STYLE.paddingX);
    const padY = Number(style.paddingY ?? BASE_LABEL_STYLE.paddingY);
    const textWidth = [...text].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? fontSize : fontSize * 0.56), 0);
    const width = Math.max(34, textWidth + padX * 2);
    const height = Math.max(17, fontSize + padY * 2);
    rawLabels.push({
      id: edge.__id,
      text,
      x,
      y: y - height + padY + 1,
      width,
      height,
      busY,
      direction,
      style
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

      const busStyle = edgeStyle('__bus');
      const xs = shareholders.map((position) => position.x + position.width / 2);
      const coreX = corePosition.x + corePosition.width / 2;
      for (const position of shareholders) {
        const edge = shareholderEdges.find((item) => item.source === position.node.id);
        const style = edgeStyle(edge?.__id);
        const x = position.x + position.width / 2;
        const edgeClass = !exportMode && state.editor.selectedEdge === edge?.__id ? 'edge-path is-selected' : 'edge-path';
        paths.push(`<path class="${edgeClass}" data-edge-id="${esc(edge?.__id || '')}" d="M${x} ${position.y + position.height} V${busY}" fill="none" ${strokeAttrs(style)}/>`);
      }
      paths.push(`<path data-role="shareholder-bus" d="M${Math.min(...xs)} ${busY} H${Math.max(...xs)}" fill="none" ${strokeAttrs(busStyle)}/>`);
      paths.push(`<path data-role="shareholder-core" d="M${coreX} ${busY} V${corePosition.y}" fill="none" ${strokeAttrs(busStyle)}/>`);
      addArrow(coreX, corePosition.y, busStyle);

      for (const edge of shareholderEdges) {
        const position = positions.get(edge.source);
        const x = position.x + position.width / 2;
        const segmentLength = busY - (position.y + position.height);
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

      const busStyle = edgeStyle('__bus');
      const xs = directChildren.map((position) => position.x + position.width / 2);
      const coreX = corePosition.x + corePosition.width / 2;
      paths.push(`<path data-role="direct-core" d="M${coreX} ${coreBottom} V${childBusY}" fill="none" ${strokeAttrs(busStyle)}/>`);
      paths.push(`<path data-role="direct-bus" d="M${Math.min(...xs, coreX)} ${childBusY} H${Math.max(...xs, coreX)}" fill="none" ${strokeAttrs(busStyle)}/>`);
      for (const position of directChildren) {
        const edge = directEdges.find((item) => item.target === position.node.id);
        const style = edgeStyle(edge?.__id);
        const x = position.x + position.width / 2;
        const edgeClass = !exportMode && state.editor.selectedEdge === edge?.__id ? 'edge-path is-selected' : 'edge-path';
        paths.push(`<path class="${edgeClass}" data-edge-id="${esc(edge?.__id || '')}" d="M${x} ${childBusY} V${position.y}" fill="none" ${strokeAttrs(style)}/>`);
        addArrow(x, position.y, style);
      }
      for (const edge of directEdges) {
        const position = positions.get(edge.target);
        const x = position.x + position.width / 2;
        const segmentLength = position.y - childBusY;
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
    const style = edgeStyle(edge.__id);
    const edgeClass = !exportMode && state.editor.selectedEdge === edge.__id ? 'edge-path is-selected' : 'edge-path';
    paths.push(`<path class="${edgeClass}" data-edge-id="${esc(edge.__id || '')}" d="M${x1} ${y1} V${mid} H${x2} V${y2}" fill="none" ${strokeAttrs(style)}/>`);
    addArrow(x2, y2, style);
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
        y: Math.max(LAYOUT.contentTop, Math.min(layout.height - LAYOUT.footerPadding - label.height, Number(manual.y)))
      };
      placed.push(placedLabel);
    } else {
      placedLabel = placeLabel(label, placed, nodeBoxes, layout, label.direction);
    }
    labelItems.push(placedLabel);
    const selected = !exportMode && state.editor.selectedLabel === label.id;
    const style = placedLabel.style || BASE_LABEL_STYLE;
    const textX = placedLabel.x + Number(style.paddingX ?? BASE_LABEL_STYLE.paddingX);
    const textY = placedLabel.y + placedLabel.height - Number(style.paddingY ?? BASE_LABEL_STYLE.paddingY) - 1;
    return `<g class="percentage-label${selected ? ' is-selected' : ''}" data-edge-id="${esc(label.id)}"><rect x="${placedLabel.x}" y="${placedLabel.y}" width="${placedLabel.width}" height="${placedLabel.height}" rx="${Number(style.radius) || 0}" fill="${esc(style.background || '#ffffff')}"/>
<text x="${textX}" y="${textY}" font-size="${Number(style.fontSize) || 11}" font-weight="${Number(style.fontWeight) || 400}" fill="${esc(style.color || '#333333')}">${esc(placedLabel.text)}</text></g>`;
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
    `<rect width="100%" height="100%" fill="${esc(canvasStyle().background || '#ffffff')}"/>`,
    `<text x="${layout.width / 2}" y="${layout.titleY ?? LAYOUT.titleBaseline}" text-anchor="middle" font-size="30" font-weight="700" fill="#17191c">${esc(data.title || '股权结构图')}</text>`
  ];
  parts.push(...routes.paths);
  parts.push(...routes.labels);
  for (const node of data.nodes || []) {
    if (node.status === 'excluded_cancelled') continue;
    const position = positions.get(node.id);
    if (!position) continue;
    const style = nodeStyle(node);
    const fill = styleValue(style, 'fill', position.core ? CORE_NODE_STYLE.fill : BASE_NODE_STYLE.fill);
    const stroke = styleValue(style, 'stroke', position.core ? CORE_NODE_STYLE.stroke : BASE_NODE_STYLE.stroke);
    const textColor = styleValue(style, 'textColor', BASE_NODE_STYLE.textColor);
    const fontSize = Number(styleValue(style, 'fontSize', position.core ? CORE_NODE_STYLE.fontSize : BASE_NODE_STYLE.fontSize));
    const fontWeight = Number(styleValue(style, 'fontWeight', position.core ? CORE_NODE_STYLE.fontWeight : BASE_NODE_STYLE.fontWeight));
    const strokeWidth = Number(styleValue(style, 'strokeWidth', position.core ? CORE_NODE_STYLE.strokeWidth : BASE_NODE_STYLE.strokeWidth));
    const radius = Number(styleValue(style, 'radius', BASE_NODE_STYLE.radius));
    const selected = !exportMode && state.editor.selectedNodes.has(node.id);
    parts.push(`<g class="node-group${selected ? ' is-selected' : ''}" data-node-id="${esc(node.id)}" data-name="${esc(node.name)}" aria-label="${esc(node.name)}"><title>${esc(node.name)}</title>`);
    parts.push(`<rect x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" rx="${radius}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${strokeWidth}"/>`);
    const lineHeight = Math.max(18, fontSize * 1.42);
    const startY = position.y + position.height / 2 - (position.lines.length * lineHeight) / 2 + fontSize;
    position.lines.forEach((line, index) => {
      parts.push(`<text x="${position.x + position.width / 2}" y="${startY + index * lineHeight}" text-anchor="middle" font-size="${fontSize}" font-weight="${fontWeight}" fill="${esc(textColor)}">${esc(line)}</text>`);
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
    data: cloneJson(state.data),
    nodes: cloneJson(state.editor.nodes || {}),
    labels: cloneJson(state.editor.labels || {}),
    buses: cloneJson(state.editor.buses || {}),
    styles: cloneJson(editorStyles())
  };
}

function restoreLayout(snapshot) {
  if (!snapshot) return;
  if (snapshot.data) state.data = cloneJson(snapshot.data);
  state.editor.nodes = cloneJson(snapshot.nodes || {});
  state.editor.labels = cloneJson(snapshot.labels || {});
  state.editor.buses = cloneJson(snapshot.buses || {});
  state.editor.styles = cloneJson(snapshot.styles || { nodes: {}, edges: {}, labels: {}, canvas: {}, theme: 'audit' });
  if (state.data) ensureEdgeIds(state.data);
  const nodeIds = new Set((state.data?.nodes || []).map((node) => node.id));
  state.editor.selectedNodes = new Set([...state.editor.selectedNodes].filter((id) => nodeIds.has(id)));
  if (state.editor.selectedEdge && !(state.data?.edges || []).some((edge) => edge.__id === state.editor.selectedEdge)) state.editor.selectedEdge = null;
  if (state.editor.selectedLabel && !(state.data?.edges || []).some((edge) => edge.__id === state.editor.selectedLabel)) state.editor.selectedLabel = null;
  refreshEditorViews();
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
  scheduleSaveAll();
  setLayoutStatus('已撤销。', '');
}

function redoLayout() {
  const next = state.editor.future.pop();
  if (!next) return;
  state.editor.history.push(snapshotLayout());
  restoreLayout(next);
  scheduleSaveAll();
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
    styles: editorStyles(),
    defaultTheme: state.editor.defaultTheme,
    canvas: info ? { width: info.width, height: info.height, background: canvasStyle().background } : {}
  };
}

function queueSave(kind, task) {
  const previous = state.editor.saveChains[kind] || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  state.editor.saveChains[kind] = next.catch(() => {});
  return next;
}

async function saveLayout({ silent = false } = {}) {
  if (!state.job || !state.data) return false;
  return queueSave('layout', async () => {
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
  });
}

function scheduleLayoutSave() {
  clearTimeout(state.editor.saveTimer);
  setLayoutStatus('有未保存的布局调整…', '');
  state.editor.saveTimer = setTimeout(() => saveLayout({ silent: true }), 1400);
}

function scheduleResultSave() {
  clearTimeout(state.editor.resultSaveTimer);
  state.editor.resultSaveTimer = setTimeout(() => saveEdits({ silent: true }), 1400);
}

function scheduleSaveAll() {
  scheduleResultSave();
  scheduleLayoutSave();
}

async function flushSaves() {
  if (!state.job || !state.data) return false;
  clearTimeout(state.editor.saveTimer);
  clearTimeout(state.editor.resultSaveTimer);
  state.editor.saveTimer = null;
  state.editor.resultSaveTimer = null;
  // Serialize against existing saves, then save a snapshot and verify that no
  // edit happened while the requests were in flight. This makes PDF/Excel
  // exports use the same state as the editor at the moment of export.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clearTimeout(state.editor.saveTimer);
    clearTimeout(state.editor.resultSaveTimer);
    state.editor.saveTimer = null;
    state.editor.resultSaveTimer = null;
    await state.editor.saveChains.result.catch(() => {});
    await state.editor.saveChains.layout.catch(() => {});
    const before = JSON.stringify(snapshotLayout());
    const dataSaved = await saveEdits({ silent: true });
    if (!dataSaved) return false;
    const layoutSaved = await saveLayout({ silent: true });
    if (!layoutSaved) return false;
    if (JSON.stringify(snapshotLayout()) === before) {
      clearTimeout(state.editor.saveTimer);
      clearTimeout(state.editor.resultSaveTimer);
      state.editor.saveTimer = null;
      state.editor.resultSaveTimer = null;
      return true;
    }
  }
  return false;
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
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  renderChart();
  renderPropertyPanel();
}

function selectEdge(id) {
  state.editor.selectedNodes.clear();
  state.editor.selectedLabel = null;
  state.editor.selectedEdge = id;
  renderChart();
  renderPropertyPanel();
}

function selectLabel(id) {
  state.editor.selectedNodes.clear();
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = id;
  renderChart();
  renderPropertyPanel();
}

function onCanvasPointerDown(event) {
  if (!state.data) return;
  const target = event.target;
  const resizeHandle = target.closest('.resize-handle');
  const labelGroup = target.closest('.percentage-label');
  const nodeGroup = target.closest('.node-group');
  const edgePath = target.closest('[data-edge-id]');
  const svg = els.chartWrap.querySelector('svg');
  if (!svg) return;

  if (edgePath && !nodeGroup && !labelGroup) {
    event.preventDefault();
    selectEdge(edgePath.dataset.edgeId);
    return;
  }

  // Background: pan with Space or middle mouse; otherwise clear selection.
  if (!labelGroup && !nodeGroup) {
    if (state.editor.spaceDown || event.button === 1) {
      event.preventDefault();
      startPan(event, svg);
      return;
    }
    if (state.editor.linkMode) {
      cancelLinkMode();
      return;
    }
    if (event.button === 0) {
      state.editor.selectedNodes.clear();
      state.editor.selectedEdge = null;
      state.editor.selectedLabel = null;
      renderChart();
      renderPropertyPanel();
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
    if (state.editor.linkMode) {
      event.preventDefault();
      event.stopPropagation();
      handleLinkNode(id);
      return;
    }
    if (!event.shiftKey && !state.editor.selectedNodes.has(id)) {
      state.editor.selectedNodes.clear();
    }
    if (event.shiftKey) {
      if (state.editor.selectedNodes.has(id)) state.editor.selectedNodes.delete(id);
      else state.editor.selectedNodes.add(id);
    } else {
      state.editor.selectedNodes.add(id);
    }
    state.editor.selectedEdge = null;
    state.editor.selectedLabel = null;
    renderChart();
    renderPropertyPanel();
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
      if (y < LAYOUT.contentTop) {
        height = Math.max(48, height - (LAYOUT.contentTop - y));
        y = LAYOUT.contentTop;
      }
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
          y: Math.max(LAYOUT.contentTop, snap(original.y + dy)),
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
    renderPropertyPanel();
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
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  state.editor.linkMode = null;
  pushHistory(before);
  refreshEditorViews();
  scheduleSaveAll();
  toast('已恢复自动排版；颜色样式保留。');
}


function nodeById(id) {
  return (state.data?.nodes || []).find((node) => node.id === id) || null;
}

function edgeById(id) {
  return (state.data?.edges || []).find((edge) => edge.__id === id) || null;
}

function currentEdge() {
  return state.editor.selectedEdge ? edgeById(state.editor.selectedEdge) : null;
}

function newStableId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

function refreshEditorViews() {
  if (!state.data) return;
  ensureEdgeIds(state.data);
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
  renderPropertyPanel();
}

function commitEditorChange(before, { result = false, layout = true, message = '' } = {}) {
  if (before) pushHistory(before);
  if (result) {
    state.dirty = true;
    scheduleResultSave();
  }
  if (layout) scheduleLayoutSave();
  refreshEditorViews();
  if (message) setLayoutStatus(message, '');
}

function bindPropertyControl(control, apply, { result = false, layout = true, live = false } = {}) {
  let before = null;
  const capture = () => { if (!before) before = snapshotLayout(); };
  control.addEventListener('focus', capture);
  control.addEventListener('pointerdown', capture);
  if (live) {
    control.addEventListener('input', () => {
      apply(control.type === 'checkbox' ? control.checked : control.value);
      renderChart();
    });
  }
  control.addEventListener('change', () => {
    const snapshot = before || snapshotLayout();
    apply(control.type === 'checkbox' ? control.checked : control.value);
    commitEditorChange(snapshot, { result, layout, message: '属性已更新。' });
    before = null;
  });
  return control;
}

function propertyField(label, control, wide = false) {
  return el('label', { class: `property-field${wide ? ' wide' : ''}` }, [
    el('span', { text: label }),
    control
  ]);
}

function propertySelect(options, value) {
  const select = el('select');
  for (const [optionValue, label] of options) {
    select.append(el('option', { value: optionValue, text: label, ...(String(value) === optionValue ? { selected: 'selected' } : {}) }));
  }
  return select;
}

function propertyColor(value, onApply) {
  const wrap = el('div', { class: 'color-control' });
  const input = el('input', { type: 'color', value: String(value || '#ffffff') });
  const hex = el('input', { type: 'text', value: String(value || '#ffffff'), class: 'color-hex', maxlength: '7', spellcheck: 'false' });
  bindPropertyControl(input, (next) => {
    hex.value = next;
    onApply(next);
  }, { live: true });
  bindPropertyControl(hex, (next) => {
    const text = String(next || '').trim();
    if (!/^#?[0-9a-f]{6}$/i.test(text)) {
      hex.value = input.value;
      toast('请输入有效的 HEX 颜色，例如 #1a2b3c。');
      return;
    }
    const normalized = text.startsWith('#') ? text : `#${text}`;
    input.value = normalized;
    hex.value = normalized;
    onApply(normalized);
  });
  wrap.append(input, hex);
  return wrap;
}

function propertyNumber(value, onApply, { min = '', max = '', step = '1', result = false } = {}) {
  const input = el('input', { type: 'number', value: String(value ?? ''), min: String(min), max: String(max), step: String(step) });
  bindPropertyControl(input, onApply, { result });
  return input;
}

function propertyText(value, onApply, placeholder = '', options = {}) {
  const input = el('input', { type: 'text', value: String(value ?? ''), placeholder });
  bindPropertyControl(input, onApply, options);
  return input;
}

function propertyAction(label, action, tone = '') {
  return el('button', { class: `mini-button${tone ? ` ${tone}` : ''}`, type: 'button', text: label, onclick: action });
}

function renderPropertyPanel() {
  const panel = els.propertyPanel;
  if (!panel) return;
  clear(panel);
  const row = panel.parentElement;
  if (row) row.classList.toggle('has-panel', Boolean(state.data));
  if (!state.data) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  editorStyles();

  if (state.editor.selectedLabel) {
    renderLabelPanel(panel);
    return;
  }
  if (state.editor.selectedNodes.size > 0) {
    renderNodePanel(panel);
    return;
  }
  if (state.editor.selectedEdge) {
    renderEdgePanel(panel);
    return;
  }
  renderCanvasPanel(panel);
}

function renderCanvasPanel(panel) {
  panel.append(
    el('div', { class: 'property-head' }, [
      el('strong', { text: '画布与主题' }),
      el('small', { text: '未选中对象' })
    ])
  );
  const theme = propertySelect(
    [['audit', '审计米金'], ['minimal', '简约灰白'], ['business', '蓝灰商务'], ['custom', '自定义主题']],
    state.editor.defaultTheme || 'audit'
  );
  const themeSection = el('div', { class: 'property-section' }, [
    el('strong', { text: '配色主题' }),
    propertyField('默认主题（新建组件）', theme),
    el('div', { class: 'property-actions' }, [
      propertyAction('应用到整张图', () => applyThemeToAll(theme.value)),
      propertyAction('仅设为默认', () => { const before = snapshotLayout(); state.editor.defaultTheme = theme.value; pushHistory(before); scheduleLayoutSave(); toast('新建组件将使用该主题。'); })
    ]),
    el('p', { class: 'property-note', text: '应用到整张图会覆盖已有节点/连线/比例的人工颜色，操作前会确认。' })
  ]);
  bindPropertyControl(theme, (value) => { state.editor.defaultTheme = value; }, { layout: true });
  const background = propertyColor(canvasStyle().background, (value) => {
    editorStyles().canvas.background = value;
  });
  panel.append(
    themeSection,
    el('div', { class: 'property-section' }, [
      el('strong', { text: '画布' }),
      propertyField('背景颜色', background),
      el('p', { class: 'property-note', text: '背景颜色会同步到 SVG、PNG、PDF。拖动空白区域可取消选择。' })
    ])
  );
}

function renderNodePanel(panel) {
  const ids = [...state.editor.selectedNodes];
  if (ids.length > 1) {
    panel.append(
      el('div', { class: 'property-head' }, [el('strong', { text: `${ids.length} 个节点` }), el('small', { text: '批量样式' })]),
      el('div', { class: 'property-section' }, [
        el('strong', { text: '批量颜色' }),
        propertyField('填充颜色', propertyColor(BASE_NODE_STYLE.fill, (value) => {
          for (const id of ids) editorStyles().nodes[id] = { ...(editorStyles().nodes[id] || {}), fill: value };
        }), true),
        propertyField('边框颜色', propertyColor(BASE_NODE_STYLE.stroke, (value) => {
          for (const id of ids) editorStyles().nodes[id] = { ...(editorStyles().nodes[id] || {}), stroke: value };
        }), true),
        el('p', { class: 'property-note', text: '只修改所选节点的样式，不改变名称、坐标或股权关系。' }),
        el('div', { class: 'property-actions' }, [
          propertyAction('复制所选', duplicateSelection),
          propertyAction('删除所选', deleteSelection, 'danger')
        ])
      ])
    );
    return;
  }

  const node = nodeById(ids[0]);
  if (!node) return;
  const style = nodeStyle(node);
  const position = nodeLayoutPosition(node.id) || { x: 0, y: 0, width: 180, height: 70 };
  panel.append(
    el('div', { class: 'property-head' }, [el('strong', { text: node.name || '未命名节点' }), el('small', { text: node.id })]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '业务信息' }),
      propertyField('名称', propertyText(node.name, (value) => { node.name = value.trim(); }, '公司名称', { result: true }), true),
      propertyField('类型', bindPropertyControl(propertySelect([
        ['company', '公司'], ['person', '个人'], ['fund', '基金'], ['institution', '机构'], ['other', '其他']
      ], node.entity_type), (value) => { node.entity_type = value; }, { result: true })),
      propertyField('层级', propertyNumber(node.level || 1, (value) => { node.level = Math.max(1, Number(value) || 1); }, { min: 1, result: true }), false),
      propertyField('状态', bindPropertyControl(propertySelect([
        ['active', '有效'], ['excluded_cancelled', '已注销/排除'], ['unknown', '未知']
      ], node.status), (value) => { node.status = value; }, { result: true })),
      propertyField('置信度', propertyNumber(node.confidence ?? 0, (value) => { node.confidence = Math.max(0, Math.min(1, Number(value) || 0)); }, { min: 0, max: 1, step: 0.01, result: true }))
    ]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '位置与尺寸（只改布局）' }),
      el('div', { class: 'property-grid' }, [
        propertyField('X', propertyNumber(position.x, (value) => setNodeLayout(node.id, { x: value }), { step: 5 })),
        propertyField('Y', propertyNumber(position.y, (value) => setNodeLayout(node.id, { y: value }), { step: 5 })),
        propertyField('宽度', propertyNumber(position.width, (value) => setNodeLayout(node.id, { width: value }), { min: 100, step: 5 })),
        propertyField('高度', propertyNumber(position.height, (value) => setNodeLayout(node.id, { height: value }), { min: 48, step: 5 }))
      ]),
      el('div', { class: 'property-actions' }, [
        propertyAction('重置自动位置', () => resetNodePosition(node.id)),
        propertyAction('锁定位置', () => toggleNodeLock(node.id))
      ])
    ]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '节点样式' }),
      el('div', { class: 'property-grid' }, [
        propertyField('填充', propertyColor(style.fill, (value) => updateNodeStyle(node.id, 'fill', value))),
        propertyField('边框', propertyColor(style.stroke, (value) => updateNodeStyle(node.id, 'stroke', value))),
        propertyField('文字颜色', propertyColor(style.textColor, (value) => updateNodeStyle(node.id, 'textColor', value))),
        propertyField('字体大小', propertyNumber(style.fontSize, (value) => updateNodeStyle(node.id, 'fontSize', Number(value)), { min: 8, max: 48 })),
        propertyField('字重', bindPropertyControl(propertySelect([['400', '常规'], ['500', '中等'], ['700', '粗体']], String(style.fontWeight)), (value) => updateNodeStyle(node.id, 'fontWeight', Number(value)), { layout: true })),
        propertyField('边框粗细', propertyNumber(style.strokeWidth, (value) => updateNodeStyle(node.id, 'strokeWidth', Number(value)), { min: 0, max: 10, step: 0.25 })),
        propertyField('圆角', propertyNumber(style.radius, (value) => updateNodeStyle(node.id, 'radius', Number(value)), { min: 0, max: 40 })),
        propertyField('锁定', (() => { const input = el('input', { type: 'checkbox' }); input.checked = Boolean(position.locked); bindPropertyControl(input, (value) => setNodeLock(node.id, value)); return input; })())
      ]),
      el('div', { class: 'property-actions' }, [
        propertyAction('复制节点', duplicateSelection),
        propertyAction('删除节点', deleteSelection, 'danger')
      ])
    ])
  );
}

function renderEdgePanel(panel) {
  const edge = currentEdge();
  if (!edge) { state.editor.selectedEdge = null; renderCanvasPanel(panel); return; }
  const style = edgeStyle(edge.__id);
  const nodes = state.data.nodes || [];
  panel.append(
    el('div', { class: 'property-head' }, [el('strong', { text: '股权连线' }), el('small', { text: edge.__id })]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '业务关系' }),
      propertyField('出资方', bindPropertyControl(propertySelect(nodes.map((node) => [node.id, node.name]), edge.source), (value) => { edge.source = value; }, { result: true }), true),
      propertyField('被投资方', bindPropertyControl(propertySelect(nodes.map((node) => [node.id, node.name]), edge.target), (value) => { edge.target = value; }, { result: true }), true),
      propertyField('持股比例', propertyText(edge.percentage || '', (value) => {
        edge.percentage = value.trim();
        edge.percentage_source = edge.percentage ? 'manual' : 'missing';
      }, '如 30.4498%', { result: true }), true),
      propertyField('关系类型', bindPropertyControl(propertySelect([
        ['shareholder_to_core', '股东 → 核心'], ['investment', '投资'], ['subsidiary', '子公司']
      ], edge.relation), (value) => { edge.relation = value; }, { result: true }), true),
      propertyField('置信度', propertyNumber(edge.confidence ?? 0, (value) => { edge.confidence = Math.max(0, Math.min(1, Number(value) || 0)); }, { min: 0, max: 1, step: 0.01, result: true }))
    ]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '连线样式' }),
      el('div', { class: 'property-grid' }, [
        propertyField('线条颜色', propertyColor(style.stroke, (value) => updateEdgeStyle(edge.__id, 'stroke', value))),
        propertyField('线宽', propertyNumber(style.strokeWidth, (value) => updateEdgeStyle(edge.__id, 'strokeWidth', Number(value)), { min: 0.5, max: 8, step: 0.25 })),
        propertyField('线型', bindPropertyControl(propertySelect([['none', '实线'], ['5 3', '虚线'], ['2 3', '点线']], style.dash), (value) => updateEdgeStyle(edge.__id, 'dash', value))),
        propertyField('箭头', (() => { const input = el('input', { type: 'checkbox' }); input.checked = style.arrow !== false; bindPropertyControl(input, (value) => updateEdgeStyle(edge.__id, 'arrow', value)); return input; })())
      ]),
      el('div', { class: 'property-actions' }, [
        propertyAction('添加/显示比例', () => addPercentageToEdge(edge)),
        propertyAction('隐藏比例标签', () => hideEdgeLabel(edge)),
        propertyAction('删除连线', () => deleteEdge(edge), 'danger')
      ])
    ])
  );
}

function renderLabelPanel(panel) {
  const edge = edgeById(state.editor.selectedLabel);
  if (!edge) { state.editor.selectedLabel = null; renderCanvasPanel(panel); return; }
  const style = labelStyle(edge.__id);
  const info = (state.editor.renderInfo?.labelItems || []).find((item) => item.id === edge.__id) || {};
  const manual = state.editor.labels[edge.__id] || {};
  panel.append(
    el('div', { class: 'property-head' }, [el('strong', { text: '持股比例标签' }), el('small', { text: edge.__id })]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '业务数值（同步关系）' }),
      propertyField('比例文字', propertyText(edge.percentage || '', (value) => {
        edge.percentage = value.trim();
        edge.percentage_source = edge.percentage ? 'manual' : 'missing';
      }, '如 30.4498%', { result: true }), true)
    ]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '位置（只改标签）' }),
      el('div', { class: 'property-grid' }, [
        propertyField('X', propertyNumber(manual.x ?? info.x ?? 0, (value) => setLabelLayout(edge.__id, { x: Number(value) }), { step: 5 })),
        propertyField('Y', propertyNumber(manual.y ?? info.y ?? 0, (value) => setLabelLayout(edge.__id, { y: Number(value) }), { step: 5 }))
      ]),
      el('div', { class: 'property-actions' }, [
        propertyAction('恢复自动位置', () => resetLabelPosition(edge.__id)),
        propertyAction('隐藏标签', () => hideEdgeLabel(edge)),
        propertyAction('删除连线', () => deleteEdge(edge), 'danger')
      ])
    ]),
    el('div', { class: 'property-section' }, [
      el('strong', { text: '标签样式' }),
      el('div', { class: 'property-grid' }, [
        propertyField('文字颜色', propertyColor(style.color, (value) => updateLabelStyle(edge.__id, 'color', value))),
        propertyField('背景色', propertyColor(style.background, (value) => updateLabelStyle(edge.__id, 'background', value))),
        propertyField('字体大小', propertyNumber(style.fontSize, (value) => updateLabelStyle(edge.__id, 'fontSize', Number(value)), { min: 8, max: 30 })),
        propertyField('字重', bindPropertyControl(propertySelect([['400', '常规'], ['500', '中等'], ['700', '粗体']], String(style.fontWeight)), (value) => updateLabelStyle(edge.__id, 'fontWeight', Number(value)))),
        propertyField('左右边距', propertyNumber(style.paddingX, (value) => updateLabelStyle(edge.__id, 'paddingX', Number(value)), { min: 0, max: 20 })),
        propertyField('上下边距', propertyNumber(style.paddingY, (value) => updateLabelStyle(edge.__id, 'paddingY', Number(value)), { min: 0, max: 20 })),
        propertyField('圆角', propertyNumber(style.radius, (value) => updateLabelStyle(edge.__id, 'radius', Number(value)), { min: 0, max: 20 }))
      ])
    ])
  );
}

function setNodeLayout(id, patch) {
  const position = nodeLayoutPosition(id);
  if (!position) return;
  const next = {
    x: position.x, y: position.y, width: position.width, height: position.height,
    manualPosition: true, ...(state.editor.nodes[id] || {})
  };
  for (const [key, value] of Object.entries(patch)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      const value = key === 'width' || key === 'height' ? Math.max(key === 'width' ? 100 : 48, Math.round(number)) : Math.round(number);
      next[key] = key === 'y' ? Math.max(LAYOUT.contentTop, value) : value;
    }
  }
  state.editor.nodes[id] = next;
}

function setNodeLock(id, locked) {
  const position = nodeLayoutPosition(id);
  state.editor.nodes[id] = {
    ...(state.editor.nodes[id] || {}),
    x: position?.x, y: position?.y, width: position?.width, height: position?.height,
    manualPosition: Boolean(state.editor.nodes[id]?.manualPosition),
    locked: Boolean(locked)
  };
}

function toggleNodeLock(id) {
  const before = snapshotLayout();
  const current = Boolean(state.editor.nodes[id]?.locked || nodeLayoutPosition(id)?.locked);
  setNodeLock(id, !current);
  commitEditorChange(before, { layout: true, message: current ? '已解锁节点。' : '已锁定节点。' });
}

function resetNodePosition(id) {
  const before = snapshotLayout();
  const locked = Boolean(state.editor.nodes[id]?.locked);
  if (locked) state.editor.nodes[id] = { locked: true };
  else delete state.editor.nodes[id];
  commitEditorChange(before, { layout: true, message: '已恢复自动位置。' });
}

function updateNodeStyle(id, key, value) {
  const styles = editorStyles();
  const current = styles.nodes[id] || {};
  styles.nodes[id] = { ...current, [key]: value };
}

function updateEdgeStyle(id, key, value) {
  const styles = editorStyles();
  styles.edges[id] = { ...(styles.edges[id] || {}), [key]: value };
}

function updateLabelStyle(id, key, value) {
  const styles = editorStyles();
  styles.labels[id] = { ...(styles.labels[id] || {}), [key]: value };
}

function setLabelLayout(id, patch) {
  const info = (state.editor.renderInfo?.labelItems || []).find((item) => item.id === id) || {};
  const current = state.editor.labels[id] || {};
  state.editor.labels[id] = {
    ...current,
    x: Number.isFinite(Number(patch.x)) ? Number(patch.x) : (Number.isFinite(Number(current.x)) ? Number(current.x) : info.x),
    y: Number.isFinite(Number(patch.y)) ? Number(patch.y) : (Number.isFinite(Number(current.y)) ? Number(current.y) : info.y),
    manual: true
  };
}

function resetLabelPosition(id) {
  const before = snapshotLayout();
  delete state.editor.labels[id];
  const style = editorStyles().labels[id];
  if (style && style.hidden) delete style.hidden;
  commitEditorChange(before, { layout: true, message: '比例标签已恢复自动位置。' });
}

function addPercentageToEdge(edge) {
  if (!edge) return toast('请先选择一条股权连线。');
  const current = edge.percentage || '';
  const value = window.prompt('输入持股比例（保留原始精度，例如 30.4498%）', current);
  if (value === null) return;
  const text = value.trim();
  if (!text) return;
  const before = snapshotLayout();
  edge.percentage = text;
  edge.percentage_source = 'manual';
  editorStyles().labels[edge.__id] = { ...(editorStyles().labels[edge.__id] || {}), hidden: false };
  state.editor.selectedEdge = edge.__id;
  state.editor.selectedLabel = null;
  commitEditorChange(before, { result: true, layout: true, message: '持股比例已更新。' });
}

function hideEdgeLabel(edge) {
  if (!edge) return;
  const before = snapshotLayout();
  editorStyles().labels[edge.__id] = { ...(editorStyles().labels[edge.__id] || {}), hidden: true };
  state.editor.selectedLabel = null;
  commitEditorChange(before, { layout: true, message: '比例标签已隐藏；关系数据保留。' });
}

function deleteEdge(edge) {
  if (!edge) return;
  const before = snapshotLayout();
  state.data.edges = (state.data.edges || []).filter((item) => item !== edge);
  delete state.editor.labels[edge.__id];
  delete editorStyles().edges[edge.__id];
  delete editorStyles().labels[edge.__id];
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  commitEditorChange(before, { result: true, layout: true, message: '连线已删除，可撤销。' });
}

function deleteSelection() {
  const hasNodes = state.editor.selectedNodes.size > 0;
  const edge = currentEdge();
  const labelId = state.editor.selectedLabel;
  if (!hasNodes && !edge && !labelId) return toast('请先选择节点、连线或比例标签。');
  if (labelId) return hideEdgeLabel(edgeById(labelId));
  const before = snapshotLayout();
  if (edge) {
    state.data.edges = (state.data.edges || []).filter((item) => item !== edge);
    delete state.editor.labels[edge.__id];
    delete editorStyles().edges[edge.__id];
    delete editorStyles().labels[edge.__id];
    state.editor.selectedEdge = null;
    commitEditorChange(before, { result: true, layout: true, message: '连线已删除，可撤销。' });
    return;
  }
  const ids = new Set(state.editor.selectedNodes);
  state.data.nodes = (state.data.nodes || []).filter((node) => !ids.has(node.id));
  const removedEdges = (state.data.edges || []).filter((item) => ids.has(item.source) || ids.has(item.target));
  state.data.edges = (state.data.edges || []).filter((item) => !ids.has(item.source) && !ids.has(item.target));
  for (const id of ids) {
    delete state.editor.nodes[id];
    delete editorStyles().nodes[id];
  }
  for (const item of removedEdges) {
    delete state.editor.labels[item.__id];
    delete editorStyles().edges[item.__id];
    delete editorStyles().labels[item.__id];
  }
  state.editor.selectedNodes.clear();
  commitEditorChange(before, { result: true, layout: true, message: '节点及关联关系已删除，可撤销。' });
}

function insertNode(entityType = 'company', options = {}) {
  if (!state.data) throw new Error('尚未加载股权结构。');
  const labels = { company: '新公司', person: '新个人', fund: '新基金', institution: '新机构', other: '新节点' };
  const id = options.id || newStableId('n');
  const layoutInfo = state.editor.renderInfo?.layout;
  const canvasWidth = layoutInfo?.width || 1200;
  const canvasHeight = layoutInfo?.height || 600;
  const existing = (state.data.nodes || []).length;
  const maxLevel = Math.max(1, ...(state.data.nodes || []).map((item) => Number(item.level) || 1));
  const width = Number(options.width) || 180;
  const height = Number(options.height) || 70;
  const node = {
    id,
    name: String(options.name ?? labels[entityType] ?? '新节点'),
    entity_type: entityType,
    level: Number.isFinite(Number(options.level)) ? Math.max(1, Number(options.level)) : maxLevel + 1,
    status: 'active',
    confidence: 1,
    bbox: null
  };
  state.data.nodes = state.data.nodes || [];
  state.data.nodes.push(node);
  const position = options.position || {
    x: Math.round(canvasWidth / 2 - width / 2 + (existing % 4) * 24),
    y: Math.round(Math.max(120, canvasHeight / 2 - height / 2 + (existing % 3) * 18)),
    width,
    height
  };
  state.editor.nodes[id] = {
    x: Math.round(Number(position.x) || 10),
    y: Math.round(Number(position.y) || 10),
    width: Math.round(Number(position.width) || width),
    height: Math.round(Number(position.height) || height),
    manualPosition: true,
    locked: false
  };
  const theme = THEMES[state.editor.defaultTheme] || THEMES.audit;
  editorStyles().nodes[id] = {
    ...(theme.nodes || {}),
    ...(options.style || {})
  };
  state.editor.selectedNodes = new Set([id]);
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  return id;
}

function addNode(entityType = 'company', options = {}) {
  if (!state.data) return;
  const before = snapshotLayout();
  const labels = { company: '新公司', person: '新个人', fund: '新基金', institution: '新机构', other: '新节点' };
  insertNode(entityType, options);
  commitEditorChange(before, { result: true, layout: true, message: `已添加${labels[entityType] || '节点'}，可继续编辑名称和样式。` });
  if (els.chartWrap) els.chartWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}


function isCoreNode(node) {
  if (!node) return false;
  if (state.data?.core_company) return node.name === state.data.core_company;
  return Number(node.level) === 2;
}

function relatedDirection() {
  return document.querySelector('input[name="relatedDirection"]:checked')?.value || 'upstream';
}

function relatedTargetNode() {
  return nodeById(els.relatedTarget?.value || '');
}

function parseRelatedPercentage(raw) {
  const original = String(raw ?? '').trim();
  if (!original) return { ok: false, error: '请输入持股比例。' };
  const text = original.replace(/\s+/g, '').replace(/％/g, '%');
  if (!/^\d+(?:\.\d+)?%?$/.test(text)) return { ok: false, error: '持股比例必须是 0–100 的数字，可带 %。' };
  const numeric = Number(text.replace('%', ''));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return { ok: false, error: '持股比例必须在 0% 至 100% 之间。' };
  }
  return { ok: true, value: text.endsWith('%') ? text : `${text}%`, numeric };
}

function fillRelatedTargets() {
  const select = els.relatedTarget;
  if (!select) return;
  clear(select);
  select.append(el('option', { value: '', text: '请选择关联公司' }));
  const active = (state.data?.nodes || [])
    .filter((node) => node.status !== 'excluded_cancelled')
    .sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  for (const node of active) {
    select.append(el('option', {
      value: node.id,
      text: `L${Number(node.level) || 1} · ${node.name}`
    }));
  }
  const selected = state.editor.selectedNodes.size === 1 ? [...state.editor.selectedNodes][0] : '';
  if (selected && active.some((node) => node.id === selected)) select.value = selected;
}

function updateRelatedForm() {
  if (!els.relatedDialog || els.relatedDialog.hidden) return;
  const mode = relatedDirection();
  const only = mode === 'only';
  if (els.relatedTargetField) els.relatedTargetField.hidden = only;
  if (els.relatedPercentageField) els.relatedPercentageField.hidden = only;
  if (els.relatedTarget) els.relatedTarget.required = !only;
  if (els.relatedPercentage) els.relatedPercentage.required = !only;
  if (els.createRelatedButton) els.createRelatedButton.innerHTML = only ? '仅添加公司 <span>→</span>' : '创建关联关系 <span>→</span>';
  const target = relatedTargetNode();
  const targetLabel = target ? target.name : '请选择关联公司';
  if (els.relatedPreview) {
    els.relatedPreview.textContent = only
      ? '仅创建独立公司节点，不创建连线和比例。'
      : mode === 'upstream'
        ? `新公司 → ${targetLabel}`
        : `${targetLabel} → 新公司`;
  }
  showError(els.relatedError, '');
}

function openRelatedDialog() {
  if (!state.data) return toast('请先完成识别。');
  if (!els.relatedDialog) return;
  fillRelatedTargets();
  els.relatedName.value = '';
  els.relatedType.value = 'company';
  els.relatedPercentage.value = '';
  const upstream = els.relatedForm?.querySelector('input[name="relatedDirection"][value="upstream"]');
  if (upstream) upstream.checked = true;
  showError(els.relatedError, '');
  updateRelatedForm();
  els.relatedDialog.hidden = false;
  els.relatedBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  els.relatedName.focus();
}

function closeRelatedDialog() {
  if (!els.relatedDialog) return;
  els.relatedDialog.hidden = true;
  els.relatedBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  showError(els.relatedError, '');
}

function nextRelatedPosition(targetPosition, direction, width, height) {
  const positions = [...(state.editor.renderInfo?.layout?.positions?.values?.() || [])];
  const centerX = targetPosition.x + targetPosition.width / 2 - width / 2;
  const baseY = direction === 'upstream'
    ? Math.max(LAYOUT.contentTop, targetPosition.y - height - 120)
    : targetPosition.y + targetPosition.height + 120;
  const offsets = [0, -(width + 28), width + 28, -2 * (width + 28), 2 * (width + 28), -3 * (width + 28), 3 * (width + 28)];
  for (const offset of offsets) {
    const candidate = {
      x: Math.max(10, Math.round(centerX + offset)),
      y: Math.max(LAYOUT.contentTop, Math.round(baseY)),
      width, height
    };
    if (!positions.some((position) => boxesOverlap(candidate, position, 20))) return candidate;
  }
  return { x: Math.max(10, Math.round(centerX)), y: Math.max(LAYOUT.contentTop, Math.round(baseY)), width, height };
}

function persistAutoLabel(edgeId) {
  const item = (state.editor.renderInfo?.labelItems || []).find((label) => label.id === edgeId);
  if (!item) return;
  state.editor.labels[edgeId] = { x: item.x, y: item.y, manual: false, auto: true };
  scheduleLayoutSave();
}

function rebaseLevels(shift = 1) {
  if (!state.data || !shift) return;
  for (const node of state.data.nodes || []) {
    node.level = Math.max(1, (Number(node.level) || 1) + shift);
  }
  const dy = LAYOUT.levelGap * shift;
  for (const node of Object.values(state.editor.nodes || {})) {
    if (Number.isFinite(Number(node?.y))) node.y = Math.round(Number(node.y) + dy);
  }
  for (const label of Object.values(state.editor.labels || {})) {
    if (Number.isFinite(Number(label?.y))) label.y = Math.round(Number(label.y) + dy);
  }
  for (const bus of Object.values(state.editor.buses || {})) {
    if (Number.isFinite(Number(bus?.y))) bus.y = Math.round(Number(bus.y) + dy);
  }
}

function createRelatedCompany() {
  if (!state.data) return;
  const mode = relatedDirection();
  const name = String(els.relatedName.value || '').trim();
  const entityType = String(els.relatedType.value || 'company');
  let target = mode === 'only' ? null : relatedTargetNode();
  if (!name) return showError(els.relatedError, '请输入新公司名称。');
  if (mode !== 'only' && !target) return showError(els.relatedError, '请选择关联公司。');
  if (mode !== 'only' && target?.status === 'excluded_cancelled') return showError(els.relatedError, '已注销节点不能作为关联对象。');
  let percentage = null;
  if (mode !== 'only') {
    const parsed = parseRelatedPercentage(els.relatedPercentage.value);
    if (!parsed.ok) return showError(els.relatedError, parsed.error);
    percentage = parsed.value;
  }

  const before = snapshotLayout();
  let committed = false;
  let rebased = false;
  try {
    if (mode === 'upstream' && target && (Number(target.level) || 1) <= 1) {
      rebaseLevels(1);
      target = nodeById(target.id);
      rebased = true;
    }
    const width = Math.max(160, Math.min(280, name.length * 14 + 40));
    const charsPerLine = Math.max(8, Math.floor((width - 36) / 14));
    const lineCount = Math.max(1, Math.ceil(name.length / charsPerLine));
    const height = Math.max(70, lineCount * 22 + 24);
    const level = mode === 'only' ? undefined
      : mode === 'upstream' ? Math.max(1, (Number(target.level) || 1) - 1)
      : (Number(target.level) || 1) + 1;
    const targetPosition = mode === 'only' ? null : (nodeLayoutPosition(target.id) || { x: 120, y: 120, width: 180, height: 70 });
    if (targetPosition && rebased) targetPosition.y += LAYOUT.levelGap;
    const position = mode === 'only' ? undefined : nextRelatedPosition(targetPosition, mode, width, height);
    const newId = insertNode(entityType, { name, level, width, height, position });
    if (mode !== 'only') {
      const edge = {
        source: mode === 'upstream' ? newId : target.id,
        target: mode === 'upstream' ? target.id : newId,
        percentage,
        relation: mode === 'upstream' && isCoreNode(target) ? 'shareholder_to_core' : 'investment',
        confidence: 1,
        percentage_source: 'manual',
        __id: newStableId('e')
      };
      state.data.edges = state.data.edges || [];
      state.data.edges.push(edge);
      editorStyles().labels[edge.__id] = { ...(editorStyles().labels[edge.__id] || {}), hidden: false };
      state.editor.selectedNodes.clear();
      state.editor.selectedEdge = edge.__id;
      state.editor.selectedLabel = null;
      commitEditorChange(before, { result: true, layout: true, message: `已添加${mode === 'upstream' ? '上游股东' : '下游被投资公司'}及 ${percentage} 持股比例。` });
      committed = true;
      persistAutoLabel(edge.__id);
    } else {
      commitEditorChange(before, { result: true, layout: true, message: '已添加独立公司节点，未创建连线或比例。' });
      committed = true;
    }
    closeRelatedDialog();
    if (els.chartWrap) els.chartWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  } catch (error) {
    if (!committed) restoreLayout(before);
    showError(els.relatedError, `创建失败：${error.message}`);
    return false;
  }
}

function duplicateSelection() {
  if (!state.data || state.editor.selectedNodes.size === 0) return toast('请先选择要复制的节点。');
  const before = snapshotLayout();
  const ids = new Set();
  const selected = [...state.editor.selectedNodes].map(nodeById).filter(Boolean);
  const maxLevel = Math.max(1, ...(state.data.nodes || []).map((item) => Number(item.level) || 1));
  for (const node of selected) {
    const id = newStableId('n');
    const copy = { ...cloneJson(node), id, name: `${node.name}（副本）`, bbox: null, level: maxLevel + 1 };
    state.data.nodes.push(copy);
    const position = nodeLayoutPosition(node.id) || { x: 120, y: 120, width: 180, height: 70 };
    state.editor.nodes[id] = {
      x: position.x + 30, y: position.y + 30,
      width: position.width, height: position.height,
      manualPosition: true, locked: false
    };
    editorStyles().nodes[id] = cloneJson(editorStyles().nodes[node.id] || {});
    ids.add(id);
  }
  state.editor.selectedNodes = ids;
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  commitEditorChange(before, { result: true, layout: true, message: '已复制节点（未复制股权关系），可撤销。' });
}

function startLinkMode() {
  if (!state.data) return;
  state.editor.linkMode = { source: null };
  state.editor.selectedNodes.clear();
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  if (els.addEdgeButton) els.addEdgeButton.classList.add('active');
  renderChart();
  renderPropertyPanel();
  setLayoutStatus('连线模式：请点击源节点，再点击目标节点；Esc 取消。', 'saving');
  if (els.chartWrap) els.chartWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelLinkMode() {
  if (!state.editor.linkMode) return;
  state.editor.linkMode = null;
  if (els.addEdgeButton) els.addEdgeButton.classList.remove('active');
  renderChart();
  setLayoutStatus('已取消连线操作。', '');
}

function handleLinkNode(id) {
  const mode = state.editor.linkMode;
  if (!mode) return false;
  if (!mode.source) {
    mode.source = id;
    selectNode(id, false);
    setLayoutStatus('已选择源节点，请点击目标节点；Esc 取消。', 'saving');
    return true;
  }
  if (mode.source === id) {
    toast('源节点和目标节点不能相同。');
    return true;
  }
  const before = snapshotLayout();
  const edge = {
    source: mode.source,
    target: id,
    percentage: '',
    relation: 'investment',
    confidence: 1,
    percentage_source: 'manual',
    __id: newStableId('e')
  };
  state.data.edges = state.data.edges || [];
  state.data.edges.push(edge);
  state.editor.linkMode = null;
  if (els.addEdgeButton) els.addEdgeButton.classList.remove('active');
  state.editor.selectedNodes.clear();
  state.editor.selectedEdge = edge.__id;
  commitEditorChange(before, { result: true, layout: true, message: '股权连线已添加，可设置比例和样式。' });
  return true;
}

function applyThemeToAll(themeKey) {
  const theme = THEMES[themeKey];
  if (!theme) return;
  const styles = editorStyles();
  const overrides = Object.keys(styles.nodes).length + Object.keys(styles.edges).length + Object.keys(styles.labels).length;
  if (overrides > 0 && !window.confirm('将覆盖已有的人工颜色设置，是否继续？')) return;
  const before = snapshotLayout();
  for (const node of state.data?.nodes || []) {
    styles.nodes[node.id] = { ...(styles.nodes[node.id] || {}), ...(theme.nodes || {}) };
  }
  for (const edge of state.data?.edges || []) {
    styles.edges[edge.__id] = { ...(styles.edges[edge.__id] || {}), ...(theme.edges || {}) };
    styles.labels[edge.__id] = { ...(styles.labels[edge.__id] || {}), ...(theme.labels || {}) };
  }
  styles.canvas = { ...(styles.canvas || {}), ...(theme.canvas || {}) };
  styles.theme = themeKey;
  state.editor.defaultTheme = themeKey;
  commitEditorChange(before, { result: false, layout: true, message: `已应用主题「${theme.name}」。` });
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
  for (const label of ['层级', '实体名称', '类型', '状态', '锁定', '置信度', '操作'] ) head.append(el('th', { text: label }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  if (!rows.length) {
    body.append(el('tr', {}, [el('td', { colspan: '7', class: 'empty-state', text: '没有匹配的节点。' })]));
  }
  rows.forEach((node) => {
    const tr = el('tr');
    const levelInput = el('input', { type: 'number', min: '1', value: String(node.level || 1) });
    levelInput.addEventListener('change', () => { const before = snapshotLayout(); node.level = Math.max(1, Number(levelInput.value) || 1); markDirty(); pushHistory(before); scheduleRender(); });
    const nameInput = el('input', { type: 'text', value: node.name || '' });
    nameInput.addEventListener('change', () => { const before = snapshotLayout(); node.name = nameInput.value.trim(); markDirty(); pushHistory(before); scheduleRender(); });
    const typeSelect = el('select');
    for (const [value, label] of [['company', '公司'], ['person', '个人'], ['fund', '基金'], ['institution', '机构'], ['other', '其他']]) {
      typeSelect.append(el('option', { value, text: label, ...(node.entity_type === value ? { selected: 'selected' } : {}) }));
    }
    typeSelect.addEventListener('change', () => { const before = snapshotLayout(); node.entity_type = typeSelect.value; markDirty(); pushHistory(before); scheduleRender(); });
    const statusSelect = el('select');
    for (const [value, label] of [['active', '有效'], ['excluded_cancelled', '已注销/排除'], ['unknown', '未知']]) {
      statusSelect.append(el('option', { value, text: label, ...(node.status === value ? { selected: 'selected' } : {}) }));
    }
    statusSelect.addEventListener('change', () => { const before = snapshotLayout(); node.status = statusSelect.value; markDirty(); pushHistory(before); scheduleRender(); });
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
      el('td', { class: 'cell-muted' }, [
        el('button', {
          type: 'button', class: 'mini-button', text: '编辑',
          onclick: () => selectNode(node.id, false)
        }),
        el('span', { text: Array.isArray(node.bbox) ? ` ${node.bbox.map(Math.round).join(',')}` : '' })
      ])
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
    const sourceSelect = nodeSelect(nodes, edge.source, (value) => { const before = snapshotLayout(); edge.source = value; markDirty(); pushHistory(before); scheduleRender(); });
    const targetSelect = nodeSelect(nodes, edge.target, (value) => { const before = snapshotLayout(); edge.target = value; markDirty(); pushHistory(before); scheduleRender(); });
    const percentage = el('input', { type: 'text', value: edge.percentage || '', placeholder: '如 54%' });
    percentage.addEventListener('change', () => {
      const before = snapshotLayout();
      edge.percentage = percentage.value.trim();
      edge.percentage_source = edge.percentage ? 'manual' : 'missing';
      markDirty();
      pushHistory(before);
      scheduleRender();
    });
    const relation = el('select');
    for (const [value, label] of [['shareholder_to_core', '股东 → 核心'], ['investment', '投资'], ['subsidiary', '子公司']]) {
      relation.append(el('option', { value, text: label, ...(edge.relation === value ? { selected: 'selected' } : {}) }));
    }
    relation.addEventListener('change', () => { const before = snapshotLayout(); edge.relation = relation.value; markDirty(); pushHistory(before); scheduleRender(); });
    const confidence = el('input', { type: 'number', min: '0', max: '1', step: '0.01', value: String(edge.confidence ?? 0) });
    confidence.addEventListener('change', () => { const before = snapshotLayout(); edge.confidence = Math.max(0, Math.min(1, Number(confidence.value) || 0)); markDirty(); pushHistory(before); scheduleRender(); });
    const source = el('select');
    for (const value of ['secondary_crop_ocr', 'global_ocr', 'manual', 'missing']) {
      source.append(el('option', { value, text: value, ...(edge.percentage_source === value ? { selected: 'selected' } : {}) }));
    }
    source.addEventListener('change', () => { const before = snapshotLayout(); edge.percentage_source = source.value; markDirty(); pushHistory(before); scheduleRender(); });
    const edit = el('button', { type: 'button', class: 'mini-button', text: '编辑', onclick: () => selectEdge(edge.__id) });
    const remove = el('button', { type: 'button', class: 'mini-button danger', text: '删除' });
    remove.addEventListener('click', () => deleteEdge(edge));
    tr.append(el('td', {}, [sourceSelect]), el('td', {}, [targetSelect]), el('td', {}, [percentage]),
      el('td', {}, [relation]), el('td', {}, [confidence]), el('td', {}, [source]), el('td', {}, [edit, remove]));
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
  const nodes = state.data?.nodes || [];
  if (nodes.length < 2) return toast('至少需要两个节点。');
  startLinkMode();
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
  els.chartMeta.textContent = '有未保存的结构修改';
  setLayoutStatus('有未保存的结构修改，正在自动保存…', 'saving');
  scheduleResultSave();
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
  renderPropertyPanel();
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
  return queueSave('result', async () => {
    try {
      await api(`/${state.job.id}/result`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.data)
      });
      state.dirty = false;
      if (!silent) toast('修改已保存。');
      else setLayoutStatus('结构修改已自动保存。', 'saved');
      return true;
    } catch (error) {
      setLayoutStatus(`结构保存失败：${error.message}`, 'error');
      showError(els.jsonError, error.message);
      if (!silent) toast(`保存失败：${error.message}`);
      return false;
    }
  });
}

async function saveAllManual() {
  if (!state.job || !state.data) return false;
  const saved = await flushSaves();
  if (saved) toast('业务数据、布局和样式已保存。');
  else toast('保存失败，请检查网络后重试。');
  return saved;
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
  const saved = await flushSaves();
  if (!saved) throw new Error('保存当前修改/布局失败，未导出。');
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
  state.editor.styles = { nodes: {}, edges: {}, labels: {}, canvas: {}, theme: 'audit' };
  state.editor.selectedNodes.clear();
  state.editor.selectedEdge = null;
  state.editor.selectedLabel = null;
  state.editor.linkMode = null;
  state.editor.defaultTheme = 'audit';
  state.editor.saveChains = { result: Promise.resolve(), layout: Promise.resolve() };
  clearTimeout(state.editor.saveTimer);
  clearTimeout(state.editor.resultSaveTimer);
  state.editor.saveTimer = null;
  state.editor.resultSaveTimer = null;
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
  els.saveButton.addEventListener('click', () => saveAllManual());
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
  els.closeRelatedButton.addEventListener('click', closeRelatedDialog);
  els.cancelRelatedButton.addEventListener('click', closeRelatedDialog);
  els.relatedBackdrop.addEventListener('click', closeRelatedDialog);
  els.relatedTarget.addEventListener('change', updateRelatedForm);
  els.relatedForm.querySelectorAll('input[name="relatedDirection"]').forEach((input) => input.addEventListener('change', updateRelatedForm));
  els.relatedForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.editor.relatedBusy) return;
    state.editor.relatedBusy = true;
    els.createRelatedButton.disabled = true;
    try { createRelatedCompany(); }
    finally {
      state.editor.relatedBusy = false;
      els.createRelatedButton.disabled = false;
    }
  });
  els.zoomIn.addEventListener('click', () => setZoom(state.editor.zoom + 0.1));
  els.zoomOut.addEventListener('click', () => setZoom(state.editor.zoom - 0.1));
  els.zoomReset.addEventListener('click', () => setZoom(1));
  els.fitButton.addEventListener('click', fitViewport);
  els.alignTopButton.addEventListener('click', () => alignSelected('top'));
  els.alignCenterButton.addEventListener('click', () => alignSelected('center'));
  els.distributeButton.addEventListener('click', distributeSelected);
  els.addRelatedButton.addEventListener('click', openRelatedDialog);
  els.addCompanyButton.addEventListener('click', () => addNode('company'));
  els.addPersonButton.addEventListener('click', () => addNode('person'));
  els.addFundButton.addEventListener('click', () => addNode('fund'));
  els.addInstitutionButton.addEventListener('click', () => addNode('institution'));
  els.addOtherButton.addEventListener('click', () => addNode('other'));
  els.addEdgeButton.addEventListener('click', () => {
    if (state.editor.linkMode) cancelLinkMode();
    else startLinkMode();
  });
  els.addLabelButton.addEventListener('click', () => addPercentageToEdge(currentEdge()));
  els.duplicateButton.addEventListener('click', duplicateSelection);
  els.deleteButton.addEventListener('click', deleteSelection);
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
  window.addEventListener('keydown', (event) => {
    const tag = String(document.activeElement?.tagName || '').toLowerCase();
    const editing = ['input', 'textarea', 'select'].includes(tag) || document.activeElement?.isContentEditable;
    if (event.key === 'Escape') {
      if (els.relatedDialog && !els.relatedDialog.hidden) { event.preventDefault(); closeRelatedDialog(); return; }
      if (state.editor.linkMode) { event.preventDefault(); cancelLinkMode(); return; }
      if (!editing) {
        state.editor.selectedNodes.clear();
        state.editor.selectedEdge = null;
        state.editor.selectedLabel = null;
        renderChart();
        renderPropertyPanel();
      }
      return;
    }
    if (editing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoLayout();
      else undoLayout();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redoLayout();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    }
  });
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

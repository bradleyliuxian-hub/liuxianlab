'use strict';

const safeArray = (value) => Array.isArray(value) ? value : [];
const parseStoredArray = (key) => {
  try { return safeArray(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch (_) { return []; }
};

/*
 * Tool Library information architecture (frontend-only).
 * Excel / Word / PDF  ->  (Excel) 通用处理 / 检查 / 模板分析  ->  tool.
 * The server contract (/api/tools, config/tools.json) is unchanged; the IA is
 * mapped here by tool slug so business config stays untouched.
 */
const FILE_TYPES = [
  { key: 'excel', label: 'Excel', title: 'Excel', blurb: 'Excel 工作流、检查与专业分析工具' },
  { key: 'image', label: '图片', title: '图片', blurb: '截图 OCR、结构化识别与图形重建工具' },
  { key: 'word', label: 'Word', title: 'Word', blurb: '文档处理、格式整理与专业工作流', comingSoon: true },
  { key: 'pdf', label: 'PDF', title: 'PDF', blurb: 'PDF 解析与文档数字化工具' }
];

const EXCEL_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'general', label: '通用处理', accent: 'blue' },
  { key: 'check', label: '检查', accent: 'amber' },
  { key: 'analysis', label: '专业分析', accent: 'teal' },
  { key: 'template', label: '模板分析', accent: 'teal' }
];

const TOOL_IA = {
  'excel-standardizer': { fileType: 'excel', group: 'general' },
  'excel-review': { fileType: 'excel', group: 'general' },
  'excel-decimal-check': { fileType: 'excel', group: 'check' },
  'excel-hardcode-check': { fileType: 'excel', group: 'check' },
  'sales-income-analysis': { fileType: 'excel', group: 'template' },
  'journal-entry-analysis': { fileType: 'excel', group: 'analysis' },
  'purchase-reconciliation': { fileType: 'excel', group: 'analysis' },
  'contract-review': { fileType: 'pdf', group: 'pdf' },
  'equity-structure': { fileType: 'image', group: 'analysis' },
  'flowchart-excel': { fileType: 'excel', group: 'analysis' }
};

const GROUP_LABEL = { general: '通用处理', check: '检查', analysis: '专业分析', template: '模板分析', pdf: 'PDF', image: '图片识别' };
const GROUP_ACCENT = { general: 'blue', check: 'amber', analysis: 'teal', template: 'teal', pdf: 'navy', image: 'teal' };
const GROUP_ORDER = { general: 0, check: 1, analysis: 2, template: 3, pdf: 0, image: 2 };

const iaOf = (tool) => TOOL_IA[tool && tool.slug] || { fileType: 'other', group: '' };

const state = {
  tools: [],
  fileType: 'excel',
  group: 'all',
  query: '',
  view: 'all',
  sidebarExcelOpen: false,
  favorites: new Set(parseStoredArray('liuxianlab-favorites')),
  recent: parseStoredArray('liuxianlab-recent')
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const body = document.body;
const toolGrid = $('#toolGrid');
const toolSearch = $('#toolSearch');
const fileTypeTabs = $('#fileTypeTabs');
const groupTabs = $('#groupTabs');
const libraryNav = $('#libraryNav');
const libraryContext = $('#libraryContext');
const libraryTitle = $('#libraryTitle');
const librarySubtitle = $('#librarySubtitle');
const resultMeta = $('#resultMeta');
const resultCount = $('#resultCount');
const wordPanel = $('#wordPanel');
const emptyState = $('#emptyState');
const clearFilters = $('#clearFilters');
const favoriteCount = $('#favoriteCount');
const railFavoriteCount = $('#railFavoriteCount');
const currentViewLabel = $('#currentViewLabel');
const toolsHeading = $('#toolsHeading');
const accountButton = $('#accountButton');
const accountMenu = $('#accountMenu');
const logoutButton = $('#logoutButton');
const themeToggle = $('#themeToggle');
const topThemeToggle = $('#topThemeToggle');
const railThemeToggle = $('#railThemeToggle');
const topAvatar = $('#topAvatar');
const navCollapseButton = $('#navCollapseButton');
const navCollapseButtonRail = $('#navCollapseButtonRail');
const sidebar = $('#sidebar');
const mobileMenuButton = $('#mobileMenuButton');
const sidebarBackdrop = $('#sidebarBackdrop');
const toast = $('#toast');

function applyTheme(theme) {
  body.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('liuxianlab-theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('liuxianlab-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (systemDark ? 'dark' : 'light'));
}

function toggleTheme() {
  applyTheme(body.classList.contains('dark') ? 'light' : 'dark');
}

function initNavigationState() {
  const collapsed = localStorage.getItem('liuxianlab-nav-collapsed') === 'true';
  body.classList.toggle('nav-collapsed', collapsed && window.innerWidth > 820);
  updateCollapseButton();
}

function updateCollapseButton() {
  const collapsed = body.classList.contains('nav-collapsed');
  const label = collapsed ? '展开侧边栏' : '折叠侧边栏';
  [navCollapseButton, navCollapseButtonRail].forEach((button) => {
    if (!button) return;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-expanded', String(!collapsed));
  });
}

function toggleNavigation() {
  if (window.innerWidth <= 820) return;
  const collapsed = !body.classList.contains('nav-collapsed');
  body.classList.toggle('nav-collapsed', collapsed);
  localStorage.setItem('liuxianlab-nav-collapsed', String(collapsed));
  updateCollapseButton();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__liuxianToast);
  window.__liuxianToast = setTimeout(() => toast.classList.remove('show'), 2200);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '晚上好';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

async function loadSession() {
  try {
    const response = await fetch('/api/session', { headers: { Accept: 'application/json' } });
    if (!response.ok) return window.location.replace('/login');
    const data = await response.json();
    const username = data?.user?.username || '成员';
    $('#sidebarUsername').textContent = username;
    $('#greetingUsername').textContent = username;
    $('#greetingText').textContent = getGreeting();
    $('#userAvatar').textContent = username.slice(0, 1).toUpperCase();
    if (topAvatar) topAvatar.textContent = username.slice(0, 1).toUpperCase();
  } catch (_error) {
    window.location.replace('/login');
  }
}

async function loadTools() {
  toolGrid.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/tools', { headers: { Accept: 'application/json' } });
    if (response.status === 401) {
      window.location.replace('/login');
      return;
    }
    if (!response.ok) throw new Error(`TOOLS_API_${response.status}`);
    const data = await response.json();
    state.tools = Array.isArray(data.tools) ? data.tools : [];
  } catch (error) {
    console.error('Tools API unavailable:', error);
    state.tools = [];
    showToast('工具目录暂时不可用。');
  } finally {
    toolGrid.removeAttribute('aria-busy');
  }

  renderFileTypeTabs();
  renderGroupTabs();
  renderLibraryNav();
  updateLibraryCopy();
  renderTools();
}

function toolsOfFileType(fileType) {
  return state.tools.filter((tool) => iaOf(tool).fileType === fileType);
}

function renderFileTypeTabs() {
  fileTypeTabs.innerHTML = '';
  FILE_TYPES.forEach((type) => {
    const count = type.comingSoon ? null : toolsOfFileType(type.key).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file-type-tab${state.fileType === type.key ? ' active' : ''}${type.comingSoon ? ' is-soon' : ''}`;
    button.dataset.fileType = type.key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(state.fileType === type.key));

    const label = document.createElement('strong');
    label.textContent = type.label;
    const meta = document.createElement('span');
    meta.className = 'file-type-meta';
    meta.textContent = type.comingSoon ? 'Coming Soon' : `${count} 个工具`;
    button.append(label, meta);

    button.addEventListener('click', () => setFileType(type.key));
    fileTypeTabs.appendChild(button);
  });
}

function renderGroupTabs() {
  const isExcel = state.fileType === 'excel';
  groupTabs.hidden = !isExcel;
  groupTabs.innerHTML = '';
  if (!isExcel) return;
  const excelTools = toolsOfFileType('excel');
  EXCEL_GROUPS.forEach((group) => {
    const count = group.key === 'all'
      ? excelTools.length
      : excelTools.filter((tool) => iaOf(tool).group === group.key).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `group-tab${state.group === group.key ? ' active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(state.group === group.key));
    button.textContent = `${group.label} ${count}`;
    button.addEventListener('click', () => setGroup(group.key));
    groupTabs.appendChild(button);
  });
}

function renderLibraryNav() {
  libraryNav.innerHTML = '';

  const excelCount = toolsOfFileType('excel').length;
  const imageCount = toolsOfFileType('image').length;
  const pdfCount = toolsOfFileType('pdf').length;

  // Excel (expandable into its groups)
  const excelGroup = document.createElement('div');
  excelGroup.className = 'library-nav-group';

  const excelRow = document.createElement('div');
  excelRow.className = `library-nav-item${state.fileType === 'excel' ? ' active' : ''}`;
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = `lib-caret${state.sidebarExcelOpen ? ' open' : ''}`;
  caret.setAttribute('aria-label', state.sidebarExcelOpen ? '收起 Excel 分类' : '展开 Excel 分类');
  caret.setAttribute('aria-expanded', String(state.sidebarExcelOpen));
  caret.textContent = '▸';
  caret.addEventListener('click', (event) => {
    event.stopPropagation();
    state.sidebarExcelOpen = !state.sidebarExcelOpen;
    renderLibraryNav();
  });
  const excelLabel = document.createElement('button');
  excelLabel.type = 'button';
  excelLabel.className = 'lib-label';
  excelLabel.textContent = 'Excel';
  excelLabel.addEventListener('click', () => selectLibrary('excel', 'all'));
  const excelBadge = document.createElement('span');
  excelBadge.className = 'nav-count';
  excelBadge.textContent = String(excelCount);
  excelRow.append(caret, excelLabel, excelBadge);
  excelGroup.appendChild(excelRow);

  const subnav = document.createElement('div');
  subnav.className = 'library-subnav';
  subnav.hidden = !state.sidebarExcelOpen;
  EXCEL_GROUPS.forEach((group) => {
    if (group.key === 'all') return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `library-subitem${state.fileType === 'excel' && state.group === group.key ? ' active' : ''}`;
    const dot = document.createElement('span');
    dot.className = `group-dot accent-${group.accent || 'blue'}`;
    const label = document.createElement('span');
    label.textContent = group.label;
    const count = document.createElement('span');
    count.className = 'nav-count';
    count.textContent = String(toolsOfFileType('excel').filter((tool) => iaOf(tool).group === group.key).length);
    item.append(dot, label, count);
    item.addEventListener('click', () => selectLibrary('excel', group.key));
    subnav.appendChild(item);
  });
  excelGroup.appendChild(subnav);
  libraryNav.appendChild(excelGroup);

  // Image
  const imageRow = document.createElement('div');
  imageRow.className = `library-nav-item${state.fileType === 'image' ? ' active' : ''}`;
  const imageLabel = document.createElement('button');
  imageLabel.type = 'button';
  imageLabel.className = 'lib-label';
  imageLabel.textContent = '图片';
  imageLabel.addEventListener('click', () => selectLibrary('image', 'all'));
  const imageBadge = document.createElement('span');
  imageBadge.className = 'nav-count';
  imageBadge.textContent = String(imageCount);
  imageRow.append(imageLabel, imageBadge);
  libraryNav.appendChild(imageRow);

  // Word (coming soon)
  const wordRow = document.createElement('div');
  wordRow.className = `library-nav-item is-soon${state.fileType === 'word' ? ' active' : ''}`;
  const wordLabel = document.createElement('button');
  wordLabel.type = 'button';
  wordLabel.className = 'lib-label';
  wordLabel.textContent = 'Word';
  wordLabel.addEventListener('click', () => selectLibrary('word', 'all'));
  const wordBadge = document.createElement('span');
  wordBadge.className = 'nav-count soon';
  wordBadge.textContent = 'Soon';
  wordRow.append(wordLabel, wordBadge);
  libraryNav.appendChild(wordRow);

  // PDF
  const pdfRow = document.createElement('div');
  pdfRow.className = `library-nav-item${state.fileType === 'pdf' ? ' active' : ''}`;
  const pdfLabel = document.createElement('button');
  pdfLabel.type = 'button';
  pdfLabel.className = 'lib-label';
  pdfLabel.textContent = 'PDF';
  pdfLabel.addEventListener('click', () => selectLibrary('pdf', 'all'));
  const pdfBadge = document.createElement('span');
  pdfBadge.className = 'nav-count';
  pdfBadge.textContent = String(pdfCount);
  pdfRow.append(pdfLabel, pdfBadge);
  libraryNav.appendChild(pdfRow);
}

function selectLibrary(fileType, group) {
  state.fileType = fileType;
  state.group = fileType === 'excel' ? (group || 'all') : 'all';
  if (fileType === 'excel' && group && group !== 'all') state.sidebarExcelOpen = true;
  if (state.view === 'favorites' || state.view === 'recent') {
    state.view = 'all-tools';
    syncViewNavigation();
    updateViewCopy();
  }
  renderFileTypeTabs();
  renderGroupTabs();
  renderLibraryNav();
  updateLibraryCopy();
  renderTools();
  closeSidebar();
}

function setFileType(fileType) {
  if (state.fileType === fileType) return;
  state.fileType = fileType;
  state.group = 'all';
  renderFileTypeTabs();
  renderGroupTabs();
  renderLibraryNav();
  updateLibraryCopy();
  renderTools();
}

function setGroup(group) {
  state.group = group;
  renderGroupTabs();
  renderLibraryNav();
  renderTools();
}

function updateLibraryCopy() {
  const type = FILE_TYPES.find((item) => item.key === state.fileType) || FILE_TYPES[0];
  if (libraryTitle) libraryTitle.textContent = type.title;
  if (librarySubtitle) librarySubtitle.textContent = type.blurb;
  const isWord = type.comingSoon === true;
  if (libraryContext) libraryContext.hidden = isWord;
}

function toolMatches(tool) {
  const ia = iaOf(tool);
  if (ia.fileType !== state.fileType) return false;
  if (state.fileType === 'excel' && state.group !== 'all' && ia.group !== state.group) return false;
  if (state.view === 'favorites' && !state.favorites.has(tool.slug)) return false;
  if (state.view === 'recent' && !state.recent.includes(tool.slug)) return false;

  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [tool.name, tool.description, GROUP_LABEL[ia.group], ia.group, ...(tool.keywords || [])].join(' ').toLowerCase();
  return haystack.includes(query);
}

function orderedTools() {
  const filtered = state.tools.filter(toolMatches);
  if (state.view === 'recent') {
    return filtered.sort((a, b) => state.recent.indexOf(a.slug) - state.recent.indexOf(b.slug));
  }
  return filtered.sort((a, b) => (GROUP_ORDER[iaOf(a).group] ?? 9) - (GROUP_ORDER[iaOf(b).group] ?? 9));
}

function renderTools() {
  const isWord = state.fileType === 'word';
  const tools = isWord ? [] : orderedTools();

  wordPanel.hidden = !isWord;
  toolGrid.hidden = isWord;

  toolGrid.innerHTML = '';
  if (resultMeta) resultMeta.hidden = isWord;
  resultCount.textContent = tools.length;
  favoriteCount.textContent = state.favorites.size;
  railFavoriteCount.textContent = state.favorites.size;
  railFavoriteCount.hidden = state.favorites.size === 0;
  emptyState.hidden = isWord || tools.length > 0;

  if (isWord) return;

  tools.forEach((tool) => {
    const fragment = $('#toolCardTemplate').content.cloneNode(true);
    const card = fragment.querySelector('.tool-card');
    const glyph = fragment.querySelector('.tool-glyph');
    const title = fragment.querySelector('h3');
    const description = fragment.querySelector('.tool-description');
    const version = fragment.querySelector('.version-badge');
    const statusBadge = fragment.querySelector('.tool-status-badge');
    const category = fragment.querySelector('.category-label');
    const favorite = fragment.querySelector('.favorite-button');
    const link = fragment.querySelector('.tool-link');

    const toolName = String(tool.name || '未命名工具');
    const toolSlug = String(tool.slug || '');
    const ia = iaOf(tool);
    const toolStatus = String(tool.status || '').toLowerCase();
    const comingSoon = ['coming-soon', 'comingsoon', 'coming_soon'].includes(toolStatus);
    glyph.textContent = tool.icon || toolName.slice(0, 2);
    title.textContent = toolName;
    description.textContent = tool.description || '';
    version.textContent = tool.version || '';
    version.hidden = !version.textContent;
    statusBadge.hidden = !comingSoon;
    statusBadge.textContent = comingSoon ? 'Coming Soon' : '';
    card.classList.toggle('is-soon', comingSoon);
    category.textContent = GROUP_LABEL[ia.group] || tool.category || '';
    category.classList.add(`accent-${GROUP_ACCENT[ia.group] || 'blue'}`);
    card.dataset.group = ia.group || '';
    link.href = toolSlug ? `/tools/${encodeURIComponent(toolSlug)}` : '#';
    link.setAttribute('aria-label', comingSoon ? `查看 ${toolName}（Coming Soon）` : `打开 ${toolName}`);

    const isFavorite = state.favorites.has(toolSlug);
    favorite.classList.toggle('active', isFavorite);
    favorite.textContent = isFavorite ? '★' : '☆';
    favorite.setAttribute('aria-label', isFavorite ? `取消收藏 ${toolName}` : `收藏 ${toolName}`);

    favorite.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!toolSlug) return;
      toggleFavorite(toolSlug, toolName);
    });

    link.addEventListener('click', (event) => {
      if (!toolSlug) {
        event.preventDefault();
        return;
      }
      rememberRecent(toolSlug);
    });

    toolGrid.appendChild(card);
  });
}

function toggleFavorite(slug, name) {
  if (state.favorites.has(slug)) {
    state.favorites.delete(slug);
    showToast(`已取消收藏：${name}`);
  } else {
    state.favorites.add(slug);
    showToast(`已收藏：${name}`);
  }
  localStorage.setItem('liuxianlab-favorites', JSON.stringify([...state.favorites]));
  renderTools();
}

function rememberRecent(slug) {
  state.recent = [slug, ...state.recent.filter((item) => item !== slug)].slice(0, 8);
  localStorage.setItem('liuxianlab-recent', JSON.stringify(state.recent));
}

const viewConfig = {
  all: ['工作台', '工具库'],
  'all-tools': ['全部工具', '工具库'],
  favorites: ['收藏', '收藏'],
  recent: ['最近使用', '最近使用']
};

function syncViewNavigation() {
  $$('[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
}

function updateViewCopy() {
  const config = viewConfig[state.view] || viewConfig.all;
  currentViewLabel.textContent = config[0];
  toolsHeading.textContent = config[1];
}

function setView(view) {
  state.view = view;
  state.group = 'all';
  state.query = '';
  toolSearch.value = '';

  syncViewNavigation();
  updateViewCopy();
  renderFileTypeTabs();
  renderGroupTabs();
  renderLibraryNav();
  updateLibraryCopy();
  renderTools();
  closeSidebar();
}

function openSidebar() {
  if (window.innerWidth > 820) return;
  sidebar.classList.add('open');
  sidebarBackdrop.hidden = false;
  body.classList.add('drawer-open');
  mobileMenuButton.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.hidden = true;
  body.classList.remove('drawer-open');
  mobileMenuButton.setAttribute('aria-expanded', 'false');
}

function focusSearch() {
  toolSearch.focus();
  toolSearch.select();
}

accountButton?.addEventListener('click', () => {
  const isOpen = !accountMenu.hidden;
  accountMenu.hidden = isOpen;
  accountButton.setAttribute('aria-expanded', String(!isOpen));
});

document.addEventListener('click', (event) => {
  if (!accountMenu.hidden && !accountMenu.contains(event.target) && !accountButton.contains(event.target)) {
    accountMenu.hidden = true;
    accountButton.setAttribute('aria-expanded', 'false');
  }
});

[themeToggle, topThemeToggle, railThemeToggle].forEach((button) => button?.addEventListener('click', toggleTheme));
navCollapseButton?.addEventListener('click', toggleNavigation);
navCollapseButtonRail?.addEventListener('click', toggleNavigation);

logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST', headers: { Accept: 'application/json' } });
  } finally {
    window.location.replace('/login');
  }
});

$$('[data-view]').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));
mobileMenuButton?.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
sidebarBackdrop?.addEventListener('click', closeSidebar);

clearFilters?.addEventListener('click', () => {
  state.group = 'all';
  state.query = '';
  toolSearch.value = '';
  renderGroupTabs();
  renderLibraryNav();
  renderTools();
});

toolSearch?.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderTools();
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusSearch();
  }
  if (event.key === 'Escape') {
    closeSidebar();
    accountMenu.hidden = true;
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 820) closeSidebar();
  if (window.innerWidth <= 820) body.classList.remove('nav-collapsed');
  else initNavigationState();
});

const yearNode = $('#year');
if (yearNode) yearNode.textContent = new Date().getFullYear();
initTheme();
initNavigationState();

(async () => {
  await loadSession();
  await loadTools();
})().catch((error) => {
  console.error('Dashboard bootstrap failed:', error);
  showToast('工作台加载失败。');
});

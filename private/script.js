'use strict';

const safeArray = (value) => Array.isArray(value) ? value : [];
const parseStoredArray = (key) => {
  try { return safeArray(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch (_) { return []; }
};

const state = {
  tools: [],
  category: '全部',
  query: '',
  view: 'all',
  favorites: new Set(parseStoredArray('liuxianlab-favorites')),
  recent: parseStoredArray('liuxianlab-recent')
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const body = document.body;
const toolGrid = $('#toolGrid');
const toolSearch = $('#toolSearch');
const categoryTabs = $('#categoryTabs');
const categoryNav = $('#categoryNav');
const resultCount = $('#resultCount');
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
const navCollapseButton = $('#navCollapseButton');
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
  navCollapseButton?.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
  navCollapseButton?.setAttribute('title', collapsed ? '展开侧边栏' : '折叠侧边栏');
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

  const categories = [...new Set(state.tools.map((tool) => tool.category).filter(Boolean))];
  renderCategories(categories);
  renderCategoryNavigation(categories);
  renderTools();
}

function renderCategories(categories) {
  categoryTabs.innerHTML = '';
  ['全部', ...categories].forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `category-tab${state.category === category ? ' active' : ''}`;
    button.textContent = category;
    button.addEventListener('click', () => setCategory(category));
    categoryTabs.appendChild(button);
  });
}

function categoryIcon(category) {
  const iconMap = {
    AI: 'AI',
    文件: '▤',
    数据: '⌗',
    开发: '</>',
    效率: '⌁'
  };
  return iconMap[category] || '•';
}

function renderCategoryNavigation(categories) {
  categoryNav.innerHTML = '';
  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `category-nav-item${state.category === category ? ' active' : ''}`;
    button.dataset.category = category;

    const icon = document.createElement('span');
    icon.className = 'mini-icon';
    icon.textContent = categoryIcon(category);

    const label = document.createElement('span');
    label.textContent = category;

    const count = document.createElement('span');
    count.className = 'nav-count';
    count.textContent = state.tools.filter((tool) => tool.category === category).length;

    button.append(icon, label, count);
    button.addEventListener('click', () => {
      state.view = 'all-tools';
      setCategory(category, { preserveView: true });
      syncViewNavigation();
      updateViewCopy();
      closeSidebar();
    });
    categoryNav.appendChild(button);
  });
}

function setCategory(category, options = {}) {
  state.category = category;
  if (!options.preserveView && state.view === 'favorites') state.view = 'all-tools';
  const categories = [...new Set(state.tools.map((tool) => tool.category).filter(Boolean))];
  renderCategories(categories);
  renderCategoryNavigation(categories);
  renderTools();
}

function toolMatches(tool) {
  if (state.category !== '全部' && tool.category !== state.category) return false;
  if (state.view === 'favorites' && !state.favorites.has(tool.slug)) return false;
  if (state.view === 'recent' && !state.recent.includes(tool.slug)) return false;

  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [tool.name, tool.description, tool.category, ...(tool.keywords || [])].join(' ').toLowerCase();
  return haystack.includes(query);
}

function orderedTools() {
  const filtered = state.tools.filter(toolMatches);
  if (state.view !== 'recent') return filtered;
  return filtered.sort((a, b) => state.recent.indexOf(a.slug) - state.recent.indexOf(b.slug));
}

function renderTools() {
  const tools = orderedTools();
  toolGrid.innerHTML = '';
  resultCount.textContent = tools.length;
  favoriteCount.textContent = state.favorites.size;
  railFavoriteCount.textContent = state.favorites.size;
  railFavoriteCount.hidden = state.favorites.size === 0;
  emptyState.hidden = tools.length > 0;

  tools.forEach((tool) => {
    const fragment = $('#toolCardTemplate').content.cloneNode(true);
    const card = fragment.querySelector('.tool-card');
    const glyph = fragment.querySelector('.tool-glyph');
    const title = fragment.querySelector('h3');
    const description = fragment.querySelector('.tool-description');
    const version = fragment.querySelector('.version-badge');
    const category = fragment.querySelector('.category-label');
    const favorite = fragment.querySelector('.favorite-button');
    const link = fragment.querySelector('.tool-link');

    const toolName = String(tool.name || '未命名工具');
    const toolSlug = String(tool.slug || '');
    glyph.textContent = tool.icon || toolName.slice(0, 2);
    title.textContent = toolName;
    description.textContent = tool.description || '';
    version.textContent = tool.version || '';
    version.hidden = !version.textContent;
    category.textContent = tool.category || '';
    link.href = toolSlug ? `/tools/${encodeURIComponent(toolSlug)}` : '#';
    link.setAttribute('aria-label', `打开 ${toolName}`);

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
  all: ['工作台', '工具'],
  'all-tools': ['全部工具', '全部工具'],
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
  state.category = '全部';
  state.query = '';
  toolSearch.value = '';

  syncViewNavigation();
  updateViewCopy();
  const categories = [...new Set(state.tools.map((tool) => tool.category).filter(Boolean))];
  renderCategories(categories);
  renderCategoryNavigation(categories);
  renderTools();
  closeSidebar();
}

function openSidebar() {
  if (window.innerWidth > 820) return;
  sidebar.classList.add('open');
  sidebarBackdrop.hidden = false;
  mobileMenuButton.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.hidden = true;
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
  state.category = '全部';
  state.query = '';
  toolSearch.value = '';
  const categories = [...new Set(state.tools.map((tool) => tool.category).filter(Boolean))];
  renderCategories(categories);
  renderCategoryNavigation(categories);
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

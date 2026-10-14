'use strict';
const body = document.body;
const savedTheme = localStorage.getItem('liuxianlab-theme');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
body.classList.toggle('dark', savedTheme === 'dark' || (!savedTheme && systemDark));

document.querySelector('#themeToggle').addEventListener('click', () => {
  body.classList.toggle('dark');
  localStorage.setItem('liuxianlab-theme', body.classList.contains('dark') ? 'dark' : 'light');
});

async function loadTool() {
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const response = await fetch('/api/tools', { headers: { Accept: 'application/json' } });
  if (response.status === 401) return location.replace('/login');
  if (!response.ok) throw new Error('工具信息加载失败');
  const data = await response.json();
  const tool = data.tools.find((item) => item.slug === slug);
  if (!tool) return location.replace('/');

  document.title = `${tool.name} · Liuxian Lab`;
  document.querySelector('#toolCategory').textContent = tool.category;
  document.querySelector('#toolIcon').textContent = tool.icon || 'TOOL';
  document.querySelector('#toolName').textContent = tool.name;
  document.querySelector('#toolDescription').textContent = tool.description;
  document.querySelector('#toolSlug').textContent = tool.slug;
}

loadTool().catch(() => {
  document.querySelector('#toolName').textContent = '工具暂时不可用';
  document.querySelector('#toolDescription').textContent = '请返回工作台后稍后重试。';
});

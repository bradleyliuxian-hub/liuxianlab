(() => {
  'use strict';

  const root = document.querySelector('.page-shell, .tool-shell');
  if (!root || document.querySelector('.lx-shell-nav')) return;

  const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

  const nav = document.createElement('aside');
  nav.className = 'lx-shell-nav';
  nav.id = 'lxToolSidebar';
  nav.setAttribute('aria-label', 'Liuxian Lab 主导航');
  nav.innerHTML = `
    <a class="lx-shell-logo" href="/" aria-label="返回 Liuxian Lab 工作台">L</a>
    <nav class="lx-shell-navlist">
      <a class="lx-shell-navitem" href="/" title="工作台" aria-label="工作台">
        ${icon('<path d="M3 11.2 12 4l9 7.2v8.3a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5z"/>')}
      </a>
      <a class="lx-shell-navitem active" href="/" title="数据工具" aria-label="数据工具">
        ${icon('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>')}
      </a>
      <a class="lx-shell-navitem" href="/" title="收藏" aria-label="收藏">
        ${icon('<path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.52l-5.3 2.79-1.01-5.9-4.29-4.18 5.93-.86z"/>')}
      </a>
      <a class="lx-shell-navitem" href="/" title="最近使用" aria-label="最近使用">
        ${icon('<path d="M12 6v6l4 2"/><path d="M4.8 5.8A9 9 0 1 1 3 12"/><path d="M3 5v5h5"/>')}
      </a>
    </nav>
    <div class="lx-shell-bottom">
      <span class="lx-shell-user" id="lxShellUser" aria-label="当前用户">L</span>
      <span class="lx-shell-online" aria-label="服务在线"></span>
    </div>
  `;

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'lx-shell-menu';
  menu.id = 'lxShellMenu';
  menu.setAttribute('aria-label', '打开导航');
  menu.setAttribute('aria-expanded', 'false');
  menu.innerHTML = icon('<path d="M4 7h16M4 12h16M4 17h16"/>');

  const backdrop = document.createElement('div');
  backdrop.className = 'lx-shell-backdrop';
  backdrop.id = 'lxShellBackdrop';

  document.body.append(nav, menu, backdrop);

  const close = () => {
    nav.classList.remove('open');
    backdrop.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    nav.classList.add('open');
    backdrop.classList.add('open');
    menu.setAttribute('aria-expanded', 'true');
  };

  menu.addEventListener('click', () => nav.classList.contains('open') ? close() : open());
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));

  // Keep the existing authenticated session contract; this is display-only.
  fetch('/api/session', { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      const username = data?.user?.username || 'L';
      const node = document.querySelector('#lxShellUser');
      if (node) node.textContent = username.slice(0, 1).toUpperCase();
    })
    .catch(() => {});

  // Improve generic tool headers without changing their existing IDs or event contracts.
  const header = root.querySelector('.tool-header');
  if (header) {
    const title = header.querySelector('.tool-brand strong');
    if (title) title.setAttribute('data-lx-tool-title', '');
  }
})();

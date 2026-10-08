const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const form = document.getElementById('loginForm');
const username = document.getElementById('username');
const password = document.getElementById('password');
const passwordToggle = document.getElementById('passwordToggle');
const statusMessage = document.getElementById('statusMessage');
const submitButton = form?.querySelector('.submit-button');

const savedTheme = localStorage.getItem('liuxianlab-theme');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (savedTheme === 'dark' || (!savedTheme && systemDark)) body.classList.add('dark');

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', body.classList.contains('dark') ? '#10120f' : '#f5f4ef');
}
syncThemeColor();

themeToggle?.addEventListener('click', () => {
  body.classList.toggle('dark');
  localStorage.setItem('liuxianlab-theme', body.classList.contains('dark') ? 'dark' : 'light');
  syncThemeColor();
});

passwordToggle?.addEventListener('click', () => {
  const isVisible = password.type === 'text';
  password.type = isVisible ? 'password' : 'text';
  passwordToggle.classList.toggle('is-visible', !isVisible);
  passwordToggle.setAttribute('aria-label', isVisible ? '显示密码' : '隐藏密码');
  password.focus({ preventScroll: true });
});

function setFieldError(input, message) {
  const field = input.closest('.field');
  const error = field?.querySelector('.field-error');
  field?.classList.toggle('invalid', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (error) error.textContent = message;
}

function setStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.hidden = !message;
}

function clearStatus() {
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';
  statusMessage.hidden = true;
}

function setSubmitting(isSubmitting) {
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.classList.toggle('is-loading', isSubmitting);
  const text = submitButton.querySelector('span');
  if (text) text.textContent = isSubmitting ? '正在验证…' : '登录工作台';
}

[username, password].forEach((input) => {
  input?.addEventListener('input', () => {
    setFieldError(input, '');
    clearStatus();
  });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearStatus();
  setFieldError(username, '');
  setFieldError(password, '');

  const user = username.value.trim();
  const pass = password.value;
  const rememberMe = document.getElementById('rememberMe')?.checked ?? false;
  let valid = true;

  if (!user) {
    setFieldError(username, '请输入账号');
    valid = false;
  }
  if (!pass) {
    setFieldError(password, '请输入密码');
    valid = false;
  }
  if (!valid) return;

  setSubmitting(true);

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: user, password: pass, rememberMe })
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { ok: false, message: '登录服务器返回了异常响应，请确认你正在使用 Node.js 服务。' };

    if (!response.ok || !data.ok) {
      if (response.status === 401 || data.code === 'INVALID_CREDENTIALS') {
        setFieldError(password, '账号或密码错误，请重新输入');
        setStatus('登录失败：账号或密码错误，请重新输入。', 'error');
        password.focus({ preventScroll: true });
        password.select();
        return;
      }

      if (response.status === 429 || data.code === 'TOO_MANY_ATTEMPTS') {
        setStatus(data.message || '登录尝试过多，请稍后再试。', 'error');
        return;
      }

      setStatus(data.message || '登录失败，请检查账号密码后重试。', 'error');
      return;
    }

    setStatus('验证成功，正在进入工作台…', 'success');
    window.location.replace(data.redirect || '/');
  } catch (_error) {
    setStatus('无法连接登录服务器。请确认 npm run dev 正在运行，并且不要使用 python3 -m http.server。', 'error');
  } finally {
    setSubmitting(false);
  }
});

clearStatus();

const year = new Date().getFullYear();
['brandYear', 'mobileYear'].forEach((id) => {
  const node = document.getElementById(id);
  if (node) node.textContent = year;
});

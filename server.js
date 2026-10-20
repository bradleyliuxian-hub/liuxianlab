'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const FileStoreFactory = require('session-file-store');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { createExcelRouter } = require('./server/excel-standardizer/routes');
const { createSalesIncomeRouter } = require('./server/sales-income/routes');
const { createSalesIncomeInspectRouter } = require('./server/sales-income/inspect-routes');
const { createSalesIncomeRunRouter } = require('./server/sales-income/run-routes');
const { createContractRouter } = require('./server/contracts/routes');
const { createExcelReviewRouter } = require('./server/excel-review/routes');
const { createExcelReviewControlLogRouter } = require('./server/excel-review/control-log-routes');
const { createJournalEntryRouter } = require('./server/journal-entry/routes');
const { createPurchaseReconciliationRouter } = require('./server/purchase-reconciliation/routes');
const { createEquityRouter } = require('./server/equity-structure/routes');
require('dotenv').config();

const app = express();
const FileStore = FileStoreFactory(session);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRIVATE_DIR = path.join(ROOT, 'private');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_DIR = path.join(ROOT, 'sessions');
const TOOLS_FILE = path.join(ROOT, 'config', 'tools.json');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '[]\n', { mode: 0o600 });
}

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IS_PRODUCTION) {
    console.error('ERROR: SESSION_SECRET is required in production.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('WARN: SESSION_SECRET is not set. A temporary development secret was generated; sessions will reset after restart.');
}

if (IS_PRODUCTION) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
/*
 * Default JSON requests stay deliberately small.
 *
 * Contract Markdown drafts are different:
 * they may contain tens or hundreds of KB of text.
 *
 * Skip the global 16 KB parser only for the
 * authenticated contract draft PUT route.
 * server/contracts/routes.js applies its own
 * 5 MB JSON parser to that endpoint.
 */
const defaultJsonParser =
  express.json({
    limit: '16kb'
  });


app.use(
  (req, res, next) => {

    const isContractDraftSave =
      (
        req.method === 'PUT'
        &&
        /^\/api\/contracts\/[0-9a-f-]{36}\/draft\/?$/i
          .test(
            req.path
          )
      );

    const isEquityResultSave =
      (
        req.method === 'PUT'
        &&
        /^\/api\/equity-structures\/[0-9a-f-]{36}\/(result|layout)\/?$/i
          .test(req.path)
      );

    const isEquityPngExport =
      req.method === 'POST'
      && req.path === '/api/equity-structures/export/png';


    if (
      isContractDraftSave
      || isEquityResultSave
      || isEquityPngExport
    ) {

      return next();

    }


    return defaultJsonParser(
      req,
      res,
      next
    );

  }
);


app.use(
  express.urlencoded({
    extended: false,
    limit: '16kb'
  })
);

app.use(session({
  name: 'liuxianlab.sid',
  secret: sessionSecret,
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: SESSION_DAYS * 24 * 60 * 60,
    retries: 0,
    logFn: () => {}
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: SESSION_MAX_AGE
  }
}));

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    console.error('Failed to read users.json:', error.message);
    return [];
  }
}

function readTools() {
  try {
    const raw = fs.readFileSync(TOOLS_FILE, 'utf8');
    const tools = JSON.parse(raw);
    return Array.isArray(tools) ? tools : [];
  } catch (error) {
    console.error('Failed to read tools.json:', error.message);
    return [];
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function safeToolSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : '';
}

function requireAuth(req, res, next) {
  if (req.session?.auth?.username) return next();
  const wantsJson = req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
  if (wantsJson) return res.status(401).json({ ok: false, message: '请先登录。' });
  return res.redirect('/login');
}

function sameOriginForStateChange(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === req.get('host')) return next();
  } catch (_) {}
  return res.status(403).json({ ok: false, message: '请求来源无效。' });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, code: 'TOO_MANY_ATTEMPTS', message: '登录尝试过多，请在 15 分钟后再试。' }
});

const DUMMY_HASH = bcrypt.hashSync('liuxianlab-dummy-password', 12);

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

app.get('/login', (req, res) => {
  if (req.session?.auth?.username) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/login.html', (_req, res) => res.redirect('/login'));
app.get('/login.css', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.css'));
});
app.get('/login.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.js'));
});

/*
 * Public design tokens: a static, non-authenticated asset shared by the public
 * login page and the authenticated app (single brand colour source). Contains
 * only CSS variables — no business data and no auth logic.
 */
app.get('/design-tokens.css', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'design-tokens.css'));
});

app.post('/api/login', sameOriginForStateChange, loginLimiter, async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const rememberMe = Boolean(req.body.rememberMe);

  if (!username || !password || username.length > 64 || password.length > 256) {
    return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: '请输入有效的账号和密码。' });
  }

  const users = readUsers();
  const user = users.find((item) => normalizeUsername(item.username) === username);
  const hash = user?.passwordHash || DUMMY_HASH;
  const passwordOk = await bcrypt.compare(password, hash);
  const allowed = Boolean(user && !user.disabled && passwordOk);

  if (!allowed) {
    return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: '账号或密码错误，请重新输入。' });
  }

  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ ok: false, message: '登录失败，请稍后重试。' });
    req.session.auth = { username: user.username, loginAt: new Date().toISOString() };
    if (rememberMe) {
      req.session.cookie.maxAge = SESSION_MAX_AGE;
    } else {
      req.session.cookie.expires = null;
      req.session.cookie.maxAge = null;
    }
    req.session.save((saveError) => {
      if (saveError) return res.status(500).json({ ok: false, message: '登录失败，请稍后重试。' });
      return res.json({ ok: true, redirect: '/' });
    });
  });
});

app.get('/api/tools', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const tools = readTools().map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    status: tool.status,
    version: tool.version,
    icon: tool.icon,
    keywords: Array.isArray(tool.keywords) ? tool.keywords : []
  }));
  res.json({ ok: true, tools });
});

app.get('/api/session', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, user: { username: req.session.auth.username } });
});

app.post('/api/logout', sameOriginForStateChange, requireAuth, (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ ok: false, message: '退出失败，请重试。' });
    res.clearCookie('liuxianlab.sid', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
    return res.json({ ok: true });
  });
});

app.use('/api/excel', createExcelRouter({ root: ROOT, requireAuth, sameOriginForStateChange }));
app.use('/api/sales-income', requireAuth, sameOriginForStateChange, createSalesIncomeInspectRouter({ projectRoot: ROOT }));
app.use('/api/sales-income', requireAuth, sameOriginForStateChange, createSalesIncomeRunRouter({ projectRoot: ROOT }));

/*
 * Contract review workspace.
 *
 * Authenticated page for comparing the
 * original contract with the Markdown draft.
 */

/*
 * PDFJS_STATIC_ROUTE
 *
 * Browser-side PDF renderer used by the
 * contract review workspace.
 */
app.use(
  "/vendor/pdfjs",
  express.static(
    `${ROOT}/node_modules/pdfjs-dist/build`,
    {
      fallthrough: false,
      maxAge: "1d"
    }
  )
);


app.get(
  "/tools/contract-review/review",
  requireAuth,
  (req, res) => {

    return res.sendFile(
      `${ROOT}/private/tools/contract-review/review.html`
    );

  }
);


app.use('/api/contracts', requireAuth, sameOriginForStateChange, createContractRouter({ root: ROOT }));
app.use('/api/sales-income', requireAuth, sameOriginForStateChange, createSalesIncomeRouter({ projectRoot: ROOT }));

/*
 * Excel Review Assistant.
 *
 * Authenticated page at /tools/excel-review (auto-detected from
 * private/tools/excel-review/index.html) backed by an owner-scoped
 * API. Files stay private under storage/excel-reviews/<id>/.
 */
app.use('/api/excel-reviews', requireAuth, sameOriginForStateChange, createExcelReviewRouter({ root: ROOT }));

/*
 * 序时账分析：上传 -> 字段映射 -> 异步分析 -> 结果 / Excel 导出。
 * 文件与结果保存在 storage/journal-entry/<uuid>/，接口按 owner 隔离。
 */
app.use('/api/journal-entry-analyses', requireAuth, sameOriginForStateChange, createJournalEntryRouter({ root: ROOT, requireAuth, sameOriginForStateChange }));

/*
 * 采购与退货对抵：SAP 正负数据按业务键 + FIFO 对抵，Dashboard + 分页结果 + 下载。
 * 源文件、结果与导出保存在 storage/purchase-reconciliation/<uuid>/，按 owner 隔离。
 */
app.use('/api/purchase-reconciliations', requireAuth, sameOriginForStateChange, createPurchaseReconciliationRouter({ root: ROOT }));

/*
 * 股权结构图识别：上传大图 -> 后台 PaddleOCR/OpenCV 识别 -> 人工复核 -> SVG/PNG/Excel/PDF。
 * 原图与结果保存在 storage/equity-structure/<uuid>/，按 owner 隔离。
 */
app.use('/api/equity-structures', requireAuth, sameOriginForStateChange, createEquityRouter({ root: ROOT }));

/*
 * Excel Review Control Log (V1.4): aggregates several excel-review jobs into
 * one multi-file snapshot. Same auth + owner scope; private download only.
 */
app.use('/api/excel-review-control-logs', requireAuth, sameOriginForStateChange, createExcelReviewControlLogRouter({ root: ROOT }));

app.use('/app', requireAuth, express.static(PRIVATE_DIR, {
  index: false,
  dotfiles: 'deny',
  etag: true,
  maxAge: IS_PRODUCTION ? '1h' : 0
}));

app.get('/', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PRIVATE_DIR, 'index.html'));
});

app.get('/tools/:slug', requireAuth, (req, res) => {
  const slug = safeToolSlug(req.params.slug);
  if (!slug) return res.status(404).send('404 Not Found');
  const tool = readTools().find((item) => item.slug === slug);
  if (!tool) return res.status(404).send('404 Not Found');

  const implementedPage = path.join(PRIVATE_DIR, 'tools', slug, 'index.html');
  res.set('Cache-Control', 'no-store');
  if (fs.existsSync(implementedPage)) return res.sendFile(implementedPage);
  return res.sendFile(path.join(PRIVATE_DIR, 'tool.html'));
});

app.get('/index.html', requireAuth, (_req, res) => res.redirect('/'));

app.use((_req, res) => res.status(404).send('404 Not Found'));

app.use((error, req, res, _next) => {

  console.error(error);


  if (
    res.headersSent
  ) {

    return;

  }


  const wantsJson =
    req.path.startsWith(
      '/api/'
    );


  if (
    error?.status === 413
    ||
    error?.type ===
      'entity.too.large'
  ) {

    if (
      wantsJson
    ) {

      return res
        .status(413)
        .json({

          ok: false,

          error:
            '请求内容过大'

        });

    }


    return res
      .status(413)
      .send(
        '413 Payload Too Large'
      );

  }


  if (
    error?.status === 400
    &&
    error instanceof SyntaxError
  ) {

    if (
      wantsJson
    ) {

      return res
        .status(400)
        .json({

          ok: false,

          error:
            '请求 JSON 格式无效'

        });

    }


    return res
      .status(400)
      .send(
        '400 Bad Request'
      );

  }


  if (
    wantsJson
  ) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          '服务器处理请求失败'

      });

  }


  return res
    .status(500)
    .send(
      '500 Internal Server Error'
    );

});

app.listen(PORT, HOST, () => {
  console.log(`Liuxian Lab running at http://${HOST}:${PORT}`);
  console.log(`Login: http://${HOST}:${PORT}/login`);
  console.log(`Excel: http://${HOST}:${PORT}/tools/excel-standardizer`);
});

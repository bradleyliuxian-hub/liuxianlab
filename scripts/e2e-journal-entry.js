#!/usr/bin/env node
'use strict';

/*
 * Journal Entry browser E2E.
 *
 * This starts an isolated local test server (real Express session login, real
 * Journal Entry API/router, real Python worker) with an in-memory job
 * repository and temporary storage. It never connects to PostgreSQL and never
 * uses production credentials or customer data.
 *
 * Browser: system Chrome through puppeteer-core (no bundled browser).
 *
 * Run: npm run e2e:journal-entry
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRIVATE_DIR = path.join(ROOT, 'private');
const FIXTURES = path.join(ROOT, 'services', 'journal_entry', 'tests', 'fixtures');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'je-e2e-'));
const DOWNLOAD_DIR = path.join(TEMP_ROOT, 'downloads');
const STORAGE_ROOT = path.join(TEMP_ROOT, 'storage', 'journal-entry');

process.env.JOURNAL_ENTRY_PYTHON_BIN = process.env.JOURNAL_ENTRY_PYTHON_BIN
  || path.join(ROOT, '.venv', 'bin', 'python');
process.env.PYTHONPATH = [ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
process.env.JOURNAL_ENTRY_MAX_CONCURRENT = '1';

const SHOT_DIR = process.env.JE_E2E_SCREENSHOTS
  ? path.resolve(process.env.JE_E2E_SCREENSHOTS)
  : null;

const realBatchRepository = require(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));

const TEST_USER = 'e2e-user';
const TEST_PASSWORD = `pw-${crypto.randomBytes(12).toString('hex')}`;
const TOOL_PATH = '/app/tools/journal-entry-analysis/index.html';

function log(message) { process.stdout.write(`${message}\n`); }

async function shot(page, name, { fullPage = false } = {}) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage });
}

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chrome/Chromium not found; set CHROME_BIN');
  }
  return found;
}

function json(res, status, payload) {
  res.status(status).json(payload);
}

function installRepositoryStub() {
  const jobs = new Map();
  const batches = new Map();
  const batchOutputs = new Map();
  const splitOutputs = new Map();
  const splitPresets = new Map();
  let batchItems = [];

  function summarizeBatch(batchId) {
    const batch = batches.get(batchId);
    if (!batch) return null;
    const items = batchItems
      .filter((item) => item.batchId === batchId)
      .sort((a, b) => a.position - b.position);
    const childJobs = items.map((item) => jobs.get(item.jobId)).filter(Boolean);
    const count = (status) => childJobs.filter((job) => job.status === status).length;
    const counts = {
      totalCount: childJobs.length,
      draftCount: count('draft'),
      queuedCount: count('queued'),
      runningCount: count('running'),
      completedCount: count('completed'),
      failedCount: count('failed')
    };
    const progress = childJobs.length
      ? Math.round(childJobs.reduce((sum, job) => sum + Number(job.progress || 0), 0) / childJobs.length)
      : 0;
    return {
      id: batch.id,
      ownerUsername: batch.ownerUsername,
      name: batch.name,
      status: realBatchRepository.deriveBatchStatus(counts),
      progress,
      ...counts,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt
    };
  }

  const repository = {
    async createJob(job) {
      const now = new Date().toISOString();
      const row = {
        ...job,
        progress: job.progress || 0,
        progressMessage: job.progressMessage || '已上传，等待映射确认。',
        createdAt: now,
        updatedAt: now
      };
      jobs.set(job.id, row);
      return row;
    },
    async getJobForOwner(id, owner) {
      const job = jobs.get(id);
      return job && job.ownerUsername === owner ? job : null;
    },
    async listJobsForOwner(owner) {
      return [...jobs.values()].filter((job) => job.ownerUsername === owner);
    },
    async listJobsByStatus() { return []; },
    async listExpiredJobs() { return []; },
    async claimJob(id, { message } = {}) {
      const job = jobs.get(id);
      if (!job || job.status !== 'queued') return null;
      const next = { ...job, status: 'running', progress: 0, progressMessage: message || 'running' };
      jobs.set(id, next);
      return next;
    },
    async updateJobState(id, patch) {
      const job = jobs.get(id);
      if (!job) return null;
      const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
      jobs.set(id, next);
      return next;
    },
    async deleteJobForOwner(id, owner) {
      const job = jobs.get(id);
      if (!job || job.ownerUsername !== owner) return false;
      return jobs.delete(id);
    },
    async deleteJobById(id) { return jobs.delete(id); }
  };

  require.cache[require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'))] = {
    id: 'je-e2e-repository-stub',
    filename: 'je-e2e-repository-stub',
    loaded: true,
    exports: repository
  };

  const batchRepositoryPath = require.resolve(
    path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js')
  );
  require.cache[batchRepositoryPath] = {
    id: 'je-e2e-batch-repository-stub',
    filename: 'je-e2e-batch-repository-stub',
    loaded: true,
    exports: {
      ...realBatchRepository,
      async createBatch({ id, ownerUsername, name }) {
        const now = new Date().toISOString();
        const row = { id, ownerUsername, name, createdAt: now, updatedAt: now };
        batches.set(id, row);
        return row;
      },
      async addItem({ batchId, jobId, position, originalFilename, fileSize }) {
        batchItems.push({ batchId, jobId, position, originalFilename, fileSize });
      },
      async getBatchSummaryForOwner(batchId, owner) {
        if (batches.get(batchId)?.deletedAt) return null;
        const summary = summarizeBatch(batchId);
        return summary && summary.ownerUsername === owner ? summary : null;
      },
      async listBatchesForOwner(owner) {
        return [...batches.keys()]
          .map(summarizeBatch)
          .filter((batch) => batch && batch.ownerUsername === owner && !batches.get(batch.id)?.deletedAt);
      },
      async getBatchDetailForOwner(batchId, owner) {
        if (batches.get(batchId)?.deletedAt) return null;
        const summary = summarizeBatch(batchId);
        if (!summary || summary.ownerUsername !== owner) return null;
        return {
          ...summary,
          items: batchItems
            .filter((item) => item.batchId === batchId)
            .sort((a, b) => a.position - b.position)
            .map((item) => ({
              position: item.position,
              originalFilename: item.originalFilename,
              fileSize: item.fileSize || 0,
              job: jobs.get(item.jobId)
            }))
        };
      },
      async touchBatch(batchId) {
        const batch = batches.get(batchId);
        if (batch) batch.updatedAt = new Date().toISOString();
      },
      async softDeleteBatch(batchId) {
        const batch = batches.get(batchId);
        if (batch) batch.deletedAt = new Date().toISOString();
        return Boolean(batch);
      },
      async deleteItemsForBatch(batchId) {
        batchItems = batchItems.filter((item) => item.batchId !== batchId);
      },
      async deleteItemsForJob(jobId) {
        batchItems = batchItems.filter((item) => item.jobId !== jobId);
      },
      async listEmptyBatches() { return []; },
      async listDeletedBatches() { return []; },
      async listAllBatchIds() { return [...batches.keys()]; },
      async deleteBatch(batchId) {
        batchItems = batchItems.filter((item) => item.batchId !== batchId);
        return batches.delete(batchId);
      }
    }
  };

  const outputRepositoryPath = require.resolve(
    path.join(ROOT, 'server', 'journal-entry', 'batch-output-repository.js')
  );
  require.cache[outputRepositoryPath] = {
    id: 'je-e2e-batch-output-repository-stub',
    filename: 'je-e2e-batch-output-repository-stub',
    loaded: true,
    exports: {
      async createOutput({ id, batchId, ownerUsername, snapshot }) {
        const row = {
          id, batchId, ownerUsername, status: 'generating', snapshot,
          summaryPath: null, mergedPath: null, zipPath: null, error: null,
          createdAt: new Date().toISOString(), completedAt: null
        };
        batchOutputs.set(id, row);
        return row;
      },
      async markCompleted(id, { summaryPath, mergedPath, zipPath, snapshot }) {
        const row = batchOutputs.get(id);
        Object.assign(row, {
          status: 'completed', summaryPath, mergedPath, zipPath,
          snapshot: snapshot || row.snapshot, error: null,
          completedAt: new Date().toISOString()
        });
        return row;
      },
      async markFailed(id, error) {
        const row = batchOutputs.get(id);
        Object.assign(row, {
          status: 'failed', error: String(error), completedAt: new Date().toISOString()
        });
        return row;
      },
      async expireOutput(id) {
        const row = batchOutputs.get(id);
        if (!row) return null;
        Object.assign(row, {
          expiredAt: new Date().toISOString(),
          summaryPath: null, mergedPath: null, zipPath: null
        });
        return row;
      },
      async listForBatch(batchId) {
        return [...batchOutputs.values()].filter((row) => row.batchId === batchId);
      },
      async listAllOutputIds() {
        return [...batchOutputs.values()].map((row) => ({ id: row.id, batchId: row.batchId }));
      },
      async getLatestForOwner(batchId, owner) {
        return [...batchOutputs.values()]
          .filter((row) => row.batchId === batchId && row.ownerUsername === owner)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      },
      async getForOwner(id, batchId, owner) {
        const row = batchOutputs.get(id);
        return row && row.batchId === batchId && row.ownerUsername === owner ? row : null;
      }
    }
  };

  const splitRepositoryPath = require.resolve(
    path.join(ROOT, 'server', 'journal-entry', 'split-repository.js')
  );
  require.cache[splitRepositoryPath] = {
    id: 'je-e2e-split-repository-stub',
    filename: 'je-e2e-split-repository-stub',
    loaded: true,
    exports: {
      async createOutput({ id, ownerUsername, scopeType, scopeId, request, snapshot, outputMode }) {
        const row = {
          id, ownerUsername, scopeType, scopeId, status: 'generating',
          request, snapshot, outputMode, filePath: null, error: null,
          createdAt: new Date().toISOString(), completedAt: null
        };
        splitOutputs.set(id, row);
        return row;
      },
      async markCompleted(id, { filePath, snapshot }) {
        const row = splitOutputs.get(id);
        Object.assign(row, {
          status: 'completed', filePath, snapshot: snapshot || row.snapshot,
          error: null, completedAt: new Date().toISOString()
        });
        return row;
      },
      async markFailed(id, error) {
        const row = splitOutputs.get(id);
        Object.assign(row, {
          status: 'failed', error: String(error), completedAt: new Date().toISOString()
        });
        return row;
      },
      async expireOutput(id) {
        const row = splitOutputs.get(id);
        if (!row) return null;
        Object.assign(row, { expiredAt: new Date().toISOString(), filePath: null });
        return row;
      },
      async listByScope(scopeType, scopeId) {
        return [...splitOutputs.values()]
          .filter((row) => row.scopeType === scopeType && row.scopeId === scopeId);
      },
      async listAllOutputIds() {
        return [...splitOutputs.keys()];
      },
      async getLatestForScope(owner, scopeType, scopeId) {
        return [...splitOutputs.values()]
          .filter((row) => row.ownerUsername === owner
            && row.scopeType === scopeType && row.scopeId === scopeId)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      },
      async getForOwner(id, owner) {
        const row = splitOutputs.get(id);
        return row && row.ownerUsername === owner ? row : null;
      }
    }
  };

  const presetRepositoryPath = require.resolve(
    path.join(ROOT, 'server', 'journal-entry', 'split-preset-repository.js')
  );
  require.cache[presetRepositoryPath] = {
    id: 'je-e2e-split-preset-repository-stub',
    filename: 'je-e2e-split-preset-repository-stub',
    loaded: true,
    exports: {
      async createPreset({ id, ownerUsername, name, spec }) {
        const now = new Date().toISOString();
        const row = { id, ownerUsername, name, spec, createdAt: now, updatedAt: now };
        splitPresets.set(id, row);
        return row;
      },
      async listPresets(owner) {
        return [...splitPresets.values()].filter((row) => row.ownerUsername === owner);
      },
      async getPreset(id, owner) {
        const row = splitPresets.get(id);
        return row && row.ownerUsername === owner ? row : null;
      },
      async updatePreset(id, owner, { name, spec }) {
        const row = splitPresets.get(id);
        if (!row || row.ownerUsername !== owner) return null;
        if (name) row.name = name;
        if (spec) row.spec = spec;
        row.updatedAt = new Date().toISOString();
        return row;
      },
      async deletePreset(id, owner) {
        const row = splitPresets.get(id);
        if (!row || row.ownerUsername !== owner) return false;
        return splitPresets.delete(id);
      }
    }
  };
}

function installAuth(app, session) {
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 4);
  let loginCount = 0;

  const requireAuth = (req, res, next) => {
    if (req.session?.auth?.username) return next();
    const wantsJson = req.path.startsWith('/api/')
      || req.accepts(['html', 'json']) === 'json';
    if (wantsJson) return json(res, 401, { ok: false, message: '请先登录。' });
    return res.redirect('/login');
  };

  const sameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch (_) {}
    return json(res, 403, { ok: false, message: '请求来源无效。' });
  };

  app.get('/login', (req, res) => {
    if (req.session?.auth?.username) return res.redirect('/');
    res.set('Cache-Control', 'no-store');
    return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  app.post('/api/login', sameOrigin, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const passwordOk = await bcrypt.compare(password, passwordHash);
    if (username !== TEST_USER || !passwordOk) {
      return json(res, 401, { ok: false, code: 'INVALID_CREDENTIALS', message: '账号或密码错误。' });
    }
    loginCount += 1;
    req.session.regenerate((error) => {
      if (error) return json(res, 500, { ok: false, message: '登录失败。' });
      req.session.auth = { username: TEST_USER, loginAt: new Date().toISOString() };
      req.session.save((saveError) => {
        if (saveError) return json(res, 500, { ok: false, message: '登录失败。' });
        return json(res, 200, { ok: true, redirect: '/' });
      });
    });
  });

  app.get('/api/session', requireAuth, (req, res) => {
    res.json({ ok: true, user: { username: req.session.auth.username } });
  });

  app.post('/api/logout', sameOrigin, requireAuth, (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/', requireAuth, (_req, res) => res.redirect(TOOL_PATH));
  app.use('/app', requireAuth, require('express').static(PRIVATE_DIR, {
    index: false,
    dotfiles: 'deny'
  }));

  return {
    requireAuth,
    sameOrigin,
    credentials: { username: TEST_USER, password: TEST_PASSWORD },
    loginCount: () => loginCount
  };
}

async function startServer() {
  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const session = require(path.join(ROOT, 'node_modules', 'express-session'));
  installRepositoryStub();
  const { createJournalEntryRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'routes.js'));
  const { createJournalEntryBatchRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'batch-routes.js'));
  const { createSplitRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'split-routes.js'));
  const { createPresetRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'split-preset-routes.js'));
  const { createJournalEntryRuntime } = require(path.join(ROOT, 'server', 'journal-entry', 'runtime.js'));
  const journalEntryRuntime = createJournalEntryRuntime({
    root: TEMP_ROOT,
    repository: require(path.join(ROOT, 'server', 'journal-entry', 'repository.js'))
  });

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(TEMP_ROOT, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'liuxianlab.sid',
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false }
  }));
  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const auth = installAuth(app, session);
  app.use('/api/journal-entry-analyses', auth.requireAuth, auth.sameOrigin,
    createJournalEntryRouter({
      root: TEMP_ROOT,
      requireAuth: auth.requireAuth,
      sameOriginForStateChange: auth.sameOrigin,
      runtime: journalEntryRuntime
    }));
  app.use('/api/journal-entry-batches', auth.requireAuth, auth.sameOrigin,
    createJournalEntryBatchRouter({
      root: TEMP_ROOT,
      requireAuth: auth.requireAuth,
      runtime: journalEntryRuntime
    }));
  app.use('/api/journal-entry-splits', auth.requireAuth, auth.sameOrigin,
    createSplitRouter({
      root: TEMP_ROOT,
      requireAuth: auth.requireAuth
    }));
  app.use('/api/journal-entry-split-presets', auth.requireAuth, auth.sameOrigin,
    createPresetRouter({ requireAuth: auth.requireAuth }));

  app.use((error, _req, res, _next) => {
    console.error('[e2e server]', error);
    if (res.headersSent) return;
    res.status(500).json({ error: 'test server error' });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    auth
  };
}

function attachDiagnostics(page) {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], serverErrors: [], statuses: [], fullResultRequests: [], http404: [] };

  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error.message || error)));
  page.on('error', (error) => {
    diagnostics.pageErrors.push(`page crash: ${error?.message || error}`);
    console.error('[e2e page crash]', error?.message || error);
  });
  page.on('request', (request) => {
    try {
      const pathname = new URL(request.url()).pathname;
      if (/\/api\/journal-entry-analyses\/[0-9a-f-]{36}\/result$/i.test(pathname)) {
        diagnostics.fullResultRequests.push(pathname);
      }
    } catch (_) {}
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.endsWith('/favicon.ico')) return;
    diagnostics.failedRequests.push(`${url} :: ${request.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() === 404 && /\.(html|js|css)$/i.test(new URL(url).pathname)) {
      diagnostics.http404.push(url);
    }
    if (url.includes('/api/') && response.status() >= 500) {
      diagnostics.serverErrors.push(`${response.status()} ${url}`);
    }
    if (url.includes('/api/journal-entry-analyses/') && /\/[0-9a-f-]{36}$/i.test(url)) {
      diagnostics.statuses.push(response.status());
    }
  });
  return diagnostics;
}

async function waitVisible(page, selector, timeout = 30000) {
  await page.waitForSelector(`${selector}:not([hidden])`, { visible: true, timeout });
}

async function waitEnabled(page, selector, timeout = 30000) {
  await page.waitForFunction((sel) => {
    const node = document.querySelector(sel);
    return node && !node.disabled;
  }, { timeout }, selector);
}

async function uploadFixture(page, filename, { timeout = 30000 } = {}) {
  await page.click('#newJobButton');
  await waitVisible(page, '#uploadPanel');
  const input = await page.$('#fileInput');
  assert.ok(input, 'file input missing');
  const source = path.isAbsolute(filename) && fs.existsSync(filename)
    ? filename
    : path.join(FIXTURES, filename);
  await input.uploadFile(source);
  await waitEnabled(page, '#uploadButton');
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/journal-entry-analyses')
      && response.request().method() === 'POST',
    { timeout }
  );
  await page.click('#uploadButton');
  const response = await responsePromise;
  assert.equal(response.status(), 201, `upload ${filename}`);
  await waitVisible(page, '#mappingPanel');
}

async function redetect(page, { timeout = 30000 } = {}) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/inspect') && response.request().method() === 'POST',
    { timeout }
  );
  await page.click('#redetectButton');
  const response = await responsePromise;
  assert.equal(response.status(), 200, 'inspect');
  await waitEnabled(page, '#redetectButton');
}

async function configureMapping(page, layout, mapping, { positiveSide } = {}) {
  await page.select('#amountLayoutSelect', layout);
  if (positiveSide !== undefined) {
    await page.select('#positiveSideSelect', positiveSide);
  } else if (layout !== 'signed_amount') {
    assert.equal(await page.$eval('#positiveSideControl', (node) => node.hidden), true);
  }
  await page.evaluate((values) => {
    const grid = document.querySelector('#mappingGrid');
    for (const [field, index] of Object.entries(values)) {
      const select = grid.querySelector(`select[data-field="${field}"]`);
      if (!select) throw new Error(`mapping field missing: ${field}`);
      select.value = String(index);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, mapping);
}

async function preview(page, { expectStatus = 200, timeout = 30000 } = {}) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/preview') && response.request().method() === 'POST',
    { timeout }
  );
  await page.click('#previewButton');
  const response = await responsePromise;
  assert.equal(response.status(), expectStatus, 'preview status');
  return response;
}

async function startAndWaitForResult(page, { timeout = 120000 } = {}) {
  await page.evaluate(() => {
    window.__jeStatuses = [];
    window.__jeStatusTimes = [];
    const node = document.querySelector('#jobStatus');
    const record = () => {
      const text = String(node?.textContent || '').trim();
      if (text && window.__jeStatuses[window.__jeStatuses.length - 1] !== text) {
        window.__jeStatuses.push(text);
        window.__jeStatusTimes.push({ text, at: performance.now() });
      }
    };
    if (node) {
      new MutationObserver(record).observe(node, { childList: true, subtree: true, characterData: true });
    }
  });
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/start') && response.request().method() === 'POST',
    { timeout }
  );
  await page.click('#startButton');
  const response = await responsePromise;
  assert.equal(response.status(), 202, 'start');
  await waitVisible(page, '#processPanel');
  await page.waitForFunction(() => {
    const result = document.querySelector('#resultPanel');
    const error = document.querySelector('#processError');
    return (result && !result.hidden) || (error && !error.hidden);
  }, { timeout });
  const processError = await page.$eval('#processError', (node) => node.hidden ? '' : node.textContent);
  if (processError) throw new Error(`analysis failed: ${processError}`);
  await waitVisible(page, '#resultPanel');
  await page.waitForSelector('#resultMetrics .metric', { timeout: 30000 });
  const statuses = await page.evaluate(() => window.__jeStatuses);
  assert.ok(statuses.includes('已完成'), `UI did not reach completed: ${statuses.join(' -> ')}`);
  return statuses;
}

async function openFirstVoucher(page) {
  await page.click('.result-tab[data-tab="vouchers"]');
  await page.waitForSelector('#resultTableWrap tbody tr');
  await page.evaluate(() => {
    const row = document.querySelector('#resultTableWrap tbody tr.clickable');
    if (!row) throw new Error('no clickable voucher row');
    row.click();
  });
  await waitVisible(page, '#detailDrawer');
  await page.waitForSelector('#detailBody .detail-section', { timeout: 30000 });
}

async function openVoucherByText(page, voucherId) {
  await page.click('.result-tab[data-tab="vouchers"]');
  await page.waitForSelector('#resultTableWrap tbody tr');
  await page.evaluate((vid) => {
    const row = [...document.querySelectorAll('#resultTableWrap tbody tr.clickable')]
      .find((item) => item.textContent.includes(vid));
    if (!row) throw new Error(`voucher row not found: ${vid}`);
    row.click();
  }, voucherId);
  await waitVisible(page, '#detailDrawer');
  await page.waitForSelector('#detailBody .detail-section', { timeout: 30000 });
}

async function closeDrawer(page) {
  await page.click('#closeDetailButton');
  await page.waitForFunction(() => document.querySelector('#detailDrawer').hidden);
}

async function detailSections(page) {
  return page.evaluate(() => {
    const result = {};
    const side = document.querySelector('#detailDrawer');
    side.querySelectorAll('details').forEach((node) => { node.open = true; });
    const sections = [...side.querySelectorAll('.detail-section')];
    for (const section of sections) {
      const title = section.querySelector('h3')?.textContent || '';
      const rows = [...section.querySelectorAll('table.detail-table tbody tr')].map(
        (row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim())
      );
      if (title.startsWith('分录明细')) result.lines = rows;
      if (title === '对方科目') result.contra = rows;
    }
    result.text = side.innerText;
    return result;
  });
}

async function waitResultPage(page) {
  await page.waitForFunction(() => {
    const wrap = document.querySelector('#resultTableWrap');
    const empty = wrap && [...wrap.querySelectorAll('.empty-state')]
      .some((node) => !node.textContent.includes('正在加载'));
    return Boolean(wrap && (wrap.querySelector('table') || empty));
  }, { timeout: 30000 });
}

async function switchAllTabs(page) {
  for (const tab of ['business', 'contra', 'anomaly', 'vouchers']) {
    await page.click(`.result-tab[data-tab="${tab}"]`);
    await page.waitForFunction(() => {
      const wrap = document.querySelector('#resultTableWrap');
      const empty = wrap && [...wrap.querySelectorAll('.empty-state')]
        .some((node) => !node.textContent.includes('正在加载'));
      return Boolean(wrap && (wrap.querySelector('table') || empty));
    }, { timeout: 30000 });
  }
}

async function setGroupLevels(page, levels) {
  let current = await page.$$eval('#groupLevels select', (nodes) => nodes.length);
  while (current > levels.length) {
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#groupLevels .split-level')];
      const last = rows[rows.length - 1];
      const remove = last?.querySelectorAll('.level-actions button')[2];
      if (remove) remove.click();
    });
    current -= 1;
    await page.waitForFunction((count) => document.querySelectorAll('#groupLevels select').length === count, { timeout: 5000 }, current);
  }
  while (current < levels.length) {
    await page.click('#addGroupLevel');
    current += 1;
    await page.waitForFunction((count) => document.querySelectorAll('#groupLevels select').length === count, { timeout: 5000 }, current);
  }
  for (let index = 0; index < levels.length; index += 1) {
    const dimension = levels[index];
    await page.evaluate(({ i, dim }) => {
      const select = document.querySelectorAll('#groupLevels select')[i];
      select.value = dim;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { i: index, dim: dimension });
    await page.waitForFunction(({ i, dim }) => document.querySelectorAll('#groupLevels select')[i]?.value === dim, { timeout: 5000 }, { i: index, dim: dimension });
  }
}

async function generateSplitOutput(page) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/journal-entry-splits')
      && response.request().method() === 'POST'
  );
  await page.click('#generateSplitButton');
  const response = await responsePromise;
  assert.equal(response.status(), 202, 'split generate');
  return response.json();
}

async function setInputValue(page, selector, value) {
  await page.$eval(selector, (node, next) => {
    node.value = next;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function uploadBatch(page, filenames) {
  const input = await page.$('#batchFileInput');
  assert.ok(input, 'batch file input missing');
  await input.uploadFile(...filenames.map((name) => path.join(FIXTURES, name)));
  await waitEnabled(page, '#batchUploadButton');
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/journal-entry-batches')
      && response.request().method() === 'POST'
  );
  await page.click('#batchUploadButton');
  const response = await responsePromise;
  assert.equal(response.status(), 201, 'batch upload');
  await waitVisible(page, '#batchWorkspacePanel');
  await page.waitForFunction(
    (count) => document.querySelectorAll('#batchTableWrap tbody tr').length === count,
    { timeout: 30000 },
    filenames.length
  );
}

async function configureBatchItem(page, filename, mapping, options = {}) {
  const layout = options.layout || 'debit_credit';
  const positiveSide = options.positiveSide;
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('#batchTableWrap tbody tr')]
      .find((item) => item.textContent.includes(name) && item.dataset.status === 'draft');
    const button = row && row.querySelector('button[data-action="configure"]');
    if (!button) throw new Error(`configure button not found: ${name}`);
    button.click();
  }, filename);
  await waitVisible(page, '#configModal');
  const frameHandle = await page.$('#configFrame');
  assert.ok(frameHandle, 'config iframe missing');
  const frame = await frameHandle.contentFrame();
  assert.ok(frame, 'config frame not available');
  await frame.waitForSelector('#mappingPanel:not([hidden])', { visible: true, timeout: 30000 });
  await frame.waitForSelector('#mappingGrid select[data-field="date"]', { timeout: 30000 });
  await frame.select('#amountLayoutSelect', layout);
  if (positiveSide) {
    await frame.select('#positiveSideSelect', positiveSide);
  }
  await frame.evaluate((values) => {
    const grid = document.querySelector('#mappingGrid');
    for (const [field, index] of Object.entries(values)) {
      const select = grid.querySelector(`select[data-field="${field}"]`);
      if (!select) throw new Error(`mapping field missing: ${field}`);
      select.value = String(index);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, mapping);
  await frame.click('#previewButton');
  await frame.waitForSelector('#previewPanel:not([hidden])', { visible: true, timeout: 60000 });
  await shot(page, 'batch-config');
  await page.click('#closeConfigButton');
  await page.waitForFunction(() => document.querySelector('#configModal').hidden);
  await page.waitForFunction((name) => {
    const row = [...document.querySelectorAll('#batchTableWrap tbody tr')]
      .find((item) => item.textContent.includes(name));
    return row && row.textContent.includes('已配置');
  }, { timeout: 30000 }, filename);
}

async function waitForBatchDownload(cdp) {
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  } catch (_) {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((name) => name.endsWith('.xlsx'));
    if (files.length) {
      const file = path.join(DOWNLOAD_DIR, files[0]);
      const stat = fs.statSync(file);
      if (stat.size > 0) return { name: files[0], size: stat.size };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('batch browser download did not produce an .xlsx file');
}

async function downloadOutput(page, cdp, selector, extension) {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  } catch (_) {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  }
  await waitVisible(page, selector);
  await page.click(selector);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((name) => name.endsWith(extension));
    if (files.length) {
      const file = path.join(DOWNLOAD_DIR, files[0]);
      const stat = fs.statSync(file);
      if (stat.size > 0) return { name: files[0], size: stat.size };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`browser download did not produce ${extension}`);
}

async function exportReport(page, cdp) {
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  } catch (_) {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
  }
  await page.click('#exportButton');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter((name) => name.endsWith('.xlsx'));
    if (files.length) {
      const file = path.join(DOWNLOAD_DIR, files[0]);
      const stat = fs.statSync(file);
      if (stat.size > 0) return { name: files[0], size: stat.size };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('browser download did not produce an .xlsx file');
}

async function main() {
  const serverInfo = await startServer();
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 1000 },
    protocolTimeout: 900000
  });

  const page = await browser.newPage();
  const diagnostics = attachDiagnostics(page);
  await page.evaluateOnNewDocument(() => {
    window.__jeUnhandled = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__jeUnhandled.push(String(event.reason));
    });
  });

  const cdp = await page.createCDPSession();
  const toolUrl = `${serverInfo.base}${TOOL_PATH}`;

  try {
    log('Authentication');
    await page.goto(toolUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname === '/login');
    await page.waitForSelector('#loginForm');
    log('  unauthenticated redirect: PASS');

    await page.type('#username', serverInfo.auth.credentials.username);
    await page.type('#password', serverInfo.auth.credentials.password);
    const loginResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/login') && response.request().method() === 'POST'
    );
    await page.click('.submit-button');
    assert.equal((await loginResponse).status(), 200, 'login');
    await page.waitForFunction(() => location.pathname.includes('journal-entry-analysis'));
    await waitVisible(page, '#uploadPanel');
    assert.equal(serverInfo.auth.loginCount(), 1);
    log('  login through UI: PASS');

    log('Page load');
    assert.match(await page.title(), /序时账分析/);
    assert.equal(await page.$eval('#fileInput', (node) => Boolean(node)), true);
    const layouts = await page.$$eval('#amountLayoutSelect option', (options) => options.map((item) => item.value));
    assert.deepEqual(layouts, ['direction_amount', 'debit_credit', 'signed_amount']);
    assert.equal(await page.evaluate(() => window.__jeUnhandled.length), 0);
    log('  PASS');

    log('DEBIT_CREDIT');
    await uploadFixture(page, 'journal_basic.xlsx');
    await redetect(page);
    await configureMapping(page, 'debit_credit', {
      date: 1, voucher_id: 3, account_code: 4, account_name: 5,
      debit: 7, credit: 8, description: 9, currency: 11
    });
    await preview(page);
    await waitVisible(page, '#previewPanel');
    assert.match(await page.$eval('#previewCanStart', (node) => node.textContent), /可以开始/);
    const debitStatuses = await startAndWaitForResult(page);
    log(`  upload/inspect/mapping/preview/start/progress: PASS (${debitStatuses.join(' -> ')})`);
    const metricCount = await page.$$eval('#resultMetrics .metric', (nodes) => nodes.length);
    assert.ok(metricCount >= 4, 'dashboard metrics missing');
    await switchAllTabs(page);
    await shot(page, 'debit-dashboard');
    log('  dashboard + four tabs: PASS');
    await openFirstVoucher(page);
    const basicDetail = await detailSections(page);
    assert.ok(basicDetail.lines.length >= 2, 'voucher detail lines missing');
    assert.ok(basicDetail.text.includes('技术追溯'));
    await closeDrawer(page);
    log('  voucher drawer: PASS');
    const download = await exportReport(page, cdp);
    assert.match(download.name, /\.xlsx$/);
    const debitJobId = await page.$eval('#exportButton', (node) => {
      const match = String(node.href).match(/analyses\/([0-9a-f-]{36})\/export/i);
      return match ? match[1] : null;
    });
    assert.ok(debitJobId, 'single job id not found');
    log(`  export: PASS (${download.name}, ${download.size} bytes)`);

    log('SIGNED_AMOUNT');
    await uploadFixture(page, 'journal_signed_amount.xlsx');
    await redetect(page);
    await configureMapping(page, 'signed_amount', {
      date: 1, voucher_id: 2, account_code: 3, account_name: 4,
      description: 5, signed_amount: 6
    });
    assert.equal(await page.$eval('#positiveSideControl', (node) => node.hidden), false);
    assert.equal(await page.$eval('#positiveSideSelect', (node) => node.value), '');
    await shot(page, 'signed-mapping');
    await page.click('#previewButton');
    await page.waitForFunction(() => !document.querySelector('#mappingError').hidden);
    assert.match(await page.$eval('#mappingError', (node) => node.textContent), /正数代表借方还是贷方/);
    assert.equal(await page.$eval('#positiveSideSelect', (node) => node.getAttribute('aria-invalid')), 'true');
    log('  missing positive_side blocked: PASS');

    await page.select('#positiveSideSelect', 'debit');
    await preview(page);
    await waitVisible(page, '#previewPanel');
    let previewText = await page.$eval('#previewSamples', (node) => node.innerText);
    assert.ok(previewText.includes('1002 银行存款'), 'debit preview bank line missing');
    assert.ok(previewText.includes('借 1,000.00 贷 0.00'), 'debit preview direction incorrect');
    log('  positive=debit preview: PASS');

    await page.select('#positiveSideSelect', 'credit');
    await preview(page);
    await waitVisible(page, '#previewPanel');
    previewText = await page.$eval('#previewSamples', (node) => node.innerText);
    assert.ok(previewText.includes('借 0.00 贷 1,000.00'), 'credit preview direction incorrect');
    log('  positive=credit preview: PASS');

    await page.select('#positiveSideSelect', 'debit');
    await preview(page);
    await waitVisible(page, '#previewPanel');
    const signedStatuses = await startAndWaitForResult(page);
    log(`  signed worker/result: PASS (${signedStatuses.join(' -> ')})`);

    log('DUPLICATE line_id');
    await uploadFixture(page, 'journal_duplicate_line_id.xlsx');
    await redetect(page);
    await configureMapping(page, 'debit_credit', {
      date: 1, voucher_id: 2, line_id: 3, account_code: 4,
      account_name: 5, description: 6, debit: 7, credit: 8
    });
    await preview(page);
    await startAndWaitForResult(page);
    await openVoucherByText(page, 'SA-001');
    const duplicateA = await detailSections(page);
    assert.equal(duplicateA.lines.length, 2);
    assert.ok(duplicateA.lines.every((row) => row[2] === '001'), 'external line_id should be duplicated');
    assert.notEqual(duplicateA.lines[0][1], duplicateA.lines[1][1], 'source rows must differ');
    assert.ok(duplicateA.contra.length >= 1, 'contra allocation missing for SA-001');
    assert.ok(duplicateA.contra[0][0].includes('银行存款'), `wrong contra source: ${duplicateA.contra[0][0]}`);
    assert.ok(duplicateA.contra[0][1].includes('主营业务收入'), `wrong contra target: ${duplicateA.contra[0][1]}`);
    assert.ok(duplicateA.text.includes('internal'), 'internal trace metadata missing');
    await shot(page, 'duplicate-line-id-drawer');
    await closeDrawer(page);
    log('  SA-001 drawer + contra identity: PASS');

    await openVoucherByText(page, 'SA-002');
    const duplicateB = await detailSections(page);
    assert.ok(duplicateB.text.includes('SA-002'));
    assert.equal(duplicateB.lines.length, 2);
    assert.ok(duplicateB.lines.some((row) => row[4] === '管理费用'));
    assert.ok(duplicateB.lines.some((row) => row[4] === '银行存款'));
    assert.ok(duplicateB.contra[0][0].includes('管理费用'), `wrong SA-002 source: ${duplicateB.contra[0][0]}`);
    assert.ok(duplicateB.contra[0][1].includes('银行存款'), `wrong SA-002 target: ${duplicateB.contra[0][1]}`);
    await closeDrawer(page);
    log('  SA-002 drawer: PASS');

    log('History reload');
    await page.reload({ waitUntil: 'networkidle0' });
    await waitVisible(page, '#uploadPanel');
    await page.waitForSelector('#historyList .history-row', { timeout: 30000 });
    const historyText = await page.$eval('#historyList', (node) => node.innerText);
    assert.ok(historyText.includes('journal_signed_amount.xlsx'));
    assert.ok(historyText.includes('journal_duplicate_line_id.xlsx'));
    const opened = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#historyList .history-row')];
      const row = rows.find((item) => item.textContent.includes('journal_duplicate_line_id.xlsx'));
      const button = row && [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === '打开结果');
      if (!button) return false;
      button.click();
      return true;
    });
    assert.equal(opened, true);
    await waitVisible(page, '#resultPanel', 60000);
    assert.match(await page.$eval('#resultSubtitle', (node) => node.textContent), /journal_duplicate_line_id\.xlsx/);
    const openedSigned = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#historyList .history-row')];
      const row = rows.find((item) => item.textContent.includes('journal_signed_amount.xlsx'));
      const button = row && [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === '打开结果');
      if (!button) return false;
      button.click();
      return true;
    });
    assert.equal(openedSigned, true);
    await page.waitForFunction(
      () => /journal_signed_amount\.xlsx/.test(document.querySelector('#resultSubtitle')?.textContent || ''),
      { timeout: 60000 }
    );
    log('  reload + history + reopen duplicate/signed results: PASS');

    log('BATCH WORKSPACE');
    await page.goto(toolUrl, { waitUntil: 'networkidle0' });
    await waitVisible(page, '#uploadPanel');
    const batchLink = page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.click('#batchWorkspaceLink');
    await batchLink;
    assert.equal(await page.evaluate(() => location.pathname), '/app/tools/journal-entry-analysis/batch.html');
    await waitVisible(page, '#batchUploadPanel');
    await uploadBatch(page, [
      'journal_basic.xlsx',
      'journal_duplicate_line_id.xlsx',
      'journal_signed_amount.xlsx'
    ]);
    await page.waitForSelector('#batchTableWrap tbody tr');
    assert.equal(await page.$eval('#batchStartButton', (node) => node.disabled), true);
    assert.ok((await page.$eval('#batchTableWrap', (node) => node.innerText)).includes('未配置'));
    await configureBatchItem(page, 'journal_basic.xlsx', {
      date: 1, voucher_id: 3, account_code: 4, account_name: 5,
      debit: 7, credit: 8, description: 9, currency: 11
    });
    await configureBatchItem(page, 'journal_duplicate_line_id.xlsx', {
      date: 1, voucher_id: 2, line_id: 3, account_code: 4,
      account_name: 5, description: 6, debit: 7, credit: 8
    });
    await waitEnabled(page, '#batchStartButton');
    assert.match(await page.$eval('#batchStartButton', (node) => node.textContent), /开始全部已就绪（2）/);
    assert.match(await page.$eval('#batchReadyMeta', (node) => node.textContent), /2 个可启动.*1 个待配置/);
    const batchStartResponse = page.waitForResponse(
      (response) => response.url().includes('/api/journal-entry-batches/')
        && response.url().endsWith('/start')
        && response.request().method() === 'POST'
    );
    await page.click('#batchStartButton');
    const firstStart = await batchStartResponse;
    assert.equal(firstStart.status(), 202, 'batch start');
    const firstStartBody = await firstStart.json();
    assert.equal(firstStartBody.startedCount, 2);
    assert.equal(firstStartBody.skippedCount, 1);
    await page.waitForFunction(() => {
      const status = document.querySelector('#batchStatus')?.textContent.trim();
      const rows = [...document.querySelectorAll('#batchTableWrap tbody tr')];
      const basic = rows.find((row) => row.textContent.includes('journal_basic.xlsx'));
      const dup = rows.find((row) => row.textContent.includes('journal_duplicate_line_id.xlsx'));
      const signed = rows.find((row) => row.textContent.includes('journal_signed_amount.xlsx'));
      return status === '待配置'
        && basic?.textContent.includes('已完成')
        && dup?.textContent.includes('已完成')
        && signed?.textContent.includes('待配置');
    }, { timeout: 180000 });
    let batchRows = await page.$$eval('#batchTableWrap tbody tr', (rows) => rows.map((row) => row.innerText));
    assert.equal(batchRows.length, 3);
    assert.ok(batchRows.filter((text) => text.includes('已完成')).length === 2);
    const notice = await page.$eval('#batchNotice', (node) => ({ hidden: node.hidden, text: node.textContent }));
    assert.equal(notice.hidden, false);
    assert.match(notice.text, /1 个仍待配置/);
    assert.match(notice.text, /journal_signed_amount\.xlsx/);
    log('  start-ready: 2 queued, 1 draft remains: PASS');

    const partialExportResponse = page.waitForResponse(
      (response) => response.url().includes('/api/journal-entry-batches/')
        && response.url().endsWith('/exports')
        && response.request().method() === 'POST'
    );
    await page.click('#batchGenerateOutput');
    const partialExport = await partialExportResponse;
    assert.equal(partialExport.status(), 202, 'partial batch export');
    const partialExportBody = await partialExport.json();
    assert.equal(partialExportBody.output.snapshot.included_files, 2);
    assert.equal(partialExportBody.output.snapshot.excluded_files, 1);
    assert.equal(partialExportBody.output.snapshot.excluded_draft, 1);
    await waitVisible(page, '#downloadSummary');
    const partialMeta = await page.$eval('#batchOutputMeta', (node) => node.textContent);
    assert.match(partialMeta, /包含 2 个已完成文件/);
    assert.match(partialMeta, /1 个未包含/);
    const partialSummary = await downloadOutput(page, cdp, '#downloadSummary', '.xlsx');
    assert.match(partialSummary.name, /\.xlsx$/);
    log(`  partial batch export: PASS (${partialSummary.name}, ${partialSummary.size} bytes)`);

    await configureBatchItem(page, 'journal_signed_amount.xlsx', {
      date: 1, voucher_id: 2, account_code: 3, account_name: 4,
      description: 5, signed_amount: 6
    }, { layout: 'signed_amount', positiveSide: 'debit' });
    await waitEnabled(page, '#batchStartButton');
    assert.match(await page.$eval('#batchStartButton', (node) => node.textContent), /开始全部已就绪（1）/);
    const batchStartResponse2 = page.waitForResponse(
      (response) => response.url().includes('/api/journal-entry-batches/')
        && response.url().endsWith('/start')
        && response.request().method() === 'POST'
    );
    await page.click('#batchStartButton');
    const secondStart = await batchStartResponse2;
    assert.equal(secondStart.status(), 202, 'batch second start');
    const secondStartBody = await secondStart.json();
    assert.equal(secondStartBody.startedCount, 1);
    assert.equal(secondStartBody.skippedCount, 0);
    await page.waitForFunction(
      () => document.querySelector('#batchStatus')?.textContent.trim() === '全部完成',
      { timeout: 180000 }
    );
    batchRows = await page.$$eval('#batchTableWrap tbody tr', (rows) => rows.map((row) => row.innerText));
    assert.equal(batchRows.length, 3);
    assert.ok(batchRows.every((text) => text.includes('已完成')));
    const summaryBasis = await page.$eval('#batchSummaryBasis', (node) => node.textContent);
    assert.match(summaryBasis, /3 \/ 3 个已完成文件/);
    const voucherValue = await page.$eval('[data-metric="voucherCount"] strong', (node) => node.textContent);
    assert.equal(voucherValue, '8');
    const completedValue = await page.$eval('[data-metric="completedFiles"] strong', (node) => node.textContent);
    assert.equal(completedValue, '3 / 3');
    await shot(page, 'batch-completed');
    log('  configure remaining + second start-ready + summary: PASS');

    const finalExportResponse = page.waitForResponse(
      (response) => response.url().includes('/api/journal-entry-batches/')
        && response.url().endsWith('/exports')
        && response.request().method() === 'POST'
    );
    await page.click('#batchGenerateOutput');
    const finalExport = await finalExportResponse;
    assert.equal(finalExport.status(), 202, 'final batch export');
    const finalExportBody = await finalExport.json();
    assert.equal(finalExportBody.output.snapshot.included_files, 3);
    assert.equal(finalExportBody.output.snapshot.excluded_files, 0);
    await waitVisible(page, '#downloadSummary');
    await waitVisible(page, '#downloadMerged');
    await waitVisible(page, '#downloadZip');
    const finalMeta = await page.$eval('#batchOutputMeta', (node) => node.textContent);
    assert.match(finalMeta, /包含 3 个已完成文件/);
    const finalSummary = await downloadOutput(page, cdp, '#downloadSummary', '.xlsx');
    const finalMerged = await downloadOutput(page, cdp, '#downloadMerged', '.xlsx');
    const finalZip = await downloadOutput(page, cdp, '#downloadZip', '.zip');
    assert.match(finalSummary.name, /\.xlsx$/);
    assert.match(finalMerged.name, /\.xlsx$/);
    assert.match(finalZip.name, /\.zip$/);
    await shot(page, 'batch-output-ready');
    log(`  batch output downloads: PASS (${finalSummary.size} / ${finalMerged.size} / ${finalZip.size} bytes)`);

    fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('#batchTableWrap tbody tr a')]
        .find((item) => item.textContent.trim() === '导出');
      if (!link) throw new Error('batch export link missing');
      link.click();
    });
    const batchDownload = await waitForBatchDownload(cdp);
    assert.match(batchDownload.name, /\.xlsx$/);
    log(`  per-file export: PASS (${batchDownload.name}, ${batchDownload.size} bytes)`);

    await page.reload({ waitUntil: 'networkidle0' });
    await waitVisible(page, '#batchUploadPanel');
    await page.waitForSelector('#batchHistoryList .batch-history-row', { timeout: 30000 });
    const batchHistoryText = await page.$eval('#batchHistoryList', (node) => node.innerText);
    assert.ok(batchHistoryText.includes('journal_basic'));
    await page.evaluate(() => {
      const row = document.querySelector('#batchHistoryList .batch-history-row');
      if (!row) throw new Error('batch history row missing');
      row.click();
    });
    await waitVisible(page, '#batchWorkspacePanel');
    await page.waitForFunction(
      () => document.querySelector('#batchStatus')?.textContent.trim() === '全部完成',
      { timeout: 30000 }
    );
    await waitVisible(page, '#downloadZip');
    const refreshMeta = await page.$eval('#batchOutputMeta', (node) => node.textContent);
    assert.match(refreshMeta, /包含 3 个已完成文件/);
    const childHref = await page.evaluate(() => {
      const link = [...document.querySelectorAll('#batchTableWrap tbody tr a')]
        .find((item) => item.textContent.trim() === '打开结果');
      return link ? link.href : null;
    });
    assert.ok(childHref, 'batch child result link missing');
    const childPage = await browser.newPage();
    let childFullResult = [];
    childPage.on('request', (request) => {
      try {
        if (/\/api\/journal-entry-analyses\/[0-9a-f-]{36}\/result$/i.test(new URL(request.url()).pathname)) {
          childFullResult.push(request.url());
        }
      } catch (_) {}
    });
    try {
      await childPage.goto(childHref, { waitUntil: 'networkidle0' });
      await childPage.waitForSelector('#resultMetrics .metric', { timeout: 30000 });
      await childPage.waitForFunction(() => {
        const wrap = document.querySelector('#resultTableWrap');
        return Boolean(wrap && (wrap.querySelector('table') || wrap.querySelector('.empty-state')));
      }, { timeout: 30000 });
      assert.deepEqual(childFullResult, [], 'batch child requested full result.json');
    } finally {
      await childPage.close();
    }
    log('  batch child result viewer: PASS');
    const refreshedZip = await downloadOutput(page, cdp, '#downloadZip', '.zip');
    assert.match(refreshedZip.name, /\.zip$/);
    log('  batch history reload + output re-download: PASS');
    const batchId = await page.$eval('#batchSplitLink', (node) => {
      const url = new URL(node.getAttribute('href'), location.href);
      return url.searchParams.get('scopeId');
    });
    assert.ok(batchId, 'batch id not found');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#batchSplitLink')
    ]);
    assert.equal(await page.evaluate(() => location.pathname), '/app/tools/journal-entry-analysis/split.html');
    assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get('scopeType')), 'batch');
    await waitVisible(page, '#scopeCard');
    await page.waitForFunction(() => document.querySelector('#scopeBadge')?.textContent === 'BATCH');
    log('  batch split navigation: PASS');

    log('SPLIT WORKSPACE');
    await page.goto(toolUrl, { waitUntil: 'networkidle0' });
    await uploadFixture(page, 'journal_audit_split.xlsx');
    await redetect(page);
    await configureMapping(page, 'debit_credit', {
      date: 1, voucher_id: 2, account_code: 3, account_name: 4,
      customer_code: 5, customer_name: 6, supplier_code: 7, supplier_name: 8,
      counterparty_name: 9, description: 10, debit: 11, credit: 12
    });
    await preview(page);
    await startAndWaitForResult(page);
    await waitVisible(page, '#splitLink');
    const splitHref = await page.$eval('#splitLink', (node) => node.getAttribute('href'));
    assert.match(splitHref, /split\.html\?scopeType=job/);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#splitLink')
    ]);
    await page.waitForFunction(() => location.pathname.endsWith('/split.html'));
    await waitVisible(page, '#scopeCard');
    await page.waitForFunction(() => document.querySelector('#scopeTitle')?.textContent.includes('journal_audit_split'));
    assert.equal(await page.$eval('#groupLevels select[data-level-index="0"] option[value="customer"]', (node) => node.disabled), false);
    log('  open split workspace: PASS');

    await setGroupLevels(page, ['account', 'month']);
    await page.select('#outputMode', 'multi_sheet');
    await page.click('#previewButton');
    await waitVisible(page, '#previewCard');
    assert.equal(await page.$eval('[data-metric="groupCount"] strong', (node) => node.textContent), '7');
    await shot(page, 'split-multi-preview');
    const accountOutput = await generateSplitOutput(page);
    assert.equal(accountOutput.output.outputMode, 'multi_sheet');
    await waitVisible(page, '#splitDownload');
    const accountSplit = await downloadOutput(page, cdp, '#splitDownload', '.xlsx');
    assert.match(accountSplit.name, /\.xlsx$/);
    log(`  account multi-sheet: PASS (${accountSplit.size} bytes)`);

    await setGroupLevels(page, ['customer', 'month']);
    await page.select('#outputMode', 'zip');
    await setInputValue(page, '#dateFrom', '2025-01-01');
    await setInputValue(page, '#dateTo', '2025-02-28');
    await page.click('#previewButton');
    await waitVisible(page, '#previewCard');
    const customerPreview = await page.$eval('#splitGroupTable', (node) => node.innerText);
    assert.ok(customerPreview.includes('客户A'));
    assert.ok(customerPreview.includes('客户B'));
    assert.ok(customerPreview.includes('未指定客户'));
    await shot(page, 'split-customer-preview');
    const customerOutput = await generateSplitOutput(page);
    assert.equal(customerOutput.output.outputMode, 'zip');
    await waitVisible(page, '#splitDownload');
    const customerZip = await downloadOutput(page, cdp, '#splitDownload', '.zip');
    assert.match(customerZip.name, /\.zip$/);
    await shot(page, 'split-output-ready');
    log(`  customer + date filter ZIP: PASS (${customerZip.size} bytes)`);

    const presetName = 'E2E 客户按月';
    await page.click('#savePreset');
    await waitVisible(page, '#presetSaveModal');
    await page.type('#presetName', presetName);
    const presetResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/journal-entry-split-presets')
        && response.request().method() === 'POST'
    );
    await page.click('#confirmPresetSave');
    assert.equal((await presetResponse).status(), 201, 'preset save');
    await page.waitForFunction(() => document.querySelector('#presetSaveModal').hidden);
    log('  save split preset: PASS');

    await page.reload({ waitUntil: 'networkidle0' });
    await waitVisible(page, '#scopeCard');
    await page.waitForFunction(() => document.querySelector('#splitDownload')?.hidden === false, { timeout: 60000 });
    const reloadedMeta = await page.$eval('#outputMeta', (node) => node.textContent);
    assert.match(reloadedMeta, /包含/);
    log('  split output refresh recovery: PASS');

    await page.waitForFunction(() => document.querySelectorAll('#presetSelect option').length > 1);
    const presetValue = await page.evaluate((name) => {
      const option = [...document.querySelectorAll('#presetSelect option')]
        .find((item) => item.textContent === name);
      return option ? option.value : null;
    }, presetName);
    assert.ok(presetValue, 'saved preset missing');
    await page.select('#presetSelect', presetValue);
    await page.click('#applyPreset');
    await page.waitForFunction(() => document.querySelectorAll('#groupLevels select')[0]?.value === 'customer'
      && document.querySelectorAll('#groupLevels select')[1]?.value === 'month');
    assert.equal(await page.$eval('#dateFrom', (node) => node.value), '2025-01-01');
    assert.equal(await page.$eval('#dateTo', (node) => node.value), '2025-02-28');
    assert.equal(await page.$eval('#outputMode', (node) => node.value), 'zip');
    await page.click('#previewButton');
    await waitVisible(page, '#previewCard');
    assert.equal(await page.$eval('[data-metric="groupCount"] strong', (node) => node.textContent), '4');
    await shot(page, 'split-preset-applied');
    log('  reload + apply preset + preview: PASS');

    await setInputValue(page, '#dateFrom', '');
    await setInputValue(page, '#dateTo', '');
    await setGroupLevels(page, ['supplier']);
    await page.click('#previewButton');
    await waitVisible(page, '#previewCard');
    const supplierPreview = await page.$eval('#splitGroupTable', (node) => node.innerText);
    assert.ok(supplierPreview.includes('供应商A'));
    assert.ok(supplierPreview.includes('供应商B'));
    assert.ok(supplierPreview.includes('未指定供应商'));
    log('  supplier preview: PASS');

    await setGroupLevels(page, ['month']);
    await page.click('#previewButton');
    await waitVisible(page, '#previewCard');
    const monthPreview = await page.$eval('#splitGroupTable', (node) => node.innerText);
    assert.ok(monthPreview.includes('2025-01'));
    assert.ok(monthPreview.includes('2025-02'));
    assert.ok(monthPreview.includes('2025-03'));
    log('  month preview: PASS');

    await waitVisible(page, '#deleteSplitOutput');
    page.once('dialog', (dialog) => dialog.accept());
    const deleteSplitResponse = page.waitForResponse(
      (response) => /\/api\/journal-entry-splits\/[0-9a-f-]{36}$/i.test(response.url())
        && response.request().method() === 'DELETE'
    );
    await page.click('#deleteSplitOutput');
    assert.equal((await deleteSplitResponse).status(), 200, 'delete split output');
    await page.waitForFunction(() => document.querySelector('#splitDownload').hidden
      && /已过期/.test(document.querySelector('#outputMeta')?.textContent || ''));
    log('  split output delete + expired state: PASS');

    await page.goto(`${serverInfo.base}/app/tools/journal-entry-analysis/split.html?scopeType=job&scopeId=${debitJobId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#scopeTitle')?.textContent.includes('journal_basic'));
    await page.waitForFunction(() => document.querySelectorAll('#presetSelect option').length > 1);
    const incompatibleValue = await page.evaluate((name) => {
      const option = [...document.querySelectorAll('#presetSelect option')]
        .find((item) => item.textContent === name);
      return option ? option.value : null;
    }, presetName);
    assert.ok(incompatibleValue, 'preset missing for incompatibility check');
    await page.select('#presetSelect', incompatibleValue);
    await page.click('#applyPreset');
    await page.waitForFunction(() => !document.querySelector('#splitError').hidden
      || (document.querySelector('#splitError').textContent || '').includes('客户'));
    const incompatibleError = await page.$eval('#splitError', (node) => node.textContent);
    assert.match(incompatibleError, /客户/);
    assert.equal(await page.$eval('#previewButton', (node) => node.disabled), true);
    log('  incompatible preset blocked: PASS');

    await page.goto(`${serverInfo.base}/app/tools/journal-entry-analysis/split.html?scopeType=invalid&scopeId=${debitJobId}`, { waitUntil: 'networkidle0' });
    await waitVisible(page, '#scopeError');
    assert.match(await page.$eval('#scopeError', (node) => node.textContent), /数据范围无效/);
    log('  invalid split scope is a product error, not static 404: PASS');

    await page.goto(`${serverInfo.base}/app/tools/journal-entry-analysis/batch.html?batch=${batchId}`, { waitUntil: 'networkidle0' });
    await waitVisible(page, '#batchWorkspacePanel');
    page.once('dialog', (dialog) => dialog.accept());
    const deleteBatchResponse = page.waitForResponse(
      (response) => response.url().endsWith(`/api/journal-entry-batches/${batchId}`)
        && response.request().method() === 'DELETE'
    );
    await page.click('#deleteBatchButton');
    assert.equal((await deleteBatchResponse).status(), 200, 'delete batch');
    await waitVisible(page, '#batchUploadPanel');
    await page.waitForFunction(() => document.querySelector('#batchWorkspacePanel').hidden);
    await page.waitForFunction(
      () => !document.querySelector('#batchHistoryList')?.innerText.includes('journal_basic 等 3 个文件'),
      { timeout: 10000 }
    );
    await page.goto(`${serverInfo.base}/app/tools/journal-entry-analysis/index.html`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('#historyList .history-row').length > 0);
    const singleHistory = await page.$eval('#historyList', (node) => node.innerText);
    assert.match(singleHistory, /journal_basic\.xlsx/);
    log('  batch delete keeps child jobs: PASS');

    const uploadOnly = process.env.JE_E2E_UPLOAD_ONLY_FILE;
    if (uploadOnly) {
      log('UPLOAD-ONLY BOUNDARY');
      await page.goto(toolUrl, { waitUntil: 'networkidle0' });
      const start = Date.now();
      await uploadFixture(page, uploadOnly);
      log(`  upload+inspect: ${((Date.now() - start) / 1000).toFixed(2)}s`);
      log('  PASS');
    }

    const bigFile = process.env.JE_E2E_BIG_FILE;
    if (bigFile) {
      log('LARGE SINGLE-FILE');
      const apiNetwork = {
        summary: 0, vouchers: 0, findings: 0, details: 0,
        firstVoucherPage: null, largest: 0
      };
      page.on('response', (response) => {
        try {
          const pathname = new URL(response.url()).pathname;
          if (!pathname.startsWith('/api/journal-entry-analyses/')) return;
          const length = Number(response.headers()['content-length'] || 0);
          if (!length) return;
          apiNetwork.largest = Math.max(apiNetwork.largest, length);
          if (pathname.endsWith('/summary')) apiNetwork.summary += length;
          else if (pathname.includes('/vouchers/detail')) apiNetwork.details += length;
          else if (pathname.endsWith('/vouchers')) {
            apiNetwork.vouchers += length;
            if (apiNetwork.firstVoucherPage === null) apiNetwork.firstVoucherPage = length;
          } else if (pathname.endsWith('/findings')) apiNetwork.findings += length;
        } catch (_) {}
      });
      const nodeStart = process.memoryUsage().rss;
      const bigStart = Date.now();
      await page.goto(toolUrl, { waitUntil: 'networkidle0' });
      await uploadFixture(page, bigFile, { timeout: 180000 });
      const uploadDone = Date.now();
      log(`  upload complete: ${((uploadDone - bigStart) / 1000).toFixed(2)}s`);
      await redetect(page, { timeout: 180000 });
      await configureMapping(page, 'debit_credit', {
        date: 1, voucher_id: 2, account_code: 3, account_name: 4,
        customer_code: 5, customer_name: 6, supplier_code: 7, supplier_name: 8,
        counterparty_name: 9, description: 10, debit: 11, credit: 12
      });
      const previewStart = Date.now();
      await preview(page, { timeout: 180000 });
      const previewDone = Date.now();
      log(`  preview complete: ${((previewDone - previewStart) / 1000).toFixed(2)}s`);
      const largeTimeout = /journal_300000/.test(bigFile) ? 600000 : 300000;
      try {
        await startAndWaitForResult(page, { timeout: largeTimeout });
      } catch (error) {
        console.error('[e2e large failure]', JSON.stringify({
          diagnostics,
          tempRoot: TEMP_ROOT,
          serverErrors: diagnostics.serverErrors
        }));
        throw error;
      }
      const analysisDone = Date.now();
      const nodeAfterAnalysis = process.memoryUsage().rss;
      const metricCount = await page.$$eval('#resultMetrics .metric', (nodes) => nodes.length);
      assert.ok(metricCount >= 4);
      const heapAtDashboard = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
      const jobHref = await page.$eval('#splitLink', (node) => node.getAttribute('href'));
      const bigJobId = new URL(jobHref, page.url()).searchParams.get('scopeId');
      assert.ok(bigJobId);
      log('  initial dashboard/pagination');
      await page.click('.result-tab[data-tab="business"]');
      await waitResultPage(page);
      const businessPageOne = await page.$eval('#resultTableWrap tbody tr:first-child', (node) => node.textContent);
      const businessPager = await page.$eval('#resultPager', (node) => node.innerText);
      assert.match(businessPager, /共 \d+ 条/);
      await page.evaluate(() => {
        const next = document.querySelector('#resultPager .pager-actions button:last-child');
        if (next && !next.disabled) next.click();
      });
      await waitResultPage(page);
      const businessPageTwo = await page.$eval('#resultTableWrap tbody tr:first-child', (node) => node.textContent);
      assert.notEqual(businessPageOne, businessPageTwo, 'business next page did not change');
      const businessFilter = await page.$('#resultFilters select');
      if (businessFilter) {
        const value = await businessFilter.evaluate((node) => {
          const option = [...node.options].find((item) => item.value);
          return option ? option.value : '';
        });
        if (value) {
          await page.evaluate((next) => {
            const select = document.querySelector('#resultFilters select');
            select.value = next;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }, value);
          await waitResultPage(page);
        }
      }
      await page.click('.result-tab[data-tab="anomaly"]');
      await waitResultPage(page);
      const heapAfterPagination = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
      await page.click('.result-tab[data-tab="contra"]');
      await waitResultPage(page);
      await page.click('.result-tab[data-tab="vouchers"]');
      await waitResultPage(page);
      await openFirstVoucher(page);
      const drawerText = await page.$eval('#detailBody', (node) => node.innerText);
      assert.ok(drawerText.includes('对方科目'), 'contra detail missing in drawer');
      const heapAfterDrawer = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
      await closeDrawer(page);
      const tabsDone = Date.now();
      const heap = await page.evaluate(() => ({
        used: performance.memory?.usedJSHeapSize || null,
        total: performance.memory?.totalJSHeapSize || null
      }));
      const timing = await page.evaluate(() => {
        const completed = (window.__jeStatusTimes || []).find((item) => item.text === '已完成');
        return {
          completedAt: completed ? completed.at : null,
          dashboardAt: window.__jeDashboardReadyAt || null,
          pageAt: window.__jePageReadyAt || null
        };
      });
      const dashboardSeconds = timing.completedAt && timing.dashboardAt
        ? ((timing.dashboardAt - timing.completedAt) / 1000).toFixed(2)
        : 'unknown';
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('#splitLink')
      ]);
      await page.waitForFunction(() => location.pathname.endsWith('/split.html'));
      await setGroupLevels(page, ['account', 'month']);
      const splitPreviewStart = Date.now();
      await page.click('#previewButton');
      await waitVisible(page, '#previewCard');
      const splitPreviewDone = Date.now();
      const splitGroups = await page.$eval('[data-metric="groupCount"] strong', (node) => node.textContent);
      log(`  upload: ${((uploadDone - bigStart) / 1000).toFixed(2)}s, preview: ${((previewDone - uploadDone) / 1000).toFixed(2)}s, analysis+result: ${((analysisDone - previewDone) / 1000).toFixed(2)}s`);
      log(`  dashboard: ${dashboardSeconds}s, first voucher page: ${apiNetwork.firstVoucherPage || 'unknown'} bytes`);
      log(`  API bytes: summary ${apiNetwork.summary}, vouchers ${apiNetwork.vouchers}, findings ${apiNetwork.findings}, details ${apiNetwork.details}, largest ${apiNetwork.largest}`);
      log(`  tabs+drawer: ${((tabsDone - analysisDone) / 1000).toFixed(2)}s, heap: ${heap.used || 'unknown'}`);
      log(`  heap dashboard/pagination/drawer: ${heapAtDashboard || 'unknown'} / ${heapAfterPagination || 'unknown'} / ${heapAfterDrawer || 'unknown'}`);
      log(`  split preview: ${((splitPreviewDone - splitPreviewStart) / 1000).toFixed(2)}s, groups: ${splitGroups}`);
      log(`  Node RSS start/after analysis: ${(nodeStart / 1024 / 1024).toFixed(1)} / ${(nodeAfterAnalysis / 1024 / 1024).toFixed(1)} MiB`);
      log('  PASS');
    }

    const unhandled = await page.evaluate(() => window.__jeUnhandled);
    assert.deepEqual(unhandled, [], 'unhandled promise rejection');
    assert.deepEqual(diagnostics.pageErrors, [], `page errors: ${diagnostics.pageErrors.join(' | ')}`);
    assert.deepEqual(diagnostics.serverErrors, [], `server errors: ${diagnostics.serverErrors.join(' | ')}`);
    assert.deepEqual(diagnostics.consoleErrors, [], `console errors: ${diagnostics.consoleErrors.join(' | ')}`);
    assert.deepEqual(diagnostics.fullResultRequests, [], `full result.json was requested: ${diagnostics.fullResultRequests.join(' | ')}`);
    assert.deepEqual(diagnostics.http404, [], `document/asset 404: ${diagnostics.http404.join(' | ')}`);
    log('Console/network: PASS');
    log('\nJournal Entry browser E2E: PASS');
    return diagnostics;
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => serverInfo.server.close(resolve));
    if (!process.env.JE_E2E_KEEP_TEMP) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error('\nJournal Entry browser E2E: FAIL');
    console.error(error && error.stack ? error.stack : error);
    if (!process.env.JE_E2E_KEEP_TEMP) {
      try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch (_) {}
    }
    process.exit(1);
  });
}

module.exports = { main };

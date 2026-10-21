'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createFlowchartRouter } = require('../../server/flowchart-excel/routes');
const { createFlowchartService } = require('../../server/flowchart-excel/service');

const ROOT = path.join(__dirname, '..', '..');
const PNG = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'flowchart-excel', 'one-pixel.png'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'tools.json'), 'utf8'));
const TOOL_HTML = fs.readFileSync(path.join(ROOT, 'private', 'tools', 'flowchart-excel', 'index.html'), 'utf8');
const REVIEW_HTML = fs.readFileSync(path.join(ROOT, 'private', 'tools', 'flowchart-excel', 'review.html'), 'utf8');
const DASHBOARD_HTML = fs.readFileSync(path.join(ROOT, 'private', 'index.html'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(ROOT, 'private', 'script.js'), 'utf8');

let tempRoot;
let server;
let base;
let historicalJob;

function makeApp(root) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-user']) req.session = { auth: { username: req.headers['x-user'] } };
    next();
  });
  app.get('/api/other/ping', (_req, res) => res.json({ ok: true, tool: 'other' }));
  app.use('/api/flowchart-excel', createFlowchartRouter({ root, comingSoon: true }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
}

async function request(urlPath, { method = 'GET', user = 'alice', origin } = {}) {
  const headers = { Accept: 'application/json' };
  if (user) headers['x-user'] = user;
  if (origin) headers.origin = origin;
  const response = await fetch(`${base}${urlPath}`, { method, headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test.before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-coming-soon-'));
  const service = createFlowchartService({ root: tempRoot });
  historicalJob = service.createJob({
    ownerUsername: 'alice',
    originalFilename: 'historical-one-pixel.png',
    extension: '.png',
    mimeType: 'image/png',
    buffer: PNG,
    sha256: crypto.createHash('sha256').update(PNG).digest('hex'),
    imageWidth: 1,
    imageHeight: 1,
    workerMode: 'fake'
  });
  server = await listen(makeApp(tempRoot));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('config marks flowchart-excel as coming-soon and keeps one registration', () => {
  const matches = CONFIG.filter((item) => item.slug === 'flowchart-excel');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'coming-soon');
  assert.match(matches[0].description, /功能暂未开放/);
  assert.match(matches[0].description, /实验产物/);
  assert.equal(matches[0].version, 'v0.2.2');
  assert.equal(new Set(CONFIG.map((item) => item.slug)).size, CONFIG.length);
  assert.ok(CONFIG.every((item) => ['ready', 'coming-soon'].includes(item.status)));
});

test('page and review page expose Coming Soon and hide write entry points', () => {
  assert.match(TOOL_HTML, /COMING SOON/);
  assert.match(TOOL_HTML, /功能暂未开放，当前版本正在封存评估中/);
  assert.match(TOOL_HTML, /此前的导出结果仅为实验产物，不代表正式交付能力/);
  assert.match(TOOL_HTML, /id="uploadPanel" hidden/);
  assert.match(TOOL_HTML, /id="historyPanel" hidden/);
  assert.match(TOOL_HTML, /id="newJobButton"[^>]*hidden[^>]*disabled/);
  assert.match(REVIEW_HTML, /Coming Soon · 只读历史/);
  assert.match(REVIEW_HTML, /保存修改、完成复核、批量复核与导出 XLSX 均未开放/);
  assert.match(DASHBOARD_HTML, /tool-status-badge/);
  assert.match(DASHBOARD_JS, /Coming Soon/);
  assert.match(DASHBOARD_JS, /coming-soon/);
});

test('authenticated write requests return FEATURE_COMING_SOON', async () => {
  for (const [method, urlPath] of [
    ['POST', '/api/flowchart-excel/jobs'],
    ['POST', '/api/flowchart-excel/jobs/import-helper-package'],
    ['POST', `/api/flowchart-excel/jobs/${historicalJob.id}/export-xlsx`],
    ['PUT', `/api/flowchart-excel/jobs/${historicalJob.id}/review/graph`],
    ['POST', `/api/flowchart-excel/jobs/${historicalJob.id}/cancel`]
  ]) {
    const result = await request(urlPath, { method });
    assert.equal(result.status, 503, `${method} ${urlPath}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.code, 'FEATURE_COMING_SOON');
    assert.match(result.body.message, /暂未开放/);
  }
});

test('authentication and same-origin checks still run before the gate', async () => {
  const unauthenticated = await request('/api/flowchart-excel/jobs', { method: 'POST', user: null });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.code, 'UNAUTHENTICATED');

  const crossOrigin = await request('/api/flowchart-excel/jobs', {
    method: 'POST',
    origin: 'http://evil.example'
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.code, 'ACCESS_DENIED');
});

test('read-only history, meta and owner isolation remain available', async () => {
  const meta = await request('/api/flowchart-excel/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.comingSoon, true);
  assert.equal(meta.body.featureStatus, 'coming-soon');
  assert.equal(meta.body.editAs, 'pending');

  const list = await request('/api/flowchart-excel/jobs');
  assert.equal(list.status, 200);
  assert.ok(list.body.jobs.some((job) => job.id === historicalJob.id));

  const own = await request(`/api/flowchart-excel/jobs/${historicalJob.id}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.job.id, historicalJob.id);
  assert.equal(own.body.job.exportReady, false);

  const artifacts = await request(`/api/flowchart-excel/jobs/${historicalJob.id}/artifacts`);
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body.ok, true);

  const otherOwner = await request(`/api/flowchart-excel/jobs/${historicalJob.id}`, { user: 'bob' });
  assert.equal(otherOwner.status, 404);
  assert.equal(otherOwner.body.code, 'JOB_NOT_FOUND');

  const missing = await request('/api/flowchart-excel/jobs/not-a-job-id');
  assert.equal(missing.status, 404);
});

test('other tools are not affected by the flowchart gate', async () => {
  const result = await request('/api/other/ping');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.tool, 'other');
});

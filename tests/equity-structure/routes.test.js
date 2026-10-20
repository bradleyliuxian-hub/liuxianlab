'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-routes-'));
const state = { jobs: new Map(), corrections: [], enqueued: [] };

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'equity-structure', 'repository.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'equity-structure', 'worker-runner.js'));

  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      async createJob(job) {
        const record = { ...job, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
        state.jobs.set(job.id, record);
        return record;
      },
      async getJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        return job && job.ownerUsername === owner ? job : null;
      },
      async findCompletedByHash(owner, sha) {
        return [...state.jobs.values()].find((job) => job.ownerUsername === owner && job.sourceSha256 === sha && job.status === 'completed') || null;
      },
      async listJobsForOwner(owner) {
        return [...state.jobs.values()].filter((job) => job.ownerUsername === owner);
      },
      async listJobsByStatus() { return []; },
      async listExpiredJobs() { return []; },
      async claimJob() { return null; },
      async updateJobState(id, patch) {
        const current = state.jobs.get(id);
        if (!current) return null;
        const next = { ...current, ...patch, updatedAt: '2026-01-01T00:00:00.000Z' };
        state.jobs.set(id, next);
        return next;
      },
      async deleteJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        if (!job || job.ownerUsername !== owner) return false;
        state.jobs.delete(id);
        return true;
      },
      async deleteJobById(id) { return state.jobs.delete(id); },
      async addCorrection(record) {
        const row = { id: state.corrections.length + 1, original: record.originalName, corrected: record.correctedName, createdAt: '2026-01-01T00:00:00.000Z' };
        state.corrections.push(row);
        return row;
      }
    }
  };

  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      createEquityRunner: () => ({
        enqueue(id) { state.enqueued.push(id); },
        recover() {},
        cleanupExpired() {},
        jobDir(id) { return path.join(tempRoot, 'storage', 'equity-structure', id); },
        resolvePythonBin() { return path.join(ROOT, 'scripts', 'local', 'equity-python'); },
        maxConcurrent: 1,
        retentionHours: 168
      })
    }
  };
}

installStubs();
const { createEquityRouter } = require(path.join(ROOT, 'server', 'equity-structure', 'routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/equity-structures', createEquityRouter({ root: tempRoot }));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function postFile(filename, bytes, type = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await fetch(`${base}/api/equity-structures`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getJson(urlPath, user = 'tester') {
  const response = await fetch(base + urlPath, { headers: { Accept: 'application/json', 'x-user': user } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const resultPayload = {
  title: '示例股权结构图',
  core_company: '示例核心公司',
  all_visible_text: ['股东', '示例核心公司', '54%'],
  nodes: [
    { id: 'n1', name: '股东', entity_type: 'person', level: 1, status: 'active', confidence: 0.9 },
    { id: 'n2', name: '示例核心公司', entity_type: 'company', level: 2, status: 'active', confidence: 0.95 }
  ],
  edges: [{ source: 'n1', target: 'n2', percentage: '54%', relation: 'shareholder_to_core', confidence: 0.9, percentage_source: 'manual' }],
  excluded: [],
  dictionary_corrections: [],
  warnings: [],
  quality: { overall_confidence: 0.93, low_confidence_items: [], review_notes: [] }
};

test('upload validates extension and image magic', async () => {
  const wrong = await postFile('ledger.txt', pngBytes(), 'text/plain');
  assert.equal(wrong.status, 400);
  const badMagic = await postFile('bad.png', Buffer.from('not a png'), 'image/png');
  assert.equal(badMagic.status, 400);
  assert.match(badMagic.body.error, /有效的 PNG/);
});

test('upload creates draft and start queues', async () => {
  const uploaded = await postFile('equity.png', pngBytes());
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.job.status, 'draft');
  const id = uploaded.body.job.id;
  const started = await fetch(`${base}/api/equity-structures/${id}/start`, { method: 'POST', headers: { 'x-user': 'tester' } });
  const body = await started.json();
  assert.equal(started.status, 202);
  assert.equal(body.job.status, 'queued');
  assert.ok(state.enqueued.includes(id));
});

test('owner scoping hides another user job', async () => {
  const uploaded = await postFile('owner.png', pngBytes());
  const response = await getJson(`/api/equity-structures/${uploaded.body.job.id}`, 'someone-else');
  assert.equal(response.status, 404);
});

test('result can be read, edited and exported', async () => {
  const uploaded = await postFile('result.png', pngBytes());
  const id = uploaded.body.job.id;
  const dir = path.join(tempRoot, 'storage', 'equity-structure', id, 'result');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(resultPayload));
  const job = state.jobs.get(id);
  state.jobs.set(id, { ...job, status: 'completed', progress: 100, resultDir: `storage/equity-structure/${id}/result`, summaryJson: { node_count: 2 } });

  const result = await getJson(`/api/equity-structures/${id}/result`);
  assert.equal(result.status, 200);
  assert.equal(result.body.nodes.length, 2);
  assert.equal(result.body.edited, false);

  const edited = { ...resultPayload, edges: [] };
  const save = await fetch(`${base}/api/equity-structures/${id}/result`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-user': 'tester' },
    body: JSON.stringify(edited)
  });
  assert.equal(save.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'manual-result.json')));

  const after = await getJson(`/api/equity-structures/${id}/result`);
  assert.equal(after.body.edges.length, 0);
  assert.equal(after.body.edited, true);

  const unsupported = await fetch(`${base}/api/equity-structures/${id}/export?format=svg`, { headers: { 'x-user': 'tester' } });
  assert.equal(unsupported.status, 400);
});

test('layout can be saved and restored', async () => {
  const uploaded = await postFile('layout.png', pngBytes());
  const id = uploaded.body.job.id;
  const dir = path.join(tempRoot, 'storage', 'equity-structure', id, 'result');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(resultPayload));
  const job = state.jobs.get(id);
  state.jobs.set(id, { ...job, status: 'completed', progress: 100, resultDir: `storage/equity-structure/${id}/result` });
  const layout = { version: 1, nodes: { n1: { x: 120, y: 80, width: 210, height: 72, manualPosition: true } }, labels: { e1: { x: 200, y: 160, manual: true } }, buses: { shareholder: { y: 190, manual: true } }, canvas: { width: 1200, height: 500 } };
  const saved = await fetch(`${base}/api/equity-structures/${id}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-user': 'tester' },
    body: JSON.stringify(layout)
  });
  assert.equal(saved.status, 200);
  const restored = await getJson(`/api/equity-structures/${id}/layout`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.layout.nodes.n1.x, 120);
  assert.equal(restored.body.layout.labels.e1.manual, true);
});

test('PNG API converts a self-contained SVG', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="white"/><text x="12" y="45" font-size="18" fill="black">测试 PNG</text></svg>';
  const response = await fetch(`${base}/api/equity-structures/export/png`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user': 'tester' },
    body: JSON.stringify({ svg, scale: 2 })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/png/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(bytes.length > 100);
});

test('PNG API rejects external/foreign SVG content', async () => {
  const response = await fetch(`${base}/api/equity-structures/export/png`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user': 'tester' },
    body: JSON.stringify({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject></foreignObject></svg>' })
  });
  assert.equal(response.status, 400);
});

test('correction endpoint records a correction', async () => {
  const response = await fetch(`${base}/api/equity-structures/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user': 'tester' },
    body: JSON.stringify({ original: '上海示例公司', corrected: '上海示例有限公司' })
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.correction.original, '上海示例公司');
  assert.equal(state.corrections.length, 1);
});

test('meta exposes OCR limits', async () => {
  const response = await getJson('/api/equity-structures/meta');
  assert.equal(response.status, 200);
  assert.equal(response.body.maxFileSizeBytes, 100 * 1024 * 1024);
  assert.deepEqual(response.body.extensions, ['.png', '.jpg', '.jpeg', '.webp']);
});

test('queued job cannot be deleted', async () => {
  const unique = pngBytes();
  unique[11] = 7;
  const uploaded = await postFile('delete.png', unique);
  const id = uploaded.body.job.id;
  await fetch(`${base}/api/equity-structures/${id}/start`, { method: 'POST', headers: { 'x-user': 'tester' } });
  const response = await fetch(`${base}/api/equity-structures/${id}`, { method: 'DELETE', headers: { 'x-user': 'tester' } });
  assert.equal(response.status, 409);
});

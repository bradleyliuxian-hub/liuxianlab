'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createFlowchartRouter } = require('../../server/flowchart-excel/routes');

const ROOT = path.join(__dirname, '..', '..');
const PNG = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'flowchart-excel', 'one-pixel.png'));
const JPEG = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'flowchart-excel', 'one-pixel.jpg'));
const WEBP = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'flowchart-excel', 'one-pixel.webp'));

let tempRoot;
let server;
let base;
let failureServer;
let failureBase;
let failureRoot;
let modelServer;
let modelBase;
let modelRoot;
let modelStatus;

function makeApp(root, options = {}) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-user']) req.session = { auth: { username: req.headers['x-user'] } };
    next();
  });
  app.use('/api/flowchart-excel', createFlowchartRouter({ root, ...options }));
  return app;
}

async function listen(app) {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
}

async function postFile(filePath, bytes, type, filename, user = 'alice', origin, targetBase = base) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const headers = {};
  if (user) headers['x-user'] = user;
  if (origin) headers.origin = origin;
  const response = await fetch(`${targetBase}/api/flowchart-excel/jobs`, { method: 'POST', headers, body: form });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getJson(urlPath, user = 'alice', origin) {
  const headers = { Accept: 'application/json' };
  if (user) headers['x-user'] = user;
  if (origin) headers.origin = origin;
  const response = await fetch(base + urlPath, { headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitForStatus(jobId, status, timeoutMs = 3000, user = 'alice') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await getJson(`/api/flowchart-excel/jobs/${jobId}`, user);
    if (result.body.job?.status === status) return result.body.job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

test.before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-upload-'));
  server = await listen(makeApp(tempRoot, {
    maxFileSize: 1024,
    maxPixels: 1_000_000,
    fakeWorkerDelayMs: 30
  }));
  base = `http://127.0.0.1:${server.address().port}`;

  failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-upload-fail-'));
  failureServer = await listen(makeApp(failureRoot, {
    maxFileSize: 1024,
    fakeWorkerDelayMs: 5,
    fakeWorkerFail: true
  }));
  failureBase = `http://127.0.0.1:${failureServer.address().port}`;

  modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-model-'));
  modelStatus = { configured: true, missingVariables: [], provider: 'mock-local' };
  modelServer = await listen(makeApp(modelRoot, {
    maxFileSize: 1024,
    fakeWorkerDelayMs: 5,
    modelConfigStatus: () => modelStatus
  }));
  modelBase = `http://127.0.0.1:${modelServer.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (failureServer) failureServer.close();
  if (modelServer) modelServer.close();
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  if (failureRoot) fs.rmSync(failureRoot, { recursive: true, force: true });
  if (modelRoot) fs.rmSync(modelRoot, { recursive: true, force: true });
});

test('unauthenticated upload is rejected', async () => {
  const result = await postFile('one.png', PNG, 'image/png', 'one.png', null);
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'UNAUTHENTICATED');
});

test('cross-origin state change is rejected', async () => {
  const result = await postFile('one.png', PNG, 'image/png', 'one.png', 'alice', 'http://evil.example');
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'ACCESS_DENIED');
});

test('valid PNG creates a fake job and reaches mock_helpers_ready', async () => {
  const result = await postFile('one.png', PNG, 'image/png', 'one.png');
  assert.equal(result.status, 201);
  assert.equal(result.body.job.isMock, true);
  assert.equal(result.body.job.workerMode, 'fake');
  assert.equal(result.body.job.aiExtractionPerformed, false);
  assert.equal(result.body.job.resultKind, 'synthetic_test_result');
  assert.equal(result.body.job.templateProfileId, 'trade_purchase_cn');

  const job = await waitForStatus(result.body.job.id, 'mock_helpers_ready');
  assert.equal(job.status, 'mock_helpers_ready');
  assert.equal(job.aiExtractionPerformed, false);
  assert.ok(Array.isArray(job.artifacts));
  assert.ok(job.artifacts.every((artifact) => artifact.isMock === true));
  assert.ok(job.artifacts.some((artifact) => artifact.name === 'mock-result.json'));
  assert.ok(job.artifacts.every((artifact) => !/^flowchart\.json$/.test(artifact.name)));
});

test('valid JPEG and WebP are accepted', async () => {
  for (const [name, bytes, type] of [
    ['one.jpg', JPEG, 'image/jpeg'],
    ['one.webp', WEBP, 'image/webp']
  ]) {
    const result = await postFile(name, bytes, type, name);
    assert.equal(result.status, 201, `${name}: ${JSON.stringify(result.body)}`);
  }
});

test('wrong extension, MIME and magic are rejected', async () => {
  const wrongExtension = await postFile('one.txt', PNG, 'image/png', 'one.txt');
  assert.equal(wrongExtension.status, 400);
  assert.equal(wrongExtension.body.code, 'INVALID_FILE_TYPE');

  const wrongMime = await postFile('one.png', PNG, 'image/jpeg', 'one.png');
  assert.equal(wrongMime.status, 400);
  assert.equal(wrongMime.body.code, 'INVALID_FILE_TYPE');

  const wrongMagic = await postFile('one.png', Buffer.from('not an image'), 'image/png', 'one.png');
  assert.equal(wrongMagic.status, 400);
  assert.ok(['INVALID_IMAGE_SIGNATURE', 'IMAGE_DECODE_FAILED'].includes(wrongMagic.body.code));
});

test('oversized upload is rejected', async () => {
  const oversized = Buffer.concat([PNG, Buffer.alloc(2000)]);
  const result = await postFile('big.png', oversized, 'image/png', 'big.png');
  assert.equal(result.status, 413);
  assert.equal(result.body.code, 'FILE_TOO_LARGE');
});

test('undecodable image is rejected', async () => {
  const broken = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16)
  ]);
  const result = await postFile('broken.png', broken, 'image/png', 'broken.png');
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'IMAGE_DECODE_FAILED');
});

test('multiple files are rejected', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'one.png');
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'two.png');
  const response = await fetch(`${base}/api/flowchart-excel/jobs`, {
    method: 'POST',
    headers: { 'x-user': 'alice' },
    body: form
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.ok(['TOO_MANY_FILES', 'UPLOAD_FAILED'].includes(body.code));
});

test('invalid and nonexistent job IDs return 404', async () => {
  const invalid = await getJson('/api/flowchart-excel/jobs/not-a-uuid');
  assert.equal(invalid.status, 404);
  const missing = await getJson('/api/flowchart-excel/jobs/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404);
});

test('owner scoping hides jobs, artifacts and cancel from another user', async () => {
  const uploaded = await postFile('owner.png', PNG, 'image/png', 'owner.png', 'alice');
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.job.id;
  await waitForStatus(id, 'mock_helpers_ready', 3000, 'alice');

  assert.equal((await getJson(`/api/flowchart-excel/jobs/${id}`, 'bob')).status, 404);
  assert.equal((await getJson(`/api/flowchart-excel/jobs/${id}/artifacts`, 'bob')).status, 404);
  assert.equal((await getJson(`/api/flowchart-excel/jobs/${id}/artifacts/mock-result`, 'bob')).status, 404);

  const cancel = await fetch(`${base}/api/flowchart-excel/jobs/${id}/cancel`, {
    method: 'POST',
    headers: { 'x-user': 'bob' }
  });
  assert.equal(cancel.status, 404);
});

test('artifact download is owner-scoped and path is not client-controlled', async () => {
  const uploaded = await postFile('artifact.png', PNG, 'image/png', 'artifact.png');
  const id = uploaded.body.job.id;
  await waitForStatus(id, 'mock_helpers_ready');

  const artifact = await fetch(`${base}/api/flowchart-excel/jobs/${id}/artifacts/mock-result`, {
    headers: { 'x-user': 'alice' }
  });
  assert.equal(artifact.status, 200);
  const content = await artifact.json();
  assert.equal(content.is_mock, true);
  assert.equal(content.worker_mode, 'fake');
  assert.equal(content.ai_extraction_performed, false);

  const traversal = await fetch(`${base}/api/flowchart-excel/jobs/${id}/artifacts/..%2Fmeta.json`, {
    headers: { 'x-user': 'alice' }
  });
  assert.equal(traversal.status, 404);
});

test('cancel works before ready and cannot regress from ready', async () => {
  const uploaded = await postFile('cancel.png', PNG, 'image/png', 'cancel.png');
  const id = uploaded.body.job.id;
  const cancel = await fetch(`${base}/api/flowchart-excel/jobs/${id}/cancel`, {
    method: 'POST',
    headers: { 'x-user': 'alice' }
  });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).job.status, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await getJson(`/api/flowchart-excel/jobs/${id}`)).body.job.status, 'cancelled');

  const ready = await postFile('ready-cancel.png', PNG, 'image/png', 'ready-cancel.png');
  await waitForStatus(ready.body.job.id, 'mock_helpers_ready');
  const tooLate = await fetch(`${base}/api/flowchart-excel/jobs/${ready.body.job.id}/cancel`, {
    method: 'POST',
    headers: { 'x-user': 'alice' }
  });
  assert.equal(tooLate.status, 409);
  assert.equal((await tooLate.json()).code, 'JOB_NOT_CANCELLABLE');
});

test('meta reports model configuration without values', async () => {
  const response = await fetch(`${modelBase}/api/flowchart-excel/meta`, { headers: { 'x-user': 'alice' } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.modelConfiguration.configured, true);
  assert.deepEqual(body.modelConfiguration.missingVariables, []);
  assert.equal(body.templateProfileId, 'trade_purchase_cn');
  assert.equal(body.editAs, 'pending');
  assert.equal(JSON.stringify(body).includes('mock-local'), true);
});

test('real mode requires consent before any job is created', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'real.png');
  form.append('mode', 'real');
  const response = await fetch(`${modelBase}/api/flowchart-excel/jobs`, {
    method: 'POST', headers: { 'x-user': 'alice' }, body: form
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, 'CONSENT_REQUIRED');
});

test('real mode rejects missing model configuration with variable names only', async () => {
  modelStatus = { configured: false, missingVariables: ['FLOWCHART_BASE_URL', 'FLOWCHART_MODEL'], provider: 'mock-local' };
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'real-missing.png');
  form.append('mode', 'real');
  form.append('modelProcessingConsent', 'true');
  const response = await fetch(`${modelBase}/api/flowchart-excel/jobs`, {
    method: 'POST', headers: { 'x-user': 'alice' }, body: form
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'CONFIGURATION_REQUIRED');
  assert.deepEqual(body.missingVariables, ['FLOWCHART_BASE_URL', 'FLOWCHART_MODEL']);
  assert.equal(JSON.stringify(body).includes('secret'), false);
  modelStatus = { configured: true, missingVariables: [], provider: 'mock-local' };
});

test('fake worker failure is reported without leaking paths', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'fail.png');
  const response = await fetch(`${failureBase}/api/flowchart-excel/jobs`, {
    method: 'POST',
    headers: { 'x-user': 'alice' },
    body: form
  });
  const body = await response.json();
  const id = body.job.id;
  const started = Date.now();
  let job = null;
  while (Date.now() - started < 3000) {
    const result = await fetch(`${failureBase}/api/flowchart-excel/jobs/${id}`, {
      headers: { 'x-user': 'alice' }
    });
    job = (await result.json()).job;
    if (job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'WORKER_FAILED');
  assert.equal(JSON.stringify(job).includes(tempRoot), false);
});

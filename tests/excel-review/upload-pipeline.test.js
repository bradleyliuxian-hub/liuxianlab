'use strict';

/*
 * Excel Review - upload pipeline regression tests.
 *
 * Locks the single-file and archive HTTP contracts (and the DB failure code)
 * by mounting the real router with a stubbed repository + runner, so a future
 * change cannot silently break POST /api/excel-reviews again.
 *
 * Key invariant: a .xlsx is itself a ZIP container, so the magic bytes alone
 * never decide archive-vs-workbook. The route + extension do.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));

function installStubs() {
  const state = { created: [], enqueued: [], failCreate: null };
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'excel-review', 'repository.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'excel-review', 'parse-runner.js'));

  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      createJob: async (job) => {
        if (state.failCreate) throw state.failCreate;
        state.created.push(job);
        return Object.assign({ progress: 0, itemCount: null, createdAt: 'now', updatedAt: 'now' }, job);
      },
      listJobsByStatus: async () => [],
      updateJobState: async () => ({}),
      getJobForOwner: async () => null,
      listJobsForOwner: async () => [],
      deleteJobForOwner: async () => false,
      mapJob: (row) => row
    }
  };
  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: { createExcelReviewRunner: () => ({ enqueue: (id) => state.enqueued.push(id), recover() {}, jobDir: (id) => id }) }
  };
  return state;
}

const STUB = installStubs();
const { createExcelReviewRouter } = require(path.join(ROOT, 'server', 'excel-review', 'routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

function makeXlsxBytes() {
  return Buffer.from(fflate.zipSync({ 'xl/workbook.xml': fflate.strToU8('<workbook/>') }));
}

function makeZip(members) {
  const files = {};
  Object.keys(members).forEach((name) => { files[name] = new Uint8Array(members[name]); });
  return Buffer.from(fflate.zipSync(files));
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use((req, _res, next) => { req.session = { auth: { username: 'tester' } }; next(); });
  app.use('/api/excel-reviews', createExcelReviewRouter({ root: ROOT }));
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

test.after(() => { if (server) server.close(); });

async function postFile(urlPath, filename, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await fetch(base + urlPath, { method: 'POST', body: form });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('single .xlsx upload returns 202 with a job id and enqueues it', async () => {
  STUB.failCreate = null;
  const before = STUB.created.length;
  const { status, body } = await postFile('/api/excel-reviews', 'legacy.xlsx', makeXlsxBytes());
  assert.equal(status, 202);
  assert.equal(body.ok, true);
  assert.ok(body.job && body.job.id, 'response exposes job.id');
  assert.equal(body.job.originalFilename, 'legacy.xlsx');
  assert.equal(body.job.status, 'queued');
  assert.equal(STUB.created.length, before + 1);
  assert.ok(STUB.enqueued.includes(body.job.id), 'job was enqueued');
});

test('a .xlsx (which is itself a ZIP) is never treated as an archive', async () => {
  // Same PK bytes: accepted by the workbook route...
  const workbook = makeXlsxBytes();
  const single = await postFile('/api/excel-reviews', 'book.xlsx', workbook);
  assert.equal(single.status, 202);
  // ...and rejected by the archive route purely on extension/type.
  const asArchive = await postFile('/api/excel-reviews/archive', 'book.xlsx', workbook, 'application/zip');
  assert.equal(asArchive.status, 400);
  assert.equal(asArchive.body.code, 'INVALID_FILE_TYPE');
});

test('archive .zip expands into one job per .xlsx member, skipping noise', async () => {
  STUB.failCreate = null;
  const xlsx = makeXlsxBytes();
  const zip = makeZip({
    'A.xlsx': xlsx,
    'folder/B.xlsx': xlsx,
    '__MACOSX/A.xlsx': xlsx,
    '.DS_Store': Buffer.from('junk'),
    'notes.txt': Buffer.from('ignore')
  });
  const before = STUB.created.length;
  const { status, body } = await postFile('/api/excel-reviews/archive', 'pack.zip', zip, 'application/zip');
  assert.equal(status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.jobs.map((j) => j.originalFilename).sort(), ['A.xlsx', 'B.xlsx']);
  assert.equal(STUB.created.length, before + 2);
  body.jobs.forEach((job) => assert.ok(STUB.enqueued.includes(job.id), 'member job enqueued'));
});

test('archive with no .xlsx members is a clear 400 (no jobs)', async () => {
  const zip = makeZip({ 'readme.txt': Buffer.from('hi') });
  const { status, body } = await postFile('/api/excel-reviews/archive', 'empty.zip', zip, 'application/zip');
  assert.equal(status, 400);
  assert.equal(body.code, 'EMPTY_ARCHIVE');
});

test('a database outage surfaces as 503 DB_UNAVAILABLE (not a generic 500)', async () => {
  const outage = new Error('connect ECONNREFUSED 127.0.0.1:5432');
  outage.code = 'ECONNREFUSED';
  STUB.failCreate = outage;
  try {
    const single = await postFile('/api/excel-reviews', 'legacy.xlsx', makeXlsxBytes());
    assert.equal(single.status, 503);
    assert.equal(single.body.code, 'DB_UNAVAILABLE');

    const zip = await postFile('/api/excel-reviews/archive', 'pack.zip', makeZip({ 'A.xlsx': makeXlsxBytes() }), 'application/zip');
    assert.equal(zip.status, 503);
    assert.equal(zip.body.code, 'DB_UNAVAILABLE');
  } finally {
    STUB.failCreate = null;
  }
});

test('archive isolates a per-member failure from the rest', async () => {
  // First member fails at the DB step, second succeeds.
  let call = 0;
  const original = STUB.failCreate;
  STUB.failCreate = null;
  const realCreate = STUB.created;
  void realCreate;
  const failOnce = new Error('connect ECONNREFUSED');
  failOnce.code = 'ECONNREFUSED';
  // monkeypatch via the stub object used by the router
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'excel-review', 'repository.js'));
  const repo = require.cache[repositoryPath].exports;
  const originalCreate = repo.createJob;
  repo.createJob = async (job) => {
    call += 1;
    if (call === 1) throw failOnce;
    return originalCreate(job);
  };
  try {
    const xlsx = makeXlsxBytes();
    const { status, body } = await postFile('/api/excel-reviews/archive', 'pack.zip', makeZip({ 'A.xlsx': xlsx, 'B.xlsx': xlsx }), 'application/zip');
    assert.equal(status, 202);
    assert.equal(body.count, 1, 'one member saved');
    assert.equal(body.failures.length, 1, 'one member reported failed');
    assert.equal(body.failures[0].code, 'DB_UNAVAILABLE');
  } finally {
    repo.createJob = originalCreate;
    STUB.failCreate = original;
  }
});

test('a UTF-8 filename survives the upload as correct text (no mojibake)', async () => {
  STUB.failCreate = null;
  const name = '【NEW】 财务复核测试.xlsx';
  const { status, body } = await postFile('/api/excel-reviews', name, makeXlsxBytes());
  assert.equal(status, 202);
  assert.equal(body.job.originalFilename, name, 'multipart filename decoded as UTF-8');
  const stored = STUB.created.find((job) => job.id === body.job.id);
  assert.ok(stored, 'job recorded');
  assert.equal(stored.originalFilename, name, 'DB-bound filename is correct UTF-8');
});

test('filename matrix: all names round-trip without mojibake', async () => {
  STUB.failCreate = null;
  const names = [
    '23-26331 Spreadsheet_Vision Star.xlsx',
    '【NEW】 测试文件.xlsx',
    '财务复核测试.xlsx',
    'Project [Final].xlsx',
    "Manager's Review.xlsx",
    '测试 & Review.xlsx',
    '日本語テスト.xlsx',
    'Résumé.xlsx',
    'emoji-✅-review.xlsx',
    '空格 文件 名.xlsx'
  ];
  for (const name of names) {
    const { status, body } = await postFile('/api/excel-reviews', name, makeXlsxBytes());
    assert.equal(status, 202, name);
    assert.equal(body.job.originalFilename, name, name);
  }
});

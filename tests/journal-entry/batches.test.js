'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-batches-'));
const state = {
  batches: new Map(),
  items: [],
  jobs: new Map(),
  enqueued: [],
  outputs: new Map()
};

const realBatchRepository = require(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));

function summarize(batchId) {
  const batch = state.batches.get(batchId);
  if (!batch) return null;
  const items = state.items
    .filter((item) => item.batchId === batchId)
    .sort((a, b) => a.position - b.position);
  const jobs = items.map((item) => state.jobs.get(item.jobId)).filter(Boolean);
  const count = (status) => jobs.filter((job) => job.status === status).length;
  const counts = {
    totalCount: jobs.length,
    draftCount: count('draft'),
    queuedCount: count('queued'),
    runningCount: count('running'),
    completedCount: count('completed'),
    failedCount: count('failed')
  };
  const progress = jobs.length
    ? Math.round(jobs.reduce((sum, job) => sum + Number(job.progress || 0), 0) / jobs.length)
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

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
  const batchRepositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));
  const outputRepositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-output-repository.js'));
  const splitRepositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'split-repository.js'));
  const previewPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'preview-runner.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'parse-runner.js'));

  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      async createJob(job) {
        const now = '2026-01-01T00:00:00.000Z';
        const row = { ...job, createdAt: now, updatedAt: now };
        state.jobs.set(job.id, row);
        return row;
      },
      async getJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        return job && job.ownerUsername === owner ? job : null;
      },
      async listJobsForOwner(owner) {
        return [...state.jobs.values()].filter((job) => job.ownerUsername === owner);
      },
      async listJobsByStatus() { return []; },
      async listExpiredJobs() { return []; },
      async claimJob() { return null; },
      async updateJobState(id, patch) {
        const job = state.jobs.get(id);
        if (!job) return null;
        const next = { ...job, ...patch, updatedAt: '2026-01-01T00:00:01.000Z' };
        state.jobs.set(id, next);
        return next;
      },
      async deleteJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        if (!job || job.ownerUsername !== owner) return false;
        return state.jobs.delete(id);
      },
      async deleteJobById(id) { return state.jobs.delete(id); }
    }
  };

  require.cache[batchRepositoryPath] = {
    id: batchRepositoryPath, filename: batchRepositoryPath, loaded: true,
    exports: {
      ...realBatchRepository,
      async createBatch({ id, ownerUsername, name }) {
        const row = {
          id,
          ownerUsername,
          name,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        };
        state.batches.set(id, row);
        return row;
      },
      async addItem({ batchId, jobId, position, originalFilename, fileSize }) {
        state.items.push({ batchId, jobId, position, originalFilename, fileSize });
      },
      async getBatchSummaryForOwner(batchId, owner) {
        const batch = state.batches.get(batchId);
        if (batch?.deletedAt) return null;
        const summary = summarize(batchId);
        return summary && summary.ownerUsername === owner ? summary : null;
      },
      async listBatchesForOwner(owner) {
        return [...state.batches.keys()]
          .map(summarize)
          .filter((batch) => batch && batch.ownerUsername === owner && !state.batches.get(batch.id)?.deletedAt);
      },
      async getBatchDetailForOwner(batchId, owner) {
        if (state.batches.get(batchId)?.deletedAt) return null;
        const summary = summarize(batchId);
        if (!summary || summary.ownerUsername !== owner) return null;
        return {
          ...summary,
          items: state.items
            .filter((item) => item.batchId === batchId)
            .sort((a, b) => a.position - b.position)
            .map((item) => ({
              position: item.position,
              originalFilename: item.originalFilename,
              fileSize: item.fileSize || 0,
              job: state.jobs.get(item.jobId)
            }))
        };
      },
      async touchBatch(batchId) {
        const batch = state.batches.get(batchId);
        if (batch) batch.updatedAt = '2026-01-01T00:00:02.000Z';
      },
      async softDeleteBatch(batchId) {
        const batch = state.batches.get(batchId);
        if (batch) batch.deletedAt = '2026-01-01T00:00:03.000Z';
        return Boolean(batch);
      },
      async deleteItemsForBatch(batchId) {
        state.items = state.items.filter((item) => item.batchId !== batchId);
      },
      async deleteItemsForJob(jobId) {
        state.items = state.items.filter((item) => item.jobId !== jobId);
      },
      async listEmptyBatches() { return []; },
      async listDeletedBatches() { return []; },
      async listAllBatchIds() { return [...state.batches.keys()]; },
      async deleteBatch(batchId) {
        state.items = state.items.filter((item) => item.batchId !== batchId);
        return state.batches.delete(batchId);
      }
    }
  };

  require.cache[outputRepositoryPath] = {
    id: outputRepositoryPath, filename: outputRepositoryPath, loaded: true,
    exports: {
      async createOutput({ id, batchId, ownerUsername, snapshot }) {
        const row = {
          id, batchId, ownerUsername, status: 'generating', snapshot,
          summaryPath: null, mergedPath: null, zipPath: null, error: null,
          createdAt: '2026-01-01T00:00:00.000Z', completedAt: null
        };
        state.outputs.set(id, row);
        return row;
      },
      async markCompleted(id, { summaryPath, mergedPath, zipPath, snapshot }) {
        const row = state.outputs.get(id);
        Object.assign(row, {
          status: 'completed', summaryPath, mergedPath, zipPath,
          snapshot: snapshot || row.snapshot,
          error: null, completedAt: '2026-01-01T00:00:01.000Z'
        });
        return row;
      },
      async markFailed(id, error) {
        const row = state.outputs.get(id);
        Object.assign(row, {
          status: 'failed', error: String(error), completedAt: '2026-01-01T00:00:01.000Z'
        });
        return row;
      },
      async expireOutput(id) {
        const row = state.outputs.get(id);
        if (!row) return null;
        Object.assign(row, {
          expiredAt: '2026-01-01T00:00:04.000Z',
          summaryPath: null, mergedPath: null, zipPath: null
        });
        return row;
      },
      async listExpiredOutputs() { return []; },
      async listForBatch(batchId) {
        return [...state.outputs.values()].filter((row) => row.batchId === batchId);
      },
      async listAllOutputIds() {
        return [...state.outputs.values()].map((row) => ({ id: row.id, batchId: row.batchId }));
      },
      async getLatestForOwner(batchId, owner) {
        return [...state.outputs.values()]
          .filter((row) => row.batchId === batchId && row.ownerUsername === owner)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      },
      async getForOwner(id, batchId, owner) {
        const row = state.outputs.get(id);
        return row && row.batchId === batchId && row.ownerUsername === owner ? row : null;
      }
    }
  };

  require.cache[splitRepositoryPath] = {
    id: splitRepositoryPath, filename: splitRepositoryPath, loaded: true,
    exports: {
      async listByScope() { return []; },
      async expireOutput() { return null; }
    }
  };

  require.cache[previewPath] = {
    id: previewPath, filename: previewPath, loaded: true,
    exports: {
      createPreviewRunner: () => ({
        async run({ mode }) {
          if (mode === 'inspect') {
            return {
              ok: true,
              selectedSheet: '序时账',
              headerRow: 1,
              amountLayout: { layout: 'debit_credit' }
            };
          }
          return { ok: true, canStart: true, mapping: { amount_layout: { layout: 'debit_credit' } } };
        }
      })
    }
  };

  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      createJournalEntryRunner: () => ({
        enqueue(id) { state.enqueued.push(id); },
        jobDir(id) { return path.join(tempRoot, 'storage', 'journal-entry', id); },
        maxConcurrent: 1,
        retentionHours: 72
      })
    }
  };
}

installStubs();

const { createJournalEntryBatchRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'batch-routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

function makeXlsxBytes() {
  return Buffer.from(fflate.zipSync({ 'xl/workbook.xml': fflate.strToU8('<workbook/>') }));
}

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/journal-entry-batches', createJournalEntryBatchRouter({
    root: tempRoot,
    requireAuth: (_req, _res, next) => next(),
    outputRunner: async ({ outputDir }) => {
      for (const name of [
        'batch-summary.xlsx',
        'merged-standardized-journal.xlsx',
        'manifest.json',
        'batch-report.zip'
      ]) {
        fs.writeFileSync(path.join(outputDir, name), `${name}
`);
      }
      return { ok: true };
    }
  }));
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

async function postBatch(files, user = 'tester') {
  const form = new FormData();
  files.forEach((file) => {
    form.append('files', new Blob([file.bytes], { type: 'application/octet-stream' }), file.name);
  });
  const response = await fetch(`${base}/api/journal-entry-batches`, {
    method: 'POST',
    headers: { 'x-user': user },
    body: form
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getBatch(id, user = 'tester') {
  const response = await fetch(`${base}/api/journal-entry-batches/${id}`, {
    headers: { 'x-user': user }
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function startBatch(id, user = 'tester') {
  const response = await fetch(`${base}/api/journal-entry-batches/${id}/start`, {
    method: 'POST',
    headers: { 'x-user': user, 'Content-Type': 'application/json' },
    body: '{}'
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('meta exposes batch limits', async () => {
  const response = await fetch(`${base}/api/journal-entry-batches/meta`, {
    headers: { 'x-user': 'tester' }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.maxFiles, 20);
  assert.equal(body.maxFileSizeBytes, 25 * 1024 * 1024);
  assert.equal(body.maxTotalSizeBytes, 100 * 1024 * 1024);
});

test('upload creates one batch with draft child jobs', async () => {
  const { status, body } = await postBatch([
    { name: '银行 序时账.xlsx', bytes: makeXlsxBytes() },
    { name: '银行 序时账.xlsx', bytes: makeXlsxBytes() }
  ]);
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.batch.totalCount, 2);
  assert.equal(body.batch.draftCount, 2);
  assert.equal(body.batch.status, 'draft');
  assert.equal(body.batch.items.length, 2);
  assert.deepEqual(body.batch.items.map((item) => item.position), [0, 1]);
  assert.equal(body.batch.items[0].originalFilename, '银行 序时账.xlsx');
  assert.equal(body.batch.items[0].job.status, 'draft');
  assert.equal(body.batch.items[0].job.sheetName, '序时账');
  assert.equal(body.batch.items[0].job.headerRow, 1);
  assert.equal(body.batch.items[0].job.amountLayout, 'debit_credit');
});

test('one invalid file rejects the whole batch before creating a row', async () => {
  const before = state.batches.size;
  const { status, body } = await postBatch([
    { name: 'good.xlsx', bytes: makeXlsxBytes() },
    { name: 'bad.xlsx', bytes: Buffer.from('not an excel file') }
  ]);
  assert.equal(status, 400);
  assert.equal(body.files.length, 1);
  assert.equal(body.files[0].filename, 'bad.xlsx');
  assert.equal(state.batches.size, before);
});

test('more than 20 files is rejected', async () => {
  const files = Array.from({ length: 21 }, (_, index) => ({
    name: `file-${index}.xlsx`,
    bytes: makeXlsxBytes()
  }));
  const { status } = await postBatch(files);
  assert.equal(status, 400);
});

test('start refuses unconfigured children and starts nothing', async () => {
  const uploaded = await postBatch([{ name: 'unconfigured.xlsx', bytes: makeXlsxBytes() }]);
  const id = uploaded.body.batch.id;
  const { status, body } = await startBatch(id);
  assert.equal(status, 422);
  assert.match(body.error, /没有可启动的文件/);
  assert.equal(body.startedCount, 0);
  assert.equal(body.skippedCount, 1);
  assert.match(body.notReady[0].reason, /字段映射/);
  const detail = await getBatch(id);
  assert.equal(detail.body.batch.draftCount, 1);
  assert.equal(detail.body.batch.queuedCount, 0);
  assert.equal(state.enqueued.length, 0);
});

test('configured children are queued together and status is derived', async () => {
  const uploaded = await postBatch([
    { name: 'configured-a.xlsx', bytes: makeXlsxBytes() },
    { name: 'configured-b.xlsx', bytes: makeXlsxBytes() }
  ]);
  const id = uploaded.body.batch.id;
  const jobs = uploaded.body.batch.items.map((item) => item.job);
  for (const job of jobs) {
    await state.jobs.set(job.id, {
      ...state.jobs.get(job.id),
      requestJson: {
        sheetName: '序时账',
        headerRow: 1,
        amountLayout: 'debit_credit',
        mapping: { date: 1, voucher_id: 2, debit: 3, credit: 4 }
      }
    });
  }

  const started = await startBatch(id);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.startedCount, 2);
  assert.equal(started.body.skippedCount, 0);
  assert.equal(started.body.batch.queuedCount, 2);
  assert.equal(started.body.batch.status, 'queued');
  assert.deepEqual(state.enqueued.sort(), jobs.map((job) => job.id).sort());

  for (const job of jobs) {
    await state.jobs.set(job.id, {
      ...state.jobs.get(job.id),
      status: 'completed',
      progress: 100,
      summaryJson: {
        raw_row_count: 10,
        line_count: 12,
        voucher_count: 5,
        issue_count: 0,
        unbalanced_voucher_count: 0,
        business_classified_count: 4,
        business_voucher_count: 5,
        finding_count: 2,
        finding_voucher_count: 1
      }
    });
  }
  const completed = await getBatch(id);
  assert.equal(completed.body.batch.status, 'completed');
  assert.equal(completed.body.batch.completedCount, 2);
  assert.equal(completed.body.batch.progress, 100);
  assert.equal(completed.body.batch.summary.completedFileCount, 2);
  assert.equal(completed.body.batch.summary.voucherCount, 10);
  assert.equal(completed.body.batch.summary.businessCoverage, '0.800000');
  assert.equal(completed.body.batch.summary.reviewRate, '0.200000');
});

test('start-ready queues only configured ready drafts and leaves others draft', async () => {
  state.enqueued.length = 0;
  const uploaded = await postBatch([
    { name: 'ready-a.xlsx', bytes: makeXlsxBytes() },
    { name: 'ready-b.xlsx', bytes: makeXlsxBytes() },
    { name: 'ready-c.xlsx', bytes: makeXlsxBytes() },
    { name: 'pending-d.xlsx', bytes: makeXlsxBytes() }
  ]);
  const id = uploaded.body.batch.id;
  const jobs = uploaded.body.batch.items.map((item) => item.job);
  for (const job of jobs.slice(0, 3)) {
    await state.jobs.set(job.id, {
      ...state.jobs.get(job.id),
      requestJson: {
        sheetName: '序时账', headerRow: 1, amountLayout: 'debit_credit',
        mapping: { date: 1, voucher_id: 2, debit: 3, credit: 4 }
      }
    });
  }
  const started = await startBatch(id);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.startedCount, 3);
  assert.equal(started.body.skippedCount, 1);
  assert.equal(started.body.notReady[0].jobId, jobs[3].id);
  assert.match(started.body.notReady[0].reason, /字段映射/);
  const detail = await getBatch(id);
  assert.equal(detail.body.batch.queuedCount, 3);
  assert.equal(detail.body.batch.draftCount, 1);
  assert.equal(detail.body.batch.status, 'queued');
  assert.deepEqual(state.enqueued.sort(), jobs.slice(0, 3).map((job) => job.id).sort());
});

test('start-ready does not requeue completed or running jobs', async () => {
  state.enqueued.length = 0;
  const uploaded = await postBatch([
    { name: 'done.xlsx', bytes: makeXlsxBytes() },
    { name: 'active.xlsx', bytes: makeXlsxBytes() },
    { name: 'ready-1.xlsx', bytes: makeXlsxBytes() },
    { name: 'ready-2.xlsx', bytes: makeXlsxBytes() },
    { name: 'draft.xlsx', bytes: makeXlsxBytes() }
  ]);
  const id = uploaded.body.batch.id;
  const jobs = uploaded.body.batch.items.map((item) => item.job);
  const configured = (idValue) => ({
    sheetName: '序时账', headerRow: 1, amountLayout: 'debit_credit',
    mapping: { date: 1, voucher_id: 2, debit: 3, credit: 4 }
  });
  await state.jobs.set(jobs[0].id, {
    ...state.jobs.get(jobs[0].id), status: 'completed', progress: 100,
    requestJson: configured()
  });
  await state.jobs.set(jobs[1].id, {
    ...state.jobs.get(jobs[1].id), status: 'running', progress: 20,
    requestJson: configured()
  });
  await state.jobs.set(jobs[2].id, { ...state.jobs.get(jobs[2].id), requestJson: configured() });
  await state.jobs.set(jobs[3].id, { ...state.jobs.get(jobs[3].id), requestJson: configured() });
  // jobs[4] remains an unconfigured draft.

  const started = await startBatch(id);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.startedCount, 2);
  assert.equal(started.body.skippedCount, 1);
  assert.deepEqual(
    state.enqueued.sort(),
    [jobs[2].id, jobs[3].id].sort()
  );
  const detail = await getBatch(id);
  assert.equal(detail.body.batch.completedCount, 1);
  assert.equal(detail.body.batch.runningCount, 1);
  assert.equal(detail.body.batch.queuedCount, 2);
  assert.equal(detail.body.batch.draftCount, 1);
  assert.equal(detail.body.batch.status, 'running');
});

test('batch summary aggregates completed children only and uses weighted rates', async () => {
  const { aggregateCompletedSummaries } = require(path.join(ROOT, 'server', 'journal-entry', 'batch-summary.js'));
  const jobs = [
    {
      status: 'completed',
      summaryJson: {
        raw_row_count: 100, line_count: 120, voucher_count: 10, issue_count: 1,
        unbalanced_voucher_count: 0, business_classified_count: 5,
        business_voucher_count: 10, finding_count: 3, finding_voucher_count: 2
      }
    },
    {
      status: 'completed',
      summaryJson: {
        raw_row_count: 900, line_count: 1000, voucher_count: 90, issue_count: 2,
        unbalanced_voucher_count: 1, business_classified_count: 81,
        business_voucher_count: 90, finding_count: 12, finding_voucher_count: 9
      }
    },
    {
      status: 'draft',
      summaryJson: {
        voucher_count: 10000, business_classified_count: 10000,
        finding_voucher_count: 10000
      }
    },
    { status: 'failed', summaryJson: { voucher_count: 10000, finding_voucher_count: 10000 } }
  ];
  const summary = aggregateCompletedSummaries(jobs, { totalFileCount: 4 });
  assert.equal(summary.completedFileCount, 2);
  assert.equal(summary.totalFileCount, 4);
  assert.equal(summary.voucherCount, 100);
  assert.equal(summary.lineCount, 1120);
  assert.equal(summary.rawRowCount, 1000);
  assert.equal(summary.businessClassifiedCount, 86);
  assert.equal(summary.findingCount, 15);
  assert.equal(summary.findingVoucherCount, 11);
  assert.equal(summary.businessCoverage, '0.860000');
  assert.equal(summary.reviewRate, '0.110000');
});


async function completeJob(job, summary) {
  const jobDir = path.join(tempRoot, 'storage', 'journal-entry', job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  const result = {
    schema_version: 1,
    generated_at: '2026-01-01T00:00:00.000Z',
    vouchers: [],
    cleaning_summary: {
      raw_row_count: 1, line_count: 1, issue_count: 0, unbalanced_voucher_count: 0
    },
    business_classification_summary: {
      business_counts: {}, business_labels: {}
    },
    findings: []
  };
  fs.writeFileSync(path.join(jobDir, 'result.json'), JSON.stringify(result));
  fs.writeFileSync(path.join(jobDir, 'journal-entry-analysis-report.xlsx'), 'fake-xlsx');
  const next = {
    ...state.jobs.get(job.id),
    status: 'completed',
    progress: 100,
    resultPath: `storage/journal-entry/${job.id}/result.json`,
    exportPath: `storage/journal-entry/${job.id}/journal-entry-analysis-report.xlsx`,
    summaryJson: summary || {
      raw_row_count: 1, line_count: 1, voucher_count: 1, issue_count: 0,
      unbalanced_voucher_count: 0, business_classified_count: 1,
      business_voucher_count: 1, finding_count: 0, finding_voucher_count: 0
    }
  };
  state.jobs.set(job.id, next);
  return next;
}

async function waitForBatchOutput(id, outputId, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const latest = await fetch(`${base}/api/journal-entry-batches/${id}/exports/latest`, {
      headers: { 'x-user': 'tester' }
    });
    const payload = await latest.json();
    const output = payload.output;
    if (output && output.id === outputId && output.status !== 'generating') return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('batch output did not finish');
}

async function createExport(id, user = 'tester') {
  const response = await fetch(`${base}/api/journal-entry-batches/${id}/exports`, {
    method: 'POST',
    headers: { 'x-user': user, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 202 && body.output) {
    const output = await waitForBatchOutput(id, body.output.id);
    return { status: response.status, body: { output } };
  }
  return { status: response.status, body };
}

test('batch is owner scoped and listed in history', async () => {
  const uploaded = await postBatch([{ name: 'owner-batch.xlsx', bytes: makeXlsxBytes() }]);
  const id = uploaded.body.batch.id;
  const hidden = await getBatch(id, 'someone-else');
  assert.equal(hidden.status, 404);
  const list = await fetch(`${base}/api/journal-entry-batches`, {
    headers: { 'x-user': 'tester' }
  });
  const body = await list.json();
  assert.equal(list.status, 200);
  assert.ok(body.batches.some((batch) => batch.id === id));
});


test('export creates a completed-only snapshot and supports refresh/download', async () => {
  const uploaded = await postBatch([
    { name: 'export-a.xlsx', bytes: makeXlsxBytes() },
    { name: 'export-b.xlsx', bytes: makeXlsxBytes() },
    { name: 'export-draft.xlsx', bytes: makeXlsxBytes() }
  ]);
  const id = uploaded.body.batch.id;
  const jobs = uploaded.body.batch.items.map((item) => item.job);
  await completeJob(jobs[0]);
  await completeJob(jobs[1]);

  const exported = await createExport(id);
  assert.equal(exported.status, 202, JSON.stringify(exported.body));
  assert.equal(exported.body.output.status, 'completed');
  assert.equal(exported.body.output.snapshot.included_files, 2);
  assert.equal(exported.body.output.snapshot.excluded_files, 1);
  assert.equal(exported.body.output.snapshot.excluded_draft, 1);
  assert.deepEqual(exported.body.output.snapshot.included_job_ids.sort(), [jobs[0].id, jobs[1].id].sort());
  assert.ok(exported.body.output.downloads.summary);
  assert.ok(exported.body.output.downloads.merged);
  assert.ok(exported.body.output.downloads.zip);

  const latest = await fetch(`${base}/api/journal-entry-batches/${id}/exports/latest`, {
    headers: { 'x-user': 'tester' }
  });
  const latestBody = await latest.json();
  assert.equal(latest.status, 200);
  assert.equal(latestBody.output.id, exported.body.output.id);

  const summary = await fetch(`${base}${exported.body.output.downloads.summary}`, {
    headers: { 'x-user': 'tester' }
  });
  assert.equal(summary.status, 200);
  assert.match(await summary.text(), /batch-summary\.xlsx/);

  const hidden = await fetch(`${base}/api/journal-entry-batches/${id}/exports/latest`, {
    headers: { 'x-user': 'someone-else' }
  });
  assert.equal(hidden.status, 404);
  const hiddenDownload = await fetch(`${base}${exported.body.output.downloads.zip}`, {
    headers: { 'x-user': 'someone-else' }
  });
  assert.equal(hiddenDownload.status, 404);
});

test('export without completed children returns 422', async () => {
  const uploaded = await postBatch([{ name: 'no-completed.xlsx', bytes: makeXlsxBytes() }]);
  const id = uploaded.body.batch.id;
  const exported = await createExport(id);
  assert.equal(exported.status, 422);
  assert.match(exported.body.error, /没有已完成文件/);
});

test('soft-deleted batch cannot export or download latest output', async () => {
  const uploaded = await postBatch([{ name: 'deleted-export.xlsx', bytes: makeXlsxBytes() }]);
  const id = uploaded.body.batch.id;
  const job = uploaded.body.batch.items[0].job;
  await completeJob(job);
  const exported = await createExport(id);
  assert.equal(exported.status, 202);
  state.batches.get(id).deletedAt = '2026-01-01T00:00:00.000Z';
  const latest = await fetch(`${base}/api/journal-entry-batches/${id}/exports/latest`, {
    headers: { 'x-user': 'tester' }
  });
  assert.equal(latest.status, 404);
  const download = await fetch(`${base}${exported.body.output.downloads.summary}`, {
    headers: { 'x-user': 'tester' }
  });
  assert.equal(download.status, 404);
});


test('batch delete refuses active children and preserves child jobs when inactive', async () => {
  const active = await postBatch([{ name: 'active-batch.xlsx', bytes: makeXlsxBytes() }]);
  const activeId = active.body.batch.id;
  const activeJob = active.body.batch.items[0].job;
  state.jobs.set(activeJob.id, { ...state.jobs.get(activeJob.id), status: 'running' });
  const blocked = await fetch(`${base}/api/journal-entry-batches/${activeId}`, {
    method: 'DELETE',
    headers: { 'x-user': 'tester' }
  });
  assert.equal(blocked.status, 409);

  const uploaded = await postBatch([
    { name: 'delete-a.xlsx', bytes: makeXlsxBytes() },
    { name: 'delete-b.xlsx', bytes: makeXlsxBytes() }
  ]);
  const id = uploaded.body.batch.id;
  const jobs = uploaded.body.batch.items.map((item) => item.job);
  await completeJob(jobs[0]);
  await completeJob(jobs[1]);
  const exported = await createExport(id);
  assert.equal(exported.status, 202);
  const outputId = exported.body.output.id;
  const deleted = await fetch(`${base}/api/journal-entry-batches/${id}`, {
    method: 'DELETE',
    headers: { 'x-user': 'tester' }
  });
  assert.equal(deleted.status, 200);
  const hidden = await getBatch(id);
  assert.equal(hidden.status, 404);
  assert.ok(state.jobs.has(jobs[0].id));
  assert.ok(state.jobs.has(jobs[1].id));
  assert.equal(state.items.filter((item) => item.batchId === id).length, 0);
  assert.ok(state.outputs.get(outputId).expiredAt);
});

test('batch output delete expires metadata and blocks download', async () => {
  const uploaded = await postBatch([{ name: 'output-delete.xlsx', bytes: makeXlsxBytes() }]);
  const id = uploaded.body.batch.id;
  await completeJob(uploaded.body.batch.items[0].job);
  const exported = await createExport(id);
  const outputId = exported.body.output.id;
  const response = await fetch(
    `${base}/api/journal-entry-batches/${id}/exports/${outputId}`,
    { method: 'DELETE', headers: { 'x-user': 'tester' } }
  );
  assert.equal(response.status, 200);
  assert.ok(state.outputs.get(outputId).expiredAt);
  const latest = await fetch(`${base}/api/journal-entry-batches/${id}/exports/latest`, {
    headers: { 'x-user': 'tester' }
  });
  const body = await latest.json();
  assert.equal(body.output.expired, true);
  assert.equal(body.output.downloads, null);
  const download = await fetch(
    `${base}/api/journal-entry-batches/${id}/exports/${outputId}/summary`,
    { headers: { 'x-user': 'tester' } }
  );
  assert.equal(download.status, 410);
});

test('batch status derivation covers draft, queued, running, completed and partial failure', () => {
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, draftCount: 2 }), 'draft');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, queuedCount: 2 }), 'queued');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, runningCount: 1, queuedCount: 1 }), 'running');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, completedCount: 2 }), 'completed');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, completedCount: 1, failedCount: 1 }), 'partial_failed');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, failedCount: 2 }), 'failed');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 2, completedCount: 1, draftCount: 1 }), 'draft');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 3, completedCount: 1, failedCount: 1, draftCount: 1 }), 'draft');
  assert.equal(realBatchRepository.deriveBatchStatus({ totalCount: 3, completedCount: 1, runningCount: 1, draftCount: 1 }), 'running');
});

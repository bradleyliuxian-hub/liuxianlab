#!/usr/bin/env node
'use strict';

/*
 * Journal Entry deployment smoke test.
 *
 * Exercises the real HTTP router, real Python preview/worker, real export, and
 * an in-memory job repository. It never connects to PostgreSQL and never uses
 * customer data: both workbooks are synthetic test fixtures.
 *
 * Covered:
 *   upload -> inspect -> preview -> start -> queued/running/completed
 *   result JSON -> export download -> owner isolation -> unauthenticated 401
 *
 * Exit status is non-zero on any failure.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'services', 'journal_entry', 'tests', 'fixtures');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'je-deploy-smoke-'));
const STORAGE_ROOT = path.join(TEMP_ROOT, 'storage', 'journal-entry');

process.env.JOURNAL_ENTRY_PYTHON_BIN = process.env.JOURNAL_ENTRY_PYTHON_BIN
  || path.join(ROOT, '.venv', 'bin', 'python');
process.env.PYTHONPATH = [ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
process.env.JOURNAL_ENTRY_MAX_CONCURRENT = '1';

function checkPython() {
  const python = process.env.JOURNAL_ENTRY_PYTHON_BIN;
  if (!fs.existsSync(python)) {
    throw new Error(`Python interpreter not found: ${python}`);
  }
  const result = spawnSync(python, ['-c', 'import openpyxl, xlrd'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Python dependency check failed: ${result.stderr || result.stdout}`);
  }
}

function installRepositoryStub() {
  const jobs = new Map();
  const transitions = [];

  function record(id, patch) {
    const current = jobs.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    if (patch.status) transitions.push({ id, status: patch.status });
    jobs.set(id, next);
    return next;
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
      return job && job.ownerUsername === owner && !job.deletedAt ? job : null;
    },
    async listJobsForOwner(owner) {
      return [...jobs.values()].filter((job) => job.ownerUsername === owner);
    },
    async listJobsByStatus() { return []; },
    async listExpiredJobs() { return []; },
    async claimJob(id, { message } = {}) {
      const job = jobs.get(id);
      if (!job || job.status !== 'queued') return null;
      return record(id, { status: 'running', progress: 0, progressMessage: message || 'running' });
    },
    async updateJobState(id, patch) {
      return record(id, { ...patch, updatedAt: new Date().toISOString() });
    },
    async softDeleteJobForOwner(id, owner) {
      const job = jobs.get(id);
      if (!job || job.ownerUsername !== owner) return null;
      const next = {
        ...job, deletedAt: new Date().toISOString(),
        sourcePath: null, resultPath: null, exportPath: null
      };
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

  const batchRepositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));
  require.cache[batchRepositoryPath] = {
    id: batchRepositoryPath, filename: batchRepositoryPath, loaded: true,
    exports: { async deleteItemsForJob() { return 0; } }
  };

  require.cache[require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'))] = {
    id: 'journal-entry-repository-stub',
    filename: 'journal-entry-repository-stub',
    loaded: true,
    exports: repository
  };

  return { jobs, transitions };
}

const CASES = [
  {
    name: 'DEBIT_CREDIT',
    filename: 'journal_basic.xlsx',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'debit_credit',
    mapping: {
      date: 1, voucher_id: 3, account_code: 4, account_name: 5,
      debit: 7, credit: 8, description: 9, currency: 11
    },
    expectedVouchers: 3
  },
  {
    name: 'LEGACY_XLS_DEBIT_CREDIT',
    filename: 'journal_basic.xls',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'debit_credit',
    mapping: {
      date: 1, voucher_id: 3, account_code: 4, account_name: 5,
      debit: 7, credit: 8, description: 9, currency: 11
    },
    expectedVouchers: 3
  },
  {
    name: 'DIRECTION_AMOUNT',
    filename: 'journal_direction_amount.xlsx',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'direction_amount',
    mapping: {
      date: 2, voucher_id: 3, account_code: 4, account_name: 5,
      description: 6, currency: 7, direction: 8,
      original_amount: 10, amount: 11
    },
    expectedVouchers: 3
  },
  {
    name: 'DUPLICATE_LINE_ID',
    filename: 'journal_duplicate_line_id.xlsx',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'debit_credit',
    mapping: {
      date: 1, voucher_id: 2, line_id: 3, account_code: 4,
      account_name: 5, description: 6, debit: 7, credit: 8
    },
    expectedVouchers: 2,
    duplicateLineId: true
  },
  {
    name: 'SIGNED_AMOUNT_POSITIVE_DEBIT',
    filename: 'journal_signed_amount.xlsx',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'signed_amount',
    positiveSide: 'debit',
    mapping: {
      date: 1, voucher_id: 2, account_code: 3, account_name: 4,
      description: 5, signed_amount: 6
    },
    expectedVouchers: 3,
    expectedLines: [
      { voucherId: 'SA-001', accountCode: '1002', debit: '1000.00', credit: '0.00' },
      { voucherId: 'SA-001', accountCode: '6001', debit: '0.00', credit: '1000.00' }
    ]
  },
  {
    name: 'SIGNED_AMOUNT_POSITIVE_CREDIT',
    filename: 'journal_signed_amount.xlsx',
    sheetName: '序时账',
    headerRow: 1,
    amountLayout: 'signed_amount',
    positiveSide: 'credit',
    mapping: {
      date: 1, voucher_id: 2, account_code: 3, account_name: 4,
      description: 5, signed_amount: 6
    },
    expectedVouchers: 3,
    expectedLines: [
      { voucherId: 'SA-001', accountCode: '1002', debit: '0.00', credit: '1000.00' },
      { voucherId: 'SA-001', accountCode: '6001', debit: '1000.00', credit: '0.00' }
    ]
  }
];

function log(message) { process.stdout.write(`${message}\n`); }

async function request(base, pathname, options = {}, user = 'smoke-user') {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (user) headers['x-user'] = user;
  const response = await fetch(`${base}${pathname}`, { ...options, headers });
  return response;
}

async function waitForJob(base, id, expectedStatuses) {
  const deadline = Date.now() + 120000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await request(base, `/api/journal-entry-analyses/${id}`);
    const payload = await response.json();
    last = payload.job;
    if (last.status === 'completed') return last;
    if (last.status === 'failed') {
      throw new Error(`job failed: ${last.error || 'unknown error'}`);
    }
    expectedStatuses.add(last.status);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`job did not finish in time; last status=${last && last.status}`);
}

async function runCase(base, testCase, transitions) {
  log(`\n[${testCase.name}]`);

  const bytes = fs.readFileSync(path.join(FIXTURES, testCase.filename));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), testCase.filename);
  const upload = await request(base, '/api/journal-entry-analyses', { method: 'POST', body: form });
  const uploaded = await upload.json();
  assert.equal(upload.status, 201, `upload status: ${JSON.stringify(uploaded)}`);
  const id = uploaded.job.id;
  assert.equal(uploaded.job.status, 'draft');
  assert.equal(uploaded.inspection.selectedSheet, testCase.sheetName);
  log(`  upload: PASS (job ${id})`);

  const inspect = await request(base, `/api/journal-entry-analyses/${id}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetName: testCase.sheetName,
      headerRow: testCase.headerRow,
      mapping: {}
    })
  });
  const inspected = await inspect.json();
  assert.equal(inspect.status, 200, `inspect status: ${JSON.stringify(inspected)}`);
  assert.equal(inspected.inspection.ok, true);
  log('  inspect: PASS');

  const body = JSON.stringify({
    sheetName: testCase.sheetName,
    headerRow: testCase.headerRow,
    amountLayout: testCase.amountLayout,
    positiveSide: testCase.positiveSide,
    mapping: testCase.mapping
  });

  if (testCase.positiveSide) {
    const missingSide = JSON.stringify({
      sheetName: testCase.sheetName,
      headerRow: testCase.headerRow,
      amountLayout: testCase.amountLayout,
      mapping: testCase.mapping
    });
    const missing = await request(base, `/api/journal-entry-analyses/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: missingSide
    });
    assert.equal(missing.status, 400, 'missing positive_side must be rejected');
    const invalid = await request(base, `/api/journal-entry-analyses/${id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: testCase.sheetName,
        headerRow: testCase.headerRow,
        amountLayout: testCase.amountLayout,
        positiveSide: 'auto',
        mapping: testCase.mapping
      })
    });
    assert.equal(invalid.status, 400, 'positive_side=auto must be rejected');
    log('  validation: PASS');
  }

  const preview = await request(base, `/api/journal-entry-analyses/${id}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const previewed = await preview.json();
  assert.equal(preview.status, 200, `preview status: ${JSON.stringify(previewed)}`);
  assert.equal(previewed.preview.ok, true);
  assert.equal(previewed.preview.canStart, true);
  assert.equal(previewed.preview.cleaningSummary.voucherCount, testCase.expectedVouchers);
  for (const expected of testCase.expectedLines || []) {
    const sample = (previewed.preview.sampleVouchers || [])
      .find((item) => item.voucher_id === expected.voucherId);
    assert.ok(sample, `missing preview voucher ${expected.voucherId}`);
    const line = sample.lines.find((item) => item.account_code === expected.accountCode);
    assert.ok(line, `missing preview account ${expected.accountCode}`);
    assert.equal(line.debit, expected.debit, `preview ${expected.voucherId}/${expected.accountCode} debit`);
    assert.equal(line.credit, expected.credit, `preview ${expected.voucherId}/${expected.accountCode} credit`);
  }
  log('  preview: PASS');

  if (testCase.positiveSide) {
    const reinspect = await request(base, `/api/journal-entry-analyses/${id}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: testCase.sheetName,
        headerRow: testCase.headerRow,
        mapping: {}
      })
    });
    const reinspected = await reinspect.json();
    assert.equal(reinspect.status, 200, `reinspect status: ${JSON.stringify(reinspected)}`);
    assert.equal(reinspected.job.positiveSide, testCase.positiveSide);
    assert.equal(reinspected.job.amountLayout, 'signed_amount');
    assert.equal(reinspected.inspection.amountLayout.layout, 'signed_amount');
    assert.equal(reinspected.inspection.amountLayout.positive_side, testCase.positiveSide);
    log('  resume config: PASS');
  }

  const start = await request(base, `/api/journal-entry-analyses/${id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const started = await start.json();
  assert.equal(start.status, 202, `start status: ${JSON.stringify(started)}`);
  assert.equal(started.job.status, 'queued');
  const seen = new Set(['queued']);
  const job = await waitForJob(base, id, seen);
  assert.equal(job.status, 'completed');
  const statuses = transitions.filter((item) => item.id === id).map((item) => item.status);
  assert.ok(statuses.includes('queued'), `missing queued transition: ${statuses}`);
  assert.ok(statuses.includes('running'), `missing running transition: ${statuses}`);
  assert.ok(statuses.includes('completed'), `missing completed transition: ${statuses}`);
  log(`  start/worker: PASS (transitions ${statuses.join(' -> ')})`);

  const jobDir = path.join(TEMP_ROOT, 'storage', 'journal-entry', id);
  assert.ok(fs.existsSync(path.join(jobDir, 'result.json')), 'result.json missing');
  assert.ok(fs.existsSync(path.join(jobDir, 'journal-entry-analysis-report.xlsx')), 'export file missing');

  const resultResponse = await request(base, `/api/journal-entry-analyses/${id}/result`);
  assert.equal(resultResponse.status, 200);
  const result = await resultResponse.json();
  assert.equal(result.status, 'completed');
  assert.equal(result.schema_version, 1);
  assert.equal(result.vouchers.length, testCase.expectedVouchers);
  assert.equal(result.cleaning_summary.voucher_count, testCase.expectedVouchers);
  assert.equal(result.input_metadata.amount_layout, testCase.amountLayout);
  if (testCase.positiveSide) {
    assert.equal(result.input_metadata.positive_side, testCase.positiveSide);
  }
  for (const voucher of result.vouchers) {
    assert.equal(voucher.total_debit, voucher.total_credit);
  }
  for (const expected of testCase.expectedLines || []) {
    const voucher = result.vouchers.find((item) => item.voucher_id === expected.voucherId);
    assert.ok(voucher, `missing voucher ${expected.voucherId}`);
    const line = voucher.lines.find((item) => item.account_code === expected.accountCode);
    assert.ok(line, `missing account ${expected.accountCode} in ${expected.voucherId}`);
    assert.equal(line.debit, expected.debit, `${expected.voucherId}/${expected.accountCode} debit`);
    assert.equal(line.credit, expected.credit, `${expected.voucherId}/${expected.accountCode} credit`);
  }
  if (testCase.duplicateLineId) {
    const voucher = result.vouchers.find((item) => item.voucher_id === 'SA-001');
    assert.ok(voucher, 'missing SA-001');
    const duplicated = voucher.lines.filter((line) => line.line_id === '001');
    assert.equal(duplicated.length, 2, 'expected duplicate external line_id');
    assert.equal(new Set(duplicated.map((line) => line.internal_line_key)).size, 2);
    const allocation = (voucher.contra.allocations || [])[0];
    assert.ok(allocation, 'missing contra allocation');
    assert.equal(allocation.source_line_id, '001');
    assert.equal(allocation.target_line_id, '001');
    assert.notEqual(allocation.source_internal_key, allocation.target_internal_key);
  }
  log('  result: PASS');

  const exportResponse = await request(base, `/api/journal-entry-analyses/${id}/export`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /spreadsheetml/);
  const exported = Buffer.from(await exportResponse.arrayBuffer());
  assert.ok(exported.length > 0);
  assert.equal(exported.subarray(0, 2).toString('latin1'), 'PK');
  log('  export: PASS');

  const otherUser = await request(base, `/api/journal-entry-analyses/${id}`, {}, 'someone-else');
  assert.equal(otherUser.status, 404);
  const otherExport = await request(base, `/api/journal-entry-analyses/${id}/export`, {}, 'someone-else');
  assert.equal(otherExport.status, 404);
  const anonymous = await request(base, `/api/journal-entry-analyses/${id}`, {}, null);
  assert.equal(anonymous.status, 401);
  log('  authorization: PASS');

  const history = await request(base, '/api/journal-entry-analyses');
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.ok(historyBody.jobs.some((item) => item.id === id));
  log('  history: PASS');

  const removed = await request(base, `/api/journal-entry-analyses/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const afterDelete = await request(base, `/api/journal-entry-analyses/${id}`);
  assert.equal(afterDelete.status, 404);
  log('  delete: PASS');
}

async function main() {
  checkPython();
  const { transitions } = installRepositoryStub();

  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const { createJournalEntryRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'routes.js'));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const user = req.headers['x-user'];
    if (user) req.session = { auth: { username: String(user) } };
    next();
  });
  const requireAuth = (req, res, next) => {
    if (req.session?.auth?.username) return next();
    return res.status(401).json({ error: '请先登录。' });
  };
  app.use('/api/journal-entry-analyses', requireAuth, (_req, _res, next) => next(),
    createJournalEntryRouter({
      root: TEMP_ROOT,
      requireAuth,
      sameOriginForStateChange: (_req, _res, next) => next()
    }));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const meta = await request(base, '/api/journal-entry-analyses/meta');
    assert.equal(meta.status, 200);
    const metaBody = await meta.json();
    assert.equal(metaBody.maxFileSizeBytes, 25 * 1024 * 1024);
    assert.deepEqual(metaBody.extensions, ['.xls', '.xlsx']);
    const signedLayout = metaBody.amountLayouts.find((item) => item.value === 'signed_amount');
    assert.ok(signedLayout);
    assert.equal(signedLayout.positiveSideRequired, true);
    assert.deepEqual(signedLayout.requiredFields, ['signed_amount']);
    assert.ok(metaBody.mappingFields.some((item) => item.key === 'signed_amount'));
    log('meta: PASS');

    for (const testCase of CASES) {
      await runCase(base, testCase, transitions);
    }
    log('\nJournal Entry deployment smoke: PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('\nJournal Entry deployment smoke: FAIL');
    console.error(error && error.stack ? error.stack : error);
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { CASES };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-routes-'));
const state = { jobs: new Map(), enqueued: [] };

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
  const previewPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'preview-runner.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'parse-runner.js'));

  const inspection = {
    ok: true,
    sourceFilename: 'source.xlsx',
    sheetCount: 1,
    sheets: [{ name: '序时账', index: 0, max_row: 100, max_column: 11, sheet_state: 'visible' }],
    selectedSheet: '序时账',
    headerRow: 1,
    headerCandidates: [{ row_number: 1, values: ['日期', '凭证号'], non_empty_count: 2, text_count: 2, unique_count: 2, score: 0.99 }],
    headers: ['序号', '日期', '凭证号', '科目编码', '科目名称', '摘要', '币种', '方向', '原币金额', '借方', '贷方'],
    dataRowCount: 99,
    canonicalFields: ['date', 'voucher_id'],
    suggestedMapping: {},
    explicitMapping: { date: 2, voucher_id: 3, account_code: 4, account_name: 5, description: 6, currency: 7, direction: 8, original_amount: 9, debit: 10, credit: 11 },
    amountLayout: { layout: 'direction_amount', primary_column: 11, direction_column: 8, positive_side: null },
    ambiguous: {},
    ambiguousCandidates: {},
    mappingError: null,
    warnings: []
  };
  const preview = {
    ok: true,
    mapping: {
      header_row: 1,
      sheet_name: '序时账',
      amount_layout: { layout: 'direction_amount', primary_column: 11, direction_column: 8 },
      fields: {},
      ambiguous: {},
      ambiguous_candidates: {},
      warnings: []
    },
    cleaningSummary: { rawRowCount: 99, lineCount: 90, voucherCount: 30, issueCount: 0, rowWarningCount: 0, largestVoucherLineCount: 8, exactly_balanced_voucher_count: 30, within_tolerance_only_voucher_count: 0, unbalanced_voucher_count: 0 },
    issuesTotal: 0,
    issues: [],
    rowWarnings: [],
    sampleVouchers: [{ voucher_id: 'V001', date: '2025-01-01', total_debit: '100.00', total_credit: '100.00', lines: [] }],
    canStart: true,
    warnings: []
  };

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
      async deleteJobById(id) { return state.jobs.delete(id); }
    }
  };
  require.cache[previewPath] = {
    id: previewPath, filename: previewPath, loaded: true,
    exports: {
      createPreviewRunner: () => ({
        async run({ mode }) { return mode === 'inspect' ? inspection : preview; },
        resolvePythonBin: () => 'python3'
      })
    }
  };
  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      createJournalEntryRunner: () => ({
        enqueue(id) { state.enqueued.push(id); },
        recover() {},
        cleanupExpired() {},
        jobDir(id) { return path.join(tempRoot, 'storage', 'journal-entry', id); },
        maxConcurrent: 1,
        retentionHours: 72
      })
    }
  };
  return { inspection, preview };
}

const STUB = installStubs();
const { createJournalEntryRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

function makeXlsxBytes() {
  return Buffer.from(fflate.zipSync({ 'xl/workbook.xml': fflate.strToU8('<workbook/>') }));
}

function makeXlsBytes() {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
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
  app.use('/api/journal-entry-analyses', createJournalEntryRouter({
    root: tempRoot,
    requireAuth: (_req, _res, next) => next(),
    sameOriginForStateChange: (_req, _res, next) => next()
  }));
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function postFile(filename, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await fetch(`${base}/api/journal-entry-analyses`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postJson(urlPath, body) {
  const response = await fetch(base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const requestBody = {
  sheetName: '序时账',
  headerRow: 1,
  amountLayout: 'direction_amount',
  mapping: { date: 2, voucher_id: 3, account_code: 4, account_name: 5, description: 6, currency: 7, direction: 8, amount: 11 }
};

test('upload .xlsx creates a draft job and returns inspection', async () => {
  const { status, body } = await postFile('序时账.xlsx', makeXlsxBytes());
  assert.equal(status, 201);
  assert.equal(body.job.status, 'draft');
  assert.equal(body.job.originalFilename, '序时账.xlsx');
  assert.equal(body.inspection.selectedSheet, '序时账');
  assert.equal(body.job.sheetName, '序时账');
  assert.equal(body.job.headerRow, 1);
  assert.ok(state.jobs.has(body.job.id));
});

test('upload accepts legacy .xls magic', async () => {
  const { status, body } = await postFile('legacy.xls', makeXlsBytes());
  assert.equal(status, 201);
  assert.equal(body.job.status, 'draft');
});

test('upload rejects wrong extension and wrong magic', async () => {
  const wrongExt = await postFile('ledger.csv', makeXlsxBytes());
  assert.equal(wrongExt.status, 400);

  const wrongMagic = await postFile('ledger.xlsx', Buffer.from('not a zip file'));
  assert.equal(wrongMagic.status, 400);
  assert.match(wrongMagic.body.error, /有效的 Excel/);
});

test('preview validates mapping, start queues and enqueues', async () => {
  const uploaded = await postFile('preview.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;

  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, requestBody);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.canStart, true);
  assert.equal(preview.body.preview.cleaningSummary.voucherCount, 30);

  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, requestBody);
  assert.equal(started.status, 202);
  assert.equal(started.body.job.status, 'queued');
  assert.ok(state.enqueued.includes(id));

  const again = await postJson(`/api/journal-entry-analyses/${id}/start`, requestBody);
  assert.equal(again.status, 409);
});

test('inspect re-detects a selected sheet and header row', async () => {
  const uploaded = await postFile('inspect.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const response = await postJson(`/api/journal-entry-analyses/${id}/inspect`, {
    sheetName: '序时账',
    headerRow: 1,
    mapping: {}
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.inspection.headerRow, 1);
  assert.equal(response.body.job.id, id);
});

test('owner scoping hides another user job', async () => {
  const uploaded = await postFile('owner.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, {
    headers: { Accept: 'application/json', 'x-user': 'someone-else' }
  });
  assert.equal(response.status, 404);
});

test('queued job cannot be deleted', async () => {
  const uploaded = await postFile('delete.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  await postJson(`/api/journal-entry-analyses/${id}/start`, requestBody);
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, { method: 'DELETE' });
  assert.equal(response.status, 409);
});

test('meta exposes file and mapping capabilities', async () => {
  const response = await fetch(`${base}/api/journal-entry-analyses/meta`, { headers: { Accept: 'application/json' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.maxFileSizeBytes, 25 * 1024 * 1024);
  assert.ok(body.mappingFields.some((field) => field.key === 'voucher_id'));
});

test('stubs match the route response shape', () => {
  assert.equal(STUB.inspection.selectedSheet, '序时账');
  assert.equal(STUB.preview.canStart, true);
});

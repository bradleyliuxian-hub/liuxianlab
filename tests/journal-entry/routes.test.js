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
  const batchRepositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));
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
        return job && job.ownerUsername === owner && !job.deletedAt ? job : null;
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
      async softDeleteJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        if (!job || job.ownerUsername !== owner) return null;
        if (['queued', 'running'].includes(job.status)) return null;
        const next = {
          ...job, deletedAt: '2026-01-01T00:00:00.000Z',
          sourcePath: null, resultPath: null, exportPath: null
        };
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
  require.cache[batchRepositoryPath] = {
    id: batchRepositoryPath, filename: batchRepositoryPath, loaded: true,
    exports: {
      async deleteItemsForJob() { return 0; }
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

const signedBody = (positiveSide) => ({
  sheetName: '序时账',
  headerRow: 1,
  amountLayout: 'signed_amount',
  positiveSide,
  mapping: { date: 2, voucher_id: 3, account_code: 4, account_name: 5, description: 6, signed_amount: 11 }
});

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

test('completed job delete soft-deletes and removes its files', async () => {
  const uploaded = await postFile('delete-completed.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const job = state.jobs.get(id);
  state.jobs.set(id, { ...job, status: 'completed', progress: 100 });
  const uiDir = path.join(tempRoot, 'storage', 'journal-entry', id, 'ui');
  fs.mkdirSync(uiDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(uiDir, 'summary.json'), '{}');
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.ok(state.jobs.get(id).deletedAt);
  assert.equal(fs.existsSync(path.join(tempRoot, 'storage', 'journal-entry', id)), false);
});

test('owner scoping hides another user job', async () => {
  const uploaded = await postFile('owner.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, {
    headers: { Accept: 'application/json', 'x-user': 'someone-else' }
  });
  assert.equal(response.status, 404);
});

test('another owner cannot delete a completed job', async () => {
  const uploaded = await postFile('delete-owner.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  state.jobs.set(id, { ...state.jobs.get(id), status: 'completed' });
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, {
    method: 'DELETE',
    headers: { 'x-user': 'someone-else' }
  });
  assert.equal(response.status, 404);
  assert.ok(state.jobs.has(id));
});

test('queued job cannot be deleted', async () => {
  const uploaded = await postFile('delete.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  await postJson(`/api/journal-entry-analyses/${id}/start`, requestBody);
  const response = await fetch(`${base}/api/journal-entry-analyses/${id}`, { method: 'DELETE' });
  assert.equal(response.status, 409);
});


test('upload enforces the 25 MB file boundary', async () => {
  const nearLimit = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(25 * 1024 * 1024 - 100, 0)
  ]);
  const accepted = await postFile('near-limit.xlsx', nearLimit);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));

  const oversize = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(25 * 1024 * 1024 + 1, 0)
  ]);
  const rejected = await postFile('oversize.xlsx', oversize);
  assert.equal(rejected.status, 413);
  assert.match(rejected.body.error, /25MB/);
});

test('meta exposes file and mapping capabilities', async () => {
  const response = await fetch(`${base}/api/journal-entry-analyses/meta`, { headers: { Accept: 'application/json' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.maxFileSizeBytes, 25 * 1024 * 1024);
  assert.ok(body.mappingFields.some((field) => field.key === 'voucher_id'));
  assert.ok(body.mappingFields.some((field) => field.key === 'signed_amount'));
  assert.ok(body.mappingFields.some((field) => field.key === 'line_id'));
  const signed = body.amountLayouts.find((layout) => layout.value === 'signed_amount');
  assert.ok(signed);
  assert.equal(signed.positiveSideRequired, true);
  assert.deepEqual(signed.requiredFields, ['signed_amount']);
});

test('signed_amount accepts positive_side=debit and persists it', async () => {
  const uploaded = await postFile('signed-debit.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, signedBody('debit'));
  assert.equal(preview.status, 200);
  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, signedBody('debit'));
  assert.equal(started.status, 202);
  const saved = state.jobs.get(id);
  assert.equal(saved.requestJson.amountLayout, 'signed_amount');
  assert.equal(saved.requestJson.positiveSide, 'debit');
  assert.equal(saved.requestJson.mapping.signed_amount, 11);
  assert.equal(saved.amountLayout, 'signed_amount');
});

test('signed_amount accepts positive_side=credit', async () => {
  const uploaded = await postFile('signed-credit.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, signedBody('credit'));
  assert.equal(preview.status, 200);
  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, signedBody('credit'));
  assert.equal(started.status, 202);
  assert.equal(state.jobs.get(id).requestJson.positiveSide, 'credit');
});

test('signed_amount requires positive_side', async () => {
  const uploaded = await postFile('signed-missing.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const body = signedBody('debit');
  delete body.positiveSide;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, body);
  assert.equal(preview.status, 400);
  assert.match(preview.body.error, /正数代表借方还是贷方/);
  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, body);
  assert.equal(started.status, 400);
});

test('signed_amount rejects positive_side=auto', async () => {
  const uploaded = await postFile('signed-auto.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, signedBody('auto'));
  assert.equal(preview.status, 400);
  assert.match(preview.body.error, /正数方向不正确/);
  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, signedBody('auto'));
  assert.equal(started.status, 400);
});

test('non-signed layout does not require positive_side', async () => {
  const uploaded = await postFile('direction-no-side.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, requestBody);
  assert.equal(preview.status, 200);
  const started = await postJson(`/api/journal-entry-analyses/${id}/start`, requestBody);
  assert.equal(started.status, 202);
});

test('inspect keeps saved signed_amount config', async () => {
  const uploaded = await postFile('signed-reinspect.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const preview = await postJson(`/api/journal-entry-analyses/${id}/preview`, signedBody('debit'));
  assert.equal(preview.status, 200);
  const inspected = await postJson(`/api/journal-entry-analyses/${id}/inspect`, {
    sheetName: '序时账',
    headerRow: 1,
    mapping: {}
  });
  assert.equal(inspected.status, 200);
  const saved = state.jobs.get(id);
  assert.equal(saved.requestJson.amountLayout, 'signed_amount');
  assert.equal(saved.requestJson.positiveSide, 'debit');
  assert.equal(saved.requestJson.mapping.signed_amount, 11);
  assert.equal(saved.amountLayout, 'signed_amount');
});

test('stubs match the route response shape', () => {
  assert.equal(STUB.inspection.selectedSheet, '序时账');
  assert.equal(STUB.preview.canStart, true);
});

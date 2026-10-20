'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-routes-'));
const state = { jobs: new Map(), enqueued: [] };

const HEADERS = ['送货日期', '供应商', '采购订单', '采购订单项目', '物料编码', '订单单位', '数量', '单价', '每', '总金额', '移动类型'];

function inspectionPayload(overrides = {}) {
  return {
    ok: true,
    sheets: [{ name: 'DATABASE', index: 0, state: 'visible' }],
    selectedSheet: 'DATABASE',
    headerRow: 1,
    headers: HEADERS,
    dataRowCount: 34297,
    sampleRows: [],
    mapping: {
      delivery_date: '送货日期',
      supplier: '供应商',
      purchase_order: '采购订单',
      purchase_order_item: '采购订单项目',
      material_code: '物料编码',
      order_unit: '订单单位',
      quantity: '数量',
      unit_price: '单价',
      per: '每',
      amount: '总金额',
      movement_type: '移动类型'
    },
    missing: [],
    missingLabels: [],
    ambiguous: {},
    fieldSchema: [],
    ...overrides
  };
}

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'purchase-reconciliation', 'repository.js'));
  const inspectionPath = require.resolve(path.join(ROOT, 'server', 'purchase-reconciliation', 'inspection-runner.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'purchase-reconciliation', 'worker-runner.js'));

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

  require.cache[inspectionPath] = {
    id: inspectionPath, filename: inspectionPath, loaded: true,
    exports: {
      createInspectionRunner: () => ({
        async run() { return inspectionPayload(); },
        resolvePythonBin: () => 'python3'
      })
    }
  };

  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      createReconciliationRunner: () => ({
        enqueue(id) { state.enqueued.push(id); },
        recover() {},
        cleanupExpired() {},
        jobDir(id) { return path.join(tempRoot, 'storage', 'purchase-reconciliation', id); },
        maxConcurrent: 1,
        retentionHours: 72
      })
    }
  };
}

installStubs();
const { createPurchaseReconciliationRouter } = require(path.join(ROOT, 'server', 'purchase-reconciliation', 'routes.js'));
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
  app.use('/api/purchase-reconciliations', createPurchaseReconciliationRouter({ root: tempRoot }));
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

async function postFile(filename, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await fetch(`${base}/api/purchase-reconciliations`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postJson(urlPath, body, user = 'tester') {
  const response = await fetch(base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-user': user },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getJson(urlPath, user = 'tester') {
  const response = await fetch(base + urlPath, { headers: { Accept: 'application/json', 'x-user': user } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const requestBody = {
  sheetName: 'DATABASE',
  headerRow: 1,
  matchFields: ['supplier', 'purchase_order', 'purchase_order_item', 'material_code', 'order_unit', 'unit_price', 'per'],
  mapping: inspectionPayload().mapping
};

function writeResultFiles(jobId, { xlsx = true } = {}) {
  const dir = path.join(tempRoot, 'storage', 'purchase-reconciliation', jobId, 'result');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    metrics: { original_record_count: 2, match_segment_count: 1, conservation_difference: '0.00' },
    movement_summary: [],
    source: { headers: HEADERS, filename: 'x.xlsx', sheetName: 'DATABASE' }
  }));
  fs.writeFileSync(path.join(dir, 'segments.ndjson'), [
    { matchId: 'MATCH-000001', businessKey: 'V1 | PO1', positiveSourceRow: 2, negativeSourceRow: 3, matchedQuantity: '10', matchedAmount: '100', negativeAmountAbs: '100' },
    { matchId: 'MATCH-000002', businessKey: 'V1 | PO2', positiveSourceRow: 4, negativeSourceRow: 5, matchedQuantity: '5', matchedAmount: '50', negativeAmountAbs: '50' }
  ].map((row) => JSON.stringify(row)).join('\n'));
  fs.writeFileSync(path.join(dir, 'matched.ndjson'), [
    { sourceRow: 2, direction: '正向', matchedQuantity: '10', matchedAmount: '100', originalQuantity: '10', remainingQuantity: '0', originalAmount: '100', remainingAmount: '0', businessKey: 'V1 | PO1', matchIds: ['MATCH-000001'], raw: { 供应商: 'V1' } }
  ].map((row) => JSON.stringify(row)).join('\n'));
  fs.writeFileSync(path.join(dir, 'remaining.ndjson'), [
    { sourceRow: 3, direction: '负向', originalQuantity: '-4', matchedQuantity: '0', remainingQuantity: '-4', originalAmount: '-40', remainingAmount: '-40', businessKey: 'V1 | PO9', matchIds: [], raw: { 供应商: 'V1' } },
    { sourceRow: 4, direction: '负向', originalQuantity: '-12', matchedQuantity: '5', remainingQuantity: '-7', originalAmount: '-120', remainingAmount: '-70', businessKey: 'V1 | PO2', matchIds: ['MATCH-000002'], raw: { 供应商: 'V1' } }
  ].map((row) => JSON.stringify(row)).join('\n'));
  fs.writeFileSync(path.join(dir, 'reconciliation-result-csv.zip'), Buffer.from('PK\u0003\u0004test'));
  if (xlsx) fs.writeFileSync(path.join(dir, 'reconciliation-result.xlsx'), Buffer.from('PK\u0003\u0004xlsx-test'));
}

test('upload creates a draft job and returns inspection', async () => {
  const { status, body } = await postFile('SAP明细.xlsx', makeXlsxBytes());
  assert.equal(status, 201);
  assert.equal(body.job.status, 'draft');
  assert.equal(body.job.originalFilename, 'SAP明细.xlsx');
  assert.equal(body.inspection.selectedSheet, 'DATABASE');
  assert.equal(body.job.sheetName, 'DATABASE');
  assert.ok(state.jobs.has(body.job.id));
});

test('upload rejects wrong extension and wrong magic', async () => {
  const wrongExt = await postFile('ledger.csv', makeXlsxBytes());
  assert.equal(wrongExt.status, 400);
  const wrongMagic = await postFile('ledger.xlsx', Buffer.from('not a zip file'));
  assert.equal(wrongMagic.status, 400);
  assert.match(wrongMagic.body.error, /有效的 Excel/);
});

test('start validates fields and queues the job', async () => {
  const uploaded = await postFile('start.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const started = await postJson(`/api/purchase-reconciliations/${id}/start`, requestBody);
  assert.equal(started.status, 202);
  assert.equal(started.body.job.status, 'queued');
  assert.ok(state.enqueued.includes(id));
  const again = await postJson(`/api/purchase-reconciliations/${id}/start`, requestBody);
  assert.equal(again.status, 409);
});

test('inspect re-detects sheet and header', async () => {
  const uploaded = await postFile('inspect.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const response = await postJson(`/api/purchase-reconciliations/${id}/inspect`, {
    sheetName: 'DATABASE',
    headerRow: 1
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.inspection.headerRow, 1);
  assert.equal(response.body.job.id, id);
});

test('owner scoping hides another user job', async () => {
  const uploaded = await postFile('owner.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  const response = await getJson(`/api/purchase-reconciliations/${id}`, 'someone-else');
  assert.equal(response.status, 404);
});

test('result endpoints paginate, filter and download', async () => {
  const uploaded = await postFile('result.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  writeResultFiles(id);
  const job = state.jobs.get(id);
  state.jobs.set(id, {
    ...job,
    status: 'completed',
    progress: 100,
    resultDir: `storage/purchase-reconciliation/${id}/result`,
    xlsxStatus: 'ready',
    summaryJson: { metrics: { match_segment_count: 1 } }
  });

  const summary = await getJson(`/api/purchase-reconciliations/${id}/summary`);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.metrics.original_record_count, 2);

  const matches = await getJson(`/api/purchase-reconciliations/${id}/matches?page=1&pageSize=1`);
  assert.equal(matches.status, 200);
  assert.equal(matches.body.total, 2);
  assert.equal(matches.body.rows.length, 1);
  assert.equal(matches.body.rows[0].matchId, 'MATCH-000001');

  const segment = await getJson(`/api/purchase-reconciliations/${id}/matches/MATCH-000002`);
  assert.equal(segment.status, 200);
  assert.equal(segment.body.segment.positiveSourceRow, 4);

  const matched = await getJson(`/api/purchase-reconciliations/${id}/matched?page=1&pageSize=50`);
  assert.equal(matched.status, 200);
  assert.equal(matched.body.total, 1);

  const remaining = await getJson(`/api/purchase-reconciliations/${id}/remaining?page=1&pageSize=50`);
  assert.equal(remaining.body.total, 2);

  const unmatched = await getJson(`/api/purchase-reconciliations/${id}/remaining?unmatched=1&page=1&pageSize=50`);
  assert.equal(unmatched.body.total, 2);

  const csv = await fetch(`${base}/api/purchase-reconciliations/${id}/download?format=zip`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition') || '', /CSV\.zip/);

  const xlsx = await fetch(`${base}/api/purchase-reconciliations/${id}/download?format=xlsx`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-disposition') || '', /\.xlsx/);

  const missing = await getJson(`/api/purchase-reconciliations/${id}/matches/MATCH-999999`);
  assert.equal(missing.status, 404);
});

test('meta exposes field capabilities and page limits', async () => {
  const response = await getJson('/api/purchase-reconciliations/meta');
  assert.equal(response.status, 200);
  assert.equal(response.body.maxFileSizeBytes, 50 * 1024 * 1024);
  assert.equal(response.body.maxPageSize, 200);
  assert.ok(response.body.fieldSchema.some((field) => field.key === 'quantity' && field.required));
  assert.ok(response.body.matchFieldOptions.some((field) => field.key === 'purchase_order'));
});

test('queued job cannot be deleted', async () => {
  const uploaded = await postFile('delete.xlsx', makeXlsxBytes());
  const id = uploaded.body.job.id;
  await postJson(`/api/purchase-reconciliations/${id}/start`, requestBody);
  const response = await fetch(`${base}/api/purchase-reconciliations/${id}`, {
    method: 'DELETE',
    headers: { 'x-user': 'tester' }
  });
  assert.equal(response.status, 409);
});

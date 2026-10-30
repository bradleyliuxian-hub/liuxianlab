'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-standard-export-'));
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_JOB_ID = '33333333-3333-4333-8333-333333333333';

function writeResult(jobId) {
  const dir = path.join(tempRoot, 'storage', 'journal-entry', jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ vouchers: [] }));
  return path.join('storage', 'journal-entry', jobId, 'result.json');
}

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
  const batchPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));

  writeResult(BATCH_JOB_ID);
  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      async getJobForOwner(id, owner) {
        if (owner !== 'tester') return null;
        if (id === JOB_ID) {
          return {
            id: JOB_ID, ownerUsername: 'tester', originalFilename: 'single.xlsx',
            status: 'completed', resultPath: writeResult(JOB_ID)
          };
        }
        if (id === BATCH_JOB_ID) {
          return {
            id: BATCH_JOB_ID, ownerUsername: 'tester', originalFilename: 'batch-a.xlsx',
            status: 'completed', resultPath: writeResult(BATCH_JOB_ID)
          };
        }
        return null;
      }
    }
  };

  require.cache[batchPath] = {
    id: batchPath, filename: batchPath, loaded: true,
    exports: {
      async getBatchDetailForOwner(id, owner) {
        if (id !== BATCH_ID || owner !== 'tester') return null;
        return {
          id: BATCH_ID, name: 'batch', ownerUsername: 'tester', totalCount: 1,
          items: [{
            position: 0,
            originalFilename: 'batch-a.xlsx',
            job: {
              id: BATCH_JOB_ID, ownerUsername: 'tester', originalFilename: 'batch-a.xlsx',
              status: 'completed', resultPath: `storage/journal-entry/${BATCH_JOB_ID}/result.json`
            }
          }]
        };
      }
    }
  };
}

installStubs();

const { createStandardExportRouter } = require(
  path.join(ROOT, 'server', 'journal-entry', 'standard-export-routes.js')
);
const express = require(path.join(ROOT, 'node_modules', 'express'));

const fakeRunner = {
  async preview(request) {
    const selected = request.row_selection_mode === 'only_selected'
      ? (request.included_rows || []).length
      : 10 - (request.excluded_rows || []).length;
    return {
      ok: true,
      payload: {
        candidate_line_count: 10,
        included_line_count: selected,
        excluded_line_count: 10 - selected,
        candidate_voucher_count: 5,
        included_voucher_count: 5,
        page: request.page,
        page_size: request.page_size,
        total_pages: 1,
        columns: request.columns || ['date', 'voucher_id'],
        column_stats: {},
        rows: [{ job_id: request.jobs[0].job_id, internal_line_key: 'k1', included: true, values: {} }],
        row_selection_mode: request.row_selection_mode,
        excluded_rows: request.excluded_rows,
        included_rows: request.included_rows,
        warnings: [],
        included_job_ids: request.jobs.map((job) => job.job_id)
      }
    };
  },
  async generateReport(request) {
    const dir = path.join(tempRoot, 'generated-report', String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'custom-analysis-report.xlsx');
    fs.writeFileSync(file, 'fake-report');
    return {
      ok: true,
      dir,
      file,
      payload: {
        output_file: 'custom-analysis-report.xlsx',
        candidate_line_count: 10,
        included_line_count: request.row_selection_mode === 'only_selected'
          ? (request.included_rows || []).length
          : 10 - (request.excluded_rows || []).length,
        included_voucher_count: 5
      }
    };
  },
  async generate(request) {
    const dir = path.join(tempRoot, 'generated', String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'standard-journal.xlsx');
    fs.writeFileSync(file, 'fake-xlsx');
    return {
      ok: true,
      dir,
      file,
      payload: {
        output_file: 'standard-journal.xlsx',
        candidate_line_count: 10,
        included_line_count: request.row_selection_mode === 'only_selected'
          ? (request.included_rows || []).length
          : 10 - (request.excluded_rows || []).length,
        included_voucher_count: 5
      }
    };
  }
};

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/journal-entry-standard-exports', createStandardExportRouter({
    root: tempRoot,
    requireAuth: (_req, _res, next) => next(),
    runner: fakeRunner
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

async function post(pathname, body, user = 'tester') {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'x-user': user, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch (_) {}
  return { status: response.status, body: payload, text };
}

function spec(overrides = {}) {
  return {
    scopeType: 'job',
    scopeId: JOB_ID,
    columns: ['date', 'voucher_id'],
    rowSelectionMode: 'all_except',
    excludedRows: [],
    includedRows: [],
    page: 1,
    pageSize: 50,
    ...overrides
  };
}

test('standard export meta exposes columns and limits', async () => {
  const response = await fetch(`${base}/api/journal-entry-standard-exports/meta`, {
    headers: { 'x-user': 'tester' }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.columns.some((item) => item.id === 'date'));
  assert.equal(body.maxExplicitRows, 5000);
  assert.deepEqual(body.previewPageSizes, [25, 50, 100, 200]);
});

test('standard preview works for job and batch scopes with owner isolation', async () => {
  const job = await post('/api/journal-entry-standard-exports/preview', spec());
  assert.equal(job.status, 200, JSON.stringify(job.body));
  assert.equal(job.body.candidate_line_count, 10);
  assert.equal(job.body.rows[0].job_id, JOB_ID);

  const batch = await post('/api/journal-entry-standard-exports/preview', spec({
    scopeType: 'batch',
    scopeId: BATCH_ID
  }));
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  assert.deepEqual(batch.body.included_job_ids, [BATCH_JOB_ID]);

  const hidden = await post('/api/journal-entry-standard-exports/preview', spec(), 'someone-else');
  assert.equal(hidden.status, 404);
});

test('standard preview validates columns and row selection', async () => {
  const badColumns = await post('/api/journal-entry-standard-exports/preview', spec({ columns: [] }));
  assert.equal(badColumns.status, 422);
  const unknown = await post('/api/journal-entry-standard-exports/preview', spec({ columns: ['nope'] }));
  assert.equal(unknown.status, 422);
  const bothModes = await post('/api/journal-entry-standard-exports/preview', spec({
    rowSelectionMode: 'only_selected',
    excludedRows: [{ job_id: JOB_ID, internal_line_key: 'k1' }],
    includedRows: [{ job_id: JOB_ID, internal_line_key: 'k2' }]
  }));
  assert.equal(bothModes.status, 422);
});

test('standard export returns a workbook and rejects candidate mismatch', async () => {
  const response = await fetch(`${base}/api/journal-entry-standard-exports/export`, {
    method: 'POST',
    headers: { 'x-user': 'tester', 'Content-Type': 'application/json' },
    body: JSON.stringify(spec({ expectedCandidateLineCount: 10 }))
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'fake-xlsx');

  const mismatch = await post('/api/journal-entry-standard-exports/export', spec({
    expectedCandidateLineCount: 9
  }));
  assert.equal(mismatch.status, 409);
});


test('custom full report export is job-only and owner scoped', async () => {
  const response = await fetch(`${base}/api/journal-entry-standard-exports/report`, {
    method: 'POST',
    headers: { 'x-user': 'tester', 'Content-Type': 'application/json' },
    body: JSON.stringify(spec({ expectedCandidateLineCount: 10 }))
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'fake-report');

  const batch = await post('/api/journal-entry-standard-exports/report', spec({
    scopeType: 'batch',
    scopeId: BATCH_ID
  }));
  assert.equal(batch.status, 422);

  const hidden = await fetch(`${base}/api/journal-entry-standard-exports/report`, {
    method: 'POST',
    headers: { 'x-user': 'someone-else', 'Content-Type': 'application/json' },
    body: JSON.stringify(spec())
  });
  assert.equal(hidden.status, 404);

  const mismatch = await post('/api/journal-entry-standard-exports/report', spec({
    expectedCandidateLineCount: 9
  }));
  assert.equal(mismatch.status, 409);
});

test('missing job and batch return 404 for preview', async () => {
  const missingJob = await post('/api/journal-entry-standard-exports/preview', spec({
    scopeId: '99999999-9999-4999-8999-999999999999'
  }));
  assert.equal(missingJob.status, 404);

  const missingBatch = await post('/api/journal-entry-standard-exports/preview', spec({
    scopeType: 'batch',
    scopeId: '99999999-9999-4999-8999-999999999999'
  }));
  assert.equal(missingBatch.status, 404);
});

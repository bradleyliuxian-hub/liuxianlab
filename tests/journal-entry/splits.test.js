'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-splits-'));
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_JOB_ID = '33333333-3333-4333-8333-333333333333';
const DRAFT_JOB_ID = '44444444-4444-4444-8444-444444444444';

const state = { jobs: new Map(), outputs: new Map() };

function writeResult(jobId) {
  const dir = path.join(tempRoot, 'storage', 'journal-entry', jobId);
  fs.mkdirSync(dir, { recursive: true });
  const result = { schema_version: 1, vouchers: [] };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result));
  return path.join('storage', 'journal-entry', jobId, 'result.json');
}

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
  const batchPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'batch-repository.js'));
  const splitPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'split-repository.js'));
  const runnerPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'split-runner.js'));

  state.jobs.set(JOB_ID, {
    id: JOB_ID, ownerUsername: 'tester', originalFilename: 'single.xlsx',
    status: 'completed', resultPath: writeResult(JOB_ID), amountLayout: 'debit_credit'
  });
  state.jobs.set(BATCH_JOB_ID, {
    id: BATCH_JOB_ID, ownerUsername: 'tester', originalFilename: 'batch-a.xlsx',
    status: 'completed', resultPath: writeResult(BATCH_JOB_ID), amountLayout: 'debit_credit'
  });
  state.jobs.set(DRAFT_JOB_ID, {
    id: DRAFT_JOB_ID, ownerUsername: 'tester', originalFilename: 'batch-draft.xlsx',
    status: 'draft', resultPath: null
  });

  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      async getJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        return job && job.ownerUsername === owner ? job : null;
      }
    }
  };

  require.cache[batchPath] = {
    id: batchPath, filename: batchPath, loaded: true,
    exports: {
      async getBatchDetailForOwner(id, owner) {
        if (id !== BATCH_ID || owner !== 'tester') return null;
        return {
          id: BATCH_ID, name: 'batch', ownerUsername: 'tester', totalCount: 2,
          items: [
            { position: 0, originalFilename: 'batch-a.xlsx', job: state.jobs.get(BATCH_JOB_ID) },
            { position: 1, originalFilename: 'batch-draft.xlsx', job: state.jobs.get(DRAFT_JOB_ID) }
          ]
        };
      },
      async getBatchSummaryForOwner(id, owner) {
        return id === BATCH_ID && owner === 'tester' ? { id: BATCH_ID } : null;
      }
    }
  };

  require.cache[splitPath] = {
    id: splitPath, filename: splitPath, loaded: true,
    exports: {
      async createOutput({ id, ownerUsername, scopeType, scopeId, request, snapshot, outputMode }) {
        const row = {
          id, ownerUsername, scopeType, scopeId, status: 'generating',
          request, snapshot, outputMode, filePath: null, error: null,
          createdAt: new Date().toISOString(), completedAt: null
        };
        state.outputs.set(id, row);
        return row;
      },
      async markCompleted(id, { filePath, snapshot }) {
        const row = state.outputs.get(id);
        Object.assign(row, {
          status: 'completed', filePath, snapshot: snapshot || row.snapshot,
          error: null, completedAt: new Date().toISOString()
        });
        return row;
      },
      async markFailed(id, error) {
        const row = state.outputs.get(id);
        Object.assign(row, { status: 'failed', error: String(error), completedAt: new Date().toISOString() });
        return row;
      },
      async expireOutput(id) {
        const row = state.outputs.get(id);
        if (!row) return null;
        Object.assign(row, { expiredAt: new Date().toISOString(), filePath: null });
        return row;
      },
      async listExpiredOutputs() { return []; },
      async listByScope() { return []; },
      async listAllOutputIds() { return [...state.outputs.keys()]; },
      async getLatestForScope(owner, scopeType, scopeId) {
        return [...state.outputs.values()]
          .filter((row) => row.ownerUsername === owner
            && row.scopeType === scopeType && row.scopeId === scopeId)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      },
      async getForOwner(id, owner) {
        const row = state.outputs.get(id);
        return row && row.ownerUsername === owner ? row : null;
      }
    }
  };

  const fakeRunner = {
    async dimensions(request) {
      return {
        ok: true,
        payload: {
          dimension: request.dimension,
          options: [{ value: 'C001', label: '客户A', count: 2 }],
          total: 1, truncated: false, blank_count: 1
        }
      };
    },
    async preview(request) {
      const empty = (request.filters.months || []).includes('2030-01');
      const limited = Number(request.limits.max_groups) === 1;
      return {
        ok: true,
        payload: {
          schema_version: 1,
          matched_lines: empty ? 0 : 10,
          matched_vouchers: empty ? 0 : 5,
          candidate_lines: empty ? 0 : 10,
          candidate_vouchers: empty ? 0 : 5,
          excluded_lines: 0,
          row_selection_mode: request.row_selection_mode || 'all_except',
          excluded_rows: request.excluded_rows || [],
          included_rows: request.included_rows || [],
          completed_files: request.jobs.length,
          source_file_count: request.jobs.length,
          group_count: empty ? 0 : (limited ? 2 : 1),
          group_by: request.group_by,
          group_options: request.group_options,
          output_mode: request.output_mode,
          row_mode: request.row_mode,
          limits: request.limits,
          limit_exceeded: limited,
          warnings: [],
          selected_columns: request.columns || ['date', 'voucher_id', 'debit', 'credit'],
          column_order: request.columns || ['date', 'voucher_id', 'debit', 'credit'],
          column_stats: {
            date: { non_empty_count: 10, total_count: 10, entirely_empty: false },
            voucher_id: { non_empty_count: 10, total_count: 10, entirely_empty: false },
            debit: { non_empty_count: 10, total_count: 10, entirely_empty: false },
            credit: { non_empty_count: 10, total_count: 10, entirely_empty: true }
          },
          included_job_ids: request.jobs.map((job) => job.job_id),
          groups: empty ? [] : [{
            group_key: 'customer:C001', display_name: '客户A',
            line_count: 10, voucher_count: 5,
            debit_total: '100.00', credit_total: '100.00'
          }]
        }
      };
    },
    async rows(request) {
      state.lastRowsRequest = request;
      const selected = request.row_selection_mode === 'only_selected'
        ? (request.included_rows || []).length
        : 10 - (request.excluded_rows || []).length;
      return {
        ok: true,
        payload: {
          schema_version: 1,
          candidate_line_count: 10,
          included_line_count: selected,
          excluded_line_count: 10 - selected,
          candidate_voucher_count: 5,
          included_voucher_count: 5,
          page: request.page || 1,
          page_size: request.page_size || 50,
          total_pages: 1,
          columns: request.columns || ['date', 'voucher_id', 'debit', 'credit'],
          column_order: request.columns || ['date', 'voucher_id', 'debit', 'credit'],
          column_stats: {
            date: { non_empty_count: selected, total_count: selected, entirely_empty: false },
            voucher_id: { non_empty_count: selected, total_count: selected, entirely_empty: false },
            debit: { non_empty_count: selected, total_count: selected, entirely_empty: false },
            credit: { non_empty_count: 0, total_count: selected, entirely_empty: true }
          },
          rows: [{
            job_id: request.jobs[0].job_id,
            internal_line_key: '3:sheet:2',
            voucher_key: 'V001',
            included: true,
            values: { date: '2025-01-01', voucher_id: 'V001', debit: '100.00', credit: null }
          }],
          row_selection_mode: request.row_selection_mode || 'all_except',
          excluded_rows: request.excluded_rows || [],
          included_rows: request.included_rows || [],
          group_summary: { group_count: 1, groups: [] },
          group_count: 1,
          groups: [],
          limit_exceeded: false,
          limits: request.limits,
          warnings: [],
          dimensions: request.group_by,
          included_job_ids: request.jobs.map((job) => job.job_id)
        }
      };
    },
    async generate(request, outputDir) {
      const file = request.output_mode === 'zip' ? 'split-export.zip' : 'split-export.xlsx';
      fs.writeFileSync(path.join(outputDir, file), 'fake-output');
      return {
        ok: true,
        payload: {
          output_mode: request.output_mode,
          output_file: file,
          group_count: 1,
          matched_lines: 10,
          matched_vouchers: 5,
          manifest: {
            schema_version: 1,
            groups: [{ group_key: 'g1', derived_fields: [{ key: 'x', label: '事项' }] }]
          }
        }
      };
    }
  };

  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: {
      createSplitRunner: () => fakeRunner
    }
  };
}

installStubs();

const { createSplitRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'split-routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/journal-entry-splits', createSplitRouter({
    root: tempRoot,
    requireAuth: (_req, _res, next) => next(),
    runner: require(path.join(ROOT, 'server', 'journal-entry', 'split-runner.js')).createSplitRunner()
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
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function get(pathname, user = 'tester') {
  const response = await fetch(`${base}${pathname}`, { headers: { 'x-user': user } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitForSplitOutput(scopeType, scopeId, outputId, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const latest = await get(`/api/journal-entry-splits/latest?scopeType=${scopeType}&scopeId=${scopeId}`);
    const output = latest.body.output;
    if (output && output.id === outputId && output.status !== 'generating') return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('split output did not finish');
}

function spec(overrides = {}) {
  return {
    scopeType: 'job', scopeId: JOB_ID,
    filters: { months: ['2025-01'] },
    groupBy: 'customer',
    groupOptions: {},
    rowMode: 'matched_only',
    outputMode: 'multi_sheet',
    ...overrides
  };
}

test('split meta exposes dimensions and limits', async () => {
  const response = await get('/api/journal-entry-splits/meta');
  assert.equal(response.status, 200);
  assert.ok(response.body.groupBy.includes('customer'));
  assert.ok(response.body.groupBy.includes('month'));
  assert.equal(response.body.limits.maxGroupsMultiSheet, 200);
  assert.equal(response.body.limits.maxGroupsZip, 500);
  assert.ok(response.body.columns.some((item) => item.id === 'date'));
  assert.ok(response.body.columnGroups.some((item) => item.id === 'core'));
});

test('job preview and dimensions are scoped and structured', async () => {
  const preview = await post('/api/journal-entry-splits/preview', spec());
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.matched_lines, 10);
  assert.equal(preview.body.scope.id, JOB_ID);
  assert.equal(preview.body.groups.length, 1);
  const dimensions = await get(
    `/api/journal-entry-splits/dimensions?scopeType=job&scopeId=${JOB_ID}&dimension=customer&q=客户`
  );
  assert.equal(dimensions.status, 200);
  assert.equal(dimensions.body.options[0].value, 'C001');
  assert.equal(dimensions.body.blank_count, 1);
});

test('selected export columns are validated and persisted in the output snapshot', async () => {
  const columns = ['date', 'voucher_id', 'customer_name'];
  const preview = await post('/api/journal-entry-splits/preview', spec({ columns }));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.selected_columns, columns);
  assert.ok(preview.body.column_stats);
  const generated = await post('/api/journal-entry-splits', {
    ...spec({ columns }),
    expectedIncludedJobIds: preview.body.included_job_ids
  });
  assert.equal(generated.status, 202, JSON.stringify(generated.body));
  const output = await waitForSplitOutput('job', JOB_ID, generated.body.output.id);
  assert.deepEqual(output.snapshot.selected_columns, columns);
  assert.deepEqual(output.snapshot.column_order, columns);

  const empty = await post('/api/journal-entry-splits/preview', spec({ columns: [] }));
  assert.equal(empty.status, 422);
  const unknown = await post('/api/journal-entry-splits/preview', spec({ columns: ['nope'] }));
  assert.equal(unknown.status, 422);
  const duplicate = await post('/api/journal-entry-splits/preview', spec({ columns: ['date', 'date'] }));
  assert.equal(duplicate.status, 422);
});

test('generate creates snapshot, latest and owner-scoped download', async () => {
  const preview = await post('/api/journal-entry-splits/preview', spec());
  const response = await post('/api/journal-entry-splits', {
    ...spec(),
    expectedIncludedJobIds: preview.body.included_job_ids,
    presetId: 'preset-1',
    presetName: '客户模板'
  });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  response.body.output = await waitForSplitOutput('job', JOB_ID, response.body.output.id);
  assert.equal(response.body.output.status, 'completed');
  assert.equal(response.body.output.snapshot.matched_lines, 10);
  assert.equal(response.body.output.snapshot.preset_id, 'preset-1');
  assert.equal(response.body.output.snapshot.preset_name_at_generation, '客户模板');
  assert.equal(response.body.output.download, `/api/journal-entry-splits/${response.body.output.id}/download`);
  const latest = await get(`/api/journal-entry-splits/latest?scopeType=job&scopeId=${JOB_ID}`);
  assert.equal(latest.status, 200);
  assert.equal(latest.body.output.id, response.body.output.id);
  const download = await fetch(`${base}${response.body.output.download}`, {
    headers: { 'x-user': 'tester' }
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'fake-output');
  const hidden = await fetch(`${base}${response.body.output.download}`, {
    headers: { 'x-user': 'someone-else' }
  });
  assert.equal(hidden.status, 404);
});


test('split output delete expires metadata, blocks download, and keeps source job', async () => {
  const preview = await post('/api/journal-entry-splits/preview', spec());
  const generated = await post('/api/journal-entry-splits', {
    ...spec(),
    expectedIncludedJobIds: preview.body.included_job_ids
  });
  assert.equal(generated.status, 202, JSON.stringify(generated.body));
  generated.body.output = await waitForSplitOutput('job', JOB_ID, generated.body.output.id);
  const id = generated.body.output.id;
  const deleted = await fetch(`${base}/api/journal-entry-splits/${id}`, {
    method: 'DELETE',
    headers: { 'x-user': 'tester' }
  });
  assert.equal(deleted.status, 200);
  const latest = await get(`/api/journal-entry-splits/latest?scopeType=job&scopeId=${JOB_ID}`);
  assert.equal(latest.body.output.expired, true);
  assert.equal(latest.body.output.download, null);
  const download = await fetch(`${base}/api/journal-entry-splits/${id}/download`, {
    headers: { 'x-user': 'tester' }
  });
  assert.equal(download.status, 410);
  assert.ok(state.jobs.has(JOB_ID));
});

test('batch scope uses completed children and records excluded files', async () => {
  const response = await post('/api/journal-entry-splits/preview', spec({
    scopeType: 'batch', scopeId: BATCH_ID,
    groupBy: ['customer', 'month']
  }));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.completedFiles, 1);
  assert.equal(response.body.excluded.draft, 1);
  assert.deepEqual(response.body.groupBy, ['customer', 'month']);
  assert.deepEqual(response.body.included_job_ids, [BATCH_JOB_ID]);
});


test('multi-dimension groupBy is accepted and invalid combinations are rejected', async () => {
  const preview = await post('/api/journal-entry-splits/preview', spec({
    groupBy: ['customer', 'month']
  }));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.groupBy, ['customer', 'month']);
  const duplicate = await post('/api/journal-entry-splits/preview', spec({
    groupBy: ['customer', 'customer']
  }));
  assert.equal(duplicate.status, 422);
  const tooMany = await post('/api/journal-entry-splits/preview', spec({
    groupBy: ['account', 'customer', 'month', 'entity']
  }));
  assert.equal(tooMany.status, 422);
});

test('validation rejects full voucher mode, empty results and limits', async () => {
  const full = await post('/api/journal-entry-splits/preview', spec({ rowMode: 'full_voucher' }));
  assert.equal(full.status, 422);
  const empty = await post('/api/journal-entry-splits/preview', spec({ filters: { months: ['2030-01'] } }));
  assert.equal(empty.status, 200);
  assert.equal(empty.body.matched_lines, 0);
  const emptyGenerate = await post('/api/journal-entry-splits', spec({ filters: { months: ['2030-01'] } }));
  assert.equal(emptyGenerate.status, 422);
  const limited = await post('/api/journal-entry-splits', spec({ limits: { max_groups: 1 } }));
  assert.equal(limited.status, 422);
  assert.match(limited.body.error, /超过当前输出上限/);
});

test('stale preview job set is rejected', async () => {
  const response = await post('/api/journal-entry-splits', {
    ...spec(),
    expectedIncludedJobIds: ['00000000-0000-4000-8000-000000000000']
  });
  assert.equal(response.status, 409);
});

test('other users cannot preview another owner job', async () => {
  const response = await post('/api/journal-entry-splits/preview', spec(), 'someone-else');
  assert.equal(response.status, 404);
});


test('preview-rows returns paged rows and validates row selection', async () => {
  const response = await post('/api/journal-entry-splits/preview-rows', {
    ...spec({ columns: ['date', 'voucher_id', 'debit'] }),
    page: 1,
    pageSize: 50
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.candidate_line_count, 10);
  assert.equal(response.body.page, 1);
  assert.equal(response.body.pageSize, 50);
  assert.equal(response.body.rows.length, 1);
  assert.equal(response.body.rows[0].internal_line_key, '3:sheet:2');
  assert.equal(response.body.columns[0], 'date');

  const invalidMode = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    rowSelectionMode: 'all_selected'
  });
  assert.equal(invalidMode.status, 422);

  const tooMany = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    rowSelectionMode: 'all_except',
    excludedRows: Array.from({ length: 5001 }, (_, index) => ({
      job_id: JOB_ID, internal_line_key: `key-${index}`
    }))
  });
  assert.equal(tooMany.status, 422);

  const otherOwner = await post('/api/journal-entry-splits/preview-rows', spec(), 'someone-else');
  assert.equal(otherOwner.status, 404);
});

test('generate persists row selection snapshot and rejects candidate mismatch', async () => {
  const rows = await post('/api/journal-entry-splits/preview-rows', spec());
  const response = await post('/api/journal-entry-splits', {
    ...spec(),
    rowSelectionMode: 'all_except',
    excludedRows: [{ job_id: JOB_ID, internal_line_key: '3:sheet:2' }],
    summaryOverrides: {
      '224103': {
        fields: {
          'summary:auto:224103:part:1': { selected: false }
        }
      }
    },
    expectedIncludedJobIds: rows.body.included_job_ids,
    expectedCandidateLineCount: 10
  });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  const output = await waitForSplitOutput('job', JOB_ID, response.body.output.id);
  assert.equal(output.snapshot.row_selection_mode, 'all_except');
  assert.deepEqual(output.snapshot.excluded_rows, [
    { job_id: JOB_ID, internal_line_key: '3:sheet:2' }
  ]);
  assert.equal(output.snapshot.candidate_line_count, 10);
  assert.equal(output.snapshot.final_line_count, 10);
  assert.equal(output.snapshot.summary_structure_version, 1);
  assert.deepEqual(output.snapshot.summary_rule_overrides, {
    '224103': {
      disabled: false,
      confirmed: false,
      fields: {
        'summary:auto:224103:part:1': { selected: false }
      }
    }
  });
  assert.deepEqual(output.snapshot.summary_derived_fields, [{
    group_key: 'g1',
    derived_fields: [{ key: 'x', label: '事项' }]
  }]);

  const mismatch = await post('/api/journal-entry-splits', {
    ...spec(),
    expectedCandidateLineCount: 9
  });
  assert.equal(mismatch.status, 409);
});


test('preview-rows forwards validated group scope and part', async () => {
  const response = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    previewGroup: {
      dimensions: [{ dimension: 'customer', value: 'C001' }]
    },
    previewPart: 2
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(state.lastRowsRequest.preview_group, {
    dimensions: [{ dimension: 'customer', value: 'C001' }]
  });
  assert.equal(state.lastRowsRequest.preview_part, 2);

  const invalid = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    previewGroup: { dimensions: [] }
  });
  assert.equal(invalid.status, 422);

  const invalidPart = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    previewGroup: {
      dimensions: [{ dimension: 'customer', value: 'C001' }]
    },
    previewPart: 0
  });
  assert.equal(invalidPart.status, 422);
});

test('summary overrides are validated and forwarded', async () => {
  const override = {
    '224103': {
      confirmed: true,
      disabled: false,
      fields: {
        'summary:auto:224103:part:1': {
          selected: true,
          label: '报销人',
          semantic_type: 'person'
        }
      }
    }
  };
  const response = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    summaryOverrides: override
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(state.lastRowsRequest.summary_overrides, override);

  const invalid = await post('/api/journal-entry-splits/preview-rows', {
    ...spec(),
    summaryOverrides: {
      '224103': {
        fields: {
          'summary:auto:224103:part:1': { semantic_type: 'not-a-type' }
        }
      }
    }
  });
  assert.equal(invalid.status, 422);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-ui-result-'));
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_ID = '22222222-2222-4222-8222-222222222222';
const storageRoot = path.join(tempRoot, 'storage', 'journal-entry');
const jobDir = path.join(storageRoot, JOB_ID);
const uiDir = path.join(jobDir, 'ui');
const state = { jobs: new Map() };

function key(index) {
  return `|date|2025-01-0${index}|V/${index} 测试:${index}`;
}

function writeProjection() {
  fs.mkdirSync(uiDir, { recursive: true, mode: 0o700 });
  const summary = {
    schema_version: 1,
    projection_version: 1,
    job_id: JOB_ID,
    generated_at: '2026-01-01T00:00:00+00:00',
    input_metadata: { source_filename: 'large.xlsx', sheet_name: '序时账' },
    cleaning_summary: { raw_row_count: 10, line_count: 10, voucher_count: 5 },
    voucher_summary: { voucher_count: 5 },
    business_classification_summary: {
      business_counts: { 'JE-B001': 3, 'JE-B006': 1 },
      business_labels: { 'JE-B001': '职工薪酬', 'JE-B006': '销售收入' },
      confidence_counts: { HIGH: 2, MEDIUM: 1 },
      classified_count: 4,
      other_count: 1,
      voucher_count: 5
    },
    contra_summary: { analyzed_voucher_count: 5, with_allocations_voucher_count: 4 },
    anomaly_summary: {
      code_counts: { 'JE-A004': 3 },
      finding_count: 3,
      finding_voucher_count: 2,
      finding_severity_counts: { HIGH: 1, LOW: 2 },
      review_rate: '0.4'
    },
    warnings: ['synthetic']
  };
  const rows = [];
  for (let index = 1; index <= 5; index += 1) {
    const classified = index <= 4;
    const row = {
      k: key(index),
      i: `V/${index}`,
      d: `2025-01-0${index}`,
      p: null,
      e: null,
      n: 2,
      td: '100.00',
      tc: '100.00',
      im: '0.00',
      b: index !== 3,
      w: index !== 3,
      fc: index <= 2 ? 1 : 0,
      rc: true,
      rs: index === 1 ? '90.00' : '10.00',
      rl: index === 1 ? 'HIGH' : 'INFO',
      ct: {
        ca: index === 4 ? 0 : 1,
        cu: index === 5 ? 1 : 0,
        cm: 'direct',
        cc: '1.00',
        cf: index === 4 ? ['ambiguous'] : [],
        cw: []
      }
    };
    if (classified) {
      row.bc = index === 4 ? 'JE-B006' : 'JE-B001';
      row.bl = index === 4 ? '销售收入' : '职工薪酬';
      row.bcl = index <= 2 ? 'HIGH' : 'MEDIUM';
      row.bcf = '0.9';
      row.bsc = '90.00';
      row.br = '合成理由';
    }
    rows.push(row);
  }
  const findings = [
    { voucher_key: key(1), voucher_id: 'V/1', date: '2025-01-01', code: 'JE-A004', severity: 'HIGH', risk_score: '90.00', business_group: 'other', reason: 'high' },
    { voucher_key: key(2), voucher_id: 'V/2', date: '2025-01-02', code: 'JE-A004', severity: 'LOW', risk_score: '20.00', business_group: 'other', reason: 'low' },
    { voucher_key: key(2), voucher_id: 'V/2', date: '2025-01-02', code: 'JE-A005', severity: 'LOW', risk_score: '10.00', business_group: 'other', reason: 'low2' }
  ];
  fs.writeFileSync(path.join(uiDir, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(uiDir, 'vouchers.ndjson'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(path.join(uiDir, 'findings.json'), JSON.stringify(findings));
  const details = [];
  const index = {};
  let offset = 0;
  for (let i = 1; i <= 5; i += 1) {
    const detail = {
      voucher: {
        voucher_key: key(i),
        voucher_id: `V/${i}`,
        date: `2025-01-0${i}`,
        line_count: 2,
        exactly_balanced: true,
        is_within_tolerance: true,
        validation_flags: [],
        lines: [
          { sheet_name: '序时账', source_row: i * 2, line_id: '001', account_code: '1002', account_name: '银行存款', debit: '100.00', credit: '0.00', description: 'x', internal_line_key: `3:序时账:${i * 2}` },
          { sheet_name: '序时账', source_row: i * 2 + 1, line_id: '001', account_code: '1122', account_name: '应收账款', debit: '0.00', credit: '100.00', description: 'x', internal_line_key: `3:序时账:${i * 2 + 1}` }
        ],
        business_classification: i <= 4 ? { business_code: 'JE-B001', business_label: '职工薪酬', confidence_level: 'HIGH', score: '90.00', reason: 'r', candidates: [] } : null,
        contra: { allocations: [], unallocated_debit: [], unallocated_credit: [], warnings: [] },
        anomaly: { risk_score: '10.00', risk_level: 'INFO', components: {}, finding_codes: [] }
      },
      findings: findings.filter((finding) => finding.voucher_key === key(i))
    };
    const line = zlib.deflateSync(Buffer.from(`${JSON.stringify(detail)}\n`, 'utf8'));
    details.push(line);
    index[key(i)] = [offset, line.length];
    offset += line.length;
  }
  fs.writeFileSync(path.join(uiDir, 'details.bin'), Buffer.concat(details));
  fs.writeFileSync(path.join(uiDir, 'details.idx.json'), JSON.stringify(index));
}

function installStubs() {
  const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
  require.cache[repositoryPath] = {
    id: repositoryPath, filename: repositoryPath, loaded: true,
    exports: {
      async getJobForOwner(id, owner) {
        const job = state.jobs.get(id);
        return job && job.ownerUsername === owner ? job : null;
      }
    }
  };
}

async function setup() {
  writeProjection();
  fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(jobDir, 'result.json'), '{}');
  fs.writeFileSync(path.join(jobDir, 'journal-entry-analysis-report.xlsx'), 'x');
  state.jobs.set(JOB_ID, {
    id: JOB_ID,
    ownerUsername: 'tester',
    status: 'completed',
    resultPath: `storage/journal-entry/${JOB_ID}/result.json`,
    exportPath: `storage/journal-entry/${JOB_ID}/journal-entry-analysis-report.xlsx`,
    originalFilename: 'large.xlsx'
  });
  installStubs();
  const express = require(path.join(ROOT, 'node_modules', 'express'));
  const { createJournalEntryRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'routes.js'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/journal-entry-analyses', createJournalEntryRouter({
    root: tempRoot,
    storageRoot,
    requireAuth: (_req, _res, next) => next(),
    sameOriginForStateChange: (_req, _res, next) => next(),
    runtime: {
      storageRoot,
      previewRunner: {},
      runner: { jobDir: (id) => path.join(storageRoot, id) }
    }
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

let app;
test.before(async () => { app = await setup(); });
test.after(() => {
  if (app?.server) app.server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function get(urlPath, user = 'tester') {
  const response = await fetch(`${app.base}${urlPath}`, { headers: { 'x-user': user } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('summary is lightweight and canonical summary is preserved', async () => {
  const response = await get(`/api/journal-entry-analyses/${JOB_ID}/summary`);
  assert.equal(response.status, 200);
  assert.equal(response.body.cleaning_summary.voucher_count, 5);
  assert.equal(response.body.anomaly_summary.finding_count, 3);
  assert.equal(response.body.vouchers, undefined);
  assert.equal(response.body.validation_issues, undefined);
});

test('voucher pagination is stable, unique and bounded', async () => {
  const first = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?page=1&pageSize=2`);
  const second = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?page=2&pageSize=2`);
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 5);
  assert.equal(first.body.totalPages, 3);
  assert.equal(first.body.rows.length, 2);
  assert.equal(second.body.rows.length, 2);
  assert.deepEqual(
    [...first.body.rows, ...second.body.rows].map((row) => row.k),
    [1, 2, 3, 4].map(key)
  );
  const capped = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?page=1&pageSize=100000`);
  assert.equal(capped.body.pageSize, 200);
  assert.equal(capped.body.rows.length, 5);
});

test('business, confidence, contra and risk filters are server-side', async () => {
  const business = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?view=business&businessCode=JE-B006`);
  assert.equal(business.body.total, 1);
  assert.equal(business.body.rows[0].bc, 'JE-B006');
  const confidence = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?view=business&confidence=MEDIUM`);
  assert.equal(confidence.body.total, 2);
  const contra = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?view=contra&contra=ambiguous`);
  assert.equal(contra.body.total, 1);
  assert.equal(contra.body.rows[0].k, key(4));
  const risk = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?riskLevel=HIGH`);
  assert.equal(risk.body.total, 1);
  assert.equal(risk.body.rows[0].k, key(1));
  const sorted = await get(`/api/journal-entry-analyses/${JOB_ID}/vouchers?sort=riskScore&pageSize=3`);
  assert.equal(sorted.body.rows[0].k, key(1));
});

test('finding pagination and filters use compact findings', async () => {
  const all = await get(`/api/journal-entry-analyses/${JOB_ID}/findings?page=1&pageSize=2`);
  assert.equal(all.body.total, 3);
  assert.equal(all.body.rows.length, 2);
  assert.equal(all.body.rows[0].voucher_key, key(1));
  const filtered = await get(`/api/journal-entry-analyses/${JOB_ID}/findings?riskLevel=LOW&ruleCode=JE-A005`);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.rows[0].voucher_key, key(2));
  const sorted = await get(`/api/journal-entry-analyses/${JOB_ID}/findings?sort=riskScore`);
  assert.equal(sorted.body.rows[0].risk_score, '90.00');
});

test('voucher detail is lazy, URL safe and preserves internal keys', async () => {
  const response = await get(
    `/api/journal-entry-analyses/${JOB_ID}/vouchers/detail?key=${encodeURIComponent(key(1))}`
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.voucher.lines.length, 2);
  assert.equal(response.body.voucher.lines[0].internal_line_key, '3:序时账:2');
  assert.equal(response.body.findings.length, 1);
  assert.equal(response.body.findings[0].code, 'JE-A004');
  const missing = await get(
    `/api/journal-entry-analyses/${JOB_ID}/vouchers/detail?key=${encodeURIComponent('missing')}`
  );
  assert.equal(missing.status, 404);
});

test('small legacy job builds projection on demand without full-result UI download', async () => {
  const legacyDir = path.join(storageRoot, LEGACY_ID);
  fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });
  const payload = {
    schema_version: 1,
    job_id: LEGACY_ID,
    generated_at: '2026-01-01T00:00:00+00:00',
    input_metadata: { source_filename: 'legacy.xlsx', sheet_name: '序时账' },
    cleaning_summary: { voucher_count: 1 },
    voucher_summary: { voucher_count: 1 },
    business_classification_summary: { voucher_count: 1 },
    contra_summary: { analyzed_voucher_count: 1 },
    anomaly_summary: { finding_count: 0 },
    warnings: [],
    vouchers: [{
      voucher_key: 'legacy-key', voucher_id: 'L1', date: '2025-01-01',
      line_count: 1, total_debit: '1.00', total_credit: '1.00', imbalance: '0.00',
      exactly_balanced: true, is_within_tolerance: true, validation_flags: [],
      lines: [{ sheet_name: '序时账', source_row: 2, line_id: '1', account_code: '1001', account_name: '现金', debit: '1.00', credit: '0.00', description: 'x', internal_line_key: '3:序时账:2' }],
      business_classification: null, contra: null, anomaly: null
    }],
    findings: []
  };
  fs.writeFileSync(path.join(legacyDir, 'result.json'), JSON.stringify(payload));
  state.jobs.set(LEGACY_ID, {
    id: LEGACY_ID, ownerUsername: 'tester', status: 'completed',
    resultPath: `storage/journal-entry/${LEGACY_ID}/result.json`,
    exportPath: null, originalFilename: 'legacy.xlsx'
  });
  const response = await get(`/api/journal-entry-analyses/${LEGACY_ID}/summary`);
  assert.equal(response.status, 200);
  assert.equal(response.body.cleaning_summary.voucher_count, 1);
  assert.ok(fs.existsSync(path.join(legacyDir, 'ui', 'summary.json')));
  assert.ok(fs.existsSync(path.join(legacyDir, 'ui', 'vouchers.ndjson')));
});

test('large legacy job without projection is not exposed as full result', async () => {
  const legacyDir = path.join(storageRoot, LEGACY_ID);
  fs.rmSync(path.join(legacyDir, 'ui'), { recursive: true, force: true });
  const previous = process.env.JOURNAL_ENTRY_LEGACY_PROJECTION_MAX_BYTES;
  process.env.JOURNAL_ENTRY_LEGACY_PROJECTION_MAX_BYTES = '10';
  try {
    const response = await get(`/api/journal-entry-analyses/${LEGACY_ID}/summary`);
    assert.equal(response.status, 409);
    assert.match(response.body.error, /重新分析/);
  } finally {
    if (previous === undefined) delete process.env.JOURNAL_ENTRY_LEGACY_PROJECTION_MAX_BYTES;
    else process.env.JOURNAL_ENTRY_LEGACY_PROJECTION_MAX_BYTES = previous;
  }
});

test('owner isolation returns 404 for summary, pages, findings and detail', async () => {
  for (const urlPath of [
    `/api/journal-entry-analyses/${JOB_ID}/summary`,
    `/api/journal-entry-analyses/${JOB_ID}/vouchers`,
    `/api/journal-entry-analyses/${JOB_ID}/findings`,
    `/api/journal-entry-analyses/${JOB_ID}/vouchers/detail?key=${encodeURIComponent(key(1))}`
  ]) {
    const response = await get(urlPath, 'other-user');
    assert.equal(response.status, 404);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { zipSync } = require('../../private/vendor/fflate/fflate.umd.js');

const { createFlowchartRouter } = require('../../server/flowchart-excel/routes');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'flowchart-excel');
const PNG = fs.readFileSync(path.join(FIXTURE_ROOT, 'one-pixel.png'));
const RAW = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'legacy-minimal.json'), 'utf8'));

let tempRoot;
let server;
let base;

function fakeExportRunner({ outputPath }) {
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(2048)]));
  return { status: 0, stderr: '' };
}

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function makeZip(files) {
  const entries = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = new Uint8Array(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

function makePackage(graphOverride = null) {
  const graph = graphOverride ? JSON.parse(JSON.stringify(graphOverride)) : JSON.parse(JSON.stringify(RAW));
  graph.unresolved_items.push({
    id: 'u_blocking',
    type: 'ambiguous_branch',
    severity: 'medium',
    description: '需要人工确认的判断分支。',
    action: '确认分支端点后再导出。',
    related_ids: ['n_decision']
  });
  const files = {
    'flowchart.json': JSON.stringify(graph),
    'nodes.csv': 'id,label\nn_start,mock\n',
    'edges.csv': 'id,source_node_id,target_node_id\n',
    'style.json': JSON.stringify({
      template_profile_id: 'trade_purchase_cn',
      excel_export_rules: { edit_as: 'pending' }
    }),
    'conversion_report.md': '# Review fixture\n'
  };
  const hashes = {};
  for (const [name, value] of Object.entries(files)) {
    hashes[name] = sha(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  }
  files['manifest.json'] = JSON.stringify({
    schema_version: '1.0.0',
    package_version: '1.0.0',
    generation_mode: 'external_ai',
    ai_extraction_performed_by_website: false,
    source_image: { filename: 'one.png', size: PNG.length, sha256: sha(PNG) },
    files: hashes
  });
  return makeZip(files);
}

function appFor(root) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-user']) req.session = { auth: { username: req.headers['x-user'] } };
    next();
  });
  app.use('/api/flowchart-excel', createFlowchartRouter({ root, maxFileSize: 2 * 1024 * 1024, exportRunner: fakeExportRunner }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
}

async function request(urlPath, { method = 'GET', user = 'alice', origin, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (user) headers['x-user'] = user;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function importJob(user = 'alice', graph = null) {
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'one.png');
  form.append('package', new Blob([makePackage(graph)], { type: 'application/zip' }), 'helper.zip');
  form.append('generationMode', 'external_ai');
  const response = await fetch(`${base}/api/flowchart-excel/jobs/import-helper-package`, {
    method: 'POST',
    headers: { 'x-user': user },
    body: form
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  let job;
  for (let i = 0; i < 80; i += 1) {
    const result = await request(`/api/flowchart-excel/jobs/${body.job.id}`, { user });
    job = result.body.job;
    if (job.status === 'review_required' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(job.status, 'review_required', JSON.stringify(job));
  return job;
}

test.before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-review-'));
  server = await listen(appFor(tempRoot));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('review API requires authentication and same-origin writes', async () => {
  const job = await importJob();
  const unauth = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: null });
  assert.equal(unauth.status, 401);

  const crossOrigin = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT',
    user: 'alice',
    origin: 'http://evil.example',
    body: { expectedRevision: 0, graph: {} }
  });
  assert.equal(crossOrigin.status, 403);
});

test('noncanonical imported control codes stay unresolved and are not auto-mapped', async () => {
  const graph = JSON.parse(JSON.stringify(RAW));
  graph.nodes[1].controls = [{ kind: 'CA', code: 'T.AC1', display: 'badge', attribution_status: 'pending_mapping' }];
  const job = await importJob('alice', graph);
  const review = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const node = review.body.graph.nodes.find((item) => item.id === 'n_process');
  assert.deepEqual(node.controls, []);
  const issue = review.body.issues.find((item) => /T\.AC1/.test(item.description));
  assert.ok(issue);
  assert.equal(issue.type, 'noncanonical_control_code');
  assert.equal(issue.status, 'pending');
  assert.equal(review.body.profile.editAs, 'pending');
});

test('review is owner-scoped and returns actual graph/issues/profile', async () => {
  const job = await importJob('alice');
  const hidden = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'bob' });
  assert.equal(hidden.status, 404);

  const result = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.graph.template_profile_id, 'trade_purchase_cn');
  assert.equal(result.body.profile.editAs, 'pending');
  assert.equal(result.body.profile.exportReady, false);
  assert.equal(result.body.source, 'imported');
  assert.ok(result.body.issues.some((issue) => issue.id === 'u_blocking'));
  assert.ok(result.body.issues.some((issue) => issue.blocking === true));
  assert.ok(Array.isArray(result.body.warnings));
  assert.equal(result.body.progress.total, result.body.issues.length);
});

test('saving validates schema/references and keeps extension metadata', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const graph = initial.body.graph;
  graph.nodes[0].label = '人工确认后的开始';
  graph.nodes[0].confidence = 'low';
  graph.nodes[0].review_status = 'pending';
  graph.nodes[0].extensions = { legacy: { custom_note: 'preserve-me' } };

  const saved = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT',
    user: 'alice',
    body: { expectedRevision: 0, graph }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, 1);

  const reread = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  assert.equal(reread.body.graph.nodes[0].label, '人工确认后的开始');
  assert.equal(reread.body.graph.nodes[0].confidence, 'low');
  assert.equal(reread.body.graph.nodes[0].review_status, 'pending');
  assert.equal(reread.body.graph.nodes[0].extensions.legacy.custom_note, 'preserve-me');
  assert.equal(reread.body.profile.editAs, 'pending');
  assert.equal(reread.body.profile.exportReady, false);

  const badShape = JSON.parse(JSON.stringify(graph));
  badShape.nodes[0].shape = 'not-a-shape';
  const invalid = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT',
    user: 'alice',
    body: { expectedRevision: 1, graph: badShape }
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.code, 'INVALID_GRAPH');

  const dangling = JSON.parse(JSON.stringify(graph));
  dangling.edges[0].target_node_id = 'missing-node';
  const badRef = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT',
    user: 'alice',
    body: { expectedRevision: 1, graph: dangling }
  });
  assert.equal(badRef.status, 422);
  assert.equal(badRef.body.code, 'INVALID_REFERENCES');
});

test('manual branch edges require an explicit label and real endpoints', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const graph = initial.body.graph;
  graph.edges.push({
    id: 'manual_branch',
    source_node_id: 'n_decision',
    target_node_id: 'n_end',
    source_port: 'right',
    target_port: 'left',
    kind: 'branch',
    label: null,
    route_hint: 'manual_review',
    confidence: 'low',
    review_status: 'pending',
    provenance: { source: 'manual_edit', source_ref: 'review_workbench' }
  });
  const missingLabel = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph }
  });
  assert.equal(missingLabel.status, 422);
  assert.equal(missingLabel.body.code, 'BRANCH_LABEL_REQUIRED');

  graph.edges[graph.edges.length - 1].label = '否';
  graph.edges[graph.edges.length - 1].target_node_id = 'missing-node';
  const dangling = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph }
  });
  assert.equal(dangling.status, 422);
  assert.equal(dangling.body.code, 'INVALID_REFERENCES');
});

test('optimistic concurrency rejects stale revisions', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const graph = initial.body.graph;
  const first = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph }
  });
  assert.equal(first.status, 200);
  const stale = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'REVISION_CONFLICT');
});

test('one-click review is explicit, auditable, and does not alter the graph', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const beforeGraph = JSON.stringify(initial.body.graph);
  const pendingCount = initial.body.issues.filter((item) => item.status === 'pending').length;
  assert.ok(pendingCount > 0);

  const unconfirmed = await request(`/api/flowchart-excel/jobs/${job.id}/review/bulk-review`, {
    method: 'POST', user: 'alice', body: { expectedRevision: 0, confirm: false, resolution: 'x' }
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.code, 'CONFIRMATION_REQUIRED');

  const hidden = await request(`/api/flowchart-excel/jobs/${job.id}/review/bulk-review`, {
    method: 'POST', user: 'bob', body: { expectedRevision: 0, confirm: true, resolution: 'x' }
  });
  assert.equal(hidden.status, 404);

  const result = await request(`/api/flowchart-excel/jobs/${job.id}/review/bulk-review`, {
    method: 'POST', user: 'alice', body: { expectedRevision: 0, confirm: true, resolution: '一键复核测试：保留当前识别结果。' }
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.updated.length, pendingCount);
  assert.equal(result.body.revision, 1);

  const reread = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  assert.equal(JSON.stringify(reread.body.graph), beforeGraph);
  assert.equal(reread.body.issues.some((item) => item.status === 'pending'), false);
  assert.ok(reread.body.issues.every((item) => ['resolved', 'waived'].includes(item.status)));
  assert.equal(reread.body.profile.editAs, 'pending');
  assert.equal(reread.body.profile.exportReady, false);

  const history = await request(`/api/flowchart-excel/jobs/${job.id}/review/revisions`, { user: 'alice' });
  assert.equal(history.body.revisions[0].action, 'bulk_reviewed');
  assert.equal(history.body.revisions[0].changes.length, pendingCount);
});

test('issue resolution persists and warnings cannot be edited', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const issueId = 'u_blocking';
  assert.ok(initial.body.issues.some((issue) => issue.id === issueId));

  const updated = await request(`/api/flowchart-excel/jobs/${job.id}/review/issues/${encodeURIComponent(issueId)}`, {
    method: 'PUT',
    user: 'alice',
    body: { expectedRevision: 0, status: 'resolved', resolution: '已对照原始流程确认分支。' }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.issue.status, 'resolved');

  const reread = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  assert.equal(reread.body.issues.find((issue) => issue.id === issueId).status, 'resolved');

  const warning = await request(`/api/flowchart-excel/jobs/${job.id}/review/issues/warning_1`, {
    method: 'PUT',
    user: 'alice',
    body: { expectedRevision: 1, status: 'resolved', resolution: 'forged' }
  });
  assert.equal(warning.status, 404);
});

test('reviewed CSV files are regenerated without overwriting imported artifacts', async () => {
  const job = await importJob('alice');
  const pathBefore = path.join(tempRoot, 'storage', 'flowchart-excel', job.id, 'artifacts', 'nodes.csv');
  const before = fs.readFileSync(pathBefore);
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const graph = initial.body.graph;
  graph.nodes[0].label = '新的节点文字';
  const saved = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph }
  });
  assert.equal(saved.status, 200);
  const after = fs.readFileSync(pathBefore);
  assert.deepEqual(after, before);

  const response = await fetch(`${base}/api/flowchart-excel/jobs/${job.id}/review/files/nodes.reviewed.csv`, {
    headers: { 'x-user': 'alice' }
  });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes[0], 0xef);
  assert.match(bytes.toString('utf8'), /新的节点文字/);

  const reviewed = path.join(tempRoot, 'storage', 'flowchart-excel', job.id, 'review', 'flowchart.reviewed.json');
  assert.equal(fs.existsSync(reviewed), true);
  assert.equal(JSON.parse(fs.readFileSync(reviewed, 'utf8')).nodes[0].label, '新的节点文字');
});

test('approval requires no blocking issues and never opens export', async () => {
  const job = await importJob('alice');
  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const blocked = await request(`/api/flowchart-excel/jobs/${job.id}/review/approve`, {
    method: 'POST', user: 'alice', body: { expectedRevision: 0 }
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'REVIEW_BLOCKED');

  let revision = 0;
  const blocking = initial.body.issues.filter((item) => item.blocking);
  assert.ok(blocking.length > 0);
  for (const issue of blocking) {
    const updated = await request(`/api/flowchart-excel/jobs/${job.id}/review/issues/${encodeURIComponent(issue.id)}`, {
      method: 'PUT', user: 'alice', body: { expectedRevision: revision, status: 'resolved', resolution: '已复核。' }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    revision += 1;
  }
  const approved = await request(`/api/flowchart-excel/jobs/${job.id}/review/approve`, {
    method: 'POST', user: 'alice', body: { expectedRevision: revision }
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.reviewMeta.status, 'review_approved');

  const jobResult = await request(`/api/flowchart-excel/jobs/${job.id}`, { user: 'alice' });
  assert.equal(jobResult.body.job.status, 'review_approved');
  assert.equal(jobResult.body.job.exportReady, false);
});

test('experimental XLSX export is gated by approval and does not open exportReady', async () => {
  const job = await importJob('alice');
  const before = await request(`/api/flowchart-excel/jobs/${job.id}/export-xlsx`, {
    method: 'POST', user: 'alice', body: { mode: 'experimental', anchor: 'default' }
  });
  assert.equal(before.status, 409);
  assert.equal(before.body.code, 'REVIEW_NOT_APPROVED');

  const initial = await request(`/api/flowchart-excel/jobs/${job.id}/review`, { user: 'alice' });
  const saved = await request(`/api/flowchart-excel/jobs/${job.id}/review/graph`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, graph: initial.body.graph }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  let revision = 1;
  for (const issue of initial.body.issues.filter((item) => item.blocking)) {
    const resolved = await request(`/api/flowchart-excel/jobs/${job.id}/review/issues/${encodeURIComponent(issue.id)}`, {
      method: 'PUT', user: 'alice', body: { expectedRevision: revision, status: 'resolved', resolution: '已复核。' }
    });
    assert.equal(resolved.status, 200);
    revision += 1;
  }
  await request(`/api/flowchart-excel/jobs/${job.id}/review/approve`, {
    method: 'POST', user: 'alice', body: { expectedRevision: revision }
  });

  const exported = await request(`/api/flowchart-excel/jobs/${job.id}/export-xlsx`, {
    method: 'POST', user: 'alice', body: { mode: 'experimental', anchor: 'default' }
  });
  assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.mode, 'experimental');
  assert.equal(exported.body.artifact.kind, 'xlsx_candidate');
  assert.ok(exported.body.artifact.bytes > 1000);
  const jobAfter = await request(`/api/flowchart-excel/jobs/${job.id}`, { user: 'alice' });
  assert.equal(jobAfter.body.job.exportReady, false);
});

test('revision history is owner-scoped', async () => {
  const job = await importJob('alice');
  await request(`/api/flowchart-excel/jobs/${job.id}/review/issues/u_blocking`, {
    method: 'PUT', user: 'alice', body: { expectedRevision: 0, status: 'resolved', resolution: 'done' }
  });
  const history = await request(`/api/flowchart-excel/jobs/${job.id}/review/revisions`, { user: 'alice' });
  assert.equal(history.status, 200);
  assert.ok(history.body.revisions.length >= 1);
  assert.equal(history.body.revisions[0].actor, 'alice');

  const hidden = await request(`/api/flowchart-excel/jobs/${job.id}/review/revisions`, { user: 'bob' });
  assert.equal(hidden.status, 404);
});

test('source image is owner-scoped', async () => {
  const job = await importJob('alice');
  const response = await fetch(`${base}/api/flowchart-excel/jobs/${job.id}/source`, {
    headers: { 'x-user': 'alice' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const hidden = await fetch(`${base}/api/flowchart-excel/jobs/${job.id}/source`, {
    headers: { 'x-user': 'bob' }
  });
  assert.equal(hidden.status, 404);
});

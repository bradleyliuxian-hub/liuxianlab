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
const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'flowchart-excel');
const PNG = fs.readFileSync(path.join(FIXTURE_ROOT, 'one-pixel.png'));
const RAW = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'legacy-minimal.json'), 'utf8'));
const OVERLAY = fs.readFileSync(path.join(FIXTURE_ROOT, 'one-pixel.png'));

let tempRoot;
let server;
let base;

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function makeZip(files) {
  const entries = {};
  const buffers = {};
  for (const [name, value] of Object.entries(files)) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    entries[name] = new Uint8Array(buffer);
    buffers[name] = buffer;
  }
  return { zip: Buffer.from(zipSync(entries, { level: 6 })), buffers };
}

function makePackage(overrides = {}) {
  const graph = overrides.graph || RAW;
  const graphText = JSON.stringify(graph);
  const style = overrides.style || {
    template_profile_id: 'trade_purchase_cn',
    excel_export_rules: { edit_as: 'pending' }
  };
  const files = {
    'flowchart.json': graphText,
    'nodes.csv': overrides.nodesCsv || 'id,label\nn1,mock\n',
    'edges.csv': overrides.edgesCsv || 'id,source_node_id,target_node_id\n',
    'style.json': JSON.stringify(style),
    'conversion_report.md': '# External report\n',
    ...(overrides.includeOverlay === false ? {} : { 'review_overlay.png': OVERLAY })
  };
  const hashes = {};
  for (const [name, value] of Object.entries(files)) {
    hashes[name] = sha(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  }
  const sourceImage = {
    filename: overrides.filename || 'one.png',
    size: overrides.imageSize ?? PNG.length,
    sha256: overrides.imageSha256 === undefined ? sha(PNG) : overrides.imageSha256
  };
  const manifest = overrides.legacyManifest
    ? {
        package_schema_version: '1.0.0',
        package_type: 'flowchart_excel_helper_package',
        generation_mode: 'external_ai',
        ai_extraction_performed_by_website: false,
        template_profile: { id: 'trade_purchase_cn' },
        notes: ['legacy external package'],
        source_image: {
          filename: sourceImage.filename,
          width_px: 1402,
          height_px: 1133,
          sha256: sourceImage.sha256
        },
        files: Object.entries(hashes).map(([name, sha256]) => ({ name, sha256 })),
        ...(overrides.manifest || {})
      }
    : {
        schema_version: '1.0.0',
        package_version: '1.0.0',
        generation_mode: 'external_ai',
        ai_extraction_performed_by_website: false,
        source_image: sourceImage,
        files: { ...hashes, ...(overrides.fileHashes || {}) },
        ...(overrides.manifest || {})
      };
  files['manifest.json'] = JSON.stringify(manifest);
  return makeZip(files).zip;
}

async function listen(app) {
  return new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
}

function appFor(root) {
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-user']) req.session = { auth: { username: req.headers['x-user'] } };
    next();
  });
  app.use('/api/flowchart-excel', createFlowchartRouter({ root, maxFileSize: 2 * 1024 * 1024 }));
  return app;
}

async function importPackage(zip, options = {}) {
  const packageBuffer = zip && zip.zip ? zip.zip : zip;
  const form = new FormData();
  form.append('image', new Blob([PNG], { type: 'image/png' }), options.filename || 'one.png');
  form.append('package', new Blob([packageBuffer], { type: 'application/zip' }), options.packageName || 'helper.zip');
  form.append('generationMode', options.generationMode || 'external_ai');
  const response = await fetch(`${base}/api/flowchart-excel/jobs/import-helper-package`, {
    method: 'POST',
    headers: { 'x-user': options.user || 'alice' },
    body: form
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function getJob(id, user = 'alice') {
  const response = await fetch(`${base}/api/flowchart-excel/jobs/${id}`, { headers: { 'x-user': user } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitFor(id, status, user = 'alice') {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const result = await getJob(id, user);
    if (result.body.job?.status === status) return result.body.job;
    if (['failed', 'review_required', 'external_helpers_ready'].includes(result.body.job?.status) && result.body.job.status !== status) {
      return result.body.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${id} did not reach ${status}`);
}

test.before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-external-'));
  server = await listen(appFor(tempRoot));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('external helper package imports into review state without website AI', async () => {
  const result = await importPackage(makePackage());
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const job = await waitFor(result.body.job.id, 'review_required');
  assert.equal(job.workerMode, 'external_import');
  assert.equal(job.generationMode, 'external_ai');
  assert.equal(job.aiExtractionPerformedByWebsite, false);
  assert.equal(job.resultKind, 'external_helper_files');
  assert.equal(job.exportReady, false);
  assert.equal(job.templateProfileId, 'trade_purchase_cn');
  const names = job.artifacts.map((artifact) => artifact.name);
  assert.ok(names.includes('external-helper-package.zip'));
  assert.ok(names.includes('flowchart.json'));
  assert.ok(names.includes('nodes.csv'));
  assert.ok(names.includes('edges.csv'));
  assert.ok(names.includes('style.json'));
  assert.ok(names.includes('conversion_report.md'));
  assert.ok(names.includes('review_overlay.png'));
  assert.ok(names.includes('flowchart-helper-files.zip'));
  assert.ok(names.includes('import-validation-report.json'));
  assert.ok(job.artifacts.every((artifact) => artifact.isMock === false));

  const reportResponse = await fetch(`${base}/api/flowchart-excel/jobs/${result.body.job.id}/artifacts/import-validation-report`, {
    headers: { 'x-user': 'alice' }
  });
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.json();
  assert.equal(report.aiExtractionPerformedByWebsite, false);
  assert.equal(report.edit_as, 'pending');
  assert.equal(report.exportReady, false);
  assert.equal(report.package.entries > 0, true);

  const flowchartResponse = await fetch(`${base}/api/flowchart-excel/jobs/${result.body.job.id}/artifacts/flowchart-json`, {
    headers: { 'x-user': 'alice' }
  });
  const flowchart = await flowchartResponse.json();
  assert.equal(flowchart.template_profile_id, 'trade_purchase_cn');
  assert.equal(flowchart.export_profile.edit_as, 'pending');

  const nodesResponse = await fetch(`${base}/api/flowchart-excel/jobs/${result.body.job.id}/artifacts/nodes-csv`, {
    headers: { 'x-user': 'alice' }
  });
  const nodesBytes = Buffer.from(await nodesResponse.arrayBuffer());
  assert.equal(nodesBytes[0], 0xef);
  assert.equal(nodesBytes[1], 0xbb);
  assert.equal(nodesBytes[2], 0xbf);
  const nodesCsv = nodesBytes.toString('utf8');
  assert.match(nodesCsv, /n_start/); // canonical CSV, not the imported n1,mock row

  const jobDir = path.join(tempRoot, 'storage', 'flowchart-excel', result.body.job.id);
  assert.equal(fs.existsSync(path.join(jobDir, 'vision')), false);
});

test('external AI variant graph is normalized into the target contract', async () => {
  const graph = {
    schema_version: '1.0.0',
    template_profile_id: 'trade_purchase_cn',
    template_profile_version: '1.0.0',
    template_profile_ref: 'docs/agent/flowchart-excel/trade-purchase-template-profile.md',
    document: {
      title: 'External variant',
      source_image: 'one.png',
      image_width_px: 1,
      image_height_px: 1,
      coordinate_space: 'original_image_px for source_bbox_px'
    },
    lanes: [
      {
        id: 'L1',
        label: 'Lane 1',
        order: 1,
        bbox_px: { x: 0, y: 0, width: 1, height: 1 },
        confidence: 'medium',
        review_status: 'pending',
        provenance: { source: 'uploaded_image', method: 'visual_estimation' }
      }
    ],
    nodes: [
      {
        id: 'N1',
        label: 'Start',
        shape: 'terminator',
        lane_id: 'L1',
        bbox: { x: 0, y: 0, width: 0.2, height: 0.2, coordinate_space: 'normalized_image_0_1' },
        source_bbox_px: { x: 0, y: 0, width: 0.2, height: 0.2, coordinate_space: 'original_image_px' },
        controls: [],
        confidence: 'medium',
        review_status: 'pending',
        provenance: { source_image: 'one.png', method: 'external_ai_visual_extraction' }
      }
    ],
    edges: [
      {
        id: 'E1',
        source_node_id: 'N1',
        target_node_id: 'N1',
        source_port: 'right',
        target_port: 'left',
        kind: 'feedback_flow',
        label: '',
        route_hint: 'feedback',
        confidence: 'low',
        review_status: 'pending',
        provenance: { source_image: 'one.png', method: 'external_ai_visual_extraction' }
      }
    ],
    unresolved_items: [
      {
        id: 'U1',
        item_type: 'branch_endpoint',
        description: 'Branch endpoint needs review.',
        related_node_ids: ['N1'],
        confidence: 'low',
        review_status: 'pending',
        recommended_review: 'Confirm the endpoint.'
      }
    ],
    export_profile: { id: 'trade_purchase_cn' }
  };
  const result = await importPackage(makePackage({ graph }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const job = await waitFor(result.body.job.id, 'review_required');
  assert.equal(job.status, 'review_required');
  assert.equal(job.exportReady, false);
  assert.ok(job.warnings.some((warning) => /orientation/.test(warning)));

  const reportResponse = await fetch(`${base}/api/flowchart-excel/jobs/${result.body.job.id}/artifacts/import-validation-report`, {
    headers: { 'x-user': 'alice' }
  });
  const report = await reportResponse.json();
  assert.equal(report.sourceFormat, 'external_ai_variant');
  assert.equal(report.schemaValid, true);
  assert.equal(report.unresolved[0].type, 'ambiguous_branch');
  assert.equal(report.unresolved[0].action, 'Confirm the endpoint.');
});

test('legacy external package manifest shape imports and keeps warnings', async () => {
  const result = await importPackage(makePackage({ legacyManifest: true }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const job = await waitFor(result.body.job.id, 'review_required');
  assert.equal(job.status, 'review_required');
  assert.equal(job.exportReady, false);
  assert.ok(job.warnings.some((warning) => /未提供原图大小/.test(warning)));
});

test('owner isolation applies to external import artifacts', async () => {
  const result = await importPackage(makePackage(), { user: 'alice' });
  const id = result.body.job.id;
  await waitFor(id, 'review_required', 'alice');
  assert.equal((await getJob(id, 'bob')).status, 404);
  const download = await fetch(`${base}/api/flowchart-excel/jobs/${id}/artifacts/flowchart-json`, {
    headers: { 'x-user': 'bob' }
  });
  assert.equal(download.status, 404);
});

test('missing required package file is rejected', async () => {
  const result = await importPackage(makeZip({
    'manifest.json': JSON.stringify({
      generation_mode: 'external_ai',
      ai_extraction_performed_by_website: false,
      source_image: { filename: 'one.png', size: PNG.length, sha256: sha(PNG) },
      files: {}
    })
  }));
  assert.equal(result.status, 201);
  const job = await waitFor(result.body.job.id, 'failed');
  assert.equal(job.status, 'failed');
  assert.match(String(job.errorCode), /PACKAGE_FILE_MISSING|MANIFEST_FILES_MISSING/);
});

test('invalid manifest generation mode is rejected', async () => {
  const result = await importPackage(makePackage({ manifest: { generation_mode: 'real' } }));
  const job = await waitFor(result.body.job.id, 'failed');
  assert.equal(job.errorCode, 'INVALID_MANIFEST');
});

test('manifest hash and source hash mismatches are rejected', async () => {
  const badFileHash = await importPackage(makePackage({ fileHashes: { 'flowchart.json': '0'.repeat(64) } }));
  const badFileJob = await waitFor(badFileHash.body.job.id, 'failed');
  assert.equal(badFileJob.errorCode, 'PACKAGE_FILE_HASH_MISMATCH');

  const badSourceHash = await importPackage(makePackage({ imageSha256: '0'.repeat(64) }));
  const badSourceJob = await waitFor(badSourceHash.body.job.id, 'failed');
  assert.equal(badSourceJob.errorCode, 'SOURCE_IMAGE_HASH_MISMATCH');
});

test('ZIP path traversal and absolute paths are rejected', async () => {
  for (const name of ['../evil.json', '/evil.json', 'nested\\evil.json']) {
    const result = await importPackage(makeZip({
      'manifest.json': '{}',
      [name]: 'evil'
    }));
    const job = await waitFor(result.body.job.id, 'failed');
    assert.ok(['ZIP_PATH_TRAVERSAL', 'ZIP_ABSOLUTE_PATH'].includes(job.errorCode), `${name}: ${job.errorCode}`);
  }
});

test('nested ZIP and duplicate case-insensitive names are rejected', async () => {
  const nested = await importPackage(makeZip({
    'manifest.json': '{}',
    'nodes.csv': 'a',
    'edges.csv': 'b',
    'style.json': '{}',
    'conversion_report.md': 'c',
    'flowchart.json': '{}',
    'inner.zip': 'x'
  }));
  assert.equal((await waitFor(nested.body.job.id, 'failed')).errorCode, 'ZIP_NESTED_ZIP');

  const duplicate = await importPackage(makeZip({
    'manifest.json': '{}',
    'flowchart.json': '{}',
    'nodes.csv': 'a',
    'NODES.CSV': 'b',
    'edges.csv': 'c',
    'style.json': '{}',
    'conversion_report.md': 'd'
  }));
  assert.equal((await waitFor(duplicate.body.job.id, 'failed')).errorCode, 'ZIP_DUPLICATE_NAME');
});

function mutateFirstCentralEntry(zipBuffer, mutate) {
  const buffer = Buffer.from(zipBuffer);
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  mutate(buffer, centralOffset);
  return buffer;
}

test('ZIP bomb, too many entries, encryption and symlinks are rejected', async () => {
  const bomb = makeZip({
    'manifest.json': '{}',
    'flowchart.json': '{}',
    'nodes.csv': 'a',
    'edges.csv': 'b',
    'style.json': '{}',
    'conversion_report.md': Buffer.alloc(11 * 1024 * 1024)
  });
  const bombResult = await importPackage(bomb);
  assert.equal((await waitFor(bombResult.body.job.id, 'failed')).errorCode, 'ZIP_ENTRY_TOO_LARGE');

  const many = {};
  many['manifest.json'] = '{}';
  for (let i = 0; i < 13; i += 1) many[`extra-${i}.txt`] = 'x';
  const manyResult = await importPackage(makeZip(many));
  assert.equal((await waitFor(manyResult.body.job.id, 'failed')).errorCode, 'ZIP_TOO_MANY_FILES');

  const encrypted = mutateFirstCentralEntry(makePackage(), (buffer, central) => {
    buffer.writeUInt16LE(buffer.readUInt16LE(central + 8) | 1, central + 8);
  });
  const encryptedResult = await importPackage(encrypted);
  assert.equal((await waitFor(encryptedResult.body.job.id, 'failed')).errorCode, 'ZIP_ENCRYPTED');

  const symlink = mutateFirstCentralEntry(makePackage(), (buffer, central) => {
    buffer.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  });
  const symlinkResult = await importPackage(symlink);
  assert.equal((await waitFor(symlinkResult.body.job.id, 'failed')).errorCode, 'ZIP_SYMLINK');
});

test('invalid schema and dangling edge are rejected', async () => {
  const invalid = JSON.parse(JSON.stringify(RAW));
  invalid.nodes[0].bbox_px.x = 5000;
  const schemaBad = await importPackage(makePackage({ graph: invalid }));
  assert.equal((await waitFor(schemaBad.body.job.id, 'failed')).status, 'failed');

  const dangling = JSON.parse(JSON.stringify(RAW));
  dangling.edges.push({ id: 'e_dangling', source: 'n_start', target: 'n_missing', kind: 'sequence', confidence: 'high' });
  const danglingBad = await importPackage(makePackage({ graph: dangling }));
  assert.equal((await waitFor(danglingBad.body.job.id, 'failed')).errorCode, 'REFERENCE_VALIDATION_FAILED');
});

test('new contract is used directly and style profile override is rejected', async () => {
  const contract = adaptLegacyFlowchart(JSON.parse(JSON.stringify(RAW)), { sourceFile: 'fixture.json' }).data;
  const direct = await importPackage(makePackage({ graph: contract }));
  const directJob = await waitFor(direct.body.job.id, 'review_required');
  assert.equal(directJob.status, 'review_required');

  const override = await importPackage(makePackage({
    style: { template_profile_id: 'old_sales_flowchart', excel_export_rules: { edit_as: 'oneCell' } }
  }));
  assert.equal((await waitFor(override.body.job.id, 'failed')).errorCode, 'STYLE_PROFILE_OVERRIDE');
});

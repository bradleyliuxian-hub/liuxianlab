'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { unzipSync } = require('../../private/vendor/fflate/fflate.umd.js');
const { createFlowchartService } = require('../../server/flowchart-excel/service');
const { processRawExtraction, runRealWorker } = require('../../server/flowchart-excel/real-worker');
const { validateContract } = require('../../services/flowchart_excel/validator');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'flowchart-excel');
const RAW = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'legacy-minimal.json'), 'utf8'));
const PNG = fs.readFileSync(path.join(FIXTURE_ROOT, 'one-pixel.png'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRealJob(service) {
  return service.createJob({
    ownerUsername: 'alice',
    originalFilename: 'one.png',
    extension: '.png',
    mimeType: 'image/png',
    buffer: PNG,
    sha256: 'c'.repeat(64),
    imageWidth: 2,
    imageHeight: 2,
    workerMode: 'real',
    modelProcessingConsent: true
  });
}

test('real pipeline creates validated helper artifacts from synthetic raw JSON', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-real-'));
  const service = createFlowchartService({ root });
  try {
    const job = createRealJob(service);
    const result = await processRawExtraction({
      store: service,
      jobId: job.id,
      raw: clone(RAW),
      metadata: {
        model: 'mock-vision',
        provider: 'local',
        prompt_version: '1.0.0',
        source_sha256: 'c'.repeat(64),
        source_width: 1000,
        source_height: 800
      },
      overlayPath: path.join(FIXTURE_ROOT, 'one-pixel.png')
    });
    assert.equal(result.ok, true);

    const meta = service.getJobForOwner(job.id, 'alice');
    assert.equal(meta.status, 'helpers_ready');
    assert.equal(meta.workerMode, 'real');
    assert.equal(meta.isMock, false);
    assert.equal(meta.aiExtractionPerformed, true);
    assert.equal(meta.resultKind, 'flowchart_helper_files');
    assert.equal(meta.template_profile_id, 'trade_purchase_cn');
    assert.equal(meta.exportReady || false, false);

    assert.ok(meta.artifacts.every((artifact) => artifact.isMock === false));
    assert.ok(meta.artifacts.some((artifact) => artifact.resultKind === 'flowchart_helper_files'));
    const names = meta.artifacts.map((artifact) => artifact.name).sort();
    assert.deepEqual(names, [
      'conversion_report.md',
      'edges.csv',
      'flowchart-helper-files.zip',
      'flowchart.json',
      'nodes.csv',
      'review_overlay.png',
      'style.json'
    ]);

    const flowchart = JSON.parse(fs.readFileSync(service.resolveArtifact(job.id, 'flowchart-json', 'alice').file, 'utf8'));
    assert.equal(validateContract(flowchart).valid, true);
    assert.equal(flowchart.template_profile_id, 'trade_purchase_cn');
    assert.equal(flowchart.export_profile.edit_as, 'pending');

    const nodesCsv = fs.readFileSync(service.resolveArtifact(job.id, 'nodes-csv', 'alice').file);
    assert.equal(nodesCsv[0], 0xef);
    assert.match(nodesCsv.toString('utf8'), /n_process/);

    const style = JSON.parse(fs.readFileSync(service.resolveArtifact(job.id, 'style-json', 'alice').file, 'utf8'));
    assert.equal(style.template_profile_id, 'trade_purchase_cn');
    assert.equal(style.excel_export_rules.edit_as, 'pending');

    const zip = fs.readFileSync(service.resolveArtifact(job.id, 'helper-files-zip', 'alice').file);
    const entries = Object.keys(unzipSync(new Uint8Array(zip))).sort();
    assert.deepEqual(entries, [
      'conversion_report.md',
      'edges.csv',
      'flowchart.json',
      'nodes.csv',
      'review_overlay.png',
      'style.json'
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real worker spawns Python and stops at missing model configuration without network', async () => {
  const pythonBin = path.join(__dirname, '..', '..', '.flowchart-venv', 'bin', 'python');
  if (!fs.existsSync(pythonBin)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-real-spawn-'));
  const service = createFlowchartService({ root });
  try {
    const job = createRealJob(service);
    const result = await runRealWorker({
      store: service,
      jobId: job.id,
      root,
      pythonBin,
      timeoutMs: 5000,
      env: { PATH: process.env.PATH || '' }
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONFIGURATION_REQUIRED');
    const meta = service.getJobForOwner(job.id, 'alice');
    assert.equal(meta.status, 'failed');
    assert.equal(meta.errorCode, 'CONFIGURATION_REQUIRED');
    assert.equal(fs.existsSync(path.join(service.storageRoot, job.id, 'vision', 'raw-extraction.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid model shape becomes an unresolved item', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-real-schema-'));
  const service = createFlowchartService({ root });
  try {
    const job = createRealJob(service);
    const raw = clone(RAW);
    raw.nodes[0].shape = 'bogus-shape';
    const result = await processRawExtraction({
      store: service,
      jobId: job.id,
      raw,
      metadata: { model: 'mock-vision', provider: 'local' },
      overlayPath: path.join(FIXTURE_ROOT, 'one-pixel.png')
    });
    assert.equal(result.ok, true);
    assert.ok(result.data.unresolved_items.some((item) => item.type === 'unknown_shape'));
    assert.equal(result.data.nodes[0].shape, 'other');
    const meta = service.getJobForOwner(job.id, 'alice');
    assert.equal(meta.status, 'helpers_ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference errors block formal helper artifacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-real-invalid-'));
  const service = createFlowchartService({ root });
  try {
    const job = createRealJob(service);
    const raw = clone(RAW);
    raw.edges.push({
      id: 'e_dangling',
      source: 'n_start',
      target: 'n_missing',
      kind: 'sequence',
      confidence: 'high'
    });
    const result = await processRawExtraction({
      store: service,
      jobId: job.id,
      raw,
      metadata: { model: 'mock-vision', provider: 'local' },
      overlayPath: path.join(FIXTURE_ROOT, 'one-pixel.png')
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'REFERENCE_VALIDATION_FAILED');
    const meta = service.getJobForOwner(job.id, 'alice');
    assert.equal(meta.status, 'failed');
    assert.equal(meta.errorCode, 'REFERENCE_VALIDATION_FAILED');
    assert.equal(meta.aiExtractionPerformed, false);
    assert.equal(meta.artifacts.some((artifact) => artifact.name === 'flowchart.json'), false);
    assert.equal(meta.artifacts.some((artifact) => artifact.name === 'validation-errors.json'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

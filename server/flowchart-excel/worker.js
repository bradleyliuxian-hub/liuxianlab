'use strict';

/*
 * Fake worker for Slice 2.
 *
 * It intentionally does NOT inspect the uploaded image, call a model, or
 * produce real flowchart helper files. It only exercises the job lifecycle
 * and artifact permissions with clearly labelled synthetic artifacts.
 */

const FAKE_WORKER_VERSION = 'fake-1.0.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function active(meta) {
  return meta && !['cancelled', 'failed', 'mock_helpers_ready'].includes(meta.status);
}

function mockResult(meta) {
  return {
    is_mock: true,
    worker_mode: 'fake',
    result_kind: 'synthetic_test_result',
    ai_extraction_performed: false,
    template_profile_id: 'trade_purchase_cn',
    template_profile_version: meta.template_profile_version || '1.0.0',
    warning: 'SYNTHETIC TEST DATA ONLY. The uploaded image was not analyzed.',
    document: {
      title: 'Synthetic mock result',
      source_type: 'image',
      source_image_name: meta.originalFilename,
      source_image_sha256: meta.sourceSha256,
      source_image_size_px: { width: meta.imageWidth, height: meta.imageHeight },
      extraction_status: 'draft_requires_human_validation',
      disclaimer: 'Fake worker output; no AI extraction was performed.'
    },
    lanes: [{ id: 'mock-lane-1', label: 'Mock lane', order: 1, orientation: 'horizontal' }],
    nodes: [
      {
        id: 'mock-node-1',
        label: 'Synthetic mock node',
        shape: 'process',
        lane_id: 'mock-lane-1',
        confidence: 'low',
        review_status: 'pending',
        controls: []
      }
    ],
    edges: [],
    unresolved_items: [
      {
        id: 'mock-unresolved-1',
        type: 'other',
        severity: 'high',
        description: 'This is a synthetic test artifact, not a real flowchart extraction.',
        action: 'Do not use for audit or production.',
        related_ids: [],
        status: 'pending'
      }
    ]
  };
}

function mockReport(meta) {
  return [
    '# Mock job report',
    '',
    '- is_mock: true',
    '- worker_mode: fake',
    '- result_kind: synthetic_test_result',
    '- ai_extraction_performed: false',
    '- template_profile_id: trade_purchase_cn',
    `- job_id: ${meta.id}`,
    '',
    'The uploaded image was not sent to a model and was not analyzed.',
    'The mock result contains fixed synthetic test data only.',
    'Real helper files (flowchart.json, nodes.csv, edges.csv, style.json, conversion_report.md) are not generated in this slice.',
    ''
  ].join('\n');
}

async function runFakeWorker({ store, jobId, delayMs = 40, fail = false }) {
  try {
    let meta = store.readMeta(jobId);
    if (!active(meta) || meta.status !== 'uploaded') return;

    meta = store.updateMeta(jobId, {
      status: 'queued',
      progress: 5,
      progressMessage: 'fake worker 已排队。',
      workerMode: 'fake',
      isMock: true,
      resultKind: 'synthetic_test_result',
      aiExtractionPerformed: false
    });
    if (!active(meta)) return;
    await sleep(delayMs);

    meta = store.readMeta(jobId);
    if (!active(meta)) return;
    meta = store.updateMeta(jobId, {
      status: 'fake_processing',
      progress: 35,
      progressMessage: 'fake worker 正在生成合成测试产物。',
      workerMode: 'fake',
      isMock: true,
      resultKind: 'synthetic_test_result',
      aiExtractionPerformed: false
    });
    if (!active(meta)) return;
    await sleep(delayMs);

    meta = store.readMeta(jobId);
    if (!active(meta)) return;
    if (fail) {
      store.updateMeta(jobId, {
        status: 'failed',
        progress: 100,
        progressMessage: 'fake worker 测试失败。',
        errorCode: 'WORKER_FAILED'
      });
      return;
    }

    const manifest = {
      is_mock: true,
      worker_mode: 'fake',
      result_kind: 'synthetic_test_result',
      ai_extraction_performed: false,
      worker_version: FAKE_WORKER_VERSION,
      template_profile_id: 'trade_purchase_cn',
      template_profile_version: meta.template_profile_version || '1.0.0',
      job_id: meta.id,
      image: {
        filename: meta.originalFilename,
        width: meta.imageWidth,
        height: meta.imageHeight,
        sha256: meta.sourceSha256
      },
      artifacts: ['job-manifest.json', 'mock-result.json', 'mock-report.md']
    };

    store.writeArtifact(jobId, {
      id: 'job-manifest',
      name: 'job-manifest.json',
      kind: 'mock_manifest',
      content: `${JSON.stringify(manifest, null, 2)}\n`
    });
    store.writeArtifact(jobId, {
      id: 'mock-result',
      name: 'mock-result.json',
      kind: 'mock_result',
      content: `${JSON.stringify(mockResult(meta), null, 2)}\n`
    });
    store.writeArtifact(jobId, {
      id: 'mock-report',
      name: 'mock-report.md',
      kind: 'mock_report',
      content: mockReport(meta)
    });

    meta = store.readMeta(jobId);
    if (!active(meta)) return;
    store.updateMeta(jobId, {
      status: 'mock_helpers_ready',
      progress: 100,
      progressMessage: 'fake worker 合成测试产物已生成；未执行真实图片识别。',
      errorCode: null
    });
  } catch (_error) {
    try {
      store.updateMeta(jobId, {
        status: 'failed',
        progress: 100,
        progressMessage: 'fake worker 失败。',
        errorCode: 'WORKER_FAILED'
      });
    } catch (__) {}
  }
}

module.exports = { runFakeWorker, FAKE_WORKER_VERSION };

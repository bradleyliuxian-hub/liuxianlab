'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');
const { validateContract } = require('../../services/flowchart_excel/validator');
const { validateReferences } = require('../../services/flowchart_excel/reference_validator');
const { buildHelperArtifacts } = require('./artifacts');

const REAL_WORKER_VERSION = 'real-1.0.0';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const activeChildren = new Map();

function safeWarning(warning) {
  if (!warning) return null;
  if (typeof warning === 'string') return warning;
  return [warning.code, warning.path, warning.message].filter(Boolean).join(': ');
}

function failJob(store, jobId, code, message, details = null) {
  try {
    if (details) {
      store.writeArtifact(jobId, {
        id: 'validation-errors',
        name: 'validation-errors.json',
        kind: 'validation_error',
        content: `${JSON.stringify({ code, message, details: details.slice(0, 50) }, null, 2)}\n`
      });
    }
  } catch (_) {}
  try {
    store.updateMeta(jobId, {
      status: 'failed',
      progress: 100,
      progressMessage: message,
      errorCode: code,
      aiExtractionPerformed: false,
      resultKind: 'error',
      workerVersion: REAL_WORKER_VERSION
    });
  } catch (_) {}
}

/**
 * Turn a verified raw model response into helper artifacts.
 * Exported separately so it can be tested without network or Python.
 */
async function processRawExtraction({ store, jobId, raw, metadata = {}, overlayPath = null, extraWarnings = [] }) {
  const meta = store.readMeta(jobId);
  if (!meta || meta.status === 'cancelled') return { ok: false, code: 'CANCELLED' };

  store.updateMeta(jobId, {
    status: 'normalizing',
    progress: 55,
    progressMessage: '正在规范化模型结果。',
    workerMode: 'real',
    isMock: false,
    workerVersion: REAL_WORKER_VERSION
  });

  const adapted = adaptLegacyFlowchart(raw, { sourceFile: 'model-raw-extraction.json' });
  if (!adapted.ok) {
    const details = (adapted.errors || []).map((error) => ({
      code: error.code,
      path: error.path || '',
      message: error.message || ''
    }));
    failJob(store, jobId, 'INVALID_MODEL_OUTPUT', '模型输出无法转换为统一契约。', details);
    return { ok: false, code: 'INVALID_MODEL_OUTPUT' };
  }

  const schema = validateContract(adapted.data);
  if (!schema.valid) {
    failJob(store, jobId, 'SCHEMA_VALIDATION_FAILED', '模型输出未通过 Schema 校验。', schema.errors);
    return { ok: false, code: 'SCHEMA_VALIDATION_FAILED' };
  }

  const references = validateReferences(adapted.data);
  if (!references.valid) {
    failJob(store, jobId, 'REFERENCE_VALIDATION_FAILED', '模型输出存在跨引用错误。', references.errors);
    return { ok: false, code: 'REFERENCE_VALIDATION_FAILED' };
  }

  store.updateMeta(jobId, {
    status: 'validating_graph',
    progress: 72,
    progressMessage: '正在校验跨引用和导出 gate。'
  });

  const warnings = [
    ...(adapted.warnings || []).map(safeWarning),
    ...(references.warnings || []).map(safeWarning),
    ...(extraWarnings || []).filter(Boolean)
  ].filter(Boolean);

  store.updateMeta(jobId, {
    status: 'building_helpers',
    progress: 88,
    progressMessage: '正在生成辅助阅读文件。'
  });

  const built = buildHelperArtifacts({
    store,
    jobId,
    data: adapted.data,
    metadata,
    overlayPath,
    warnings
  });
  const allWarnings = [...warnings, ...(built.warnings || [])];

  store.updateMeta(jobId, {
    status: 'helpers_ready',
    progress: 100,
    progressMessage: '辅助阅读文件已生成，等待人工复核；Excel 导出 gate 仍关闭。',
    workerMode: 'real',
    isMock: false,
    resultKind: 'flowchart_helper_files',
    aiExtractionPerformed: true,
    workerVersion: REAL_WORKER_VERSION,
    warnings: allWarnings,
    unresolvedCount: (adapted.data.unresolved_items || []).length,
    exportReady: false,
    errorCode: null
  });

  return { ok: true, data: adapted.data, warnings: allWarnings, references };
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Spawn the Python stage-1 worker, then adapt/validate/build in Node.
 */
function runRealWorker({
  store,
  jobId,
  root,
  projectRoot = path.resolve(__dirname, '..', '..'),
  pythonBin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  env = process.env
}) {
  return new Promise((resolve) => {
    const meta = store.readMeta(jobId);
    if (!meta || meta.status !== 'uploaded' || meta.workerMode !== 'real') {
      resolve({ ok: false, code: 'NOT_RUNNABLE' });
      return;
    }

    const dir = path.join(root, 'storage', 'flowchart-excel', jobId);
    const logPath = path.join(dir, 'worker.log');
    let logFd;
    try {
      logFd = fs.openSync(logPath, 'a', 0o600);
    } catch (_) {
      failJob(store, jobId, 'WORKER_LOG_FAILED', '无法创建 worker 日志。');
      resolve({ ok: false, code: 'WORKER_LOG_FAILED' });
      return;
    }

    store.updateMeta(jobId, {
      status: 'queued',
      progress: 5,
      progressMessage: '真实识别 worker 已排队。',
      workerMode: 'real',
      isMock: false,
      workerVersion: REAL_WORKER_VERSION
    });

    let child;
    try {
      child = spawnImpl(pythonBin, [
        '-m', 'services.flowchart_excel.vision_worker',
        '--job-dir', dir
      ], {
        cwd: projectRoot,
        stdio: ['ignore', logFd, logFd],
        env: { ...env, PYTHONUNBUFFERED: '1' }
      });
    } catch (_) {
      try { fs.closeSync(logFd); } catch (__) {}
      failJob(store, jobId, 'WORKER_FAILED', '无法启动真实识别 worker。');
      resolve({ ok: false, code: 'WORKER_FAILED' });
      return;
    }
    activeChildren.set(jobId, child);

    store.updateMeta(jobId, {
      status: 'validating_image',
      progress: 12,
      progressMessage: '正在完整解码并校验图片。'
    });

    store.updateMeta(jobId, {
      status: 'extracting',
      progress: 30,
      progressMessage: '真实识别 worker 正在解码图片并调用模型。'
    });

    let finished = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 5000).unref?.();
      failJob(store, jobId, 'WORKER_TIMEOUT', '真实识别超时，任务已终止。');
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    child.on('error', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      failJob(store, jobId, 'WORKER_FAILED', '真实识别 worker 无法启动。');
      resolve({ ok: false, code: 'WORKER_FAILED' });
    });

    child.on('close', async (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      activeChildren.delete(jobId);
      try { fs.closeSync(logFd); } catch (_) {}
      if (timedOut) {
        resolve({ ok: false, code: 'WORKER_TIMEOUT' });
        return;
      }

      const current = store.readMeta(jobId);
      if (!current || current.status === 'cancelled') {
        resolve({ ok: false, code: 'CANCELLED' });
        return;
      }

      if (code !== 0) {
        const error = readJsonIfExists(path.join(dir, 'vision', 'error.json')) || {};
        const errorCode = typeof error.code === 'string' ? error.code : 'WORKER_FAILED';
        const message = typeof error.message === 'string' ? error.message : '真实识别 worker 失败。';
        failJob(store, jobId, errorCode, message.slice(0, 300));
        resolve({ ok: false, code: errorCode });
        return;
      }

      const raw = readJsonIfExists(path.join(dir, 'vision', 'raw-extraction.json'));
      if (!raw) {
        failJob(store, jobId, 'INVALID_MODEL_OUTPUT', '真实识别 worker 未生成有效 JSON。');
        resolve({ ok: false, code: 'INVALID_MODEL_OUTPUT' });
        return;
      }
      const metadata = readJsonIfExists(path.join(dir, 'vision', 'metadata.json')) || {};
      try {
        const result = await processRawExtraction({
          store,
          jobId,
          raw,
          metadata,
          overlayPath: path.join(dir, 'vision', 'review_overlay.png'),
          extraWarnings: metadata.overlay_warning ? [metadata.overlay_warning] : []
        });
        resolve(result);
      } catch (_) {
        failJob(store, jobId, 'WORKER_FAILED', '辅助文件生成失败。');
        resolve({ ok: false, code: 'WORKER_FAILED' });
      }
    });
  });
}

function cancelRealWorker(jobId) {
  const child = activeChildren.get(jobId);
  if (!child) return false;
  try { child.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 3000).unref?.();
  return true;
}

module.exports = { runRealWorker, processRawExtraction, cancelRealWorker, REAL_WORKER_VERSION };

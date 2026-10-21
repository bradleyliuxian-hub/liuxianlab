'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { runFakeWorker } = require('./worker');
const { runRealWorker, cancelRealWorker } = require('./real-worker');
const { importHelperPackage } = require('./external-import');
const { getPythonBin } = require('./model-config');

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEMPLATE_PROFILE_ID = 'trade_purchase_cn';
const TEMPLATE_PROFILE_VERSION = '1.0.0';
const FAKE_WORKER_VERSION = 'fake-1.0.0';
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 50_000_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CANCELLABLE_STATUSES = new Set([
  'uploaded', 'queued', 'fake_processing',
  'validating_image', 'extracting', 'normalizing', 'validating_graph', 'building_helpers'
]);

class FlowchartJobError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'FlowchartJobError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function atomicWrite(filePath, data) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'image.png')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || 'image.png';
}

function publicJob(meta) {
  if (!meta) return null;
  return {
    id: meta.id,
    originalFilename: meta.originalFilename,
    fileSize: meta.fileSize,
    imageWidth: meta.imageWidth,
    imageHeight: meta.imageHeight,
    status: meta.status,
    progress: meta.progress,
    progressMessage: meta.progressMessage,
    templateProfileId: meta.template_profile_id,
    templateProfileVersion: meta.template_profile_version,
    workerMode: meta.workerMode,
    isMock: meta.isMock,
    resultKind: meta.resultKind,
    generationMode: meta.generationMode || null,
    aiExtractionPerformed: meta.aiExtractionPerformed,
    aiExtractionPerformedByWebsite: meta.aiExtractionPerformedByWebsite === true,
    artifacts: Array.isArray(meta.artifacts) ? meta.artifacts : [],
    warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
    unresolvedCount: meta.unresolvedCount || 0,
    exportReady: meta.exportReady === true,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    expiresAt: meta.expiresAt,
    errorCode: meta.errorCode || null,
    workerVersion: meta.workerVersion
  };
}

function createFlowchartService({
  root,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxPixels = DEFAULT_MAX_PIXELS,
  retentionMs = DEFAULT_RETENTION_MS,
  fakeWorkerDelayMs = 40,
  fakeWorkerFail = false,
  realWorkerOptions = null
} = {}) {
  if (!root) throw new Error('root is required');
  const storageRoot = path.join(root, 'storage', 'flowchart-excel');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });

  function jobDir(jobId) {
    const value = String(jobId || '');
    if (!JOB_ID_RE.test(value)) return null;
    return path.join(storageRoot, value);
  }

  function metaPath(jobId) {
    const dir = jobDir(jobId);
    return dir ? path.join(dir, 'meta.json') : null;
  }

  function statusPath(jobId) {
    const dir = jobDir(jobId);
    return dir ? path.join(dir, 'status.json') : null;
  }

  function artifactsDir(jobId) {
    const dir = jobDir(jobId);
    return dir ? path.join(dir, 'artifacts') : null;
  }

  function readMeta(jobId) {
    const file = metaPath(jobId);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function writeStatus(meta) {
    const file = statusPath(meta.id);
    if (!file) return;
    atomicWrite(file, `${JSON.stringify({
      status: meta.status,
      progress: meta.progress,
      message: meta.progressMessage,
      is_mock: meta.isMock,
      worker_mode: meta.workerMode,
      ai_extraction_performed: meta.aiExtractionPerformed,
      updated_at: meta.updatedAt
    }, null, 2)}\n`);
  }

  function writeMeta(meta) {
    const file = metaPath(meta.id);
    if (!file) throw new FlowchartJobError('INVALID_JOB_ID', '无效的任务编号。', 400);
    atomicWrite(file, `${JSON.stringify(meta, null, 2)}\n`);
    writeStatus(meta);
  }

  function updateMeta(jobId, patch) {
    const current = readMeta(jobId);
    if (!current) throw new FlowchartJobError('JOB_NOT_FOUND', '任务不存在。', 404);
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    writeMeta(next);
    return next;
  }

  function createJob({
    ownerUsername,
    originalFilename,
    extension,
    mimeType,
    buffer,
    sha256,
    imageWidth,
    imageHeight,
    workerMode = 'fake',
    modelProcessingConsent = false,
    generationMode = null
  }) {
    if (!ownerUsername) throw new FlowchartJobError('UNAUTHENTICATED', '请先登录。', 401);
    const id = crypto.randomUUID();
    const dir = jobDir(id);
    if (!dir) throw new FlowchartJobError('INVALID_JOB_ID', '无法创建任务编号。', 500);
    const ext = String(extension || '').toLowerCase().replace(/^\./, '');
    const sourceFile = `source.${ext}`;
    const createdAt = nowIso();
    const meta = {
      id,
      ownerUsername,
      originalFilename: safeOriginalName(originalFilename),
      sourceExt: ext,
      sourceFile,
      mimeType,
      fileSize: buffer.length,
      imageWidth,
      imageHeight,
      sourceSha256: sha256,
      status: 'uploaded',
      progress: 0,
      progressMessage: workerMode === 'real' ? '已上传，等待真实识别 worker。' : '已上传，等待 fake worker。',
      template_profile_id: TEMPLATE_PROFILE_ID,
      template_profile_version: TEMPLATE_PROFILE_VERSION,
      workerMode,
      generationMode,
      isMock: workerMode === 'fake',
      resultKind: workerMode === 'real' ? 'pending' : (workerMode === 'external_import' ? 'pending' : 'synthetic_test_result'),
      aiExtractionPerformed: false,
      aiExtractionPerformedByWebsite: false,
      modelProcessingConsent: Boolean(modelProcessingConsent),
      workerVersion: workerMode === 'real' ? 'real-pending' : (workerMode === 'external_import' ? 'external-import-1.0.0' : FAKE_WORKER_VERSION),
      artifacts: [],
      warnings: workerMode === 'fake' ? ['此任务使用 fake worker，没有执行真实图片识别。'] : [],
      unresolvedCount: 0,
      exportReady: false,
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + retentionMs).toISOString()
    };

    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, sourceFile), buffer, { mode: 0o600 });
      writeMeta(meta);
      return publicJob(meta);
    } catch (error) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      throw new FlowchartJobError('STORAGE_WRITE_FAILED', '服务器无法保存图片。', 500);
    }
  }

  function getJobForOwner(jobId, ownerUsername) {
    const meta = readMeta(jobId);
    if (!meta || meta.ownerUsername !== ownerUsername) return null;
    return meta;
  }

  function listJobsForOwner(ownerUsername) {
    if (!fs.existsSync(storageRoot)) return [];
    const jobs = [];
    for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_RE.test(entry.name)) continue;
      const meta = readMeta(entry.name);
      if (meta && meta.ownerUsername === ownerUsername) jobs.push(publicJob(meta));
    }
    return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function cancel(jobId, ownerUsername) {
    const meta = getJobForOwner(jobId, ownerUsername);
    if (!meta) throw new FlowchartJobError('JOB_NOT_FOUND', '任务不存在。', 404);
    if (!CANCELLABLE_STATUSES.has(meta.status)) {
      throw new FlowchartJobError('JOB_NOT_CANCELLABLE', '任务已进入不可取消状态。', 409);
    }
    const cancelled = publicJob(updateMeta(jobId, {
      status: 'cancelled',
      progress: Math.min(99, Number(meta.progress) || 0),
      progressMessage: '任务已取消。'
    }));
    if (meta.workerMode === 'real') cancelRealWorker(jobId);
    return cancelled;
  }

  function resolveSource(jobId, ownerUsername) {
    const meta = getJobForOwner(jobId, ownerUsername);
    if (!meta || !meta.sourceFile) return null;
    const dir = jobDir(jobId);
    const file = dir ? path.join(dir, meta.sourceFile) : null;
    if (!file || path.basename(file) !== meta.sourceFile || !fs.existsSync(file)) return null;
    return { meta, file };
  }

  function listArtifacts(jobId, ownerUsername) {
    const meta = getJobForOwner(jobId, ownerUsername);
    if (!meta) return null;
    return Array.isArray(meta.artifacts) ? meta.artifacts : [];
  }

  function resolveArtifact(jobId, artifactId, ownerUsername) {
    const meta = getJobForOwner(jobId, ownerUsername);
    if (!meta || !ARTIFACT_ID_RE.test(String(artifactId || ''))) return null;
    const artifact = (meta.artifacts || []).find((item) => item.id === artifactId);
    if (!artifact) return null;
    const dir = artifactsDir(jobId);
    const file = dir ? path.join(dir, artifact.name) : null;
    if (!file || path.basename(file) !== artifact.name || !fs.existsSync(file)) return null;
    return { meta, artifact, file };
  }

  function writeArtifact(jobId, { id, name, kind, content }) {
    const meta = readMeta(jobId);
    if (!meta) throw new FlowchartJobError('JOB_NOT_FOUND', '任务不存在。', 404);
    const dir = artifactsDir(jobId);
    if (!dir) throw new FlowchartJobError('INVALID_JOB_ID', '无效的任务编号。', 400);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    atomicWrite(file, content);
    const artifact = {
      id,
      name,
      kind,
      bytes: Buffer.byteLength(content),
      isMock: meta.isMock === true,
      resultKind: meta.isMock === true ? 'synthetic_test_result' : (name === 'validation-errors.json' ? 'validation_error' : 'flowchart_helper_files')
    };
    updateMeta(jobId, {
      artifacts: [...(meta.artifacts || []).filter((item) => item.id !== id), artifact]
    });
    return artifact;
  }

  function startFakeWorker(jobId) {
    const meta = readMeta(jobId);
    if (!meta || meta.status !== 'uploaded' || meta.workerMode !== 'fake') return;
    setImmediate(() => {
      runFakeWorker({
        store: {
          readMeta,
          updateMeta,
          writeArtifact
        },
        jobId,
        delayMs: fakeWorkerDelayMs,
        fail: fakeWorkerFail
      }).catch(() => {});
    });
  }

  function startExternalImport(jobId, packageBuffer) {
    const meta = readMeta(jobId);
    if (!meta || meta.workerMode !== 'external_import') return;
    setImmediate(() => {
      importHelperPackage({ store: service, jobId, packageBuffer }).catch((error) => {
        try {
          updateMeta(jobId, {
            status: 'failed',
            progress: 100,
            progressMessage: '外部辅助文件导入失败。',
            errorCode: error?.code || 'IMPORT_FAILED',
            aiExtractionPerformedByWebsite: false,
            exportReady: false
          });
        } catch (_) {}
      });
    });
  }

  function startRealWorker(jobId) {
    const meta = readMeta(jobId);
    if (!meta || meta.status !== 'uploaded' || meta.workerMode !== 'real') return;
    const pythonBin = getPythonBin(root);
    if (!pythonBin) {
      updateMeta(jobId, {
        status: 'failed',
        progress: 100,
        progressMessage: '真实识别环境未配置。',
        errorCode: 'PYTHON_ENV_MISSING'
      });
      return;
    }
    setImmediate(() => {
      runRealWorker({
        ...(realWorkerOptions || {}),
        store: {
          readMeta,
          updateMeta,
          writeArtifact
        },
        jobId,
        root,
        pythonBin,
        timeoutMs: Number(process.env.FLOWCHART_WORKER_TIMEOUT_MS || 10 * 60 * 1000)
      }).catch((error) => {
        try {
          updateMeta(jobId, {
            status: 'failed',
            progress: 100,
            progressMessage: '真实识别 worker 失败。',
            errorCode: error?.code || 'WORKER_FAILED',
            aiExtractionPerformed: false
          });
        } catch (_) {}
      });
    });
  }

  function cleanupExpired() {
    if (!fs.existsSync(storageRoot)) return 0;
    let removed = 0;
    const cutoff = Date.now();
    for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_RE.test(entry.name)) continue;
      const meta = readMeta(entry.name);
      if (!meta) continue;
      const expires = Date.parse(meta.expiresAt || '');
      if (Number.isFinite(expires) && expires <= cutoff) {
        try {
          fs.rmSync(jobDir(entry.name), { recursive: true, force: true });
          removed += 1;
        } catch (_) {}
      }
    }
    return removed;
  }

  const service = {
    storageRoot,
    jobDir,
    maxFileSize,
    maxPixels,
    retentionMs,
    createJob,
    readMeta,
    updateMeta,
    writeArtifact,
    getJobForOwner,
    listJobsForOwner,
    cancel,
    listArtifacts,
    resolveSource,
    resolveArtifact,
    startFakeWorker,
    startRealWorker,
    startExternalImport,
    cleanupExpired,
    publicJob
  };
  return service;
}

module.exports = {
  createFlowchartService,
  FlowchartJobError,
  JOB_ID_RE,
  TEMPLATE_PROFILE_ID,
  TEMPLATE_PROFILE_VERSION,
  FAKE_WORKER_VERSION
};

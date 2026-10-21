'use strict';

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');

const { createFlowchartService, FlowchartJobError, JOB_ID_RE } = require('./service');
const { getModelConfigStatus } = require('./model-config');
const { validateUpload } = require('./image');
const {
  getReview,
  saveGraph,
  updateIssue,
  bulkReview,
  approve,
  exportXlsx,
  listRevisions,
  readReviewFile
} = require('./review');

const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 50_000_000;
const MAX_PACKAGE_SIZE = 15 * 1024 * 1024;
const reviewJson = express.json({ limit: '5mb' });

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function requireUser() {
  return (req, res, next) => {
    if (ownerUsername(req)) return next();
    return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录。' });
  };
}

function publicArtifacts(artifacts) {
  return (artifacts || []).map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    bytes: artifact.bytes,
    isMock: artifact.isMock === true,
    resultKind: artifact.resultKind || null
  }));
}

function createFlowchartRouter({
  root,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxPixels = DEFAULT_MAX_PIXELS,
  retentionMs,
  fakeWorkerDelayMs,
  fakeWorkerFail = false,
  modelConfigStatus = getModelConfigStatus,
  exportRunner = null,
  comingSoon = false
} = {}) {
  if (!root) throw new Error('root is required');
  const service = createFlowchartService({
    root,
    maxFileSize,
    maxPixels,
    retentionMs,
    fakeWorkerDelayMs,
    fakeWorkerFail
  });
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: service.maxFileSize, files: 1, fields: 4 },
    defParamCharset: 'utf8'
  });
  const externalUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: service.maxFileSize, files: 2, fields: 8 },
    defParamCharset: 'utf8'
  });

  function receiveUpload(req, res, next) {
    upload.single('file')(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', message: '图片超过大小限制。' });
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ ok: false, code: 'TOO_MANY_FILES', message: '一次只能上传一张图片。' });
      }
      return res.status(400).json({ ok: false, code: 'UPLOAD_FAILED', message: '图片上传失败。' });
    });
  }

  function receiveExternalUpload(req, res, next) {
    externalUpload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'package', maxCount: 1 }
    ])(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', message: '上传文件超过大小限制。' });
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ ok: false, code: 'TOO_MANY_FILES', message: '外部导入只允许一个图片和一个 ZIP。' });
      }
      return res.status(400).json({ ok: false, code: 'UPLOAD_FAILED', message: '文件上传失败。' });
    });
  }

  router.use(requireUser());

  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const origin = req.get('origin');
    if (!origin) return next();
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch (_) {}
    return res.status(403).json({ ok: false, code: 'ACCESS_DENIED', message: '请求来源无效。' });
  });

  if (comingSoon) {
    router.use((req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      return res.status(503).json({
        ok: false,
        code: 'FEATURE_COMING_SOON',
        message: '流程图转 Excel 功能暂未开放，当前版本正在封存评估中。'
      });
    });
  }

  router.get('/meta', (_req, res) => {
    const status = modelConfigStatus();
    return res.json({
      ok: true,
      templateProfileId: 'trade_purchase_cn',
      templateProfileVersion: '1.0.0',
      editAs: 'pending',
      comingSoon: Boolean(comingSoon),
      featureStatus: comingSoon ? 'coming-soon' : 'active',
      modelConfiguration: {
        configured: Boolean(status.configured),
        missingVariables: Array.isArray(status.missingVariables) ? status.missingVariables : [],
        provider: status.provider || 'openai-compatible'
      },
      realWorkerAvailable: Boolean(status.configured),
      requiresModelProcessingConsent: true
    });
  });

  router.post('/jobs/import-helper-package', receiveExternalUpload, (req, res) => {
    try {
      const imageFile = req.files?.image?.[0];
      const packageFile = req.files?.package?.[0];
      if (!imageFile) {
        return res.status(400).json({ ok: false, code: 'NO_IMAGE', message: '请提供原始流程图图片。' });
      }
      if (!packageFile) {
        return res.status(400).json({ ok: false, code: 'NO_PACKAGE', message: '请提供外部辅助文件 ZIP。' });
      }
      if (String(req.body?.generationMode || '') !== 'external_ai') {
        return res.status(400).json({ ok: false, code: 'INVALID_GENERATION_MODE', message: 'generationMode 必须是 external_ai。' });
      }
      if (packageFile.size > MAX_PACKAGE_SIZE) {
        return res.status(413).json({ ok: false, code: 'PACKAGE_TOO_LARGE', message: '辅助文件 ZIP 超过大小限制。' });
      }
      const originalFilename = path.basename(String(imageFile.originalname || 'image.png'));
      const extension = path.extname(originalFilename).toLowerCase();
      const validation = validateUpload({
        buffer: imageFile.buffer,
        originalFilename,
        mimeType: imageFile.mimetype,
        maxPixels: service.maxPixels
      });
      if (!validation.ok) {
        return res.status(validation.status || 400).json({
          ok: false,
          code: validation.code,
          message: validation.message
        });
      }
      const job = service.createJob({
        ownerUsername: ownerUsername(req),
        originalFilename,
        extension,
        mimeType: imageFile.mimetype,
        buffer: imageFile.buffer,
        sha256: crypto.createHash('sha256').update(imageFile.buffer).digest('hex'),
        imageWidth: validation.width,
        imageHeight: validation.height,
        workerMode: 'external_import',
        generationMode: 'external_ai'
      });
      service.startExternalImport(job.id, packageFile.buffer);
      return res.status(201).json({ ok: true, job });
    } catch (error) {
      if (error instanceof FlowchartJobError) {
        return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      }
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '无法创建外部导入任务。' });
    }
  });

  router.get('/jobs', (req, res) => {
    try {
      service.cleanupExpired();
      return res.json({ ok: true, jobs: service.listJobsForOwner(ownerUsername(req)) });
    } catch (error) {
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '无法读取任务列表。' });
    }
  });

  router.post('/jobs', receiveUpload, (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, code: 'NO_FILE', message: '请选择一张 PNG / JPG / WebP 图片。' });
      }
      const originalFilename = path.basename(String(req.file.originalname || 'image.png'));
      const extension = path.extname(originalFilename).toLowerCase();
      const validation = validateUpload({
        buffer: req.file.buffer,
        originalFilename,
        mimeType: req.file.mimetype,
        maxPixels: service.maxPixels
      });
      if (!validation.ok) {
        return res.status(validation.status || 400).json({
          ok: false,
          code: validation.code,
          message: validation.message
        });
      }

      const mode = String(req.body?.mode || 'fake').toLowerCase();
      if (!['fake', 'real'].includes(mode)) {
        return res.status(400).json({ ok: false, code: 'INVALID_MODE', message: 'mode 必须是 fake 或 real。' });
      }
      let consent = false;
      if (mode === 'real') {
        const configuration = modelConfigStatus();
        if (!configuration.configured) {
          return res.status(503).json({
            ok: false,
            code: 'CONFIGURATION_REQUIRED',
            message: '真实视觉模型尚未配置。',
            missingVariables: Array.isArray(configuration.missingVariables) ? configuration.missingVariables : []
          });
        }
        consent = String(req.body?.modelProcessingConsent || '').toLowerCase() === 'true';
        if (!consent) {
          return res.status(403).json({
            ok: false,
            code: 'CONSENT_REQUIRED',
            message: '真实模型处理需要用户明确同意。'
          });
        }
      }

      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const job = service.createJob({
        ownerUsername: ownerUsername(req),
        originalFilename,
        extension,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        sha256,
        imageWidth: validation.width,
        imageHeight: validation.height,
        workerMode: mode,
        modelProcessingConsent: consent
      });
      if (mode === 'real') service.startRealWorker(job.id);
      else service.startFakeWorker(job.id);
      return res.status(201).json({ ok: true, job });
    } catch (error) {
      if (error instanceof FlowchartJobError) {
        return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      }
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '无法创建任务。' });
    }
  });

  router.get('/jobs/:jobId', (req, res) => {
    if (!JOB_ID_RE.test(String(req.params.jobId || ''))) {
      return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', message: '任务不存在。' });
    }
    const meta = service.getJobForOwner(req.params.jobId, ownerUsername(req));
    if (!meta) return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', message: '任务不存在。' });
    return res.json({ ok: true, job: service.publicJob(meta) });
  });

  function sendReviewError(res, error) {
    if (error instanceof FlowchartJobError) {
      return res.status(error.status || 400).json({
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      });
    }
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '复核请求失败。' });
  }

  router.get('/jobs/:jobId/source', (req, res) => {
    const resolved = service.resolveSource(req.params.jobId, ownerUsername(req));
    if (!resolved) return res.status(404).json({ ok: false, code: 'SOURCE_NOT_FOUND', message: '原图不存在。' });
    res.set('Cache-Control', 'private, no-store');
    return res.sendFile(resolved.file);
  });

  router.get('/jobs/:jobId/review', (req, res) => {
    try {
      const data = getReview({ service, jobId: req.params.jobId, ownerUsername: ownerUsername(req) });
      const meta = service.getJobForOwner(req.params.jobId, ownerUsername(req));
      return res.json({ ok: true, job: service.publicJob(meta), ...data });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.put('/jobs/:jobId/review/graph', reviewJson, (req, res) => {
    try {
      const result = saveGraph({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        expectedRevision: req.body?.expectedRevision,
        graph: req.body?.graph
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.put('/jobs/:jobId/review/issues/:issueId', reviewJson, (req, res) => {
    try {
      const result = updateIssue({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        expectedRevision: req.body?.expectedRevision,
        issueId: req.params.issueId,
        status: req.body?.status,
        resolution: req.body?.resolution,
        note: req.body?.note
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.post('/jobs/:jobId/review/bulk-review', reviewJson, (req, res) => {
    try {
      const result = bulkReview({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        expectedRevision: req.body?.expectedRevision,
        confirm: req.body?.confirm === true,
        resolution: req.body?.resolution
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.post('/jobs/:jobId/review/approve', reviewJson, (req, res) => {
    try {
      const result = approve({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        expectedRevision: req.body?.expectedRevision
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.post('/jobs/:jobId/export-xlsx', reviewJson, (req, res) => {
    try {
      const result = exportXlsx({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        mode: req.body?.mode || 'experimental',
        anchor: req.body?.anchor || 'default',
        ...(exportRunner ? { runExporter: exportRunner } : {})
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.get('/jobs/:jobId/review/revisions', (req, res) => {
    try {
      const revisions = listRevisions({ service, jobId: req.params.jobId, ownerUsername: ownerUsername(req) });
      return res.json({ ok: true, revisions });
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.get('/jobs/:jobId/review/files/:name', (req, res) => {
    try {
      const resolved = readReviewFile({
        service,
        jobId: req.params.jobId,
        ownerUsername: ownerUsername(req),
        name: req.params.name
      });
      res.set('Cache-Control', 'private, no-store');
      return res.download(resolved.file, resolved.name, () => {});
    } catch (error) {
      return sendReviewError(res, error);
    }
  });

  router.get('/jobs/:jobId/artifacts', (req, res) => {
    if (!JOB_ID_RE.test(String(req.params.jobId || ''))) {
      return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', message: '任务不存在。' });
    }
    const artifacts = service.listArtifacts(req.params.jobId, ownerUsername(req));
    if (artifacts === null) return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', message: '任务不存在。' });
    return res.json({
      ok: true,
      artifacts: publicArtifacts(artifacts),
      isMock: true,
      resultKind: 'synthetic_test_result'
    });
  });

  router.get('/jobs/:jobId/artifacts/:artifactId', (req, res) => {
    const resolved = service.resolveArtifact(
      req.params.jobId,
      req.params.artifactId,
      ownerUsername(req)
    );
    if (!resolved) {
      return res.status(404).json({ ok: false, code: 'ARTIFACT_NOT_FOUND', message: '产物不存在。' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.download(resolved.file, resolved.artifact.name, () => {});
  });

  router.post('/jobs/:jobId/cancel', (req, res) => {
    try {
      if (!JOB_ID_RE.test(String(req.params.jobId || ''))) {
        return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', message: '任务不存在。' });
      }
      const job = service.cancel(req.params.jobId, ownerUsername(req));
      return res.json({ ok: true, job });
    } catch (error) {
      if (error instanceof FlowchartJobError) {
        return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      }
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '取消任务失败。' });
    }
  });

  router.use((_req, res) => {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在。' });
  });

  return router;
}

module.exports = { createFlowchartRouter };

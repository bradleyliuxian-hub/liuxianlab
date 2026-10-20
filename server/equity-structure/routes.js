'use strict';

/*
 * 股权结构图识别 routes.
 *
 *   GET    /api/equity-structures/meta
 *   POST   /api/equity-structures                     upload image -> draft / cache hit
 *   GET    /api/equity-structures                     owner history
 *   POST   /api/equity-structures/:id/start           queue OCR worker
 *   GET    /api/equity-structures/:id                 status / progress
 *   GET    /api/equity-structures/:id/result          result JSON
 *   PUT    /api/equity-structures/:id/result          save manual edits
 *   GET    /api/equity-structures/:id/export          xlsx | pdf
 *   POST   /api/equity-structures/corrections         store OCR name correction
 *   DELETE /api/equity-structures/:id
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');

const repository = require('./repository');
const { createDraftJobFromBuffer, JobCreationError } = require('./job-factory');
const { createEquityRunner } = require('./worker-runner');
const { repairMojibake } = require('../excel-review/encoding');

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_HISTORY = 50;
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/octet-stream'
]);
const EXPORT_TIMEOUT_MS = 180000;

class ValidationError extends Error {}

function validJobId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'image.png')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || 'image.png';
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function requireAuthSafe() {
  return (req, res, next) => {
    if (req.session?.auth?.username) return next();
    return res.status(401).json({ error: '请先登录。' });
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    originalFilename: job.originalFilename,
    fileSize: job.fileSize,
    imageWidth: job.imageWidth,
    imageHeight: job.imageHeight,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    summary: job.summaryJson || null
  };
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function createEquityRouter({ root }) {
  const router = express.Router();
  const storageRoot = path.join(root, 'storage', 'equity-structure');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const runner = createEquityRunner({
    root,
    repository,
    storageRoot,
    maxConcurrent: Number(process.env.EQUITY_STRUCTURE_MAX_CONCURRENT || 1)
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    defParamCharset: 'utf8'
  });

  const uploadOne = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '图片超过 100MB 限制。' });
      }
      return res.status(400).json({ error: '图片上传失败。' });
    });
  };

  const largeJson = express.json({ limit: '12mb' });

  function jobDir(jobId) {
    return runner.jobDir(jobId);
  }

  function resultDir(job) {
    if (!job?.resultDir) return null;
    const absolute = path.resolve(root, job.resultDir);
    const base = path.resolve(storageRoot);
    if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) return null;
    return absolute;
  }

  function resultFile(job, name) {
    const dir = resultDir(job);
    if (!dir) return null;
    const file = path.join(dir, name);
    return fs.existsSync(file) ? file : null;
  }

  function preferredResultFile(job) {
    return resultFile(job, 'manual-result.json') || resultFile(job, 'result.json');
  }

  async function getOwnedJob(req, res) {
    if (!validJobId(req.params.id)) {
      res.status(404).json({ error: '任务不存在。' });
      return null;
    }
    const job = await repository.getJobForOwner(req.params.id, ownerUsername(req));
    if (!job) {
      res.status(404).json({ error: '任务不存在。' });
      return null;
    }
    return job;
  }

  router.get('/meta', requireAuthSafe(), (_req, res) => {
    res.json({
      maxFileSizeBytes: MAX_FILE_SIZE,
      extensions: ['.png', '.jpg', '.jpeg', '.webp'],
      tileWidth: Number(process.env.TILE_WIDTH || 1700),
      tileHeight: Number(process.env.TILE_HEIGHT || 1200),
      tileOverlap: Number(process.env.TILE_OVERLAP || 0.28),
      maxTiles: Number(process.env.MAX_TILES || 72),
      maxPixels: Number(process.env.EQUITY_MAX_PIXELS || 220000000),
      exportFormats: ['svg', 'png', 'xlsx', 'pdf'],
      maxConcurrent: runner.maxConcurrent,
      retentionHours: runner.retentionHours,
      polling: true
    });
  });

  router.post('/', requireAuthSafe(), uploadOne, async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '请选择 PNG / JPG / WebP 图片。' });
      const originalFilename = safeOriginalName(repairMojibake(req.file.originalname));
      const extension = extensionOf(originalFilename);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: '仅支持 .png / .jpg / .jpeg / .webp 图片。' });
      }
      if (req.file.mimetype && !ALLOWED_MIME.has(req.file.mimetype)) {
        return res.status(400).json({ error: '图片类型不受支持。' });
      }

      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const cached = await repository.findCompletedByHash(ownerUsername(req), sha256);
      if (cached && resultFile(cached, 'result.json')) {
        return res.status(200).json({ job: publicJob(cached), cached: true });
      }

      const job = await createDraftJobFromBuffer({
        repository,
        root,
        storageRoot,
        ownerUsername: ownerUsername(req),
        originalFilename,
        extension,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer
      });
      return res.status(201).json({ job: publicJob(job), cached: false });
    } catch (error) {
      if (error instanceof JobCreationError) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/', requireAuthSafe(), async (req, res, next) => {
    try {
      const jobs = await repository.listJobsForOwner(ownerUsername(req));
      return res.json({ jobs: jobs.slice(0, MAX_HISTORY).map(publicJob) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/start', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft' && job.status !== 'failed') {
        return res.status(409).json({ error: '该任务已经提交或完成。' });
      }
      const dir = jobDir(job.id);
      if (!fs.existsSync(dir)) return res.status(410).json({ error: '源图片已过期，请重新上传。' });

      const queued = await repository.updateJobState(job.id, {
        status: 'queued',
        progress: 0,
        progressMessage: '已排队，等待识别…',
        resultDir: null,
        summaryJson: null,
        error: null,
        completedAt: null
      });
      runner.enqueue(job.id);
      return res.status(202).json({ job: publicJob(queued) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      return res.json({ job: publicJob(job) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/source', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      const absolute = path.resolve(root, job.sourcePath || '');
      const base = path.resolve(storageRoot);
      if (!absolute.startsWith(`${base}${path.sep}`) || !fs.existsSync(absolute)) {
        return res.status(410).json({ error: '源图片已过期，请重新上传。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.sendFile(absolute);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/result', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') return res.status(409).json({ error: '识别尚未完成。' });
      const file = preferredResultFile(job);
      if (!file) return res.status(410).json({ error: '结果已过期，请重新识别。' });
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      payload.edited = path.basename(file) === 'manual-result.json';
      res.set('Cache-Control', 'private, no-store');
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/result', requireAuthSafe(), largeJson, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') return res.status(409).json({ error: '识别尚未完成，不能保存修改。' });
      const payload = req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ValidationError('结果格式不正确。');
      }
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new ValidationError('结果必须包含 nodes 与 edges 数组。');
      }
      if (payload.nodes.length > 5000 || payload.edges.length > 20000) {
        throw new ValidationError('节点或关系数量超出限制。');
      }
      const dir = resultDir(job);
      if (!dir) return res.status(410).json({ error: '结果目录已过期。' });
      fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(path.join(dir, 'manual-result.json'), payload);
      return res.json({ ok: true, edited: true });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/export/png', requireAuthSafe(), largeJson, async (req, res, next) => {
    const svg = String(req.body?.svg || '');
    const requestedScale = Number(req.body?.scale || 2);
    if (!svg.trim()) return res.status(400).json({ detail: 'SVG 内容为空。' });
    if (Buffer.byteLength(svg, 'utf8') > 8 * 1024 * 1024) {
      return res.status(413).json({ detail: 'SVG 内容超过 8MB 限制。' });
    }
    const exportRoot = path.join(storageRoot, 'png-exports');
    const tempDir = path.join(exportRoot, crypto.randomUUID());
    try {
      fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
      const svgPath = path.join(tempDir, 'export.svg');
      const pngPath = path.join(tempDir, 'export.png');
      fs.writeFileSync(svgPath, svg, { encoding: 'utf8', mode: 0o600 });
      const scale = Number.isFinite(requestedScale) ? Math.max(1, Math.min(4, requestedScale)) : 2;
      const result = await new Promise((resolve) => {
        const child = spawn(runner.resolvePythonBin(), [
          '-m', 'services.equity_structure.png_export',
          '--svg', svgPath,
          '--output', pngPath,
          '--scale', String(scale)
        ], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 4000); });
        const timer = setTimeout(() => {
          try { child.kill('SIGTERM'); } catch (_) {}
          resolve({ code: 124, stderr: 'PNG 生成超时。' });
        }, 120000);
        child.on('error', (error) => {
          clearTimeout(timer);
          resolve({ code: 1, stderr: error.message });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stderr });
        });
      });
      if (result.code !== 0 || !fs.existsSync(pngPath)) {
        const status = result.code === 2 ? 400 : 500;
        return res.status(status).json({
          detail: (result.stderr || 'PNG 渲染失败。').trim().slice(0, 800)
        });
      }
      res.set('Cache-Control', 'private, no-store');
      res.type('png');
      return res.sendFile(pngPath, () => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      });
    } catch (error) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      return next(error);
    }
  });

  router.get('/:id/layout', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') return res.status(409).json({ error: '识别尚未完成。' });
      const dir = resultDir(job);
      const file = dir ? path.join(dir, 'manual-layout.json') : null;
      if (!file || !fs.existsSync(file)) {
        return res.json({ layout: null });
      }
      return res.json({ layout: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/layout', requireAuthSafe(), largeJson, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') return res.status(409).json({ error: '识别尚未完成，不能保存布局。' });
      const layout = req.body;
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
        throw new ValidationError('布局格式不正确。');
      }
      if (JSON.stringify(layout).length > 4 * 1024 * 1024) {
        throw new ValidationError('布局数据过大。');
      }
      const dir = resultDir(job);
      if (!dir) return res.status(410).json({ error: '结果目录已过期。' });
      fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(path.join(dir, 'manual-layout.json'), layout);
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/:id/export', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') return res.status(409).json({ error: '识别尚未完成。' });
      const format = String(req.query.format || 'xlsx').toLowerCase();
      if (!['xlsx', 'pdf'].includes(format)) {
        return res.status(400).json({ error: '服务端导出仅支持 xlsx 或 pdf；SVG/PNG 由页面直接导出。' });
      }
      const source = preferredResultFile(job);
      if (!source) return res.status(410).json({ error: '结果已过期，请重新识别。' });
      const dir = resultDir(job);
      const exportDir = path.join(dir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      const output = path.join(exportDir, `equity-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${format}`);

      const layoutFile = path.join(dir, 'manual-layout.json');
      await new Promise((resolve, reject) => {
        const args = [
          '-m', 'services.equity_structure.export_cli',
          '--result', source,
          '--format', format,
          '--output', output
        ];
        if (fs.existsSync(layoutFile)) args.push('--layout', layoutFile);
        const child = spawn(runner.resolvePythonBin(), args, {
          cwd: root,
          stdio: ['ignore', 'ignore', 'pipe']
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 4000); });
        const timer = setTimeout(() => {
          try { child.kill('SIGTERM'); } catch (_) {}
          reject(new Error('导出超时。'));
        }, EXPORT_TIMEOUT_MS);
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0 && fs.existsSync(output)) return resolve();
          console.error('[equity export]', code, stderr);
          reject(new Error(stderr.trim() || '导出失败。'));
        });
      });

      const base = path.basename(job.originalFilename, path.extname(job.originalFilename)) || '股权结构图';
      res.set('Cache-Control', 'private, no-store');
      return res.download(output, `${base.slice(0, 100)}-股权结构图.${format}`, () => {
        try { fs.unlinkSync(output); } catch (_) {}
      });
    } catch (error) {
      console.error('[equity export]', error);
      return res.status(500).json({ error: '导出失败，请检查修改后的节点与关系数据。' });
    }
  });

  router.post('/corrections', requireAuthSafe(), async (req, res, next) => {
    try {
      const original = String(req.body?.original || '').trim();
      const corrected = String(req.body?.corrected || '').trim();
      if (!original || !corrected) throw new ValidationError('原名称与修正名称都不能为空。');
      if (original.length > 300 || corrected.length > 300) throw new ValidationError('名称过长。');
      const jobId = validJobId(req.body?.jobId) ? req.body.jobId : null;
      const record = await repository.addCorrection({
        ownerUsername: ownerUsername(req),
        jobId,
        originalName: original,
        correctedName: corrected
      });
      return res.status(201).json({ ok: true, correction: record });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  router.delete('/:id', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status === 'queued' || job.status === 'running') {
        return res.status(409).json({ error: '识别进行中，暂时不能删除。' });
      }
      await repository.deleteJobForOwner(job.id, ownerUsername(req));
      try { fs.rmSync(jobDir(job.id), { recursive: true, force: true }); } catch (_) {}
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createEquityRouter };

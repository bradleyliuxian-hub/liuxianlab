'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const express = require('express');
const multer = require('multer');
const { createJobManager } = require('./jobs');

function safeOriginalName(value) {
  const base = path.basename(String(value || 'workbook.xlsx'));
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'workbook.xlsx';
}

function isXlsxName(name) {
  return path.extname(String(name || '')).toLowerCase() === '.xlsx';
}

function looksLikeZip(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const bytes = fs.readSync(fd, buffer, 0, 4, 0);
    if (bytes < 4) return false;
    return buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]);
  } finally {
    fs.closeSync(fd);
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: Number(job.progress || 0),
    message: job.message || '',
    originalName: job.originalName || '',
    outputName: job.outputName || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    profile: job.profile || 'default',
    summary: job.summary || null,
    error: job.status === 'failed' ? (job.error || '处理失败') : undefined,
    retentionHours: job.retentionHours
  };
}

async function readJsonLinesPage(filePath, { page = 1, pageSize = 50, type = '', sheet = '' }) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(200, Math.max(1, Math.floor(Number(pageSize) || 50)));
  const offset = (safePage - 1) * safePageSize;
  const items = [];
  let filteredTotal = 0;

  if (!fs.existsSync(filePath)) {
    return { page: safePage, pageSize: safePageSize, total: 0, items };
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let item;
    try { item = JSON.parse(trimmed); }
    catch (_) { continue; }
    if (type && item.type !== type) continue;
    if (sheet && item.sheet !== sheet) continue;
    if (filteredTotal >= offset && items.length < safePageSize) items.push(item);
    filteredTotal += 1;
  }

  return { page: safePage, pageSize: safePageSize, total: filteredTotal, items };
}

function createExcelRouter({ root, requireAuth, sameOriginForStateChange }) {
  const router = express.Router();
  const storageRoot = path.join(root, 'storage', 'excel');
  const manager = createJobManager({ root, storageRoot });

  function prepareJob(req, res, next) {
    const jobId = `excel_${crypto.randomUUID()}`;
    const dir = manager.jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    req.excelUpload = { jobId, dir };
    next();
  }

  const storage = multer.diskStorage({
    destination(req, _file, callback) {
      callback(null, req.excelUpload.dir);
    },
    filename(_req, _file, callback) {
      callback(null, 'input.xlsx');
    }
  });

  // Deliberately no fileSize limit. Uploads stream directly to disk, not memory.
  const upload = multer({
    storage,
    limits: { files: 1, fields: 8 }
  }).single('file');

  router.use(requireAuth);

  router.post('/jobs', sameOriginForStateChange, prepareJob, (req, res) => {
    upload(req, res, (uploadError) => {
      const { jobId, dir } = req.excelUpload;
      if (uploadError) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: uploadError.message || '文件上传失败。' });
      }

      if (!req.file) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '请选择一个 Excel 文件。' });
      }

      const originalName = safeOriginalName(req.file.originalname);
      if (!isXlsxName(originalName)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '当前版本只支持 .xlsx 文件。' });
      }

      const inputPath = path.join(dir, 'input.xlsx');
      if (!looksLikeZip(inputPath)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '文件内容不是有效的 .xlsx 工作簿。' });
      }

      const base = path.basename(originalName, '.xlsx').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'workbook';
      const outputName = `${base}-standardized.xlsx`;
      const now = new Date().toISOString();
      const profile = String(req.body.profile || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';

      const job = manager.writeJob(jobId, {
        owner: req.session.auth.username,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: '文件已上传，等待处理…',
        profile,
        originalName,
        outputName,
        inputPath: 'input.xlsx',
        outputPath: 'output.xlsx',
        createdAt: now,
        retentionHours: manager.retentionHours,
        inputBytes: Number(req.file.size || 0)
      });

      manager.enqueue(jobId);
      return res.status(202).json({ ok: true, job: publicJob(job) });
    });
  });

  router.get('/jobs/:jobId', (req, res) => {
    const job = manager.ownedJob(req.params.jobId, req.session.auth.username);
    if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, job: publicJob(job) });
  });

  router.get('/jobs/:jobId/changes', async (req, res, next) => {
    try {
      const job = manager.ownedJob(req.params.jobId, req.session.auth.username);
      if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });
      const file = path.join(manager.jobDir(job.id), 'changes.jsonl');
      const data = await readJsonLinesPage(file, {
        page: req.query.page,
        pageSize: req.query.pageSize,
        type: String(req.query.type || ''),
        sheet: String(req.query.sheet || '')
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, ...data });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/jobs/:jobId/preview', (req, res) => {
    const job = manager.ownedJob(req.params.jobId, req.session.auth.username);
    if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });
    const file = path.join(manager.jobDir(job.id), 'preview.json');
    if (!fs.existsSync(file)) return res.status(409).json({ ok: false, message: '预览尚未生成。' });
    res.set('Cache-Control', 'no-store');
    return res.sendFile(file);
  });

  router.get('/jobs/:jobId/download', (req, res) => {
    const job = manager.ownedJob(req.params.jobId, req.session.auth.username);
    if (!job) return res.status(404).send('Not Found');
    if (job.status !== 'completed') return res.status(409).send('Job not completed');
    const file = path.join(manager.jobDir(job.id), 'output.xlsx');
    if (!fs.existsSync(file)) return res.status(404).send('Output not found');
    res.set('Cache-Control', 'private, no-store');
    return res.download(file, job.outputName || 'standardized.xlsx');
  });

  router.delete('/jobs/:jobId', sameOriginForStateChange, (req, res) => {
    try {
      const deleted = manager.deleteJob(req.params.jobId, req.session.auth.username);
      if (!deleted) return res.status(404).json({ ok: false, message: '任务不存在。' });
      return res.json({ ok: true });
    } catch (error) {
      if (error.code === 'JOB_ACTIVE') {
        return res.status(409).json({ ok: false, message: '任务仍在处理中，暂时无法删除。' });
      }
      throw error;
    }
  });

  router.get('/meta', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      uploadSizeLimit: null,
      accepted: ['.xlsx'],
      maxConcurrentJobs: manager.maxConcurrent,
      retentionHours: manager.retentionHours
    });
  });

  return router;
}

module.exports = { createExcelRouter };

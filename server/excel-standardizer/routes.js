'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const express = require('express');
const multer = require('multer');
const { createJobManager } = require('./jobs');
const { repairMojibake } = require('./encoding');

const FEATURE_KEYS = [
  'trim_text',
  'normalize_dates',
  'normalize_datetime',
  'header_style',
  'autofit_columns',
  'freeze_header',
  'auto_filter',
  'remove_empty_rows'
];

const DEFAULT_SELECTION = Object.freeze({
  trim_text: true,
  normalize_dates: true,
  normalize_datetime: false,
  header_style: true,
  autofit_columns: true,
  freeze_header: true,
  auto_filter: true,
  remove_empty_rows: false
});

const FEATURE_LABELS = Object.freeze({
  trim_text: '\u53bb\u9664\u6587\u672c\u9996\u5c3e\u7a7a\u683c',
  normalize_dates: '\u7edf\u4e00\u65e5\u671f\u683c\u5f0f',
  normalize_datetime: '\u7edf\u4e00\u65e5\u671f\u65f6\u95f4\u683c\u5f0f',
  header_style: '\u7edf\u4e00\u8868\u5934\u6837\u5f0f',
  autofit_columns: '\u81ea\u52a8\u8c03\u6574\u5217\u5bbd',
  freeze_header: '\u51bb\u7ed3\u8868\u5934',
  auto_filter: '\u6dfb\u52a0\u81ea\u52a8\u7b5b\u9009',
  remove_empty_rows: '\u5220\u9664\u7a7a\u767d\u884c'
});

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

function normalizeSelection(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { ...DEFAULT_SELECTION };
  }

  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try { parsed = JSON.parse(rawValue); }
    catch (_) {
      const error = new Error('\u529f\u80fd\u9009\u62e9\u53c2\u6570\u683c\u5f0f\u4e0d\u6b63\u786e\u3002');
      error.code = 'INVALID_SELECTION';
      throw error;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('\u529f\u80fd\u9009\u62e9\u53c2\u6570\u683c\u5f0f\u4e0d\u6b63\u786e\u3002');
    error.code = 'INVALID_SELECTION';
    throw error;
  }

  const selection = {};
  for (const key of FEATURE_KEYS) selection[key] = parsed[key] === true;
  if (!FEATURE_KEYS.some((key) => selection[key])) {
    const error = new Error('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u6807\u51c6\u5316\u529f\u80fd\u3002');
    error.code = 'EMPTY_SELECTION';
    throw error;
  }
  return selection;
}

function selectedFeatureKeys(selection) {
  return FEATURE_KEYS.filter((key) => selection?.[key] === true);
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
    selection: job.selection || null,
    selectedFeatures: job.selectedFeatures || selectedFeatureKeys(job.selection),
    summary: job.summary || null,
    error: job.status === 'failed' ? (job.error || '\u5904\u7406\u5931\u8d25') : undefined,
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

  const upload = multer({
    storage,
    defParamCharset: 'utf8',
    limits: { files: 1, fields: 8 }
  }).single('file');

  router.use(requireAuth);

  router.post('/jobs', sameOriginForStateChange, prepareJob, (req, res) => {
    upload(req, res, (uploadError) => {
      const { jobId, dir } = req.excelUpload;
      if (uploadError) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: uploadError.message || '\u6587\u4ef6\u4e0a\u4f20\u5931\u8d25\u3002' });
      }

      if (!req.file) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '\u8bf7\u9009\u62e9\u4e00\u4e2a Excel \u6587\u4ef6\u3002' });
      }

      let selection;
      try {
        selection = normalizeSelection(req.body.selection);
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: error.message });
      }

      const originalName = safeOriginalName(repairMojibake(req.file.originalname));
      if (!isXlsxName(originalName)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '\u5f53\u524d\u7248\u672c\u53ea\u652f\u6301 .xlsx \u6587\u4ef6\u3002' });
      }

      const inputPath = path.join(dir, 'input.xlsx');
      if (!looksLikeZip(inputPath)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '\u6587\u4ef6\u5185\u5bb9\u4e0d\u662f\u6709\u6548\u7684 .xlsx \u5de5\u4f5c\u7c3f\u3002' });
      }

      const base = path.basename(originalName, '.xlsx').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'workbook';
      const outputName = `${base}-standardized.xlsx`;
      const now = new Date().toISOString();
      const profile = String(req.body.profile || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
      const selectedFeatures = selectedFeatureKeys(selection);

      const job = manager.writeJob(jobId, {
        owner: req.session.auth.username,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: `\u6587\u4ef6\u5df2\u4e0a\u4f20\uff0c\u5df2\u9009 ${selectedFeatures.length} \u9879\u529f\u80fd\uff0c\u7b49\u5f85\u5904\u7406\u2026`,
        profile,
        selection,
        selectedFeatures,
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
    if (!job) return res.status(404).json({ ok: false, message: '\u4efb\u52a1\u4e0d\u5b58\u5728\u3002' });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, job: publicJob(job) });
  });

  router.get('/jobs/:jobId/changes', async (req, res, next) => {
    try {
      const job = manager.ownedJob(req.params.jobId, req.session.auth.username);
      if (!job) return res.status(404).json({ ok: false, message: '\u4efb\u52a1\u4e0d\u5b58\u5728\u3002' });
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
    if (!job) return res.status(404).json({ ok: false, message: '\u4efb\u52a1\u4e0d\u5b58\u5728\u3002' });
    const file = path.join(manager.jobDir(job.id), 'preview.json');
    if (!fs.existsSync(file)) return res.status(409).json({ ok: false, message: '\u9884\u89c8\u5c1a\u672a\u751f\u6210\u3002' });
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
      if (!deleted) return res.status(404).json({ ok: false, message: '\u4efb\u52a1\u4e0d\u5b58\u5728\u3002' });
      return res.json({ ok: true });
    } catch (error) {
      if (error.code === 'JOB_ACTIVE') {
        return res.status(409).json({ ok: false, message: '\u4efb\u52a1\u4ecd\u5728\u5904\u7406\u4e2d\uff0c\u6682\u65f6\u65e0\u6cd5\u5220\u9664\u3002' });
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
      retentionHours: manager.retentionHours,
      features: FEATURE_KEYS.map((key) => ({ key, label: FEATURE_LABELS[key], recommended: DEFAULT_SELECTION[key] }))
    });
  });

  return router;
}

module.exports = { createExcelRouter, DEFAULT_SELECTION, FEATURE_KEYS, FEATURE_LABELS, normalizeSelection };

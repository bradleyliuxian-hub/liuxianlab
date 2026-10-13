'use strict';

/*
 * Excel Review Assistant - HTTP routes.
 *
 *   POST   /api/excel-reviews                  upload source .xlsx -> extract
 *   GET    /api/excel-reviews                  history for current owner
 *   GET    /api/excel-reviews/meta             capabilities
 *   GET    /api/excel-reviews/:id              status / progress
 *   GET    /api/excel-reviews/:id/review-file  download review.xlsx
 *   DELETE /api/excel-reviews/:id              delete job + files
 *
 * There is no reply upload and no automatic write-back / final.xlsx.
 * Auth + same-origin are enforced by the parent app.use() in server.js.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const repository = require('./repository');
const { createExcelReviewRunner } = require('./parse-runner');

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ACCEPTED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed'
]);

function validJobId(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'workbook.xlsx')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || 'workbook.xlsx';
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

function downloadBase(name) {
  const base = path
    .basename(String(name || 'workbook.xlsx'))
    .replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return base.slice(0, 120) || 'workbook';
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    originalFilename: job.originalFilename,
    status: job.status,
    progress: Number(job.progress || 0),
    progressMessage: job.progressMessage || '',
    itemCount: job.itemCount,
    hasReview: Boolean(job.reviewPath),
    error: job.status === 'failed' ? (job.error || '处理失败。') : undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function createExcelReviewRouter(options = {}) {
  const router = express.Router();
  const root = options.root || path.resolve(__dirname, '..', '..');
  const storageRoot = path.join(root, 'storage', 'excel-reviews');

  fs.mkdirSync(storageRoot, { recursive: true });

  const maxConcurrent = Math.max(1, Number(process.env.EXCEL_REVIEW_CONCURRENCY || 1));
  const runner = createExcelReviewRunner({ root, repository, storageRoot, maxConcurrent });
  runner.recover();

  function jobDir(jobId) {
    return path.join(storageRoot, jobId);
  }

  function relativePath(absolutePath) {
    return path.relative(root, absolutePath).split(path.sep).join('/');
  }

  /*
   * Read the per-job statistics from extracted.json (written by the
   * Python worker). This keeps web/API stats and the review workbook
   * Dashboard on a single extraction result - no DB schema needed.
   */
  function readStatistics(jobId) {
    try {
      const file = path.join(jobDir(jobId), 'extracted.json');
      if (!fs.existsSync(file)) return null;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data && typeof data === 'object' ? data.statistics || null : null;
    } catch (_) {
      return null;
    }
  }

  const storage = multer.diskStorage({
    destination(req, _file, callback) {
      callback(null, req.excelReviewDir);
    },
    filename(req, _file, callback) {
      callback(null, req.excelReviewFilename);
    }
  });

  const upload = multer({
    storage,
    limits: { files: 1, fields: 8, fileSize: MAX_FILE_SIZE },
    fileFilter(_req, file, callback) {
      const extension = path.extname(file.originalname || '').toLowerCase();
      if (extension !== '.xlsx' || !ACCEPTED_MIME.has(file.mimetype)) {
        callback(new Error('仅支持 .xlsx 文件。'));
        return;
      }
      callback(null, true);
    }
  });

  function receiveFile(req, res, next) {
    upload.single('file')(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, message: 'Excel 文件不能超过 20 MB。' });
      }
      return res.status(400).json({ ok: false, message: error.message || '文件上传失败。' });
    });
  }

  function prepareSourceUpload(req, _res, next) {
    req.excelReviewId = crypto.randomUUID();
    req.excelReviewDir = jobDir(req.excelReviewId);
    req.excelReviewFilename = 'source.xlsx';
    fs.mkdirSync(req.excelReviewDir, { recursive: true, mode: 0o700 });
    next();
  }

  router.post('/', prepareSourceUpload, receiveFile, async (req, res) => {
    const jobId = req.excelReviewId;
    const dir = req.excelReviewDir;

    try {
      if (!req.file) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '请选择一个 .xlsx 文件。' });
      }

      const sourcePath = path.join(dir, 'source.xlsx');
      if (!looksLikeZip(sourcePath)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(400).json({ ok: false, message: '文件内容不是有效的 .xlsx 工作簿。' });
      }

      const owner = ownerUsername(req);
      if (!owner) {
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(401).json({ ok: false, message: '请先登录。' });
      }

      const originalFilename = safeOriginalName(req.file.originalname);

      // The Python worker reads this to populate the "Source File" column.
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        `${JSON.stringify({ originalFilename })}\n`,
        { mode: 0o600 }
      );

      const job = await repository.createJob({
        id: jobId,
        ownerUsername: owner,
        originalFilename,
        status: 'queued',
        phase: 'extract',
        progress: 0,
        progressMessage: '文件已上传，等待处理…',
        sourcePath: relativePath(sourcePath)
      });

      runner.enqueue(jobId);

      console.log('[excel-review]', 'job queued:', jobId, originalFilename);
      return res.status(202).json({ ok: true, job: publicJob(job) });
    } catch (error) {
      console.error('[excel-review upload]', error);
      fs.rmSync(dir, { recursive: true, force: true });
      return res.status(500).json({ ok: false, message: '无法创建 Excel 复核任务。' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const jobs = await repository.listJobsForOwner(ownerUsername(req));
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, jobs: jobs.map(publicJob) });
    } catch (error) {
      console.error('[excel-review history]', error);
      return res.status(500).json({ ok: false, message: '无法读取历史记录。' });
    }
  });

  router.get('/meta', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      accepted: ['.xlsx'],
      maxFileSize: MAX_FILE_SIZE,
      maxConcurrentJobs: maxConcurrent,
      capabilities: {
        legacyComments: true,
        threadedCommentsRead: true,
        reviewWorkbook: true,
        reviewDashboard: true,
        excelF5Address: true,
        sourceReference: true,
        worksheetProtection: false,
        replyUpload: false,
        automaticWriteBack: false,
        finalWorkbook: false,
        reviewLayout: 'dashboard-two-sheets',
        reviewMappingVersion: 'excel-review-mapping-v3'
      }
    });
  });

  router.get('/:id', async (req, res) => {
    try {
      if (!validJobId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的任务编号。' });
      }
      const job = await repository.getJobForOwner(req.params.id, ownerUsername(req));
      if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });
      const payload = publicJob(job);
      const stats = readStatistics(job.id);
      if (stats) payload.stats = stats;
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, job: payload });
    } catch (error) {
      console.error('[excel-review status]', error);
      return res.status(500).json({ ok: false, message: '无法读取任务状态。' });
    }
  });

  router.get('/:id/review-file', async (req, res) => {
    try {
      if (!validJobId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的任务编号。' });
      }
      const job = await repository.getJobForOwner(req.params.id, ownerUsername(req));
      if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });
      if (job.status !== 'review_ready' && job.status !== 'completed') {
        return res.status(409).json({ ok: false, message: '复核文件尚未生成。' });
      }
      const file = path.join(jobDir(job.id), 'review.xlsx');
      if (!fs.existsSync(file)) {
        return res.status(404).json({ ok: false, message: '复核文件不存在。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, `${downloadBase(job.originalFilename)}-review.xlsx`);
    } catch (error) {
      console.error('[excel-review review-file]', error);
      return res.status(500).json({ ok: false, message: '无法下载复核文件。' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!validJobId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的任务编号。' });
      }
      const owner = ownerUsername(req);
      const job = await repository.getJobForOwner(req.params.id, owner);
      if (!job) return res.status(404).json({ ok: false, message: '任务不存在。' });

      if (job.status === 'processing') {
        return res.status(409).json({ ok: false, message: '任务仍在处理中，暂时无法删除。' });
      }

      await repository.deleteJobForOwner(job.id, owner);
      fs.rmSync(jobDir(job.id), { recursive: true, force: true });
      return res.json({ ok: true, id: job.id });
    } catch (error) {
      console.error('[excel-review delete]', error);
      return res.status(500).json({ ok: false, message: '删除任务失败。' });
    }
  });

  return router;
}

module.exports = { createExcelReviewRouter };

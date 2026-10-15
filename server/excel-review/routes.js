'use strict';

/*
 * Excel Review Assistant - HTTP routes.
 *
 *   POST   /api/excel-reviews                  upload source .xlsx -> extract
 *   POST   /api/excel-reviews/archive          upload .zip -> one job per .xlsx
 *   GET    /api/excel-reviews                  history for current owner
 *   GET    /api/excel-reviews/meta             capabilities
 *   GET    /api/excel-reviews/:id              status / progress
 *   GET    /api/excel-reviews/:id/review-file  download review.xlsx
 *   DELETE /api/excel-reviews/:id              delete job + files
 *
 * Single .xlsx and archive members are created by the SAME canonical factory
 * (job-factory.createExcelReviewJobFromBuffer). There is no reply upload and
 * no automatic write-back / final.xlsx.
 *
 * Auth + same-origin are enforced by the parent app.use() in server.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const repository = require('./repository');
const { createExcelReviewRunner } = require('./parse-runner');
const {
  createExcelReviewJobFromBuffer,
  looksLikeZipBuffer,
  JobCreationError
} = require('./job-factory');
const fflate = require('../../private/vendor/fflate/fflate.umd.js');

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;             // uploaded .zip
const MAX_ARCHIVE_FILES = 50;                          // .xlsx extracted per archive
const MAX_ARCHIVE_ENTRY_SIZE = MAX_FILE_SIZE;          // single .xlsx member
const MAX_ARCHIVE_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024; // zip-bomb guard

const ACCEPTED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed'
]);

const ARCHIVE_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'multipart/x-zip'
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

function isArchiveName(name) {
  return path.extname(String(name || '')).toLowerCase() === '.zip';
}

// Archive members: real .xlsx only; drop directories, hidden/AppleDouble,
// non-xlsx, and anything that looks like a traversal attempt.
function isXlsxEntryName(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  if (normalized.startsWith('/') || normalized.includes('..')) return false;
  if (normalized.startsWith('__MACOSX/')) return false;
  const base = path.basename(normalized);
  if (!base || base.startsWith('.')) return false;
  return /\.xlsx$/i.test(base);
}

/*
 * Safely extract .xlsx entries from an uploaded zip. Entry names are never
 * used as filesystem paths (each job dir is a fresh UUID), so zip-slip is
 * impossible by construction; the checks are defence + noise filtering.
 * A cumulative uncompressed-size cap guards against zip bombs.
 */
function extractXlsxEntries(buffer) {
  let files;
  try {
    files = fflate.unzipSync(new Uint8Array(buffer));
  } catch (_) {
    const error = new Error('无法解压该压缩包，请确认是有效的 .zip 文件。');
    error.code = 'INVALID_ARCHIVE';
    throw error;
  }
  const entries = [];
  let total = 0;
  Object.keys(files).forEach((name) => {
    if (!isXlsxEntryName(name)) return;
    const data = files[name];
    if (!data || data.length === 0) return;
    if (data.length > MAX_ARCHIVE_ENTRY_SIZE) return;
    total += data.length;
    if (total > MAX_ARCHIVE_TOTAL_UNCOMPRESSED) return;
    entries.push({ name: String(name).replace(/\\/g, '/'), base: path.basename(name), data });
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  return entries.slice(0, MAX_ARCHIVE_FILES);
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
    return path.join(storageRoot, String(jobId));
  }

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

  // Memory storage: the canonical factory owns the job directory.
  const uploadXlsx = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fields: 8, fileSize: MAX_FILE_SIZE },
    fileFilter(_req, file, callback) {
      if (!isXlsxName(file.originalname) || !ACCEPTED_MIME.has(file.mimetype)) {
        const error = new Error('仅支持 .xlsx 文件。');
        error.code = 'INVALID_FILE_TYPE';
        callback(error);
        return;
      }
      callback(null, true);
    }
  });

  const uploadZip = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fields: 8, fileSize: MAX_ARCHIVE_SIZE },
    fileFilter(_req, file, callback) {
      if (!isArchiveName(file.originalname) || !ARCHIVE_MIME.has(file.mimetype)) {
        const error = new Error('仅支持 .zip 压缩包。');
        error.code = 'INVALID_FILE_TYPE';
        callback(error);
        return;
      }
      callback(null, true);
    }
  });

  function receive(uploader, tooLargeMessage) {
    return (req, res, next) => {
      uploader.single('file')(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ ok: false, code: 'UPLOAD_TOO_LARGE', message: tooLargeMessage });
        }
        const code = error.code === 'INVALID_FILE_TYPE' ? 'INVALID_FILE_TYPE' : 'UPLOAD_REJECTED';
        return res.status(400).json({ ok: false, code, message: error.message || '文件上传失败。' });
      });
    };
  }

  function sendJobError(res, error, fallbackMessage) {
    if (error instanceof JobCreationError) {
      return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
    }
    console.error('[excel-review]', error);
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: fallbackMessage || '服务器错误，请稍后重试。' });
  }

  router.post('/', receive(uploadXlsx, 'Excel 文件不能超过 20 MB。'), async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, code: 'NO_FILE', message: '请选择一个 .xlsx 文件。' });
    }
    const owner = ownerUsername(req);
    if (!owner) {
      return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录。' });
    }
    try {
      const job = await createExcelReviewJobFromBuffer({
        repository,
        runner,
        root,
        storageRoot,
        ownerUsername: owner,
        originalFilename: safeOriginalName(req.file.originalname),
        buffer: req.file.buffer,
        fromArchive: false
      });
      console.log('[excel-review]', 'job queued:', job.id, job.originalFilename);
      return res.status(202).json({ ok: true, job: publicJob(job) });
    } catch (error) {
      return sendJobError(res, error, '无法创建 Excel 复核任务。');
    }
  });

  router.post('/archive', receive(uploadZip, '压缩包不能超过 50 MB。'), async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, code: 'NO_FILE', message: '请选择一个 .zip 压缩包。' });
    }
    const owner = ownerUsername(req);
    if (!owner) {
      return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录。' });
    }
    if (!looksLikeZipBuffer(req.file.buffer)) {
      return res.status(400).json({ ok: false, code: 'INVALID_ARCHIVE', message: '文件内容不是有效的 .zip 压缩包。' });
    }

    let entries;
    try {
      entries = extractXlsxEntries(req.file.buffer);
    } catch (error) {
      return res.status(400).json({ ok: false, code: error.code || 'INVALID_ARCHIVE', message: error.message });
    }
    if (!entries.length) {
      return res.status(400).json({ ok: false, code: 'EMPTY_ARCHIVE', message: '压缩包内没有找到 .xlsx 文件。' });
    }

    const jobs = [];
    const failures = [];
    for (const entry of entries) {
      try {
        const job = await createExcelReviewJobFromBuffer({
          repository,
          runner,
          root,
          storageRoot,
          ownerUsername: owner,
          originalFilename: safeOriginalName(entry.base),
          buffer: entry.data,
          fromArchive: true
        });
        jobs.push(publicJob(job));
      } catch (error) {
        failures.push({
          name: entry.name,
          code: error.code || 'JOB_CREATE_FAILED',
          message: error instanceof JobCreationError ? error.message : '无法创建任务。'
        });
      }
    }

    if (!jobs.length) {
      const dbDown = failures.some((f) => f.code === 'DB_UNAVAILABLE');
      return res.status(dbDown ? 503 : 400).json({
        ok: false,
        code: dbDown ? 'DB_UNAVAILABLE' : 'NO_VALID_XLSX',
        message: dbDown ? '数据库暂时不可用，请稍后重试。' : '压缩包内没有可处理的 .xlsx 文件。',
        failures
      });
    }

    console.log('[excel-review archive]', 'created', jobs.length, 'jobs; failed', failures.length);
    return res.status(202).json({ ok: true, jobs, failures, count: jobs.length });
  });

  router.get('/', async (req, res) => {
    try {
      const jobs = await repository.listJobsForOwner(ownerUsername(req));
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, jobs: jobs.map(publicJob) });
    } catch (error) {
      console.error('[excel-review history]', error);
      return res.status(500).json({ ok: false, code: 'DB_UNAVAILABLE', message: '无法读取历史记录。' });
    }
  });

  router.get('/meta', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      accepted: ['.xlsx'],
      archiveAccepted: ['.zip'],
      maxFileSize: MAX_FILE_SIZE,
      maxArchiveSize: MAX_ARCHIVE_SIZE,
      maxArchiveFiles: MAX_ARCHIVE_FILES,
      maxConcurrentJobs: maxConcurrent,
      capabilities: {
        archiveUpload: true,
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
        return res.status(400).json({ ok: false, code: 'INVALID_ID', message: '无效的任务编号。' });
      }
      const job = await repository.getJobForOwner(req.params.id, ownerUsername(req));
      if (!job) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '任务不存在。' });
      const payload = publicJob(job);
      const stats = readStatistics(job.id);
      if (stats) payload.stats = stats;
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, job: payload });
    } catch (error) {
      console.error('[excel-review status]', error);
      return res.status(500).json({ ok: false, code: 'DB_UNAVAILABLE', message: '无法读取任务状态。' });
    }
  });

  router.get('/:id/review-file', async (req, res) => {
    try {
      if (!validJobId(req.params.id)) {
        return res.status(400).json({ ok: false, code: 'INVALID_ID', message: '无效的任务编号。' });
      }
      const job = await repository.getJobForOwner(req.params.id, ownerUsername(req));
      if (!job) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '任务不存在。' });
      if (job.status !== 'review_ready' && job.status !== 'completed') {
        return res.status(409).json({ ok: false, code: 'NOT_READY', message: '复核文件尚未生成。' });
      }
      const file = path.join(jobDir(job.id), 'review.xlsx');
      if (!fs.existsSync(file)) {
        return res.status(404).json({ ok: false, code: 'FILE_MISSING', message: '复核文件不存在。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, `${downloadBase(job.originalFilename)}-review.xlsx`);
    } catch (error) {
      console.error('[excel-review review-file]', error);
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '无法下载复核文件。' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!validJobId(req.params.id)) {
        return res.status(400).json({ ok: false, code: 'INVALID_ID', message: '无效的任务编号。' });
      }
      const owner = ownerUsername(req);
      const job = await repository.getJobForOwner(req.params.id, owner);
      if (!job) return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '任务不存在。' });

      if (job.status === 'processing') {
        return res.status(409).json({ ok: false, code: 'BUSY', message: '任务仍在处理中，暂时无法删除。' });
      }

      await repository.deleteJobForOwner(job.id, owner);
      fs.rmSync(jobDir(job.id), { recursive: true, force: true });
      return res.json({ ok: true, id: job.id });
    } catch (error) {
      console.error('[excel-review delete]', error);
      return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '删除任务失败。' });
    }
  });

  return router;
}

module.exports = {
  createExcelReviewRouter,
  // exported for tests / reuse
  extractXlsxEntries,
  looksLikeZipBuffer,
  isXlsxEntryName
};

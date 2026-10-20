'use strict';

/*
 * 序时账分析 - HTTP routes.
 *
 *   GET    /api/journal-entry-analyses/meta
 *   POST   /api/journal-entry-analyses                    upload -> draft
 *   GET    /api/journal-entry-analyses                    owner history
 *   POST   /api/journal-entry-analyses/:id/inspect        re-detect sheet/header
 *   POST   /api/journal-entry-analyses/:id/preview        mapping validation
 *   POST   /api/journal-entry-analyses/:id/start          queue async analysis
 *   GET    /api/journal-entry-analyses/:id                status/progress
 *   GET    /api/journal-entry-analyses/:id/result         result JSON
 *   GET    /api/journal-entry-analyses/:id/export         report.xlsx
 *   DELETE /api/journal-entry-analyses/:id                delete draft/finished
 *
 * Auth + same-origin are enforced by the parent app.use() in server.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const repository = require('./repository');
const { createDraftJobFromBuffer, JobCreationError } = require('./job-factory');
const { createPreviewRunner } = require('./preview-runner');
const { createJournalEntryRunner } = require('./parse-runner');
const { repairMojibake } = require('../excel-review/encoding');

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_HISTORY = 50;
const ALLOWED_EXTENSIONS = new Set(['.xls', '.xlsx']);
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);
const AMOUNT_LAYOUTS = new Set(['direction_amount', 'debit_credit']);
const POSITIVE_SIDES = new Set(['debit', 'credit']);
const MAPPING_FIELDS = new Set([
  'date', 'voucher_id', 'account_code', 'account_name', 'description',
  'currency', 'direction', 'debit', 'credit', 'amount', 'original_amount'
]);

function validJobId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

class ValidationError extends Error {}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'workbook.xlsx'))
    .replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || 'workbook.xlsx';
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    originalFilename: job.originalFilename,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    sheetName: job.sheetName,
    headerRow: job.headerRow,
    amountLayout: job.amountLayout,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    hasResult: Boolean(job.resultPath),
    hasExport: Boolean(job.exportPath),
    summary: job.summaryJson || null
  };
}

function parseHeaderRow(value) {
  const row = Number(value);
  if (!Number.isInteger(row) || row < 1 || row > 1000000) return null;
  return row;
}

function cleanMapping(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('字段映射格式不正确。');
  }
  const mapping = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!MAPPING_FIELDS.has(field)) continue;
    if (raw === '' || raw === null || raw === undefined) continue;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 1 || index > 100000) {
      throw new ValidationError('字段映射列号不正确。');
    }
    mapping[field] = index;
  }
  return mapping;
}

function normalizeInspectionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求参数不正确。');
  }
  const sheetName = String(body.sheetName || '').trim();
  let headerRow = null;
  if (body.headerRow !== undefined && body.headerRow !== null && body.headerRow !== '') {
    headerRow = parseHeaderRow(body.headerRow);
    if (!headerRow) throw new ValidationError('表头行号不正确。');
  }
  const mapping = cleanMapping(body.mapping);
  const amountLayout = body.amountLayout ? String(body.amountLayout) : null;
  if (amountLayout && !AMOUNT_LAYOUTS.has(amountLayout)) {
    throw new ValidationError('金额布局不正确。');
  }
  const positiveSide = body.positiveSide ? String(body.positiveSide) : null;
  if (positiveSide && !POSITIVE_SIDES.has(positiveSide)) {
    throw new ValidationError('正数方向不正确。');
  }
  return { sheetName, headerRow, mapping, amountLayout, positiveSide };
}

function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求参数不正确。');
  }
  const sheetName = String(body.sheetName || '').trim();
  if (!sheetName || sheetName.length > 200) {
    throw new ValidationError('请选择工作表。');
  }
  const headerRow = parseHeaderRow(body.headerRow);
  if (!headerRow) throw new ValidationError('表头行号不正确。');
  const mapping = cleanMapping(body.mapping);
  const amountLayout = body.amountLayout ? String(body.amountLayout) : null;
  if (amountLayout && !AMOUNT_LAYOUTS.has(amountLayout)) {
    throw new ValidationError('金额布局不正确。');
  }
  const positiveSide = body.positiveSide ? String(body.positiveSide) : null;
  if (positiveSide && !POSITIVE_SIDES.has(positiveSide)) {
    throw new ValidationError('正数方向不正确。');
  }
  return { sheetName, headerRow, mapping, amountLayout, positiveSide };
}

function errorMessage(payload, fallback) {
  const error = payload && payload.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function storageFilePath(root, storageRoot, relative) {
  if (!relative) return null;
  const abs = path.resolve(root, relative);
  const base = path.resolve(storageRoot);
  if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) return null;
  return abs;
}

function createJournalEntryRouter({ root, requireAuth, sameOriginForStateChange }) {
  const router = express.Router();
  const storageRoot = path.join(root, 'storage', 'journal-entry');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const previewRunner = createPreviewRunner({ root });
  const runner = createJournalEntryRunner({
    root,
    repository,
    storageRoot,
    maxConcurrent: Number(process.env.JOURNAL_ENTRY_MAX_CONCURRENT || 1)
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
        return res.status(413).json({ error: '文件超过 25MB 限制。' });
      }
      return res.status(400).json({ error: '文件上传失败。' });
    });
  };

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

  function requestPayload(normalized) {
    return {
      sheetName: normalized.sheetName,
      headerRow: normalized.headerRow,
      amountLayout: normalized.amountLayout || undefined,
      positiveSide: normalized.positiveSide || undefined,
      mapping: normalized.mapping
    };
  }

  function writeJobRequest(job, normalized) {
    const dir = runner.jobDir(job.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJsonAtomic(path.join(dir, 'request.json'), requestPayload(normalized));
  }

  async function applyInspection(job, inspection) {
    const sheetName = inspection.selectedSheet || inspection.sheetName || job.sheetName || null;
    const headerRow = Number(inspection.headerRow) || job.headerRow || null;
    const amountLayout = inspection.amountLayout?.layout || job.amountLayout || null;
    if (sheetName || headerRow || amountLayout) {
      return repository.updateJobState(job.id, { sheetName, headerRow, amountLayout });
    }
    return job;
  }

  router.get('/meta', requireAuth, (_req, res) => {
    res.json({
      maxFileSizeBytes: MAX_FILE_SIZE,
      extensions: ['.xls', '.xlsx'],
      amountLayouts: [
        { value: 'direction_amount', label: '方向 + 金额两列' },
        { value: 'debit_credit', label: '借方、贷方两列' }
      ],
      positiveSides: [
        { value: 'debit', label: '正数表示借方' },
        { value: 'credit', label: '正数表示贷方' }
      ],
      mappingFields: [
        { key: 'date', label: '日期' },
        { key: 'voucher_id', label: '凭证号' },
        { key: 'account_code', label: '科目编码' },
        { key: 'account_name', label: '科目名称' },
        { key: 'description', label: '摘要' },
        { key: 'currency', label: '币种' },
        { key: 'direction', label: '方向/借贷' },
        { key: 'debit', label: '借方金额' },
        { key: 'credit', label: '贷方金额' },
        { key: 'amount', label: '金额（方向+金额）' },
        { key: 'original_amount', label: '原币金额' }
      ],
      maxConcurrent: runner.maxConcurrent,
      retentionHours: runner.retentionHours,
      polling: true
    });
  });

  router.post('/', requireAuth, uploadOne, async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '请选择 .xls 或 .xlsx 文件。' });
      const originalFilename = safeOriginalName(repairMojibake(req.file.originalname));
      const extension = extensionOf(originalFilename);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: '仅支持 .xls / .xlsx 文件。' });
      }
      if (req.file.mimetype && !ALLOWED_MIME.has(req.file.mimetype)) {
        return res.status(400).json({ error: '文件类型不受支持。' });
      }

      const job = await createDraftJobFromBuffer({
        repository,
        root,
        storageRoot,
        ownerUsername: ownerUsername(req),
        originalFilename,
        extension,
        buffer: req.file.buffer
      });

      const inspection = await previewRunner.run({
        jobDir: runner.jobDir(job.id),
        mode: 'inspect'
      });

      if (!inspection.ok) {
        const failed = await repository.updateJobState(job.id, {
          status: 'failed',
          progress: 100,
          progressMessage: '无法读取该工作簿。',
          error: errorMessage(inspection, '无法读取该工作簿。')
        });
        return res.status(422).json({
          error: errorMessage(inspection, '无法读取该工作簿。'),
          job: publicJob(failed)
        });
      }

      const updated = await applyInspection(job, inspection);
      return res.status(201).json({ job: publicJob(updated), inspection });
    } catch (error) {
      if (error instanceof JobCreationError) {
        return res.status(error.status).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const jobs = await repository.listJobsForOwner(ownerUsername(req));
      res.json({ jobs: jobs.slice(0, MAX_HISTORY).map(publicJob) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/inspect', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft') {
        return res.status(409).json({ error: '只有待确认的任务可以重新识别。' });
      }
      const normalized = normalizeInspectionRequest(req.body);
      writeJobRequest(job, normalized);
      const inspection = await previewRunner.run({
        jobDir: runner.jobDir(job.id),
        mode: 'inspect'
      });
      if (!inspection.ok) {
        return res.status(422).json({ error: errorMessage(inspection, '无法识别工作簿。') });
      }
      const updated = await applyInspection(job, inspection);
      return res.json({ job: publicJob(updated), inspection });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.post('/:id/preview', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft') {
        return res.status(409).json({ error: '只有待确认的任务可以预览。' });
      }
      let normalized;
      try {
        normalized = normalizeRequest(req.body);
      } catch (error) {
        if (error instanceof ValidationError) {
          return res.status(400).json({ error: error.message });
        }
        return next(error);
      }
      writeJobRequest(job, normalized);
      const preview = await previewRunner.run({
        jobDir: runner.jobDir(job.id),
        mode: 'preview'
      });
      if (!preview.ok) {
        return res.status(422).json({ error: errorMessage(preview, '映射校验失败。') });
      }
      const updated = await applyInspection(job, {
        selectedSheet: preview.selectedSheet || normalized.sheetName,
        headerRow: normalized.headerRow,
        amountLayout: {
          layout: normalized.amountLayout
            || preview.mapping?.amount_layout?.layout
            || null
        }
      });
      return res.json({ job: publicJob(updated), preview });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/start', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft') {
        return res.status(409).json({ error: '该任务已经提交或完成。' });
      }
      let normalized;
      try {
        normalized = normalizeRequest(req.body);
      } catch (error) {
        if (error instanceof ValidationError) {
          return res.status(400).json({ error: error.message });
        }
        return next(error);
      }
      writeJobRequest(job, normalized);
      const preview = await previewRunner.run({
        jobDir: runner.jobDir(job.id),
        mode: 'preview'
      });
      if (!preview.ok) {
        return res.status(422).json({ error: errorMessage(preview, '映射校验失败。') });
      }
      if (!preview.canStart) {
        return res.status(422).json({ error: '映射未通过必要校验，无法开始分析。' });
      }

      const queued = await repository.updateJobState(job.id, {
        status: 'queued',
        progress: 0,
        progressMessage: '已排队，等待分析…',
        sheetName: normalized.sheetName,
        headerRow: normalized.headerRow,
        amountLayout: normalized.amountLayout
          || preview.mapping?.amount_layout?.layout
          || null,
        requestJson: requestPayload(normalized),
        error: null,
        completedAt: null
      });
      runner.enqueue(job.id);
      return res.status(202).json({ job: publicJob(queued) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      res.json({ job: publicJob(job) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/result', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed' || !job.resultPath) {
        return res.status(409).json({ error: '结果尚未生成。' });
      }
      const file = storageFilePath(root, storageRoot, job.resultPath);
      if (!file || !fs.existsSync(file)) {
        return res.status(410).json({ error: '结果文件已过期，请重新分析。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.sendFile(file);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/export', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed' || !job.exportPath) {
        return res.status(409).json({ error: '导出文件尚未生成。' });
      }
      const file = storageFilePath(root, storageRoot, job.exportPath);
      if (!file || !fs.existsSync(file)) {
        return res.status(410).json({ error: '导出文件已过期，请重新分析。' });
      }
      const base = path.basename(job.originalFilename, path.extname(job.originalFilename)) || '序时账';
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, `${base.slice(0, 120)}-分析报告.xlsx`);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status === 'queued' || job.status === 'running') {
        return res.status(409).json({ error: '分析进行中，暂时不能删除。' });
      }
      await repository.deleteJobForOwner(job.id, ownerUsername(req));
      try { fs.rmSync(runner.jobDir(job.id), { recursive: true, force: true }); } catch (_) {}
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createJournalEntryRouter, publicJob, normalizeRequest };

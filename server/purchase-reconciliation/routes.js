'use strict';

/*
 * 采购与退货对抵（FIFO）HTTP routes.
 *
 *   GET    /api/purchase-reconciliations/meta
 *   POST   /api/purchase-reconciliations                       upload -> draft
 *   GET    /api/purchase-reconciliations                       owner history
 *   POST   /api/purchase-reconciliations/:id/inspect           sheet / header detection
 *   POST   /api/purchase-reconciliations/:id/start             validate + queue worker
 *   GET    /api/purchase-reconciliations/:id                   status
 *   GET    /api/purchase-reconciliations/:id/summary           dashboard summary
 *   GET    /api/purchase-reconciliations/:id/matches           FIFO segments (paged)
 *   GET    /api/purchase-reconciliations/:id/matches/:matchId  segment + both records
 *   GET    /api/purchase-reconciliations/:id/matched           matched records (paged)
 *   GET    /api/purchase-reconciliations/:id/remaining         remaining rows (paged)
 *   GET    /api/purchase-reconciliations/:id/download          xlsx | zip
 *   DELETE /api/purchase-reconciliations/:id
 *
 * Auth and same-origin checks are applied by the parent app.use() in server.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const repository = require('./repository');
const { createDraftJobFromBuffer, JobCreationError } = require('./job-factory');
const { createInspectionRunner } = require('./inspection-runner');
const { createReconciliationRunner } = require('./worker-runner');
const {
  paginateNdjson,
  readNdjson,
  findSegment,
  findSegmentsByIds,
  MAX_PAGE_SIZE
} = require('./result-store');
const { repairMojibake } = require('../excel-review/encoding');
const { FIELD_SCHEMA, FIELD_LABELS, DEFAULT_MATCH_FIELDS, REQUIRED_FIELDS } = require('./schema');

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_HISTORY = 50;
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

class ValidationError extends Error {}

function validJobId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

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

function publicJob(job, extra = {}) {
  if (!job) return null;
  return {
    id: job.id,
    originalFilename: job.originalFilename,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    sheetName: job.sheetName,
    headerRow: job.headerRow,
    xlsxStatus: job.xlsxStatus,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    hasSummary: Boolean(job.resultDir),
    summary: job.summaryJson || null,
    ...extra
  };
}

function parseHeaderRow(value) {
  if (value === undefined || value === null || value === '') return null;
  const row = Number(value);
  if (!Number.isInteger(row) || row < 1 || row > 1000000) {
    throw new ValidationError('表头行号不正确。');
  }
  return row;
}

function cleanMapping(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('字段映射格式不正确。');
  }
  const mapping = {};
  for (const [field, header] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(FIELD_LABELS, field)) continue;
    const name = String(header || '').trim();
    if (!name) continue;
    if (name.length > 300) throw new ValidationError('字段名过长。');
    mapping[field] = name;
  }
  return mapping;
}

function cleanMatchFields(value) {
  if (value === undefined || value === null) return [...DEFAULT_MATCH_FIELDS];
  if (!Array.isArray(value)) throw new ValidationError('匹配字段格式不正确。');
  const fields = [];
  for (const raw of value) {
    const field = String(raw || '').trim();
    if (!field) continue;
    if (!Object.prototype.hasOwnProperty.call(FIELD_LABELS, field)) {
      throw new ValidationError(`未知的匹配字段：${field}`);
    }
    if (!fields.includes(field)) fields.push(field);
  }
  if (!fields.length) throw new ValidationError('请至少选择一个匹配字段。');
  return fields;
}

function normalizeRequest(body, { requireSheet = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求参数不正确。');
  }
  const sheetName = String(body.sheetName || '').trim();
  if (requireSheet && !sheetName) throw new ValidationError('请选择工作表。');
  if (sheetName.length > 200) throw new ValidationError('工作表名称过长。');
  const headerRow = parseHeaderRow(body.headerRow);
  if (requireSheet && !headerRow) throw new ValidationError('请确认表头行。');
  return {
    sheetName: sheetName || null,
    headerRow,
    mapping: cleanMapping(body.mapping),
    matchFields: cleanMatchFields(body.matchFields)
  };
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function errorMessage(payload, fallback) {
  const error = payload && payload.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

function createPurchaseReconciliationRouter({ root }) {
  const router = express.Router();
  const storageRoot = path.join(root, 'storage', 'purchase-reconciliation');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const inspectionRunner = createInspectionRunner({ root });
  const runner = createReconciliationRunner({
    root,
    repository,
    storageRoot,
    maxConcurrent: Number(process.env.PURCHASE_RECONCILIATION_MAX_CONCURRENT || 1)
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
        return res.status(413).json({ error: '文件超过 50MB 限制。' });
      }
      return res.status(400).json({ error: '文件上传失败。' });
    });
  };

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

  function writeRequest(jobId, normalized) {
    const dir = jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJsonAtomic(path.join(dir, 'request.json'), {
      sheetName: normalized.sheetName,
      headerRow: normalized.headerRow || 1,
      matchFields: normalized.matchFields,
      mapping: normalized.mapping || undefined
    });
  }

  async function inspectJob(job, normalized) {
    writeRequest(job.id, normalized);
    const inspection = await inspectionRunner.run({ jobDir: jobDir(job.id) });
    if (inspection.ok) {
      const updated = await repository.updateJobState(job.id, {
        sheetName: inspection.selectedSheet || job.sheetName,
        headerRow: inspection.headerRow || job.headerRow
      });
      return { inspection, job: updated };
    }
    return { inspection, job };
  }

  router.get('/meta', requireAuthSafe(), (_req, res) => {
    res.json({
      maxFileSizeBytes: MAX_FILE_SIZE,
      extensions: ['.xlsx', '.xlsm'],
      maxPageSize: MAX_PAGE_SIZE,
      defaultMatchFields: DEFAULT_MATCH_FIELDS,
      requiredFields: REQUIRED_FIELDS,
      fieldSchema: FIELD_SCHEMA,
      matchFieldOptions: DEFAULT_MATCH_FIELDS.map((field) => ({
        key: field,
        label: FIELD_LABELS[field]
      })),
      maxConcurrent: runner.maxConcurrent,
      retentionHours: runner.retentionHours,
      polling: true
    });
  });

  // requireAuth is enforced twice (mounted router + per route): cheap and keeps
  // this file safe if it is ever mounted without the parent guard.
  function requireAuthSafe() {
    return (req, res, next) => {
      if (req.session?.auth?.username) return next();
      return res.status(401).json({ error: '请先登录。' });
    };
  }

  router.post('/', requireAuthSafe(), uploadOne, async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '请选择 .xlsx 或 .xlsm 文件。' });
      const originalFilename = safeOriginalName(repairMojibake(req.file.originalname));
      const extension = extensionOf(originalFilename);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: '仅支持 .xlsx / .xlsm 文件。' });
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

      const inspection = await inspectionRunner.run({ jobDir: jobDir(job.id) });
      if (inspection.ok) {
        const updated = await repository.updateJobState(job.id, {
          sheetName: inspection.selectedSheet,
          headerRow: inspection.headerRow
        });
        return res.status(201).json({ job: publicJob(updated, { inspection }), inspection });
      }
      return res.status(201).json({
        job: publicJob(job, { inspection }),
        inspection
      });
    } catch (error) {
      if (error instanceof JobCreationError) {
        return res.status(error.status).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/', requireAuthSafe(), async (req, res, next) => {
    try {
      const jobs = await repository.listJobsForOwner(ownerUsername(req));
      return res.json({ jobs: jobs.slice(0, MAX_HISTORY).map((job) => publicJob(job)) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/inspect', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft') {
        return res.status(409).json({ error: '只有待确认的任务可以重新识别。' });
      }
      const normalized = normalizeRequest(req.body);
      const { inspection, job: updated } = await inspectJob(job, normalized);
      if (!inspection.ok) {
        return res.status(422).json({
          error: errorMessage(inspection, '无法识别工作簿。'),
          job: publicJob(updated),
          inspection
        });
      }
      return res.json({ job: publicJob(updated, { inspection }), inspection });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.post('/:id/start', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'draft') {
        return res.status(409).json({ error: '该任务已经提交或完成。' });
      }
      const normalized = normalizeRequest(req.body, { requireSheet: true });
      writeRequest(job.id, normalized);

      // Validate against the real header before queueing so missing columns are
      // reported immediately instead of failing asynchronously.
      const inspection = await inspectionRunner.run({ jobDir: jobDir(job.id) });
      if (!inspection.ok) {
        return res.status(422).json({ error: errorMessage(inspection, '无法识别工作簿。'), inspection });
      }
      if (Array.isArray(inspection.missing) && inspection.missing.length) {
        return res.status(422).json({
          error: `缺少必要字段：${inspection.missingLabels.join('、')}`,
          inspection
        });
      }
      if (Array.isArray(inspection.invalidMapping) && inspection.invalidMapping.length) {
        return res.status(422).json({
          error: `字段映射无效：${inspection.invalidMapping.join('；')}`,
          inspection
        });
      }

      const queued = await repository.updateJobState(job.id, {
        status: 'queued',
        progress: 0,
        progressMessage: '已排队，等待执行 FIFO 对抵…',
        sheetName: inspection.selectedSheet || normalized.sheetName,
        headerRow: inspection.headerRow || normalized.headerRow,
        requestJson: {
          sheetName: normalized.sheetName,
          headerRow: normalized.headerRow,
          matchFields: normalized.matchFields,
          mapping: normalized.mapping || undefined
        },
        resultDir: null,
        xlsxStatus: null,
        summaryJson: null,
        error: null,
        completedAt: null
      });
      runner.enqueue(job.id);
      return res.status(202).json({ job: publicJob(queued), inspection });
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/:id', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      // Keep the XLSX badge fresh even if the in-process poll missed a tick.
      const status = readStatusFile(jobDir(job.id));
      if (status?.xlsx && status.xlsx !== job.xlsxStatus && job.status === 'completed') {
        const updated = await repository.updateJobState(job.id, { xlsxStatus: status.xlsx });
        return res.json({ job: publicJob(updated) });
      }
      return res.json({ job: publicJob(job) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/summary', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') {
        return res.status(409).json({ error: '结果尚未生成。' });
      }
      const file = resultFile(job, 'summary.json');
      if (!file) return res.status(410).json({ error: '结果已过期，请重新对抵。' });
      res.set('Cache-Control', 'private, no-store');
      return res.sendFile(file);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/matches', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      const file = resultFile(job, 'segments.ndjson');
      if (!file) return res.status(409).json({ error: '对抵分段尚未生成。' });
      const payload = await paginateNdjson(file, {
        query: req.query,
        filters: {
          positiveMovementType: req.query.positiveMovementType,
          negativeMovementType: req.query.negativeMovementType
        },
        sortFields: {
          matchId: 'matchId',
          positiveSourceRow: 'positiveSourceRow',
          negativeSourceRow: 'negativeSourceRow',
          matchedQuantity: 'matchedQuantity',
          matchedAmount: 'matchedAmount',
          positiveDate: 'positiveDate',
          negativeDate: 'negativeDate'
        },
        defaultSort: 'matchId',
        tieBreaker: 'matchId'
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/matches/:matchId', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      const matchId = String(req.params.matchId || '');
      if (!/^MATCH-\d{6,}$/.test(matchId)) {
        return res.status(400).json({ error: '匹配ID格式不正确。' });
      }
      const segmentsFile = resultFile(job, 'segments.ndjson');
      if (!segmentsFile) return res.status(409).json({ error: '对抵分段尚未生成。' });
      const segment = await findSegment(segmentsFile, matchId);
      if (!segment) return res.status(404).json({ error: '匹配记录不存在。' });
      const matchedRows = await readNdjson(resultFile(job, 'matched.ndjson') || '');
      const remainingRows = await readNdjson(resultFile(job, 'remaining.ndjson') || '');
      const byRow = new Map();
      for (const row of remainingRows) byRow.set(Number(row.sourceRow), row);
      for (const row of matchedRows) byRow.set(Number(row.sourceRow), row);
      return res.json({
        segment,
        positiveRecord: byRow.get(Number(segment.positiveSourceRow)) || null,
        negativeRecord: byRow.get(Number(segment.negativeSourceRow)) || null
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/matched', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      const file = resultFile(job, 'matched.ndjson');
      if (!file) return res.status(409).json({ error: '已对抵记录尚未生成。' });
      const payload = await paginateNdjson(file, {
        query: req.query,
        filters: {
          direction: req.query.direction
        },
        sortFields: {
          sourceRow: 'sourceRow',
          matchedQuantity: 'matchedQuantity',
          matchedAmount: 'matchedAmount'
        },
        defaultSort: 'sourceRow',
        searchFields: ['sourceRow', 'businessKey', 'matchIds', 'raw'],
        tieBreaker: 'sourceRow'
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/remaining', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      const file = resultFile(job, 'remaining.ndjson');
      if (!file) return res.status(409).json({ error: '剩余数据尚未生成。' });
      const onlyUnmatched = ['1', 'true', 'yes'].includes(String(req.query.unmatched || ''));
      const payload = await paginateNdjson(file, {
        query: req.query,
        predicate: onlyUnmatched
          ? (row) => Number(row.remainingQuantity) < 0
          : undefined,
        filters: {
          direction: req.query.direction
        },
        sortFields: {
          sourceRow: 'sourceRow',
          originalQuantity: 'originalQuantity',
          matchedQuantity: 'matchedQuantity',
          remainingQuantity: 'remainingQuantity',
          originalAmount: 'originalAmount',
          remainingAmount: 'remainingAmount',
          deliveryDate: 'raw.送货日期',
          supplier: 'raw.供应商',
          purchaseOrder: 'raw.采购订单',
          materialCode: 'raw.物料编码'
        },
        defaultSort: 'sourceRow',
        searchFields: ['sourceRow', 'businessKey', 'matchIds', 'raw'],
        tieBreaker: 'sourceRow'
      });
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/download', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'completed') {
        return res.status(409).json({ error: '对抵尚未完成。' });
      }
      const format = String(req.query.format || 'xlsx').toLowerCase();
      const base = path.basename(job.originalFilename, path.extname(job.originalFilename)) || '对抵结果';
      if (format === 'zip' || format === 'csv') {
        const file = resultFile(job, 'reconciliation-result-csv.zip');
        if (!file) return res.status(410).json({ error: 'CSV 文件已过期，请重新对抵。' });
        res.set('Cache-Control', 'private, no-store');
        return res.download(file, `${base.slice(0, 120)}-对抵结果CSV.zip`);
      }
      if (format !== 'xlsx') {
        return res.status(400).json({ error: '仅支持 xlsx 或 zip 下载。' });
      }
      if (job.xlsxStatus === 'generating') {
        return res.status(409).json({ error: 'XLSX 仍在生成中，请稍后再试。' });
      }
      const file = resultFile(job, 'reconciliation-result.xlsx');
      if (!file) {
        if (job.xlsxStatus === 'error') {
          return res.status(422).json({ error: 'XLSX 生成失败，请下载 CSV 版本。' });
        }
        return res.status(409).json({ error: 'XLSX 仍在生成中，请稍后再试。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, `${base.slice(0, 120)}-对抵结果.xlsx`);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireAuthSafe(), async (req, res, next) => {
    try {
      const job = await getOwnedJob(req, res);
      if (!job) return;
      if (job.status === 'queued' || job.status === 'running') {
        return res.status(409).json({ error: '对抵进行中，暂时不能删除。' });
      }
      if (job.status === 'completed' && job.xlsxStatus === 'generating') {
        return res.status(409).json({ error: 'XLSX 仍在生成，请稍后再删除。' });
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

function readStatusFile(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { createPurchaseReconciliationRouter };

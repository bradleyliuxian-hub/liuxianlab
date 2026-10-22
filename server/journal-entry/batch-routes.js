'use strict';

/*
 * Journal Entry multi-file batch orchestration.
 *
 *   GET    /api/journal-entry-batches/meta
 *   POST   /api/journal-entry-batches                 upload N files -> draft children
 *   GET    /api/journal-entry-batches                 owner batch history
 *   GET    /api/journal-entry-batches/:id             batch detail + per-file jobs
 *   POST   /api/journal-entry-batches/:id/start       validate configured drafts, queue all
 *
 * Batch is orchestration only: child jobs use the existing single-file
 * inspect / preview / worker / result / export endpoints.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const batchRepository = require('./batch-repository');
const batchOutputRepository = require('./batch-output-repository');
const splitRepository = require('./split-repository');
const repository = require('./repository');
const {
  createDraftJobFromBuffer,
  looksLikeXls,
  looksLikeXlsx,
  JobCreationError
} = require('./job-factory');
const { getJournalEntryRuntime } = require('./runtime');
const { publicJob } = require('./routes');
const { aggregateCompletedSummaries } = require('./batch-summary');
const { runBatchOutput } = require('./batch-output-runner');
const { safeRemove } = require('./storage-safety');
const { repairMojibake } = require('../excel-review/encoding');

const MAX_FILES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const OUTPUT_TYPES = new Set(['summary', 'merged', 'zip']);
const ALLOWED_EXTENSIONS = new Set(['.xls', '.xlsx']);
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

class ValidationError extends Error {}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function validBatchId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function safeOriginalName(value) {
  const base = path.basename(String(value || 'workbook.xlsx'))
    .replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 180) || 'workbook.xlsx';
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function errorMessage(payload, fallback) {
  const error = payload && payload.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

function validateUpload(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new ValidationError('请选择至少一个 .xls 或 .xlsx 文件。');
  }
  if (files.length > MAX_FILES) {
    throw new ValidationError(`一次最多上传 ${MAX_FILES} 个文件。`);
  }
  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return {
      error: `批量上传总大小不能超过 ${Math.round(MAX_TOTAL_SIZE / 1024 / 1024)} MB。`,
      files: []
    };
  }
  const prepared = [];
  const errors = [];
  files.forEach((file, index) => {
    const originalFilename = safeOriginalName(repairMojibake(file.originalname));
    const extension = extensionOf(originalFilename);
    let error = null;
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      error = '仅支持 .xls / .xlsx 文件。';
    } else if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) {
      error = '文件类型不受支持。';
    } else {
      const magicOk = extension === '.xlsx'
        ? looksLikeXlsx(file.buffer)
        : looksLikeXls(file.buffer);
      if (!magicOk) error = '文件内容不是有效的 Excel 工作簿。';
    }
    if (error) {
      errors.push({ index, filename: originalFilename, error });
    } else {
      prepared.push({ file, originalFilename, extension: extension.replace(/^\./, '') });
    }
  });
  if (errors.length) {
    return { error: '部分文件校验失败，未创建批量任务。', files: errors };
  }
  return { prepared, totalSize };
}

function createBatchRouter({
  root,
  requireAuth,
  runtime,
  outputRunner = runBatchOutput,
  outputRepository = batchOutputRepository
}) {
  const router = express.Router();
  const batchStorageRoot = path.join(root, 'storage', 'journal-entry-batches');
  fs.mkdirSync(batchStorageRoot, { recursive: true, mode: 0o700 });
  let activeOutputs = 0;
  const outputLimit = Math.max(
    1,
    Number(process.env.JOURNAL_ENTRY_BATCH_EXPORT_CONCURRENCY || 1)
  );
  const journalRuntime = runtime || getJournalEntryRuntime({
    root,
    repository
  });
  const { storageRoot, previewRunner, runner } = journalRuntime;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES
    },
    defParamCharset: 'utf8'
  });

  const uploadMany = (req, res, next) => {
    upload.array('files', MAX_FILES)(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `单个文件不能超过 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB。` });
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `一次最多上传 ${MAX_FILES} 个文件。` });
      }
      return res.status(400).json({ error: '文件上传失败。' });
    });
  };

  async function getOwnedBatch(req, res) {
    if (!validBatchId(req.params.id)) {
      res.status(404).json({ error: '批量任务不存在。' });
      return null;
    }
    const batch = await batchRepository.getBatchDetailForOwner(
      req.params.id,
      ownerUsername(req)
    );
    if (!batch) {
      res.status(404).json({ error: '批量任务不存在。' });
      return null;
    }
    return batch;
  }

  function publicBatch(batch) {
    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      progress: batch.progress,
      totalCount: batch.totalCount,
      draftCount: batch.draftCount,
      queuedCount: batch.queuedCount,
      runningCount: batch.runningCount,
      completedCount: batch.completedCount,
      failedCount: batch.failedCount,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      summary: aggregateCompletedSummaries(
        (batch.items || []).map((item) => item.job),
        { totalFileCount: batch.totalCount }
      ),
      items: (batch.items || []).map((item) => ({
        position: item.position,
        originalFilename: item.originalFilename,
        fileSize: item.fileSize || 0,
        job: publicJob(item.job)
      }))
    };
  }


  function publicOutput(output) {
    if (!output) return null;
    const base = `/api/journal-entry-batches/${encodeURIComponent(output.batchId)}/exports/${encodeURIComponent(output.id)}`;
    return {
      id: output.id,
      batchId: output.batchId,
      status: output.status,
      snapshot: output.snapshot || null,
      createdAt: output.createdAt,
      completedAt: output.completedAt,
      error: output.error || null,
      expired: Boolean(output.expiredAt),
      downloads: output.status === 'completed' && !output.expiredAt
        ? {
            summary: `${base}/summary`,
            merged: `${base}/merged`,
            zip: `${base}/zip`
          }
        : null
    };
  }

  function resolveContainedPath(base, relative) {
    if (!relative) return null;
    const absolute = path.resolve(root, relative);
    const rootPath = path.resolve(base);
    if (absolute !== rootPath && !absolute.startsWith(`${rootPath}${path.sep}`)) {
      return null;
    }
    return absolute;
  }

  function jobFilePath(job, key) {
    return resolveContainedPath(
      path.join(root, 'storage', 'journal-entry'),
      job[key]
    );
  }

  function outputFilePath(relative) {
    return resolveContainedPath(batchStorageRoot, relative);
  }

  function relativeToRoot(absolute) {
    return path.relative(root, absolute).split(path.sep).join('/');
  }

  function exclusionReason(job) {
    if (job.status === 'failed') return job.error || '分析失败。';
    if (job.status === 'draft') return '未完成配置，尚不可导出。';
    return '分析尚未完成。';
  }

  async function cleanupCreated(createdJobs, batchId) {
    for (const job of createdJobs) {
      try { await repository.deleteJobById(job.id); } catch (_) {}
      try { fs.rmSync(runner.jobDir(job.id), { recursive: true, force: true }); } catch (_) {}
    }
    if (batchId) {
      try { await batchRepository.deleteBatch(batchId); } catch (_) {}
    }
  }

  router.get('/meta', requireAuth, (_req, res) => {
    res.json({
      maxFiles: MAX_FILES,
      maxFileSizeBytes: MAX_FILE_SIZE,
      maxTotalSizeBytes: MAX_TOTAL_SIZE,
      extensions: ['.xls', '.xlsx'],
      childrenUseSingleFileApi: true,
      retentionHours: runner.retentionHours
    });
  });

  router.post('/', requireAuth, uploadMany, async (req, res, next) => {
    try {
      const validation = validateUpload(req.files);
      if (validation.error) {
        return res.status(validation.files?.length ? 400 : 413).json(validation);
      }
      const { prepared } = validation;
      const batchId = crypto.randomUUID();
      const first = path.basename(
        prepared[0].originalFilename,
        path.extname(prepared[0].originalFilename)
      );
      const name = prepared.length === 1
        ? `${first}（单文件批次）`
        : `${first} 等 ${prepared.length} 个文件`;

      await batchRepository.createBatch({
        id: batchId,
        ownerUsername: ownerUsername(req),
        name
      });

      const createdJobs = [];
      try {
        for (let position = 0; position < prepared.length; position += 1) {
          const item = prepared[position];
          const job = await createDraftJobFromBuffer({
            repository,
            root,
            storageRoot,
            ownerUsername: ownerUsername(req),
            originalFilename: item.originalFilename,
            extension: item.extension,
            buffer: item.file.buffer
          });
          createdJobs.push(job);
          await batchRepository.addItem({
            batchId,
            jobId: job.id,
            position,
            originalFilename: item.originalFilename,
            fileSize: item.file.size
          });

          const inspection = await previewRunner.run({
            jobDir: runner.jobDir(job.id),
            mode: 'inspect'
          });
          if (inspection.ok) {
            await repository.updateJobState(job.id, {
              sheetName: inspection.selectedSheet || inspection.sheetName || null,
              headerRow: Number(inspection.headerRow) || null,
              amountLayout: inspection.amountLayout?.layout || null
            });
          } else {
            await repository.updateJobState(job.id, {
              status: 'failed',
              progress: 100,
              progressMessage: '无法读取该工作簿。',
              error: errorMessage(inspection, '无法读取该工作簿。')
            });
          }
        }
      } catch (error) {
        await cleanupCreated(createdJobs, batchId);
        throw error;
      }

      const detail = await batchRepository.getBatchDetailForOwner(
        batchId,
        ownerUsername(req)
      );
      return res.status(201).json({ batch: publicBatch(detail) });
    } catch (error) {
      if (error instanceof JobCreationError) {
        return res.status(error.status).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const batches = await batchRepository.listBatchesForOwner(ownerUsername(req));
      return res.json({ batches });
    } catch (error) {
      return next(error);
    }
  });


  router.post('/:id/exports', requireAuth, async (req, res, next) => {
    let outputDir = null;
    let outputId = null;
    let backgroundStarted = false;
    try {
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const owner = ownerUsername(req);
      const completed = batch.items
        .filter((item) => item.job.status === 'completed')
        .sort((a, b) => a.position - b.position);
      if (!completed.length) {
        return res.status(422).json({ error: '没有已完成文件可导出。' });
      }
      if (completed.some((item) => item.job.ownerUsername !== owner)) {
        return res.status(500).json({ error: '批量任务包含无效的归属文件，已停止导出。' });
      }
      const missingResults = [];
      for (const item of completed) {
        const resultPath = jobFilePath(item.job, 'resultPath');
        if (!resultPath || !fs.existsSync(resultPath)) {
          missingResults.push(item.originalFilename);
        }
      }
      if (missingResults.length) {
        return res.status(422).json({
          error: '部分已完成文件缺少结果文件，无法生成批量输出。',
          files: missingResults
        });
      }
      if (activeOutputs >= outputLimit) {
        return res.status(429).json({ error: '已有批量导出正在生成，请稍后再试。' });
      }
      activeOutputs += 1;
        outputId = crypto.randomUUID();
        outputDir = path.join(batchStorageRoot, batch.id, outputId);
        fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

        const summary = aggregateCompletedSummaries(
          completed.map((item) => item.job),
          { totalFileCount: batch.totalCount }
        );
        const generatedAt = new Date().toISOString();
        const excluded = batch.items
          .filter((item) => item.job.status !== 'completed')
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            position: item.position,
            job_id: item.job.id,
            original_filename: item.originalFilename,
            status: item.job.status,
            reason: exclusionReason(item.job),
            amount_layout: item.job.amountLayout || null,
            positive_side: item.job.positiveSide || null
          }));
        const excludedDraft = excluded.filter((item) => item.status === 'draft').length;
        const excludedActive = excluded.filter(
          (item) => item.status === 'queued' || item.status === 'running'
        ).length;
        const excludedFailed = excluded.filter((item) => item.status === 'failed').length;
        const included = completed.map((item) => {
          const resultPath = jobFilePath(item.job, 'resultPath');
          const exportPath = jobFilePath(item.job, 'exportPath')
            || path.join(runner.jobDir(item.job.id), 'journal-entry-analysis-report.xlsx');
          return {
            position: item.position,
            job_id: item.job.id,
            original_filename: item.originalFilename,
            status: 'completed',
            result_path: resultPath,
            export_path: exportPath,
            summary: item.job.summaryJson || null,
            amount_layout: item.job.amountLayout || null,
            positive_side: item.job.positiveSide || null,
            sheet_name: item.job.sheetName || null,
            header_row: item.job.headerRow || null,
            completed_at: item.job.completedAt || null
          };
        });
        const snapshot = {
          batch_output_schema_version: 1,
          batch_id: batch.id,
          batch_name: batch.name,
          generated_at: generatedAt,
          total_files: batch.totalCount,
          included_files: included.length,
          excluded_files: excluded.length,
          excluded_draft: excludedDraft,
          excluded_active: excludedActive,
          excluded_failed: excludedFailed,
          included_job_ids: included.map((item) => item.job_id),
          excluded_job_ids: excluded.map((item) => item.job_id),
          child_results: included.map((item) => ({
            job_id: item.job_id,
            completed_at: item.completed_at
          })),
          outputs: {}
        };

        const outputRecord = await outputRepository.createOutput({
          id: outputId,
          batchId: batch.id,
          ownerUsername: owner,
          snapshot
        });
        if (!outputRecord) {
          throw new Error('无法创建批量导出记录。');
        }

        const requestPayload = {
          schema_version: 1,
          batch: {
            id: batch.id,
            name: batch.name,
            generated_at: generatedAt,
            total_files: batch.totalCount,
            included_files: included.length,
            excluded_files: excluded.length,
            excluded_draft: excludedDraft,
            excluded_active: excludedActive,
            excluded_failed: excludedFailed,
            summary
          },
          included,
          excluded
        };
        fs.writeFileSync(
          path.join(outputDir, 'batch_request.json'),
          `${JSON.stringify(requestPayload, null, 2)}\n`,
          { mode: 0o600 }
        );

        backgroundStarted = true;
        setImmediate(() => {
          (async () => {
            try {
              const run = await outputRunner({ root, outputDir });
              if (!run.ok) {
                await outputRepository.markFailed(outputId, run.error || '生成失败');
                safeRemove(batchStorageRoot, outputDir);
                return;
              }
              const files = {
                summary: path.join(outputDir, 'batch-summary.xlsx'),
                merged: path.join(outputDir, 'merged-standardized-journal.xlsx'),
                manifest: path.join(outputDir, 'manifest.json'),
                zip: path.join(outputDir, 'batch-report.zip')
              };
              if (!Object.values(files).every((file) => fs.existsSync(file))) {
                await outputRepository.markFailed(outputId, '输出文件缺失。');
                safeRemove(batchStorageRoot, outputDir);
                return;
              }
              await outputRepository.markCompleted(outputId, {
                summaryPath: relativeToRoot(files.summary),
                mergedPath: relativeToRoot(files.merged),
                zipPath: relativeToRoot(files.zip),
                snapshot: {
                  ...snapshot,
                  outputs: {
                    summary: files.summary.split(path.sep).pop(),
                    merged: files.merged.split(path.sep).pop(),
                    manifest: files.manifest.split(path.sep).pop(),
                    zip: files.zip.split(path.sep).pop()
                  }
                }
              });
            } catch (_) {
              try { await outputRepository.markFailed(outputId, '批量导出生成失败。'); } catch (__) {}
              safeRemove(batchStorageRoot, outputDir);
            } finally {
              activeOutputs -= 1;
            }
          })();
        });
        return res.status(202).json({ output: publicOutput(outputRecord) });
    } catch (error) {
      if (!backgroundStarted) activeOutputs -= 1;
      if (outputId) {
        try {
          await outputRepository.markFailed(outputId, '批量导出生成失败。');
        } catch (_) {}
      }
      if (outputDir) {
        try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch (_) {}
      }
      return next(error);
    }
  });

  router.get('/:id/exports/latest', requireAuth, async (req, res, next) => {
    try {
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const output = await outputRepository.getLatestForOwner(
        batch.id,
        ownerUsername(req)
      );
      return res.json({ output: publicOutput(output) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/exports/:outputId/:type', requireAuth, async (req, res, next) => {
    try {
      if (!validBatchId(req.params.id) || !validBatchId(req.params.outputId)) {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      if (!OUTPUT_TYPES.has(req.params.type)) {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const output = await outputRepository.getForOwner(
        req.params.outputId,
        batch.id,
        ownerUsername(req)
      );
      if (!output || output.status !== 'completed') {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      if (output.expiredAt) {
        return res.status(410).json({ error: '导出文件已过期，请重新生成。' });
      }
      const relative = output.summaryPath
        ? { summary: output.summaryPath, merged: output.mergedPath, zip: output.zipPath }[req.params.type]
        : null;
      const file = outputFilePath(relative);
      if (!file || !fs.existsSync(file)) {
        return res.status(404).json({ error: '导出文件不存在或已过期。' });
      }
      const names = {
        summary: 'batch-summary.xlsx',
        merged: 'merged-standardized-journal.xlsx',
        zip: 'batch-report.zip'
      };
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, names[req.params.type]);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id/exports/:outputId', requireAuth, async (req, res, next) => {
    try {
      if (!validBatchId(req.params.id) || !validBatchId(req.params.outputId)) {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const output = await outputRepository.getForOwner(
        req.params.outputId,
        batch.id,
        ownerUsername(req)
      );
      if (!output) return res.status(404).json({ error: '导出文件不存在。' });
      if (output.status === 'generating') {
        return res.status(409).json({ error: '导出正在生成，暂时不能删除。' });
      }
      const dir = path.join(batchStorageRoot, batch.id, output.id);
      safeRemove(batchStorageRoot, dir);
      const expired = await outputRepository.expireOutput(output.id);
      return res.json({ ok: true, output: publicOutput(expired) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const activeChild = batch.items.some(
        (item) => item.job.status === 'queued' || item.job.status === 'running'
      );
      const outputs = await outputRepository.listForBatch(batch.id);
      const splits = await splitRepository.listByScope('batch', batch.id);
      const activeOutput = outputs.some((item) => item.status === 'generating')
        || splits.some((item) => item.status === 'generating');
      if (activeChild || activeOutput) {
        return res.status(409).json({ error: '批次仍有分析或导出任务进行中，暂时不能删除。' });
      }
      await batchRepository.softDeleteBatch(batch.id);
      await batchRepository.deleteItemsForBatch(batch.id);
      for (const output of outputs) {
        safeRemove(batchStorageRoot, path.join(batchStorageRoot, batch.id, output.id));
        await outputRepository.expireOutput(output.id);
      }
      const splitStorageRoot = path.join(root, 'storage', 'journal-entry-splits');
      for (const output of splits) {
        safeRemove(splitStorageRoot, path.join(splitStorageRoot, output.id));
        await splitRepository.expireOutput(output.id);
      }
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      return res.json({ batch: publicBatch(batch) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/start', requireAuth, async (req, res, next) => {
    try {
      const batch = await getOwnedBatch(req, res);
      if (!batch) return;
      const drafts = batch.items.filter((item) => item.job.status === 'draft');
      if (!drafts.length) {
        return res.status(409).json({ error: '没有待开始的文件。' });
      }

      const ready = [];
      const notReady = [];
      for (const item of drafts) {
        const request = item.job.requestJson;
        if (
          !request
          || !request.mapping
          || !Object.keys(request.mapping).length
          || !request.sheetName
          || !request.headerRow
        ) {
          notReady.push({
            jobId: item.job.id,
            filename: item.originalFilename,
            reason: '尚未完成字段映射。'
          });
          continue;
        }
        let preview;
        try {
          preview = await previewRunner.run({
            jobDir: runner.jobDir(item.job.id),
            mode: 'preview'
          });
        } catch (error) {
          preview = { ok: false, error: error.message };
        }
        if (!preview.ok || !preview.canStart) {
          notReady.push({
            jobId: item.job.id,
            filename: item.originalFilename,
            reason: errorMessage(preview, '映射校验失败。')
          });
          continue;
        }
        ready.push(item);
      }

      if (!ready.length) {
        return res.status(422).json({
          error: '没有可启动的文件。',
          startedCount: 0,
          skippedCount: notReady.length,
          startedJobIds: [],
          notReady
        });
      }

      for (const item of ready) {
        await repository.updateJobState(item.job.id, {
          status: 'queued',
          progress: 0,
          progressMessage: '已排队，等待分析…',
          error: null,
          completedAt: null
        });
        runner.enqueue(item.job.id);
      }
      await batchRepository.touchBatch(batch.id);

      const detail = await batchRepository.getBatchDetailForOwner(
        batch.id,
        ownerUsername(req)
      );
      return res.status(202).json({
        batch: publicBatch(detail),
        startedCount: ready.length,
        skippedCount: notReady.length,
        startedJobIds: ready.map((item) => item.job.id),
        notReady
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createJournalEntryBatchRouter: createBatchRouter,
  validateUpload,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE
};

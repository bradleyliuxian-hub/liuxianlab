'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const repository = require('./repository');
const batchRepository = require('./batch-repository');
const {
  COLUMN_GROUPS, COLUMN_DEFINITIONS, DEFAULT_COLUMN_ORDER, cleanColumns
} = require('./export-columns');
const {
  cleanFilters, cleanRowSelection, MAX_EXPLICIT_ROWS, PREVIEW_PAGE_SIZES
} = require('./split-routes');
const { createStandardExportRunner } = require('./standard-export-runner');

class ValidationError extends Error {}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function jobFilePath(root, job) {
  if (!job || !job.resultPath) return null;
  const base = path.resolve(root, 'storage', 'journal-entry');
  const absolute = path.resolve(root, job.resultPath);
  if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) return null;
  return absolute;
}

function cleanPaging(body) {
  let page = Number(body.page);
  if (!Number.isInteger(page) || page < 1) page = 1;
  page = Math.min(page, 1000000);
  let pageSize = Number(body.pageSize || body.page_size);
  if (!Number.isInteger(pageSize) || !PREVIEW_PAGE_SIZES.includes(pageSize)) pageSize = 50;
  return { page, pageSize };
}

function normalizeSpec(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求参数不正确。');
  }
  const scopeType = String(body.scopeType || body.scope_type || '');
  const scopeId = String(body.scopeId || body.scope_id || '');
  if (!['job', 'batch'].includes(scopeType) || !validId(scopeId)) {
    throw new ValidationError('数据范围无效。');
  }
  let columns = null;
  try {
    columns = cleanColumns(body.columns);
  } catch (error) {
    throw new ValidationError(error.message);
  }
  let filters = {};
  try {
    filters = cleanFilters(body.filters);
  } catch (error) {
    throw new ValidationError(error.message);
  }
  let selection;
  try {
    selection = cleanRowSelection(body);
  } catch (error) {
    throw new ValidationError(error.message);
  }
  return {
    scopeType,
    scopeId,
    columns,
    filters,
    ...selection
  };
}

function createStandardExportRouter({ root, requireAuth, runner }) {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  const storageRoot = path.join(root, 'storage', 'journal-entry-standard-exports');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const exportRunner = runner || createStandardExportRunner({ root, storageRoot });
  let active = 0;
  const limit = Math.max(
    1,
    Number(process.env.JOURNAL_ENTRY_STANDARD_EXPORT_CONCURRENCY || 1)
  );

  async function buildScope(scopeType, scopeId, owner) {
    if (scopeType === 'job') {
      const job = await repository.getJobForOwner(scopeId, owner);
      if (!job) return null;
      if (job.status !== 'completed') {
        throw new ValidationError('该任务尚未完成，无法导出。');
      }
      const resultPath = jobFilePath(root, job);
      if (!resultPath || !fs.existsSync(resultPath)) {
        throw new ValidationError('该任务结果文件不存在。');
      }
      return {
        scope: { type: 'job', id: job.id, name: job.originalFilename },
        jobs: [{
          job_id: job.id,
          original_filename: job.originalFilename,
          position: 0,
          result_path: resultPath
        }]
      };
    }
    const batch = await batchRepository.getBatchDetailForOwner(scopeId, owner);
    if (!batch) return null;
    const completed = (batch.items || [])
      .filter((item) => item.job.status === 'completed')
      .sort((a, b) => a.position - b.position);
    if (!completed.length) {
      throw new ValidationError('批量任务没有已完成文件，无法导出。');
    }
    if (completed.some((item) => item.job.ownerUsername !== owner)) {
      throw new ValidationError('批量任务包含无效的归属文件。');
    }
    const jobs = [];
    for (const item of completed) {
      const resultPath = jobFilePath(root, item.job);
      if (!resultPath || !fs.existsSync(resultPath)) {
        throw new ValidationError(`结果文件不存在：${item.originalFilename}`);
      }
      jobs.push({
        job_id: item.job.id,
        original_filename: item.originalFilename,
        position: item.position,
        result_path: resultPath
      });
    }
    return {
      scope: { type: 'batch', id: batch.id, name: batch.name },
      jobs
    };
  }

  function requestFor(scopeData, spec, paging) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      scope: scopeData.scope,
      jobs: scopeData.jobs,
      filters: spec.filters,
      columns: spec.columns,
      row_selection_mode: spec.rowSelectionMode,
      excluded_rows: spec.excludedRows,
      included_rows: spec.includedRows,
      page: paging.page,
      page_size: paging.pageSize
    };
  }

  router.get('/meta', requireAuth, (_req, res) => {
    res.json({
      schema_version: 1,
      columnGroups: COLUMN_GROUPS,
      columns: COLUMN_DEFINITIONS,
      defaultColumnOrder: DEFAULT_COLUMN_ORDER,
      rowSelectionModes: ['all_except', 'only_selected'],
      previewPageSizes: PREVIEW_PAGE_SIZES,
      maxExplicitRows: MAX_EXPLICIT_ROWS
    });
  });

  router.post('/preview', requireAuth, async (req, res, next) => {
    try {
      const spec = normalizeSpec(req.body);
      const paging = cleanPaging(req.body);
      const scopeData = await buildScope(spec.scopeType, spec.scopeId, ownerUsername(req));
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const request = requestFor(scopeData, spec, paging);
      const result = await exportRunner.preview(request);
      if (!result.ok) return res.status(422).json({ error: result.error || '导出预览失败。' });
      return res.json({
        ...result.payload,
        scope: scopeData.scope,
        completedFiles: scopeData.jobs.length,
        columns: result.payload.columns || result.payload.selected_columns,
        columnStats: result.payload.column_stats,
        page: paging.page,
        pageSize: paging.pageSize
      });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/export', requireAuth, async (req, res, next) => {
    if (active >= limit) {
      return res.status(429).json({ error: '已有标准序时账正在导出，请稍后再试。' });
    }
    active += 1;
    let generated = null;
    try {
      const spec = normalizeSpec(req.body);
      const paging = cleanPaging(req.body);
      const scopeData = await buildScope(spec.scopeType, spec.scopeId, ownerUsername(req));
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const request = requestFor(scopeData, spec, paging);
      generated = await exportRunner.generate(request);
      if (!generated.ok) {
        return res.status(422).json({ error: generated.error || '导出失败。' });
      }
      const expected = Number(req.body.expectedCandidateLineCount);
      if (
        Number.isInteger(expected)
        && expected >= 0
        && expected !== generated.payload.candidate_line_count
      ) {
        return res.status(409).json({ error: '筛选结果已变化，请重新预览后再导出。' });
      }
      if (!generated.payload.included_line_count) {
        return res.status(422).json({ error: '最终保留行为 0，无法导出。' });
      }
      const scope = scopeData.scope.name || '序时账';
      const base = path.basename(String(scope), path.extname(String(scope))) || '序时账';
      res.set('Cache-Control', 'private, no-store');
      return res.download(
        generated.file,
        `${base.slice(0, 120)}-标准序时账.xlsx`,
        () => {
          try { fs.rmSync(generated.dir, { recursive: true, force: true }); } catch (_) {}
        }
      );
    } catch (error) {
      if (generated?.dir) {
        try { fs.rmSync(generated.dir, { recursive: true, force: true }); } catch (_) {}
      }
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    } finally {
      active -= 1;
    }
  });

  router.post('/report', requireAuth, async (req, res, next) => {
    if (active >= limit) {
      return res.status(429).json({ error: '已有报告正在导出，请稍后再试。' });
    }
    active += 1;
    let generated = null;
    try {
      const spec = normalizeSpec(req.body);
      if (spec.scopeType !== 'job') {
        return res.status(422).json({ error: '完整分析报告只支持单个任务。' });
      }
      const paging = cleanPaging(req.body);
      const scopeData = await buildScope(spec.scopeType, spec.scopeId, ownerUsername(req));
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const request = requestFor(scopeData, spec, paging);
      generated = await exportRunner.generateReport(request);
      if (!generated.ok) {
        return res.status(422).json({ error: generated.error || '报告导出失败。' });
      }
      const expected = Number(req.body.expectedCandidateLineCount);
      if (
        Number.isInteger(expected)
        && expected >= 0
        && expected !== generated.payload.candidate_line_count
      ) {
        return res.status(409).json({ error: '筛选结果已变化，请重新预览后再导出。' });
      }
      if (!generated.payload.included_line_count) {
        return res.status(422).json({ error: '最终保留行为 0，无法导出。' });
      }
      const scope = scopeData.scope.name || '序时账';
      const base = path.basename(String(scope), path.extname(String(scope))) || '序时账';
      res.set('Cache-Control', 'private, no-store');
      return res.download(
        generated.file,
        `${base.slice(0, 120)}-分析报告.xlsx`,
        () => {
          try { fs.rmSync(generated.dir, { recursive: true, force: true }); } catch (_) {}
        }
      );
    } catch (error) {
      if (generated?.dir) {
        try { fs.rmSync(generated.dir, { recursive: true, force: true }); } catch (_) {}
      }
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    } finally {
      active -= 1;
    }
  });

  return router;
}

module.exports = {
  createStandardExportRouter,
  normalizeSpec,
  cleanPaging,
  ValidationError
};

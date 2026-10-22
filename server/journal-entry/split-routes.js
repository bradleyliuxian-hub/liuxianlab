'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const repository = require('./repository');
const batchRepository = require('./batch-repository');
const splitRepository = require('./split-repository');
const { createSplitRunner } = require('./split-runner');
const { safeRemove } = require('./storage-safety');
const {
  COLUMN_GROUPS, COLUMN_DEFINITIONS, DEFAULT_COLUMN_ORDER, cleanColumns
} = require('./export-columns');

const MAX_GROUPS_MULTI_SHEET = 200;
const MAX_GROUPS_ZIP = 500;
const MAX_ROWS_PER_SHEET = 1048000;
const GROUP_BY = new Set([
  'account', 'customer', 'supplier', 'counterparty',
  'month', 'period', 'entity', 'source_file'
]);
const OUTPUT_MODES = new Set(['multi_sheet', 'zip']);
const ROW_MODES = new Set(['matched_only']);
const FILTER_LISTS = new Set([
  'source_files', 'entities', 'months', 'periods',
  'account_codes', 'account_names', 'account_values',
  'customer_codes', 'customer_names', 'customer_values',
  'supplier_codes', 'supplier_names', 'supplier_values',
  'counterparty_codes', 'counterparty_names', 'counterparty_values'
]);

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

function cleanTextList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} 必须是数组。`);
  if (value.length > 500) throw new ValidationError(`${field} 选项过多。`);
  return value.map((item) => {
    const text = String(item || '').trim();
    if (text.length > 200) throw new ValidationError(`${field} 值过长。`);
    return text;
  }).filter(Boolean);
}

function cleanDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ValidationError(`${field} 日期格式应为 YYYY-MM-DD。`);
  }
  return text;
}

function cleanAmount(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new ValidationError(`${field} 金额格式无效。`);
  }
  return text;
}

function cleanFilters(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('筛选条件格式不正确。');
  }
  const filters = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'months') {
      filters.months = cleanTextList(item, key).map((month) => {
        if (!/^\d{4}-\d{2}$/.test(month)) throw new ValidationError('月份格式应为 YYYY-MM。');
        return month;
      });
    } else if (FILTER_LISTS.has(key)) {
      filters[key] = cleanTextList(item, key);
    } else if (key === 'date_from' || key === 'date_to') {
      filters[key] = cleanDate(item, key);
    } else if (key === 'debit_min' || key === 'debit_max' || key === 'credit_min' || key === 'credit_max') {
      filters[key] = cleanAmount(item, key);
    }
  }
  return filters;
}

function cleanGroupOptions(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('拆分选项格式不正确。');
  }
  const options = {};
  if (value.account_prefix_length !== undefined && value.account_prefix_length !== null && value.account_prefix_length !== '') {
    const prefix = Number(value.account_prefix_length);
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > 20) {
      throw new ValidationError('科目级次必须在 1–20 之间。');
    }
    options.account_prefix_length = prefix;
  }
  return options;
}

function cleanLimits(value, outputMode) {
  const maxGroups = outputMode === 'zip'
    ? MAX_GROUPS_ZIP
    : MAX_GROUPS_MULTI_SHEET;
  const raw = value && typeof value === 'object' ? value : {};
  const limits = { max_groups: maxGroups, max_rows_per_sheet: MAX_ROWS_PER_SHEET };
  if (raw.max_groups !== undefined) {
    const parsed = Number(raw.max_groups);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxGroups) {
      throw new ValidationError(`分组上限必须在 1–${maxGroups} 之间。`);
    }
    limits.max_groups = parsed;
  }
  if (raw.max_rows_per_sheet !== undefined) {
    const parsed = Number(raw.max_rows_per_sheet);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ROWS_PER_SHEET) {
      throw new ValidationError(`单 Sheet 行数上限必须在 1–${MAX_ROWS_PER_SHEET} 之间。`);
    }
    limits.max_rows_per_sheet = parsed;
  }
  return limits;
}

function normalizeDimensions(rawGroupBy) {
  const groupBy = (Array.isArray(rawGroupBy) ? rawGroupBy : [rawGroupBy])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (groupBy.length < 1 || groupBy.length > 3) {
    throw new ValidationError('拆分维度数量必须为 1–3 个。');
  }
  if (new Set(groupBy).size !== groupBy.length) {
    throw new ValidationError('拆分维度不能重复。');
  }
  for (const dimension of groupBy) {
    if (!GROUP_BY.has(dimension)) throw new ValidationError('拆分维度无效。');
  }
  return groupBy;
}

function normalizePresetSpec(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('模板配置格式不正确。');
  }
  const spec = body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec)
    ? body.spec
    : body;
  const outputMode = String(spec.outputMode || spec.output_mode || 'multi_sheet');
  if (!OUTPUT_MODES.has(outputMode)) throw new ValidationError('输出方式无效。');
  const rowMode = String(spec.rowMode || spec.row_mode || 'matched_only');
  if (!ROW_MODES.has(rowMode)) {
    throw new ValidationError('FULL VOUCHER MODE NOT IMPLEMENTED');
  }
  let columns = null;
  try {
    columns = cleanColumns(
      spec.columns !== undefined ? spec.columns
        : (spec.columnOrder !== undefined ? spec.columnOrder : spec.column_order)
    );
  } catch (error) {
    throw new ValidationError(error.message);
  }
  return {
    filters: cleanFilters(spec.filters),
    groupBy: normalizeDimensions(spec.groupBy !== undefined ? spec.groupBy : spec.group_by),
    groupOptions: cleanGroupOptions(spec.groupOptions || spec.group_options),
    rowMode,
    outputMode,
    columns
  };
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
  const groupBy = normalizeDimensions(body.groupBy !== undefined ? body.groupBy : body.group_by);

  const outputMode = String(body.outputMode || body.output_mode || 'multi_sheet');
  if (!OUTPUT_MODES.has(outputMode)) throw new ValidationError('输出方式无效。');
  const rowMode = String(body.rowMode || body.row_mode || 'matched_only');
  if (!ROW_MODES.has(rowMode)) {
    throw new ValidationError('FULL VOUCHER MODE NOT IMPLEMENTED');
  }
  let columns = null;
  try {
    columns = cleanColumns(
      body.columns !== undefined ? body.columns
        : (body.columnOrder !== undefined ? body.columnOrder : body.column_order)
    );
  } catch (error) {
    throw new ValidationError(error.message);
  }
  return {
    scopeType,
    scopeId,
    groupBy,
    outputMode,
    rowMode,
    filters: cleanFilters(body.filters),
    groupOptions: cleanGroupOptions(body.groupOptions || body.group_options),
    limits: cleanLimits(body.limits, outputMode),
    columns
  };
}

function createSplitRouter({ root, requireAuth, runner, repository: splitRepo = splitRepository }) {
  const router = express.Router();
  const storageRoot = path.join(root, 'storage', 'journal-entry-splits');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const splitRunner = runner || createSplitRunner({ root, storageRoot });
  let activeGenerations = 0;
  const generationLimit = Math.max(
    1,
    Number(process.env.JOURNAL_ENTRY_SPLIT_EXPORT_CONCURRENCY || 1)
  );

  function publicOutput(output) {
    if (!output) return null;
    return {
      id: output.id,
      scopeType: output.scopeType,
      scopeId: output.scopeId,
      status: output.status,
      outputMode: output.outputMode,
      snapshot: output.snapshot || null,
      createdAt: output.createdAt,
      completedAt: output.completedAt,
      error: output.error || null,
      expired: Boolean(output.expiredAt),
      download: output.status === 'completed' && !output.expiredAt
        ? `/api/journal-entry-splits/${encodeURIComponent(output.id)}/download`
        : null
    };
  }

  async function buildScope(scopeType, scopeId, owner) {
    if (scopeType === 'job') {
      const job = await repository.getJobForOwner(scopeId, owner);
      if (!job) return null;
      if (job.status !== 'completed') {
        throw new ValidationError('该任务尚未完成，无法筛选拆分。');
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
          result_path: resultPath,
          amount_layout: job.amountLayout || null,
          positive_side: job.positiveSide || null
        }],
        excluded: { draft: 0, active: 0, failed: 0 },
        completedFiles: 1
      };
    }
    const batch = await batchRepository.getBatchDetailForOwner(scopeId, owner);
    if (!batch) return null;
    const completed = (batch.items || [])
      .filter((item) => item.job.status === 'completed')
      .sort((a, b) => a.position - b.position);
    if (!completed.length) {
      throw new ValidationError('批量任务没有已完成文件，无法筛选拆分。');
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
        result_path: resultPath,
        amount_layout: item.job.amountLayout || null,
        positive_side: item.job.positiveSide || null
      });
    }
    const excluded = { draft: 0, active: 0, failed: 0 };
    for (const item of batch.items || []) {
      if (item.job.status === 'draft') excluded.draft += 1;
      else if (item.job.status === 'queued' || item.job.status === 'running') excluded.active += 1;
      else if (item.job.status === 'failed') excluded.failed += 1;
    }
    return {
      scope: { type: 'batch', id: batch.id, name: batch.name },
      jobs,
      excluded,
      completedFiles: completed.length,
      totalFiles: batch.totalCount
    };
  }

  function requestFor(scopeData, spec) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      scope: scopeData.scope,
      jobs: scopeData.jobs,
      filters: spec.filters,
      group_by: spec.groupBy,
      group_options: spec.groupOptions,
      row_mode: spec.rowMode,
      output_mode: spec.outputMode,
      limits: spec.limits,
      columns: spec.columns
    };
  }

  async function scopeExists(scopeType, scopeId, owner) {
    if (scopeType === 'job') {
      return Boolean(await repository.getJobForOwner(scopeId, owner));
    }
    return Boolean(await batchRepository.getBatchSummaryForOwner(scopeId, owner));
  }

  router.get('/meta', requireAuth, (_req, res) => {
    res.json({
      schema_version: 1,
      groupBy: Array.from(GROUP_BY),
      outputModes: Array.from(OUTPUT_MODES),
      rowModes: ['matched_only'],
      fullVoucherMode: false,
      columnGroups: COLUMN_GROUPS,
      columns: COLUMN_DEFINITIONS,
      defaultColumnOrder: DEFAULT_COLUMN_ORDER,
      retentionHours: Math.max(1, Number(process.env.JOURNAL_ENTRY_OUTPUT_RETENTION_HOURS || process.env.JOURNAL_ENTRY_RETENTION_HOURS || 72)),
      limits: {
        maxGroupsMultiSheet: MAX_GROUPS_MULTI_SHEET,
        maxGroupsZip: MAX_GROUPS_ZIP,
        maxRowsPerSheet: MAX_ROWS_PER_SHEET
      },
      builtinPresets: [
        { id: 'builtin-account', name: '按科目拆分', spec: { filters: {}, groupBy: ['account'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'multi_sheet' } },
        { id: 'builtin-month', name: '按月份拆分', spec: { filters: {}, groupBy: ['month'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'multi_sheet' } },
        { id: 'builtin-customer', name: '按客户拆分', spec: { filters: {}, groupBy: ['customer'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'multi_sheet' } },
        { id: 'builtin-supplier', name: '按供应商拆分', spec: { filters: {}, groupBy: ['supplier'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'multi_sheet' } },
        { id: 'builtin-account-month', name: '科目 + 月份', spec: { filters: {}, groupBy: ['account', 'month'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'multi_sheet' } },
        { id: 'builtin-customer-month', name: '客户 + 月份', spec: { filters: {}, groupBy: ['customer', 'month'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'zip' } },
        { id: 'builtin-supplier-month', name: '供应商 + 月份', spec: { filters: {}, groupBy: ['supplier', 'month'], groupOptions: {}, rowMode: 'matched_only', outputMode: 'zip' } }
      ]
    });
  });

  router.get('/dimensions', requireAuth, async (req, res, next) => {
    try {
      const scopeType = String(req.query.scopeType || '');
      const scopeId = String(req.query.scopeId || '');
      const dimension = String(req.query.dimension || '');
      if (!['job', 'batch'].includes(scopeType) || !validId(scopeId)) {
        return res.status(400).json({ error: '数据范围无效。' });
      }
      if (!GROUP_BY.has(dimension)) {
        return res.status(400).json({ error: '维度无效。' });
      }
      const scopeData = await buildScope(scopeType, scopeId, ownerUsername(req));
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const q = String(req.query.q || '').slice(0, 100);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const result = await splitRunner.dimensions({
        dimension, q, limit, jobs: scopeData.jobs
      });
      if (!result.ok) return res.status(500).json({ error: result.error || '维度查询失败。' });
      return res.json({ ...result.payload, scope: scopeData.scope });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/preview', requireAuth, async (req, res, next) => {
    try {
      const spec = normalizeSpec(req.body);
      const scopeData = await buildScope(spec.scopeType, spec.scopeId, ownerUsername(req));
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const request = requestFor(scopeData, spec);
      const result = await splitRunner.preview(request);
      if (!result.ok) return res.status(422).json({ error: result.error || '拆分预览失败。' });
      return res.json({
        ...result.payload,
        scope: scopeData.scope,
        excluded: scopeData.excluded,
        completedFiles: scopeData.completedFiles,
        totalFiles: scopeData.totalFiles || scopeData.completedFiles,
        filters: spec.filters,
        groupBy: spec.groupBy,
        dimensions: result.payload.dimensions || spec.groupBy,
        groupOptions: spec.groupOptions,
        outputMode: spec.outputMode,
        rowMode: spec.rowMode,
        columns: result.payload.selected_columns,
        columnStats: result.payload.column_stats,
        column_order: result.payload.column_order
      });
    } catch (error) {
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    }
  });

  router.post('/', requireAuth, async (req, res, next) => {
    let outputId = null;
    let outputDir = null;
    let backgroundStarted = false;
    try {
      const spec = normalizeSpec(req.body);
      const owner = ownerUsername(req);
      const presetId = req.body.presetId ? String(req.body.presetId).slice(0, 100) : null;
      const presetName = req.body.presetName ? String(req.body.presetName).slice(0, 100) : null;
      const scopeData = await buildScope(spec.scopeType, spec.scopeId, owner);
      if (!scopeData) return res.status(404).json({ error: '数据范围不存在。' });
      const expected = Array.isArray(req.body.expectedIncludedJobIds)
        ? req.body.expectedIncludedJobIds.map(String).sort()
        : null;
      const current = scopeData.jobs.map((job) => job.job_id).sort();
      if (expected && JSON.stringify(expected) !== JSON.stringify(current)) {
        return res.status(409).json({ error: '已完成文件已变化，请重新预览。' });
      }
      const request = requestFor(scopeData, spec);
      const preview = await splitRunner.preview(request);
      if (!preview.ok) return res.status(422).json({ error: preview.error || '拆分预览失败。' });
      if (!preview.payload.matched_lines) {
        return res.status(422).json({ error: '筛选结果为 0 行，无法生成。' });
      }
      if (preview.payload.limit_exceeded) {
        return res.status(422).json({
          error: `预计生成 ${preview.payload.group_count} 个分组，超过当前输出上限 ${preview.payload.limits.max_groups}。`,
          preview: preview.payload
        });
      }
      if (activeGenerations >= generationLimit) {
        return res.status(429).json({ error: '已有拆分导出正在生成，请稍后再试。' });
      }
      activeGenerations += 1;
        outputId = crypto.randomUUID();
        outputDir = path.join(storageRoot, outputId);
        fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
        const snapshot = {
          schema_version: 1,
          scope: scopeData.scope,
          generated_at: request.generated_at,
          filters: spec.filters,
          group_by: spec.groupBy,
          group_options: spec.groupOptions,
          output_mode: spec.outputMode,
          row_mode: spec.rowMode,
          selected_columns: preview.payload.selected_columns,
          column_order: preview.payload.column_order,
          matched_lines: preview.payload.matched_lines,
          matched_vouchers: preview.payload.matched_vouchers,
          group_count: preview.payload.group_count,
          included_job_ids: current,
          excluded: scopeData.excluded,
          limits: spec.limits,
          preset_id: presetId,
          preset_name_at_generation: presetName
        };
        const storageRequest = {
          ...snapshot,
          completed_files: scopeData.completedFiles
        };
        await splitRepo.createOutput({
          id: outputId,
          ownerUsername: owner,
          scopeType: spec.scopeType,
          scopeId: spec.scopeId,
          request: storageRequest,
          snapshot,
          outputMode: spec.outputMode
        });
        backgroundStarted = true;
        setImmediate(() => {
          (async () => {
            try {
              const result = await splitRunner.generate(request, outputDir);
              if (!result.ok) {
                await splitRepo.markFailed(outputId, result.error || '生成失败');
                safeRemove(path.join(root, 'storage', 'journal-entry-splits'), outputDir);
                return;
              }
              const outputFile = path.join(outputDir, result.payload.output_file);
              if (!fs.existsSync(outputFile)) {
                await splitRepo.markFailed(outputId, '输出文件缺失。');
                safeRemove(path.join(root, 'storage', 'journal-entry-splits'), outputDir);
                return;
              }
              const filePath = path.relative(root, outputFile).split(path.sep).join('/');
              const completedSnapshot = {
                ...snapshot,
                output_file: result.payload.output_file,
                group_count: result.payload.group_count,
                matched_lines: result.payload.matched_lines,
                matched_vouchers: result.payload.matched_vouchers
              };
              await splitRepo.markCompleted(outputId, {
                filePath,
                snapshot: completedSnapshot
              });
            } catch (_) {
              try { await splitRepo.markFailed(outputId, '拆分导出生成失败。'); } catch (__) {}
              safeRemove(path.join(root, 'storage', 'journal-entry-splits'), outputDir);
            } finally {
              activeGenerations -= 1;
            }
          })();
        });
        const pendingOutput = await splitRepo.getForOwner(outputId, owner);
        return res.status(202).json({ output: publicOutput(pendingOutput) });
    } catch (error) {
      if (!backgroundStarted) activeGenerations -= 1;
      if (outputId) {
        try { await splitRepo.markFailed(outputId, '拆分导出生成失败。'); } catch (_) {}
      }
      if (error instanceof ValidationError) return res.status(422).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/latest', requireAuth, async (req, res, next) => {
    try {
      const scopeType = String(req.query.scopeType || '');
      const scopeId = String(req.query.scopeId || '');
      if (!['job', 'batch'].includes(scopeType) || !validId(scopeId)) {
        return res.status(400).json({ error: '数据范围无效。' });
      }
      const owner = ownerUsername(req);
      if (!(await scopeExists(scopeType, scopeId, owner))) {
        return res.status(404).json({ error: '数据范围不存在。' });
      }
      const output = await splitRepo.getLatestForScope(owner, scopeType, scopeId);
      return res.json({ output: publicOutput(output) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ error: '导出文件不存在。' });
      const output = await splitRepo.getForOwner(req.params.id, ownerUsername(req));
      if (!output) return res.status(404).json({ error: '导出文件不存在。' });
      if (output.status === 'generating') {
        return res.status(409).json({ error: '拆分导出正在生成，暂时不能删除。' });
      }
      safeRemove(
        path.join(root, 'storage', 'journal-entry-splits'),
        path.join(root, 'storage', 'journal-entry-splits', output.id)
      );
      const expired = await splitRepo.expireOutput(output.id);
      return res.json({ ok: true, output: publicOutput(expired) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/download', requireAuth, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ error: '导出文件不存在。' });
      const output = await splitRepo.getForOwner(req.params.id, ownerUsername(req));
      if (!output || output.status !== 'completed') {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      if (output.expiredAt) {
        return res.status(410).json({ error: '导出文件已过期，请重新生成。' });
      }
      if (!(await scopeExists(output.scopeType, output.scopeId, ownerUsername(req)))) {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      const absolute = path.resolve(root, output.filePath || '');
      const base = path.resolve(storageRoot);
      if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) {
        return res.status(404).json({ error: '导出文件不存在。' });
      }
      if (!fs.existsSync(absolute)) {
        return res.status(404).json({ error: '导出文件不存在或已过期。' });
      }
      const name = output.outputMode === 'zip' ? 'split-export.zip' : 'split-export.xlsx';
      res.set('Cache-Control', 'private, no-store');
      return res.download(absolute, name);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createSplitRouter,
  normalizeSpec,
  normalizePresetSpec,
  ValidationError,
  cleanFilters,
  MAX_GROUPS_MULTI_SHEET,
  MAX_GROUPS_ZIP,
  MAX_ROWS_PER_SHEET
};

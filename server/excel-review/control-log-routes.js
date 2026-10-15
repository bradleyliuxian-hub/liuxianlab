'use strict';

/*
 * Excel Review Assistant V1.4 - Control Log HTTP routes.
 *
 *   POST   /api/excel-review-control-logs            create from jobIds
 *   GET    /api/excel-review-control-logs            history (current owner)
 *   GET    /api/excel-review-control-logs/:id        status + statistics
 *   GET    /api/excel-review-control-logs/:id/file   download control_log.xlsx
 *   DELETE /api/excel-review-control-logs/:id        delete Control Log only
 *
 * Both entry points (batch upload -> jobs, history selection -> jobs) end
 * up POSTing the same jobIds here, so there is exactly one Control Log
 * generation path. Owner scope is enforced per job and on the record.
 * Auth + same-origin are enforced by the parent app.use() in server.js.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const controlRepository = require('./control-log-repository');
const jobRepository = require('./repository');
const { repairMojibake } = require('./encoding');
const { createControlLogRunner } = require('./control-log-runner');

const MAX_JOBS = 50;

function validId(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function defaultName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Control Log - ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function publicControlLog(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    fileCount: record.fileCount,
    questionCount: record.questionCount,
    threadedCount: record.threadedCount,
    legacyCount: record.legacyCount,
    authorCount: record.authorCount,
    hasFile: Boolean(record.controlLogPath),
    error: record.status === 'failed' ? (record.error || '生成失败。') : undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function createExcelReviewControlLogRouter(options = {}) {
  const router = express.Router();
  const root = options.root || path.resolve(__dirname, '..', '..');
  const storageRoot = path.join(root, 'storage', 'excel-review-control-logs');
  const jobsStorageRoot = path.join(root, 'storage', 'excel-reviews');
  fs.mkdirSync(storageRoot, { recursive: true });

  const runner = createControlLogRunner({ root });

  function controlDir(id) {
    return path.join(storageRoot, String(id));
  }

  function relativePath(absolutePath) {
    return path.relative(root, absolutePath).split(path.sep).join('/');
  }

  function readExtracted(jobId) {
    try {
      const file = path.join(jobsStorageRoot, String(jobId), 'extracted.json');
      if (!fs.existsSync(file)) return null;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function downloadBase(name) {
    const base = path
      .basename(String(name || 'control-log'))
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    return base.slice(0, 120) || 'control-log';
  }

  router.post('/', async (req, res) => {
    const owner = ownerUsername(req);
    if (!owner) return res.status(401).json({ ok: false, message: '请先登录。' });

    let controlLogId = null;
    try {
      const raw = Array.isArray(req.body?.jobIds) ? req.body.jobIds : [];
      const jobIds = [...new Set(raw.map((value) => String(value)))].filter(Boolean);
      if (jobIds.length === 0) {
        return res.status(400).json({ ok: false, message: '请至少选择一个任务。' });
      }
      if (jobIds.length > MAX_JOBS) {
        return res.status(400).json({ ok: false, message: `一次最多汇总 ${MAX_JOBS} 个任务。` });
      }
      for (const id of jobIds) {
        if (!validId(id)) return res.status(400).json({ ok: false, message: '无效的任务编号。' });
      }

      // Owner scope + completion + artifacts, per job.
      const jobs = [];
      for (const id of jobIds) {
        const job = await jobRepository.getJobForOwner(id, owner);
        if (!job) {
          return res.status(403).json({ ok: false, message: '包含无权访问或不存在的任务。' });
        }
        if (job.status !== 'review_ready' && job.status !== 'completed') {
          return res.status(409).json({ ok: false, message: `任务「${job.originalFilename}」尚未完成或已失败。` });
        }
        const extracted = readExtracted(id);
        if (!extracted || !Array.isArray(extracted.items)) {
          return res.status(409).json({ ok: false, message: `任务「${job.originalFilename}」缺少解析数据，请重新上传。` });
        }
        jobs.push({ job, extracted });
      }

      const name = String(req.body?.name || '').trim().slice(0, 160) || defaultName();
      controlLogId = crypto.randomUUID();
      const dir = controlDir(controlLogId);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

      const input = {
        controlLogId,
        name,
        createdAt: new Date().toISOString(),
        jobs: jobs.map(({ job, extracted }) => ({
          jobId: job.id,
          sourceFile: job.originalFilename,
          sourceFilename: extracted.sourceFilename || job.originalFilename,
          sourceSha256: extracted.sourceSha256 || job.sourceSha256 || '',
          createdAt: job.createdAt
        })),
        itemsByJob: jobs.reduce((acc, { job, extracted }) => {
          acc[job.id] = extracted.items;
          return acc;
        }, {})
      };
      fs.writeFileSync(path.join(dir, 'input.json'), `${JSON.stringify(input)}\n`, { mode: 0o600 });

      await controlRepository.createControlLog({
        id: controlLogId,
        ownerUsername: owner,
        name,
        jobIds: jobs.map(({ job }) => job.id),
        status: 'processing'
      });

      const result = await runner.run(dir);
      if (!result.ok) {
        await controlRepository.updateControlLogState(controlLogId, {
          status: 'failed',
          error: String(result.error || '生成失败').slice(0, 500)
        });
        fs.rmSync(dir, { recursive: true, force: true });
        return res.status(500).json({ ok: false, message: '生成 Control Log 失败，请重试。' });
      }

      const counts = (result.status && result.status.result) || {};
      const updated = await controlRepository.updateControlLogState(controlLogId, {
        status: 'review_ready',
        fileCount: Number(counts.fileCount || jobs.length),
        questionCount: Number(counts.questionCount || 0),
        threadedCount: Number(counts.threadedCount || 0),
        legacyCount: Number(counts.legacyCount || 0),
        authorCount: Number(counts.authorCount || 0),
        snapshotPath: relativePath(path.join(dir, 'control_log.json')),
        controlLogPath: relativePath(path.join(dir, 'control_log.xlsx')),
        error: null
      });
      try { fs.rmSync(path.join(dir, 'input.json'), { force: true }); } catch (_) {}

      console.log('[excel-review control-log] created', controlLogId, name, `${jobs.length} files`);
      return res.status(201).json({ ok: true, controlLog: publicControlLog(updated) });
    } catch (error) {
      console.error('[excel-review control-log create]', error);
      if (controlLogId) {
        try {
          await controlRepository.updateControlLogState(controlLogId, {
            status: 'failed',
            error: String(error.message || error).slice(0, 500)
          });
        } catch (_) {}
        fs.rmSync(controlDir(controlLogId), { recursive: true, force: true });
      }
      return res.status(500).json({ ok: false, message: '无法创建 Control Log。' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const records = await controlRepository.listControlLogsForOwner(ownerUsername(req));
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, controlLogs: records.map(publicControlLog) });
    } catch (error) {
      console.error('[excel-review control-log history]', error);
      return res.status(500).json({ ok: false, message: '无法读取 Control Log 记录。' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      if (!validId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的 Control Log 编号。' });
      }
      const record = await controlRepository.getControlLogForOwner(req.params.id, ownerUsername(req));
      if (!record) return res.status(404).json({ ok: false, message: 'Control Log 不存在。' });
      const payload = publicControlLog(record);
      try {
        const snapshotFile = controlDir(record.id) && path.join(controlDir(record.id), 'control_log.json');
        if (fs.existsSync(snapshotFile)) {
          const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
          payload.statistics = snapshot.statistics || null;
          payload.sourceJobs = (snapshot.sourceJobs || []).map((job) => ({
            sourceFile: repairMojibake(job.sourceFile),
            questionCount: job.questionCount,
            threadedCount: job.threadedCount,
            legacyCount: job.legacyCount
          }));
        }
      } catch (_) {}
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, controlLog: payload });
    } catch (error) {
      console.error('[excel-review control-log status]', error);
      return res.status(500).json({ ok: false, message: '无法读取 Control Log。' });
    }
  });

  router.get('/:id/file', async (req, res) => {
    try {
      if (!validId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的 Control Log 编号。' });
      }
      const record = await controlRepository.getControlLogForOwner(req.params.id, ownerUsername(req));
      if (!record) return res.status(404).json({ ok: false, message: 'Control Log 不存在。' });
      if (record.status !== 'review_ready') {
        return res.status(409).json({ ok: false, message: 'Control Log 尚未生成完成。' });
      }
      const file = path.join(controlDir(record.id), 'control_log.xlsx');
      if (!fs.existsSync(file)) {
        return res.status(404).json({ ok: false, message: 'Control Log 文件不存在。' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.download(file, `${downloadBase(record.name)}.xlsx`);
    } catch (error) {
      console.error('[excel-review control-log file]', error);
      return res.status(500).json({ ok: false, message: '无法下载 Control Log。' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!validId(req.params.id)) {
        return res.status(400).json({ ok: false, message: '无效的 Control Log 编号。' });
      }
      const owner = ownerUsername(req);
      const record = await controlRepository.getControlLogForOwner(req.params.id, owner);
      if (!record) return res.status(404).json({ ok: false, message: 'Control Log 不存在。' });

      // Delete only the Control Log (record + relations + files).
      // Source excel_review_jobs and their files are never touched.
      await controlRepository.deleteControlLogForOwner(record.id, owner);
      fs.rmSync(controlDir(record.id), { recursive: true, force: true });
      return res.json({ ok: true, id: record.id });
    } catch (error) {
      console.error('[excel-review control-log delete]', error);
      return res.status(500).json({ ok: false, message: '删除 Control Log 失败。' });
    }
  });

  return router;
}

module.exports = { createExcelReviewControlLogRouter };

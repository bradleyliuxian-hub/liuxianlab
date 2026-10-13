'use strict';

/*
 * Excel Review Assistant - in-process job runner.
 *
 * Node owns the PostgreSQL row and the small run queue; the Python
 * worker stays DB-free and reports progress via an atomic
 * status.json inside the job directory. This keeps the Excel worker
 * fully independent from the MinerU contract worker.
 *
 * One job = one extraction -> review.xlsx. There is no reply/write-back
 * phase. Concurrency defaults to 1: the production host is a small CPU
 * box also running MinerU.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_POLL_MS = 500;
const STARTING_MESSAGE = '正在扫描工作簿…';

function createExcelReviewRunner({ root, repository, storageRoot, maxConcurrent = 1 }) {
  const queue = [];
  const active = new Set();
  const limit = Math.max(1, Number(maxConcurrent) || 1);

  function jobDir(jobId) {
    return path.join(storageRoot, String(jobId));
  }

  function statusPath(jobId) {
    return path.join(jobDir(jobId), 'status.json');
  }

  function readStatus(jobId) {
    const file = statusPath(jobId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function resolvePythonBin() {
    const explicit = process.env.EXCEL_REVIEW_PYTHON_BIN || process.env.PYTHON_BIN;
    if (explicit) {
      if (explicit.startsWith('./') || explicit.startsWith('../')) {
        return path.resolve(root, explicit);
      }
      return explicit;
    }
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  function enqueue(jobId) {
    const id = String(jobId || '');
    if (!id) return;
    if (queue.includes(id) || active.has(id)) return;
    queue.push(id);
    runNext();
  }

  function runNext() {
    while (active.size < limit && queue.length > 0) {
      const jobId = queue.shift();
      if (active.has(jobId)) continue;
      active.add(jobId);
      runJob(jobId).finally(() => {
        active.delete(jobId);
        setImmediate(runNext);
      });
    }
  }

  function runJob(jobId) {
    return new Promise((resolve) => {
      const dir = jobDir(jobId);
      if (!fs.existsSync(dir)) {
        repository
          .updateJobState(jobId, { status: 'failed', progress: 100, error: '任务目录不存在。' })
          .catch(() => {});
        return resolve();
      }

      repository
        .claimJob(jobId, { message: STARTING_MESSAGE })
        .then((claimed) => {
          if (!claimed) return resolve();
          return spawnWorker(jobId, dir);
        })
        .catch((error) => {
          console.error('[excel-review claim]', error);
        })
        .then(() => resolve());
    });
  }

  function spawnWorker(jobId, dir) {
    return new Promise((resolve) => {
      const logFd = fs.openSync(path.join(dir, 'worker.log'), 'a', 0o600);
      const pythonBin = resolvePythonBin();
      const args = [
        '-m',
        'services.excel_review.worker',
        '--job-dir', dir
      ];

      let child;
      try {
        child = spawn(pythonBin, args, {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (error) {
        try { fs.closeSync(logFd); } catch (_) {}
        repository
          .updateJobState(jobId, { status: 'failed', progress: 100, error: '无法启动处理程序。' })
          .catch(() => {});
        return resolve();
      }

      let lastSerialized = '';
      const timer = setInterval(() => {
        const status = readStatus(jobId);
        if (!status) return;
        const serialized = JSON.stringify(status);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        syncProgress(jobId, status);
      }, STATUS_POLL_MS);

      child.on('error', (error) => {
        console.error('[excel-review spawn]', error);
      });

      child.on('close', (code, signal) => {
        clearInterval(timer);
        try { fs.closeSync(logFd); } catch (_) {}

        const status = readStatus(jobId);
        if (code === 0 && status && status.status && status.status !== 'failed') {
          finalizeSuccess(jobId, status).finally(resolve);
          return;
        }

        const reason = (status && status.error)
          || `处理程序异常退出 (code=${code}, signal=${signal || 'none'})`;
        finalizeFailure(jobId, reason).finally(resolve);
      });
    });
  }

  function syncProgress(jobId, status) {
    const patch = {};
    if (status.status) patch.status = status.status;
    if (status.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
    if (status.message !== undefined) patch.progressMessage = status.message;
    repository.updateJobState(jobId, patch).catch((error) => {
      console.error('[excel-review progress]', error);
    });
  }

  function finalizeSuccess(jobId, status) {
    const result = status.result || {};
    const patch = {
      status: status.status && status.status !== 'processing' ? status.status : 'review_ready',
      progress: 100,
      progressMessage: status.message || null,
      reviewPath: relativePath(path.join(jobDir(jobId), 'review.xlsx')),
      error: null
    };
    if (result.itemCount !== undefined || status.itemCount !== undefined) {
      patch.itemCount = result.itemCount !== undefined ? result.itemCount : status.itemCount;
    }
    if (result.sourceSha256) patch.sourceSha256 = result.sourceSha256;
    if (result.mappingVersion) patch.mappingVersion = result.mappingVersion;
    if (result.reviewToken) patch.reviewToken = result.reviewToken;
    return repository.updateJobState(jobId, patch).catch((error) => {
      console.error('[excel-review finalize]', error);
    });
  }

  function finalizeFailure(jobId, reason) {
    return repository
      .updateJobState(jobId, {
        status: 'failed',
        progress: 100,
        progressMessage: '处理失败。',
        error: String(reason || '处理失败').slice(0, 500)
      })
      .catch((error) => {
        console.error('[excel-review failure]', error);
      });
  }

  function relativePath(absolutePath) {
    return path
      .relative(root, absolutePath)
      .split(path.sep)
      .join('/');
  }

  /*
   * On server start, requeue jobs that were left queued, and fail
   * jobs that were mid-flight when the process stopped.
   */
  async function recover() {
    try {
      const interrupted = await repository.listJobsByStatus(['processing', 'applying_replies'], 100);
      for (const job of interrupted) {
        await repository.updateJobState(job.id, {
          status: 'failed',
          progress: 100,
          error: '服务器重启，本次任务已中断，请重新上传。'
        });
      }
      const queued = await repository.listJobsByStatus(['queued'], 100);
      for (const job of queued) {
        enqueue(job.id);
      }
    } catch (error) {
      console.error('[excel-review recover]', error);
    }
  }

  return {
    enqueue,
    recover,
    jobDir,
    resolvePythonBin
  };
}

module.exports = { createExcelReviewRunner };

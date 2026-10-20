'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_POLL_MS = 500;
const STARTING_MESSAGE = '正在启动 FIFO 对抵…';

function createReconciliationRunner({ root, repository, storageRoot, maxConcurrent = 1 }) {
  const queue = [];
  const active = new Set();
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  const timeoutMs = Math.max(
    60000,
    Number(process.env.PURCHASE_RECONCILIATION_TIMEOUT_MS || 20 * 60 * 1000)
  );
  const retentionHours = Math.max(
    1,
    Number(process.env.PURCHASE_RECONCILIATION_RETENTION_HOURS || 72)
  );

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
    const explicit = process.env.PURCHASE_RECONCILIATION_PYTHON_BIN || process.env.PYTHON_BIN;
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
    if (!id || queue.includes(id) || active.has(id)) return;
    queue.push(id);
    runNext();
  }

  function runNext() {
    while (active.size < limit && queue.length) {
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
        repository.updateJobState(jobId, {
          status: 'failed', progress: 100, error: '任务目录不存在。'
        }).catch(() => {});
        return resolve();
      }
      repository.claimJob(jobId, { message: STARTING_MESSAGE }).then((claimed) => {
        if (!claimed) return resolve();
        return spawnWorker(jobId, dir);
      }).catch((error) => {
        console.error('[purchase-reconciliation claim]', error);
        resolve();
      }).then(() => resolve());
    });
  }

  function spawnWorker(jobId, dir) {
    return new Promise((resolve) => {
      let logFd;
      try {
        logFd = fs.openSync(path.join(dir, 'worker.log'), 'a', 0o600);
      } catch (_) {
        repository.updateJobState(jobId, {
          status: 'failed', progress: 100, error: '无法创建任务日志。'
        }).catch(() => {});
        return resolve();
      }

      let child;
      try {
        child = spawn(resolvePythonBin(), [
          '-m', 'services.purchase_reconciliation.worker', '--job-dir', dir
        ], {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (_) {
        try { fs.closeSync(logFd); } catch (__) {}
        repository.updateJobState(jobId, {
          status: 'failed', progress: 100, error: '无法启动对抵程序。'
        }).catch(() => {});
        return resolve();
      }

      let finalized = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch (_) {}
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
        }, 5000).unref?.();
        if (finalized) {
          repository.updateJobState(jobId, {
            xlsxStatus: 'error',
            error: 'XLSX 生成超时，CSV 结果仍可下载。'
          }).catch(() => {});
          return resolve();
        }
        finalizeFailure(jobId, '对抵超时，任务已终止。').finally(resolve);
      }, timeoutMs);

      let lastSerialized = '';
      const poll = setInterval(async () => {
        const status = readStatus(jobId);
        if (!status) return;
        const serialized = JSON.stringify(status);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        if (finalized) {
          // The XLSX may still be generating after the analysis is complete.
          if (status.xlsx) {
            const done = status.xlsx !== 'generating';
            const patch = { xlsxStatus: status.xlsx };
            if (done) patch.progress = 100;
            if (status.message !== undefined) patch.progressMessage = status.message;
            repository.updateJobState(jobId, patch).catch(() => {});
          }
          return;
        }
        const patch = {};
        if (status.status) patch.status = status.status;
        if (status.progress !== undefined) {
          patch.progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
        }
        if (status.message !== undefined) patch.progressMessage = status.message;
        if (status.xlsx !== undefined) patch.xlsxStatus = status.xlsx;
        repository.updateJobState(jobId, patch).catch(() => {});

        if (status.status === 'completed') {
          const ok = await finalizeSuccess(jobId, status);
          if (ok) finalized = true;
        }
      }, STATUS_POLL_MS);

      child.on('error', (error) => {
        console.error('[purchase-reconciliation spawn]', error);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        clearInterval(poll);
        try { fs.closeSync(logFd); } catch (_) {}
        if (timedOut) return resolve();
        const status = readStatus(jobId);
        if (!finalized && code === 0 && status && status.status === 'completed') {
          finalizeSuccess(jobId, status).finally(resolve);
          return;
        }
        if (finalized) {
          const xlsxStatus = status?.xlsx && status.xlsx !== 'generating' ? status.xlsx : 'error';
          repository.updateJobState(jobId, {
            xlsxStatus,
            progress: 100
          }).catch(() => {});
          return resolve();
        }
        const reason = (status && status.error)
          || `对抵程序异常退出 (code=${code}, signal=${signal || 'none'})`;
        finalizeFailure(jobId, reason).finally(resolve);
      });
    });
  }

  async function finalizeSuccess(jobId, status) {
    const dir = jobDir(jobId);
    const resultDir = path.join(dir, 'result');
    const required = [
      'summary.json', 'segments.ndjson', 'matched.ndjson', 'remaining.ndjson',
      'reconciliation-result-csv.zip'
    ];
    if (!required.every((name) => fs.existsSync(path.join(resultDir, name)))) {
      return false;
    }
    await repository.updateJobState(jobId, {
      status: 'completed',
      progress: Math.max(90, Number(status.progress) || 0),
      progressMessage: status.message || '对抵完成。',
      resultDir: relativePath(resultDir),
      summaryJson: status.result || null,
      xlsxStatus: status.xlsx || 'generating',
      error: null,
      completedAt: new Date()
    }).catch((error) => {
      console.error('[purchase-reconciliation finalize]', error);
    });
    return true;
  }

  function finalizeFailure(jobId, reason) {
    return repository.updateJobState(jobId, {
      status: 'failed',
      progress: 100,
      progressMessage: '对抵失败。',
      error: String(reason || '对抵失败').slice(0, 500)
    }).catch((error) => {
      console.error('[purchase-reconciliation failure]', error);
    });
  }

  function relativePath(absolutePath) {
    return path.relative(root, absolutePath).split(path.sep).join('/');
  }

  async function recover() {
    try {
      const running = await repository.listJobsByStatus(['running'], 100);
      for (const job of running) {
        await repository.updateJobState(job.id, {
          status: 'failed',
          progress: 100,
          error: '服务器重启，本次对抵已中断，请重新开始。'
        });
      }
      const queued = await repository.listJobsByStatus(['queued'], 100);
      for (const job of queued) enqueue(job.id);
    } catch (error) {
      console.error('[purchase-reconciliation recover]', error);
    }
  }

  async function cleanupExpired() {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    try {
      const jobs = await repository.listExpiredJobs(cutoff, 100);
      for (const job of jobs) {
        try { fs.rmSync(jobDir(job.id), { recursive: true, force: true }); } catch (_) {}
        try { await repository.deleteJobById(job.id); } catch (_) {}
      }
    } catch (error) {
      console.error('[purchase-reconciliation cleanup]', error);
    }
  }

  recover();
  cleanupExpired();
  const cleanupTimer = setInterval(cleanupExpired, 60 * 60 * 1000);
  cleanupTimer.unref?.();

  return {
    enqueue,
    recover,
    cleanupExpired,
    jobDir,
    resolvePythonBin,
    maxConcurrent: limit,
    retentionHours
  };
}

module.exports = { createReconciliationRunner };

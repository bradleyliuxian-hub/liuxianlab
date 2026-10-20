'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_POLL_MS = 500;
const STARTING_MESSAGE = '正在启动序时账分析…';

function createJournalEntryRunner({ root, repository, storageRoot, maxConcurrent = 1 }) {
  const queue = [];
  const active = new Set();
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  const timeoutMs = Math.max(
    30000,
    Number(process.env.JOURNAL_ENTRY_TIMEOUT_MS || 15 * 60 * 1000)
  );
  const retentionHours = Math.max(
    1,
    Number(process.env.JOURNAL_ENTRY_RETENTION_HOURS || 72)
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
    const explicit = process.env.JOURNAL_ENTRY_PYTHON_BIN || process.env.PYTHON_BIN;
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
        console.error('[journal-entry claim]', error);
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
      const args = ['-m', 'services.journal_entry.worker', '--job-dir', dir];
      let child;
      try {
        child = spawn(resolvePythonBin(), args, {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (_) {
        try { fs.closeSync(logFd); } catch (__) {}
        repository.updateJobState(jobId, {
          status: 'failed', progress: 100, error: '无法启动分析程序。'
        }).catch(() => {});
        return resolve();
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch (_) {}
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
        }, 5000).unref?.();
        finalizeFailure(jobId, '分析超时，任务已终止。').finally(resolve);
      }, timeoutMs);

      let lastSerialized = '';
      const poll = setInterval(() => {
        const status = readStatus(jobId);
        if (!status) return;
        const serialized = JSON.stringify(status);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        const patch = {};
        if (status.status) patch.status = status.status;
        if (status.progress !== undefined) {
          patch.progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
        }
        if (status.message !== undefined) patch.progressMessage = status.message;
        repository.updateJobState(jobId, patch).catch(() => {});
      }, STATUS_POLL_MS);

      child.on('error', (error) => {
        console.error('[journal-entry spawn]', error);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        clearInterval(poll);
        try { fs.closeSync(logFd); } catch (_) {}
        if (timedOut) return resolve();
        const status = readStatus(jobId);
        if (code === 0 && status && status.status === 'completed') {
          return finalizeSuccess(jobId, status).finally(resolve);
        }
        const reason = (status && status.error)
          || `分析程序异常退出 (code=${code}, signal=${signal || 'none'})`;
        return finalizeFailure(jobId, reason).finally(resolve);
      });
    });
  }

  async function finalizeSuccess(jobId, status) {
    const dir = jobDir(jobId);
    const resultPath = path.join(dir, 'result.json');
    const exportPath = path.join(dir, 'journal-entry-analysis-report.xlsx');
    if (!fs.existsSync(resultPath) || !fs.existsSync(exportPath)) {
      return finalizeFailure(jobId, '分析完成但结果文件缺失。');
    }
    return repository.updateJobState(jobId, {
      status: 'completed',
      progress: 100,
      progressMessage: status.message || '序时账分析完成。',
      resultPath: relativePath(resultPath),
      exportPath: relativePath(exportPath),
      summaryJson: status.result || null,
      error: null,
      completedAt: new Date()
    }).catch((error) => {
      console.error('[journal-entry finalize]', error);
    });
  }

  function finalizeFailure(jobId, reason) {
    return repository.updateJobState(jobId, {
      status: 'failed',
      progress: 100,
      progressMessage: '分析失败。',
      error: String(reason || '分析失败').slice(0, 500)
    }).catch((error) => {
      console.error('[journal-entry failure]', error);
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
          error: '服务器重启，本次分析已中断，请重新开始。'
        });
      }
      const queued = await repository.listJobsByStatus(['queued'], 100);
      for (const job of queued) enqueue(job.id);
    } catch (error) {
      console.error('[journal-entry recover]', error);
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
      console.error('[journal-entry cleanup]', error);
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

module.exports = { createJournalEntryRunner };

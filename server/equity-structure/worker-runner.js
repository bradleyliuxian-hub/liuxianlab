'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_POLL_MS = 700;
const STARTING_MESSAGE = '正在启动股权结构识别…';

function createEquityRunner({ root, repository, storageRoot, maxConcurrent = 1 }) {
  const queue = [];
  const active = new Set();
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  const timeoutMs = Math.max(
    60000,
    Number(process.env.EQUITY_STRUCTURE_TIMEOUT_MS || 45 * 60 * 1000)
  );
  const retentionHours = Math.max(
    1,
    Number(process.env.EQUITY_STRUCTURE_RETENTION_HOURS || 168)
  );

  function jobDir(jobId) {
    return path.join(storageRoot, String(jobId));
  }

  function readStatus(jobId) {
    try {
      return JSON.parse(fs.readFileSync(path.join(jobDir(jobId), 'status.json'), 'utf8'));
    } catch (_) {
      return null;
    }
  }

  function resolvePythonBin() {
    const explicit = process.env.EQUITY_STRUCTURE_PYTHON_BIN || process.env.PYTHON_BIN;
    if (explicit) {
      if (explicit.startsWith('./') || explicit.startsWith('../')) return path.resolve(root, explicit);
      return explicit;
    }
    const wrapper = path.join(root, 'scripts', 'local', 'equity-python');
    if (fs.existsSync(wrapper)) return wrapper;
    const equityVenv = path.join(root, '.equity-venv', 'bin', 'python');
    if (fs.existsSync(equityVenv)) return equityVenv;
    const projectVenv = path.join(root, '.venv', 'bin', 'python');
    if (fs.existsSync(projectVenv)) return projectVenv;
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
        console.error('[equity claim]', error);
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
          '-m', 'services.equity_structure.worker', '--job-dir', dir
        ], {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (_) {
        try { fs.closeSync(logFd); } catch (__) {}
        repository.updateJobState(jobId, {
          status: 'failed', progress: 100, error: '无法启动识别程序。'
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
        finalizeFailure(jobId, '识别超时，任务已终止。').finally(resolve);
      }, timeoutMs);

      let lastSerialized = '';
      const poll = setInterval(async () => {
        const status = readStatus(jobId);
        if (!status) return;
        const serialized = JSON.stringify(status);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;
        const patch = {};
        if (status.status) patch.status = status.status;
        if (status.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
        if (status.message !== undefined) patch.progressMessage = status.message;
        if (status.diagnostics?.image_width) patch.imageWidth = status.diagnostics.image_width;
        if (status.diagnostics?.image_height) patch.imageHeight = status.diagnostics.image_height;
        repository.updateJobState(jobId, patch).catch(() => {});

        if (status.status === 'completed' && !finalized) {
          const ok = await finalizeSuccess(jobId, status);
          if (ok) finalized = true;
        }
      }, STATUS_POLL_MS);

      child.on('error', (error) => console.error('[equity spawn]', error));

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
        if (finalized) return resolve();
        const reason = (status && status.error)
          || `识别程序异常退出 (code=${code}, signal=${signal || 'none'})`;
        finalizeFailure(jobId, reason).finally(resolve);
      });
    });
  }

  async function finalizeSuccess(jobId, status) {
    const dir = jobDir(jobId);
    const resultDir = path.join(dir, 'result');
    const resultPath = path.join(resultDir, 'result.json');
    if (!fs.existsSync(resultPath)) return false;
    await repository.updateJobState(jobId, {
      status: 'completed',
      progress: 100,
      progressMessage: status.message || '识别完成。',
      resultDir: relativePath(resultDir),
      imageWidth: status.diagnostics?.image_width || null,
      imageHeight: status.diagnostics?.image_height || null,
      summaryJson: status.summary || null,
      error: null,
      completedAt: new Date()
    }).catch((error) => console.error('[equity finalize]', error));
    return true;
  }

  function finalizeFailure(jobId, reason) {
    return repository.updateJobState(jobId, {
      status: 'failed',
      progress: 100,
      progressMessage: '识别失败。',
      error: String(reason || '识别失败').slice(0, 800)
    }).catch((error) => console.error('[equity failure]', error));
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
          error: '服务器重启，本次识别已中断，请重新开始。'
        });
      }
      const queued = await repository.listJobsByStatus(['queued'], 100);
      for (const job of queued) enqueue(job.id);
    } catch (error) {
      console.error('[equity recover]', error);
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
      console.error('[equity cleanup]', error);
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

module.exports = { createEquityRunner };

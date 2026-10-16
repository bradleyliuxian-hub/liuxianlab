'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createJobManager({ root, storageRoot }) {
  const workerPath = path.join(root, 'services', 'excel_standardizer', 'processor.py');
  const maxConcurrent = Math.max(1, Number(process.env.MAX_CONCURRENT_EXCEL_JOBS || 2));
  const retentionHours = Math.max(1, Number(process.env.EXCEL_RETENTION_HOURS || 24));
  const queue = [];
  const active = new Set();

  fs.mkdirSync(storageRoot, { recursive: true });

  function safeJobId(value) {
    const jobId = String(value || '');
    return /^excel_[a-f0-9-]{20,64}$/i.test(jobId) ? jobId : '';
  }

  function jobDir(jobId) {
    const safe = safeJobId(jobId);
    if (!safe) return '';
    return path.join(storageRoot, safe);
  }

  function jobFile(jobId) {
    const dir = jobDir(jobId);
    return dir ? path.join(dir, 'job.json') : '';
  }

  function readJob(jobId) {
    const file = jobFile(jobId);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      console.error(`Failed to read ${file}:`, error.message);
      return null;
    }
  }

  function writeJob(jobId, patch) {
    const dir = jobDir(jobId);
    if (!dir) throw new Error('Invalid job id.');
    fs.mkdirSync(dir, { recursive: true });
    const current = readJob(jobId) || {};
    const next = {
      ...current,
      ...patch,
      id: jobId,
      updatedAt: new Date().toISOString()
    };
    const tmp = path.join(dir, '.job.json.tmp');
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'job.json'));
    return next;
  }

  function ownedJob(jobId, username) {
    const job = readJob(jobId);
    if (!job || job.owner !== username) return null;
    return job;
  }

  function resolvePythonBin() {
    const configured = process.env.PYTHON_BIN;
    if (configured) {
      if (configured.startsWith('./') || configured.startsWith('../')) {
        return path.resolve(root, configured);
      }
      return configured;
    }
    // Fall back to the project virtualenv (has openpyxl), matching excel-review.
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  function runNext() {
    while (active.size < maxConcurrent && queue.length > 0) {
      const jobId = queue.shift();
      const job = readJob(jobId);
      if (!job || job.status !== 'queued') continue;
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
      const job = readJob(jobId);
      if (!dir || !job) return resolve();

      const logPath = path.join(dir, 'worker.log');
      const logFd = fs.openSync(logPath, 'a', 0o600);
      const pythonBin = resolvePythonBin();
      const args = [
        workerPath,
        '--job-dir', dir,
        '--profile', job.profile || 'default'
      ];

      writeJob(jobId, {
        status: 'processing',
        stage: 'starting',
        progress: Math.max(2, Number(job.progress || 0)),
        message: '正在启动 Excel 处理程序…'
      });

      let child;
      try {
        child = spawn(pythonBin, args, {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (error) {
        fs.closeSync(logFd);
        writeJob(jobId, {
          status: 'failed',
          stage: 'failed',
          progress: 100,
          message: '无法启动 Excel 处理程序。',
          error: error.message
        });
        return resolve();
      }

      child.on('error', (error) => {
        const current = readJob(jobId);
        if (current && current.status !== 'completed') {
          writeJob(jobId, {
            status: 'failed',
            stage: 'failed',
            progress: 100,
            message: 'Excel 处理程序启动失败。',
            error: error.message
          });
        }
      });

      child.on('close', (code, signal) => {
        try { fs.closeSync(logFd); } catch (_) {}
        const current = readJob(jobId);
        if (code !== 0 && current && current.status !== 'failed' && current.status !== 'completed') {
          writeJob(jobId, {
            status: 'failed',
            stage: 'failed',
            progress: 100,
            message: 'Excel 处理失败。',
            error: `worker exited with code=${code}, signal=${signal || 'none'}`
          });
        }
        resolve();
      });
    });
  }

  function enqueue(jobId) {
    if (!safeJobId(jobId)) return;
    if (queue.includes(jobId) || active.has(jobId)) return;
    queue.push(jobId);
    runNext();
  }

  function recoverInterruptedJobs() {
    let entries = [];
    try { entries = fs.readdirSync(storageRoot, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeJobId(entry.name)) continue;
      const job = readJob(entry.name);
      if (!job) continue;
      if (['queued', 'processing', 'validating', 'checking', 'reporting'].includes(job.status)) {
        writeJob(entry.name, {
          status: 'failed',
          stage: 'failed',
          progress: 100,
          message: '服务器曾重启，本次任务已中断，请重新上传文件。',
          error: 'job_interrupted_by_server_restart'
        });
      }
    }
  }

  function deleteJob(jobId, username) {
    if (active.has(jobId)) {
      const error = new Error('Job is still processing.');
      error.code = 'JOB_ACTIVE';
      throw error;
    }
    const job = ownedJob(jobId, username);
    if (!job) return false;
    const dir = jobDir(jobId);
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  function cleanupExpired() {
    const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
    let entries = [];
    try { entries = fs.readdirSync(storageRoot, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeJobId(entry.name) || active.has(entry.name)) continue;
      const job = readJob(entry.name);
      if (!job) continue;
      const updated = Date.parse(job.updatedAt || job.createdAt || 0);
      if (Number.isFinite(updated) && updated < cutoff) {
        fs.rmSync(jobDir(entry.name), { recursive: true, force: true });
      }
    }
  }

  recoverInterruptedJobs();
  cleanupExpired();
  const timer = setInterval(cleanupExpired, 60 * 60 * 1000);
  timer.unref?.();

  return {
    active,
    queue,
    maxConcurrent,
    retentionHours,
    safeJobId,
    jobDir,
    readJob,
    writeJob,
    ownedJob,
    enqueue,
    deleteJob
  };
}

module.exports = { createJobManager };

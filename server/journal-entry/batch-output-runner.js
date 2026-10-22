'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 600000;

function resolvePythonBin(root) {
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

function runBatchOutput({ root, outputDir }) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(
      10000,
      Number(process.env.JOURNAL_ENTRY_BATCH_OUTPUT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    );
    let logFd;
    try {
      logFd = fs.openSync(path.join(outputDir, 'batch-output.log'), 'a', 0o600);
    } catch (_) {
      return resolve({ ok: false, error: '无法创建批量导出日志。' });
    }

    const args = ['-m', 'services.journal_entry.batch_output', '--output-dir', outputDir];
    let child;
    try {
      child = spawn(resolvePythonBin(root), args, {
        cwd: root,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } catch (_) {
      try { fs.closeSync(logFd); } catch (__) {}
      return resolve({ ok: false, error: '无法启动批量导出程序。' });
    }

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 5000).unref?.();
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: '批量导出超时，已终止。' });
    }, timeoutMs);

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: `批量导出启动失败：${error.message}` });
    });

    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      if (code === 0) return resolve({ ok: true });
      resolve({
        ok: false,
        error: `批量导出失败 (code=${code}, signal=${signal || 'none'})`
      });
    });
  });
}

module.exports = { runBatchOutput, resolvePythonBin };

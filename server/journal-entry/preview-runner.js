'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PREVIEW_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.JOURNAL_ENTRY_PREVIEW_TIMEOUT_MS || 120000)
);

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

function runPreview({ root, jobDir, mode = 'preview' }) {
  return new Promise((resolve) => {
    const outputName = mode === 'inspect' ? 'inspection.json' : 'preview.json';
    const outputPath = path.join(jobDir, outputName);
    let logFd;
    try {
      logFd = fs.openSync(path.join(jobDir, 'preview.log'), 'a', 0o600);
    } catch (_) {
      return resolve({ ok: false, error: '无法创建预览日志。' });
    }
    const args = ['-m', 'services.journal_entry.preview', '--job-dir', jobDir];
    if (mode === 'inspect') args.push('--inspect');
    else args.push('--preview');

    let child;
    try {
      child = spawn(resolvePythonBin(root), args, {
        cwd: root,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } catch (error) {
      try { fs.closeSync(logFd); } catch (_) {}
      return resolve({ ok: false, error: '无法启动预览处理程序。' });
    }

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 3000).unref?.();
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: '预览超时，请检查文件或映射。' });
    }, PREVIEW_TIMEOUT_MS);

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: '预览处理程序启动失败。', detail: error.message });
    });

    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      if (!fs.existsSync(outputPath)) {
        return resolve({
          ok: false,
          error: '预览处理未返回结果。',
          detail: `code=${code}, signal=${signal || 'none'}`
        });
      }
      try {
        const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        return resolve(payload);
      } catch (error) {
        return resolve({ ok: false, error: '预览结果无法解析。' });
      }
    });
  });
}

module.exports = { createPreviewRunner: (options) => ({
  run: ({ jobDir, mode }) => runPreview({ ...options, jobDir, mode }),
  resolvePythonBin: () => resolvePythonBin(options.root)
}) };

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const INSPECTION_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.PURCHASE_RECONCILIATION_INSPECTION_TIMEOUT_MS || 120000)
);

function resolvePythonBin(root) {
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

function runInspection({ root, jobDir }) {
  return new Promise((resolve) => {
    const outputPath = path.join(jobDir, 'inspection.json');
    let logFd;
    try {
      logFd = fs.openSync(path.join(jobDir, 'inspection.log'), 'a', 0o600);
    } catch (_) {
      return resolve({ ok: false, error: '无法创建识别日志。' });
    }

    let child;
    try {
      child = spawn(resolvePythonBin(root), [
        '-m', 'services.purchase_reconciliation.inspection', '--job-dir', jobDir
      ], {
        cwd: root,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } catch (_) {
      try { fs.closeSync(logFd); } catch (__) {}
      return resolve({ ok: false, error: '无法启动 Excel 识别程序。' });
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
      resolve({ ok: false, error: 'Excel 识别超时，请检查文件或表头行。' });
    }, INSPECTION_TIMEOUT_MS);

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: 'Excel 识别程序启动失败。', detail: error.message });
    });

    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      if (!fs.existsSync(outputPath)) {
        return resolve({
          ok: false,
          error: '识别未返回结果。',
          detail: `code=${code}, signal=${signal || 'none'}`
        });
      }
      try {
        return resolve(JSON.parse(fs.readFileSync(outputPath, 'utf8')));
      } catch (_) {
        return resolve({ ok: false, error: '识别结果无法解析。' });
      }
    });
  });
}

module.exports = {
  createInspectionRunner: (options) => ({
    run: ({ jobDir }) => runInspection({ ...options, jobDir }),
    resolvePythonBin: () => resolvePythonBin(options.root)
  })
};

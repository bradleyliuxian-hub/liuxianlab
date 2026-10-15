'use strict';

/*
 * Excel Review Assistant V1.4 - Control Log worker runner.
 *
 * Spawns the database-free Python worker once per Control Log and reads
 * back its status.json. Control Log generation is a one-shot aggregation
 * (no queue needed): the route awaits the run and then updates the DB row.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function createControlLogRunner({ root }) {
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

  function run(controlDir) {
    return new Promise((resolve) => {
      const pythonBin = resolvePythonBin();
      const args = ['-m', 'services.excel_review.control_log_worker', '--control-dir', controlDir];
      const logFd = fs.openSync(path.join(controlDir, 'worker.log'), 'a', 0o600);

      let child;
      try {
        child = spawn(pythonBin, args, {
          cwd: root,
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });
      } catch (error) {
        try { fs.closeSync(logFd); } catch (_) {}
        return resolve({ ok: false, error: '无法启动 Control Log 处理程序。' });
      }

      child.on('error', (error) => {
        console.error('[excel-review control-log spawn]', error);
      });

      child.on('close', (code, signal) => {
        try { fs.closeSync(logFd); } catch (_) {}
        const status = readStatus(controlDir);
        if (code === 0 && status && status.status && status.status !== 'failed') {
          return resolve({ ok: true, status });
        }
        const error = (status && status.error)
          || `处理程序异常退出 (code=${code}, signal=${signal || 'none'})`;
        return resolve({ ok: false, status, error });
      });
    });
  }

  function readStatus(controlDir) {
    const file = path.join(controlDir, 'status.json');
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  return { run, resolvePythonBin };
}

module.exports = { createControlLogRunner };

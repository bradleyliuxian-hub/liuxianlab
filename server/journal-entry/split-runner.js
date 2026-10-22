'use strict';

const crypto = require('crypto');
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

function runPython({ root, args, logFile }) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(
      10000,
      Number(process.env.JOURNAL_ENTRY_SPLIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    );
    let logFd;
    try {
      logFd = fs.openSync(logFile, 'a', 0o600);
    } catch (_) {
      return resolve({ ok: false, error: '无法创建拆分导出日志。' });
    }
    let child;
    try {
      child = spawn(resolvePythonBin(root), args, {
        cwd: root,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } catch (_) {
      try { fs.closeSync(logFd); } catch (__) {}
      return resolve({ ok: false, error: '无法启动拆分导出程序。' });
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
      resolve({ ok: false, error: '拆分导出超时，已终止。' });
    }, timeoutMs);
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      resolve({ ok: false, error: `拆分导出启动失败：${error.message}` });
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { fs.closeSync(logFd); } catch (_) {}
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, error: `拆分导出失败 (code=${code}, signal=${signal || 'none'})` });
    });
  });
}

function createSplitRunner({ root, storageRoot }) {
  const tempRoot = path.join(storageRoot, 'tmp');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });

  async function preview(request) {
    const dir = path.join(tempRoot, crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const requestFile = path.join(dir, 'request.json');
    const outputFile = path.join(dir, 'preview.json');
    fs.writeFileSync(requestFile, `${JSON.stringify(request)}\n`, { mode: 0o600 });
    try {
      const run = await runPython({
        root,
        args: [
          '-m', 'services.journal_entry.split_export',
          '--mode', 'preview',
          '--request', requestFile,
          '--output', outputFile
        ],
        logFile: path.join(dir, 'split.log')
      });
      if (!run.ok) return { ok: false, error: run.error };
      if (!fs.existsSync(outputFile)) return { ok: false, error: '拆分预览未返回结果。' };
      return { ok: true, payload: JSON.parse(fs.readFileSync(outputFile, 'utf8')) };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  async function dimensions(request) {
    const dir = path.join(tempRoot, crypto.randomUUID());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const requestFile = path.join(dir, 'request.json');
    const outputFile = path.join(dir, 'dimensions.json');
    fs.writeFileSync(requestFile, `${JSON.stringify(request)}\n`, { mode: 0o600 });
    try {
      const run = await runPython({
        root,
        args: [
          '-m', 'services.journal_entry.split_export',
          '--mode', 'dimensions',
          '--request', requestFile,
          '--output', outputFile
        ],
        logFile: path.join(dir, 'split.log')
      });
      if (!run.ok) return { ok: false, error: run.error };
      if (!fs.existsSync(outputFile)) return { ok: false, error: '维度查询未返回结果。' };
      return { ok: true, payload: JSON.parse(fs.readFileSync(outputFile, 'utf8')) };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  async function generate(request, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const requestFile = path.join(outputDir, 'request.json');
    const resultFile = path.join(outputDir, 'split_result.json');
    fs.writeFileSync(requestFile, `${JSON.stringify(request)}\n`, { mode: 0o600 });
    const run = await runPython({
      root,
      args: [
        '-m', 'services.journal_entry.split_export',
        '--mode', 'generate',
        '--request', requestFile,
        '--output', resultFile,
        '--output-dir', outputDir
      ],
      logFile: path.join(outputDir, 'split.log')
    });
    if (!run.ok) return { ok: false, error: run.error };
    if (!fs.existsSync(resultFile)) return { ok: false, error: '拆分导出未返回结果。' };
    return { ok: true, payload: JSON.parse(fs.readFileSync(resultFile, 'utf8')) };
  }

  return { preview, dimensions, generate };
}

module.exports = { createSplitRunner, resolvePythonBin };

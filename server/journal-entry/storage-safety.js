'use strict';

const fs = require('fs');
const path = require('path');

function within(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

function safeRemove(storageRoot, target) {
  if (!target) return { ok: true, removed: false, reason: 'empty' };
  if (!fs.existsSync(storageRoot)) {
    return { ok: true, removed: false, reason: 'missing' };
  }
  const rootReal = fs.realpathSync(storageRoot);
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) {
    let parentReal;
    try { parentReal = fs.realpathSync(path.dirname(absolute)); } catch (_) {
      return { ok: false, removed: false, reason: 'realpath_failed' };
    }
    if (!within(rootReal, parentReal)) {
      return { ok: false, removed: false, reason: 'outside_storage' };
    }
    return { ok: true, removed: false, reason: 'missing' };
  }
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    return { ok: false, removed: false, reason: 'lstat_failed' };
  }
  if (stat.isSymbolicLink()) {
    let parentReal;
    try { parentReal = fs.realpathSync(path.dirname(absolute)); } catch (_) {
      return { ok: false, removed: false, reason: 'realpath_failed' };
    }
    if (!within(rootReal, parentReal)) {
      return { ok: false, removed: false, reason: 'outside_storage' };
    }
    try {
      fs.unlinkSync(absolute);
      return { ok: true, removed: true, reason: 'symlink_removed' };
    } catch (error) {
      return { ok: false, removed: false, reason: 'unlink_failed' };
    }
  }
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch (error) {
    return { ok: false, removed: false, reason: 'realpath_failed' };
  }
  if (!within(rootReal, real)) {
    return { ok: false, removed: false, reason: 'symlink_escape' };
  }
  try {
    fs.rmSync(absolute, { recursive: true, force: true });
    return { ok: true, removed: true, reason: 'removed' };
  } catch (error) {
    return { ok: false, removed: false, reason: 'remove_failed' };
  }
}

function ageHours(target, now = Date.now()) {
  try {
    const stat = fs.lstatSync(target);
    return (now - stat.mtimeMs) / 3600000;
  } catch (_) {
    return null;
  }
}

module.exports = { within, safeRemove, ageHours };

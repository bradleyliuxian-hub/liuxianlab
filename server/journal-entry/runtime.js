'use strict';

/*
 * One Journal Entry runtime per process.
 *
 * The runtime owns exactly one in-process queue, one preview runner and one
 * storage root. Single-file routes and batch routes must receive the same
 * runtime; otherwise JOURNAL_ENTRY_MAX_CONCURRENT would become per-router
 * instead of per-service.
 */

const fs = require('fs');
const path = require('path');

const { createPreviewRunner } = require('./preview-runner');
const { createJournalEntryRunner } = require('./parse-runner');
const { createCleanupService } = require('./cleanup');

function createJournalEntryRuntime({ root, repository, maxConcurrent, cleanup = false }) {
  const storageRoot = path.join(root, 'storage', 'journal-entry');
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
  const previewRunner = createPreviewRunner({ root });
  const runner = createJournalEntryRunner({
    root,
    repository,
    storageRoot,
    maxConcurrent: Number(
      maxConcurrent || process.env.JOURNAL_ENTRY_MAX_CONCURRENT || 1
    ),
    cleanupOnStart: !cleanup
  });
  let cleanupService = null;
  let cleanupTimer = null;
  if (cleanup) {
    cleanupService = createCleanupService({ root });
    cleanupService.recoverGeneratingOutputs()
      .then((stats) => {
        if (stats.batch || stats.split) console.log('[journal-entry recovery]', stats);
      })
      .catch(() => console.error('[journal-entry recovery] failed'));
    cleanupService.run()
      .then((stats) => console.log('[journal-entry cleanup]', stats))
      .catch(() => console.error('[journal-entry cleanup] failed'));
    cleanupTimer = setInterval(() => {
      cleanupService.run()
        .then((stats) => console.log('[journal-entry cleanup]', stats))
        .catch(() => console.error('[journal-entry cleanup] failed'));
    }, 60 * 60 * 1000);
    cleanupTimer.unref?.();
  }
  return { storageRoot, previewRunner, runner, cleanup: cleanupService, cleanupTimer };
}

const sharedRuntimes = new Map();

function getJournalEntryRuntime(options) {
  const key = path.resolve(options.root);
  if (!sharedRuntimes.has(key)) {
    sharedRuntimes.set(key, createJournalEntryRuntime(options));
  }
  return sharedRuntimes.get(key);
}

module.exports = { createJournalEntryRuntime, getJournalEntryRuntime };

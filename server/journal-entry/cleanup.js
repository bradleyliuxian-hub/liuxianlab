'use strict';

const fs = require('fs');
const path = require('path');

const jobRepositoryDefault = require('./repository');
const batchRepositoryDefault = require('./batch-repository');
const batchOutputRepositoryDefault = require('./batch-output-repository');
const splitRepositoryDefault = require('./split-repository');
const presetRepositoryDefault = require('./split-preset-repository');
const { safeRemove, ageHours } = require('./storage-safety');
const { invalidate: invalidateUiProjection } = require('./ui-projection');

const DEFAULT_RETENTION_HOURS = 72;
const DEFAULT_ORPHAN_HOURS = 24;

function hours(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createCleanupService({
  root,
  jobRepository = jobRepositoryDefault,
  batchRepository = batchRepositoryDefault,
  batchOutputRepository = batchOutputRepositoryDefault,
  splitRepository = splitRepositoryDefault,
  presetRepository = presetRepositoryDefault,
  now = () => Date.now()
} = {}) {
  const journalStorage = path.join(root, 'storage', 'journal-entry');
  const batchStorage = path.join(root, 'storage', 'journal-entry-batches');
  const splitStorage = path.join(root, 'storage', 'journal-entry-splits');
  const retentionHours = hours('JOURNAL_ENTRY_RETENTION_HOURS', DEFAULT_RETENTION_HOURS);
  const outputRetentionHours = hours(
    'JOURNAL_ENTRY_OUTPUT_RETENTION_HOURS',
    retentionHours
  );
  const orphanHours = hours('JOURNAL_ENTRY_ORPHAN_SAFETY_HOURS', DEFAULT_ORPHAN_HOURS);

  function cutoff(hoursValue, time) {
    return new Date(time - hoursValue * 60 * 60 * 1000);
  }

  function listDirectories(directory) {
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name);
    } catch (_) {
      return [];
    }
  }

  async function recoverGeneratingOutputs() {
    let batch = 0;
    let split = 0;
    try { batch = await batchOutputRepository.failGeneratingOutputs(); } catch (_) {}
    try { split = await splitRepository.failGeneratingOutputs(); } catch (_) {}
    return { batch, split };
  }

  async function run({ dryRun = false, time = now() } = {}) {
    const stats = {
      dryRun: Boolean(dryRun),
      retentionHours,
      outputRetentionHours,
      orphanSafetyHours: orphanHours,
      expiredJobs: 0,
      deletedJobs: 0,
      expiredBatchOutputs: 0,
      expiredSplitOutputs: 0,
      emptyBatches: 0,
      deletedBatches: 0,
      orphanJobDirs: 0,
      orphanBatchOutputDirs: 0,
      orphanSplitDirs: 0,
      purgedPresets: 0,
      removedDirectories: 0,
      errors: 0
    };

    const jobCutoff = cutoff(retentionHours, time);
    const outputCutoff = cutoff(outputRetentionHours, time);
    const orphanCutoff = cutoff(orphanHours, time);

    const remove = (storageRoot, target) => {
      if (dryRun) return true;
      const result = safeRemove(storageRoot, target);
      if (!result.ok) stats.errors += 1;
      if (result.removed) stats.removedDirectories += 1;
      return result.ok || result.reason === 'missing';
    };

    const expiredJobs = (await jobRepository.listExpiredJobs(jobCutoff, 500))
      .filter((job) => ['draft', 'completed', 'failed'].includes(job.status));
    for (const job of expiredJobs) {
      stats.expiredJobs += 1;
      const dir = path.join(journalStorage, String(job.id));
      if (remove(journalStorage, dir) && !dryRun) {
        try { await jobRepository.deleteJobById(job.id); } catch (_) { stats.errors += 1; }
        invalidateUiProjection(job.id);
      }
    }

    const deletedJobs = (await jobRepository.listDeletedJobs(jobCutoff, 500))
      .filter((job) => job.deletedAt);
    for (const job of deletedJobs) {
      stats.deletedJobs += 1;
      const dir = path.join(journalStorage, String(job.id));
      if (remove(journalStorage, dir) && !dryRun) {
        try { await jobRepository.deleteJobById(job.id); } catch (_) { stats.errors += 1; }
        invalidateUiProjection(job.id);
      }
    }

    const expiredBatchOutputs = (await batchOutputRepository.listExpiredOutputs(
      outputCutoff, 500
    )).filter((output) => ['completed', 'failed'].includes(output.status)
      && !output.expiredAt);
    for (const output of expiredBatchOutputs) {
      stats.expiredBatchOutputs += 1;
      const dir = path.join(batchStorage, String(output.batchId), String(output.id));
      if (remove(batchStorage, dir) && !dryRun) {
        try { await batchOutputRepository.expireOutput(output.id); } catch (_) { stats.errors += 1; }
      }
    }

    const expiredSplitOutputs = (await splitRepository.listExpiredOutputs(
      outputCutoff, 500
    )).filter((output) => ['completed', 'failed'].includes(output.status)
      && !output.expiredAt);
    for (const output of expiredSplitOutputs) {
      stats.expiredSplitOutputs += 1;
      const dir = path.join(splitStorage, String(output.id));
      if (remove(splitStorage, dir) && !dryRun) {
        try { await splitRepository.expireOutput(output.id); } catch (_) { stats.errors += 1; }
      }
    }

    const emptyBatches = await batchRepository.listEmptyBatches(
      cutoff(retentionHours, time), 200
    );
    for (const batchId of emptyBatches) {
      const outputs = await batchOutputRepository.listForBatch(batchId);
      const splits = await splitRepository.listByScope('batch', batchId);
      const active = outputs.some((item) => item.status === 'generating' || !item.expiredAt)
        || splits.some((item) => item.status === 'generating' || !item.expiredAt);
      if (active) continue;
      stats.emptyBatches += 1;
      if (dryRun) continue;
      for (const output of outputs) {
        remove(batchStorage, path.join(batchStorage, batchId, output.id));
      }
      if (await batchRepository.deleteBatch(batchId)) stats.deletedBatches += 1;
      else stats.errors += 1;
    }

    const deletedBatches = await batchRepository.listDeletedBatches(jobCutoff, 200);
    for (const batchId of deletedBatches) {
      stats.deletedBatches += 1;
      if (!dryRun) {
        try {
          for (const output of await batchOutputRepository.listForBatch(batchId)) {
            remove(batchStorage, path.join(batchStorage, batchId, output.id));
          }
          await batchRepository.deleteBatch(batchId);
        } catch (_) { stats.errors += 1; }
      }
    }

    if (!dryRun) {
      stats.purgedPresets = await presetRepository.purgeDeletedPresets(jobCutoff, 200);
    }

    try {
      const jobIds = new Set(await jobRepository.listAllJobIds());
      for (const name of listDirectories(journalStorage)) {
        if (jobIds.has(name)) continue;
        const target = path.join(journalStorage, name);
        if ((ageHours(target, time) || 0) < orphanHours) continue;
        stats.orphanJobDirs += 1;
        remove(journalStorage, target);
      }
    } catch (_) { stats.errors += 1; }

    try {
      const outputIds = new Set(
        (await batchOutputRepository.listAllOutputIds()).map((item) => item.id)
      );
      for (const batchName of listDirectories(batchStorage)) {
        const batchDir = path.join(batchStorage, batchName);
        for (const outputName of listDirectories(batchDir)) {
          if (outputIds.has(outputName)) continue;
          const target = path.join(batchDir, outputName);
          if ((ageHours(target, time) || 0) < orphanHours) continue;
          stats.orphanBatchOutputDirs += 1;
          remove(batchStorage, target);
        }
      }
    } catch (_) { stats.errors += 1; }

    try {
      const splitIds = new Set(await splitRepository.listAllOutputIds());
      for (const name of listDirectories(splitStorage)) {
        if (name === 'tmp' || splitIds.has(name)) continue;
        const target = path.join(splitStorage, name);
        if ((ageHours(target, time) || 0) < orphanHours) continue;
        stats.orphanSplitDirs += 1;
        remove(splitStorage, target);
      }
    } catch (_) { stats.errors += 1; }

    return stats;
  }

  return {
    run,
    recoverGeneratingOutputs,
    retentionHours,
    outputRetentionHours,
    orphanSafetyHours: orphanHours,
    journalStorage,
    batchStorage,
    splitStorage
  };
}

module.exports = { createCleanupService, DEFAULT_RETENTION_HOURS, DEFAULT_ORPHAN_HOURS };

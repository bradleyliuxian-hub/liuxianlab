'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { createCleanupService } = require(path.join(ROOT, 'server', 'journal-entry', 'cleanup.js'));

const HOUR = 60 * 60 * 1000;

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'je-cleanup-'));
  const journal = path.join(root, 'storage', 'journal-entry');
  const batch = path.join(root, 'storage', 'journal-entry-batches');
  const split = path.join(root, 'storage', 'journal-entry-splits');
  fs.mkdirSync(journal, { recursive: true });
  fs.mkdirSync(batch, { recursive: true });
  fs.mkdirSync(split, { recursive: true });
  const calls = {
    deletedJobs: [], expiredBatch: [], expiredSplit: [],
    deletedBatches: [], purged: 0, emptyBatches: []
  };
  const repo = {
    expiredJobs: [], deletedJobs: [], allJobIds: [],
    async listExpiredJobs() { return this.expiredJobs; },
    async listDeletedJobs() { return this.deletedJobs; },
    async listAllJobIds() { return this.allJobIds; },
    async deleteJobById(id) { calls.deletedJobs.push(id); }
  };
  const batchRepo = {
    empty: [], deleted: [], allIds: [],
    async listEmptyBatches() { return this.empty; },
    async listDeletedBatches() { return this.deleted; },
    async listAllBatchIds() { return this.allIds; },
    async deleteBatch(id) { calls.deletedBatches.push(id); return true; }
  };
  const outputRepo = {
    expired: [], all: [],
    async listExpiredOutputs() { return this.expired; },
    async listAllOutputIds() { return this.all; },
    async listForBatch() { return []; },
    async expireOutput(id) { calls.expiredBatch.push(id); return { id, expiredAt: new Date() }; },
    async failGeneratingOutputs() { return 2; }
  };
  const splitRepo = {
    expired: [], all: [], byScope: [],
    async listExpiredOutputs() { return this.expired; },
    async listAllOutputIds() { return this.all; },
    async listByScope() { return this.byScope; },
    async expireOutput(id) { calls.expiredSplit.push(id); return { id, expiredAt: new Date() }; },
    async failGeneratingOutputs() { return 3; }
  };
  const presetRepo = {
    async purgeDeletedPresets() { calls.purged += 1; return 1; }
  };
  const now = Date.now();
  const service = createCleanupService({
    root, jobRepository: repo, batchRepository: batchRepo,
    batchOutputRepository: outputRepo, splitRepository: splitRepo,
    presetRepository: presetRepo, now: () => now
  });
  return { root, journal, batch, split, calls, repo, batchRepo, outputRepo, splitRepo, service, now };
}

function old(target, now) {
  fs.utimesSync(target, new Date(now - 100 * HOUR), new Date(now - 100 * HOUR));
}

test.afterEach(() => {
  // Each test cleans its own runtime; this hook is intentionally empty.
});

test('expired completed job files and row are removed, active job is kept', async () => {
  const r = makeRuntime();
  try {
    const expiredDir = path.join(r.journal, 'expired-job');
    const activeDir = path.join(r.journal, 'active-job');
    fs.mkdirSync(expiredDir); fs.writeFileSync(path.join(expiredDir, 'source.xlsx'), 'x');
    fs.mkdirSync(activeDir);
    r.repo.expiredJobs = [
      { id: 'expired-job', status: 'completed' },
      { id: 'active-job', status: 'running' }
    ];
    r.repo.allJobIds = ['active-job'];
    const stats = await r.service.run();
    assert.equal(stats.expiredJobs, 1);
    assert.deepEqual(r.calls.deletedJobs, ['expired-job']);
    assert.equal(fs.existsSync(expiredDir), false);
    assert.equal(fs.existsSync(activeDir), true);
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

test('deleted jobs are purged and dry-run deletes nothing', async () => {
  const r = makeRuntime();
  try {
    const dir = path.join(r.journal, 'deleted-job');
    fs.mkdirSync(dir);
    r.repo.deletedJobs = [{ id: 'deleted-job', deletedAt: new Date() }];
    const dry = await r.service.run({ dryRun: true });
    assert.equal(dry.deletedJobs, 1);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(r.calls.deletedJobs.length, 0);
    const actual = await r.service.run();
    assert.equal(actual.deletedJobs, 1);
    assert.equal(fs.existsSync(dir), false);
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

test('batch and split outputs expire files, empty/deleted batches clean up', async () => {
  const r = makeRuntime();
  try {
    const batchDir = path.join(r.batch, 'batch-1', 'output-1');
    const splitDir = path.join(r.split, 'split-1');
    fs.mkdirSync(batchDir, { recursive: true }); fs.writeFileSync(path.join(batchDir, 'batch-report.zip'), 'x');
    fs.mkdirSync(splitDir); fs.writeFileSync(path.join(splitDir, 'split-export.zip'), 'x');
    r.outputRepo.expired = [{ id: 'output-1', batchId: 'batch-1', status: 'completed', expiredAt: null }];
    r.outputRepo.all = [{ id: 'output-1', batchId: 'batch-1' }];
    r.splitRepo.expired = [{ id: 'split-1', status: 'completed', expiredAt: null }];
    r.splitRepo.all = ['split-1'];
    r.batchRepo.empty = ['empty-1'];
    r.batchRepo.deleted = ['deleted-1'];
    const stats = await r.service.run();
    assert.equal(stats.expiredBatchOutputs, 1);
    assert.equal(stats.expiredSplitOutputs, 1);
    assert.deepEqual(r.calls.expiredBatch, ['output-1']);
    assert.deepEqual(r.calls.expiredSplit, ['split-1']);
    assert.equal(fs.existsSync(batchDir), false);
    assert.equal(fs.existsSync(splitDir), false);
    assert.deepEqual(r.calls.deletedBatches, ['empty-1', 'deleted-1']);
    assert.equal(r.calls.purged, 1);
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

test('orphan directories respect safety age and symlinks do not escape', async () => {
  const r = makeRuntime();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'je-outside-'));
  try {
    const oldOrphan = path.join(r.journal, 'unknown-old');
    fs.mkdirSync(oldOrphan); old(oldOrphan, r.now);
    const freshOrphan = path.join(r.journal, 'unknown-fresh');
    fs.mkdirSync(freshOrphan);
    const outsideFile = path.join(outside, 'keep.txt');
    fs.writeFileSync(outsideFile, 'keep');
    const linkedJob = path.join(r.journal, 'linked-job');
    fs.mkdirSync(linkedJob);
    fs.symlinkSync(outsideFile, path.join(linkedJob, 'evil-link'));
    r.repo.expiredJobs = [{ id: 'linked-job', status: 'completed' }];
    r.repo.allJobIds = [];
    const stats = await r.service.run();
    assert.equal(stats.orphanJobDirs, 1);
    assert.equal(fs.existsSync(oldOrphan), false);
    assert.equal(fs.existsSync(freshOrphan), true);
    assert.equal(fs.existsSync(outsideFile), true);
    assert.equal(fs.existsSync(linkedJob), false);
  } finally {
    fs.rmSync(r.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('startup recovery marks generating outputs failed', async () => {
  const r = makeRuntime();
  try {
    const stats = await r.service.recoverGeneratingOutputs();
    assert.deepEqual(stats, { batch: 2, split: 3 });
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

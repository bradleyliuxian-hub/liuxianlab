'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'je-runtime-'));
const repositoryPath = require.resolve(path.join(ROOT, 'server', 'journal-entry', 'repository.js'));
const state = { claimed: [] };

require.cache[repositoryPath] = {
  id: repositoryPath,
  filename: repositoryPath,
  loaded: true,
  exports: {
    async listJobsByStatus() { return []; },
    async claimJob(id) { state.claimed.push(id); return null; },
    async updateJobState() { return null; },
    async listExpiredJobs() { return []; }
  }
};

const { createJournalEntryRuntime } = require(path.join(ROOT, 'server', 'journal-entry', 'runtime.js'));

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('default runtime wires the shared repository into the worker queue', async () => {
  const runtime = createJournalEntryRuntime({ root: tempRoot, cleanup: false });
  const jobId = 'runtime-default-job';
  fs.mkdirSync(path.join(runtime.storageRoot, jobId), { recursive: true });
  runtime.runner.enqueue(jobId);
  const deadline = Date.now() + 3000;
  while (!state.claimed.includes(jobId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(state.claimed, [jobId]);
});

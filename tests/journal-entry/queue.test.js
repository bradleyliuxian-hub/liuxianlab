'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { createJournalEntryRunner } = require(path.join(ROOT, 'server', 'journal-entry', 'parse-runner.js'));

function createFakeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'je-queue-'));
  const storageRoot = path.join(root, 'storage', 'journal-entry');
  const logFile = path.join(root, 'events.log');
  fs.mkdirSync(storageRoot, { recursive: true });

  const workerFile = path.join(root, 'fake-worker.js');
  fs.writeFileSync(workerFile, `
    const fs = require('fs');
    const path = require('path');
    const index = process.argv.indexOf('--job-dir');
    const dir = process.argv[index + 1];
    const log = process.env.JE_QUEUE_TEST_LOG;
    const append = (event) => fs.appendFileSync(
      log,
      JSON.stringify({ event, t: Date.now(), pid: process.pid, dir: path.basename(dir) }) + '\\n'
    );
    append('start');
    setTimeout(() => {
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
        status: 'completed',
        progress: 100,
        message: 'done',
        result: { voucher_count: 0 }
      }));
      fs.writeFileSync(path.join(dir, 'result.json'), '{}');
      fs.writeFileSync(path.join(dir, 'journal-entry-analysis-report.xlsx'), 'PK');
      const ui = path.join(dir, 'ui');
      fs.mkdirSync(ui, { recursive: true });
      for (const name of ['summary.json', 'vouchers.ndjson', 'findings.json', 'details.bin', 'details.idx.json']) {
        fs.writeFileSync(path.join(ui, name), '');
      }
      append('end');
    }, 250);
  `);
  const wrapper = path.join(root, 'fake-python');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${workerFile}" "$@"\n`);
  fs.chmodSync(wrapper, 0o755);

  process.env.JOURNAL_ENTRY_PYTHON_BIN = wrapper;
  process.env.JE_QUEUE_TEST_LOG = logFile;

  const jobs = new Map();
  const repository = {
    async claimJob(id, { message } = {}) {
      const job = jobs.get(id);
      if (!job || job.status !== 'queued') return null;
      const next = { ...job, status: 'running', progress: 0, progressMessage: message || 'running' };
      jobs.set(id, next);
      return next;
    },
    async updateJobState(id, patch) {
      const job = jobs.get(id);
      if (!job) return null;
      const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
      jobs.set(id, next);
      return next;
    },
    async listJobsByStatus(statuses, limit = 100) {
      return [...jobs.values()]
        .filter((job) => statuses.includes(job.status))
        .slice(0, limit);
    },
    async listExpiredJobs() { return []; }
  };

  function addJob(id, status = 'queued') {
    const dir = path.join(storageRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    jobs.set(id, { id, status, progress: 0, progressMessage: '', error: null });
    return jobs.get(id);
  }

  function readEvents() {
    if (!fs.existsSync(logFile)) return [];
    return fs.readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  return { root, storageRoot, logFile, wrapper, jobs, repository, addJob, readEvents };
}

async function waitFor(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for condition');
}

test.after(() => {
  delete process.env.JOURNAL_ENTRY_PYTHON_BIN;
  delete process.env.JE_QUEUE_TEST_LOG;
});

test('one shared runner enforces global concurrency and de-duplicates enqueue', async () => {
  const runtime = createFakeRuntime();
  try {
    const runner = createJournalEntryRunner({
      root: runtime.root,
      repository: runtime.repository,
      storageRoot: runtime.storageRoot,
      maxConcurrent: 1,
      recoverOnStart: false,
      cleanupOnStart: false
    });
    runtime.addJob('single-a');
    runtime.addJob('batch-b');
    runtime.addJob('batch-c');

    runner.enqueue('single-a');
    runner.enqueue('single-a');
    runner.enqueue('batch-b');
    runner.enqueue('batch-c');

    await waitFor(() => [...runtime.jobs.values()].every((job) => job.status === 'completed'));
    const events = runtime.readEvents();
    const starts = events.filter((event) => event.event === 'start');
    assert.equal(starts.length, 3);
    assert.equal(starts.filter((event) => event.dir === 'single-a').length, 1);

    let active = 0;
    let maxActive = 0;
    for (const event of events) {
      active += event.event === 'start' ? 1 : -1;
      maxActive = Math.max(maxActive, active);
    }
    assert.equal(maxActive, 1);
  } finally {
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('startup recovery picks up a queued batch-child job through the shared runner', async () => {
  const runtime = createFakeRuntime();
  try {
    runtime.addJob('batch-child-recovered');
    const runner = createJournalEntryRunner({
      root: runtime.root,
      repository: runtime.repository,
      storageRoot: runtime.storageRoot,
      maxConcurrent: 1
    });
    await waitFor(
      () => runtime.jobs.get('batch-child-recovered').status === 'completed'
    );
    const starts = runtime.readEvents().filter((event) => event.event === 'start');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].dir, 'batch-child-recovered');
  } finally {
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFlowchartService } = require('../../server/flowchart-excel/service');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'flowchart-excel', 'one-pixel.png'));

test('expired jobs are removed by lazy cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-ttl-'));
  const service = createFlowchartService({ root, retentionMs: 5 });
  try {
    const job = service.createJob({
      ownerUsername: 'alice',
      originalFilename: 'ttl.png',
      extension: '.png',
      mimeType: 'image/png',
      buffer: PNG,
      sha256: 'a'.repeat(64),
      imageWidth: 2,
      imageHeight: 2
    });
    assert.ok(service.getJobForOwner(job.id, 'alice'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    const removed = service.cleanupExpired();
    assert.equal(removed, 1);
    assert.equal(service.getJobForOwner(job.id, 'alice'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('jobs are isolated by owner in list results', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-owner-'));
  const service = createFlowchartService({ root, retentionMs: 60000 });
  try {
    const input = {
      originalFilename: 'owner.png',
      extension: '.png',
      mimeType: 'image/png',
      buffer: PNG,
      sha256: 'b'.repeat(64),
      imageWidth: 2,
      imageHeight: 2
    };
    const one = service.createJob({ ...input, ownerUsername: 'alice' });
    service.createJob({ ...input, ownerUsername: 'bob' });
    assert.deepEqual(service.listJobsForOwner('alice').map((job) => job.id), [one.id]);
    assert.equal(service.listJobsForOwner('bob').length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

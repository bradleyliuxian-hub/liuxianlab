'use strict';

const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');

class MemoryJobStore {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.jobs = new Map();
  }

  create({ ownerId, items, provider = '' }) {
    this.prune();
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      ownerId,
      provider,
      status: 'queued',
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      total: items.length,
      processed: 0,
      counts: { matched: 0, review: 0, not_found: 0, error: 0, cancelled: 0 },
      items: items.map((input, index) => ({
        itemId: randomUUID(),
        index,
        input,
        status: 'queued',
        match: null,
        candidates: [],
        confidence: 0,
        error: null,
        selectedByUser: false,
      })),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getOwned(jobId, ownerId) {
    this.prune();
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) throw new AppError('JOB_NOT_FOUND', '任务不存在。', 404);
    return job;
  }

  touch(job) {
    job.updatedAt = new Date().toISOString();
  }

  prune() {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      const updated = Date.parse(job.updatedAt || job.createdAt);
      if (Number.isFinite(updated) && now - updated > this.ttlMs) this.jobs.delete(jobId);
    }
  }
}

module.exports = { MemoryJobStore };

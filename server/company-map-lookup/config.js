'use strict';

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFloatBounded(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function loadConfig(env = process.env) {
  const provider = String(env.COMPANY_MAP_PROVIDER || 'auto').toLowerCase();
  if (!['auto', 'amap', 'baidu'].includes(provider)) {
    throw new Error('COMPANY_MAP_PROVIDER must be one of: auto, amap, baidu');
  }

  const autoAcceptThreshold = parseFloatBounded(
    env.COMPANY_MAP_AUTO_ACCEPT_THRESHOLD,
    0.94,
    0.5,
    1
  );
  const reviewThreshold = parseFloatBounded(
    env.COMPANY_MAP_REVIEW_THRESHOLD,
    0.66,
    0,
    autoAcceptThreshold
  );

  return Object.freeze({
    provider,
    amapKey: env.AMAP_WEB_SERVICE_KEY || '',
    baiduAk: env.BAIDU_MAP_AK || '',
    requestTimeoutMs: parseInteger(env.COMPANY_MAP_REQUEST_TIMEOUT_MS, 8000, 1000, 30000),
    concurrency: parseInteger(env.COMPANY_MAP_CONCURRENCY, 2, 1, 10),
    maxBatchSize: parseInteger(env.COMPANY_MAP_MAX_BATCH_SIZE, 500, 1, 2000),
    candidateLimit: parseInteger(env.COMPANY_MAP_CANDIDATE_LIMIT, 10, 1, 20),
    returnedCandidateLimit: parseInteger(env.COMPANY_MAP_RETURNED_CANDIDATES, 5, 1, 10),
    cacheTtlMs: parseInteger(env.COMPANY_MAP_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000, 0, 90 * 24 * 60 * 60 * 1000),
    jobTtlMs: parseInteger(env.COMPANY_MAP_JOB_TTL_MS, 2 * 60 * 60 * 1000, 5 * 60 * 1000, 24 * 60 * 60 * 1000),
    autoAcceptThreshold,
    reviewThreshold,
  });
}

module.exports = { loadConfig };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..');
const { CompanyMapLookupService } = require(path.join(ROOT, 'server', 'company-map-lookup', 'service.js'));
const {
  createCompanyMapLookupRouter,
  companyMapLookupErrorHandler
} = require(path.join(ROOT, 'server', 'company-map-lookup', 'routes.js'));
const { ProviderError } = require(path.join(ROOT, 'server', 'company-map-lookup', 'errors.js'));
const {
  classifyMatch,
  scoreCandidate
} = require(path.join(ROOT, 'server', 'company-map-lookup', 'matching.js'));

function config(overrides = {}) {
  return {
    provider: 'amap',
    amapKey: 'test-secret-map-key',
    baiduAk: '',
    requestTimeoutMs: 1000,
    concurrency: 2,
    maxBatchSize: 500,
    candidateLimit: 10,
    returnedCandidateLimit: 5,
    cacheTtlMs: 60000,
    jobTtlMs: 60000,
    autoAcceptThreshold: 0.94,
    reviewThreshold: 0.66,
    ...overrides
  };
}

function candidate(poiId, name, overrides = {}) {
  return {
    poiId,
    name,
    address: '上海市浦东新区示例路1号',
    province: '上海市',
    city: '上海市',
    district: '浦东新区',
    longitude: 121.5,
    latitude: 31.2,
    coordinateSystem: 'GCJ-02',
    source: 'amap',
    ...overrides
  };
}

const fakeProvider = {
  name: 'amap',
  isConfigured: () => true,
  async search({ companyName }) {
    if (companyName === '失败公司') {
      const error = new Error('provider exploded');
      error.code = 'MAP_PROVIDER_REJECTED';
      throw error;
    }
    if (companyName === '无结果公司') return [];
    if (companyName === '华鑫科技') {
      return [
        candidate('poi-hx-1', '华鑫科技有限公司'),
        candidate('poi-hx-2', '华鑫信息科技有限公司')
      ];
    }
    return [candidate('poi-' + companyName, companyName)];
  }
};

function makeService(overrides = {}) {
  return new CompanyMapLookupService({
    config: config(overrides),
    providers: { amap: fakeProvider }
  });
}

function makeApp(service) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    const username = req.headers['x-user'];
    if (username) req.session = { auth: { username } };
    next();
  });

  const requireAuth = (req, res, next) => {
    if (req.session?.auth?.username) return next();
    return res.status(401).json({ ok: false, message: '请先登录。' });
  };
  const sameOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch (_) { /* reject below */ }
    return res.status(403).json({ ok: false, message: '请求来源无效。' });
  };

  app.use('/api/company-map-lookup', createCompanyMapLookupRouter({
    express,
    service,
    requireAuth,
    sameOrigin,
    getOwnerId: (req) => req.session?.auth?.username || ''
  }));
  app.use(companyMapLookupErrorHandler);
  return app;
}

let server;
let base;
let appService;

test.before(async () => {
  appService = makeService();
  const app = makeApp(appService);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
});

async function request(pathname, { method = 'GET', user = 'alice', body, origin } = {}) {
  const headers = { Accept: 'application/json' };
  if (user) headers['x-user'] = user;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  const response = await fetch(base + pathname, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function createJob(items, user = 'alice') {
  return request('/api/company-map-lookup/jobs', {
    method: 'POST',
    user,
    body: { items }
  });
}

async function waitForJob(jobId, user = 'alice') {
  for (let i = 0; i < 100; i += 1) {
    const { status, body } = await request(`/api/company-map-lookup/jobs/${jobId}`, { user });
    assert.equal(status, 200);
    if (['completed', 'cancelled'].includes(body.data.status)) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish');
}

test('matching: exact name auto-matches; exact name with mismatched region goes to review', () => {
  const exact = classifyMatch(
    { companyName: '上海示例科技有限公司', region: '上海市', strictRegion: false },
    [candidate('1', '上海示例科技有限公司')],
    config()
  );
  assert.equal(exact.status, 'matched');

  const wrongRegion = classifyMatch(
    { companyName: '上海示例科技有限公司', region: '北京市', strictRegion: true },
    [candidate('2', '上海示例科技有限公司', { province: '上海市', city: '上海市', address: '上海市浦东新区' })],
    config()
  );
  assert.equal(wrongRegion.status, 'review');
  assert.equal(wrongRegion.match, null);
});

test('matching: ambiguous names require review; branch mismatch is penalized', () => {
  const ambiguous = classifyMatch(
    { companyName: '华鑫科技', region: '', strictRegion: false },
    [
      candidate('1', '华鑫科技有限公司'),
      candidate('2', '华鑫信息科技有限公司')
    ],
    config()
  );
  assert.equal(ambiguous.status, 'review');
  assert.equal(ambiguous.match, null);

  const parent = scoreCandidate(
    { companyName: '上海示例科技有限公司', region: '' },
    { name: '上海示例科技有限公司', city: '上海市', address: '上海市浦东新区' }
  );
  const branch = scoreCandidate(
    { companyName: '上海示例科技有限公司', region: '' },
    { name: '上海示例科技有限公司北京分公司', city: '北京市', address: '北京市朝阳区' }
  );
  assert.ok(parent > branch, `parent ${parent} should outrank branch ${branch}`);
});

test('matching: no candidates is not_found', () => {
  const result = classifyMatch({ companyName: '无结果公司', region: '' }, [], config());
  assert.equal(result.status, 'not_found');
  assert.equal(result.match, null);
});

test('meta does not expose provider key', async () => {
  const { status, body } = await request('/api/company-map-lookup/meta');
  assert.equal(status, 200);
  assert.equal(body.data.coordinateSystem, 'GCJ-02');
  assert.deepEqual(body.data.configuredProviders, ['amap']);
  assert.doesNotMatch(JSON.stringify(body), /test-secret-map-key/);
});

test('unauthenticated request is rejected', async () => {
  const { status, body } = await request('/api/company-map-lookup/meta', { user: '' });
  assert.equal(status, 401);
  assert.equal(body.ok, false);
});

test('mutation requests still pass through same-origin protection', async () => {
  const { status, body } = await request('/api/company-map-lookup/jobs', {
    method: 'POST',
    body: { items: [{ companyName: '甲有限公司' }] },
    origin: 'http://evil.example'
  });
  assert.equal(status, 403);
  assert.equal(body.ok, false);
});

test('single exact match and owner scope', async () => {
  const created = await createJob([{ clientId: 'r1', companyName: '甲有限公司', region: '上海市' }]);
  assert.equal(created.status, 202);
  const job = await waitForJob(created.body.data.jobId);
  assert.equal(job.counts.matched, 1);

  const results = await request(`/api/company-map-lookup/jobs/${job.jobId}/results`);
  assert.equal(results.status, 200);
  assert.equal(results.body.data.items[0].status, 'matched');
  assert.equal(results.body.data.items[0].input.companyName, '甲有限公司');
  assert.equal(results.body.data.items[0].match.coordinateSystem, 'GCJ-02');
  assert.doesNotMatch(JSON.stringify(results.body), /test-secret-map-key/);

  const otherOwner = await request(`/api/company-map-lookup/jobs/${job.jobId}`, { user: 'bob' });
  assert.equal(otherOwner.status, 404);
  assert.equal(otherOwner.body.error.code, 'JOB_NOT_FOUND');
});

test('batch keeps provider failure isolated and exposes progress', async () => {
  const created = await createJob([
    { companyName: '甲有限公司' },
    { companyName: '失败公司' },
    { companyName: '乙有限公司' }
  ]);
  const job = await waitForJob(created.body.data.jobId);
  assert.equal(job.status, 'completed');
  assert.equal(job.processed, 3);
  assert.equal(job.counts.matched, 2);
  assert.equal(job.counts.error, 1);

  const results = await request(`/api/company-map-lookup/jobs/${job.jobId}/results?status=error`);
  assert.equal(results.body.data.total, 1);
  assert.equal(results.body.data.items[0].status, 'error');
  assert.equal(results.body.data.items[0].error.code, 'MAP_PROVIDER_REJECTED');
});

test('results support status and q filters', async () => {
  const created = await createJob([
    { companyName: '华鑫科技' },
    { companyName: '甲有限公司' },
    { companyName: '无结果公司' }
  ]);
  const job = await waitForJob(created.body.data.jobId);
  assert.equal(job.counts.review, 1);
  assert.equal(job.counts.not_found, 1);

  const review = await request(`/api/company-map-lookup/jobs/${job.jobId}/results?status=review&q=华鑫`);
  assert.equal(review.body.data.total, 1);
  assert.equal(review.body.data.items[0].status, 'review');
  assert.ok(review.body.data.items[0].candidates.length >= 2);
});

test('manual resolve only accepts an existing candidate', async () => {
  const created = await createJob([{ companyName: '华鑫科技' }]);
  const job = await waitForJob(created.body.data.jobId);
  const results = await request(`/api/company-map-lookup/jobs/${job.jobId}/results?status=review`);
  const item = results.body.data.items[0];

  const invalid = await request(
    `/api/company-map-lookup/jobs/${job.jobId}/items/${item.itemId}/resolve`,
    { method: 'POST', body: { poiId: 'not-a-real-poi' } }
  );
  assert.equal(invalid.status, 404);
  assert.equal(invalid.body.error.code, 'CANDIDATE_NOT_FOUND');

  const resolved = await request(
    `/api/company-map-lookup/jobs/${job.jobId}/items/${item.itemId}/resolve`,
    { method: 'POST', body: { poiId: item.candidates[0].poiId } }
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.status, 'matched');
  assert.equal(resolved.body.data.selectedByUser, true);

  const after = await request(`/api/company-map-lookup/jobs/${job.jobId}`);
  assert.equal(after.body.data.counts.review, 0);
  assert.equal(after.body.data.counts.matched, 1);
});

test('cancel marks a queued job cancelled without sending queued items', async () => {
  const service = makeService({ concurrency: 1 });
  const created = service.createJob({
    ownerId: 'alice',
    items: [
      { companyName: '甲有限公司', region: '', strictRegion: false, clientId: 'a' },
      { companyName: '乙有限公司', region: '', strictRegion: false, clientId: 'b' }
    ]
  });
  const cancelled = service.cancelJob({ jobId: created.jobId, ownerId: 'alice' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.processed, 2);
  assert.equal(cancelled.counts.cancelled, 2);
  const later = await waitForJobInService(service, created.jobId, 'alice');
  assert.equal(later.status, 'cancelled');
});

async function waitForJobInService(service, jobId, ownerId) {
  for (let i = 0; i < 50; i += 1) {
    const job = service.getJob({ jobId, ownerId });
    if (['completed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('service job did not finish');
}

test('batch validation rejects empty, oversized and invalid items', async () => {
  const empty = await request('/api/company-map-lookup/jobs', { method: 'POST', body: { items: [] } });
  assert.equal(empty.status, 400);

  const oversized = await createJob(
    Array.from({ length: 501 }, (_, i) => ({ companyName: `公司${i}` }))
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'BATCH_TOO_LARGE');

  const invalid = await request('/api/company-map-lookup/jobs', {
    method: 'POST',
    body: { items: [{ companyName: '   ' }] }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

async function requestFrom(baseUrl, pathname, { method = 'GET', user = 'alice', body, origin } = {}) {
  const headers = { Accept: 'application/json' };
  if (user) headers['x-user'] = user;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  const response = await fetch(baseUrl + pathname, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function withApp(service, fn) {
  const app = makeApp(service);
  const srv = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  try {
    return await fn((pathname, options) => requestFrom(baseUrl, pathname, options), baseUrl);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

function makeKeyService({ providerFactory, configOverrides = {}, providers } = {}) {
  return new CompanyMapLookupService({
    config: config(configOverrides),
    ...(providers !== undefined ? { providers } : {}),
    providerFactory
  });
}

async function waitForServiceJob(service, jobId, ownerId = 'alice') {
  return waitForJobInService(service, jobId, ownerId);
}

test('user amap key is used by the provider and takes priority over the env key', async () => {
  const seen = [];
  const service = makeKeyService({
    configOverrides: { amapKey: 'env-amap-key' },
    providers: { amap: fakeProvider },
    providerFactory: (name, key) => {
      seen.push({ name, key });
      return fakeProvider;
    }
  });

  const created = service.createJob({
    ownerId: 'alice',
    provider: 'amap',
    apiKey: 'user-amap-key',
    items: [{ clientId: 'r1', companyName: '甲有限公司', region: '', strictRegion: false }]
  });
  const job = await waitForServiceJob(service, created.jobId);
  assert.equal(job.status, 'completed');
  assert.deepEqual(seen, [{ name: 'amap', key: 'user-amap-key' }]);
});

test('user baidu key is used by the baidu provider', async () => {
  const seen = [];
  const baiduFake = { ...fakeProvider, name: 'baidu' };
  const service = makeKeyService({
    configOverrides: { provider: 'baidu', baiduAk: 'env-baidu-key' },
    providers: { baidu: baiduFake },
    providerFactory: (name, key) => {
      seen.push({ name, key });
      return baiduFake;
    }
  });

  const created = service.createJob({
    ownerId: 'alice',
    provider: 'baidu',
    apiKey: 'user-baidu-key',
    items: [{ clientId: 'r1', companyName: '甲有限公司', region: '北京市', strictRegion: false }]
  });
  await waitForServiceJob(service, created.jobId);
  assert.deepEqual(seen, [{ name: 'baidu', key: 'user-baidu-key' }]);
});

test('no user key falls back to the server-configured provider', async () => {
  let factoryCalls = 0;
  const service = makeKeyService({
    configOverrides: { amapKey: 'env-amap-key' },
    providers: { amap: fakeProvider },
    providerFactory: () => {
      factoryCalls += 1;
      return fakeProvider;
    }
  });

  const created = service.createJob({
    ownerId: 'alice',
    provider: 'amap',
    items: [{ clientId: 'r1', companyName: '甲有限公司', region: '', strictRegion: false }]
  });
  const job = await waitForServiceJob(service, created.jobId);
  assert.equal(job.status, 'completed');
  assert.equal(factoryCalls, 0);
});

test('no user key and no server key returns MAP_API_KEY_REQUIRED without echoing a key', () => {
  const service = new CompanyMapLookupService({
    config: config({ amapKey: '', baiduAk: '' }),
    providers: {}
  });
  assert.throws(
    () => service.createJob({
      ownerId: 'alice',
      provider: 'amap',
      items: [{ clientId: 'r1', companyName: '甲有限公司', region: '', strictRegion: false }]
    }),
    (error) => {
      assert.equal(error.code, 'MAP_API_KEY_REQUIRED');
      assert.equal(error.message, '请输入地图 API Key 后再开始查询。');
      return true;
    }
  );
});

test('provider validate succeeds without creating a job', async () => {
  let searches = 0;
  const validatingProvider = {
    ...fakeProvider,
    async search(input) {
      searches += 1;
      return fakeProvider.search(input);
    }
  };
  const service = makeKeyService({
    providerFactory: () => validatingProvider
  });

  await withApp(service, async (localRequest) => {
    const validation = await localRequest('/api/company-map-lookup/provider/validate', {
      method: 'POST',
      body: { provider: 'amap', apiKey: 'user-validate-key' }
    });
    assert.equal(validation.status, 200);
    assert.equal(validation.body.ok, true);
    assert.equal(validation.body.provider, 'amap');
    assert.equal(validation.body.data.reachable, true);
    assert.equal(searches, 1);
    assert.equal(service.jobStore.jobs.size, 0);
    assert.doesNotMatch(JSON.stringify(validation.body), /user-validate-key/);
  });
});

test('provider validate maps an invalid provider key to MAP_API_KEY_INVALID', async () => {
  const service = makeKeyService({
    providerFactory: () => ({
      name: 'amap',
      isConfigured: () => true,
      async search() {
        throw new ProviderError('MAP_PROVIDER_REJECTED', 'invalid key', 502, { providerCode: '10001' });
      }
    })
  });

  await withApp(service, async (localRequest) => {
    const validation = await localRequest('/api/company-map-lookup/provider/validate', {
      method: 'POST',
      body: { provider: 'amap', apiKey: 'bad-user-key' }
    });
    assert.equal(validation.status, 400);
    assert.equal(validation.body.ok, false);
    assert.equal(validation.body.provider, 'amap');
    assert.equal(validation.body.error.code, 'MAP_API_KEY_INVALID');
    assert.doesNotMatch(JSON.stringify(validation.body), /bad-user-key/);
  });
});

test('provider validate requires auth and same-origin protection', async () => {
  const service = makeKeyService({ providerFactory: () => fakeProvider });

  await withApp(service, async (localRequest) => {
    const unauthenticated = await localRequest('/api/company-map-lookup/provider/validate', {
      method: 'POST',
      user: '',
      body: { provider: 'amap', apiKey: 'user-key' }
    });
    assert.equal(unauthenticated.status, 401);

    const crossOrigin = await localRequest('/api/company-map-lookup/provider/validate', {
      method: 'POST',
      body: { provider: 'amap', apiKey: 'user-key' },
      origin: 'http://evil.example'
    });
    assert.equal(crossOrigin.status, 403);
  });
});

test('job responses, cancel and job store never expose the user key', async () => {
  const service = makeKeyService({
    providerFactory: () => fakeProvider
  });

  await withApp(service, async (localRequest) => {
    const created = await localRequest('/api/company-map-lookup/jobs', {
      method: 'POST',
      body: {
        provider: 'amap',
        apiKey: 'secret-user-key-123',
        items: [{ clientId: 'r1', companyName: '华鑫科技' }]
      }
    });
    assert.equal(created.status, 202);
    assert.doesNotMatch(JSON.stringify(created.body), /secret-user-key-123/);
    const jobId = created.body.data.jobId;

    const job = await localRequest(`/api/company-map-lookup/jobs/${jobId}`);
    const results = await localRequest(`/api/company-map-lookup/jobs/${jobId}/results`);
    const cancelled = await localRequest(`/api/company-map-lookup/jobs/${jobId}/cancel`, { method: 'POST', body: {} });

    for (const payload of [job.body, results.body, cancelled.body]) {
      assert.doesNotMatch(JSON.stringify(payload), /secret-user-key-123/);
    }
    assert.doesNotMatch(JSON.stringify([...service.jobStore.jobs.values()]), /secret-user-key-123/);
  });
});

test('provider errors never echo the user key in results or logs', async () => {
  const service = makeKeyService({
    providerFactory: (name, key) => ({
      name,
      isConfigured: () => true,
      async search() {
        throw new Error(`upstream exploded with key=${key}`);
      }
    })
  });

  const captured = [];
  const methods = ['log', 'error', 'warn', 'info'];
  const originals = {};
  methods.forEach((method) => {
    originals[method] = console[method];
    console[method] = (...args) => { captured.push(args.map(String).join(' ')); };
  });

  try {
    await withApp(service, async (localRequest) => {
      const created = await localRequest('/api/company-map-lookup/jobs', {
        method: 'POST',
        body: {
          provider: 'amap',
          apiKey: 'leak-check-key',
          items: [{ clientId: 'r1', companyName: '甲有限公司' }]
        }
      });
      const jobId = created.body.data.jobId;
      let job = null;
      for (let i = 0; i < 50; i += 1) {
        const response = await localRequest(`/api/company-map-lookup/jobs/${jobId}`);
        job = response.body.data;
        if (job.status === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(job.status, 'completed');
      assert.equal(job.counts.error, 1);

      const results = await localRequest(`/api/company-map-lookup/jobs/${jobId}/results`);
      assert.doesNotMatch(JSON.stringify(results.body), /leak-check-key/);
      assert.doesNotMatch(captured.join('\n'), /leak-check-key/);
    });
  } finally {
    methods.forEach((method) => { console[method] = originals[method]; });
  }
});

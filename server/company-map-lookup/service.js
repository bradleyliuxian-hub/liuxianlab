'use strict';

const { AppError } = require('./errors');
const { TtlMemoryCache } = require('./cache');
const { mapLimit } = require('./queue');
const { classifyMatch, normalizeText } = require('./matching');
const { MemoryJobStore } = require('./job-store');
const { AmapProvider } = require('./providers/amap');
const { BaiduProvider } = require('./providers/baidu');
const { translateProviderError } = require('./provider-errors');

class CompanyMapLookupService {
  constructor({ config, providers, cache, jobStore, providerFactory } = {}) {
    if (!config) throw new Error('config is required');
    this.config = config;
    this.providerFactory = typeof providerFactory === 'function' ? providerFactory : null;
    this.cache = cache || new TtlMemoryCache({ ttlMs: config.cacheTtlMs });
    this.jobStore = jobStore || new MemoryJobStore({ ttlMs: config.jobTtlMs });
    this.providers = providers || {
      amap: new AmapProvider({
        key: config.amapKey,
        timeoutMs: config.requestTimeoutMs,
        candidateLimit: config.candidateLimit,
      }),
      baidu: new BaiduProvider({
        ak: config.baiduAk,
        timeoutMs: config.requestTimeoutMs,
        candidateLimit: config.candidateLimit,
      }),
    };
  }

  meta() {
    return {
      providerMode: this.config.provider,
      defaultProvider: this.config.provider === 'baidu' ? 'baidu' : 'amap',
      userKeySupported: true,
      configuredProviders: Object.values(this.providers)
        .filter((provider) => provider && typeof provider.isConfigured === 'function' && provider.isConfigured())
        .map((provider) => provider.name),
      coordinateSystem: 'GCJ-02',
      maxBatchSize: this.config.maxBatchSize,
      concurrency: this.config.concurrency,
      matching: {
        autoAcceptThreshold: this.config.autoAcceptThreshold,
        reviewThreshold: this.config.reviewThreshold,
      },
      persistence: 'memory',
    };
  }

  createProvider(name, key) {
    if (this.providerFactory) return this.providerFactory(name, key);
    if (name === 'amap') {
      return new AmapProvider({
        key,
        timeoutMs: this.config.requestTimeoutMs,
        candidateLimit: this.config.candidateLimit,
      });
    }
    if (name === 'baidu') {
      return new BaiduProvider({
        ak: key,
        timeoutMs: this.config.requestTimeoutMs,
        candidateLimit: this.config.candidateLimit,
      });
    }
    throw new AppError('MAP_PROVIDER_INVALID', '未知的地图 Provider。', 400);
  }

  resolveProvider({ provider = '', apiKey = '' } = {}) {
    const userKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const name = this.normalizeRequestedProvider(provider, userKey);
    const envKey = name === 'amap' ? this.config.amapKey : this.config.baiduAk;
    const key = userKey || envKey;
    if (!key) {
      throw new AppError('MAP_API_KEY_REQUIRED', '请输入地图 API Key 后再开始查询。', 400);
    }

    if (userKey) {
      return { name, provider: this.createProvider(name, userKey), usesUserKey: true };
    }

    const configured = this.providers[name];
    if (configured && typeof configured.isConfigured === 'function' && configured.isConfigured()) {
      return { name, provider: configured, usesUserKey: false };
    }
    return { name, provider: this.createProvider(name, key), usesUserKey: false };
  }

  normalizeRequestedProvider(provider, userKey = '') {
    const requested = String(provider || '').trim().toLowerCase();
    if (requested === 'amap' || requested === 'baidu') return requested;

    const mode = this.config.provider;
    if (mode === 'amap' || mode === 'baidu') return mode;

    if (userKey) return 'amap';
    const amap = this.providers.amap;
    if (amap && typeof amap.isConfigured === 'function' && amap.isConfigured()) return 'amap';
    const baidu = this.providers.baidu;
    if (baidu && typeof baidu.isConfigured === 'function' && baidu.isConfigured()) return 'baidu';
    return 'amap';
  }

  selectProvider(input) {
    return this.resolveProvider({ provider: this.config.provider }).provider;
  }

  cacheKey(provider, input) {
    return [provider.name, normalizeText(input.companyName), normalizeText(input.region), input.strictRegion ? '1' : '0'].join('|');
  }

  async searchOne(input, providerOverride = null) {
    const provider = providerOverride || this.resolveProvider({}).provider;
    const key = this.cacheKey(provider, input);
    let candidates = this.cache.get(key);
    let cached = true;
    if (!candidates) {
      cached = false;
      candidates = await provider.search(input);
      this.cache.set(key, candidates);
    }

    const classified = classifyMatch(input, candidates, this.config);
    return {
      input,
      provider: provider.name,
      cached,
      coordinateSystem: 'GCJ-02',
      ...classified,
    };
  }

  async validateProvider({ provider = '', apiKey = '' } = {}) {
    const resolved = this.resolveProvider({ provider, apiKey });
    const input = {
      clientId: 'provider-validate',
      companyName: '北京大学',
      region: resolved.name === 'baidu' ? '北京市' : '',
      strictRegion: false,
    };
    try {
      const candidates = await resolved.provider.search(input);
      return {
        provider: resolved.name,
        reachable: true,
        resultCount: Array.isArray(candidates) ? candidates.length : 0,
      };
    } catch (error) {
      const translated = translateProviderError(error, resolved.name);
      if (translated instanceof AppError) throw translated;
      throw new AppError('MAP_API_PROVIDER_ERROR', '地图服务暂时不可用，请稍后重试。', 502);
    }
  }

  createJob({ ownerId, items, provider = '', apiKey = '' }) {
    const resolved = this.resolveProvider({ provider, apiKey });
    const job = this.jobStore.create({ ownerId, items, provider: resolved.name });
    queueMicrotask(() => {
      this.runJob(job.id, ownerId, resolved).catch(() => {
        // Item-level errors are recorded inside the job. This catch only prevents an unhandled rejection.
      });
    });
    return this.toJobSummary(job);
  }

  async runJob(jobId, ownerId, resolvedProvider) {
    const job = this.jobStore.getOwned(jobId, ownerId);
    if (job.status !== 'queued') return;
    const resolved = resolvedProvider || this.resolveProvider({ provider: job.provider || '' });
    job.status = 'running';
    this.jobStore.touch(job);

    await mapLimit(job.items, this.config.concurrency, async (item) => {
      if (job.cancelRequested) {
        item.status = 'cancelled';
        job.counts.cancelled += 1;
        job.processed += 1;
        this.jobStore.touch(job);
        return;
      }

      item.status = 'searching';
      this.jobStore.touch(job);
      try {
        const result = await this.searchOne(item.input, resolved.provider);
        item.status = result.status;
        item.match = result.match;
        item.candidates = result.candidates;
        item.confidence = result.confidence;
        item.provider = result.provider;
        item.cached = result.cached;
        job.counts[result.status] += 1;
      } catch (error) {
        const normalized = translateProviderError(error, resolved.name);
        const safe = normalized instanceof AppError ? normalized : null;
        const fallbackCode = error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.code)
          ? error.code
          : 'LOOKUP_FAILED';
        item.status = 'error';
        item.error = {
          code: safe && safe.code ? safe.code : fallbackCode,
          message: safe && safe.message ? safe.message : '查询失败。',
        };
        job.counts.error += 1;
      } finally {
        job.processed += 1;
        this.jobStore.touch(job);
      }
    });

    job.status = job.cancelRequested ? 'cancelled' : 'completed';
    job.completedAt = new Date().toISOString();
    this.jobStore.touch(job);
  }

  getJob({ jobId, ownerId }) {
    return this.toJobSummary(this.jobStore.getOwned(jobId, ownerId));
  }

  getResults({ jobId, ownerId, offset = 0, limit = 100, status = '', q = '' }) {
    const job = this.jobStore.getOwned(jobId, ownerId);
    const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
    const allowed = ['queued', 'searching', 'matched', 'review', 'not_found', 'error', 'cancelled'];
    const filter = allowed.includes(String(status)) ? String(status) : '';
    const query = String(q || '').trim().toLowerCase().slice(0, 100);
    let items = filter ? job.items.filter((item) => item.status === filter) : job.items;
    if (query) {
      items = items.filter((item) => {
        const haystack = [
          item.input.companyName,
          item.input.region,
          item.match && item.match.name,
          item.match && item.match.address,
          item.match && item.match.poiId,
          item.provider,
          ...(item.candidates || []).flatMap((candidate) => [candidate.name, candidate.address, candidate.poiId])
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }
    return {
      job: this.toJobSummary(job),
      offset: safeOffset,
      limit: safeLimit,
      total: items.length,
      status: filter,
      q: query,
      items: items.slice(safeOffset, safeOffset + safeLimit).map((item) => this.toPublicItem(item)),
    };
  }

  cancelJob({ jobId, ownerId }) {
    const job = this.jobStore.getOwned(jobId, ownerId);
    if (['completed', 'cancelled'].includes(job.status)) return this.toJobSummary(job);
    job.cancelRequested = true;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      for (const item of job.items) {
        if (item.status !== 'queued') continue;
        item.status = 'cancelled';
        job.counts.cancelled += 1;
        job.processed += 1;
      }
    }
    this.jobStore.touch(job);
    return this.toJobSummary(job);
  }

  resolveItem({ jobId, itemId, ownerId, poiId }) {
    const job = this.jobStore.getOwned(jobId, ownerId);
    const item = job.items.find((entry) => entry.itemId === itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '任务条目不存在。', 404);
    const candidate = item.candidates.find((entry) => entry.poiId === poiId);
    if (!candidate) throw new AppError('CANDIDATE_NOT_FOUND', '候选地点不存在。', 404);

    const previousStatus = item.status;
    item.status = 'matched';
    item.match = candidate;
    item.confidence = candidate.matchScore || item.confidence;
    item.selectedByUser = true;
    item.error = null;

    if (job.counts[previousStatus] > 0) job.counts[previousStatus] -= 1;
    job.counts.matched += 1;
    this.jobStore.touch(job);
    return this.toPublicItem(item);
  }

  toJobSummary(job) {
    return {
      jobId: job.id,
      provider: job.provider || null,
      status: job.status,
      cancelRequested: job.cancelRequested,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      total: job.total,
      processed: job.processed,
      counts: { ...job.counts },
    };
  }

  toPublicItem(item) {
    return {
      itemId: item.itemId,
      index: item.index,
      input: item.input,
      status: item.status,
      match: item.match,
      candidates: item.candidates,
      confidence: item.confidence,
      provider: item.provider || null,
      cached: item.cached === true,
      selectedByUser: item.selectedByUser === true,
      error: item.error,
    };
  }
}

module.exports = { CompanyMapLookupService };

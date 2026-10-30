'use strict';

const { ProviderError } = require('./errors');

async function fetchJson(url, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ProviderError('HTTP_CLIENT_UNAVAILABLE', '当前 Node 运行时不支持 fetch。', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        'MAP_PROVIDER_HTTP_ERROR',
        `地图服务返回 HTTP ${response.status}。`,
        502,
        { httpStatus: response.status }
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error && error.name === 'AbortError') {
      throw new ProviderError('MAP_PROVIDER_TIMEOUT', '地图服务请求超时。', 504);
    }
    throw new ProviderError('MAP_PROVIDER_NETWORK_ERROR', '无法连接地图服务。', 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson };

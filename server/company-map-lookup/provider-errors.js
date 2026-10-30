'use strict';

const { AppError, ProviderError } = require('./errors');

const MESSAGES = {
  MAP_API_KEY_REQUIRED: '请输入地图 API Key 后再开始查询。',
  MAP_API_KEY_INVALID: 'API Key 无效或当前账号无法使用地点搜索服务。',
  MAP_API_QUOTA_EXCEEDED: '地图 API 配额或调用频率已达上限，请稍后重试或检查账号配额。',
  MAP_API_FORBIDDEN: '当前 API Key 无权使用地点搜索服务，请检查 Key 的服务与白名单配置。',
  MAP_API_TIMEOUT: '地图服务请求超时，请稍后重试。',
  MAP_API_PROVIDER_ERROR: '地图服务暂时不可用，请稍后重试。'
};

const STATUS = {
  MAP_API_KEY_REQUIRED: 400,
  MAP_API_KEY_INVALID: 400,
  MAP_API_QUOTA_EXCEEDED: 429,
  MAP_API_FORBIDDEN: 403,
  MAP_API_TIMEOUT: 504,
  MAP_API_PROVIDER_ERROR: 502
};

const AMAP_INVALID = new Set(['10001', '10002', '10007', '10008', '10009', '10013']);
const AMAP_QUOTA = new Set(['10003', '10044', '10045']);
const AMAP_FORBIDDEN = new Set(['10005', '10006', '10012', '10014', '10015']);

const BAIDU_INVALID = new Set(['101', '102', '200', '240']);
const BAIDU_QUOTA = new Set(['301', '302', '401']);
const BAIDU_FORBIDDEN = new Set(['403', '404']);

function apiError(code) {
  return new AppError(code, MESSAGES[code] || MESSAGES.MAP_API_PROVIDER_ERROR, STATUS[code] || 502);
}

function translateProviderError(error, providerName) {
  if (!error) return apiError('MAP_API_PROVIDER_ERROR');

  const code = String(error.code || '');
  if (code === 'MAP_API_KEY_REQUIRED') return apiError('MAP_API_KEY_REQUIRED');
  if (code === 'MAP_API_KEY_INVALID' || code === 'MAP_API_QUOTA_EXCEEDED'
    || code === 'MAP_API_FORBIDDEN' || code === 'MAP_API_TIMEOUT'
    || code === 'MAP_API_PROVIDER_ERROR') {
    return apiError(code);
  }

  const providerCode = error.details && error.details.providerCode !== undefined
    ? String(error.details.providerCode)
    : '';

  if (providerCode) {
    const invalid = providerName === 'baidu' ? BAIDU_INVALID : AMAP_INVALID;
    const quota = providerName === 'baidu' ? BAIDU_QUOTA : AMAP_QUOTA;
    const forbidden = providerName === 'baidu' ? BAIDU_FORBIDDEN : AMAP_FORBIDDEN;
    if (invalid.has(providerCode)) return apiError('MAP_API_KEY_INVALID');
    if (quota.has(providerCode)) return apiError('MAP_API_QUOTA_EXCEEDED');
    if (forbidden.has(providerCode)) return apiError('MAP_API_FORBIDDEN');
  }

  if (!(error instanceof ProviderError)) return error;

  if (error.code === 'MAP_PROVIDER_TIMEOUT') return apiError('MAP_API_TIMEOUT');
  if (error.code === 'MAP_PROVIDER_NOT_CONFIGURED') return apiError('MAP_API_KEY_REQUIRED');

  if (error.code === 'MAP_PROVIDER_HTTP_ERROR' && error.details) {
    const httpStatus = Number(error.details.httpStatus);
    if (httpStatus === 401 || httpStatus === 403) return apiError('MAP_API_FORBIDDEN');
    if (httpStatus === 429) return apiError('MAP_API_QUOTA_EXCEEDED');
  }

  return apiError('MAP_API_PROVIDER_ERROR');
}

module.exports = {
  translateProviderError,
  API_ERROR_MESSAGES: MESSAGES
};

'use strict';

const { AppError } = require('./errors');

function requirePlainObject(value, code = 'INVALID_BODY') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(code, '请求体必须是 JSON 对象。', 400);
  }
  return value;
}

function cleanString(value, { field, required = false, maxLength = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new AppError('VALIDATION_ERROR', `${field} 为必填字段。`, 400);
    return '';
  }
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `${field} 必须是字符串。`, 400);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new AppError('VALIDATION_ERROR', `${field} 不能为空。`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new AppError('VALIDATION_ERROR', `${field} 长度不能超过 ${maxLength} 个字符。`, 400);
  }
  return trimmed;
}

const PROVIDER_NAMES = ['amap', 'baidu'];

function validateProviderName(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError('VALIDATION_ERROR', 'provider 为必填字段。', 400);
    return '';
  }
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'provider 必须是字符串。', 400);
  }
  const name = value.trim().toLowerCase();
  if (!PROVIDER_NAMES.includes(name)) {
    throw new AppError('VALIDATION_ERROR', 'provider 必须是 amap 或 baidu。', 400);
  }
  return name;
}

function validateApiKey(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'apiKey 必须是字符串。', 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > 300) {
    throw new AppError('VALIDATION_ERROR', 'apiKey 长度不能超过 300 个字符。', 400);
  }
  return trimmed;
}

function validateProviderKey(body) {
  const obj = requirePlainObject(body);
  return {
    provider: validateProviderName(obj.provider, { required: true }),
    apiKey: validateApiKey(obj.apiKey),
  };
}

function validateSearchInput(body) {
  const obj = requirePlainObject(body);
  return {
    clientId: cleanString(obj.clientId, { field: 'clientId', maxLength: 100 }),
    companyName: cleanString(obj.companyName, { field: 'companyName', required: true, maxLength: 200 }),
    region: cleanString(obj.region, { field: 'region', maxLength: 64 }),
    strictRegion: obj.strictRegion === true,
  };
}

function validateBatchInput(body, maxBatchSize) {
  const obj = requirePlainObject(body);
  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'items 必须是非空数组。', 400);
  }
  if (obj.items.length > maxBatchSize) {
    throw new AppError(
      'BATCH_TOO_LARGE',
      `单批最多允许 ${maxBatchSize} 家公司。`,
      413,
      { maxBatchSize }
    );
  }
  return obj.items.map((item, index) => {
    try {
      return validateSearchInput(item);
    } catch (error) {
      if (error instanceof AppError) {
        error.details = { ...(error.details || {}), itemIndex: index };
      }
      throw error;
    }
  });
}

function validateResolveInput(body) {
  const obj = requirePlainObject(body);
  return {
    poiId: cleanString(obj.poiId, { field: 'poiId', required: true, maxLength: 200 }),
  };
}

function validateJobRequest(body, maxBatchSize) {
  const obj = requirePlainObject(body);
  return {
    provider: validateProviderName(obj.provider),
    apiKey: validateApiKey(obj.apiKey),
    items: validateBatchInput(obj, maxBatchSize),
  };
}

module.exports = {
  validateSearchInput,
  validateBatchInput,
  validateResolveInput,
  validateProviderName,
  validateApiKey,
  validateProviderKey,
  validateJobRequest,
};

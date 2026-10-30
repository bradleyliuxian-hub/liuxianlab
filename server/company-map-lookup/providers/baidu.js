'use strict';

const { fetchJson } = require('../http-client');
const { AppError, ProviderError } = require('../errors');

class BaiduProvider {
  constructor({ ak, timeoutMs, candidateLimit, requestJson = fetchJson }) {
    this.name = 'baidu';
    this.ak = ak;
    this.timeoutMs = timeoutMs;
    this.candidateLimit = Math.min(candidateLimit, 20);
    this.requestJson = requestJson;
  }

  isConfigured() {
    return Boolean(this.ak);
  }

  async search({ companyName, region, strictRegion }) {
    if (!this.ak) throw new ProviderError('MAP_PROVIDER_NOT_CONFIGURED', '百度地图 AK 未配置。', 503);
    if (!region) {
      throw new AppError(
        'REGION_REQUIRED_FOR_BAIDU',
        '百度 Place API V3 行政区检索要求 region；请提供城市/区县，或改用支持全国关键词搜索的 Provider。',
        400
      );
    }

    const params = new URLSearchParams({
      query: companyName,
      region,
      ak: this.ak,
      region_limit: strictRegion ? 'true' : 'false',
      address_result: 'false',
      page_num: '0',
      page_size: String(this.candidateLimit),
      scope: '1',
      ret_coordtype: 'gcj02ll',
      output: 'json',
    });

    const payload = await this.requestJson(`https://api.map.baidu.com/place/v3/region?${params.toString()}`, {
      timeoutMs: this.timeoutMs,
    });

    if (!payload || Number(payload.status) !== 0) {
      throw new ProviderError(
        'MAP_PROVIDER_REJECTED',
        `百度地图查询失败：${payload && payload.message ? payload.message : 'unknown error'}`,
        502,
        { providerCode: payload && payload.status !== undefined ? String(payload.status) : undefined }
      );
    }

    return Array.isArray(payload.results)
      ? payload.results.map((poi) => this.normalizePoi(poi)).filter(Boolean)
      : [];
  }

  normalizePoi(poi) {
    if (!poi || !poi.name || !poi.location) return null;
    const longitude = Number.parseFloat(poi.location.lng);
    const latitude = Number.parseFloat(poi.location.lat);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

    return {
      poiId: String(poi.uid || ''),
      name: String(poi.name || ''),
      address: typeof poi.address === 'string' ? poi.address : '',
      province: typeof poi.province === 'string' ? poi.province : '',
      city: typeof poi.city === 'string' ? poi.city : '',
      district: typeof poi.area === 'string' ? poi.area : '',
      adcode: poi.adcode === undefined || poi.adcode === null ? '' : String(poi.adcode),
      longitude,
      latitude,
      coordinateSystem: 'GCJ-02',
      source: 'baidu',
    };
  }
}

module.exports = { BaiduProvider };

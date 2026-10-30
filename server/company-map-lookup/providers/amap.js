'use strict';

const { fetchJson } = require('../http-client');
const { ProviderError } = require('../errors');

class AmapProvider {
  constructor({ key, timeoutMs, candidateLimit, requestJson = fetchJson }) {
    this.name = 'amap';
    this.key = key;
    this.timeoutMs = timeoutMs;
    this.candidateLimit = Math.min(candidateLimit, 25);
    this.requestJson = requestJson;
  }

  isConfigured() {
    return Boolean(this.key);
  }

  async search({ companyName, region, strictRegion }) {
    if (!this.key) throw new ProviderError('MAP_PROVIDER_NOT_CONFIGURED', '高德 Web 服务 Key 未配置。', 503);

    const params = new URLSearchParams({
      key: this.key,
      keywords: companyName,
      page_size: String(this.candidateLimit),
      page_num: '1',
      output: 'json',
    });
    if (region) {
      params.set('region', region);
      if (strictRegion) params.set('city_limit', 'true');
    }

    const payload = await this.requestJson(`https://restapi.amap.com/v5/place/text?${params.toString()}`, {
      timeoutMs: this.timeoutMs,
    });

    if (!payload || String(payload.status) !== '1') {
      throw new ProviderError(
        'MAP_PROVIDER_REJECTED',
        `高德地图查询失败：${payload && payload.info ? payload.info : 'unknown error'}`,
        502,
        { providerCode: payload && payload.infocode ? String(payload.infocode) : undefined }
      );
    }

    return Array.isArray(payload.pois) ? payload.pois.map((poi) => this.normalizePoi(poi)).filter(Boolean) : [];
  }

  normalizePoi(poi) {
    if (!poi || !poi.name || typeof poi.location !== 'string') return null;
    const [lngRaw, latRaw] = poi.location.split(',');
    const longitude = Number.parseFloat(lngRaw);
    const latitude = Number.parseFloat(latRaw);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

    return {
      poiId: String(poi.id || ''),
      name: String(poi.name || ''),
      address: typeof poi.address === 'string' ? poi.address : '',
      province: typeof poi.pname === 'string' ? poi.pname : '',
      city: typeof poi.cityname === 'string' ? poi.cityname : '',
      district: typeof poi.adname === 'string' ? poi.adname : '',
      adcode: typeof poi.adcode === 'string' ? poi.adcode : '',
      longitude,
      latitude,
      coordinateSystem: 'GCJ-02',
      source: 'amap',
    };
  }
}

module.exports = { AmapProvider };

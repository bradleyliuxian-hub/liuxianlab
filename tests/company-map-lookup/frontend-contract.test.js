'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('tool is registered in config/tools.json and dashboard IA', () => {
  const tools = JSON.parse(read('config/tools.json'));
  const tool = tools.find((entry) => entry.slug === 'company-map-lookup');
  assert.ok(tool, 'company-map-lookup must be registered');
  assert.equal(tool.name, '公司地图地址查询');
  assert.equal(tool.status, 'ready');
  assert.equal(tool.version, 'v1.1.0');
  assert.equal(tool.category, '数据');

  const dashboard = read('private/script.js');
  assert.match(dashboard, /'company-map-lookup':\s*\{\s*fileType:\s*'excel',\s*group:\s*'analysis'\s*\}/);
});

test('server mounts the module behind auth, same-origin and the larger batch parser', () => {
  const server = read('server.js');
  assert.match(server, /createCompanyMapLookupModule/);
  assert.match(
    server,
    /app\.use\('\/api\/company-map-lookup',\s*requireAuth,\s*sameOriginForStateChange,\s*companyMapLookupModule\.router\)/
  );
  assert.match(server, /isCompanyMapLookupBody/);
  assert.match(server, /company-map-lookup\\\/\(search\|jobs\)/);
  assert.match(server, /companyMapLookupModule\.errorHandler/);
  assert.match(server, /req\.originalUrl\.startsWith\('\/api\/'\)/);
});

test('frontend wires the real API, review resolution and export', () => {
  const html = read('private/tools/company-map-lookup/index.html');
  const script = read('private/tools/company-map-lookup/script.js');

  assert.match(html, /id="versionButton"[^>]*>v1\.1\.0</);
  assert.match(html, /\/app\/vendor\/xlsx\/xlsx\.full\.min\.js/);
  assert.match(html, /id="downloadTemplateButton"/);
  assert.match(html, /id="providerSelect"/);
  assert.match(html, /id="providerKey"[^>]*type="password"/);
  assert.match(html, /id="toggleKeyButton"/);
  assert.match(html, /id="validateKeyButton"/);
  assert.match(html, /template\.js\?v=1\.1\.0/);
  assert.match(html, /id="previewValid"/);
  assert.match(html, /id="previewDuplicate"/);
  assert.match(html, /公司地图地址查询/);
  assert.match(script, /const API_BASE = '\/api\/company-map-lookup';/);
  assert.match(script, /\/jobs',\s*\{\s*method:\s*'POST'/);
  assert.match(script, /\/items\/\$\{encodeURIComponent\(state\.reviewItem\.itemId\)\}\/resolve/);
  assert.match(script, /params\.set\('status', state\.filter\)/);
  assert.match(script, /params\.set\('q', state\.q\)/);
  assert.match(script, /XLSX\.writeFile/);
  assert.match(script, /sheet_to_csv/);
  assert.match(script, /原始公司名称/);
  assert.match(script, /是否人工确认/);
  assert.match(script, /VERSION_NOTES/);
  assert.match(script, /memory/);
  assert.match(script, /\/provider\/validate/);
  assert.match(script, /body\.apiKey = apiKey/);
  assert.match(script, /planDedupe/);
  assert.match(script, /expandExportItems/);
  assert.match(script, /CompanyMapTemplate\.buildWorkbook/);
});

test('frontend does not expose provider keys or add a public entry point', () => {
  const frontend = read('private/tools/company-map-lookup/index.html')
    + read('private/tools/company-map-lookup/script.js');
  assert.doesNotMatch(frontend, /AMAP_WEB_SERVICE_KEY\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(frontend, /BAIDU_MAP_AK\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(frontend, /restapi\.amap\.com/);
  assert.doesNotMatch(frontend, /api\.map\.baidu\.com/);
  const script = read('private/tools/company-map-lookup/script.js');
  assert.doesNotMatch(frontend, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(script, /'API Key'/);
});

test('matching keeps review distinct from matched', () => {
  const matching = read('server/company-map-lookup/matching.js');
  assert.match(matching, /status: 'review'/);
  assert.match(matching, /status: 'not_found'/);
  assert.match(matching, /regionMatches/);
});

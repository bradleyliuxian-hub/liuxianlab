'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..');
const { CompanyMapLookupService } = require(path.join(ROOT, 'server', 'company-map-lookup', 'service.js'));
const {
  createCompanyMapLookupRouter,
  companyMapLookupErrorHandler
} = require(path.join(ROOT, 'server', 'company-map-lookup', 'routes.js'));
const XLSX = require(path.join(ROOT, 'private', 'vendor', 'xlsx', 'xlsx.full.min.js'));

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'company-map-e2e-'));
const DOWNLOAD_DIR = path.join(TEMP, 'downloads');
const TEMPLATE_DIR = path.join(TEMP, 'template-downloads');
const DEDUPE_DIR = path.join(TEMP, 'dedupe-downloads');
const XLSX_PATH = path.join(TEMP, 'company-map-input.xlsx');
const TEMPLATE_INPUT_PATH = path.join(TEMP, 'company-map-template-input.xlsx');
const CSV_PATH = path.join(TEMP, 'company-map-input.csv');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
fs.mkdirSync(DEDUPE_DIR, { recursive: true });

let server;
let base;
let browser;
let page;
let jobCreateCount = 0;
const errors = [];
const providerKeys = [];

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

function writeFixture() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['公司名称', '城市'],
    ['丙有限公司', '上海市'],
    ['丁有限公司', '']
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '公司名单');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
  fs.writeFileSync(XLSX_PATH, buffer);
  fs.writeFileSync(CSV_PATH, '\ufeff公司名称,城市\n己有限公司,上海市\n庚有限公司,\n', 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDownload(extension, directory = DOWNLOAD_DIR) {
  let lastSize = -1;
  for (let i = 0; i < 100; i += 1) {
    const files = fs.readdirSync(directory).filter((name) => name.endsWith(extension));
    if (files.length) {
      const fullPath = path.join(directory, files[0]);
      const size = fs.statSync(fullPath).size;
      if (size > 0 && size === lastSize) return fullPath;
      lastSize = size;
    }
    await sleep(100);
  }
  throw new Error(`${extension} download did not produce a file`);
}

test.before(async () => {
  writeFixture();
  const service = new CompanyMapLookupService({
    config: {
      provider: 'amap',
      amapKey: 'test-key',
      baiduAk: '',
      requestTimeoutMs: 1000,
      concurrency: 2,
      maxBatchSize: 500,
      candidateLimit: 10,
      returnedCandidateLimit: 5,
      cacheTtlMs: 60000,
      jobTtlMs: 60000,
      autoAcceptThreshold: 0.94,
      reviewThreshold: 0.66
    },
    providers: { amap: fakeProvider },
    providerFactory: (name, key) => {
      providerKeys.push({ name, key });
      return fakeProvider;
    }
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/session', (_req, res) => res.json({ ok: true, user: { username: 'e2e' } }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === '/api/company-map-lookup/jobs') jobCreateCount += 1;
    next();
  });
  app.use('/api/company-map-lookup', createCompanyMapLookupRouter({
    express,
    service,
    requireAuth: (_req, _res, next) => next(),
    sameOrigin: (_req, _res, next) => next(),
    getOwnerId: () => 'e2e'
  }));
  app.use(companyMapLookupErrorHandler);
  app.use('/design-tokens.css', express.static(path.join(ROOT, 'public', 'design-tokens.css')));
  app.use('/app', express.static(path.join(ROOT, 'private')));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  if (!CHROME) return;
  const puppeteer = require('puppeteer-core');
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 1000 },
    protocolTimeout: 120000
  });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(TEMP, { recursive: true, force: true });
});

test('frontend CSV import maps company and region columns', { skip: !CHROME }, async () => {
  const pageCsv = await browser.newPage();
  const csvErrors = [];
  pageCsv.on('pageerror', (error) => csvErrors.push(`pageerror: ${error.message}`));
  pageCsv.on('console', (message) => {
    if (message.type() === 'error') csvErrors.push(`console: ${message.text()}`);
  });
  await pageCsv.goto(`${base}/app/tools/company-map-lookup/index.html`, { waitUntil: 'networkidle0' });
  await pageCsv.waitForFunction(() => document.querySelector('#providerStatus')?.textContent.includes('已配置'));
  const input = await pageCsv.$('#fileInput');
  await input.uploadFile(CSV_PATH);
  await pageCsv.waitForSelector('#mappingPanel:not([hidden])', { visible: true, timeout: 10000 });
  await pageCsv.waitForFunction(() => document.querySelector('#mappedCount')?.textContent.trim() === '2');
  await pageCsv.click('#importFileButton');
  await pageCsv.waitForFunction(() => document.querySelector('#inputCountChip')?.textContent.trim() === '2 家');
  assert.equal(csvErrors.length, 0, csvErrors.join('\n'));
  await pageCsv.close();
});

test('template download produces a valid XLSX and the template can be re-uploaded', { skip: !CHROME }, async () => {
  const templatePage = await browser.newPage();
  const client = await templatePage.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: TEMPLATE_DIR });
  await templatePage.goto(`${base}/app/tools/company-map-lookup/index.html`, { waitUntil: 'networkidle0' });
  await templatePage.waitForFunction(() => document.querySelector('#providerStatus')?.textContent.includes('已配置'));

  assert.equal(await templatePage.$eval('#providerKey', (input) => input.type), 'password');
  await templatePage.click('#downloadTemplateButton');
  const templatePath = await waitForDownload('.xlsx', TEMPLATE_DIR);
  const workbook = XLSX.read(fs.readFileSync(templatePath), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['公司名单', '填写说明']);
  const headers = XLSX.utils.sheet_to_json(workbook.Sheets['公司名单'], { header: 1 })[0];
  assert.deepEqual(headers, ['公司名称', '城市/地区（可选）']);
  fs.unlinkSync(templatePath);

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['公司名单'], { header: 1 });
  rows.push(['辛有限公司', '上海市'], ['壬有限公司', '']);
  const filled = XLSX.utils.aoa_to_sheet(rows);
  filled['!cols'] = [{ wch: 36 }, { wch: 22 }];
  workbook.Sheets['公司名单'] = filled;
  fs.writeFileSync(TEMPLATE_INPUT_PATH, XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true }));

  const input = await templatePage.$('#fileInput');
  await input.uploadFile(TEMPLATE_INPUT_PATH);
  await templatePage.waitForSelector('#mappingPanel:not([hidden])', { visible: true, timeout: 10000 });
  await templatePage.waitForFunction(() => document.querySelector('#mappedCount')?.textContent.trim() === '2');
  await templatePage.waitForFunction(() => document.querySelector('#previewValid')?.textContent.trim() === '2');
  await templatePage.click('#importFileButton');
  await templatePage.waitForFunction(() => document.querySelector('#inputCountChip')?.textContent.trim() === '2 家');
  await templatePage.close();
});

test('duplicate company rows are queried once and exported row-by-row', { skip: !CHROME }, async () => {
  const jobsBefore = jobCreateCount;
  const dedupePage = await browser.newPage();
  const client = await dedupePage.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DEDUPE_DIR });
  await dedupePage.goto(`${base}/app/tools/company-map-lookup/index.html`, { waitUntil: 'networkidle0' });
  await dedupePage.waitForFunction(() => document.querySelector('#providerStatus')?.textContent.includes('已配置'));

  await dedupePage.$eval('#companyText', (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, '癸有限公司 | 上海市\n癸有限公司 | 上海市\n子有限公司 | 上海市');
  await dedupePage.waitForFunction(() => document.querySelector('#itemCount')?.textContent === '3');
  await dedupePage.waitForFunction(() => document.querySelector('#duplicateCount')?.textContent === '1');
  await dedupePage.click('#startButton');
  await dedupePage.waitForFunction(() => document.querySelector('#progressValue')?.textContent.trim() === '2 / 2', { timeout: 15000 });
  await dedupePage.waitForFunction(() => {
    const button = document.querySelector('#exportCsvButton');
    return button && !button.disabled;
  }, { timeout: 15000 });
  assert.equal(jobCreateCount, jobsBefore + 1);

  await dedupePage.click('#exportCsvButton');
  const csvPath = await waitForDownload('.csv', DEDUPE_DIR);
  const csv = fs.readFileSync(csvPath, 'utf8');
  const dataRows = csv.split(/\r?\n/).slice(1).filter(Boolean);
  assert.equal(dataRows.length, 3);
  assert.equal(dataRows.filter((line) => line.startsWith('癸有限公司,')).length, 2);
  assert.match(csv, /子有限公司/);
  fs.unlinkSync(csvPath);
  await dedupePage.close();
});

test('frontend event chain: import, job, review resolution, filters, search and CSV/XLSX export', { skip: !CHROME }, async () => {
  const puppeteer = require('puppeteer-core');
  jobCreateCount = 0;
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });

  await page.goto(`${base}/app/tools/company-map-lookup/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const text = document.querySelector('#providerStatus')?.textContent || '';
    return text.includes('已配置');
  }, { timeout: 10000 });

  assert.equal(await page.$eval('#providerKey', (input) => input.type), 'password');
  await page.$eval('#providerKey', (input) => {
    input.value = 'e2e-user-key';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#toggleKeyButton');
  assert.equal(await page.$eval('#providerKey', (input) => input.type), 'text');
  assert.equal(await page.$eval('#toggleKeyButton', (button) => button.textContent.trim()), '隐藏');
  await page.click('#toggleKeyButton');
  assert.equal(await page.$eval('#providerKey', (input) => input.type), 'password');
  await page.click('#validateKeyButton');
  await page.waitForFunction(() => document.querySelector('#keyStatus')?.textContent.includes('API 可用'), { timeout: 10000 });
  assert.ok(providerKeys.some((entry) => entry.name === 'amap' && entry.key === 'e2e-user-key'));

  const input = await page.$('#fileInput');
  assert.ok(input, 'file input exists');
  await input.uploadFile(XLSX_PATH);
  await page.waitForSelector('#mappingPanel:not([hidden])', { visible: true, timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#mappedCount')?.textContent.trim() === '2');

  await page.click('#importFileButton');
  await page.waitForFunction(() => document.querySelector('#inputCountChip')?.textContent.trim() === '2 家');
  await page.$eval('#companyText', (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, '戊有限公司\n华鑫科技\n无结果公司');
  await page.waitForFunction(() => document.querySelector('#itemCount')?.textContent === '5');
  await page.click('#startButton');

  await page.waitForSelector('#progressPanel:not([hidden])', { visible: true, timeout: 10000 });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#resultBody tr')];
    return rows.length === 5 && !document.querySelector('#resultBody .empty-state');
  }, { timeout: 15000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('#exportCsvButton');
    return button && !button.disabled;
  }, { timeout: 15000 });
  assert.equal(jobCreateCount, 1, 'exactly one job must be created (validation must not create one)');

  const statuses = await page.$$eval('#resultBody tr', (rows) =>
    rows.map((row) => row.querySelector('.status-badge')?.textContent.trim())
  );
  assert.deepEqual(statuses.sort(), ['已匹配', '已匹配', '已匹配', '待确认', '未找到'].sort());
  assert.equal(errors.length, 0, errors.join('\n'));

  const storage = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
    cookie: document.cookie,
    text: document.body.innerText
  }));
  assert.equal(storage.local, 0);
  assert.equal(storage.session, 0);
  assert.doesNotMatch(storage.cookie, /e2e-user-key/);
  assert.doesNotMatch(storage.text, /e2e-user-key/);

  await page.click('[data-filter="review"]');
  await page.waitForFunction(() => document.querySelectorAll('#resultBody tr').length === 1);
  await page.click('#resultBody [data-action="review"]');
  await page.waitForSelector('#candidateDrawer:not([hidden])', { visible: true, timeout: 5000 });
  await page.click('.candidate-card');
  await page.waitForFunction(() => {
    const button = document.querySelector('#confirmCandidateButton');
    return button && !button.disabled;
  });
  await page.click('#confirmCandidateButton');
  await page.waitForFunction(() => document.querySelector('#candidateDrawer')?.hidden === true, { timeout: 10000 });
  await page.waitForFunction(() => {
    const body = document.querySelector('#resultBody');
    return body && body.textContent.includes('当前筛选没有记录');
  }, { timeout: 10000 });

  await page.click('[data-filter="all"]');
  await page.waitForFunction(() => document.querySelectorAll('#resultBody tr').length === 5);
  const resolvedStatus = await page.$$eval('#resultBody tr', (rows) => {
    const row = rows.find((entry) => entry.textContent.includes('华鑫科技'));
    return row?.querySelector('.status-badge')?.textContent.trim();
  });
  assert.equal(resolvedStatus, '已匹配');

  await page.$eval('#resultSearch', (element) => {
    element.value = '华鑫';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('#resultBody tr').length === 1, { timeout: 5000 });
  await page.$eval('#resultSearch', (element) => {
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('#resultBody tr').length === 5, { timeout: 5000 });

  await page.click('#exportCsvButton');
  const csvPath = await waitForDownload('.csv');
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.match(csv, /原始公司名称/);
  assert.match(csv, /华鑫科技/);
  assert.match(csv, /GCJ-02/);
  assert.match(csv, /已匹配/);
  assert.doesNotMatch(csv, /e2e-user-key/);

  await page.click('#exportXlsxButton');
  const xlsxPath = await waitForDownload('.xlsx');
  const exported = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
  assert.ok(exported.SheetNames.includes('地图地址结果'));
  assert.ok(exported.SheetNames.includes('导出说明'));
  const exportedRows = XLSX.utils.sheet_to_json(exported.Sheets['地图地址结果'], { header: 1 });
  assert.equal(exportedRows[0][0], '原始公司名称');
  assert.ok(exportedRows.some((row) => row.includes('华鑫科技')));
  assert.doesNotMatch(JSON.stringify(exportedRows), /e2e-user-key/);

  await page.click('#newJobButton');
  await page.waitForFunction(() => {
    return !document.querySelector('#inputPanel')?.hidden
      && document.querySelector('#resultPanel')?.hidden
      && document.querySelector('#itemCount')?.textContent === '0';
  }, { timeout: 5000 });
  assert.equal(await page.$eval('#providerKey', (input) => input.value), '');
  assert.equal(await page.$eval('#providerKey', (input) => input.type), 'password');

  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert.ok(overflow.scrollWidth <= overflow.clientWidth, JSON.stringify(overflow));

  await page.click('#footerVersionButton');
  await page.waitForSelector('#versionDialog:not([hidden])', { visible: true, timeout: 5000 });
  await page.click('#closeVersionButton');
  await page.waitForFunction(() => document.querySelector('#versionDialog')?.hidden === true);
  assert.equal(errors.length, 0, errors.join('\n'));

  await page.close();
});

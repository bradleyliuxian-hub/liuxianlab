'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'private', 'tools', 'flowchart-excel');
const HTML = fs.readFileSync(path.join(TOOL, 'index.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(TOOL, 'script.js'), 'utf8');
const CSS = fs.readFileSync(path.join(TOOL, 'styles.css'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'private', 'script.js'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'tools.json'), 'utf8'));

test('flowchart tool is registered with the expected card fields', () => {
  const tool = CONFIG.find((item) => item.slug === 'flowchart-excel');
  assert.ok(tool);
  assert.equal(tool.name, '流程图转 Excel');
  assert.equal(tool.category, '数据');
  assert.equal(tool.status, 'coming-soon');
  assert.match(tool.version, /^v/);
  assert.ok(tool.keywords.includes('flowchart'));
  assert.equal(CONFIG.filter((item) => item.slug === 'flowchart-excel').length, 1);
});

test('dashboard maps the tool into the Excel library', () => {
  assert.match(DASHBOARD, /'flowchart-excel':\s*\{\s*fileType:\s*'excel',\s*group:\s*'analysis'\s*\}/);
});

test('page is marked Coming Soon and the legacy write UI is hidden', () => {
  assert.match(HTML, /Coming Soon/);
  assert.match(HTML, /功能暂未开放，当前版本正在封存评估中/);
  assert.match(HTML, /此前的导出结果仅为实验产物，不代表正式交付能力/);
  assert.match(HTML, /id="uploadPanel" hidden/);
  assert.match(HTML, /id="historyPanel" hidden/);
  assert.match(HTML, /id="newJobButton"[^>]*hidden[^>]*disabled/);
  assert.match(HTML, /id="uploadButton"[^>]*disabled[^>]*>Coming Soon</);
  assert.match(SCRIPT, /const COMING_SOON = true/);
  assert.match(SCRIPT, /els\.uploadButton\.textContent = 'Coming Soon'/);
});

test('page has both required upload fields and result regions', () => {
  assert.match(HTML, /id="imageInput"[\s\S]*?accept="[^"]*\.png/);
  assert.match(HTML, /id="packageInput"[\s\S]*?accept="[^"]*\.zip/);
  assert.match(HTML, /id="uploadButton"/);
  assert.match(HTML, /id="jobPanel"/);
  assert.match(HTML, /id="artifactList"/);
  assert.match(HTML, /id="historyList"/);
  assert.match(HTML, /id="validationSummary"/);
  assert.match(HTML, /trade_purchase_cn/);
});

test('page discloses no website AI, no XLSX and external helper flow', () => {
  assert.match(HTML, /本网站不调用 AI/);
  assert.match(HTML, /不生成 XLSX/);
  assert.match(HTML, /external_ai/);
});

test('multipart field names match the backend exactly', () => {
  assert.match(SCRIPT, /form\.append\('image'/);
  assert.match(SCRIPT, /form\.append\('package'/);
  assert.match(SCRIPT, /form\.append\('generationMode', 'external_ai'\)/);
  assert.match(SCRIPT, /\/jobs\/import-helper-package/);
});

test('client uses same-origin requests and artifact IDs only', () => {
  assert.match(SCRIPT, /credentials: 'same-origin'/);
  assert.match(SCRIPT, /\/artifacts\/\$\{encodeURIComponent\(artifact\.id\)\}/);
  assert.doesNotMatch(SCRIPT, /artifact\.path|artifactPath\s*=/);
  assert.match(SCRIPT, /function stopPolling/);
  assert.match(SCRIPT, /TERMINAL/);
});

test('local preview uses object URLs and revokes them', () => {
  assert.match(SCRIPT, /URL\.createObjectURL/);
  assert.match(SCRIPT, /URL\.revokeObjectURL/);
  assert.match(SCRIPT, /beforeunload/);
});

test('no model endpoint, key, local storage, or unsafe dynamic HTML', () => {
  assert.doesNotMatch(SCRIPT, /FLOWCHART_|api\.openai\.com|Authorization|api[_-]?key/i);
  assert.doesNotMatch(SCRIPT, /localStorage|sessionStorage/);
  assert.doesNotMatch(SCRIPT, /innerHTML/);
  assert.doesNotMatch(HTML, /xlsx\.full|exceljs|SheetJS/i);
  assert.match(CSS, /@media/);
});

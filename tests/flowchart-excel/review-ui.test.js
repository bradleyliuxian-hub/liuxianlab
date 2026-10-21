'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'private', 'tools', 'flowchart-excel');
const HTML = fs.readFileSync(path.join(TOOL, 'review.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(TOOL, 'review.js'), 'utf8');
const CSS = fs.readFileSync(path.join(TOOL, 'review.css'), 'utf8');
const UPLOAD_HTML = fs.readFileSync(path.join(TOOL, 'index.html'), 'utf8');
const UPLOAD_JS = fs.readFileSync(path.join(TOOL, 'script.js'), 'utf8');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'tools.json'), 'utf8'));

test('review workbench is registered in the tool version and upload page', () => {
  const tool = CONFIG.find((item) => item.slug === 'flowchart-excel');
  assert.equal(tool.version, 'v0.2.2');
  assert.match(UPLOAD_HTML, /v0\.2\.2/);
  assert.match(UPLOAD_HTML, /reviewAction/);
  assert.match(UPLOAD_JS, /review\.html\?job=/);
  assert.match(UPLOAD_JS, /review_in_progress/);
  assert.match(UPLOAD_JS, /review_approved/);
});

test('review page is marked read-only Coming Soon', () => {
  assert.match(HTML, /Coming Soon · 只读历史/);
  assert.match(HTML, /保存修改、完成复核、批量复核与导出 XLSX 均未开放/);
  assert.match(SCRIPT, /const COMING_SOON = true/);
  assert.match(SCRIPT, /els\.saveButton\.disabled = COMING_SOON/);
  assert.match(SCRIPT, /els\.exportButton\.disabled = COMING_SOON/);
});

test('review page has summary, issue list, canvas and property panel', () => {
  for (const id of [
    'sourceName', 'jobId', 'reviewStatus', 'graphCounts', 'issueProgress',
    'warningCount', 'profileLabel', 'exportLabel', 'issueList', 'objectList',
    'warningList', 'sourceImage', 'overlaySvg', 'propertyBody', 'saveButton',
    'approveButton', 'bulkReviewButton', 'exportButton', 'overlayToggle', 'revisionLabel'
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`));
  }
  assert.match(HTML, /id="bulkReviewButton"[\s\S]*?Coming Soon/);
  assert.match(HTML, /trade_purchase_cn/);
  assert.match(HTML, /edit_as=pending/);
  assert.match(HTML, /不生成 XLSX/);
  assert.match(HTML, /不能通过本工作台的普通操作伪造通过/);
});

test('review client uses the review APIs and safe DOM APIs', () => {
  assert.match(SCRIPT, /\/review\/graph/);
  assert.match(SCRIPT, /\/review\/issues/);
  assert.match(SCRIPT, /\/review\/approve/);
  assert.match(SCRIPT, /\/review\/bulk-review/);
  assert.match(SCRIPT, /\/export-xlsx/);
  assert.match(SCRIPT, /\/review\/revisions/);
  assert.match(SCRIPT, /\/review\/files/);
  assert.match(SCRIPT, /credentials: 'same-origin'/);
  assert.match(SCRIPT, /expectedRevision: state\.revision/);
  assert.match(SCRIPT, /sourceUrl/);
  assert.match(SCRIPT, /overlayUrl/);
  assert.doesNotMatch(SCRIPT, /innerHTML|outerHTML/);
  assert.doesNotMatch(SCRIPT, /FLOWCHART_|api\.openai\.com|Authorization|api[_-]?key/i);
  assert.doesNotMatch(SCRIPT, /localStorage|sessionStorage/);
  assert.match(CSS, /@media/);
});

test('review client does not auto-map controls or auto-approve', () => {
  assert.match(SCRIPT, /添加控制标记/);
  assert.match(SCRIPT, /invalid_controls/);
  assert.doesNotMatch(SCRIPT, /T\.AC1.*CA/);
  assert.match(SCRIPT, /blockingPending/);
  assert.match(SCRIPT, /完成复核只记录复核状态，不会解锁 Excel 导出/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const XLSX = require(path.join(ROOT, 'private', 'vendor', 'xlsx', 'xlsx.full.min.js'));
const TEMPLATE = require(path.join(ROOT, 'private', 'tools', 'company-map-lookup', 'template.js'));

function readWorkbook() {
  const workbook = TEMPLATE.buildWorkbook(XLSX);
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
  return { workbook, buffer, parsed: XLSX.read(buffer, { type: 'buffer' }) };
}

test('template generates a valid XLSX with both sheets', () => {
  const { buffer, parsed } = readWorkbook();
  assert.ok(buffer.length > 0);
  assert.deepEqual(parsed.SheetNames, [TEMPLATE.COMPANY_SHEET, TEMPLATE.GUIDE_SHEET]);
  assert.equal(TEMPLATE.FILE_NAME, '公司地图地址查询模板.xlsx');
});

test('company sheet has exactly the expected headers and no example rows', () => {
  const { workbook, parsed } = readWorkbook();
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets[TEMPLATE.COMPANY_SHEET], { header: 1, blankrows: false });
  assert.deepEqual(rows, [['公司名称', '城市/地区（可选）']]);

  const sourceSheet = workbook.Sheets[TEMPLATE.COMPANY_SHEET];
  assert.deepEqual(sourceSheet['!cols'], [{ wch: 36 }, { wch: 22 }]);
  assert.deepEqual(sourceSheet['!autofilter'], { ref: 'A1:B1' });
});

test('guide sheet documents the required rules', () => {
  const { parsed } = readWorkbook();
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets[TEMPLATE.GUIDE_SHEET], { header: 1, blankrows: false });
  const text = rows.map((row) => row.join(' ')).join('\n');
  assert.equal(TEMPLATE.GUIDE_LINES.length, 11);
  GUIDE_KEYWORDS.forEach((keyword) => assert.match(text, new RegExp(keyword)));

  for (const [index, line] of TEMPLATE.GUIDE_LINES.entries()) {
    assert.match(text, new RegExp(`${index + 1}\\.\\s`));
    assert.ok(line.length > 0);
  }
});

test('template never contains an API key or key-looking column', () => {
  const { buffer, parsed } = readWorkbook();
  const bytes = buffer.toString('latin1');
  assert.doesNotMatch(bytes, /api[_-]?key/i);
  assert.doesNotMatch(bytes, /AMAP_WEB_SERVICE_KEY|BAIDU_MAP_AK/);

  const companyRows = XLSX.utils.sheet_to_json(parsed.Sheets[TEMPLATE.COMPANY_SHEET], { header: 1 });
  const companyHeaders = companyRows[0].join(' ').toLowerCase();
  assert.doesNotMatch(companyHeaders, /key|密钥/);
});

test('template build fails clearly when the XLSX component is missing', () => {
  assert.throws(() => TEMPLATE.buildWorkbook(null), /Excel 组件未加载/);
});

const GUIDE_KEYWORDS = [
  '必填',
  '一行填写一家公司',
  '合并单元格',
  '可选',
  '提高地图匹配准确率',
  '全国搜索',
  '百度地图',
  '不要在 Excel 中填写地图 API Key',
  'API Key 必须在网页中输入',
  '不会修改你的原始 Excel',
  '单独导出'
];

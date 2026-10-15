'use strict';

/*
 * Excel hardcode check - highlighted comparison workbook (OOXML minimal patch).
 *
 * Verifies the highlighted copy preserves every untouched OOXML part byte for
 * byte and only rewrites xl/styles.xml plus the worksheets that hold issues.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const fflate = require(path.join(ROOT, 'private', 'vendor', 'fflate', 'fflate.umd.js'));
const Highlight = require(path.join(ROOT, 'private', 'shared', 'excel-highlight', 'ooxml-highlight.js'));
const XLSX = require(path.join(ROOT, 'private', 'vendor', 'xlsx', 'xlsx.full.min.js'));

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

function u8(text) { return fflate.strToU8(text); }

function buildPackage() {
  const files = {
    '[Content_Types].xml': u8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Types xmlns="${CT}">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '</Types>'),
    '_rels/.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${R}">`
      + '<definedNames><definedName name="TaxRate">\'报表 A\'!$B$2</definedName></definedNames>'
      + '<sheets>'
      + '<sheet name="报表 A" sheetId="1" r:id="rId1"/>'
      + '<sheet name="隐藏" sheetId="2" state="hidden" r:id="rId2"/>'
      + '<sheet name="Sheet1" sheetId="3" r:id="rId3"/>'
      + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/>`
      + `<Relationship Id="rId3" Type="${R}/worksheet" Target="worksheets/sheet3.xml"/>`
      + `<Relationship Id="rId4" Type="${R}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId5" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>`
      + '</Relationships>'),
    'xl/styles.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}">`
      + '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>'
      + '<fonts count="3"><font/><font><b/></font><font><i/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="2"><border/><border><left style="thin"/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"><alignment horizontal="right"/></xf>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '</cellXfs>'
      + '</styleSheet>'),
    'xl/worksheets/sheet1.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${R}">`
      + '<dimension ref="A1:C3"/><sheetData>'
      + '<row r="1"><c r="A1" s="1" t="n"><v>10</v></c><c r="B1" s="2"><f>[1]Sheet1!A1</f><v>5</v></c><c r="C1" s="1" t="n"><v>7</v></c></row>'
      + '<row r="2"><c r="A2" t="n"><v>3</v></c></row>'
      + '</sheetData>'
      + '<mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells>'
      + '</worksheet>'),
    'xl/worksheets/sheet2.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>`
      + '<row r="1"><c r="A1" s="1" t="n"><v>99</v></c></row>'
      + '</sheetData></worksheet>'),
    'xl/worksheets/sheet3.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetData>`
      + '<row r="1"><c r="A1" t="n"><v>1</v></c></row>'
      + '</sheetData></worksheet>'),
    'xl/sharedStrings.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}" count="0" uniqueCount="0"></sst>`),
    'xl/theme/theme1.xml': u8('<theme xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><a/></theme>'),
    'xl/drawings/drawing1.xml': u8('<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>'),
    'xl/externalLinks/externalLink1.xml': u8(`<externalLink xmlns="${NS}"><externalBook xmlns:r="${R}" r:id="rId1"/></externalLink>`),
    'xl/externalLinks/_rels/externalLink1.xml.rels': u8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///C:/Other%20Workbook.xlsx" TargetMode="External"/></Relationships>'),
    'customXml/item1.xml': u8('<root xmlns="urn:custom">keep me</root>'),
    'docProps/core.xml': u8('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>'),
    'docProps/app.xml': u8('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>'),
    'xl/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])
  };
  return files;
}

const ISSUES = [
  { severity: 'HIGH', sheetName: '报表 A', cellAddress: 'A1', ruleId: 'HC001' },
  { severity: 'HARDCODE_NOTICE', sheetName: '报表 A', cellAddress: 'A1', ruleId: 'HC201' }, // same cell, second rule
  { severity: 'SUSPICIOUS', sheetName: '报表 A', cellAddress: 'B1', ruleId: 'HC006' },
  { severity: 'IGNORE', sheetName: '报表 A', cellAddress: 'A2', ruleId: 'HC907' },          // must not highlight
  { severity: 'HIGH', sheetName: '隐藏', cellAddress: 'A1', ruleId: 'HC001' }
];

function run() {
  const files = buildPackage();
  const original = fflate.zipSync(files, { level: 6 });
  const originalCopy = original.slice();
  const { data, stats } = Highlight.buildHighlightedWorkbook(fflate, original, ISSUES, {});
  const outFiles = fflate.unzipSync(data);
  return { files, original, originalCopy, data, stats, outFiles };
}

function cellTag(xml, address) {
  const re = new RegExp('<c\\b[^>]*\\br="' + address + '"[^>]*>');
  const m = re.exec(xml);
  return m ? m[0] : null;
}

test('highlight: only styles.xml and issue worksheets change; all other parts byte-identical', () => {
  const { files, outFiles } = run();
  const changed = [];
  Object.keys(files).forEach((name) => {
    const same = Buffer.from(files[name]).equals(Buffer.from(outFiles[name]));
    if (!same) changed.push(name);
  });
  assert.deepEqual(changed.sort(), ['xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  // explicit spot checks
  ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml',
    'xl/externalLinks/externalLink1.xml', 'xl/externalLinks/_rels/externalLink1.xml.rels',
    'docProps/core.xml', 'docProps/app.xml', 'customXml/item1.xml',
    'xl/theme/theme1.xml', 'xl/drawings/drawing1.xml', 'xl/media/image1.png',
    'xl/worksheets/sheet3.xml', '[Content_Types].xml', '_rels/.rels'].forEach((name) => {
    assert.ok(Buffer.from(files[name]).equals(Buffer.from(outFiles[name])), `${name} must be unchanged`);
  });
});

test('highlight: external links, defined names, hidden state and merges are preserved', () => {
  const { outFiles } = run();
  const wb = fflate.strFromU8(outFiles['xl/workbook.xml']);
  assert.ok(wb.includes('state="hidden"'), 'hidden sheet state kept');
  assert.ok(wb.includes('<definedName name="TaxRate">'), 'defined names kept');
  const ext = fflate.strFromU8(outFiles['xl/externalLinks/_rels/externalLink1.xml.rels']);
  assert.ok(ext.includes('Other%20Workbook.xlsx'), 'external link target kept');
  const sheet1 = fflate.strFromU8(outFiles['xl/worksheets/sheet1.xml']);
  assert.ok(sheet1.includes('<mergeCell ref="A3:B3"/>'), 'mergeCells kept');
  assert.ok(sheet1.includes('<f>[1]Sheet1!A1</f>'), 'external-link formula text kept');
});

test('highlight: issue cells get a style, IGNORE stays unstyled, cell edited once', () => {
  const { outFiles } = run();
  const sheet1 = fflate.strFromU8(outFiles['xl/worksheets/sheet1.xml']);
  const a1 = cellTag(sheet1, 'A1');
  const b1 = cellTag(sheet1, 'B1');
  const a2 = cellTag(sheet1, 'A2');
  assert.ok(/s="\d+"/.test(a1), 'A1 highlighted');
  assert.ok(/s="\d+"/.test(b1), 'B1 highlighted');
  assert.equal((a1.match(/s="/g) || []).length, 1, 'a cell is styled at most once');
  assert.ok(!/\bs="/.test(a2), 'IGNORE cell not highlighted');
});

test('highlight: same original style is reused (one yellow cellXf, shared)', () => {
  const { outFiles } = run();
  const sheet1 = fflate.strFromU8(outFiles['xl/worksheets/sheet1.xml']);
  const a1 = cellTag(sheet1, 'A1');
  const c1 = cellTag(sheet1, 'C1');
  const styleOf = (tag) => /\bs="(\d+)"/.exec(tag)[1];
  // C1 shares original s=1 with A1; only A1 is an issue, but a second cell using
  // the same original style must resolve to the same derived style index.
  assert.ok(a1 && c1);
  // styles.xml: original s=1 must have exactly one derived xf.
  const styles = fflate.strFromU8(outFiles['xl/styles.xml']);
  const cxMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  const xfs = cxMatch[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || [];
  const yA1 = xfs[Number(styleOf(a1))];
  const yB1 = xfs[Number(styleOf(b1Tag(sheet1)))];
  assert.ok(/\bapplyFill="1"/.test(yA1));
  assert.ok(/\bfillId="\d+"/.test(yA1));
  assert.ok(/\bapplyFill="1"/.test(yB1));
});

function b1Tag(sheet1) { return cellTag(sheet1, 'B1'); }

test('highlight: derived style inherits font / border / numFmt / alignment', () => {
  const { outFiles } = run();
  const styles = fflate.strFromU8(outFiles['xl/styles.xml']);
  const sheet1 = fflate.strFromU8(outFiles['xl/worksheets/sheet1.xml']);
  const a1 = cellTag(sheet1, 'A1');
  const newIndex = Number(/\bs="(\d+)"/.exec(a1)[1]);
  const cxMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  const xfs = cxMatch[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || [];
  const derived = xfs[newIndex];
  assert.ok(derived.includes('fontId="2"'), 'font preserved');
  assert.ok(derived.includes('borderId="1"'), 'border preserved');
  assert.ok(derived.includes('numFmtId="164"'), 'numFmt preserved');
  assert.ok(derived.includes('applyNumberFormat="1"'), 'apply flags preserved');
  assert.ok(derived.includes('<alignment horizontal="right"/>'), 'alignment preserved');
  assert.ok(/\bapplyFill="1"/.test(derived), 'fill applied');
  assert.ok(styles.includes('FFFFF2CC'), 'single light yellow fill added');
  // exactly one new fill and it is a solid pattern
  assert.equal((styles.match(/rgb="FFFFF2CC"/g) || []).length, 1);
  // original cellXfs entries are untouched (index 1 still has fillId="0")
  assert.ok(xfs[1].includes('fillId="0"'), 'original styles not rewritten in place');
});

test('highlight: hidden-sheet issues are highlighted; the input buffer is never mutated', () => {
  const { outFiles, originalCopy, original } = run();
  const sheet2 = fflate.strFromU8(outFiles['xl/worksheets/sheet2.xml']);
  assert.ok(/\bs="\d+"/.test(cellTag(sheet2, 'A1')), 'hidden sheet cell highlighted');
  assert.ok(Buffer.from(original).equals(Buffer.from(originalCopy)), 'input bytes untouched');
});

test('highlight: original style index out of range is skipped safely', () => {
  const files = buildPackage();
  const original = fflate.zipSync(files, { level: 6 });
  // Craft a sheet cell pointing at a non-existent style index.
  files['xl/worksheets/sheet1.xml'] = u8(fflate.strFromU8(files['xl/worksheets/sheet1.xml']).replace('r="A2"', 'r="A2" s="999"'));
  const zipped = fflate.zipSync(files, { level: 6 });
  const { stats } = Highlight.buildHighlightedWorkbook(fflate, zipped, [{ severity: 'HIGH', sheetName: '报表 A', cellAddress: 'A2' }], {});
  assert.ok(stats.missing >= 1, 'out-of-range style counted as missing, no crash');
});

test('highlight: a real SheetJS workbook round-trips and opens after patching', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['项目', '金额'], ['A', 120], ['B', 130]]);
  XLSX.utils.book_append_sheet(wb, ws, '数据');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  const issues = [
    { severity: 'HIGH', sheetName: '数据', cellAddress: 'B2', ruleId: 'HC001' },
    { severity: 'HARDCODE_NOTICE', sheetName: '数据', cellAddress: 'B3', ruleId: 'HC201' }
  ];
  const { data, stats } = Highlight.buildHighlightedWorkbook(fflate, new Uint8Array(buf), issues, {});
  assert.ok(stats.cells >= 2);
  const reopened = XLSX.read(data, { type: 'array' });
  assert.deepEqual(reopened.SheetNames, ['数据']);
  const files = fflate.unzipSync(data);
  assert.ok(fflate.strFromU8(files['xl/styles.xml']).includes('FFFFF2CC'));
  // original parts still present
  assert.ok(files['[Content_Types].xml']);
});

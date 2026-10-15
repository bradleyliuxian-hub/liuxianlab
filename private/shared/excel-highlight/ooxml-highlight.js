'use strict';

/*
 * Liuxian Lab - Excel hardcode check: highlighted comparison workbook.
 *
 * Produces a COPY of the original uploaded .xlsx that only adds a yellow fill
 * to the cells flagged by the scanner. It deliberately NEVER rebuilds the
 * workbook with SheetJS: it patches the original OOXML ZIP package entry by
 * entry so that formulas, cached values, external links, defined names, hidden
 * state, drawings, comments, tables, custom XML and every other part are kept
 * byte-for-byte.
 *
 * Only these entries are ever rewritten:
 *   - xl/styles.xml                       (append one fill + one cellXf per style)
 *   - the worksheet XML that holds issues (set the cell style index)
 *
 * The ZIP engine (fflate) is injected so this module stays pure and testable.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ExcelOoxmlHighlight = api;
    root.HardcodeOoxmlHighlight = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Light yellow, single colour for every severity (定位用). ARGB in OOXML.
  const HIGHLIGHT_FILL_RGB = 'FFF2CC';
  const HIGHLIGHT_SEVERITIES = ['HIGH', 'SUSPICIOUS', 'HARDCODE_NOTICE'];

  function decodeXmlEntities(value) {
    return String(value).replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|amp|lt|gt|quot|apos);/g, (match, hex, dec) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      if (match === '&amp;') return '&';
      if (match === '&lt;') return '<';
      if (match === '&gt;') return '>';
      if (match === '&quot;') return '"';
      if (match === '&apos;') return "'";
      return match;
    });
  }

  function argb(rgb) {
    const value = String(rgb || HIGHLIGHT_FILL_RGB).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (value.length === 8) return value;
    return 'FF' + value.padStart(6, '0').slice(-6);
  }

  function attrValue(tag, name) {
    const match = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
    return match ? match[1] : null;
  }

  function normalizeEntryPath(target) {
    let path = String(target == null ? '' : target);
    if (path.charAt(0) === '/') path = path.slice(1);
    else path = 'xl/' + path;
    const parts = [];
    path.split('/').forEach((segment) => {
      if (segment === '' || segment === '.') return;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    });
    return parts.join('/');
  }

  // sheet name -> real worksheet entry path, resolved through workbook.xml r:id
  // and workbook.xml.rels (never assume Sheet1 == sheet1.xml).
  function mapSheetPaths(workbookXml, relsXml) {
    const relMap = {};
    const relRe = /<Relationship\b[^>]*\/?>/g;
    let match;
    while ((match = relRe.exec(relsXml))) {
      const tag = match[0];
      const id = attrValue(tag, 'Id');
      const target = attrValue(tag, 'Target');
      const type = attrValue(tag, 'Type') || '';
      if (id && target && /\/worksheet$/.test(type)) relMap[id] = normalizeEntryPath(target);
    }
    const nameToPath = {};
    const sheetRe = /<sheet\b[^>]*\/?>/g;
    while ((match = sheetRe.exec(workbookXml))) {
      const tag = match[0];
      const name = attrValue(tag, 'name');
      const rid = attrValue(tag, 'r:id') || attrValue(tag, 'id');
      if (name != null && rid && relMap[rid]) nameToPath[decodeXmlEntities(name)] = relMap[rid];
    }
    return nameToPath;
  }

  function cellOriginalStyle(tag) {
    const match = /\bs="(\d+)"/.exec(tag);
    return match ? Number(match[1]) : 0;
  }

  function setTagAttribute(tag, name, value) {
    const re = new RegExp('\\b' + name + '="[^"]*"');
    if (re.test(tag)) return tag.replace(re, name + '="' + value + '"');
    return tag.replace(/(\/?>)/, ' ' + name + '="' + value + '"$1');
  }

  // Clone an existing cellXf, keeping font/border/numFmt/alignment/protection/
  // xfId/apply* intact and only swapping the fill.
  function withYellowFill(xf, fillId) {
    return setTagAttribute(setTagAttribute(xf, 'fillId', String(fillId)), 'applyFill', '1');
  }

  // Append one yellow fill and one derived cellXf per distinct original style.
  // Returns { xml, styleMap } with styleMap: originalIndex -> newIndex.
  function addYellowStyles(stylesXml, originalIndices, rgb) {
    const fill = '<fill><patternFill patternType="solid"><fgColor rgb="'
      + argb(rgb) + '"/><bgColor indexed="64"/></patternFill></fill>';

    let xml = stylesXml;
    let newFillId = 0;
    const fillsMatch = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
    if (fillsMatch) {
      const inner = fillsMatch[1];
      newFillId = (inner.match(/<fill\b/g) || []).length;
      const replacement = '<fills count="' + (newFillId + 1) + '">' + inner + fill + '</fills>';
      xml = xml.slice(0, fillsMatch.index) + replacement + xml.slice(fillsMatch.index + fillsMatch[0].length);
    } else {
      // No <fills> block: create one right before <borders> / <cellStyleXfs>.
      newFillId = 0;
      const block = '<fills count="1">' + fill + '</fills>';
      const anchor = /<borders\b/.exec(xml) || /<cellStyleXfs\b/.exec(xml) || /<cellXfs\b/.exec(xml);
      if (anchor) xml = xml.slice(0, anchor.index) + block + xml.slice(anchor.index);
      else throw new Error('styles.xml 结构异常：缺少 fills 且无法插入。');
    }

    const cxMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!cxMatch) throw new Error('styles.xml 结构异常：缺少 cellXfs。');
    const xfRe = /<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g;
    const xfs = cxMatch[1].match(xfRe) || [];
    const baseCount = xfs.length;

    const styleMap = {};
    let appended = '';
    let next = baseCount;
    const unique = [...new Set(originalIndices)].filter((index) => Number.isInteger(index) && index >= 0 && index < baseCount).sort((a, b) => a - b);
    unique.forEach((index) => {
      appended += withYellowFill(xfs[index], newFillId);
      styleMap[index] = next;
      next += 1;
    });

    const rebuilt = '<cellXfs count="' + next + '">' + xfs.join('') + appended + '</cellXfs>';
    xml = xml.slice(0, cxMatch.index) + rebuilt + xml.slice(cxMatch.index + cxMatch[0].length);

    return { xml, styleMap };
  }

  function applyStyleToCellTag(tag, newStyle) {
    if (/\bs="\d+"/.test(tag)) return tag.replace(/\bs="\d+"/, 's="' + newStyle + '"');
    return tag.replace(/(\/?>)/, ' s="' + newStyle + '"$1');
  }

  // Rewrite only the s= attribute of the target cells. Everything else in the
  // worksheet (formulas, cached values, merges, rows, drawings anchors...) is
  // left untouched.
  function patchWorksheetStyles(xml, cellEdits) {
    let changed = 0;
    const out = xml.replace(/<c\b[^>]*>/g, (tag) => {
      const ref = attrValue(tag, 'r');
      if (!ref || !cellEdits.has(ref)) return tag;
      changed += 1;
      return applyStyleToCellTag(tag, cellEdits.get(ref));
    });
    return { xml: out, changed };
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    return new Uint8Array(value);
  }

  function buildHighlightedWorkbook(zip, originalBytes, issues, options) {
    const opts = options || {};
    // By default every reported issue is highlighted; callers may pass an
    // explicit allowlist via `severities`. IGNORE is always excluded.
    const severities = opts.severities ? new Set(opts.severities) : null;
    const decode = zip.strFromU8;
    const encode = zip.strToU8;

    const files = zip.unzipSync(toBytes(originalBytes));

    const workbookXml = files['xl/workbook.xml'] ? decode(files['xl/workbook.xml']) : null;
    const relsXml = files['xl/_rels/workbook.xml.rels'] ? decode(files['xl/_rels/workbook.xml.rels']) : null;
    if (!workbookXml || !relsXml) throw new Error('不是有效的 .xlsx：缺少 workbook.xml 或其关系文件。');
    if (!files['xl/styles.xml']) throw new Error('不是有效的 .xlsx：缺少 xl/styles.xml。');

    const nameToPath = mapSheetPaths(workbookXml, relsXml);

    // Group issue cells per worksheet (one entry per cell, dedupe multi-rule).
    const targetsByPath = new Map();
    (issues || []).forEach((issue) => {
      if (!issue) return;
      if (severities) { if (!severities.has(issue.severity)) return; }
      else if (issue.severity === 'IGNORE') return;
      const path = nameToPath[issue.sheetName];
      if (!path || !files[path]) return;
      const address = String(issue.cellAddress || '').toUpperCase();
      if (!/^[A-Z]{1,3}\d{1,7}$/.test(address)) return;
      if (!targetsByPath.has(path)) targetsByPath.set(path, new Set());
      targetsByPath.get(path).add(address);
    });

    // Pass 1: find each target cell and its original style index.
    const sheets = [];
    const originalStyles = new Set();
    targetsByPath.forEach((targets, path) => {
      const xml = decode(files[path]);
      const originalByAddress = new Map();
      const cellRe = /<c\b[^>]*>/g;
      let match;
      while ((match = cellRe.exec(xml))) {
        const tag = match[0];
        const ref = attrValue(tag, 'r');
        if (ref && targets.has(ref)) {
          originalByAddress.set(ref, cellOriginalStyle(tag));
          originalStyles.add(cellOriginalStyle(tag));
        }
      }
      sheets.push({ path, xml, originalByAddress });
    });

    // Append yellow styles once, shared by every original style index.
    const styled = addYellowStyles(decode(files['xl/styles.xml']), [...originalStyles], opts.fillRgb);
    files['xl/styles.xml'] = encode(styled.xml);

    // Pass 2: rewrite the style index of each target cell.
    const stats = { sheets: 0, cells: 0, styles: Object.keys(styled.styleMap).length, missing: 0 };
    sheets.forEach(({ path, xml, originalByAddress }) => {
      const cellEdits = new Map();
      originalByAddress.forEach((originalStyle, address) => {
        const newStyle = styled.styleMap[originalStyle];
        if (newStyle != null) cellEdits.set(address, newStyle);
      });
      const { xml: patched, changed } = patchWorksheetStyles(xml, cellEdits);
      files[path] = encode(patched);
      if (changed > 0) stats.sheets += 1;
      stats.cells += changed;
      stats.missing += Math.max(0, originalByAddress.size - changed);
    });

    const data = zip.zipSync(files, { level: opts.level == null ? 6 : opts.level });
    return { data, stats };
  }

  return {
    HIGHLIGHT_FILL_RGB,
    HIGHLIGHT_SEVERITIES,
    buildHighlightedWorkbook,
    // exported for tests
    mapSheetPaths,
    addYellowStyles,
    patchWorksheetStyles,
    argb,
    decodeXmlEntities
  };
});

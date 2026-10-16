'use strict';

/*
 * Filename text encoding for the Excel Standardizer upload pipeline.
 *
 * Root cause of the mojibake: multipart/form-data filename params carry raw
 * UTF-8 bytes, but busboy decodes them with a single-byte legacy charset
 * (latin1) by default, so a Chinese filename such as "报价表.xlsx" is stored as
 * "æŠ¥ä»·è¡¨.xlsx".
 *
 * The primary fix is to tell multer/busboy to decode params as UTF-8
 * (defParamCharset: 'utf8', see routes.js). This module additionally repairs
 * names that were already stored mojibake, so it is safe to call on every
 * filename. Mirrors server/excel-review/encoding.js.
 */

// Windows-1252 bytes 0x80..0x9F that map to non-Latin-1 Unicode code points.
const CP1252_REVERSE = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f
};

// True when the string contains any byte-mapped character (single-byte legacy
// range or a Windows-1252 special). Correct CJK/ASCII text never matches.
function looksLikeSingleByte(value) {
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) return true;
    if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, cp)) return true;
  }
  return false;
}

function toBytes(value) {
  const bytes = [];
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, cp)) bytes.push(CP1252_REVERSE[cp]);
    else return null; // a genuine multi-byte character -> not mojibake
  }
  return Buffer.from(bytes);
}

/*
 * Repair a filename that was UTF-8 text decoded as a single-byte legacy
 * charset. It ONLY acts when the value is a plausible mojibake round-trip
 * (all characters map to bytes AND the result is valid UTF-8 without
 * replacement characters); ASCII and normal CJK/Eastern names are returned
 * unchanged. It is safe to call on every filename at read time.
 */
function repairMojibake(value) {
  if (typeof value !== 'string' || !value) return value;
  if (!looksLikeSingleByte(value)) return value;
  const bytes = toBytes(value);
  if (!bytes) return value;
  const decoded = bytes.toString('utf8');
  if (decoded === value || decoded.includes('\uFFFD')) return value;
  return decoded;
}

module.exports = { repairMojibake };

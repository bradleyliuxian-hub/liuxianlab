'use strict';

const fs = require('fs');
const readline = require('readline');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function pageParams(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.pageSize ?? query.page_size, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, requested));
  const search = String(query.search || '').trim().slice(0, 200);
  const order = String(query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const sort = String(query.sort || '').trim();
  return { page, pageSize, search, sort, order };
}

function valueAt(row, path) {
  if (!path) return '';
  if (path.includes('.')) {
    return path.split('.').reduce((current, key) => (current == null ? null : current[key]), row);
  }
  return row[path];
}

function normalized(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function searchText(row) {
  const parts = [
    row.businessKey,
    row.matchId,
    Array.isArray(row.matchIds) ? row.matchIds.join(' ') : '',
    row.raw ? Object.values(row.raw).join(' ') : ''
  ];
  return parts.map(normalized).join(' ').toLowerCase();
}

function compareValues(left, right) {
  const leftEmpty = left === null || left === undefined || left === '';
  const rightEmpty = right === null || right === undefined || right === '';
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    && String(left).trim() !== '' && String(right).trim() !== '';
  if (bothNumeric) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), 'zh-CN');
}

async function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (_) {
      // Skip a partially written line; the worker writes atomically per line.
    }
  }
  return rows;
}

async function paginateNdjson(file, options = {}) {
  const { page, pageSize, search, sort, order } = pageParams(options.query || {});
  const filters = options.filters || {};
  const searchable = options.searchFields || null;
  const sortKey = options.sortFields && options.sortFields[sort] ? options.sortFields[sort] : options.defaultSort;
  const direction = order === 'desc' ? -1 : 1;
  const keyword = search.toLowerCase();

  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const matched = [];

  for await (const line of reader) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (typeof options.predicate === 'function' && !options.predicate(row)) {
      continue;
    }
    if (keyword) {
      const haystack = searchable
        ? searchable.map((path) => normalized(valueAt(row, path))).join(' ').toLowerCase()
        : searchText(row);
      if (!haystack.includes(keyword)) continue;
    }
    let keep = true;
    for (const [key, expected] of Object.entries(filters)) {
      if (expected === null || expected === undefined || expected === '') continue;
      if (normalized(valueAt(row, key)) !== String(expected)) {
        keep = false;
        break;
      }
    }
    if (keep) matched.push(row);
  }

  if (sortKey) {
    matched.sort((left, right) => {
      const primary = compareValues(valueAt(left, sortKey), valueAt(right, sortKey));
      const secondary = primary === 0
        ? compareValues(valueAt(left, options.tieBreaker || 'sourceRow'), valueAt(right, options.tieBreaker || 'sourceRow'))
        : primary;
      return secondary * direction;
    });
  }

  const total = matched.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    rows: matched.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
    sort: sort || options.defaultSort || '',
    order
  };
}

async function findSegment(file, matchId) {
  const rows = await readNdjson(file);
  return rows.find((row) => String(row.matchId) === String(matchId)) || null;
}

async function findSegmentsByIds(file, matchIds) {
  if (!Array.isArray(matchIds) || !matchIds.length) return [];
  const wanted = new Set(matchIds.map(String));
  const rows = await readNdjson(file);
  const byId = new Map(rows.map((row) => [String(row.matchId), row]));
  return matchIds.map((id) => byId.get(String(id))).filter(Boolean);
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageParams,
  readNdjson,
  paginateNdjson,
  findSegment,
  findSegmentsByIds,
  compareValues
};

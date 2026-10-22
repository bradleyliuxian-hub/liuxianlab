'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { createPresetRouter } = require(path.join(ROOT, 'server', 'journal-entry', 'split-preset-routes.js'));
const express = require(path.join(ROOT, 'node_modules', 'express'));

const state = { presets: new Map() };
const repository = {
  async createPreset({ id, ownerUsername, name, spec }) {
    const row = {
      id, ownerUsername, name, spec,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    };
    state.presets.set(id, row);
    return row;
  },
  async listPresets(owner) {
    return [...state.presets.values()].filter((row) => row.ownerUsername === owner);
  },
  async getPreset(id, owner) {
    const row = state.presets.get(id);
    return row && row.ownerUsername === owner ? row : null;
  },
  async updatePreset(id, owner, { name, spec }) {
    const row = state.presets.get(id);
    if (!row || row.ownerUsername !== owner) return null;
    if (name) row.name = name;
    if (spec) row.spec = spec;
    return row;
  },
  async deletePreset(id, owner) {
    const row = state.presets.get(id);
    if (!row || row.ownerUsername !== owner) return false;
    state.presets.delete(id);
    return true;
  }
};

let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { auth: { username: req.headers['x-user'] || 'tester' } };
    next();
  });
  app.use('/api/journal-entry-split-presets', createPresetRouter({
    requireAuth: (_req, _res, next) => next(),
    repository
  }));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => { if (server) server.close(); });

async function request(method, pathname, body, user = 'tester') {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'x-user': user, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const spec = {
  filters: { account_values: ['1122'] },
  groupBy: ['customer', 'month'],
  groupOptions: {},
  rowMode: 'matched_only',
  outputMode: 'zip',
  columns: ['date', 'voucher_id', 'customer_name']
};

test('create, list, read, update and delete preset', async () => {
  const created = await request('POST', '/api/journal-entry-split-presets', {
    name: '客户按月', spec
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.preset.spec.groupBy, ['customer', 'month']);
  assert.deepEqual(created.body.preset.spec.columns, ['date', 'voucher_id', 'customer_name']);
  const id = created.body.preset.id;

  const list = await request('GET', '/api/journal-entry-split-presets');
  assert.equal(list.status, 200);
  assert.ok(list.body.presets.some((preset) => preset.id === id));

  const read = await request('GET', `/api/journal-entry-split-presets/${id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.preset.name, '客户按月');

  const updated = await request('PATCH', `/api/journal-entry-split-presets/${id}`, {
    name: '客户按月（新）',
    spec: { ...spec, outputMode: 'multi_sheet' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preset.name, '客户按月（新）');
  assert.equal(updated.body.preset.spec.outputMode, 'multi_sheet');

  const deleted = await request('DELETE', `/api/journal-entry-split-presets/${id}`);
  assert.equal(deleted.status, 200);
  const missing = await request('GET', `/api/journal-entry-split-presets/${id}`);
  assert.equal(missing.status, 404);
});

test('presets are owner scoped', async () => {
  const created = await request('POST', '/api/journal-entry-split-presets', {
    name: 'owner', spec
  });
  const id = created.body.preset.id;
  const hidden = await request('GET', `/api/journal-entry-split-presets/${id}`, undefined, 'other');
  assert.equal(hidden.status, 404);
  const list = await request('GET', '/api/journal-entry-split-presets', undefined, 'other');
  assert.equal(list.body.presets.length, 0);
});

test('invalid spec and duplicate dimensions are rejected', async () => {
  const duplicate = await request('POST', '/api/journal-entry-split-presets', {
    name: 'dup', spec: { ...spec, groupBy: ['customer', 'customer'] }
  });
  assert.equal(duplicate.status, 422);
  const tooMany = await request('POST', '/api/journal-entry-split-presets', {
    name: 'many', spec: { ...spec, groupBy: ['account', 'customer', 'month', 'entity'] }
  });
  assert.equal(tooMany.status, 422);
  const noName = await request('POST', '/api/journal-entry-split-presets', {
    name: '   ', spec
  });
  assert.equal(noName.status, 422);
  const full = await request('POST', '/api/journal-entry-split-presets', {
    name: 'full', spec: { ...spec, rowMode: 'full_voucher' }
  });
  assert.equal(full.status, 422);
  const emptyColumns = await request('POST', '/api/journal-entry-split-presets', {
    name: 'empty-columns', spec: { ...spec, columns: [] }
  });
  assert.equal(emptyColumns.status, 422);
  const unknownColumns = await request('POST', '/api/journal-entry-split-presets', {
    name: 'unknown-columns', spec: { ...spec, columns: ['nope'] }
  });
  assert.equal(unknownColumns.status, 422);
  const legacySpec = { ...spec };
  delete legacySpec.columns;
  const legacy = await request('POST', '/api/journal-entry-split-presets', {
    name: 'legacy', spec: legacySpec
  });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.body.preset.spec.columns, null);
});

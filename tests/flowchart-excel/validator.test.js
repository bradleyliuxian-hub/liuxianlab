'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateContract, getEnums, SCHEMA_PATH } = require('../../services/flowchart_excel/validator');
const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'flowchart-excel', 'legacy-minimal.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validContract() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const adapted = adaptLegacyFlowchart(raw, { sourceFile: 'legacy-minimal.json' });
  assert.equal(adapted.ok, true);
  return adapted.data;
}

test('schema file resolves and compiles', () => {
  assert.ok(fs.existsSync(SCHEMA_PATH));
  const enums = getEnums();
  assert.ok(enums.shapes.includes('process'));
  assert.ok(enums.ports.includes(null));
  assert.equal(enums.anchors, 'twoCellAnchor');
});

test('valid adapted contract passes schema', () => {
  const result = validateContract(validContract());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('valid contract with null source hash passes', () => {
  const data = validContract();
  data.document.source_image_sha256 = null;
  const result = validateContract(data);
  assert.equal(result.valid, true);
});

test('wrong schema version fails', () => {
  const data = validContract();
  data.schema_version = '0.9.0';
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === 'const'));
});

test('invalid shape fails', () => {
  const data = validContract();
  data.nodes[0].shape = 'bogus';
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === '/nodes/0/shape'));
});

test('invalid bbox fails', () => {
  const data = validContract();
  data.nodes[0].bbox.x = 2;
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath.includes('/nodes/0/bbox/x')));
});

test('invalid template profile id fails', () => {
  const data = validContract();
  data.template_profile_id = 'old_sales_flowchart';
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === '/template_profile_id'));
});

test('missing template profile reference fails required validation', () => {
  const data = validContract();
  delete data.template_profile_ref;
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === 'required' && error.params.missingProperty === 'template_profile_ref'));
});

test('invalid anchor mode fails', () => {
  const data = validContract();
  data.export_profile.anchor_mode = 'absoluteAnchor';
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.instancePath === '/export_profile/anchor_mode'));
});

test('missing required field fails', () => {
  const data = validContract();
  delete data.document;
  const result = validateContract(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === 'required'));
});

test('invalid JSON string returns stable error', () => {
  const result = validateContract('{"schema_version":');
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'INVALID_JSON');
  assert.equal(result.errors[0].message, '输入不是合法 JSON。');
});

test('mutating an input clone does not affect the compiled schema', () => {
  const data = validContract();
  data.nodes[0].shape = 'bogus';
  const first = validateContract(data);
  assert.equal(first.valid, false);
  const second = validateContract(validContract());
  assert.equal(second.valid, true);
});

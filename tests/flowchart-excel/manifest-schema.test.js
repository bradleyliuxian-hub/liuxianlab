'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const { MANIFEST_SCHEMA_PATH, normalizeManifest, validateManifestSchema } = require('../../services/flowchart_excel/manifest_validator');

const HASH = 'a'.repeat(64);
const BASE = {
  schema_version: '1.0.0',
  package_version: '1.0.0',
  generation_mode: 'external_ai',
  ai_extraction_performed_by_website: false,
  source_image: { filename: 'source.png', size: 1234, sha256: HASH },
  files: {
    'flowchart.json': HASH,
    'nodes.csv': HASH,
    'edges.csv': HASH,
    'style.json': HASH,
    'conversion_report.md': HASH
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function check(value) {
  return validateManifestSchema(value);
}

test('manifest schema exists and compiles', () => {
  assert.equal(fs.existsSync(MANIFEST_SCHEMA_PATH), true);
  assert.equal(check(BASE).valid, true);
});

test('valid optional fields are accepted', () => {
  const value = clone(BASE);
  value.files['review_overlay.png'] = HASH;
  value.model = { name: 'external-vision', provider: 'external' };
  value.prompt_version = '1.0.0';
  assert.equal(check(value).valid, true);
});

test('wrong generation mode, AI claim, version and hash are rejected', () => {
  for (const mutate of [
    (v) => { v.generation_mode = 'real'; },
    (v) => { v.ai_extraction_performed_by_website = true; },
    (v) => { v.schema_version = '2.0.0'; },
    (v) => { v.files['nodes.csv'] = 'bad'; },
    (v) => { v.source_image.sha256 = 'bad'; },
    (v) => { v.source_image.size = 0; },
    (v) => { v.source_image.filename = '../source.png'; },
    (v) => { v.extra = true; }
  ]) {
    const value = clone(BASE);
    mutate(value);
    assert.equal(check(value).valid, false);
  }
});

test('missing required file hash is rejected', () => {
  const value = clone(BASE);
  delete value.files['edges.csv'];
  assert.equal(check(value).valid, false);
});

test('source sha256 null is allowed by schema', () => {
  const value = clone(BASE);
  value.source_image.sha256 = null;
  assert.equal(check(value).valid, true);
});

test('legacy external package manifest is normalized without weakening hashes', () => {
  const legacy = {
    package_schema_version: '1.0.0',
    package_type: 'flowchart_excel_helper_package',
    generation_mode: 'external_ai',
    ai_extraction_performed_by_website: false,
    template_profile: { id: 'trade_purchase_cn' },
    notes: ['external package'],
    source_image: { filename: 'source.png', width_px: 1402, height_px: 1133, sha256: HASH },
    files: [
      { name: 'flowchart.json', sha256: HASH },
      { path: 'nodes.csv', sha256: HASH },
      { filename: 'edges.csv', sha256: HASH },
      { name: 'style.json', sha256: HASH },
      { name: 'conversion_report.md', sha256: HASH }
    ]
  };
  const normalized = normalizeManifest(legacy);
  assert.equal(normalized.schema_version, '1.0.0');
  assert.equal(normalized.package_version, '1.0.0');
  assert.equal(normalized.files['flowchart.json'], HASH);
  assert.equal(normalized.files['nodes.csv'], HASH);
  assert.equal(normalized.source_image.size, undefined);
  assert.equal(normalized.package_schema_version, undefined);
  assert.equal(normalized.template_profile, undefined);
  assert.equal(check(normalized).valid, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { PROFILE_PATH, loadProfile, validateProfile } = require('../../services/flowchart_excel/template_profile');

const TEMPLATE = '/Users/a123/Downloads/Trade purchase.CN.xlsx';

test('profile JSON parses and matches the verified template hash', () => {
  const profile = loadProfile();
  assert.equal(profile.profile_id, 'trade_purchase_cn');
  assert.equal(profile.source_template.sha256, 'c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80');
  assert.equal(fs.existsSync(PROFILE_PATH), true);
  if (fs.existsSync(TEMPLATE)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(TEMPLATE)).digest('hex');
    assert.equal(hash, profile.source_template.sha256);
  }
});

test('profile validator accepts the profile and template evidence', () => {
  const result = validateProfile(loadProfile(), { templatePath: TEMPLATE });
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('profile keeps anchor and export gates closed', () => {
  const profile = loadProfile();
  assert.equal(profile.anchor.type, 'twoCellAnchor');
  assert.equal(profile.anchor.explicit_edit_as, null);
  assert.equal(profile.anchor.production_edit_as, 'pending');
  assert.equal(profile.export.edit_as, 'pending');
  assert.equal(profile.export.export_ready, false);
});

test('profile records template connector defects and lane implementation', () => {
  const profile = loadProfile();
  assert.equal(profile.connector_style.binding_counts.total, 74);
  assert.equal(profile.connector_style.binding_counts.both, 50);
  assert.equal(profile.workbook.merge_cells.join(','), 'A8:A9');
  assert.equal(profile.lane_style.implementation, 'row_band_plus_column_a_label_cells');
  assert.match(profile.connector_style.required_output, /stCxn/);
});

test('profile validator rejects a forged export gate', () => {
  const profile = loadProfile();
  const forged = JSON.parse(JSON.stringify(profile));
  forged.export.export_ready = true;
  forged.anchor.production_edit_as = 'oneCell';
  const result = validateProfile(forged);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /export_ready/.test(error)));
  assert.ok(result.errors.some((error) => /editAs/.test(error)));
});

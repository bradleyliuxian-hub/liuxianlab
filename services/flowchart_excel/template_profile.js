'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROFILE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'agent',
  'flowchart-excel',
  'trade-purchase-template-profile.json'
);

const FORBIDDEN_SAMPLE_TEXT = [
  'Guidance - Remove before use',
  '采购流程 - 说明性流程图'
];

function loadProfile(filePath = PROFILE_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateProfile(profile, { templatePath } = {}) {
  const errors = [];
  const warnings = [];
  const required = [
    'profile_id', 'profile_version', 'source_template', 'workbook', 'page_setup',
    'theme', 'font', 'shape_style', 'connector_style', 'lane_style', 'legend_style',
    'control_marker_style', 'anchor', 'export', 'unverified'
  ];
  for (const key of required) {
    if (!profile || !(key in profile)) errors.push(`missing ${key}`);
  }
  if (errors.length) return { valid: false, errors, warnings };

  if (profile.profile_id !== 'trade_purchase_cn') errors.push('profile_id must be trade_purchase_cn');
  if (profile.source_template.sha256 !== 'c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80') {
    errors.push('source_template.sha256 does not match the verified template');
  }
  if (!/^[0-9a-f]{64}$/.test(String(profile.source_template.sha256 || ''))) errors.push('source_template.sha256 invalid');
  if (profile.anchor.type !== 'twoCellAnchor') errors.push('anchor.type must be twoCellAnchor');
  if (profile.anchor.explicit_edit_as !== null) errors.push('target template must have no explicit editAs');
  if (profile.anchor.production_edit_as !== 'pending') errors.push('production editAs must remain pending until Excel acceptance');
  if (profile.export.export_ready !== false) errors.push('export_ready must be false');
  if (profile.export.edit_as !== 'pending') errors.push('export.edit_as must be pending');
  if (profile.connector_style.binding_counts.total !== 74) errors.push('template connector count mismatch');
  if (profile.connector_style.binding_counts.both !== 50) errors.push('template complete binding count mismatch');
  if (profile.shape_style.preset_counts.flowChartProcess !== 22) errors.push('template process count mismatch');
  if (!Array.isArray(profile.unverified) || !profile.unverified.length) errors.push('unverified must list unknowns');
  if (!profile.workbook.merge_cells.includes('A8:A9')) errors.push('A8:A9 merge evidence missing');
  if (profile.lane_style.implementation !== 'row_band_plus_column_a_label_cells') errors.push('lane implementation mismatch');
  if (!profile.connector_style.required_output.includes('stCxn')) errors.push('connector hard rule missing');
  if (JSON.stringify(profile).includes(FORBIDDEN_SAMPLE_TEXT[0]) && !profile.legend_style?.sample_text_forbidden) {
    errors.push('forbidden template sample text is present without an explicit exclusion');
  }

  if (templatePath) {
    if (!fs.existsSync(templatePath)) {
      warnings.push(`template file not found: ${templatePath}`);
    } else {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex');
      if (hash !== profile.source_template.sha256) errors.push('template SHA-256 differs from profile');
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { PROFILE_PATH, FORBIDDEN_SAMPLE_TEXT, loadProfile, validateProfile };

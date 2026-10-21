'use strict';

const fs = require('fs');
const path = require('path');
const { zipSync } = require('../../private/vendor/fflate/fflate.umd.js');

const PROFILE_ID = 'trade_purchase_cn';
const PROFILE_VERSION = '1.0.0';
const PROFILE_REF = 'docs/agent/flowchart-excel/trade-purchase-template-profile.md';

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function nodesCsv(data) {
  const header = ['id', 'label', 'shape', 'lane_id', 'x', 'y', 'width', 'height', 'controls', 'confidence', 'review_status', 'notes'];
  const rows = [header.map(csvCell).join(',')];
  for (const node of data.nodes || []) {
    const bbox = node.bbox || {};
    const controls = (node.controls || []).map((control) => `${control.kind}:${control.code}`).join(';');
    rows.push([
      node.id, node.label, node.shape, node.lane_id,
      bbox.x, bbox.y, bbox.width, bbox.height,
      controls, node.confidence, node.review_status,
      node.provenance?.notes || ''
    ].map(csvCell).join(','));
  }
  return '\ufeff' + rows.join('\n') + '\n';
}

function edgesCsv(data) {
  const header = ['id', 'source_node_id', 'target_node_id', 'source_port', 'target_port', 'kind', 'label', 'route_hint', 'confidence', 'review_status', 'notes'];
  const rows = [header.map(csvCell).join(',')];
  for (const edge of data.edges || []) {
    rows.push([
      edge.id, edge.source_node_id, edge.target_node_id,
      edge.source_port, edge.target_port, edge.kind, edge.label,
      edge.route_hint, edge.confidence, edge.review_status,
      edge.provenance?.notes || ''
    ].map(csvCell).join(','));
  }
  return '\ufeff' + rows.join('\n') + '\n';
}

function styleJson(data) {
  return `${JSON.stringify({
    template_profile_id: PROFILE_ID,
    template_profile_version: PROFILE_VERSION,
    template_profile_ref: PROFILE_REF,
    theme: {},
    excel_export_rules: data.style.excel_export_rules,
    notes: 'Visual authority is the trade_purchase_cn template profile. Legacy/model theme is not used here.'
  }, null, 2)}\n`;
}

function reportMarkdown(data, metadata, warnings) {
  const unresolved = data.unresolved_items || [];
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const low = nodes.filter((node) => node.confidence === 'low');
  const lines = [
    '# Flowchart helper conversion report',
    '',
    '## Model',
    `- model: ${metadata.model || 'unknown'}`,
    `- provider: ${metadata.provider || 'unknown'}`,
    `- prompt_version: ${metadata.prompt_version || 'unknown'}`,
    `- input_sha256: ${metadata.source_sha256 || data.document.source_image_sha256 || ''}`,
    `- source_size_px: ${data.document.source_image_size_px?.width} x ${data.document.source_image_size_px?.height}`,
    `- template_profile_id: ${PROFILE_ID}`,
    `- template_profile_version: ${PROFILE_VERSION}`,
    '',
    '## Counts',
    `- lanes: ${(data.lanes || []).length}`,
    `- nodes: ${nodes.length}`,
    `- edges: ${edges.length}`,
    `- unresolved_items: ${unresolved.length}`,
    `- low_confidence_nodes: ${low.length}`,
    '',
    '## Warnings'
  ];
  if (warnings.length) lines.push(...warnings.map((warning) => `- ${warning}`));
  else lines.push('- No adapter warnings.');
  lines.push('', '## Unresolved items');
  if (unresolved.length) {
    for (const item of unresolved) {
      lines.push(`- ${item.id} [${item.type}/${item.severity}] ${item.description} Action: ${item.action}`);
    }
  } else {
    lines.push('- None.');
  }
  lines.push('', '## Excel export gate', '- exportReady: false until human review and the Excel export gate.');
  lines.push('- edit_as: pending. Do not treat the Excel anchor decision as confirmed.');
  lines.push('- review_overlay.png is for human inspection only, not final Excel content.');
  lines.push('');
  return lines.join('\n');
}

function buildHelperArtifacts({ store, jobId, data, metadata, overlayPath, overlayBuffer = null, warnings: inputWarnings = [] }) {
  const warnings = [...inputWarnings];
  const core = new Map();
  core.set('flowchart.json', Buffer.from(`${JSON.stringify(data, null, 2)}\n`));
  core.set('nodes.csv', Buffer.from(nodesCsv(data)));
  core.set('edges.csv', Buffer.from(edgesCsv(data)));
  core.set('style.json', Buffer.from(styleJson(data)));
  core.set('conversion_report.md', Buffer.from(reportMarkdown(data, metadata || {}, warnings)));

  const artifacts = [];
  const write = (id, name, kind, content) => {
    const artifact = store.writeArtifact(jobId, { id, name, kind, content });
    artifacts.push(artifact);
  };

  write('flowchart-json', 'flowchart.json', 'helper_flowchart', core.get('flowchart.json'));
  write('nodes-csv', 'nodes.csv', 'helper_nodes_csv', core.get('nodes.csv'));
  write('edges-csv', 'edges.csv', 'helper_edges_csv', core.get('edges.csv'));
  write('style-json', 'style.json', 'helper_style', core.get('style.json'));
  write('conversion-report', 'conversion_report.md', 'helper_report', core.get('conversion_report.md'));

  let overlay = null;
  if (overlayBuffer) {
    overlay = Buffer.from(overlayBuffer);
  } else if (overlayPath && fs.existsSync(overlayPath)) {
    overlay = fs.readFileSync(overlayPath);
  }
  if (overlay) {
    write('review-overlay', 'review_overlay.png', 'helper_overlay', overlay);
  } else {
    warnings.push('review_overlay.png 不存在，已跳过。');
  }

  const zipEntries = {};
  for (const [name, content] of core.entries()) {
    zipEntries[name] = new Uint8Array(content);
  }
  if (overlay) zipEntries['review_overlay.png'] = new Uint8Array(overlay);
  const zipped = zipSync(zipEntries, { level: 6 });
  write('helper-files-zip', 'flowchart-helper-files.zip', 'helper_zip', Buffer.from(zipped));

  return { artifacts, warnings };
}

module.exports = { buildHelperArtifacts, nodesCsv, edgesCsv, styleJson, PROFILE_ID, PROFILE_VERSION, PROFILE_REF };

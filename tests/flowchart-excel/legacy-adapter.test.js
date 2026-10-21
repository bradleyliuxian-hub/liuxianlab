'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');
const { validateContract } = require('../../services/flowchart_excel/validator');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'flowchart-excel', 'legacy-minimal.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function adapt(raw = loadFixture()) {
  return adaptLegacyFlowchart(raw, { sourceFile: 'legacy-minimal.json' });
}

test('legacy fixture adapts to a schema-valid contract', () => {
  const result = adapt();
  assert.equal(result.ok, true);
  assert.equal(result.data.schema_version, '1.0.0');
  assert.equal(result.report.counts.nodes_in, 4);
  assert.equal(result.report.counts.nodes_out, 4);
  assert.equal(result.report.counts.edges_in, 3);
  assert.equal(result.report.counts.edges_out, 3);
  assert.equal(validateContract(result.data).valid, true);
});

test('adapter binds the target template profile and does not use legacy theme as final style', () => {
  const result = adapt();
  assert.equal(result.data.template_profile_id, 'trade_purchase_cn');
  assert.equal(result.data.template_profile_version, '1.0.0');
  assert.equal(result.data.template_profile_ref, 'docs/agent/flowchart-excel/trade-purchase-template-profile.md');
  assert.deepEqual(result.data.style.theme, {});
  assert.equal(result.data.style.extensions.legacy.original_theme.process.fill, '#D9E7F5');
  assert.equal(result.data.style.excel_export_rules.anchor_mode, 'twoCellAnchor');
  assert.equal(result.data.style.excel_export_rules.edit_as, 'pending');
  assert.equal(result.data.style.excel_export_rules.swimlane_background, 'template_defined');
  assert.equal(result.data.style.excel_export_rules.legend, 'template_defined');
});

test('lane ID mapping wins over display-name mapping', () => {
  const raw = loadFixture();
  raw.nodes[0].lane = 'lane_sales';
  const result = adapt(raw);
  assert.equal(result.data.nodes[0].lane_id, 'lane_sales');
  assert.equal(result.warnings.some((warning) => warning.path === '/nodes/0/lane'), false);
});

test('unique lane label maps to lane_id with a warning', () => {
  const result = adapt();
  assert.equal(result.data.nodes[0].lane_id, 'lane_sales');
  assert.ok(result.warnings.some((warning) => warning.code === 'LANE_MAPPED_BY_LABEL'));
});

test('ambiguous lane names stay null and produce unresolved', () => {
  const raw = loadFixture();
  raw.lanes[1].label = '销售部';
  const result = adapt(raw);
  assert.equal(result.data.nodes[0].lane_id, null);
  assert.ok(result.unresolved_items.some((item) => item.description.includes('无法唯一匹配')));
});

test('bbox_px normalizes to bbox and preserves source_bbox_px', () => {
  const result = adapt();
  const node = result.data.nodes.find((item) => item.id === 'n_process');
  assert.deepEqual(node.bbox, {
    x: 0.4,
    y: 0.375,
    width: 0.18,
    height: 0.1,
    coordinate_space: 'normalized'
  });
  assert.deepEqual(node.source_bbox_px, {
    x: 400,
    y: 300,
    width: 180,
    height: 80,
    coordinate_space: 'source_pixels'
  });
  assert.equal(result.data.lanes[0].bbox.y, 0.0625);
  assert.equal(result.data.lanes[0].source_bbox_px.height, 200);
});

test('source/target fields migrate to source_node_id/target_node_id', () => {
  const result = adapt();
  const edge = result.data.edges.find((item) => item.id === 'e_decision_process');
  assert.equal(edge.source_node_id, 'n_decision');
  assert.equal(edge.target_node_id, 'n_process');
});

test('ports are inferred from bbox geometry and marked for review', () => {
  const result = adapt();
  const edge = result.data.edges.find((item) => item.id === 'e_start_decision');
  assert.equal(edge.source_port, 'right');
  assert.equal(edge.target_port, 'left');
  assert.equal(edge.provenance.legacy.port_inference, 'geometry_v1');
  assert.ok(result.unresolved_items.some((item) => item.type === 'missing_port' && item.description.includes('推断')));
});

test('loopback edge with no ports stays null and produces high unresolved', () => {
  const raw = loadFixture();
  raw.edges[0].kind = 'loopback';
  const result = adapt(raw);
  const edge = result.data.edges.find((item) => item.id === 'e_start_decision');
  assert.equal(edge.source_port, null);
  assert.equal(edge.target_port, null);
  assert.ok(result.unresolved_items.some((item) => item.type === 'missing_port' && item.severity === 'high'));
});

test('confidence and review_status stay separate', () => {
  const result = adapt();
  const decision = result.data.nodes.find((item) => item.id === 'n_decision');
  assert.equal(decision.confidence, 'medium');
  assert.equal(decision.review_status, 'pending');
});

test('controls migrate to CA/PRP/TOE with needs_review default', () => {
  const result = adapt();
  const process = result.data.nodes.find((item) => item.id === 'n_process');
  const decision = result.data.nodes.find((item) => item.id === 'n_decision');
  const end = result.data.nodes.find((item) => item.id === 'n_end');
  assert.equal(process.controls[0].kind, 'CA');
  assert.equal(decision.controls[0].kind, 'PRP');
  assert.equal(end.controls[0].kind, 'TOE');
  assert.equal(process.controls[0].attribution_status, 'needs_review');
});

test('unknown fields are preserved under extensions.legacy', () => {
  const result = adapt();
  assert.equal(result.data.extensions.legacy.unknown_fields.legacy_root, 'keep-root');
  const process = result.data.nodes.find((item) => item.id === 'n_process');
  assert.equal(process.extensions.legacy.unknown_fields.legacy_note, 'keep-node');
  const edge = result.data.edges.find((item) => item.id === 'e_decision_process');
  assert.equal(edge.extensions.legacy.unknown_fields.legacy_edge, 'keep-edge');
});

test('dangling edge is retained and reported, not deleted', () => {
  const raw = loadFixture();
  raw.edges.push({
    id: 'e_dangling',
    source: 'n_start',
    target: 'n_missing',
    kind: 'sequence',
    confidence: 'high'
  });
  const result = adapt(raw);
  assert.equal(result.ok, true);
  assert.equal(result.data.edges.some((edge) => edge.id === 'e_dangling'), true);
  assert.ok(result.unresolved_items.some((item) => item.type === 'dangling_edge' && item.severity === 'high'));
});

test('missing image size fails safely without fabricating coordinates', () => {
  const raw = loadFixture();
  delete raw.document.source_image_size_px;
  delete raw.coordinate_system;
  const result = adapt(raw);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'MISSING_IMAGE_SIZE');
  assert.equal(result.data, undefined);
});

test('adapter is deterministic for the same input and version', () => {
  const first = adapt();
  const second = adapt();
  assert.deepEqual(first.data, second.data);
  assert.deepEqual(first.report, second.report);
});

test('already-target contract is not migrated twice', () => {
  const first = adapt();
  const second = adaptLegacyFlowchart(first.data, { sourceFile: 'already-target.json' });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyAdapted, true);
  assert.equal(second.data.schema_version, '1.0.0');
  assert.deepEqual(second.data, first.data);
  assert.equal(second.report.already_adapted, true);
});

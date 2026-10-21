'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');
const { validateReferences } = require('../../services/flowchart_excel/reference_validator');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'flowchart-excel', 'legacy-minimal.json');

function validContract() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const adapted = adaptLegacyFlowchart(raw, { sourceFile: 'legacy-minimal.json' });
  assert.equal(adapted.ok, true);
  return JSON.parse(JSON.stringify(adapted.data));
}

test('target template profile file exists', () => {
  const profile = path.join(__dirname, '..', '..', 'docs', 'agent', 'flowchart-excel', 'trade-purchase-template-profile.md');
  assert.equal(fs.existsSync(profile), true);
});

test('valid contract has no reference errors', () => {
  const result = validateReferences(validContract());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.exportReady, false); // adapter does not claim Windows acceptance
});

test('wrong template profile is rejected', () => {
  const data = validContract();
  data.template_profile_id = 'old_sales_flowchart';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_TEMPLATE_PROFILE'));
});

test('missing template profile reference is a blocking warning for export', () => {
  const data = validContract();
  data.template_profile_ref = 'docs/agent/flowchart-excel/does-not-exist.md';
  const result = validateReferences(data);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'TEMPLATE_PROFILE_REF_MISSING'));
  assert.equal(result.exportReady, false);
});

test('untrusted style override is rejected', () => {
  const data = validContract();
  data.style_overrides = { source: 'model', reason: 'model tried to override', tokens: {} };
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'UNTRUSTED_STYLE_OVERRIDE'));
});

test('style override cannot alter hard native connector rules', () => {
  const data = validContract();
  data.style_overrides = {
    source: 'user_explicit',
    reason: 'requested by user',
    tokens: { native_bound_connectors_only: false, anchor_mode: 'absoluteAnchor' }
  };
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'FORBIDDEN_STYLE_OVERRIDE'));
});

test('explicit user style override is allowed for local visual tokens', () => {
  const data = validContract();
  data.style_overrides = {
    source: 'user_explicit',
    reason: 'user approved a local accent color',
    tokens: { activeColor: '#4472C4' }
  };
  const result = validateReferences(data);
  assert.equal(result.valid, true);
});

test('duplicate node/lane/edge IDs fail', () => {
  const data = validContract();
  data.nodes.push(JSON.parse(JSON.stringify(data.nodes[0])));
  data.lanes.push(JSON.parse(JSON.stringify(data.lanes[0])));
  data.edges.push(JSON.parse(JSON.stringify(data.edges[0])));
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_NODE_ID'));
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_LANE_ID'));
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_EDGE_ID'));
});

test('invalid lane reference fails', () => {
  const data = validContract();
  data.nodes[0].lane_id = 'lane_missing';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_LANE_REFERENCE'));
});

test('dangling source/target fails and produces unresolved', () => {
  const data = validContract();
  data.edges[0].target_node_id = 'n_missing';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'DANGLING_EDGE'));
  assert.ok(result.unresolved_items.some((item) => item.type === 'dangling_edge' && item.severity === 'high'));
});

test('invalid port fails', () => {
  const data = validContract();
  data.edges[0].source_port = 'diagonal';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_PORT'));
});

test('bbox out of range or non-finite fails', () => {
  const data = validContract();
  data.nodes[0].bbox.x = 1.2;
  data.nodes[1].bbox.width = Infinity;
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'BBOX_OUT_OF_RANGE' || error.code === 'INVALID_BBOX'));
});

test('invalid control kind/code fails', () => {
  const data = validContract();
  data.nodes[1].controls[0].kind = 'XX';
  data.nodes[1].controls[0].code = 'BAD';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CONTROL_KIND'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CONTROL_CODE'));
});

test('missing branch label is a warning plus unresolved, not a hard error', () => {
  const data = validContract();
  const branch = data.edges.find((edge) => edge.kind === 'branch');
  branch.label = null;
  const result = validateReferences(data);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'MISSING_BRANCH_LABEL'));
  assert.ok(result.unresolved_items.some((item) => item.type === 'ambiguous_branch'));
});

test('control number gaps only warn and do not create controls', () => {
  const data = validContract();
  data.nodes[1].controls.push({
    kind: 'CA',
    code: 'CA3',
    display: 'badge',
    attribution_status: 'needs_review'
  });
  const before = data.nodes[1].controls.length;
  const result = validateReferences(data);
  assert.equal(data.nodes[1].controls.length, before);
  assert.ok(result.warnings.some((warning) => warning.code === 'CONTROL_NUMBER_GAP'));
  assert.ok(result.unresolved_items.some((item) => item.type === 'possible_number_gaps'));
});

test('export profile override fails', () => {
  const data = validContract();
  data.export_profile.anchor_mode = 'absoluteAnchor';
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'EXPORT_RULE_OVERRIDE' || error.code === 'EXPORT_PROFILE_OVERRIDE'));
  assert.equal(result.exportReady, false);
});

test('style export rule override fails', () => {
  const data = validContract();
  data.style.excel_export_rules.native_shapes_only = false;
  const result = validateReferences(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'EXPORT_RULE_OVERRIDE'));
});

'use strict';

/*
 * Application-level reference and business-rule validation.
 *
 * JSON Schema cannot prove that:
 *   node.lane_id exists in lanes
 *   edge.source_node_id / target_node_id exist in nodes
 *   IDs are unique across their arrays
 *   bbox x + width stays inside the normalized image
 *
 * This validator therefore runs after schema validation.
 */

const fs = require('fs');
const path = require('path');
const { getEnums } = require('./validator');

const EPSILON = 1e-9;
const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PROFILE_ID = 'trade_purchase_cn';
const TEMPLATE_PROFILE_VERSION = '1.0.0';
const TEMPLATE_PROFILE_REF = 'docs/agent/flowchart-excel/trade-purchase-template-profile.md';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function addError(errors, code, path, message, details = {}) {
  errors.push({ code, path, message, ...details });
}

function addWarning(warnings, code, path, message, details = {}) {
  warnings.push({ code, path, message, ...details });
}

function addUnresolved(unresolved, item) {
  const id = item.id || `ref_${item.type}_${unresolved.length + 1}`;
  if (unresolved.some((entry) => entry.id === id)) return;
  unresolved.push({
    id,
    type: item.type,
    severity: item.severity,
    description: item.description,
    action: item.action,
    related_ids: item.related_ids || [],
    status: 'pending'
  });
}

function checkBbox(bbox, path, errors, warnings, label) {
  if (!isObject(bbox)) {
    addError(errors, 'INVALID_BBOX', path, `${label} 必须是 bbox 对象。`);
    return;
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!isFiniteNumber(bbox[key])) {
      addError(errors, 'INVALID_BBOX', `${path}/${key}`, `${label}.${key} 必须是有限数值。`);
    }
  }
  if (isFiniteNumber(bbox.width) && bbox.width <= 0) {
    addError(errors, 'INVALID_BBOX', `${path}/width`, `${label}.width 必须大于 0。`);
  }
  if (isFiniteNumber(bbox.height) && bbox.height <= 0) {
    addError(errors, 'INVALID_BBOX', `${path}/height`, `${label}.height 必须大于 0。`);
  }

  if (bbox.coordinate_space === 'normalized') {
    for (const key of ['x', 'y']) {
      if (isFiniteNumber(bbox[key]) && (bbox[key] < 0 || bbox[key] > 1)) {
        addError(errors, 'BBOX_OUT_OF_RANGE', `${path}/${key}`, `${label}.${key} 必须在 0..1。`);
      }
    }
    if (isFiniteNumber(bbox.width) && isFiniteNumber(bbox.height)) {
      if (isFiniteNumber(bbox.x) && bbox.x + bbox.width > 1 + EPSILON) {
        addError(errors, 'BBOX_OUT_OF_RANGE', path, `${label} 的 x + width 超出 1。`);
      }
      if (isFiniteNumber(bbox.y) && bbox.y + bbox.height > 1 + EPSILON) {
        addError(errors, 'BBOX_OUT_OF_RANGE', path, `${label} 的 y + height 超出 1。`);
      }
    }
  } else if (bbox.coordinate_space === 'source_pixels') {
    for (const key of ['x', 'y']) {
      if (isFiniteNumber(bbox[key]) && bbox[key] < 0) {
        addError(errors, 'BBOX_OUT_OF_RANGE', `${path}/${key}`, `${label}.${key} 不能为负。`);
      }
    }
  } else {
    addError(errors, 'INVALID_BBOX', `${path}/coordinate_space`, `${label}.coordinate_space 非法。`);
  }

  if (isFiniteNumber(bbox.x) && isFiniteNumber(bbox.y)) {
    // Only a warning: the source image dimensions are not always present here.
    if (bbox.x < 0 || bbox.y < 0) {
      addWarning(warnings, 'BBOX_NEGATIVE', path, `${label} 存在负坐标。`);
    }
  }
}

function checkUniqueIds(items, path, code, errors) {
  const seen = new Map();
  items.forEach((item, index) => {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id) return;
    if (seen.has(item.id)) {
      addError(errors, code, `${path}/${index}/id`, `重复 ID：${item.id}（首次出现在 ${seen.get(item.id)}）。`);
    } else {
      seen.set(item.id, `${path}/${index}/id`);
    }
  });
  return seen;
}

function validateExportRules(rules, path, expected, errors, warnings) {
  if (!isObject(rules)) {
    addError(errors, 'MISSING_EXPORT_RULES', path, '缺少 export rules。');
    return;
  }
  const constants = {
    native_shapes_only: true,
    native_bound_connectors_only: true,
    one_logical_edge_one_connector: true,
    anchor_mode: 'twoCellAnchor',
    edit_as: ['pending', 'oneCell', 'twoCell'],
    swimlane_background: ['merged_cells_fill_borders', 'template_defined'],
    legend: ['worksheet_cells', 'template_defined'],
    require_excel_drag_save_reopen_test: true
  };
  for (const [key, wanted] of Object.entries(constants)) {
    if (Array.isArray(wanted)) {
      if (!wanted.includes(rules[key])) {
        addError(errors, 'EXPORT_RULE_OVERRIDE', `${path}/${key}`,
          `${key} 必须是 ${wanted.join(' / ')}，实际为 ${String(rules[key])}。`);
      }
    } else if (rules[key] !== wanted) {
      addError(errors, 'EXPORT_RULE_OVERRIDE', `${path}/${key}`,
        `${key} 必须是 ${String(wanted)}，实际为 ${String(rules[key])}。`);
    }
  }
  if (rules.require_windows_acceptance !== true) {
    addWarning(warnings, 'WINDOWS_ACCEPTANCE_PENDING', `${path}/require_windows_acceptance`,
      'Windows Excel 验收尚未在数据中标记为 true；生产导出前必须补录。');
  }
}

/**
 * Validate cross-array references and application-level rules.
 *
 * @param {object} data
 * @returns {{valid:boolean, errors:Array, warnings:Array, unresolved_items:Array, exportReady:boolean}}
 */
function validateReferences(data) {
  const errors = [];
  const warnings = [];
  const unresolved = [];

  if (!isObject(data)) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_DOCUMENT', path: '', message: '输入必须是对象。' }],
      warnings: [],
      unresolved_items: [],
      exportReady: false
    };
  }

  const enums = getEnums() || {};
  const lanes = Array.isArray(data.lanes) ? data.lanes : [];
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const laneIds = checkUniqueIds(lanes, '/lanes', 'DUPLICATE_LANE_ID', errors);
  const nodeIds = checkUniqueIds(nodes, '/nodes', 'DUPLICATE_NODE_ID', errors);
  const edgeIds = checkUniqueIds(edges, '/edges', 'DUPLICATE_EDGE_ID', errors);

  for (let i = 0; i < lanes.length; i += 1) {
    const lane = lanes[i];
    if (!isObject(lane)) continue;
    if (enums.laneOrientations && !enums.laneOrientations.includes(lane.orientation)) {
      addError(errors, 'INVALID_LANE_ORIENTATION', `/lanes/${i}/orientation`, '泳道方向非法。');
    }
    if (lane.bbox !== undefined && lane.bbox !== null) {
      checkBbox(lane.bbox, `/lanes/${i}/bbox`, errors, warnings, `lanes[${i}].bbox`);
    }
  }

  const controlCodePattern = /^(CA|PRP|TOE)[-_]?[0-9]{1,4}[A-Za-z]?$/;
  const controlNumbers = new Map();

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!isObject(node)) continue;
    if (enums.shapes && !enums.shapes.includes(node.shape)) {
      addError(errors, 'INVALID_SHAPE', `/nodes/${i}/shape`, '节点 shape 非法。');
    }
    if (enums.nodeConfidence && !enums.nodeConfidence.includes(node.confidence)) {
      addError(errors, 'INVALID_CONFIDENCE', `/nodes/${i}/confidence`, '节点 confidence 非法。');
    }
    if (enums.nodeReviewStatus && !enums.nodeReviewStatus.includes(node.review_status)) {
      addError(errors, 'INVALID_REVIEW_STATUS', `/nodes/${i}/review_status`, '节点 review_status 非法。');
    }
    if (node.lane_id !== null && node.lane_id !== undefined) {
      if (typeof node.lane_id !== 'string' || !laneIds.has(node.lane_id)) {
        addError(errors, 'INVALID_LANE_REFERENCE', `/nodes/${i}/lane_id`,
          `节点 ${node.id || i} 引用了不存在的 lane_id。`);
      }
    } else {
      addWarning(warnings, 'MISSING_LANE', `/nodes/${i}/lane_id`,
        `节点 ${node.id || i} 未归属泳道。`);
      addUnresolved(unresolved, {
        id: `ref_missing_lane_${node.id || i}`,
        type: 'other',
        severity: 'medium',
        description: `节点 ${node.id || i} 没有可用的 lane_id。`,
        action: '人工确认部门/泳道后补充 lane_id。',
        related_ids: [node.id || String(i)]
      });
    }
    if (node.bbox !== undefined && node.bbox !== null) {
      checkBbox(node.bbox, `/nodes/${i}/bbox`, errors, warnings, `nodes[${i}].bbox`);
    }
    if (Array.isArray(node.controls)) {
      for (let c = 0; c < node.controls.length; c += 1) {
        const control = node.controls[c];
        if (!isObject(control)) {
          addError(errors, 'INVALID_CONTROL', `/nodes/${i}/controls/${c}`, 'control 必须是对象。');
          continue;
        }
        if (enums.controlKinds && !enums.controlKinds.includes(control.kind)) {
          addError(errors, 'INVALID_CONTROL_KIND', `/nodes/${i}/controls/${c}/kind`, '控制标记 kind 非法。');
        }
        if (typeof control.code !== 'string' || !controlCodePattern.test(control.code)) {
          addError(errors, 'INVALID_CONTROL_CODE', `/nodes/${i}/controls/${c}/code`, '控制标记 code 非法。');
        } else {
          const match = control.code.match(/^(CA|PRP|TOE)[-_]?([0-9]{1,4})/i);
          if (match) {
            const kind = match[1].toUpperCase();
            const number = Number(match[2]);
            if (!controlNumbers.has(kind)) controlNumbers.set(kind, new Set());
            controlNumbers.get(kind).add(number);
          }
        }
        if (enums.controlDisplay && !enums.controlDisplay.includes(control.display)) {
          addError(errors, 'INVALID_CONTROL_DISPLAY', `/nodes/${i}/controls/${c}/display`, '控制标记 display 非法。');
        }
        if (enums.controlAttribution && !enums.controlAttribution.includes(control.attribution_status)) {
          addError(errors, 'INVALID_CONTROL_ATTRIBUTION', `/nodes/${i}/controls/${c}/attribution_status`,
            '控制标记 attribution_status 非法。');
        }
      }
    }
    if (node.source_bbox_px !== undefined && node.source_bbox_px !== null) {
      checkBbox(node.source_bbox_px, `/nodes/${i}/source_bbox_px`, errors, warnings,
        `nodes[${i}].source_bbox_px`);
    }
  }

  const outgoingByNode = new Map();
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (!isObject(edge)) continue;
    if (enums.edgeKinds && !enums.edgeKinds.includes(edge.kind)) {
      addError(errors, 'INVALID_EDGE_KIND', `/edges/${i}/kind`, '边 kind 非法。');
    }
    if (enums.edgeRouteHints && !enums.edgeRouteHints.includes(edge.route_hint)) {
      addError(errors, 'INVALID_ROUTE_HINT', `/edges/${i}/route_hint`, 'route_hint 非法。');
    }
    if (enums.edgeConfidence && !enums.edgeConfidence.includes(edge.confidence)) {
      addError(errors, 'INVALID_CONFIDENCE', `/edges/${i}/confidence`, '边 confidence 非法。');
    }
    if (enums.edgeReviewStatus && !enums.edgeReviewStatus.includes(edge.review_status)) {
      addError(errors, 'INVALID_REVIEW_STATUS', `/edges/${i}/review_status`, '边 review_status 非法。');
    }
    for (const side of ['source', 'target']) {
      const key = `${side}_node_id`;
      const value = edge[key];
      if (typeof value !== 'string' || !nodeIds.has(value)) {
        addError(errors, 'DANGLING_EDGE', `/edges/${i}/${key}`,
          `边 ${edge.id || i} 的 ${key} 不存在：${String(value)}。`);
        addUnresolved(unresolved, {
          id: `ref_dangling_${edge.id || i}_${side}`,
          type: 'dangling_edge',
          severity: 'high',
          description: `边 ${edge.id || i} 引用了不存在的 ${key}：${String(value)}。`,
          action: '修正端点或重新识别；不要自动创建节点。',
          related_ids: [edge.id || String(i)]
        });
      }
    }
    if (enums.ports && !enums.ports.includes(edge.source_port)) {
      addError(errors, 'INVALID_PORT', `/edges/${i}/source_port`, 'source_port 非法。');
    }
    if (enums.ports && !enums.ports.includes(edge.target_port)) {
      addError(errors, 'INVALID_PORT', `/edges/${i}/target_port`, 'target_port 非法。');
    }
    if (edge.source_port === null || edge.target_port === null) {
      addWarning(warnings, 'MISSING_PORT', `/edges/${i}`, '连接器端口未确定。');
      addUnresolved(unresolved, {
        id: `ref_missing_port_${edge.id || i}`,
        type: 'missing_port',
        severity: 'high',
        description: `边 ${edge.id || i} 的端口为空。`,
        action: '确认 source_port / target_port 后再导出。',
        related_ids: [edge.id || String(i)]
      });
    }
    if (edge.kind === 'branch' && (!edge.label || !String(edge.label).trim())) {
      addWarning(warnings, 'MISSING_BRANCH_LABEL', `/edges/${i}/label`,
        `分支边 ${edge.id || i} 缺少“是/否”等标签。`);
      addUnresolved(unresolved, {
        id: `ref_missing_branch_label_${edge.id || i}`,
        type: 'ambiguous_branch',
        severity: 'medium',
        description: `分支边 ${edge.id || i} 没有标签。`,
        action: '人工确认分支标签，不要自动补“是/否”。',
        related_ids: [edge.id || String(i)]
      });
    }
    if (typeof edge.source_node_id === 'string') {
      outgoingByNode.set(edge.source_node_id, (outgoingByNode.get(edge.source_node_id) || 0) + 1);
    }
  }

  for (const node of nodes) {
    if (!isObject(node) || node.shape !== 'decision') continue;
    const count = outgoingByNode.get(node.id) || 0;
    if (count < 2) {
      addWarning(warnings, 'DECISION_BRANCH_COUNT', `/nodes/${node.id}`,
        `判断节点 ${node.id} 只有 ${count} 条出边，可能缺少分支。`);
      addUnresolved(unresolved, {
        id: `ref_decision_branches_${node.id}`,
        type: 'ambiguous_branch',
        severity: 'medium',
        description: `判断节点 ${node.id} 的出边少于 2 条。`,
        action: '人工确认是否缺少“是/否”分支。',
        related_ids: [node.id]
      });
    }
  }

  for (const [kind, numbers] of controlNumbers) {
    if (numbers.size === 0) continue;
    const max = Math.max(...numbers);
    const missing = [];
    for (let n = 1; n <= max; n += 1) {
      if (!numbers.has(n)) missing.push(n);
    }
    if (missing.length) {
      addWarning(warnings, 'CONTROL_NUMBER_GAP', '/nodes',
        `${kind} 编号可能存在缺口：${missing.map((n) => kind + n).join(', ')}。`);
      addUnresolved(unresolved, {
        id: `ref_control_gap_${kind.toLowerCase()}`,
        type: 'possible_number_gaps',
        severity: 'medium',
        description: `${kind} 编号可能存在缺口：${missing.map((n) => kind + n).join(', ')}。`,
        action: '与原始制度核对；不要自动创建控制点。',
        related_ids: []
      });
    }
  }

  if (Array.isArray(data.unresolved_items)) {
    for (let i = 0; i < data.unresolved_items.length; i += 1) {
      const item = data.unresolved_items[i];
      if (!isObject(item)) {
        addError(errors, 'INVALID_UNRESOLVED_ITEM', `/unresolved_items/${i}`, 'unresolved item 必须是对象。');
        continue;
      }
      for (const key of ['id', 'type', 'severity', 'description', 'action', 'status']) {
        if (!(key in item)) {
          addError(errors, 'INVALID_UNRESOLVED_ITEM', `/unresolved_items/${i}/${key}`,
            `unresolved item 缺少 ${key}。`);
        }
      }
      if (enums.unresolvedTypes && item.type && !enums.unresolvedTypes.includes(item.type)) {
        addError(errors, 'INVALID_UNRESOLVED_TYPE', `/unresolved_items/${i}/type`, 'unresolved type 非法。');
      }
      if (enums.unresolvedSeverities && item.severity && !enums.unresolvedSeverities.includes(item.severity)) {
        addError(errors, 'INVALID_UNRESOLVED_SEVERITY', `/unresolved_items/${i}/severity`, 'unresolved severity 非法。');
      }
      if (enums.unresolvedStatuses && item.status && !enums.unresolvedStatuses.includes(item.status)) {
        addError(errors, 'INVALID_UNRESOLVED_STATUS', `/unresolved_items/${i}/status`, 'unresolved status 非法。');
      }
    }
  }

  let templateProfileReady = true;
  if (data.template_profile_id !== TEMPLATE_PROFILE_ID) {
    addError(errors, 'INVALID_TEMPLATE_PROFILE', '/template_profile_id',
      `template_profile_id 必须是 ${TEMPLATE_PROFILE_ID}。`);
    templateProfileReady = false;
  }
  if (data.template_profile_version !== TEMPLATE_PROFILE_VERSION) {
    addError(errors, 'INVALID_TEMPLATE_PROFILE_VERSION', '/template_profile_version',
      `template_profile_version 必须是 ${TEMPLATE_PROFILE_VERSION}。`);
    templateProfileReady = false;
  }
  if (data.template_profile_ref !== TEMPLATE_PROFILE_REF) {
    addWarning(warnings, 'TEMPLATE_PROFILE_REF_DIFFERS', '/template_profile_ref',
      `模板 profile 引用不是默认路径 ${TEMPLATE_PROFILE_REF}。`);
  }
  const profilePath = path.resolve(ROOT, String(data.template_profile_ref || TEMPLATE_PROFILE_REF));
  if (!fs.existsSync(profilePath)) {
    addWarning(warnings, 'TEMPLATE_PROFILE_REF_MISSING', '/template_profile_ref',
      `模板 profile 文件不存在：${data.template_profile_ref || TEMPLATE_PROFILE_REF}`);
    templateProfileReady = false;
  }

  if (data.style_overrides !== undefined) {
    const overrides = data.style_overrides;
    if (!isObject(overrides)) {
      addError(errors, 'INVALID_STYLE_OVERRIDES', '/style_overrides', 'style_overrides 必须是对象。');
      templateProfileReady = false;
    } else {
      if (overrides.source !== 'user_explicit') {
        addError(errors, 'UNTRUSTED_STYLE_OVERRIDE', '/style_overrides/source',
          'style_overrides.source 必须是 user_explicit。');
        templateProfileReady = false;
      }
      if (typeof overrides.reason !== 'string' || !overrides.reason.trim()) {
        addError(errors, 'INVALID_STYLE_OVERRIDE_REASON', '/style_overrides/reason',
          'style_overrides.reason 不能为空。');
        templateProfileReady = false;
      }
      const forbidden = new Set([
        'native_shapes_only', 'native_bound_connectors_only',
        'one_logical_edge_one_connector', 'anchor_mode', 'edit_as',
        'swimlane_background', 'legend', 'require_excel_drag_save_reopen_test',
        'require_windows_acceptance', 'excel_export_rules', 'export_profile',
        'template_profile_id', 'template_profile_version', 'template_profile_ref'
      ]);
      if (isObject(overrides.tokens)) {
        for (const key of Object.keys(overrides.tokens)) {
          if (forbidden.has(key)) {
            addError(errors, 'FORBIDDEN_STYLE_OVERRIDE', `/style_overrides/tokens/${key}`,
              `不允许通过 style_overrides 覆盖 ${key}。`);
            templateProfileReady = false;
          }
        }
      } else if (overrides.tokens !== undefined) {
        addError(errors, 'INVALID_STYLE_OVERRIDES', '/style_overrides/tokens',
          'style_overrides.tokens 必须是对象。');
        templateProfileReady = false;
      }
    }
  }

  validateExportRules(data.export_profile, '/export_profile', null, errors, warnings);
  if (data.export_profile && data.export_profile.anchor_mode !== 'twoCellAnchor') {
    addError(errors, 'EXPORT_PROFILE_OVERRIDE', '/export_profile/anchor_mode',
      'anchor_mode 必须是 twoCellAnchor。');
  }
  if (data.style && data.style.excel_export_rules) {
    validateExportRules(data.style.excel_export_rules, '/style/excel_export_rules', null, errors, warnings);
  }

  const highSeverity = unresolved.filter((item) => item.severity === 'high');
  const exportReady = errors.length === 0 && highSeverity.length === 0 &&
    templateProfileReady &&
    data.export_profile?.anchor_mode === 'twoCellAnchor' &&
    data.export_profile?.edit_as !== 'pending' &&
    data.export_profile?.require_windows_acceptance === true;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    unresolved_items: unresolved,
    exportReady
  };
}

module.exports = { validateReferences };

'use strict';

/*
 * Legacy helper-file adapter.
 *
 * Converts the image-extraction helper format into the shared v1.0.0
 * contract. It never invents nodes/edges/ports and never marks a result
 * as human-confirmed.
 */

const { getEnums } = require('./validator');

const ADAPTER_VERSION = '1.0.0';
const TARGET_SCHEMA_VERSION = '1.0.0';
const TEMPLATE_PROFILE_ID = 'trade_purchase_cn';
const TEMPLATE_PROFILE_VERSION = '1.0.0';
const TEMPLATE_PROFILE_REF = 'docs/agent/flowchart-excel/trade-purchase-template-profile.md';

const FORCED_EXPORT_RULES = Object.freeze({
  native_shapes_only: true,
  native_bound_connectors_only: true,
  one_logical_edge_one_connector: true,
  anchor_mode: 'twoCellAnchor',
  edit_as: 'pending',
  swimlane_background: 'template_defined',
  legend: 'template_defined',
  require_excel_drag_save_reopen_test: true,
  require_windows_acceptance: false
});

const FORCED_EXPORT_PROFILE = Object.freeze({
  target: 'editable_excel_native_drawingml',
  anchor_mode: 'twoCellAnchor',
  edit_as: 'pending',
  native_shapes_only: true,
  native_bound_connectors_only: true,
  one_logical_edge_one_connector: true,
  swimlane_background: 'template_defined',
  legend: 'template_defined',
  require_excel_drag_save_reopen_test: true,
  require_windows_acceptance: false,
  shape_mapping: {
    terminator: 'flowChartTerminator',
    process: 'flowChartProcess',
    decision: 'flowChartDecision',
    predefined_process: 'flowChartPredefinedProcess',
    document: 'flowChartDocument',
    input_output: 'flowChartInputOutput',
    database: 'flowChartMagneticDrum'
  }
});

const CONTROL_CODE_PATTERN = /^(CA|PRP|TOE)[-_]?[0-9]{1,4}[A-Za-z]?$/;

const EXTERNAL_VARIANT_EDGE_KINDS = Object.freeze({
  sequence_flow: 'sequence',
  conditional_flow: 'branch',
  feedback_flow: 'loopback',
  document_flow: 'document_output',
  cross_lane_flow: 'other'
});

const EXTERNAL_VARIANT_UNRESOLVED_TYPES = Object.freeze({
  lane_structure: 'other',
  cross_lane_connector: 'other',
  branch_endpoint: 'ambiguous_branch',
  data_reference_connector: 'missing_port',
  text_uncertainty: 'low_confidence',
  control_mapping: 'noncanonical_control_code',
  control_numbering: 'possible_number_gaps',
  coordinates: 'coordinate_out_of_bounds',
  schema_validation: 'other',
  template_style: 'other'
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compact(value) {
  if (Array.isArray(value)) {
    return value.map(compact).filter((item) => item !== undefined);
  }
  if (isObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = compact(item);
    }
    return out;
  }
  return value;
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickUnknown(source, knownKeys) {
  if (!isObject(source)) return {};
  const unknown = {};
  for (const [key, value] of Object.entries(source)) {
    if (!knownKeys.has(key)) unknown[key] = value;
  }
  return unknown;
}

function withLegacyExtensions(target, { sourceFile, unknown, extra } = {}) {
  const legacy = {};
  if (sourceFile) legacy.source_file = sourceFile;
  if (unknown && Object.keys(unknown).length) legacy.unknown_fields = unknown;
  if (extra && Object.keys(extra).length) Object.assign(legacy, extra);
  if (Object.keys(legacy).length) {
    target.extensions = { ...(target.extensions || {}), legacy };
  }
  return target;
}

function makeUnresolved(id, type, severity, description, action, relatedIds = []) {
  return {
    id,
    type,
    severity,
    description,
    action,
    related_ids: relatedIds,
    status: 'pending'
  };
}

function normalizeHash(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(text)
    ? text
    : null;
}

function imageSize(document, coordinateSystem) {
  const direct = document.source_image_size_px;
  if (isObject(direct)) {
    const width = Number(direct.width);
    const height = Number(direct.height);
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      return { width, height };
    }
  }
  const width = Number(coordinateSystem && coordinateSystem.source_image_width);
  const height = Number(coordinateSystem && coordinateSystem.source_image_height);
  if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
    return { width, height };
  }
  return null;
}

function bboxFromLegacy(bbox, imageWidth, imageHeight) {
  if (!isObject(bbox)) return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const w = Number(bbox.w ?? bbox.width);
  const h = Number(bbox.h ?? bbox.height);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > imageWidth || y + h > imageHeight) return null;
  return {
    bbox: {
      x: x / imageWidth,
      y: y / imageHeight,
      width: w / imageWidth,
      height: h / imageHeight,
      coordinate_space: 'normalized'
    },
    sourceBboxPx: {
      x,
      y,
      width: w,
      height: h,
      coordinate_space: 'source_pixels'
    }
  };
}

function rawSourceBbox(bbox) {
  if (!isObject(bbox)) return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const w = Number(bbox.w ?? bbox.width);
  const h = Number(bbox.h ?? bbox.height);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h, coordinate_space: 'source_pixels' };
}

function isTargetContract(input) {
  return isObject(input) &&
    input.schema_version === TARGET_SCHEMA_VERSION &&
    input.template_profile_id === TEMPLATE_PROFILE_ID &&
    input.template_profile_version === TEMPLATE_PROFILE_VERSION &&
    isObject(input.export_profile) &&
    isObject(input.style) &&
    Array.isArray(input.nodes) &&
    input.nodes.every((node) => isObject(node) && Object.prototype.hasOwnProperty.call(node, 'lane_id'));
}

function normalizeControl(rawControl, nodeId, index, warnings, unresolved) {
  if (!isObject(rawControl)) {
    warnings.push({ code: 'INVALID_CONTROL_SKIPPED', path: `/nodes/${nodeId}/controls/${index}`, message: '控制标记不是对象，已跳过。' });
    return null;
  }
  const kind = asString(rawControl.kind).toUpperCase();
  const code = asString(rawControl.code).trim();
  const enums = getEnums() || {};
  const kinds = enums.controlKinds || ['CA', 'PRP', 'TOE'];
  if (!kinds.includes(kind) || !CONTROL_CODE_PATTERN.test(code)) {
    unresolved.push(makeUnresolved(
      `legacy_control_${nodeId}_${index}`,
      'noncanonical_control_code',
      'medium',
      `节点 ${nodeId} 的控制标记 ${kind || '?'} / ${code || '(空)'} 不符合规范。`,
      '人工确认控制标记类型和编号；不要自动创建控制点。',
      [nodeId]
    ));
    return null;
  }
  const display = ['badge', 'inline_text', 'separate_shape'].includes(rawControl.display)
    ? rawControl.display
    : 'badge';
  const attribution = ['confirmed', 'inferred', 'unresolved', 'needs_review'].includes(rawControl.attribution_status)
    ? rawControl.attribution_status
    : 'needs_review';
  const controlUnknown = pickUnknown(rawControl, new Set([
    'kind', 'code', 'display', 'attribution_status', 'style_token', 'notes'
  ]));
  return {
    kind,
    code,
    display,
    attribution_status: attribution,
    extensions: {
      legacy: {
        original_kind: rawControl.kind,
        original_code: rawControl.code,
        style_token: rawControl.style_token,
        notes: rawControl.notes,
        ...(Object.keys(controlUnknown).length ? { unknown_fields: controlUnknown } : {})
      }
    }
  };
}

function inferPorts(edge, nodeById) {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target || !isObject(source.bbox) || !isObject(target.bbox)) return null;
  const sourceCenter = {
    x: source.bbox.x + source.bbox.width / 2,
    y: source.bbox.y + source.bbox.height / 2
  };
  const targetCenter = {
    x: target.bbox.x + target.bbox.width / 2,
    y: target.bbox.y + target.bbox.height / 2
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source_port: 'right', target_port: 'left' }
      : { source_port: 'left', target_port: 'right' };
  }
  return dy >= 0
    ? { source_port: 'bottom', target_port: 'top' }
    : { source_port: 'top', target_port: 'bottom' };
}

function isExternalVariant(input) {
  return isObject(input) &&
    input.schema_version === TARGET_SCHEMA_VERSION &&
    isObject(input.document) &&
    Array.isArray(input.lanes) &&
    Array.isArray(input.nodes) &&
    Array.isArray(input.edges) &&
    !isObject(input.style) &&
    input.nodes.some((node) => isObject(node) && (
      node.bbox?.coordinate_space === 'normalized_image_0_1' ||
      node.source_bbox_px?.coordinate_space === 'original_image_px'
    ));
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizedBboxFromPx(px, imageWidth, imageHeight) {
  if (!isObject(px)) return null;
  const x = Number(px.x);
  const y = Number(px.y);
  const width = Number(px.width ?? px.w);
  const height = Number(px.height ?? px.h);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > imageWidth || y + height > imageHeight) return null;
  return {
    x: x / imageWidth,
    y: y / imageHeight,
    width: width / imageWidth,
    height: height / imageHeight,
    coordinate_space: 'normalized'
  };
}

function sourceBboxFromPx(px) {
  if (!isObject(px)) return null;
  const x = Number(px.x);
  const y = Number(px.y);
  const width = Number(px.width ?? px.w);
  const height = Number(px.height ?? px.h);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  return { x, y, width, height, coordinate_space: 'source_pixels' };
}

function normalizedExternalKind(value) {
  return EXTERNAL_VARIANT_EDGE_KINDS[value] || 'other';
}

function externalRouteHint(value, sourcePort, targetPort) {
  if (value === 'feedback') return 'loopback';
  if (value === 'uncertain') return 'manual_review';
  if (value === 'straight') {
    const horizontal = ['left', 'right'];
    const vertical = ['top', 'bottom'];
    if (horizontal.includes(sourcePort) && horizontal.includes(targetPort)) return 'straight_horizontal';
    if (vertical.includes(sourcePort) && vertical.includes(targetPort)) return 'straight_vertical';
  }
  return 'manual_review';
}

function externalUnresolvedType(value) {
  return EXTERNAL_VARIANT_UNRESOLVED_TYPES[value] || 'other';
}

function externalProvenance(rawProvenance, fallbackNotes = '') {
  const provenance = isObject(rawProvenance) ? rawProvenance : {};
  const notes = [provenance.method, provenance.evidence, provenance.notes]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' | ') || fallbackNotes;
  return {
    source: 'image_extraction',
    source_ref: 'external_ai_variant',
    notes,
    legacy: provenance
  };
}

/**
 * Adapt the external AI variant used by helper packages that already carry
 * nodes/edges but omit the canonical root style/document metadata.
 *
 * The mapping is explicit and conservative: noncanonical control codes are
 * dropped from controls and recorded as unresolved items, and route hints that
 * cannot be inferred are marked manual_review.
 */
function adaptExternalVariant(raw, options = {}) {
  const warnings = [];
  const errors = [];
  const unresolved = [];
  const enums = getEnums() || {};
  const sourceFile = options.sourceFile || 'flowchart.json';
  const meta = isObject(options.meta) ? options.meta : {};
  const importedStyle = isObject(options.importedStyle) ? options.importedStyle : {};
  const rawDocument = isObject(raw.document) ? raw.document : {};

  const width = positiveInt(rawDocument.image_width_px ?? meta.imageWidth);
  const height = positiveInt(rawDocument.image_height_px ?? meta.imageHeight);
  if (!width || !height) {
    return {
      ok: false,
      errors: [{ code: 'MISSING_IMAGE_SIZE', message: '外部流程图缺少有效的原图 width/height。' }],
      warnings: [],
      unresolved_items: [],
      report: null
    };
  }

  const sourceHash = normalizeHash(rawDocument.source_image_sha256) || normalizeHash(meta.sourceSha256);
  const createdAt = normalizeTimestamp(rawDocument.created_at) || normalizeTimestamp(meta.createdAt) ||
    '1970-01-01T00:00:00Z';
  if (!normalizeTimestamp(rawDocument.created_at) && normalizeTimestamp(meta.createdAt)) {
    warnings.push({ code: 'CREATED_AT_FROM_JOB', path: '/document/created_at', message: '流程图未提供 created_at，已使用任务创建时间。' });
  } else if (!normalizeTimestamp(rawDocument.created_at) && !normalizeTimestamp(meta.createdAt)) {
    warnings.push({ code: 'MISSING_CREATED_AT', path: '/document/created_at', message: '缺少时间戳，使用 epoch 占位。' });
  }

  const document = {
    title: asString(rawDocument.title, '未命名流程图'),
    source_type: 'image',
    source_image_name: rawDocument.source_image || meta.originalFilename || null,
    source_image_sha256: sourceHash,
    source_image_size_px: { width, height },
    created_at: createdAt,
    extraction_status: 'draft_requires_human_validation',
    disclaimer: 'External AI visual extraction; the website did not perform AI extraction. All results require human review.',
    extensions: {
      legacy: {
        source_file: sourceFile,
        original_document: rawDocument
      }
    }
  };

  const lanes = [];
  const laneById = new Set();
  for (let i = 0; i < raw.lanes.length; i += 1) {
    const item = raw.lanes[i];
    if (!isObject(item)) {
      warnings.push({ code: 'LANE_SKIPPED', path: `/lanes/${i}`, message: '泳道不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `lane${i + 1}`);
    if (laneById.has(id)) {
      errors.push({ code: 'DUPLICATE_LANE_ID', path: `/lanes/${i}/id`, message: `重复泳道 ID：${id}。` });
      continue;
    }
    const orientation = enums.laneOrientations?.includes(item.orientation) ? item.orientation : 'horizontal';
    if (!item.orientation) {
      warnings.push({ code: 'LANE_ORIENTATION_INFERRED', path: `/lanes/${i}/orientation`, message: `泳道 ${id} 未提供 orientation，已按 horizontal 处理。` });
    }
    const lane = {
      id,
      label: asString(item.label, id),
      order: Number.isInteger(item.order) ? item.order : i,
      orientation
    };
    const bbox = normalizedBboxFromPx(item.bbox_px, width, height);
    const sourceBbox = sourceBboxFromPx(item.bbox_px);
    if (bbox) lane.bbox = bbox;
    if (sourceBbox) lane.source_bbox_px = sourceBbox;
    if (!bbox) {
      unresolved.push(makeUnresolved(
        `external_lane_bbox_${id}`,
        'coordinate_out_of_bounds',
        'medium',
        `泳道 ${id} 的 bbox_px 缺失或无法转换。`,
        '核对泳道边界。',
        [id]
      ));
    }
    withLegacyExtensions(lane, {
      sourceFile,
      extra: {
        confidence: item.confidence,
        review_status: item.review_status,
        provenance: item.provenance,
        source_bbox_px: item.bbox_px
      }
    });
    lanes.push(lane);
    laneById.add(id);
  }

  const nodes = [];
  const nodeIds = new Set();
  for (let i = 0; i < raw.nodes.length; i += 1) {
    const item = raw.nodes[i];
    if (!isObject(item)) {
      warnings.push({ code: 'NODE_SKIPPED', path: `/nodes/${i}`, message: '节点不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `node${i + 1}`);
    if (nodeIds.has(id)) {
      errors.push({ code: 'DUPLICATE_NODE_ID', path: `/nodes/${i}/id`, message: `重复节点 ID：${id}。` });
      continue;
    }
    const bbox = isObject(item.bbox)
      ? {
          x: Number(item.bbox.x),
          y: Number(item.bbox.y),
          width: Number(item.bbox.width),
          height: Number(item.bbox.height),
          coordinate_space: 'normalized'
        }
      : null;
    const sourceBbox = isObject(item.source_bbox_px)
      ? {
          x: Number(item.source_bbox_px.x),
          y: Number(item.source_bbox_px.y),
          width: Number(item.source_bbox_px.width),
          height: Number(item.source_bbox_px.height),
          coordinate_space: 'source_pixels'
        }
      : null;
    if (!bbox || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite) ||
        bbox.x < 0 || bbox.y < 0 || bbox.width <= 0 || bbox.height <= 0 ||
        bbox.x + bbox.width > 1 + 1e-9 || bbox.y + bbox.height > 1 + 1e-9) {
      errors.push({ code: 'INVALID_NODE_BBOX', path: `/nodes/${i}/bbox`, message: `节点 ${id} 的 bbox 无效。` });
      unresolved.push(makeUnresolved(
        `external_node_bbox_${id}`,
        'coordinate_out_of_bounds',
        'high',
        `节点 ${id} 的 bbox 无效或超出原图。`,
        '核对节点坐标。',
        [id]
      ));
      continue;
    }

    const rawShape = asString(item.shape).toLowerCase().replace(/[-\s]+/g, '_');
    let shape = enums.shapes?.includes(rawShape) ? rawShape : 'other';
    const shapeWasMapped = shape !== rawShape;
    if (shapeWasMapped) {
      unresolved.push(makeUnresolved(
        `external_shape_${id}`,
        'unknown_shape',
        'low',
        `节点 ${id} 的形状 ${item.shape} 不是目标枚举；已保留为 other。`,
        '人工确认图形类型后更新。',
        [id]
      ));
    }

    const controls = [];
    const invalidControls = [];
    if (Array.isArray(item.controls)) {
      item.controls.forEach((control, index) => {
        const normalized = normalizeControl(control, id, index, warnings, unresolved);
        if (normalized) controls.push(normalized);
        else invalidControls.push(control);
      });
    }

    const rawLaneId = item.lane_id;
    const laneId = typeof rawLaneId === 'string' && laneById.has(rawLaneId) ? rawLaneId : null;
    if (rawLaneId && !laneId) {
      unresolved.push(makeUnresolved(
        `external_lane_missing_${id}`,
        'other',
        'medium',
        `节点 ${id} 引用了不存在的泳道 ${rawLaneId}。`,
        '人工确认泳道。',
        [id]
      ));
    }

    const confidence = enums.nodeConfidence?.includes(item.confidence) ? item.confidence : 'low';
    const reviewStatus = enums.nodeReviewStatus?.includes(item.review_status) ? item.review_status : 'pending';
    const node = {
      id,
      label: asString(item.label, ''),
      shape,
      lane_id: laneId,
      bbox,
      controls,
      confidence,
      review_status: reviewStatus,
      provenance: externalProvenance(item.provenance, asString(item.notes, ''))
    };
    if (sourceBbox) {
      node.source_bbox_px = sourceBbox;
    } else {
      unresolved.push(makeUnresolved(
        `external_node_source_bbox_${id}`,
        'coordinate_out_of_bounds',
        'medium',
        `节点 ${id} 缺少有效的 source_bbox_px。`,
        '核对原图像素坐标。',
        [id]
      ));
    }
    const unknown = pickUnknown(item, new Set([
      'id', 'label', 'shape', 'lane_id', 'bbox', 'source_bbox_px',
      'controls', 'confidence', 'review_status', 'provenance'
    ]));
    withLegacyExtensions(node, {
      sourceFile,
      unknown,
      extra: {
        original_shape: shapeWasMapped ? item.shape : undefined,
        original_bbox: item.bbox,
        original_source_bbox_px: item.source_bbox_px,
        invalid_controls: invalidControls.length ? invalidControls : undefined
      }
    });
    nodes.push(node);
    nodeIds.add(id);
  }

  const edges = [];
  const edgeIds = new Set();
  for (let i = 0; i < raw.edges.length; i += 1) {
    const item = raw.edges[i];
    if (!isObject(item)) {
      warnings.push({ code: 'EDGE_SKIPPED', path: `/edges/${i}`, message: '连线不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `edge${i + 1}`);
    if (edgeIds.has(id)) {
      errors.push({ code: 'DUPLICATE_EDGE_ID', path: `/edges/${i}/id`, message: `重复连线 ID：${id}。` });
      continue;
    }
    const source = asString(item.source_node_id);
    const target = asString(item.target_node_id);
    const sourcePort = enums.ports?.includes(item.source_port) ? item.source_port : null;
    const targetPort = enums.ports?.includes(item.target_port) ? item.target_port : null;
    const kind = normalizedExternalKind(item.kind);
    const routeHint = externalRouteHint(item.route_hint, sourcePort, targetPort);
    const confidence = enums.edgeConfidence?.includes(item.confidence) ? item.confidence : 'low';
    const reviewStatus = enums.edgeReviewStatus?.includes(item.review_status) ? item.review_status : 'pending';
    const edge = {
      id,
      source_node_id: source,
      target_node_id: target,
      source_port: sourcePort,
      target_port: targetPort,
      kind,
      label: item.label === null || item.label === undefined || item.label === '' ? null : String(item.label),
      route_hint: routeHint,
      confidence,
      review_status: reviewStatus,
      provenance: externalProvenance(item.provenance, asString(item.notes, ''))
    };
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      unresolved.push(makeUnresolved(
        `external_dangling_${id}`,
        'dangling_edge',
        'high',
        `边 ${id} 的端点不存在：${source || '(空)'} -> ${target || '(空)'}。`,
        '修正端点；不要自动创建节点。',
        [id]
      ));
    }
    const unknown = pickUnknown(item, new Set([
      'id', 'source_node_id', 'target_node_id', 'source_port', 'target_port',
      'kind', 'label', 'route_hint', 'confidence', 'review_status', 'provenance'
    ]));
    withLegacyExtensions(edge, {
      sourceFile,
      unknown,
      extra: {
        original_kind: kind !== item.kind ? item.kind : undefined,
        original_route_hint: routeHint !== item.route_hint ? item.route_hint : undefined,
        original_provenance: item.provenance
      }
    });
    edges.push(edge);
    edgeIds.add(id);
  }

  const rawUnresolved = Array.isArray(raw.unresolved_items) ? raw.unresolved_items : [];
  for (let i = 0; i < rawUnresolved.length; i += 1) {
    const item = rawUnresolved[i];
    if (!isObject(item)) continue;
    const id = asString(item.id, `external_unresolved_${i + 1}`);
    if (unresolved.some((entry) => entry.id === id)) continue;
    const type = externalUnresolvedType(item.item_type);
    const severity = item.confidence === 'low' ? 'medium' : 'low';
    const normalized = makeUnresolved(
      id,
      type,
      severity,
      asString(item.description, '外部辅助文件中的待确认项。'),
      asString(item.recommended_review, '请人工确认。'),
      Array.isArray(item.related_node_ids) ? item.related_node_ids : []
    );
    const unknown = pickUnknown(item, new Set([
      'id', 'item_type', 'description', 'related_node_ids',
      'confidence', 'review_status', 'recommended_review'
    ]));
    withLegacyExtensions(normalized, {
      sourceFile,
      unknown,
      extra: {
        original_type: item.item_type,
        original_confidence: item.confidence,
        original_review_status: item.review_status
      }
    });
    unresolved.push(normalized);
  }

  const style = {
    theme: {},
    excel_export_rules: clone(FORCED_EXPORT_RULES),
    extensions: {
      legacy: {
        source_file: 'external-helper-package/style.json',
        original_style: importedStyle
      }
    }
  };

  const data = {
    schema_version: TARGET_SCHEMA_VERSION,
    template_profile_id: TEMPLATE_PROFILE_ID,
    template_profile_version: TEMPLATE_PROFILE_VERSION,
    template_profile_ref: TEMPLATE_PROFILE_REF,
    document,
    lanes,
    nodes,
    edges,
    style,
    unresolved_items: unresolved,
    export_profile: {
      ...clone(FORCED_EXPORT_PROFILE),
      extensions: {
        legacy: {
          source_file: sourceFile,
          original_export_profile: raw.export_profile
        }
      }
    },
    extensions: {
      legacy: {
        source_file: sourceFile,
        adapter_version: ADAPTER_VERSION,
        source_schema_version: raw.schema_version || null,
        source_format: 'external_ai_variant',
        original_document: rawDocument,
        original_export_profile: raw.export_profile,
        unknown_fields: pickUnknown(raw, new Set([
          'schema_version', 'template_profile_id', 'template_profile_version',
          'template_profile_ref', 'document', 'lanes', 'nodes', 'edges',
          'unresolved_items', 'export_profile'
        ]))
      }
    }
  };

  return {
    ok: errors.length === 0,
    alreadyAdapted: false,
    data: compact(data),
    errors,
    warnings,
    unresolved_items: unresolved,
    report: {
      adapter_version: ADAPTER_VERSION,
      source_schema_version: raw.schema_version || null,
      source_format: 'external_ai_variant',
      target_schema_version: TARGET_SCHEMA_VERSION,
      already_adapted: false,
      counts: {
        lanes_in: raw.lanes.length,
        lanes_out: lanes.length,
        nodes_in: raw.nodes.length,
        nodes_out: nodes.length,
        edges_in: raw.edges.length,
        edges_out: edges.length
      },
      mapped_fields: [
        'document.image_width_px/image_height_px -> document.source_image_size_px',
        'lanes[].bbox_px -> lanes[].bbox + source_bbox_px',
        'lanes[].orientation default horizontal',
        'nodes[].bbox.coordinate_space -> normalized',
        'nodes[].source_bbox_px.coordinate_space -> source_pixels',
        'nodes[].provenance -> image_extraction provenance with raw provenance preserved',
        'edges[].kind -> target enum',
        'edges[].route_hint -> target enum or manual_review',
        'unresolved_items[].item_type -> target enum',
        'style.json -> forced trade_purchase_cn export rules'
      ],
      warnings: warnings.map((warning) => ({ ...warning })),
      unresolved_added: unresolved.map((item) => item.id),
      dropped_entities: []
    }
  };
}

/**
 * Adapt one legacy helper flowchart object.
 *
 * @param {object|string} input
 * @param {{sourceFile?:string}} [options]
 */
function adaptLegacyFlowchart(input, options = {}) {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (_error) {
      return {
        ok: false,
        errors: [{ code: 'INVALID_JSON', message: '输入不是合法 JSON。' }],
        warnings: [],
        unresolved_items: [],
        report: null
      };
    }
  }

  if (!isObject(raw)) {
    return {
      ok: false,
      errors: [{ code: 'INVALID_DOCUMENT', message: '输入必须是 JSON 对象。' }],
      warnings: [],
      unresolved_items: [],
      report: null
    };
  }

  if (isExternalVariant(raw)) {
    return adaptExternalVariant(raw, options);
  }

  if (isTargetContract(raw)) {
    const data = clone(raw);
    return {
      ok: true,
      alreadyAdapted: true,
      data,
      errors: [],
      warnings: [],
      unresolved_items: [],
      report: {
        adapter_version: ADAPTER_VERSION,
        source_schema_version: raw.schema_version,
        target_schema_version: TARGET_SCHEMA_VERSION,
        already_adapted: true,
        counts: {
          lanes_in: data.lanes.length,
          lanes_out: data.lanes.length,
          nodes_in: data.nodes.length,
          nodes_out: data.nodes.length,
          edges_in: data.edges.length,
          edges_out: data.edges.length
        },
        warnings: [],
        unresolved_added: [],
        unknown_fields_preserved: [],
        dropped_entities: [],
        message: '输入已是目标 schema_version，无需再次适配。'
      }
    };
  }

  const enums = getEnums() || {};
  const warnings = [];
  const errors = [];
  const unresolved = [];
  const sourceFile = options.sourceFile || 'flowchart.json';
  const document = isObject(raw.document) ? raw.document : {};
  const coordinateSystem = isObject(raw.coordinate_system) ? raw.coordinate_system : {};
  const size = imageSize(document, coordinateSystem);
  if (!size) {
    return {
      ok: false,
      errors: [{ code: 'MISSING_IMAGE_SIZE', message: '旧辅助文件缺少有效的原图 width/height，无法归一化 bbox。' }],
      warnings: [],
      unresolved_items: [
        makeUnresolved('legacy_missing_image_size', 'coordinate_out_of_bounds', 'high',
          '缺少原图尺寸，无法转换 bbox。', '补充原图尺寸后重新适配。')
      ],
      report: {
        adapter_version: ADAPTER_VERSION,
        source_schema_version: raw.schema_version || null,
        target_schema_version: TARGET_SCHEMA_VERSION,
        already_adapted: false,
        counts: { lanes_in: 0, lanes_out: 0, nodes_in: 0, nodes_out: 0, edges_in: 0, edges_out: 0 },
        warnings: [],
        unresolved_added: ['legacy_missing_image_size'],
        unknown_fields_preserved: [],
        dropped_entities: []
      }
    };
  }

  const rawLanes = Array.isArray(raw.lanes) ? raw.lanes : [];
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const lanes = [];
  const laneById = new Map();
  const laneByLabel = new Map();
  const laneUnknownFields = [];

  for (let i = 0; i < rawLanes.length; i += 1) {
    const item = rawLanes[i];
    if (!isObject(item)) {
      warnings.push({ code: 'LANE_SKIPPED', path: `/lanes/${i}`, message: '泳道不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `lane${i + 1}`);
    if (laneById.has(id)) {
      errors.push({ code: 'DUPLICATE_LANE_ID', path: `/lanes/${i}/id`, message: `重复泳道 ID：${id}。` });
      continue;
    }
    const bboxResult = item.bbox_px ? bboxFromLegacy(item.bbox_px, size.width, size.height) : null;
    let unresolvedLaneSourceBbox = null;
    if (item.bbox_px && !bboxResult) {
      unresolvedLaneSourceBbox = rawSourceBbox(item.bbox_px);
      unresolved.push(makeUnresolved(
        `legacy_lane_bbox_${id}`,
        'coordinate_out_of_bounds',
        'medium',
        `泳道 ${id} 的 bbox_px 无效或超出原图。`,
        '核对泳道边界；不要静默裁剪。',
        [id]
      ));
    }
    const lane = {
      id,
      label: asString(item.label, id),
      order: Number.isInteger(item.order) ? item.order : i,
      orientation: enums.laneOrientations?.includes(item.orientation) ? item.orientation : 'horizontal'
    };
    if (bboxResult) {
      lane.bbox = bboxResult.bbox;
      lane.source_bbox_px = bboxResult.sourceBboxPx;
    } else if (unresolvedLaneSourceBbox) {
      lane.source_bbox_px = unresolvedLaneSourceBbox;
    }
    const unknown = pickUnknown(item, new Set(['id', 'label', 'order', 'orientation', 'bbox_px', 'notes']));
    if (item.notes) unknown.notes = item.notes;
    withLegacyExtensions(lane, { sourceFile, unknown });
    lanes.push(lane);
    laneById.set(id, lane);
    const labelKey = lane.label.trim();
    if (!laneByLabel.has(labelKey)) laneByLabel.set(labelKey, []);
    laneByLabel.get(labelKey).push(lane);
    if (Object.keys(unknown).length) laneUnknownFields.push(`lanes[${i}]`);
  }

  const nodeById = new Map();
  const nodes = [];
  const nodeUnknownFields = [];
  const nodeKnown = new Set(['id', 'label', 'shape', 'lane', 'bbox_px', 'controls', 'confidence', 'text_status', 'notes', 'review_status', 'provenance']);

  for (let i = 0; i < rawNodes.length; i += 1) {
    const item = rawNodes[i];
    if (!isObject(item)) {
      warnings.push({ code: 'NODE_SKIPPED', path: `/nodes/${i}`, message: '节点不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `n${i + 1}`);
    if (nodeById.has(id)) {
      errors.push({ code: 'DUPLICATE_NODE_ID', path: `/nodes/${i}/id`, message: `重复节点 ID：${id}。` });
      continue;
    }
    const bboxResult = item.bbox_px ? bboxFromLegacy(item.bbox_px, size.width, size.height) : null;
    let unresolvedSourceBbox = null;
    if (!bboxResult) {
      const rawBbox = rawSourceBbox(item.bbox_px);
      if (rawBbox) unresolvedSourceBbox = rawBbox;
      errors.push({ code: 'INVALID_NODE_BBOX', path: `/nodes/${i}/bbox_px`, message: `节点 ${id} 的 bbox_px 缺失或无效。` });
      unresolved.push(makeUnresolved(
        `legacy_node_bbox_${id}`,
        'coordinate_out_of_bounds',
        'high',
        `节点 ${id} 的 bbox 无法转换。`,
        '核对原图尺寸和节点坐标后重新适配。',
        [id]
      ));
    }

    let laneId = null;
    const laneToken = asString(item.lane).trim();
    if (laneToken) {
      if (laneById.has(laneToken)) {
        laneId = laneToken;
      } else if (laneByLabel.has(laneToken) && laneByLabel.get(laneToken).length === 1) {
        laneId = laneByLabel.get(laneToken)[0].id;
        warnings.push({ code: 'LANE_MAPPED_BY_LABEL', path: `/nodes/${i}/lane`, message: `节点 ${id} 的泳道按显示名称映射到 ${laneId}。` });
      } else {
        unresolved.push(makeUnresolved(
          `legacy_lane_missing_${id}`,
          'other',
          'medium',
          `节点 ${id} 的泳道“${laneToken}”无法唯一匹配。`,
          '人工确认部门/泳道；不要自动创建泳道。',
          [id]
        ));
      }
    } else {
      unresolved.push(makeUnresolved(
        `legacy_lane_missing_${id}`,
        'other',
        'medium',
        `节点 ${id} 没有泳道信息。`,
        '人工确认部门/泳道。',
        [id]
      ));
    }

    const normalizedShape = asString(item.shape).toLowerCase().replace(/[-\s]+/g, '_');
    const nodeExtraLegacy = {};
    const shape = enums.shapes?.includes(normalizedShape) ? normalizedShape : 'other';
    if (item.shape && shape === 'other' && normalizedShape !== 'other') {
      nodeExtraLegacy.original_shape = item.shape;
      unresolved.push(makeUnresolved(
        `legacy_shape_${id}`,
        'unknown_shape',
        'medium',
        `节点 ${id} 的形状 ${item.shape} 不在契约枚举中。`,
        '人工确认图形类型。',
        [id]
      ));
    }

    const confidence = enums.nodeConfidence?.includes(asString(item.confidence).toLowerCase())
      ? asString(item.confidence).toLowerCase()
      : 'low';
    const reviewStatus = enums.nodeReviewStatus?.includes(asString(item.review_status))
      ? item.review_status
      : 'pending';
    if (item.review_status && reviewStatus !== item.review_status) {
      nodeExtraLegacy.original_review_status = item.review_status;
    }
    if (item.confidence && confidence !== asString(item.confidence).toLowerCase()) {
      nodeExtraLegacy.original_confidence = item.confidence;
    }

    const controls = [];
    const invalidControls = [];
    if (Array.isArray(item.controls)) {
      item.controls.forEach((control, index) => {
        const normalized = normalizeControl(control, id, index, warnings, unresolved);
        if (normalized) controls.push(normalized);
        else invalidControls.push(control);
      });
    }

    const provenanceSource = enums.provenanceSources?.includes(item.provenance?.source)
      ? item.provenance.source
      : 'image_extraction';
    const node = {
      id,
      label: asString(item.label, ''),
      shape,
      lane_id: laneId,
      controls,
      confidence,
      review_status: reviewStatus,
      provenance: {
        source: provenanceSource,
        source_ref: item.provenance?.source_ref || 'legacy_helper_files',
        notes: asString(item.notes, ''),
        legacy: {
          original_id: item.id,
          original_lane: item.lane,
          text_status: item.text_status,
          source_of_relationship: item.source_of_relationship,
          raw_provenance: item.provenance
        }
      }
    };
    if (bboxResult) {
      node.bbox = bboxResult.bbox;
      node.source_bbox_px = bboxResult.sourceBboxPx;
    } else if (unresolvedSourceBbox) {
      node.source_bbox_px = unresolvedSourceBbox;
    }
    const unknown = pickUnknown(item, nodeKnown);
    if (Object.keys(unknown).length) nodeUnknownFields.push(`nodes[${i}]`);
    if (invalidControls.length) nodeExtraLegacy.invalid_controls = invalidControls;
    withLegacyExtensions(node, {
      sourceFile,
      unknown,
      extra: Object.keys(nodeExtraLegacy).length ? nodeExtraLegacy : undefined
    });
    nodes.push(node);
    nodeById.set(id, node);
  }

  const edges = [];
  const edgeUnknownFields = [];
  const edgeKnown = new Set(['id', 'source', 'target', 'kind', 'label', 'route_hint', 'confidence', 'source_of_relationship', 'notes', 'source_port', 'target_port', 'review_status', 'provenance']);

  for (let i = 0; i < rawEdges.length; i += 1) {
    const item = rawEdges[i];
    if (!isObject(item)) {
      warnings.push({ code: 'EDGE_SKIPPED', path: `/edges/${i}`, message: '连线不是对象，已跳过。' });
      continue;
    }
    const id = asString(item.id, `e${i + 1}`);
    const kind = enums.edgeKinds?.includes(item.kind) ? item.kind : 'other';
    const routeHint = enums.edgeRouteHints?.includes(item.route_hint) ? item.route_hint : 'manual_review';
    const confidence = enums.edgeConfidence?.includes(item.confidence) ? item.confidence : 'low';
    const reviewStatus = enums.edgeReviewStatus?.includes(item.review_status) ? item.review_status : 'pending';
    const source = asString(item.source);
    const target = asString(item.target);
    const edgeExtraLegacy = {};
    if (item.kind && kind !== item.kind) edgeExtraLegacy.original_kind = item.kind;
    if (item.route_hint && routeHint !== item.route_hint) edgeExtraLegacy.original_route_hint = item.route_hint;
    if (item.confidence && confidence !== item.confidence) edgeExtraLegacy.original_confidence = item.confidence;
    if (item.review_status && reviewStatus !== item.review_status) edgeExtraLegacy.original_review_status = item.review_status;

    if (!nodeById.has(source) || !nodeById.has(target)) {
      unresolved.push(makeUnresolved(
        `legacy_dangling_${id}`,
        'dangling_edge',
        'high',
        `边 ${id} 的端点不存在：${source || '(空)'} -> ${target || '(空)'}。`,
        '修正端点；不要自动创建节点。',
        [id]
      ));
    }

    let sourcePort = enums.ports?.includes(item.source_port) ? item.source_port : undefined;
    let targetPort = enums.ports?.includes(item.target_port) ? item.target_port : undefined;
    let inference = null;
    if (sourcePort === undefined || targetPort === undefined) {
      if (kind !== 'loopback' && kind !== 'manual_review') {
        inference = inferPorts({ source, target }, nodeById);
      }
      if (inference) {
        sourcePort = inference.source_port;
        targetPort = inference.target_port;
        warnings.push({ code: 'PORT_INFERRED', path: `/edges/${i}`, message: `边 ${id} 的端口按 bbox 相对位置推断。` });
        unresolved.push(makeUnresolved(
          `legacy_port_inferred_${id}`,
          'missing_port',
          'medium',
          `边 ${id} 的端口由 bbox 推断，需人工确认。`,
          '确认连接点；不要将推断当作已确认。',
          [id]
        ));
      }
    }
    if (sourcePort === undefined) sourcePort = null;
    if (targetPort === undefined) targetPort = null;
    if (sourcePort === null || targetPort === null) {
      unresolved.push(makeUnresolved(
        `legacy_port_missing_${id}`,
        'missing_port',
        'high',
        `边 ${id} 的端口无法可靠推断。`,
        '人工确认 source_port / target_port 后再导出。',
        [id]
      ));
    }

    const edge = {
      id,
      source_node_id: source,
      target_node_id: target,
      source_port: sourcePort,
      target_port: targetPort,
      kind,
      label: item.label === null || item.label === undefined || item.label === '' ? null : String(item.label),
      route_hint: routeHint,
      confidence,
      review_status: reviewStatus,
      provenance: {
        source: enums.provenanceSources?.includes(item.provenance?.source) ? item.provenance.source : 'image_extraction',
        source_ref: item.provenance?.source_ref || 'legacy_helper_files',
        notes: asString(item.notes, ''),
        legacy: {
          original_id: item.id,
          original_source: item.source,
          original_target: item.target,
          source_of_relationship: item.source_of_relationship,
          port_inference: inference ? 'geometry_v1' : null,
          raw_provenance: item.provenance
        }
      }
    };
    const unknown = pickUnknown(item, edgeKnown);
    if (Object.keys(unknown).length) edgeUnknownFields.push(`edges[${i}]`);
    withLegacyExtensions(edge, {
      sourceFile,
      unknown,
      extra: Object.keys(edgeExtraLegacy).length ? edgeExtraLegacy : undefined
    });
    edges.push(edge);
  }

  const oldUnresolved = Array.isArray(raw.unresolved_items) ? raw.unresolved_items : [];
  for (let i = 0; i < oldUnresolved.length; i += 1) {
    const item = oldUnresolved[i];
    if (!isObject(item)) continue;
    const type = enums.unresolvedTypes?.includes(item.type) ? item.type : 'other';
    const severity = enums.unresolvedSeverities?.includes(item.severity) ? item.severity : 'medium';
    const id = asString(item.id, `legacy_unresolved_${i + 1}`);
    if (unresolved.some((entry) => entry.id === id)) continue;
    const normalized = makeUnresolved(
      id,
      type,
      severity,
      asString(item.description, '旧辅助文件中的待确认项。'),
      asString(item.action, '请人工确认。'),
      Array.isArray(item.related_ids) ? item.related_ids : []
    );
    const unknown = pickUnknown(item, new Set(['id', 'type', 'severity', 'description', 'action', 'related_ids', 'status']));
    withLegacyExtensions(normalized, { sourceFile, unknown });
    unresolved.push(normalized);
  }

  const rawStyle = isObject(raw.style) ? raw.style : {};
  const style = {
    // The target template profile is the sole visual source. Legacy theme
    // values are retained only for audit, never as the final authority.
    theme: {},
    excel_export_rules: clone(FORCED_EXPORT_RULES)
  };
  const styleUnknown = pickUnknown(rawStyle, new Set(['theme', 'excel_export_rules', 'status', 'schema_version', 'source_image_name', 'coordinate_system']));
  withLegacyExtensions(style, {
    sourceFile,
    unknown: styleUnknown,
    extra: {
      original_status: rawStyle.status,
      original_schema_version: rawStyle.schema_version,
      source_image_name: rawStyle.source_image_name,
      coordinate_system: rawStyle.coordinate_system,
      original_export_rules: rawStyle.excel_export_rules,
      original_theme: rawStyle.theme
    }
  });

  const sourceImageSha256 = normalizeHash(document.source_image_sha256);
  if (document.source_image_sha256 && !sourceImageSha256) {
    warnings.push({ code: 'INVALID_SOURCE_HASH', path: '/document/source_image_sha256', message: '源图哈希格式无效，已置为 null。' });
  }
  const createdAt = normalizeTimestamp(document.generated_at_utc) ||
    normalizeTimestamp(document.created_at) ||
    '1970-01-01T00:00:00Z';
  if (!normalizeTimestamp(document.generated_at_utc) && !normalizeTimestamp(document.created_at)) {
    warnings.push({ code: 'MISSING_CREATED_AT', path: '/document/created_at', message: '缺少时间戳，使用 epoch 占位。' });
  }

  const documentKnown = new Set([
    'title', 'source_type', 'source_image_name', 'source_image_sha256',
    'source_image_size_px', 'generated_at_utc', 'created_at', 'extraction_status',
    'disclaimer', 'job_id'
  ]);
  const documentUnknown = pickUnknown(document, documentKnown);
  const documentOut = {
    title: asString(document.title, '未命名流程图'),
    source_type: ['image', 'pdf', 'structured_json'].includes(document.source_type) ? document.source_type : 'image',
    source_image_name: document.source_image_name ?? null,
    source_image_sha256: sourceImageSha256,
    source_image_size_px: { width: size.width, height: size.height },
    created_at: createdAt,
    extraction_status: ['draft_requires_human_validation', 'reconciled', 'approved'].includes(document.extraction_status)
      ? document.extraction_status
      : 'draft_requires_human_validation',
    disclaimer: asString(document.disclaimer, '视觉模型识别结果必须人工复核；不得直接作为审计事实。')
  };
  if (typeof document.job_id === 'string' &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(document.job_id)) {
    documentOut.job_id = document.job_id;
  }
  const documentExtra = {};
  if (document.source_image_sha256 && !sourceImageSha256) {
    documentExtra.original_source_image_sha256 = document.source_image_sha256;
  }
  withLegacyExtensions(documentOut, {
    sourceFile,
    unknown: documentUnknown,
    extra: Object.keys(documentExtra).length ? documentExtra : undefined
  });

  const data = {
    schema_version: TARGET_SCHEMA_VERSION,
    template_profile_id: TEMPLATE_PROFILE_ID,
    template_profile_version: TEMPLATE_PROFILE_VERSION,
    template_profile_ref: TEMPLATE_PROFILE_REF,
    document: documentOut,
    lanes,
    nodes,
    edges,
    style,
    unresolved_items: unresolved,
    export_profile: clone(FORCED_EXPORT_PROFILE),
    extensions: {
      legacy: {
        source_file: sourceFile,
        adapter_version: ADAPTER_VERSION,
        source_schema_version: raw.schema_version || null,
        coordinate_system: raw.coordinate_system || null,
        original_export_profile: raw.export_profile,
        style_ref: raw.style_ref,
        unknown_fields: pickUnknown(raw, new Set([
          'schema_version', 'document', 'coordinate_system', 'lanes', 'nodes', 'edges',
          'unresolved_items', 'style_ref', 'export_profile', 'style'
        ]))
      }
    }
  };

  const report = {
    adapter_version: ADAPTER_VERSION,
    source_schema_version: raw.schema_version || null,
    target_schema_version: TARGET_SCHEMA_VERSION,
    already_adapted: false,
    counts: {
      lanes_in: rawLanes.length,
      lanes_out: lanes.length,
      nodes_in: rawNodes.length,
      nodes_out: nodes.length,
      edges_in: rawEdges.length,
      edges_out: edges.length
    },
    mapped_fields: [
      'nodes[].lane -> nodes[].lane_id',
      'nodes[].bbox_px -> nodes[].bbox + nodes[].source_bbox_px',
      'edges[].source -> edges[].source_node_id',
      'edges[].target -> edges[].target_node_id',
      'controls -> kind/code/display/attribution_status',
      'review_status default pending',
      'provenance default image_extraction',
      'template_profile_id/version/ref set to trade_purchase_cn'
    ],
    inferred: {
      ports: edges.filter((edge) => edge.provenance?.legacy?.port_inference === 'geometry_v1').length,
      lane_ids_by_label: warnings.filter((warning) => warning.code === 'LANE_MAPPED_BY_LABEL').length
    },
    warnings: warnings.map((warning) => ({ ...warning })),
    unresolved_added: unresolved
      .filter((item) => !oldUnresolved.some((oldItem) => isObject(oldItem) && oldItem.id === item.id))
      .map((item) => item.id),
    unknown_fields_preserved: [
      ...(Object.keys(documentUnknown).length ? ['document'] : []),
      ...laneUnknownFields,
      ...nodeUnknownFields,
      ...edgeUnknownFields,
      ...(Object.keys(styleUnknown).length ? ['style'] : [])
    ],
    dropped_entities: [],
    diff_summary: 'nodes/edges are not added or removed by the adapter'
  };

  return { ok: errors.length === 0, data: compact(data), errors, warnings, unresolved_items: unresolved, report };
}

module.exports = {
  ADAPTER_VERSION,
  TARGET_SCHEMA_VERSION,
  FORCED_EXPORT_RULES,
  FORCED_EXPORT_PROFILE,
  isExternalVariant,
  adaptExternalVariant,
  adaptLegacyFlowchart
};

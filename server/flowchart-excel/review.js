'use strict';

/*
 * Slice 4 review workspace storage.
 *
 * The imported package and its artifacts remain immutable. Human edits live in
 * review/flowchart.reviewed.json plus an append-only revision directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateContract } = require('../../services/flowchart_excel/validator');
const { validateReferences } = require('../../services/flowchart_excel/reference_validator');
const { FORCED_EXPORT_RULES, FORCED_EXPORT_PROFILE } = require('../../services/flowchart_excel/legacy_adapter');
const { nodesCsv, edgesCsv, styleJson } = require('./artifacts');
const { FlowchartJobError, JOB_ID_RE } = require('./service');

const TEMPLATE_PROFILE_ID = 'trade_purchase_cn';
const TEMPLATE_PROFILE_VERSION = '1.0.0';
const TEMPLATE_PROFILE_REF = 'docs/agent/flowchart-excel/trade-purchase-template-profile.md';
const REVIEW_STATUSES = new Set(['review_required', 'review_in_progress', 'review_approved']);
const ISSUE_STATUSES = new Set(['pending', 'resolved', 'waived']);
const REVIEW_FILES = new Set([
  'flowchart.reviewed.json',
  'nodes.reviewed.csv',
  'edges.reviewed.csv',
  'style.reviewed.json'
]);

function nowIso() {
  return new Date().toISOString();
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function atomicWrite(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function reviewDir(service, jobId) {
  const dir = service.jobDir(jobId);
  return dir ? path.join(dir, 'review') : null;
}

function reviewedGraphPath(service, jobId) {
  const dir = reviewDir(service, jobId);
  return dir ? path.join(dir, 'flowchart.reviewed.json') : null;
}

function reviewMetaPath(service, jobId) {
  const dir = reviewDir(service, jobId);
  return dir ? path.join(dir, 'review-meta.json') : null;
}

function issuesPath(service, jobId) {
  const dir = reviewDir(service, jobId);
  return dir ? path.join(dir, 'issues.json') : null;
}

function revisionsDir(service, jobId) {
  const dir = reviewDir(service, jobId);
  return dir ? path.join(dir, 'revisions') : null;
}

function reviewFilePath(service, jobId, name) {
  if (!REVIEW_FILES.has(name)) return null;
  const dir = reviewDir(service, jobId);
  return dir ? path.join(dir, name) : null;
}

function reviewMeta(service, jobId, meta) {
  const stored = readJson(reviewMetaPath(service, jobId), null);
  const status = stored && REVIEW_STATUSES.has(stored.status)
    ? stored.status
    : (REVIEW_STATUSES.has(meta.status) ? meta.status : 'review_required');
  return {
    revision: Number.isInteger(stored?.revision) && stored.revision >= 0 ? stored.revision : 0,
    status,
    updatedAt: stored?.updatedAt || meta.updatedAt || meta.createdAt || nowIso(),
    approvedAt: stored?.approvedAt || null,
    approvedBy: stored?.approvedBy || null
  };
}

function graphFromArtifact(service, jobId, meta) {
  const dir = service.jobDir(jobId);
  if (!dir) return null;
  const artifact = (meta.artifacts || []).find((item) => item.id === 'flowchart-json' || item.name === 'flowchart.json');
  const file = path.join(dir, 'artifacts', artifact?.name || 'flowchart.json');
  return readJson(file, null);
}

function readGraph(service, jobId, meta) {
  const saved = readJson(reviewedGraphPath(service, jobId), null);
  if (saved) return { graph: saved, source: 'reviewed' };
  const imported = graphFromArtifact(service, jobId, meta);
  return imported ? { graph: imported, source: 'imported' } : { graph: null, source: null };
}

function readIssueState(service, jobId) {
  const stored = readJson(issuesPath(service, jobId), null);
  return isObject(stored) && isObject(stored.items) ? stored : { items: {}, updatedAt: null };
}

function issueGroup(issue) {
  const text = `${issue.type || ''} ${issue.description || ''}`.toLowerCase();
  if (/noncanonical_control|control|控制|prp|t\.ac|control_marker/.test(text)) return 'control';
  if (/ambiguous_branch|branch|分支/.test(text)) return 'branch';
  if (/missing_port|cross_lane|connector|端口|连线|跨泳道/.test(text)) return 'connector';
  if (/coordinate|bbox|坐标/.test(text)) return 'coordinate';
  if (/text|label|文字|confidence|低可读/.test(text)) return 'text';
  if (/lane|泳道|page|分页|重复/.test(text)) return 'structure';
  if (/schema|template|style|windows|manifest|orientation|created_at/.test(text)) return 'metadata';
  return 'other';
}

function issueLabel(group) {
  return {
    structure: '结构 / 泳道',
    control: '控制码 / 控制点',
    branch: '判断分支',
    connector: '连线 / 端口',
    coordinate: '坐标',
    text: '文字与置信度',
    metadata: '模板 / 元数据',
    other: '其他'
  }[group] || '其他';
}

function buildIssues(graph, state) {
  const statuses = state.items || {};
  return (Array.isArray(graph.unresolved_items) ? graph.unresolved_items : []).map((item) => {
    const stored = isObject(statuses[item.id]) ? statuses[item.id] : {};
    const status = ISSUE_STATUSES.has(stored.status) ? stored.status : 'pending';
    const severity = ['high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium';
    return {
      id: item.id,
      kind: 'unresolved',
      type: item.type || 'other',
      severity,
      description: item.description || '',
      action: item.action || '',
      related_ids: Array.isArray(item.related_ids) ? item.related_ids : [],
      status,
      resolution: stored.resolution || '',
      note: stored.note || '',
      updatedAt: stored.updatedAt || null,
      blocking: severity === 'high' || severity === 'medium',
      group: issueGroup(item),
      groupLabel: issueLabel(issueGroup(item)),
      editable: true
    };
  });
}

function warningItems(meta, report) {
  const warnings = Array.isArray(report?.warnings)
    ? report.warnings
    : (Array.isArray(meta.warnings) ? meta.warnings : []);
  return warnings.map((warning, index) => {
    const text = typeof warning === 'string' ? warning : String(warning.message || warning.code || '');
    return {
      id: `warning_${index + 1}`,
      kind: 'warning',
      type: 'metadata_warning',
      severity: 'info',
      description: text,
      action: '阅读并确认；警告不等于业务流程已确认。',
      related_ids: [],
      status: 'notice',
      resolution: '',
      note: '',
      blocking: false,
      group: 'metadata',
      groupLabel: '模板 / 元数据',
      editable: false
    };
  });
}

function reviewProgress(issues) {
  const unresolved = issues.filter((item) => item.kind === 'unresolved');
  const resolved = unresolved.filter((item) => item.status === 'resolved').length;
  const waived = unresolved.filter((item) => item.status === 'waived').length;
  return {
    total: unresolved.length,
    resolved,
    waived,
    pending: unresolved.filter((item) => item.status === 'pending').length,
    blockingPending: unresolved.filter((item) => item.blocking && item.status === 'pending').length
  };
}

function buildPayload(service, jobId, meta) {
  const { graph, source } = readGraph(service, jobId, meta);
  if (!graph) {
    throw new FlowchartJobError('REVIEW_GRAPH_MISSING', '该任务没有可复核的流程图。', 409);
  }
  const schema = validateContract(graph);
  const references = schema.valid ? validateReferences(graph) : { valid: false, errors: [], warnings: [], unresolved_items: [] };
  if (!schema.valid || !references.valid) {
    return {
      graph,
      source: source || 'imported',
      invalid: true,
      schema,
      references,
      issues: [],
      warnings: [],
      reviewMeta: reviewMeta(service, jobId, meta),
      progress: { total: 0, resolved: 0, waived: 0, pending: 0, blockingPending: 0 },
      canApprove: false,
      blockers: []
    };
  }
  const state = readIssueState(service, jobId);
  const issues = buildIssues(graph, state);
  const warnings = warningItems(meta, readJson(path.join(service.jobDir(jobId), 'artifacts', 'import-validation-report.json'), null));
  const progress = reviewProgress(issues);
  const review = reviewMeta(service, jobId, meta);
  const overlay = (meta.artifacts || []).find((item) => item.id === 'review-overlay');
  const exportArtifacts = (meta.artifacts || [])
    .filter((item) => item.kind === 'xlsx_candidate')
    .map((item) => ({ id: item.id, name: item.name, bytes: item.bytes, kind: item.kind }));
  return {
    graph,
    source: source || 'imported',
    invalid: false,
    schema,
    references,
    issues,
    warnings,
    reviewMeta: review,
    progress,
    canApprove: progress.blockingPending === 0,
    blockers: issues.filter((item) => item.blocking && item.status === 'pending').map((item) => item.id),
    sourceUrl: `/api/flowchart-excel/jobs/${encodeURIComponent(jobId)}/source`,
    overlayUrl: overlay ? `/api/flowchart-excel/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(overlay.id)}` : null,
    exportArtifacts,
    profile: {
      templateProfileId: TEMPLATE_PROFILE_ID,
      templateProfileVersion: TEMPLATE_PROFILE_VERSION,
      templateProfileRef: TEMPLATE_PROFILE_REF,
      editAs: 'pending',
      exportReady: false
    }
  };
}

function reviewJob(service, jobId, ownerUsername) {
  if (!JOB_ID_RE.test(String(jobId || ''))) throw new FlowchartJobError('JOB_NOT_FOUND', '任务不存在。', 404);
  const meta = service.getJobForOwner(jobId, ownerUsername);
  if (!meta) throw new FlowchartJobError('JOB_NOT_FOUND', '任务不存在。', 404);
  return meta;
}

function assertEditable(meta) {
  if (meta.workerMode !== 'external_import') {
    throw new FlowchartJobError('REVIEW_NOT_AVAILABLE', '只有外部导入任务支持人工复核。', 409);
  }
  if (!REVIEW_STATUSES.has(meta.status)) {
    throw new FlowchartJobError('REVIEW_NOT_AVAILABLE', '当前任务状态不允许人工复核。', 409);
  }
}

function assertRevision(actual, expected) {
  if (!Number.isInteger(expected) || expected < 0) {
    throw new FlowchartJobError('EXPECTED_REVISION_REQUIRED', '保存需要提供当前 revision。', 400);
  }
  if (actual !== expected) {
    throw new FlowchartJobError('REVISION_CONFLICT', '复核数据已被其他标签页修改，请刷新后再保存。', 409);
  }
}

function encodeForcedGraph(input, currentGraph, meta) {
  if (!isObject(input)) throw new FlowchartJobError('INVALID_GRAPH', 'graph 必须是对象。', 422);
  const graph = clone(input);
  graph.schema_version = '1.0.0';
  graph.template_profile_id = TEMPLATE_PROFILE_ID;
  graph.template_profile_version = TEMPLATE_PROFILE_VERSION;
  graph.template_profile_ref = TEMPLATE_PROFILE_REF;

  const currentStyle = isObject(currentGraph.style) ? currentGraph.style : {};
  const style = isObject(graph.style) ? graph.style : {};
  graph.style = {
    ...style,
    theme: isObject(style.theme) ? style.theme : {},
    excel_export_rules: clone(FORCED_EXPORT_RULES),
    ...(style.extensions ? { extensions: style.extensions } : {})
  };
  if (!isObject(graph.style.theme)) graph.style.theme = {};

  const currentExport = isObject(currentGraph.export_profile) ? currentGraph.export_profile : {};
  const incomingExport = isObject(graph.export_profile) ? graph.export_profile : {};
  graph.export_profile = {
    ...clone(FORCED_EXPORT_PROFILE),
    ...(incomingExport.extensions ? { extensions: incomingExport.extensions } : {})
  };
  if (!graph.export_profile.extensions && currentExport.extensions) {
    graph.export_profile.extensions = currentExport.extensions;
  }

  // Unresolved items are part of the review ledger, not an editable graph field.
  graph.unresolved_items = clone(currentGraph.unresolved_items || []);
  if (!isObject(graph.extensions) && currentGraph.extensions) graph.extensions = clone(currentGraph.extensions);
  return graph;
}

function fieldChanges(before, after, entityType, entityId) {
  const fields = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (key === 'extensions') continue;
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      fields[key] = { before: oldValue === undefined ? null : clone(oldValue), after: newValue === undefined ? null : clone(newValue) };
    }
  }
  return Object.keys(fields).length ? { entity_type: entityType, entity_id: entityId, fields } : null;
}

function graphChanges(before, after) {
  const changes = [];
  if (JSON.stringify(before.document) !== JSON.stringify(after.document)) {
    changes.push(...[fieldChanges(before.document, after.document, 'document', 'document')].filter(Boolean));
  }
  if (JSON.stringify(before.style) !== JSON.stringify(after.style)) {
    changes.push(...[fieldChanges(before.style, after.style, 'style', 'style')].filter(Boolean));
  }
  for (const [collection, entityType] of [['lanes', 'lane'], ['nodes', 'node'], ['edges', 'edge']]) {
    const beforeMap = new Map((before[collection] || []).map((item) => [item.id, item]));
    const afterMap = new Map((after[collection] || []).map((item) => [item.id, item]));
    for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
      const oldItem = beforeMap.get(id);
      const newItem = afterMap.get(id);
      if (!oldItem || !newItem) {
        changes.push({ entity_type: entityType, entity_id: id, fields: { _entity: { before: oldItem ? 'present' : 'missing', after: newItem ? 'present' : 'missing' } } });
      } else {
        const change = fieldChanges(oldItem, newItem, entityType, id);
        if (change) changes.push(change);
      }
    }
  }
  return changes.slice(0, 200);
}

function writeRevision(service, jobId, meta, revision, action, target, changes, reason) {
  const dir = revisionsDir(service, jobId);
  if (!dir) throw new FlowchartJobError('INVALID_JOB_ID', '无效的任务编号。', 400);
  const record = {
    revision,
    action,
    target: target || null,
    changes: changes || [],
    reason: reason || '',
    actor: meta.ownerUsername,
    created_at: nowIso()
  };
  atomicWrite(path.join(dir, `${String(revision).padStart(6, '0')}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function writeReviewFiles(service, jobId, graph, meta) {
  const dir = reviewDir(service, jobId);
  if (!dir) throw new FlowchartJobError('INVALID_JOB_ID', '无效的任务编号。', 400);
  const files = {
    'flowchart.reviewed.json': `${JSON.stringify(graph, null, 2)}\n`,
    'nodes.reviewed.csv': nodesCsv(graph),
    'edges.reviewed.csv': edgesCsv(graph),
    'style.reviewed.json': styleJson(graph)
  };
  for (const [name, content] of Object.entries(files)) {
    atomicWrite(path.join(dir, name), content);
  }
  for (const [id, name] of [
    ['review-flowchart-json', 'flowchart.reviewed.json'],
    ['review-nodes-csv', 'nodes.reviewed.csv'],
    ['review-edges-csv', 'edges.reviewed.csv'],
    ['review-style-json', 'style.reviewed.json']
  ]) {
    service.writeArtifact(jobId, {
      id,
      name,
      kind: 'review_artifact',
      content: files[name]
    });
  }
  return Object.keys(files);
}

function saveGraph({ service, jobId, ownerUsername, expectedRevision, graph: input }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const current = reviewMeta(service, jobId, meta);
  assertRevision(current.revision, expectedRevision);
  const currentRead = readGraph(service, jobId, meta);
  if (!currentRead.graph) throw new FlowchartJobError('REVIEW_GRAPH_MISSING', '找不到原始流程图。', 409);
  const graph = encodeForcedGraph(input, currentRead.graph, meta);
  const manualBranchWithoutLabel = (graph.edges || []).find((edge) =>
    edge?.kind === 'branch' &&
    edge?.provenance?.source === 'manual_edit' &&
    !String(edge.label || '').trim()
  );
  if (manualBranchWithoutLabel) {
    throw new FlowchartJobError('BRANCH_LABEL_REQUIRED', '人工新增的分支连线必须填写“是/否”等分支文字。', 422, { edgeId: manualBranchWithoutLabel.id });
  }

  const schema = validateContract(graph);
  if (!schema.valid) throw new FlowchartJobError('INVALID_GRAPH', '复核图未通过 Schema 校验。', 422, schema.errors);
  const references = validateReferences(graph);
  if (!references.valid) throw new FlowchartJobError('INVALID_REFERENCES', '复核图存在跨引用错误。', 422, references.errors);

  const revision = current.revision + 1;
  writeReviewFiles(service, jobId, graph, meta);
  const changes = graphChanges(currentRead.graph, graph);
  const record = writeRevision(service, jobId, meta, revision, 'graph_saved', { type: 'graph', id: jobId }, changes, '');
  const nextReview = {
    revision,
    status: 'review_in_progress',
    updatedAt: record.created_at,
    approvedAt: null,
    approvedBy: null
  };
  atomicWrite(reviewMetaPath(service, jobId), `${JSON.stringify(nextReview, null, 2)}\n`);
  service.updateMeta(jobId, {
    status: 'review_in_progress',
    progressMessage: '人工复核中；修改已保存。',
    exportReady: false
  });
  return { revision, changes, graph, reviewMeta: nextReview };
}

function updateIssue({ service, jobId, ownerUsername, expectedRevision, issueId, status, resolution, note }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const current = reviewMeta(service, jobId, meta);
  assertRevision(current.revision, expectedRevision);
  const payload = buildPayload(service, jobId, meta);
  if (payload.invalid) throw new FlowchartJobError('REVIEW_GRAPH_INVALID', '复核图当前无效，不能更新问题。', 422);
  const issue = payload.issues.find((item) => item.id === issueId);
  if (!issue) throw new FlowchartJobError('ISSUE_NOT_FOUND', '问题不存在。', 404);
  if (!ISSUE_STATUSES.has(status)) throw new FlowchartJobError('INVALID_ISSUE_STATUS', '问题状态无效。', 422);
  const cleanResolution = String(resolution || '').trim().slice(0, 4000);
  const cleanNote = String(note || '').trim().slice(0, 4000);
  if (status !== 'pending' && !cleanResolution) {
    throw new FlowchartJobError('RESOLUTION_REQUIRED', '标记已解决或豁免时必须填写处理说明。', 422);
  }
  const state = readIssueState(service, jobId);
  const previous = isObject(state.items[issueId]) ? state.items[issueId] : { status: 'pending' };
  state.items[issueId] = { status, resolution: cleanResolution, note: cleanNote, updatedAt: nowIso() };
  state.updatedAt = nowIso();
  const revision = current.revision + 1;
  atomicWrite(issuesPath(service, jobId), `${JSON.stringify(state, null, 2)}\n`);
  const change = {
    entity_type: 'issue',
    entity_id: issueId,
    fields: {
      status: { before: previous.status || 'pending', after: status },
      resolution: { before: previous.resolution || '', after: cleanResolution },
      note: { before: previous.note || '', after: cleanNote }
    }
  };
  const record = writeRevision(service, jobId, meta, revision, 'issue_updated', { type: 'issue', id: issueId }, [change], cleanResolution);
  const nextReview = { revision, status: 'review_in_progress', updatedAt: record.created_at, approvedAt: null, approvedBy: null };
  atomicWrite(reviewMetaPath(service, jobId), `${JSON.stringify(nextReview, null, 2)}\n`);
  service.updateMeta(jobId, { status: 'review_in_progress', progressMessage: '人工复核中；问题状态已更新。', exportReady: false });
  return { revision, issue: { ...issue, status, resolution: cleanResolution, note: cleanNote }, reviewMeta: nextReview };
}

function bulkReview({ service, jobId, ownerUsername, expectedRevision, confirm, resolution }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const current = reviewMeta(service, jobId, meta);
  assertRevision(current.revision, expectedRevision);
  if (confirm !== true) {
    throw new FlowchartJobError('CONFIRMATION_REQUIRED', '一键复核需要明确确认。', 400);
  }
  const payload = buildPayload(service, jobId, meta);
  if (payload.invalid) throw new FlowchartJobError('REVIEW_GRAPH_INVALID', '复核图当前无效，不能一键复核。', 422);
  const pending = payload.issues.filter((item) => item.status === 'pending');
  if (!pending.length) {
    throw new FlowchartJobError('NO_PENDING_ISSUES', '当前没有待处理问题。', 409);
  }
  const cleanResolution = String(resolution || '').trim().slice(0, 4000) ||
    '一键复核：用户确认保留当前识别结果；未修改图结构、控制码或连线。';
  const state = readIssueState(service, jobId);
  const changes = [];
  for (const issue of pending) {
    const previous = isObject(state.items[issue.id]) ? state.items[issue.id] : { status: 'pending' };
    state.items[issue.id] = {
      status: 'waived',
      resolution: cleanResolution,
      note: '',
      bulk: true,
      updatedAt: nowIso()
    };
    changes.push({
      entity_type: 'issue',
      entity_id: issue.id,
      fields: {
        status: { before: previous.status || 'pending', after: 'waived' },
        resolution: { before: previous.resolution || '', after: cleanResolution },
        bulk: { before: Boolean(previous.bulk), after: true }
      }
    });
  }
  state.updatedAt = nowIso();
  const revision = current.revision + 1;
  atomicWrite(issuesPath(service, jobId), `${JSON.stringify(state, null, 2)}
`);
  const record = writeRevision(service, jobId, meta, revision, 'bulk_reviewed', { type: 'review', id: jobId }, changes, cleanResolution);
  const nextReview = { revision, status: 'review_in_progress', updatedAt: record.created_at, approvedAt: null, approvedBy: null };
  atomicWrite(reviewMetaPath(service, jobId), `${JSON.stringify(nextReview, null, 2)}
`);
  service.updateMeta(jobId, { status: 'review_in_progress', progressMessage: '已一键复核保留当前结果；仍需明确完成复核。', exportReady: false });
  return { revision, updated: pending.map((item) => item.id), reviewMeta: nextReview, resolution: cleanResolution };
}

function approve({ service, jobId, ownerUsername, expectedRevision }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const current = reviewMeta(service, jobId, meta);
  assertRevision(current.revision, expectedRevision);
  const payload = buildPayload(service, jobId, meta);
  if (payload.invalid) throw new FlowchartJobError('REVIEW_GRAPH_INVALID', '复核图当前无效，不能批准。', 422);
  if (!payload.canApprove) {
    throw new FlowchartJobError('REVIEW_BLOCKED', '仍有阻断级问题待处理。', 409, { blockers: payload.blockers });
  }
  const revision = current.revision + 1;
  const at = nowIso();
  const record = writeRevision(service, jobId, meta, revision, 'review_approved', { type: 'job', id: jobId }, [], '');
  const nextReview = { revision, status: 'review_approved', updatedAt: record.created_at, approvedAt: at, approvedBy: ownerUsername };
  atomicWrite(reviewMetaPath(service, jobId), `${JSON.stringify(nextReview, null, 2)}\n`);
  service.updateMeta(jobId, {
    status: 'review_approved',
    progressMessage: '人工复核已完成；Excel 导出仍未开放。',
    exportReady: false,
    reviewApprovedAt: at,
    reviewApprovedBy: ownerUsername
  });
  return { revision, reviewMeta: nextReview };
}

function defaultExportRunner({ graphPath, profilePath, outputPath, anchor }) {
  const dotnet = process.env.FLOWCHART_DOTNET_BIN || path.join(os.homedir(), '.dotnet', 'dotnet');
  const exporterRoot = process.env.FLOWCHART_EXPORTER_ROOT || path.resolve(__dirname, '..', '..', '..', '..', 'tools', 'flowchart-excel-exporter-poc');
  const project = path.join(exporterRoot, 'src', 'FlowchartExcelExporter', 'FlowchartExcelExporter.csproj');
  const args = [
    'run', '--project', project, '-c', 'Release', '--',
    '--canonical-target', graphPath, profilePath, outputPath
  ];
  if (anchor === 'default') args.push('--default-editAs');
  return spawnSync(dotnet, args, {
    cwd: exporterRoot,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' }
  });
}

function exportXlsx({ service, jobId, ownerUsername, mode = 'experimental', anchor = 'default', runExporter = defaultExportRunner }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const current = reviewMeta(service, jobId, meta);
  if (current.status !== 'review_approved' || meta.status !== 'review_approved') {
    throw new FlowchartJobError('REVIEW_NOT_APPROVED', '只有已完成的复核任务才能导出。', 409);
  }
  if (mode !== 'experimental') {
    throw new FlowchartJobError('FORMAL_EXPORT_BLOCKED', '正式导出仍被 Gate C（target-style Windows Excel 验收）阻塞。', 409);
  }
  if (!['default', 'oneCell'].includes(anchor)) {
    throw new FlowchartJobError('INVALID_ANCHOR', 'anchor 必须是 default 或 oneCell。', 400);
  }
  const graphPath = reviewedGraphPath(service, jobId);
  if (!graphPath || !fs.existsSync(graphPath)) {
    throw new FlowchartJobError('REVIEW_GRAPH_MISSING', '缺少 review/flowchart.reviewed.json。', 409);
  }
  const payload = buildPayload(service, jobId, meta);
  if (payload.invalid) throw new FlowchartJobError('REVIEW_GRAPH_INVALID', '复核图当前无效。', 422);
  if (!payload.canApprove) throw new FlowchartJobError('REVIEW_BLOCKED', '仍有阻断级问题。', 409);

  const profilePath = path.resolve(__dirname, '..', '..', 'docs', 'agent', 'flowchart-excel', 'trade-purchase-template-profile.json');
  if (!fs.existsSync(profilePath)) throw new FlowchartJobError('PROFILE_MISSING', '模板 profile 不存在。', 500);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowchart-xlsx-'));
  const outputPath = path.join(tempDir, `flowchart-candidate-${anchor}.xlsx`);
  try {
    const result = runExporter({ graphPath, profilePath, outputPath, anchor });
    if (!result || result.status !== 0 || !fs.existsSync(outputPath)) {
      const detail = String(result?.stderr || result?.error?.message || '').slice(-1200);
      throw new FlowchartJobError('EXPORT_FAILED', `Excel 导出失败。${detail ? ` ${detail}` : ''}`, 500);
    }
    const content = fs.readFileSync(outputPath);
    if (content.length < 1000) throw new FlowchartJobError('EXPORT_FAILED', 'Excel 导出结果为空。', 500);
    const artifact = service.writeArtifact(jobId, {
      id: 'xlsx-candidate',
      name: `flowchart-candidate-${anchor}.xlsx`,
      kind: 'xlsx_candidate',
      content
    });
    service.updateMeta(jobId, {
      exportReady: false,
      progressMessage: '已生成实验 Excel；Windows/anchor 正式验收仍待完成。'
    });
    return {
      mode: 'experimental',
      anchor,
      artifact,
      downloadUrl: `/api/flowchart-excel/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.id)}`,
      warning: '实验产物：原生 shape/connector 与 target-style profile 已生成，正式 exportReady 仍为 false。'
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function getReview({ service, jobId, ownerUsername }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  return buildPayload(service, jobId, meta);
}

function listRevisions({ service, jobId, ownerUsername }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const dir = revisionsDir(service, jobId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^\d{6}\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => readJson(path.join(dir, name), null))
    .filter(Boolean);
}

function readReviewFile({ service, jobId, ownerUsername, name }) {
  const meta = reviewJob(service, jobId, ownerUsername);
  assertEditable(meta);
  const file = reviewFilePath(service, jobId, name);
  if (!file || !fs.existsSync(file)) throw new FlowchartJobError('REVIEW_FILE_NOT_FOUND', '复核文件不存在。', 404);
  return { file, name, meta };
}

module.exports = {
  REVIEW_FILES,
  reviewDir,
  getReview,
  saveGraph,
  updateIssue,
  bulkReview,
  approve,
  exportXlsx,
  listRevisions,
  readReviewFile,
  buildPayload
};

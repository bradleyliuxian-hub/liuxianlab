'use strict';

/*
 * Shared JSON Schema validator for the flowchart Excel contract.
 *
 * The schema is the single source of truth:
 *   docs/agent/flowchart-excel/flowchart.schema.json
 *
 * This module intentionally does not perform cross-array reference checks.
 * Use reference_validator.js after schema validation.
 */

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'agent',
  'flowchart-excel',
  'flowchart.schema.json'
);

let schema = null;
let compiledValidator = null;
let compileFailure = null;

function loadSchema() {
  if (schema) return schema;
  try {
    const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
    schema = JSON.parse(raw);
    return schema;
  } catch (error) {
    compileFailure = {
      code: error instanceof SyntaxError ? 'SCHEMA_INVALID_JSON' : 'SCHEMA_READ_FAILED',
      message: `无法读取或解析 flowchart.schema.json：${error.message}`
    };
    return null;
  }
}

function getCompiledValidator() {
  if (compiledValidator) return compiledValidator;
  if (compileFailure) return null;

  const currentSchema = loadSchema();
  if (!currentSchema) return null;

  try {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    compiledValidator = ajv.compile(currentSchema);
    return compiledValidator;
  } catch (error) {
    compileFailure = {
      code: 'SCHEMA_COMPILE_FAILED',
      message: `JSON Schema 编译失败：${error.message}`
    };
    return null;
  }
}

function getSchema() {
  return loadSchema();
}

function getEnums() {
  const currentSchema = loadSchema();
  if (!currentSchema) return null;
  const defs = currentSchema.$defs || {};
  return {
    shapes: defs.node.properties.shape.enum,
    nodeConfidence: defs.node.properties.confidence.enum,
    nodeReviewStatus: defs.node.properties.review_status.enum,
    edgeKinds: defs.edge.properties.kind.enum,
    edgeRouteHints: defs.edge.properties.route_hint.enum,
    edgeConfidence: defs.edge.properties.confidence.enum,
    edgeReviewStatus: defs.edge.properties.review_status.enum,
    controlKinds: defs.control.properties.kind.enum,
    controlDisplay: defs.control.properties.display.enum,
    controlAttribution: defs.control.properties.attribution_status.enum,
    ports: defs.port.enum,
    provenanceSources: defs.provenance.properties.source.enum,
    laneOrientations: defs.lane.properties.orientation.enum,
    unresolvedTypes: defs.unresolvedItem.properties.type.enum,
    unresolvedSeverities: defs.unresolvedItem.properties.severity.enum,
    unresolvedStatuses: defs.unresolvedItem.properties.status.enum,
    anchors: defs.exportProfile.properties.anchor_mode.const,
    editAs: defs.exportProfile.properties.edit_as.enum,
    exportRules: {
      native_shapes_only: defs.exportRules.properties.native_shapes_only.const,
      native_bound_connectors_only: defs.exportRules.properties.native_bound_connectors_only.const,
      one_logical_edge_one_connector: defs.exportRules.properties.one_logical_edge_one_connector.const,
      swimlane_background: defs.exportRules.properties.swimlane_background.enum,
      legend: defs.exportRules.properties.legend.enum,
      require_excel_drag_save_reopen_test: defs.exportRules.properties.require_excel_drag_save_reopen_test.const
    }
  };
}

function parseInput(input) {
  if (typeof input === 'string') {
    try {
      return { ok: true, value: JSON.parse(input) };
    } catch (error) {
      return {
        ok: false,
        errors: [{
          code: 'INVALID_JSON',
          instancePath: '',
          schemaPath: '',
          keyword: 'parse',
          message: '输入不是合法 JSON。',
          params: {}
        }]
      };
    }
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{
        code: 'INVALID_DOCUMENT',
        instancePath: '',
        schemaPath: '',
        keyword: 'type',
        message: '输入必须是 JSON 对象。',
        params: {}
      }]
    };
  }

  return { ok: true, value: input };
}

function mapAjvError(error) {
  return {
    code: 'SCHEMA_VALIDATION_FAILED',
    instancePath: error.instancePath || '',
    schemaPath: error.schemaPath || '',
    keyword: error.keyword || '',
    message: error.message || 'schema validation failed',
    params: error.params || {}
  };
}

/**
 * Validate a document against the shared Draft 2020-12 schema.
 *
 * @param {object|string} input
 * @returns {{valid:boolean, errors:Array, schemaPath:string}}
 */
function validateContract(input) {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return { valid: false, errors: parsed.errors, schemaPath: SCHEMA_PATH };
  }

  const validate = getCompiledValidator();
  if (!validate) {
    return {
      valid: false,
      errors: [compileFailure || {
        code: 'SCHEMA_UNAVAILABLE',
        instancePath: '',
        schemaPath: '',
        keyword: 'schema',
        message: 'Schema 不可用。',
        params: {}
      }],
      schemaPath: SCHEMA_PATH
    };
  }

  const valid = validate(parsed.value);
  return {
    valid,
    errors: valid ? [] : (validate.errors || []).map(mapAjvError),
    schemaPath: SCHEMA_PATH
  };
}

module.exports = {
  SCHEMA_PATH,
  loadSchema,
  getSchema,
  getEnums,
  parseInput,
  validateContract
};

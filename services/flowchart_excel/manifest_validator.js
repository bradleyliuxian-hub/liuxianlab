'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const MANIFEST_SCHEMA_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'agent',
  'flowchart-excel',
  'manifest.schema.json'
);

let validator = null;
let compileError = null;

function getValidator() {
  if (validator) return validator;
  if (compileError) return null;
  try {
    const schema = JSON.parse(fs.readFileSync(MANIFEST_SCHEMA_PATH, 'utf8'));
    validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    return validator;
  } catch (error) {
    compileError = error;
    return null;
  }
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return files;
  const normalized = {};
  for (const entry of files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rawName = entry.name ?? entry.filename ?? entry.file_name ?? entry.path ?? entry.relative_path;
    const rawHash = entry.sha256 ?? entry.hash ?? entry.sha256_hex ?? entry.digest;
    if (typeof rawName !== 'string' || typeof rawHash !== 'string') continue;
    const name = path.basename(rawName.replace(/\\/g, '/'));
    if (!name || name === 'manifest.json' || normalized[name]) continue;
    normalized[name] = rawHash.toLowerCase();
  }
  return normalized;
}

function normalizeManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const manifest = { ...value };
  const packageSchemaVersion = manifest.package_schema_version;

  if (manifest.schema_version === undefined && packageSchemaVersion !== undefined) {
    manifest.schema_version = String(packageSchemaVersion);
  }
  if (manifest.package_version === undefined) {
    manifest.package_version = packageSchemaVersion !== undefined
      ? String(packageSchemaVersion)
      : manifest.schema_version;
  }

  if (manifest.generationMode !== undefined && manifest.generation_mode === undefined) {
    manifest.generation_mode = manifest.generationMode;
  }
  if (manifest.aiExtractionPerformedByWebsite !== undefined && manifest.ai_extraction_performed_by_website === undefined) {
    manifest.ai_extraction_performed_by_website = manifest.aiExtractionPerformedByWebsite;
  }

  if (manifest.source_image && typeof manifest.source_image === 'object' && !Array.isArray(manifest.source_image)) {
    const source = { ...manifest.source_image };
    if (source.size === undefined) {
      source.size = source.size_bytes ?? source.bytes ?? source.file_size;
    }
    manifest.source_image = source;
  }

  manifest.files = normalizeFiles(manifest.files);

  delete manifest.package_schema_version;
  delete manifest.package_type;
  delete manifest.template_profile;
  delete manifest.notes;
  delete manifest.generationMode;
  delete manifest.aiExtractionPerformedByWebsite;
  return manifest;
}

function validateManifestSchema(value) {
  const validate = getValidator();
  if (!validate) {
    return {
      valid: false,
      errors: [{ code: 'MANIFEST_SCHEMA_UNAVAILABLE', instancePath: '', message: compileError?.message || 'manifest schema unavailable' }]
    };
  }
  const valid = validate(value);
  return {
    valid,
    errors: valid ? [] : (validate.errors || []).map((error) => ({
      code: 'INVALID_MANIFEST',
      instancePath: error.instancePath || '',
      schemaPath: error.schemaPath || '',
      keyword: error.keyword || '',
      message: error.message || 'manifest schema validation failed',
      params: error.params || {}
    }))
  };
}

module.exports = { MANIFEST_SCHEMA_PATH, normalizeManifest, validateManifestSchema };

'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const { unzipSafe, REQUIRED } = require('./safe-zip');
const { probeImage } = require('./image');
const { getPythonBin } = require('./model-config');
const { buildHelperArtifacts } = require('./artifacts');
const { adaptLegacyFlowchart } = require('../../services/flowchart_excel/legacy_adapter');
const { validateContract } = require('../../services/flowchart_excel/validator');
const { validateReferences } = require('../../services/flowchart_excel/reference_validator');
const { normalizeManifest, validateManifestSchema } = require('../../services/flowchart_excel/manifest_validator');

const EXTERNAL_SOURCE_FORMAT_VERSION = '1.0.0';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_FILES = [...REQUIRED].filter((name) => name !== 'manifest.json');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseJson(buffer, code, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch (_) {
    const error = new Error(`${label} 不是合法 JSON 对象。`);
    error.code = code;
    throw error;
  }
}

function failExternal(store, jobId, code, message, details = null) {
  try {
    if (details) {
      store.writeArtifact(jobId, {
        id: 'validation-errors',
        name: 'validation-errors.json',
        kind: 'validation_error',
        content: `${JSON.stringify({ code, message, details: details.slice(0, 50) }, null, 2)}\n`
      });
    }
  } catch (_) {}
  try {
    store.updateMeta(jobId, {
      status: 'failed',
      progress: 100,
      progressMessage: message,
      errorCode: code,
      aiExtractionPerformed: false,
      aiExtractionPerformedByWebsite: false,
      resultKind: 'error',
      exportReady: false
    });
  } catch (_) {}
}

function validateManifest(manifest, files, meta, warnings) {
  if (!manifest || typeof manifest !== 'object') throw Object.assign(new Error('manifest.json 不是对象。'), { code: 'MANIFEST_INVALID' });
  if (manifest.generation_mode !== 'external_ai') {
    throw Object.assign(new Error('manifest.generation_mode 必须是 external_ai。'), { code: 'MANIFEST_GENERATION_MODE_INVALID' });
  }
  if (manifest.ai_extraction_performed_by_website !== false) {
    throw Object.assign(new Error('manifest 不能声称网站执行了 AI 提取。'), { code: 'MANIFEST_AI_CLAIM_INVALID' });
  }
  const source = manifest.source_image && typeof manifest.source_image === 'object'
    ? manifest.source_image
    : {
        filename: manifest.source_image_name,
        size: manifest.source_image_size,
        sha256: manifest.source_image_sha256
      };
  if (!source || typeof source !== 'object') {
    throw Object.assign(new Error('manifest 缺少 source_image。'), { code: 'MANIFEST_SOURCE_IMAGE_MISSING' });
  }
  if (source.sha256 !== null && source.sha256 !== undefined) {
    if (typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(source.sha256)) {
      throw Object.assign(new Error('manifest.source_image.sha256 格式无效。'), { code: 'MANIFEST_HASH_INVALID' });
    }
    if (source.sha256.toLowerCase() !== meta.sourceSha256.toLowerCase()) {
      throw Object.assign(new Error('manifest 与上传原图的 SHA-256 不一致。'), { code: 'SOURCE_IMAGE_HASH_MISMATCH' });
    }
  } else {
    warnings.push('manifest 未提供原图 SHA-256；已由网站计算并记录实际值。');
  }
  if (source.filename && path.basename(String(source.filename)) !== meta.originalFilename) {
    warnings.push('manifest 原图文件名与上传文件名不同；以实际上传文件为准。');
  }
  if (source.size === undefined || source.size === null) {
    warnings.push('manifest 未提供原图大小；已由网站记录实际上传值。');
  } else if (Number(source.size) !== Number(meta.fileSize)) {
    warnings.push('manifest 原图大小与上传文件大小不同；以实际上传文件为准。');
  }
  if (!manifest.files || typeof manifest.files !== 'object') {
    throw Object.assign(new Error('manifest 缺少 files 哈希表。'), { code: 'MANIFEST_FILES_MISSING' });
  }
  for (const name of REQUIRED_FILES) {
    if (!files.has(name)) {
      throw Object.assign(new Error(`ZIP 缺少必需文件：${name}`), { code: 'PACKAGE_FILE_MISSING' });
    }
    const expected = manifest.files[name];
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) {
      throw Object.assign(new Error(`manifest.files 缺少有效 hash：${name}`), { code: 'MANIFEST_FILE_HASH_MISSING' });
    }
    const actual = sha256(files.get(name));
    if (expected.toLowerCase() !== actual) {
      throw Object.assign(new Error(`ZIP 文件 SHA-256 不匹配：${name}`), { code: 'PACKAGE_FILE_HASH_MISMATCH' });
    }
  }
  if (files.has('review_overlay.png') && manifest.files['review_overlay.png']) {
    const expected = manifest.files['review_overlay.png'];
    const actual = sha256(files.get('review_overlay.png'));
    if (typeof expected !== 'string' || expected.toLowerCase() !== actual) {
      throw Object.assign(new Error('review_overlay.png SHA-256 不匹配。'), { code: 'PACKAGE_FILE_HASH_MISMATCH' });
    }
  }
  return source;
}

function looksLikeTargetContract(value) {
  return value &&
    value.schema_version === '1.0.0' &&
    value.style && typeof value.style === 'object' &&
    Array.isArray(value.nodes) &&
    value.nodes.every((node) => node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'lane_id')) &&
    value.template_profile_id === 'trade_purchase_cn';
}

function validateImportedStyle(style) {
  if (!style || typeof style !== 'object') {
    throw Object.assign(new Error('style.json 不是对象。'), { code: 'STYLE_INVALID' });
  }
  if (style.template_profile_id && style.template_profile_id !== 'trade_purchase_cn') {
    throw Object.assign(new Error('外部 style.json 试图覆盖 trade_purchase_cn profile。'), { code: 'STYLE_PROFILE_OVERRIDE' });
  }
  if (style.excel_export_rules && style.excel_export_rules.edit_as && style.excel_export_rules.edit_as !== 'pending') {
    throw Object.assign(new Error('外部 style.json 试图覆盖 edit_as=pending。'), { code: 'STYLE_EXPORT_RULE_OVERRIDE' });
  }
  return style;
}

async function importHelperPackage({ store, jobId, packageBuffer }) {
  const meta = store.readMeta(jobId);
  if (!meta) return { ok: false, code: 'JOB_NOT_FOUND' };
  if (meta.status === 'cancelled') return { ok: false, code: 'CANCELLED' };

  const warnings = [];
  try {
    const pythonBin = getPythonBin(PROJECT_ROOT);
    if (!pythonBin) {
      failExternal(store, jobId, 'PYTHON_ENV_MISSING', '完整图片解码环境未配置。');
      return { ok: false, code: 'PYTHON_ENV_MISSING' };
    }
    store.updateMeta(jobId, {
      status: 'validating_image',
      progress: 5,
      progressMessage: '正在完整解码并校验上传图片。'
    });
    const sourcePath = path.join(store.jobDir(jobId), meta.sourceFile || `source.${meta.sourceExt}`);
    const imageCheck = spawnSync(pythonBin, [
      '-m', 'services.flowchart_excel.image_validation',
      '--check', sourcePath,
      '--max-pixels', '50000000'
    ], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 60000
    });
    if (imageCheck.status !== 0) {
      failExternal(store, jobId, 'IMAGE_DECODE_FAILED', '上传图片无法通过完整像素解码。');
      return { ok: false, code: 'IMAGE_DECODE_FAILED' };
    }

    store.updateMeta(jobId, {
      status: 'validating_package',
      progress: 10,
      progressMessage: '正在校验外部辅助文件 ZIP。',
      workerMode: 'external_import',
      generationMode: 'external_ai',
      aiExtractionPerformed: false,
      aiExtractionPerformedByWebsite: false,
      isMock: false,
      resultKind: 'pending',
      workerVersion: 'external-import-1.0.0'
    });

    let extracted;
    try {
      extracted = unzipSafe(packageBuffer);
    } catch (error) {
      failExternal(store, jobId, error.code || 'ZIP_INVALID', error.message.slice(0, 300));
      return { ok: false, code: error.code || 'ZIP_INVALID' };
    }

    const { files, entries, totalUncompressedBytes } = extracted;
    const manifest = normalizeManifest(parseJson(files.get('manifest.json'), 'MANIFEST_INVALID', 'manifest.json'));
    const manifestSchema = validateManifestSchema(manifest);
    if (!manifestSchema.valid) {
      failExternal(store, jobId, 'INVALID_MANIFEST', 'manifest.json 未通过 Schema 校验。', manifestSchema.errors);
      return { ok: false, code: 'INVALID_MANIFEST' };
    }
    const source = validateManifest(manifest, files, meta, warnings);
    const style = validateImportedStyle(parseJson(files.get('style.json'), 'STYLE_INVALID', 'style.json'));

    // Keep the original package as an audit artifact only after ZIP safety checks.
    store.writeArtifact(jobId, {
      id: 'external-helper-package',
      name: 'external-helper-package.zip',
      kind: 'external_import_package',
      content: packageBuffer
    });

    store.updateMeta(jobId, {
      status: 'normalizing',
      progress: 45,
      progressMessage: '正在读取外部 flowchart.json 并规范化。'
    });

    const rawGraph = parseJson(files.get('flowchart.json'), 'FLOWCHART_JSON_INVALID', 'flowchart.json');
    let adapted;
    let sourceFormat;
    if (looksLikeTargetContract(rawGraph)) {
      sourceFormat = 'contract_v1';
      adapted = { ok: true, data: rawGraph, warnings: [] };
    } else {
      adapted = adaptLegacyFlowchart(rawGraph, {
        sourceFile: 'external-helper-package/flowchart.json',
        meta,
        importedStyle: style
      });
      sourceFormat = adapted.report?.source_format || 'legacy_helper';
    }
    if (!adapted.ok) {
      failExternal(store, jobId, 'INVALID_IMPORTED_GRAPH', '外部 flowchart.json 无法转换为统一契约。', adapted.errors || []);
      return { ok: false, code: 'INVALID_IMPORTED_GRAPH' };
    }

    const schema = validateContract(adapted.data);
    if (!schema.valid) {
      failExternal(store, jobId, 'SCHEMA_VALIDATION_FAILED', '外部图结构未通过 Schema 校验。', schema.errors);
      return { ok: false, code: 'SCHEMA_VALIDATION_FAILED' };
    }
    const references = validateReferences(adapted.data);
    if (!references.valid) {
      failExternal(store, jobId, 'REFERENCE_VALIDATION_FAILED', '外部图结构存在跨引用错误。', references.errors);
      return { ok: false, code: 'REFERENCE_VALIDATION_FAILED' };
    }

    store.updateMeta(jobId, {
      status: 'validating_graph',
      progress: 70,
      progressMessage: '正在校验外部图结构与模板 profile。'
    });

    const overlayEntry = files.get('review_overlay.png');
    if (overlayEntry) {
      const probe = probeImage(overlayEntry);
      if (!probe.ok) warnings.push('review_overlay.png 不是有效 PNG，已跳过预览图。');
    } else {
      warnings.push('ZIP 未包含可选的 review_overlay.png。');
    }

    const allWarnings = [
      ...((adapted.warnings || []).map((warning) => typeof warning === 'string' ? warning : `${warning.code || ''} ${warning.message || ''}`.trim())),
      ...((references.warnings || []).map((warning) => `${warning.code || ''} ${warning.message || ''}`.trim())),
      ...warnings
    ].filter(Boolean);

    store.updateMeta(jobId, {
      status: 'building_helpers',
      progress: 88,
      progressMessage: '正在生成网站规范化辅助文件。'
    });

    const built = buildHelperArtifacts({
      store,
      jobId,
      data: adapted.data,
      metadata: {
        model: manifest.model?.name || manifest.model || 'external_ai',
        provider: manifest.model?.provider || 'external_ai',
        prompt_version: manifest.prompt_version || 'unknown',
        source_sha256: meta.sourceSha256,
        source_width: meta.imageWidth,
        source_height: meta.imageHeight
      },
      overlayBuffer: overlayEntry || null,
      warnings: allWarnings
    });

    const validationReport = {
      is_mock: false,
      generationMode: 'external_ai',
      aiExtractionPerformedByWebsite: false,
      template_profile_id: 'trade_purchase_cn',
      template_profile_version: '1.0.0',
      edit_as: 'pending',
      exportReady: false,
      package: {
        filename: 'external-helper-package.zip',
        bytes: packageBuffer.length,
        sha256: sha256(packageBuffer),
        entries: entries.length,
        uncompressedBytes: totalUncompressedBytes
      },
      sourceImage: {
        filename: meta.originalFilename,
        size: meta.fileSize,
        sha256: meta.sourceSha256,
        width: meta.imageWidth,
        height: meta.imageHeight,
        manifestSha256: source.sha256 ?? null
      },
      manifest: {
        schemaVersion: manifest.schema_version || null,
        generationMode: manifest.generation_mode,
        aiExtractionPerformedByWebsite: manifest.ai_extraction_performed_by_website,
        fileHashesVerified: true
      },
      sourceFormat,
      counts: {
        lanes: (adapted.data.lanes || []).length,
        nodes: (adapted.data.nodes || []).length,
        edges: (adapted.data.edges || []).length
      },
      warnings: allWarnings,
      unresolved: adapted.data.unresolved_items || [],
      schemaValid: true,
      referencesValid: true
    };
    store.writeArtifact(jobId, {
      id: 'import-validation-report',
      name: 'import-validation-report.json',
      kind: 'import_validation_report',
      content: `${JSON.stringify(validationReport, null, 2)}\n`
    });

    const hasReview = (adapted.data.unresolved_items || []).length > 0 || allWarnings.length > 0;
    store.updateMeta(jobId, {
      status: hasReview ? 'review_required' : 'external_helpers_ready',
      progress: 100,
      progressMessage: hasReview ? '外部辅助文件已导入，存在待人工确认项。' : '外部辅助文件已导入。',
      workerMode: 'external_import',
      generationMode: 'external_ai',
      aiExtractionPerformed: false,
      aiExtractionPerformedByWebsite: false,
      isMock: false,
      resultKind: 'external_helper_files',
      workerVersion: 'external-import-1.0.0',
      warnings: allWarnings,
      unresolvedCount: (adapted.data.unresolved_items || []).length,
      exportReady: false,
      errorCode: null
    });
    return { ok: true, data: adapted.data, warnings: allWarnings, validationReport };
  } catch (error) {
    failExternal(store, jobId, error.code || 'IMPORT_FAILED', String(error.message || '外部辅助文件导入失败。').slice(0, 300));
    return { ok: false, code: error.code || 'IMPORT_FAILED' };
  }
}

module.exports = { importHelperPackage, validateManifest, looksLikeTargetContract, REQUIRED_FILES };

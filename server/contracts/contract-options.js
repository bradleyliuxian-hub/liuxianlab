"use strict";

/*
 * Pure upload-option validation for Contract Review.
 *
 * Keeping this out of routes.js makes the security-relevant
 * branching testable without Express/PostgreSQL.
 */

const PARSE_MODES = Object.freeze([
  "auto",
  "fast",
  "accurate"
]);

const PARSE_BACKENDS = Object.freeze([
  "local",
  "cloud"
]);

const MAX_TOKEN_LENGTH = 2048;


function normalizeParseMode(value) {

  if (
    value === undefined
    || value === null
    || value === ""
  ) {
    return "auto";
  }


  const candidate =
    String(value)
      .trim()
      .toLowerCase();


  return PARSE_MODES.includes(candidate)
    ? candidate
    : null;

}


function normalizeParseBackend(value) {

  if (
    value === undefined
    || value === null
    || value === ""
  ) {
    return "local";
  }


  const candidate =
    String(value)
      .trim()
      .toLowerCase();


  return PARSE_BACKENDS.includes(candidate)
    ? candidate
    : null;

}


function normalizeCloudConsent(value) {

  if (value === true) {
    return true;
  }


  return [
    "true",
    "1",
    "on",
    "yes"
  ].includes(
    String(value || "")
      .trim()
      .toLowerCase()
  );

}


function normalizeToken(value) {

  if (
    value === undefined
    || value === null
  ) {
    return "";
  }


  if (Array.isArray(value)) {
    return null;
  }


  const token =
    String(value).trim();


  if (token.length > MAX_TOKEN_LENGTH) {
    return null;
  }


  return token;

}


function validateUploadOptions({
  parseMode,
  parserBackend,
  cloudProcessingConsent,
  userToken,
  serverTokenConfigured,
  encryptionConfigured
}) {

  const mode =
    normalizeParseMode(parseMode);

  if (mode === null) {
    return {
      ok: false,
      error:
        "无效的解析模式，仅支持 自动 / 快速 / 高精度"
    };
  }


  const backend =
    normalizeParseBackend(parserBackend);

  if (backend === null) {
    return {
      ok: false,
      error:
        "无效的解析引擎，仅支持 本地 / 云端"
    };
  }


  const token =
    normalizeToken(userToken);

  if (token === null) {
    return {
      ok: false,
      error:
        "MinerU API Token 长度超出限制"
    };
  }


  if (backend === "local") {
    return {
      ok: true,
      backend,
      mode,
      token: "",
      storeToken: false
    };
  }


  if (!normalizeCloudConsent(cloudProcessingConsent)) {
    return {
      ok: false,
      error:
        "请先确认已获授权将这份合同发送至 MinerU 云端服务解析"
    };
  }


  if (!token && !serverTokenConfigured) {
    return {
      ok: false,
      error:
        "云端解析需要 MinerU API Token：服务器未配置，请填写本次任务使用的 Token"
    };
  }


  if (token && !encryptionConfigured) {
    return {
      ok: false,
      error:
        "服务器未配置凭证加密密钥，无法安全保存本次填写的 Token；"
        + "请留空并使用服务器已配置的 Token"
    };
  }


  return {
    ok: true,
    backend,
    mode,
    token,
    storeToken: Boolean(token)
  };

}


module.exports = {
  MAX_TOKEN_LENGTH,
  PARSE_BACKENDS,
  PARSE_MODES,
  normalizeCloudConsent,
  normalizeParseBackend,
  normalizeParseMode,
  normalizeToken,
  validateUploadOptions
};

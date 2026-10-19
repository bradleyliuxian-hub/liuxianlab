(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.ContractParserSelection = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BACKENDS = ["local", "cloud"];
  const MODES = ["auto", "fast", "accurate"];


  function normalizeBackend(value) {
    const candidate = String(value || "").trim().toLowerCase();

    return BACKENDS.includes(candidate)
      ? candidate
      : "local";
  }


  function normalizeMode(value) {
    const candidate = String(value || "").trim().toLowerCase();

    return MODES.includes(candidate)
      ? candidate
      : "auto";
  }


  function cloudVisible(backend) {
    return normalizeBackend(backend) === "cloud";
  }


  function validateCloudSelection({
    backend,
    consent,
    token,
    serverTokenConfigured,
    encryptionKeyConfigured
  }) {

    if (!cloudVisible(backend)) {
      return { ok: true, error: "" };
    }

    if (!consent) {
      return {
        ok: false,
        error:
          "请先确认已获授权将合同发送至 MinerU 云端。"
      };
    }

    const value = String(token || "").trim();

    if (!value && !serverTokenConfigured) {
      return {
        ok: false,
        error:
          "服务器未配置云端 Token，请填写本次任务使用的 Token。"
      };
    }

    if (value && !encryptionKeyConfigured) {
      return {
        ok: false,
        error:
          "服务器未配置凭证加密密钥，无法安全保存自定义 Token；请留空并使用服务器 Token。"
      };
    }

    return { ok: true, error: "" };
  }


  function uploadFields({
    backend,
    mode,
    consent,
    token
  }) {

    const resolvedBackend = normalizeBackend(backend);

    const fields = {
      parseMode: normalizeMode(mode),
      parserBackend: resolvedBackend
    };

    if (resolvedBackend !== "cloud") {
      return fields;
    }

    fields.cloudProcessingConsent = consent
      ? "true"
      : "false";

    const value = String(token || "").trim();

    if (value) {
      fields.mineruApiToken = value;
    }

    return fields;
  }


  return {
    BACKENDS,
    MODES,
    cloudVisible,
    normalizeBackend,
    normalizeMode,
    uploadFields,
    validateCloudSelection
  };
});

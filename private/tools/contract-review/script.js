(() => {
  "use strict";


  const parserSelection =
    window.ContractParserSelection;


  const MAX_SIZE =
    25 * 1024 * 1024;


  const fileInput =
    document.getElementById(
      "fileInput"
    );

  const dropZone =
    document.getElementById(
      "dropZone"
    );

  const selectedFile =
    document.getElementById(
      "selectedFile"
    );

  const fileName =
    document.getElementById(
      "fileName"
    );

  const fileMeta =
    document.getElementById(
      "fileMeta"
    );

  const clearFileButton =
    document.getElementById(
      "clearFileButton"
    );

  const uploadButton =
    document.getElementById(
      "uploadButton"
    );

  const statusPanel =
    document.getElementById(
      "statusPanel"
    );

  const statusText =
    document.getElementById(
      "statusText"
    );

  const statusFileName =
    document.getElementById(
      "statusFileName"
    );

  const statusBadge =
    document.getElementById(
      "statusBadge"
    );

  const progressBar =
    document.getElementById(
      "progressBar"
    );

  const progressValue =
    document.getElementById(
      "progressValue"
    );

  const stageText =
    document.getElementById(
      "stageText"
    );

  const progressMessage =
    document.getElementById(
      "progressMessage"
    );

  const parseModeBadge =
    document.getElementById(
      "parseModeBadge"
    );

  const engineBadge =
    document.getElementById(
      "engineBadge"
    );

  const cloudSettings =
    document.getElementById(
      "cloudSettings"
    );

  const mineruApiToken =
    document.getElementById(
      "mineruApiToken"
    );

  const cloudConsent =
    document.getElementById(
      "cloudConsent"
    );

  const cloudConfigHint =
    document.getElementById(
      "cloudConfigHint"
    );

  const themeToggle =
    document.getElementById(
      "themeToggle"
    );

  const toast =
    document.getElementById(
      "toast"
    );


  let currentFile =
    null;

  let currentContractId =
    null;

  let uploading =
    false;

  let statusTimer =
    null;

  let cloudConfig = {
    serverTokenConfigured:
      false,

    encryptionKeyConfigured:
      false
  };


  function showToast(
    message,
    type = "normal"
  ) {

    toast.textContent =
      message;

    toast.classList.toggle(
      "error",
      type === "error"
    );

    toast.classList.add(
      "show"
    );


    clearTimeout(
      showToast.timer
    );


    showToast.timer =
      setTimeout(
        () => {

          toast.classList.remove(
            "show"
          );

        },
        2800
      );

  }


  function formatBytes(bytes) {

    if (bytes < 1024) {
      return `${bytes} B`;
    }


    if (
      bytes <
      1024 * 1024
    ) {

      return `${
        (bytes / 1024)
          .toFixed(1)
      } KB`;

    }


    return `${
      (
        bytes /
        1024 /
        1024
      ).toFixed(2)
    } MB`;

  }


  function resetStatus() {

    currentContractId =
      null;

    statusPanel.hidden =
      true;

    progressBar.style.width =
      "0%";

    progressValue.textContent =
      "0%";


    if (progressMessage) {

      progressMessage.hidden =
        true;

      progressMessage.textContent =
        "";

    }


    if (parseModeBadge) {

      parseModeBadge.hidden =
        true;

      parseModeBadge.textContent =
        "";

      parseModeBadge.classList.remove(
        "fallback"
      );

    }


    if (engineBadge) {

      engineBadge.hidden =
        true;

      engineBadge.textContent =
        "";

    }

  }


  function selectedParseMode() {

    const checked =
      document.querySelector(
        'input[name="parseMode"]:checked'
      );


    return parserSelection.normalizeMode(
      checked?.value
    );

  }


  function selectedParserBackend() {

    const checked =
      document.querySelector(
        'input[name="parserBackend"]:checked'
      );


    return parserSelection.normalizeBackend(
      checked?.value
    );

  }


  function clearCloudInputs() {

    if (mineruApiToken) {

      mineruApiToken.value =
        "";

    }

    if (cloudConsent) {

      cloudConsent.checked =
        false;

    }

  }


  function updateCloudHint() {

    if (!cloudConfigHint) {
      return;
    }


    if (cloudConfig.serverTokenConfigured) {

      cloudConfigHint.textContent =
        cloudConfig.encryptionKeyConfigured
          ? "服务器已配置云端 API，可直接使用；也可以填写本次任务使用的 Token。"
          : "服务器已配置云端 API，可直接使用；填写自定义 Token 需要服务器配置凭证加密密钥。";

      return;

    }


    cloudConfigHint.textContent =
      cloudConfig.encryptionKeyConfigured
        ? "服务器未配置云端 API，请填写本次任务使用的 MinerU API Token。"
        : "服务器未配置云端 API 或凭证加密密钥，当前无法安全提交云端 Token；请使用本地解析或联系管理员。";

  }


  function syncBackendUi() {

    const isCloud =
      parserSelection.cloudVisible(
        selectedParserBackend()
      );


    if (cloudSettings) {

      cloudSettings.hidden =
        !isCloud;

    }


    if (!isCloud) {

      clearCloudInputs();

    }


    updateCloudHint();

  }


  async function loadCloudConfig() {

    try {

      const response =
        await fetch(
          "/api/contracts/cloud-config",
          {
            method:
              "GET",

            headers: {
              "Accept":
                "application/json"
            }
          }
        );


      const payload =
        await parseResponse(
          response
        );


      if (!response.ok) {
        throw new Error(
          payload.error ||
          "无法读取云端配置"
        );
      }


      cloudConfig = {
        serverTokenConfigured:
          Boolean(
            payload.serverTokenConfigured
          ),

        encryptionKeyConfigured:
          Boolean(
            payload.encryptionKeyConfigured
          )
      };

    } catch (error) {

      console.error(
        "[contract cloud config]",
        error
      );

      cloudConfig = {
        serverTokenConfigured:
          false,

        encryptionKeyConfigured:
          false
      };

      if (cloudConfigHint) {

        cloudConfigHint.textContent =
          "无法读取服务器云端配置；可先使用本地解析。";

      }

    }


    updateCloudHint();

  }


  function validateCloudSelection() {

    const result =
      parserSelection.validateCloudSelection({
        backend:
          selectedParserBackend(),

        consent:
          Boolean(cloudConsent?.checked),

        token:
          mineruApiToken?.value || "",

        serverTokenConfigured:
          cloudConfig.serverTokenConfigured,

        encryptionKeyConfigured:
          cloudConfig.encryptionKeyConfigured
      });


    if (!result.ok) {
      showToast(result.error, "error");
      return false;
    }


    return true;

  }


  function parseBadgeText(payload) {

    const requested =
      payload.requestedMode;

    const tier =
      payload.actualTier;


    if (payload.fallbackUsed) {
      return "自动 · 高精度";
    }


    if (
      requested === "fast" ||
      tier === "basic"
    ) {

      return "快速解析";

    }


    if (
      requested === "accurate" ||
      tier === "standard"
    ) {

      return "高精度解析";

    }


    return "";

  }


  function updateEngineBadge(payload) {

    if (!engineBadge) {
      return;
    }


    const requested =
      payload.requestedBackend;

    const actual =
      payload.parseBackend;


    let text =
      "本地解析（历史默认）";


    if (requested === "cloud") {
      text = "云端解析";
    } else if (requested === "local") {
      text = "本地解析";
    } else if (actual === "cloud") {
      text = "云端解析（历史）";
    }


    engineBadge.textContent =
      text;

    engineBadge.hidden =
      false;

  }


  function updateParseBadge(payload) {

    if (!parseModeBadge) {
      return;
    }


    let text =
      parseBadgeText(payload);


    if (payload.cacheHit) {

      text = text
        ? `${text} · 已复用`
        : "已复用已有解析结果";

    }


    if (text) {

      parseModeBadge.textContent =
        text;

      parseModeBadge.hidden =
        false;

      parseModeBadge.classList.toggle(
        "fallback",
        Boolean(
          payload.fallbackUsed
        )
      );

    } else {

      parseModeBadge.hidden =
        true;

      parseModeBadge.textContent =
        "";

      parseModeBadge.classList.remove(
        "fallback"
      );

    }

  }


  function useFile(file) {

    if (!file) {
      return;
    }


    if (
      !file.name
        .toLowerCase()
        .endsWith(".pdf")
    ) {

      showToast(
        "请选择 PDF 文件。",
        "error"
      );

      return;

    }


    if (
      file.size >
      MAX_SIZE
    ) {

      showToast(
        "PDF 不能超过 25 MB。",
        "error"
      );

      return;

    }


    currentFile =
      file;


    fileName.textContent =
      file.name;


    fileMeta.textContent =
      `${formatBytes(file.size)} · PDF`;


    selectedFile.hidden =
      false;


    uploadButton.disabled =
      false;


    resetStatus();

  }


  function clearFile() {

    if (uploading) {
      return;
    }


    currentFile =
      null;

    fileInput.value =
      "";

    selectedFile.hidden =
      true;

    uploadButton.disabled =
      true;

    resetStatus();

  }


  async function parseResponse(
    response
  ) {

    const type =
      response.headers.get(
        "content-type"
      ) || "";


    if (
      type.includes(
        "application/json"
      )
    ) {

      return response.json();

    }


    if (
      response.status === 413
    ) {

      throw new Error(
        "PDF 不能超过 25 MB。"
      );

    }


    throw new Error(
      "服务器暂时无法处理请求。"
    );

  }



  function stopStatusPolling() {

    if (!statusTimer) {
      return;
    }

    clearInterval(
      statusTimer
    );

    statusTimer =
      null;

  }


  function startStatusPolling() {

    stopStatusPolling();

    statusTimer =
      setInterval(
        async () => {

          try {

            await refreshStatus();

          } catch (error) {

            console.error(
              "[contract status polling]",
              error
            );

          }

        },
        3000
      );

  }


  async function refreshStatus() {

    if (!currentContractId) {
      return;
    }


    const response =
      await fetch(
        `/api/contracts/${currentContractId}/status`,
        {
          method:
            "GET",

          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    const payload =
      await parseResponse(
        response
      );


    if (!response.ok) {

      throw new Error(
        payload.error ||
        "无法读取任务状态"
      );

    }


    const progress =
      Number(
        payload.progress ||
        0
      );


    progressBar.style.width =
      `${progress}%`;


    progressValue.textContent =
      `${progress}%`;


    statusFileName.textContent =
      payload.originalName ||
      currentFile?.name ||
      "合同.pdf";


    statusBadge.textContent =
      String(
        payload.status ||
        "queued"
      )
        .toUpperCase();


    const stageMap = {
      queued:
        "等待解析",
      parsing:
        "正在解析",
      extracting:
        "正在提取条款",
      reviewing:
        "等待人工校对",
      completed:
        "审阅完成",
      failed:
        "处理失败"
    };


    stageText.textContent =
      stageMap[
        payload.stage
      ] ||
      payload.stage ||
      "等待处理";


    statusText.textContent =
      payload.status ===
        "queued"
        ? "任务已创建"
        : stageText.textContent;


    if (progressMessage) {

      if (payload.progressMessage) {

        progressMessage.textContent =
          payload.progressMessage;

        progressMessage.hidden =
          false;

      } else {

        progressMessage.hidden =
          true;

      }

    }


    updateEngineBadge(
      payload
    );


    updateParseBadge(
      payload
    );


    if (
      payload.status ===
        "completed" ||
      payload.status ===
        "failed"
    ) {

      stopStatusPolling();

    }

  }


  uploadButton.addEventListener(
    "click",
    async () => {

      if (
        uploading ||
        !currentFile
      ) {
        return;
      }


      if (!validateCloudSelection()) {
        return;
      }


      const parserBackend =
        selectedParserBackend();

      const token =
        String(
          mineruApiToken?.value ||
          ""
        ).trim();


      uploading =
        true;


      uploadButton.disabled =
        true;


      uploadButton.textContent =
        "正在上传…";


      const formData =
        new FormData();


      formData.append(
        "file",
        currentFile
      );


      const fields =
        parserSelection.uploadFields({
          backend:
            parserBackend,

          mode:
            selectedParseMode(),

          consent:
            Boolean(cloudConsent?.checked),

          token
        });


      Object.entries(fields).forEach(
        ([key, value]) => {

          formData.append(key, value);

        }
      );


      try {

        const response =
          await fetch(
            "/api/contracts",
            {
              method:
                "POST",

              body:
                formData
            }
          );


        const payload =
          await parseResponse(
            response
          );


        if (!response.ok) {

          throw new Error(
            payload.error ||
            "合同上传失败"
          );

        }


        currentContractId =
          payload.id;


        statusPanel.hidden =
          false;


        await refreshStatus();


        startStatusPolling();


        statusPanel.scrollIntoView({
          behavior:
            "smooth",
          block:
            "nearest"
        });


        showToast(
          parserBackend === "cloud"
            ? "云端解析任务已创建。"
            : "本地解析任务已创建。"
        );


      } catch (error) {

        console.error(
          error
        );


        showToast(
          error.message ||
          "合同上传失败。",
          "error"
        );


      } finally {

        uploading =
          false;


        clearCloudInputs();


        uploadButton.disabled =
          !currentFile;


        uploadButton.textContent =
          "开始解析 →";

      }

    }
  );


  fileInput.addEventListener(
    "change",
    () => {

      useFile(
        fileInput.files?.[0]
      );

    }
  );


  clearFileButton.addEventListener(
    "click",
    clearFile
  );


  document
    .querySelectorAll(
      'input[name="parserBackend"]'
    )
    .forEach(
      input => {

        input.addEventListener(
          "change",
          syncBackendUi
        );

      }
    );


  syncBackendUi();

  loadCloudConfig();


  [
    "dragenter",
    "dragover"
  ].forEach(
    eventName => {

      dropZone.addEventListener(
        eventName,
        event => {

          event.preventDefault();

          dropZone.classList.add(
            "dragging"
          );

        }
      );

    }
  );


  [
    "dragleave",
    "drop"
  ].forEach(
    eventName => {

      dropZone.addEventListener(
        eventName,
        event => {

          event.preventDefault();

          dropZone.classList.remove(
            "dragging"
          );

        }
      );

    }
  );


  dropZone.addEventListener(
    "drop",
    event => {

      useFile(
        event
          .dataTransfer
          ?.files?.[0]
      );

    }
  );


  /*
   * Keep theme aligned with the main dashboard.
   */
  const themeKey =
    "liuxianlab-theme";


  function applyTheme(theme) {

    document.documentElement
      .setAttribute(
        "data-theme",
        theme
      );

  }


  const savedTheme =
    localStorage.getItem(
      themeKey
    );


  applyTheme(
    savedTheme === "dark"
      ? "dark"
      : "light"
  );


  themeToggle.addEventListener(
    "click",
    () => {

      const current =
        document.documentElement
          .getAttribute(
            "data-theme"
          );


      const next =
        current === "dark"
          ? "light"
          : "dark";


      localStorage.setItem(
        themeKey,
        next
      );


      applyTheme(
        next
      );

    }
  );


  clearFile();

})();

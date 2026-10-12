(() => {
  "use strict";


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
        "正在审阅风险",
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
          "合同任务已创建。"
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


        uploadButton.disabled =
          !currentFile;


        uploadButton.textContent =
          "上传合同 →";

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

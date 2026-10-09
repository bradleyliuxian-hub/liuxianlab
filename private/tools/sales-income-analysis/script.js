(() => {
  "use strict";

  const analysisOptions =
    document.querySelectorAll(
      ".analysis-option"
    );

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

  const inspectButton =
    document.getElementById(
      "inspectButton"
    );

  const mappingPanel =
    document.getElementById(
      "mappingPanel"
    );

  const sheetSelect =
    document.getElementById(
      "sheetSelect"
    );

  const headerRowSelect =
    document.getElementById(
      "headerRowSelect"
    );

  const headerChips =
    document.getElementById(
      "headerChips"
    );

  const documentSelect =
    document.getElementById(
      "documentSelect"
    );

  const referenceSelect =
    document.getElementById(
      "referenceSelect"
    );

  const amountSelect =
    document.getElementById(
      "amountSelect"
    );

  const textSelect =
    document.getElementById(
      "textSelect"
    );

  const partnerSelect =
    document.getElementById(
      "partnerSelect"
    );

  const referenceRow =
    document.getElementById(
      "referenceRow"
    );

  const documentHint =
    document.getElementById(
      "documentHint"
    );

  const confirmMappingButton =
    document.getElementById(
      "confirmMappingButton"
    );

  const mappingSummary =
    document.getElementById(
      "mappingSummary"
    );

  const mappingPreview =
    document.getElementById(
      "mappingPreview"
    );

  const runPanel =
    document.getElementById(
      "runPanel"
    );

  const runStatus =
    document.getElementById(
      "runStatus"
    );

  const runAnalysisButton =
    document.getElementById(
      "runAnalysisButton"
    );

  const downloadButton =
    document.getElementById(
      "downloadButton"
    );

  const analysisProgress =
    document.getElementById(
      "analysisProgress"
    );

  const analysisProgressValue =
    document.getElementById(
      "analysisProgressValue"
    );

  const toast =
    document.getElementById(
      "toast"
    );


  let analysisType =
    "sales";

  let currentFile =
    null;

  let currentJobId =
    null;

  let inspection =
    null;

  let currentHeaders =
    [];

  let confirmedConfig =
    null;

  let running =
    false;


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


  function setProgress(
    value,
    message
  ) {
    const safe = Math.max(
      0,
      Math.min(
        100,
        Number(value) || 0
      )
    );

    analysisProgress.style.width =
      `${safe}%`;

    analysisProgressValue.textContent =
      `${safe}%`;

    if (message) {
      runStatus.textContent =
        message;
    }
  }


  function resetAnalysisResult() {
    confirmedConfig =
      null;

    runPanel.hidden =
      true;

    downloadButton.hidden =
      true;

    downloadButton.href =
      "#";

    setProgress(
      0,
      "字段配置已确认，可以开始分析。"
    );
  }


  function resetInspection() {
    currentJobId =
      null;

    inspection =
      null;

    currentHeaders =
      [];

    mappingPanel.hidden =
      true;

    mappingSummary.hidden =
      true;

    resetAnalysisResult();
  }


  function useFile(file) {
    if (!file) {
      return;
    }

    if (
      !file.name
        .toLowerCase()
        .endsWith(".xlsx")
    ) {
      showToast(
        "请选择 .xlsx 文件。",
        "error"
      );

      return;
    }

    currentFile =
      file;

    fileName.textContent =
      file.name;

    fileMeta.textContent =
      `${formatBytes(file.size)} · XLSX`;

    selectedFile.hidden =
      false;

    inspectButton.disabled =
      false;

    resetInspection();
  }


  function clearFile() {
    if (running) {
      return;
    }

    currentFile =
      null;

    fileInput.value =
      "";

    selectedFile.hidden =
      true;

    inspectButton.disabled =
      true;

    resetInspection();
  }


  analysisOptions.forEach(
    option => {
      option.addEventListener(
        "click",
        () => {
          if (running) {
            return;
          }

          analysisOptions.forEach(
            item =>
              item.classList.remove(
                "active"
              )
          );

          option.classList.add(
            "active"
          );

          analysisType =
            option.dataset.analysis ||
            "sales";

          referenceRow.hidden =
            analysisType === "income";

          documentHint.textContent =
            analysisType === "sales"
              ? "Sales Document"
              : "Document Number";

          mappingSummary.hidden =
            true;

          resetAnalysisResult();

          if (
            currentHeaders.length
          ) {
            populateMappings(
              currentHeaders
            );
          }
        }
      );
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

          if (!running) {
            dropZone.classList.add(
              "dragging"
            );
          }
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
      if (running) {
        return;
      }

      useFile(
        event
          .dataTransfer
          ?.files?.[0]
      );
    }
  );


  function selectedSheet() {
    if (!inspection) {
      return null;
    }

    return (
      inspection.sheets.find(
        sheet =>
          sheet.name ===
          sheetSelect.value
      ) ||
      null
    );
  }


  function selectedHeaderRow() {
    const sheet =
      selectedSheet();

    if (!sheet) {
      return null;
    }

    const rowNumber =
      Number(
        headerRowSelect.value
      );

    return (
      sheet.rows.find(
        row =>
          row.rowNumber ===
          rowNumber
      ) ||
      null
    );
  }


  function normalizeHeader(value) {
    return String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[_\-]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      );
  }


  function guessHeader(
    headers,
    keywords
  ) {
    const normalizedKeywords =
      keywords.map(
        normalizeHeader
      );

    for (
      const header
      of headers
    ) {
      const normalized =
        normalizeHeader(
          header
        );

      if (
        normalizedKeywords.includes(
          normalized
        )
      ) {
        return header;
      }
    }

    for (
      const header
      of headers
    ) {
      const normalized =
        normalizeHeader(
          header
        );

      if (
        normalizedKeywords.some(
          keyword =>
            normalized.includes(
              keyword
            )
        )
      ) {
        return header;
      }
    }

    return "";
  }


  function fillSelect(
    select,
    headers,
    guessed
  ) {
    select.innerHTML =
      "";

    const blank =
      document.createElement(
        "option"
      );

    blank.value =
      "";

    blank.textContent =
      "请选择字段";

    select.appendChild(
      blank
    );

    headers.forEach(
      header => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          header;

        option.textContent =
          header;

        if (
          header === guessed
        ) {
          option.selected =
            true;
        }

        select.appendChild(
          option
        );
      }
    );
  }


  function populateMappings(
    headers
  ) {
    const documentGuess =
      analysisType === "sales"
        ? guessHeader(
            headers,
            [
              "sales document",
              "sales doc",
              "销售凭证",
              "销售单据"
            ]
          )
        : guessHeader(
            headers,
            [
              "document number",
              "document no",
              "document",
              "凭证号",
              "凭证编号"
            ]
          );

    const referenceGuess =
      guessHeader(
        headers,
        [
          "reference",
          "reference no",
          "ref",
          "参考",
          "参考号"
        ]
      );

    const amountGuess =
      guessHeader(
        headers,
        [
          "amount in local currency",
          "local currency amount",
          "amount",
          "本币金额",
          "金额"
        ]
      );

    const textGuess =
      guessHeader(
        headers,
        [
          "text",
          "description",
          "item text",
          "文本",
          "描述"
        ]
      );

    const partnerGuess =
      guessHeader(
        headers,
        [
          "trading partner",
          "partner",
          "交易伙伴",
          "贸易伙伴"
        ]
      );

    fillSelect(
      documentSelect,
      headers,
      documentGuess
    );

    fillSelect(
      referenceSelect,
      headers,
      referenceGuess
    );

    fillSelect(
      amountSelect,
      headers,
      amountGuess
    );

    fillSelect(
      textSelect,
      headers,
      textGuess
    );

    fillSelect(
      partnerSelect,
      headers,
      partnerGuess
    );
  }


  function renderHeaderRow() {
    const row =
      selectedHeaderRow();

    if (!row) {
      return;
    }

    currentHeaders =
      row.values
        .map(
          value =>
            String(
              value || ""
            ).trim()
        )
        .filter(Boolean);

    headerChips.innerHTML =
      "";

    currentHeaders.forEach(
      header => {
        const chip =
          document.createElement(
            "span"
          );

        chip.className =
          "header-chip";

        chip.textContent =
          header;

        headerChips.appendChild(
          chip
        );
      }
    );

    populateMappings(
      currentHeaders
    );

    mappingSummary.hidden =
      true;

    resetAnalysisResult();
  }


  function populateHeaderRows() {
    const sheet =
      selectedSheet();

    headerRowSelect.innerHTML =
      "";

    if (!sheet) {
      return;
    }

    sheet.rows.forEach(
      row => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          String(
            row.rowNumber
          );

        const preview =
          row.values
            .filter(Boolean)
            .slice(0, 4)
            .join(" | ");

        option.textContent =
          `第 ${row.rowNumber} 行 · ${preview}`;

        if (
          row.rowNumber ===
          sheet.detectedHeaderRow
        ) {
          option.selected =
            true;
        }

        headerRowSelect.appendChild(
          option
        );
      }
    );

    renderHeaderRow();
  }


  function renderInspection() {
    sheetSelect.innerHTML =
      "";

    inspection.sheets.forEach(
      sheet => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          sheet.name;

        option.textContent =
          sheet.name;

        sheetSelect.appendChild(
          option
        );
      }
    );

    populateHeaderRows();

    mappingPanel.hidden =
      false;

    mappingPanel.scrollIntoView({
      behavior:
        "smooth",
      block:
        "start"
    });
  }


  inspectButton.addEventListener(
    "click",
    async () => {
      if (!currentFile) {
        return;
      }

      inspectButton.disabled =
        true;

      inspectButton.textContent =
        "正在读取 Excel…";

      resetInspection();

      const formData =
        new FormData();

      formData.append(
        "file",
        currentFile
      );

      formData.append(
        "analysisType",
        analysisType
      );

      try {
        const response =
          await fetch(
            "/api/sales-income/inspect",
            {
              method:
                "POST",
              body:
                formData
            }
          );

        const payload =
          await response.json();

        if (!response.ok) {
          throw new Error(
            payload.error ||
            "读取 Excel 失败"
          );
        }

        if (
          !payload.sheets ||
          !payload.sheets.length
        ) {
          throw new Error(
            "没有检测到工作表"
          );
        }

        currentJobId =
          payload.jobId;

        inspection =
          payload;

        renderInspection();

        showToast(
          "Excel 表头读取完成。"
        );
      } catch (error) {
        console.error(
          error
        );

        showToast(
          error.message ||
          "读取 Excel 失败。",
          "error"
        );
      } finally {
        inspectButton.disabled =
          !currentFile;

        inspectButton.textContent =
          "重新读取工作表与表头 →";
      }
    }
  );


  sheetSelect.addEventListener(
    "change",
    populateHeaderRows
  );


  headerRowSelect.addEventListener(
    "change",
    renderHeaderRow
  );


  confirmMappingButton.addEventListener(
    "click",
    () => {
      const mapping = {
        document:
          documentSelect.value,
        amount:
          amountSelect.value,
        text:
          textSelect.value,
        partner:
          partnerSelect.value
      };

      if (
        analysisType === "sales"
      ) {
        mapping.reference =
          referenceSelect.value;
      }

      const missing =
        Object.entries(
          mapping
        )
          .filter(
            ([, value]) =>
              !value
          )
          .map(
            ([key]) =>
              key
          );

      if (missing.length) {
        showToast(
          `还有字段未选择：${missing.join(", ")}`,
          "error"
        );

        return;
      }

      confirmedConfig = {
        jobId:
          currentJobId,
        analysisType,
        sheetName:
          sheetSelect.value,
        headerRow:
          Number(
            headerRowSelect.value
          ),
        mapping
      };

      mappingPreview.textContent =
        JSON.stringify(
          confirmedConfig,
          null,
          2
        );

      mappingSummary.hidden =
        false;

      runPanel.hidden =
        false;

      downloadButton.hidden =
        true;

      setProgress(
        0,
        "字段配置已确认，可以开始分析。"
      );

      showToast(
        "字段配置已确认。"
      );

      runPanel.scrollIntoView({
        behavior:
          "smooth",
        block:
          "nearest"
      });
    }
  );


  runAnalysisButton.addEventListener(
    "click",
    async () => {
      if (
        running ||
        !confirmedConfig ||
        !currentJobId
      ) {
        return;
      }

      running =
        true;

      runAnalysisButton.disabled =
        true;

      downloadButton.hidden =
        true;

      setProgress(
        15,
        "正在提交字段配置…"
      );

      try {
        setProgress(
          35,
          "正在读取选定工作表…"
        );

        const response =
          await fetch(
            `/api/sales-income/jobs/${currentJobId}/run`,
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  analysisType:
                    confirmedConfig.analysisType,

                  sheetName:
                    confirmedConfig.sheetName,

                  headerRow:
                    confirmedConfig.headerRow,

                  mapping:
                    confirmedConfig.mapping
                })
            }
          );

        let payload = null;

        try {
          payload =
            await response.json();
        } catch (_) {
          payload =
            null;
        }

        if (!response.ok) {
          throw new Error(
            payload?.error ||
            `服务器返回 ${response.status}`
          );
        }

        setProgress(
          100,
          "分析完成，可以下载结果。"
        );

        downloadButton.href =
          payload.downloadUrl;

        downloadButton.hidden =
          false;

        showToast(
          "分析完成。"
        );
      } catch (error) {
        console.error(
          error
        );

        setProgress(
          0,
          "分析失败，请检查字段配置。"
        );

        showToast(
          error.message ||
          "分析失败。",
          "error"
        );
      } finally {
        running =
          false;

        runAnalysisButton.disabled =
          false;
      }
    }
  );


  clearFile();

})();

(() => {
  "use strict";


  const REFRESH_MS =
    5000;


  let panel = null;
  let list = null;
  let summary = null;


  function statusInfo(
    contract
  ) {

    const progress =
      Number(
        contract.progress || 0
      );


    if (
      contract.status ===
      "failed"
    ) {

      return {
        label:
          "解析失败",

        className:
          "is-failed"
      };

    }


    if (
      contract.status ===
      "completed"
    ) {

      return {
        label:
          "已完成",

        className:
          "is-completed"
      };

    }


    if (
      contract.stage ===
      "reviewing"
    ) {

      return {
        label:
          "待人工校对",

        className:
          "is-reviewing"
      };

    }


    if (
      contract.stage ===
      "parsing"
      ||
      contract.status ===
      "processing"
    ) {

      return {
        label:
          `解析中 ${progress}%`,

        className:
          "is-processing"
      };

    }


    return {
      label:
        "排队中",

      className:
        "is-queued"
    };

  }


  function parseDetailText(
    contract
  ) {

    const requestedBackend =
      contract.requestedBackend;

    const actualBackend =
      contract.parseBackend;


    let engine =
      "本地 MinerU（历史默认）";


    if (requestedBackend === "cloud") {
      engine = "MinerU 云端 API";
    } else if (requestedBackend === "local") {
      engine = "本地 MinerU";
    } else if (actualBackend === "cloud") {
      engine = "MinerU 云端 API（历史）";
    }


    const parts = [
      `解析引擎：${engine}`
    ];


    const modeMap = {
      auto: "自动",
      fast: "快速",
      accurate: "高精度"
    };

    const requestedMode =
      modeMap[contract.requestedMode];

    if (requestedMode) {
      parts.push(`模式：${requestedMode}`);
    }


    const model =
      contract.parseModelVersion
      || contract.actualTier;

    if (model) {
      parts.push(`模型：${model}`);
    }


    if (contract.cacheHit) {
      parts.push("缓存命中");
    }


    if (contract.fallbackUsed) {
      parts.push("自动升级高精度");
    }


    return parts.join(" · ");

  }


  function createPanel() {

    if (panel) {
      return;
    }


    panel =
      document.createElement(
        "section"
      );


    panel.id =
      "contractHistoryPanel";

    panel.className =
      "contract-history-panel";


    const header =
      document.createElement(
        "div"
      );


    header.className =
      "contract-history-header";


    const heading =
      document.createElement(
        "div"
      );


    heading.className =
      "contract-history-heading";


    const number =
      document.createElement(
        "span"
      );


    number.className =
      "contract-history-number";

    number.textContent =
      "03";


    const copy =
      document.createElement(
        "div"
      );


    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      "我的合同";


    const description =
      document.createElement(
        "div"
      );

    description.className =
      "contract-history-description";

    description.textContent =
      "当前账号上传的合同及其独立处理状态";


    copy.appendChild(
      title
    );

    copy.appendChild(
      description
    );


    heading.appendChild(
      number
    );

    heading.appendChild(
      copy
    );


    summary =
      document.createElement(
        "span"
      );

    summary.className =
      "contract-history-summary";


    header.appendChild(
      heading
    );

    header.appendChild(
      summary
    );


    list =
      document.createElement(
        "div"
      );

    list.className =
      "contract-history-list";


    panel.appendChild(
      header
    );

    panel.appendChild(
      list
    );


    const main =
      document.querySelector(
        "main"
      );


    if (main) {

      main.appendChild(
        panel
      );

    } else {

      document.body.appendChild(
        panel
      );

    }

  }


  function makeButton(
    label,
    href,
    className = ""
  ) {

    const link =
      document.createElement(
        "a"
      );


    link.className =
      `contract-history-action ${className}`;


    link.textContent =
      label;


    link.href =
      href;


    return link;

  }


  async function deleteContract(
    contract
  ) {

    const confirmed =
      window.confirm(
        `确定删除这份合同吗？\n\n${contract.originalName || contract.id}\n\n删除后将无法恢复。`
      );


    if (!confirmed) {
      return;
    }


    try {

      const response =
        await fetch(
          `/api/contracts/${
            encodeURIComponent(
              contract.id
            )
          }`,
          {
            method:
              "DELETE",

            credentials:
              "same-origin",

            headers: {
              Accept:
                "application/json"
            }
          }
        );


      const payload =
        await response.json();


      if (
        !response.ok
        ||
        !payload?.ok
      ) {

        throw new Error(
          payload?.error
          ||
          "删除失败"
        );

      }


      const currentId =
        localStorage.getItem(
          "liuxianlab-contract-current-job"
        );


      if (
        String(
          currentId
        ) ===
        String(
          contract.id
        )
      ) {

        localStorage.removeItem(
          "liuxianlab-contract-current-job"
        );

      }


      /*
       * Reloading also clears any stale
       * current-task UI belonging to the
       * contract that was just deleted.
       */
      window.location.reload();


    } catch (error) {

      window.alert(
        `删除合同失败：${error.message}`
      );

    }

  }


  function renderContract(
    contract
  ) {

    const row =
      document.createElement(
        "article"
      );


    row.className =
      "contract-history-row";


    row.dataset.contractId =
      contract.id;


    const main =
      document.createElement(
        "div"
      );

    main.className =
      "contract-history-main";


    const name =
      document.createElement(
        "strong"
      );

    name.className =
      "contract-history-name";

    name.textContent =
      contract.originalName
      || contract.id;


    const meta =
      document.createElement(
        "div"
      );

    meta.className =
      "contract-history-meta";


    const created =
      contract.createdAt
        ? new Date(
            contract.createdAt
          )
        : null;


    meta.textContent =
      created
        ? `上传于 ${created.toLocaleString()}`
        : contract.id;


    main.appendChild(
      name
    );

    main.appendChild(
      meta
    );


    const detail =
      document.createElement(
        "div"
      );

    detail.className =
      "contract-history-detail";

    detail.textContent =
      parseDetailText(
        contract
      );

    main.appendChild(
      detail
    );


    const state =
      document.createElement(
        "div"
      );

    state.className =
      "contract-history-state";


    const info =
      statusInfo(
        contract
      );


    const badge =
      document.createElement(
        "span"
      );


    badge.className =
      `contract-history-badge ${info.className}`;


    badge.textContent =
      info.label;


    const progress =
      document.createElement(
        "div"
      );


    progress.className =
      "contract-history-progress";


    const progressFill =
      document.createElement(
        "div"
      );


    progressFill.className =
      "contract-history-progress-fill";


    progressFill.style.width =
      `${
        Math.max(
          0,
          Math.min(
            100,
            Number(
              contract.progress || 0
            )
          )
        )
      }%`;


    progress.appendChild(
      progressFill
    );


    state.appendChild(
      badge
    );

    state.appendChild(
      progress
    );


    const actions =
      document.createElement(
        "div"
      );


    actions.className =
      "contract-history-actions";


    /*
     * Each contract gets actions according to
     * ITS OWN UUID and ITS OWN database state.
     */
    if (
      contract.status ===
        "processing"
      &&
      contract.stage ===
        "reviewing"
      &&
      Number(
        contract.progress
      ) >= 90
    ) {

      actions.appendChild(
        makeButton(
          "人工校对",
          `/tools/contract-review/review?id=${
            encodeURIComponent(
              contract.id
            )
          }`,
          "is-primary"
        )
      );

    } else if (
      contract.status ===
      "completed"
    ) {

      actions.appendChild(
        makeButton(
          "查看结果",
          `/tools/contract-review/review?id=${
            encodeURIComponent(
              contract.id
            )
          }`
        )
      );


      actions.appendChild(
        makeButton(
          "下载 Markdown",
          `/api/contracts/${
            encodeURIComponent(
              contract.id
            )
          }/result.md`,
          "is-primary"
        )
      );

    } else {

      const disabled =
        document.createElement(
          "span"
        );


      disabled.className =
        "contract-history-action is-disabled";


      if (
        contract.status ===
        "failed"
      ) {

        disabled.textContent =
          "解析失败";

      } else if (
        contract.status ===
        "queued"
      ) {

        disabled.textContent =
          "等待解析";

      } else {

        disabled.textContent =
          "正在解析";

      }


      actions.appendChild(
        disabled
      );

    }


    /*
     * Download exists on every row.
     *
     * It is enabled only after human review
     * has produced final/document.md and the
     * database state is completed / 100%.
     */
    const existingDownload =
      actions.querySelector(
        'a[href*="/result.md"]'
      );


    if (!existingDownload) {

      if (
        contract.status ===
          "completed"
        &&
        contract.stage ===
          "completed"
        &&
        Number(
          contract.progress
        ) >= 100
      ) {

        actions.appendChild(
          makeButton(
            "下载 Markdown",
            `/api/contracts/${
              encodeURIComponent(
                contract.id
              )
            }/result.md`,
            "is-primary"
          )
        );

      } else {

        const downloadDisabled =
          document.createElement(
            "span"
          );


        downloadDisabled.className =
          "contract-history-action is-disabled";


        downloadDisabled.textContent =
          "下载 Markdown";


        downloadDisabled.title =
          "完成全部人工校对并生成最终 Markdown 后可下载";


        actions.appendChild(
          downloadDisabled
        );

      }

    }


    /*
     * Delete is always available.
     */
    const deleteButton =
      document.createElement(
        "button"
      );


    deleteButton.type =
      "button";


    deleteButton.className =
      "contract-history-action is-danger";


    deleteButton.textContent =
      "删除";


    deleteButton.addEventListener(
      "click",
      () => {

        deleteContract(
          contract
        );

      }
    );


    actions.appendChild(
      deleteButton
    );


    row.appendChild(
      main
    );

    row.appendChild(
      state
    );

    row.appendChild(
      actions
    );


    return row;

  }


  function render(
    contracts
  ) {

    createPanel();


    list.replaceChildren();


    summary.textContent =
      `${contracts.length} 份合同`;


    if (
      contracts.length === 0
    ) {

      const empty =
        document.createElement(
          "div"
        );


      empty.className =
        "contract-history-empty";


      empty.textContent =
        "当前账号还没有上传过合同。";


      list.appendChild(
        empty
      );

      return;

    }


    for (
      const contract
      of contracts
    ) {

      list.appendChild(
        renderContract(
          contract
        )
      );

    }

  }


  async function loadHistory() {

    createPanel();


    try {

      const response =
        await fetch(
          "/api/contracts/history",
          {
            credentials:
              "same-origin",

            headers: {
              Accept:
                "application/json"
            }
          }
        );


      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );

      }


      const payload =
        await response.json();


      if (!payload?.ok) {

        throw new Error(
          payload?.error
          ||
          "无法读取合同记录"
        );

      }


      render(
        Array.isArray(
          payload.contracts
        )
          ? payload.contracts
          : []
      );


    } catch (error) {

      summary.textContent =
        "读取失败";


      list.innerHTML =
        "";


      const node =
        document.createElement(
          "div"
        );


      node.className =
        "contract-history-empty";


      node.textContent =
        `无法读取合同记录：${error.message}`;


      list.appendChild(
        node
      );

    }

  }


  window.addEventListener(
    "contract-created",
    () => {

      setTimeout(
        loadHistory,
        250
      );

    }
  );


  function start() {

    loadHistory();


    setInterval(
      loadHistory,
      REFRESH_MS
    );

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      start
    );

  } else {

    start();

  }

})();

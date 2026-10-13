(() => {
  "use strict";


  const params =
    new URLSearchParams(
      window.location.search
    );


  const contractId =
    params.get("id");


  const editor =
    document.getElementById(
      "draftEditor"
    );


  let issueDocument = {
    issues: []
  };


  let panel = null;
  let list = null;
  let countBadge = null;
  let summaryText = null;


  function openIssues() {

    return (
      issueDocument.issues
      || []
    ).filter(
      issue =>
        issue.status !==
        "resolved"
    );

  }


  function getOpenCount() {

    return openIssues().length;

  }


  async function requestJson(
    url,
    options = {}
  ) {

    const headers = {
      Accept:
        "application/json",

      ...(options.headers || {})
    };


    if (
      options.body
      &&
      !headers["Content-Type"]
    ) {

      headers["Content-Type"] =
        "application/json";

    }


    const response =
      await fetch(
        url,
        {
          credentials:
            "same-origin",

          ...options,

          headers
        }
      );


    let payload =
      null;


    try {

      payload =
        await response.json();

    } catch (_) {
      // Ignore malformed response.
    }


    if (
      !response.ok
      ||
      !payload?.ok
    ) {

      throw new Error(
        payload?.error
        ||
        `请求失败：${response.status}`
      );

    }


    return payload;

  }


  function createPanel() {

    if (
      panel
      ||
      !editor
    ) {
      return;
    }


    panel =
      document.createElement(
        "section"
      );


    panel.id =
      "ocrIssuesPanel";


    panel.className =
      "ocr-issues-panel";


    const header =
      document.createElement(
        "div"
      );


    header.className =
      "ocr-issues-header";


    const titleGroup =
      document.createElement(
        "div"
      );


    titleGroup.className =
      "ocr-issues-title-group";


    const title =
      document.createElement(
        "strong"
      );


    title.textContent =
      "识别待核对项";


    countBadge =
      document.createElement(
        "span"
      );


    countBadge.className =
      "ocr-issues-count";


    titleGroup.appendChild(
      title
    );

    titleGroup.appendChild(
      countBadge
    );


    summaryText =
      document.createElement(
        "span"
      );


    summaryText.className =
      "ocr-issues-summary";


    header.appendChild(
      titleGroup
    );

    header.appendChild(
      summaryText
    );


    list =
      document.createElement(
        "div"
      );


    list.className =
      "ocr-issues-list";


    panel.appendChild(
      header
    );

    panel.appendChild(
      list
    );


    editor.parentElement.insertBefore(
      panel,
      editor
    );

  }


  function severityLabel(
    severity
  ) {

    if (
      severity === "error"
    ) {
      return "必须核对";
    }


    return "建议核对";

  }


  function locateText(
    text
  ) {

    if (
      !editor
      ||
      !text
    ) {
      return false;
    }


    const index =
      editor.value.indexOf(
        text
      );


    if (
      index < 0
    ) {

      window.alert(
        `当前校对稿中没有找到：\n${text}\n\n该内容可能已经被人工修改。`
      );

      return false;

    }


    editor.focus();


    editor.setSelectionRange(
      index,
      index + text.length
    );


    const before =
      editor.value.slice(
        0,
        index
      );


    const lineCount =
      before.split("\n").length;


    const computed =
      window.getComputedStyle(
        editor
      );


    const lineHeight =
      parseFloat(
        computed.lineHeight
      ) || 24;


    editor.scrollTop =
      Math.max(
        0,
        (
          lineCount - 4
        )
        * lineHeight
      );


    return true;

  }


  async function ensureDraftSaved() {

    const draftApi =
      window.ContractReviewDraft;


    if (
      !draftApi
      ||
      typeof draftApi.save !==
        "function"
    ) {

      throw new Error(
        "草稿保存服务尚未初始化"
      );

    }


    const dirty =
      (
        typeof draftApi.isDirty ===
          "function"
      )
        ? draftApi.isDirty()
        : true;


    if (!dirty) {

      return true;

    }


    const saved =
      await draftApi.save();


    if (!saved) {

      throw new Error(
        "当前 Markdown 尚未成功保存"
      );

    }


    return true;

  }


  async function locateIssue(
    issue
  ) {

    /*
     * Right side: locate OCR text.
     */
    const textLocated =
      locateText(
        issue.sourceText
      );


    /*
     * Left side: jump PDF and show bbox.
     */
    const pdfApi =
      window.ContractPdfViewer;


    let pdfLocated =
      false;


    if (
      pdfApi
      &&
      typeof pdfApi.locateIssue ===
        "function"
    ) {

      try {

        pdfLocated =
          await pdfApi.locateIssue(
            issue
          );

      } catch (error) {

        console.warn(
          "[OCR PDF locate]",
          error
        );

      }

    }


    if (
      !pdfLocated
      &&
      (
        !issue.page
        ||
        !Array.isArray(
          issue.bbox
        )
      )
    ) {

      console.info(
        "[OCR issue]",
        "No PDF page/bbox available:",
        issue.id
      );

    }


    return {
      textLocated,
      pdfLocated
    };

  }


  async function applySuggestion(
    issue
  ) {

    const source =
      String(
        issue.sourceText
        || ""
      );


    const suggestion =
      String(
        issue.suggestedText
        || ""
      );


    if (
      !source
      ||
      !suggestion
    ) {

      window.alert(
        "这个问题没有可自动采用的建议，请人工检查。"
      );

      return;

    }


    const index =
      editor.value.indexOf(
        source
      );


    if (
      index < 0
    ) {

      window.alert(
        "当前校对稿中已经找不到原 OCR 文字，可能已经修改过。"
      );

      return;

    }


    editor.value =
      editor.value.slice(
        0,
        index
      )
      +
      suggestion
      +
      editor.value.slice(
        index + source.length
      );


    /*
     * Trigger review.js input handler:
     * - mark draft dirty
     * - update character count
     */
    editor.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );


    locateText(
      suggestion
    );

    /*
     * SUGGESTION_AUTO_SAVE_V1
     *
     * A suggested correction is not considered
     * safely applied until the Markdown draft has
     * been persisted on the server.
     */
    try {

      await ensureDraftSaved();


    } catch (error) {

      window.alert(
        `建议已经写入编辑器，但草稿保存失败：${error.message}`
      );

      return false;

    }


    return true;

  }


  /*
   * BULK_RESOLVE_ALL_V1
   *
   * Intended workflow:
   *
   * 1. Reviewer examines issues one by one.
   * 2. Reviewer manually edits Markdown or uses
   *    individual suggestions where appropriate.
   * 3. Reviewer does NOT need to resolve each issue.
   * 4. When all Markdown corrections are complete,
   *    one click resolves every remaining issue.
   *
   * Important:
   * - this function NEVER changes Markdown text;
   * - this function NEVER applies OCR suggestions;
   * - latest Markdown is saved before issue states
   *   are changed.
   */
  async function resolveAllIssues(
    button
  ) {

    const unresolved =
      openIssues();


    if (
      unresolved.length === 0
    ) {

      window.alert(
        "当前已经没有待核对项。"
      );

      return false;

    }


    const confirmed =
      window.confirm(
        `确认一键已核对全部 ${unresolved.length} 项？\n\n`
        +
        "请确认你已经逐项查看原件，并完成所有需要的 Markdown 修改。\n\n"
        +
        "此操作不会修改 Markdown，也不会自动采用任何 OCR 建议；"
        +
        "只会把当前全部待核对项统一标记为“已核对”。"
      );


    if (!confirmed) {

      return false;

    }


    const originalText =
      button
        ? button.textContent
        : "";


    let completed =
      0;


    try {

      /*
       * Save all manual edits first.
       *
       * Resolving issues is not allowed while
       * the latest Markdown only exists inside
       * the browser.
       */
      await ensureDraftSaved();


      if (button) {

        button.disabled =
          true;

        button.textContent =
          `正在确认 0/${unresolved.length}`;

      }


      /*
       * Sequential requests are intentional.
       *
       * The existing single-issue API has already
       * been validated, and sequential writes avoid
       * concurrent modification of issues.json.
       */
      for (
        const issue
        of unresolved
      ) {

        await requestJson(
          `/api/contracts/${
            encodeURIComponent(
              contractId
            )
          }/issues/${
            encodeURIComponent(
              issue.id
            )
          }/resolve`,
          {
            method:
              "POST",

            body:
              JSON.stringify({
                resolution:
                  "bulk_reviewed",

                note:
                  "一键已核对"
              })
          }
        );


        completed += 1;


        if (button) {

          button.textContent =
            `正在确认 ${completed}/${unresolved.length}`;

        }

      }


      /*
       * Always re-read real server state.
       */
      await loadIssues();


      return true;


    } catch (error) {

      /*
       * Some requests may already have succeeded.
       * Reload so browser state matches issues.json.
       */
      try {

        await loadIssues();

      } catch (_) {
        // Ignore secondary reload failure.
      }


      window.alert(
        `一键已核对未完全完成。\n\n`
        +
        `已完成：${completed}/${unresolved.length}\n`
        +
        `原因：${error.message}\n\n`
        +
        "已经成功确认的项目会保留。"
        +
        "修复问题后可以再次点击继续处理剩余项目。"
      );


      return false;


    } finally {

      if (
        button
        &&
        document.body.contains(
          button
        )
      ) {

        button.disabled =
          false;

        button.textContent =
          originalText;

      }

    }

  }


  async function resolveIssue(
    issue
  ) {

    const confirmed =
      window.confirm(
        `确认该项已经人工核对？\n\n${issue.title}`
      );


    if (!confirmed) {
      return;
    }


    try {

      /*
       * RESOLVE_REQUIRES_SAVED_DRAFT_V1
       *
       * If the reviewer manually changed Markdown
       * and immediately clicks "已核对", save those
       * changes before changing the issue state.
       */
      await ensureDraftSaved();


      await requestJson(
        `/api/contracts/${
          encodeURIComponent(
            contractId
          )
        }/issues/${
          encodeURIComponent(
            issue.id
          )
        }/resolve`,
        {
          method:
            "POST",

          body:
            JSON.stringify({
              resolution:
                "reviewed",

              note:
                ""
            })
        }
      );


      await loadIssues();


    } catch (error) {

      window.alert(
        `无法确认该问题：${error.message}`
      );

    }

  }


  function makeTextRow(
    label,
    value,
    className = ""
  ) {

    const row =
      document.createElement(
        "div"
      );


    row.className =
      `ocr-issue-text-row ${className}`;


    const labelNode =
      document.createElement(
        "span"
      );


    labelNode.className =
      "ocr-issue-text-label";


    labelNode.textContent =
      label;


    const valueNode =
      document.createElement(
        "code"
      );


    valueNode.textContent =
      value || "—";


    row.appendChild(
      labelNode
    );

    row.appendChild(
      valueNode
    );


    return row;

  }


  function renderIssue(
    issue
  ) {

    const card =
      document.createElement(
        "article"
      );


    card.className =
      [
        "ocr-issue-card",
        `severity-${issue.severity || "warning"}`,
        issue.status === "resolved"
          ? "is-resolved"
          : ""
      ]
        .filter(Boolean)
        .join(" ");


    const top =
      document.createElement(
        "div"
      );


    top.className =
      "ocr-issue-card-top";


    const title =
      document.createElement(
        "strong"
      );


    title.textContent =
      issue.title
      || "识别待核对";


    const severity =
      document.createElement(
        "span"
      );


    severity.className =
      "ocr-issue-severity";


    severity.textContent =
      issue.status === "resolved"
        ? "已核对"
        : severityLabel(
            issue.severity
          );


    top.appendChild(
      title
    );

    top.appendChild(
      severity
    );


    card.appendChild(
      top
    );


    if (
      issue.page
    ) {

      const location =
        document.createElement(
          "div"
        );


      location.className =
        "ocr-issue-location";


      location.textContent =
        `原件位置：第 ${issue.page} 页`;


      card.appendChild(
        location
      );

    }


    if (
      issue.message
    ) {

      const message =
        document.createElement(
          "div"
        );


      message.className =
        "ocr-issue-message";


      message.textContent =
        issue.message;


      card.appendChild(
        message
      );

    }


    const isCritical =
      issue.type === "critical_integrity";


    if (
      isCritical &&
      issue.parsedValue
    ) {

      card.appendChild(
        makeTextRow(
          "解析结果",
          issue.parsedValue,
          "ocr-source"
        )
      );

    }


    if (
      isCritical &&
      issue.referenceValue
    ) {

      card.appendChild(
        makeTextRow(
          "关联信息",
          issue.referenceValue,
          "ocr-suggestion"
        )
      );

    }


    if (
      !isCritical &&
      issue.sourceText
    ) {

      card.appendChild(
        makeTextRow(
          "OCR",
          issue.sourceText,
          "ocr-source"
        )
      );

    }


    if (
      issue.suggestedText
    ) {

      card.appendChild(
        makeTextRow(
          "建议",
          issue.suggestedText,
          "ocr-suggestion"
        )
      );

    }


    if (
      issue.status !==
      "resolved"
    ) {

      const actions =
        document.createElement(
          "div"
        );


      actions.className =
        "ocr-issue-actions";


      if (
        issue.sourceText
      ) {

        const locateButton =
          document.createElement(
            "button"
          );


        locateButton.type =
          "button";


        locateButton.className =
          "ocr-issue-button";


        locateButton.textContent =
          "定位原件";


        locateButton.addEventListener(
          "click",
          () => {

            locateIssue(
              issue
            );

          }
        );


        actions.appendChild(
          locateButton
        );

      }


      if (
        issue.sourceText
        &&
        issue.suggestedText
      ) {

        const suggestionButton =
          document.createElement(
            "button"
          );


        suggestionButton.type =
          "button";


        suggestionButton.className =
          "ocr-issue-button";


        suggestionButton.textContent =
          "采用建议";


        suggestionButton.addEventListener(
          "click",
          () => {

            applySuggestion(
              issue
            );

          }
        );


        actions.appendChild(
          suggestionButton
        );

      }


      /*
       * INDIVIDUAL_RESOLVE_BUTTON_REMOVED_V1
       *
       * Individual issue cards intentionally do not
       * contain an "已核对" button anymore.
       *
       * Reviewer first finishes all Markdown edits,
       * then uses the single bulk confirmation button.
       */


      card.appendChild(
        actions
      );

    }


    return card;

  }


  function renderIssues() {

    createPanel();


    const issues =
      issueDocument.issues
      || [];


    const unresolved =
      issues.filter(
        issue =>
          issue.status !==
          "resolved"
      );


    if (countBadge) {

      countBadge.textContent =
        String(
          unresolved.length
        );

    }


    if (summaryText) {

      if (
        unresolved.length === 0
      ) {

        summaryText.textContent =
          "没有未处理的识别待核对项";

      } else {

        summaryText.textContent =
          `共发现 ${issues.length} 项，待处理 ${unresolved.length} 项`;

      }

    }


    list.replaceChildren();


    /*
     * BULK_REVIEW_UI_V1
     *
     * Individual cards are for inspection/editing.
     * Resolution happens once, after all edits.
     */
    if (
      unresolved.length > 0
    ) {

      const bulkBar =
        document.createElement(
          "div"
        );


      bulkBar.className =
        "ocr-bulk-review-bar";


      const bulkInfo =
        document.createElement(
          "div"
        );


      bulkInfo.className =
        "ocr-bulk-review-info";


      const bulkTitle =
        document.createElement(
          "strong"
        );


      bulkTitle.textContent =
        "全部修改完成？";


      const bulkHint =
        document.createElement(
          "span"
        );


      bulkHint.textContent =
        "逐项检查并修改 Markdown 后，在这里统一确认。";


      bulkInfo.appendChild(
        bulkTitle
      );


      bulkInfo.appendChild(
        bulkHint
      );


      const bulkButton =
        document.createElement(
          "button"
        );


      bulkButton.type =
        "button";


      bulkButton.className =
        "ocr-bulk-review-button";


      bulkButton.textContent =
        `一键已核对全部 ${unresolved.length} 项`;


      bulkButton.addEventListener(
        "click",
        () => {

          resolveAllIssues(
            bulkButton
          );

        }
      );


      bulkBar.appendChild(
        bulkInfo
      );


      bulkBar.appendChild(
        bulkButton
      );


      list.appendChild(
        bulkBar
      );

    }


    const ordered = [
      ...unresolved,

      ...issues.filter(
        issue =>
          issue.status ===
          "resolved"
      )
    ];


    if (
      ordered.length === 0
    ) {

      const empty =
        document.createElement(
          "div"
        );


      empty.className =
        "ocr-issues-empty";


      empty.textContent =
        "当前没有检测到明显的识别疑似问题。";


      list.appendChild(
        empty
      );


      return;

    }


    for (
      const issue
      of ordered
    ) {

      list.appendChild(
        renderIssue(
          issue
        )
      );

    }

  }


  async function loadIssues() {

    if (
      !contractId
    ) {
      return;
    }


    try {

      const payload =
        await requestJson(
          `/api/contracts/${
            encodeURIComponent(
              contractId
            )
          }/issues`
        );


      issueDocument = {
        ...payload,

        issues:
          Array.isArray(
            payload.issues
          )
            ? payload.issues
            : []
      };


      renderIssues();


    } catch (error) {

      createPanel();


      summaryText.textContent =
        "无法读取识别待核对项";


      list.innerHTML =
        "";


      const errorNode =
        document.createElement(
          "div"
        );


      errorNode.className =
        "ocr-issues-empty";


      errorNode.textContent =
        error.message;


      list.appendChild(
        errorNode
      );

    }

  }


  /*
   * Expose only the minimum API needed by
   * review.js before finalization.
   */
  window.ContractReviewIssues = {

    getOpenCount,

    reload:
      loadIssues,

    locateText

  };


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      loadIssues
    );

  } else {

    loadIssues();

  }

})();

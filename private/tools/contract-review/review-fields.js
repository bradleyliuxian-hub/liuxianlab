(() => {
  "use strict";


  const params =
    new URLSearchParams(
      window.location.search
    );


  const contractId =
    params.get(
      "id"
    );


  const editor =
    document.getElementById(
      "draftEditor"
    );


  let panel =
    null;


  function createElement(
    tag,
    className,
    text
  ) {

    const element =
      document.createElement(
        tag
      );


    if (className) {

      element.className =
        className;

    }


    if (
      text !== undefined
      &&
      text !== null
    ) {

      element.textContent =
        String(
          text
        );

    }


    return element;

  }


  function firstValue(
    value
  ) {

    if (
      Array.isArray(
        value
      )
    ) {

      return (
        value[0]
        ||
        ""
      );

    }


    return (
      value
      ||
      ""
    );

  }


  function allValues(
    value
  ) {

    if (
      !Array.isArray(
        value
      )
    ) {

      return (
        value
        ? String(
            value
          )
        : "—"
      );

    }


    if (
      value.length === 0
    ) {

      return "—";

    }


    return value.join(
      " / "
    );

  }


  function formatNumber(
    value
  ) {

    if (
      value === null
      ||
      value === undefined
      ||
      value === ""
    ) {

      return "—";

    }


    const number =
      Number(
        value
      );


    if (
      !Number.isFinite(
        number
      )
    ) {

      return String(
        value
      );

    }


    return number.toLocaleString(
      "zh-CN",
      {
        maximumFractionDigits:
          2
      }
    );

  }


  function makeField(
    label,
    value,
    options = {}
  ) {

    const item =
      createElement(
        "div",
        "contract-field-item"
      );


    const labelNode =
      createElement(
        "div",
        "contract-field-label",
        label
      );


    const valueNode =
      createElement(
        "div",
        "contract-field-value",
        value || "—"
      );


    if (
      options.mono
    ) {

      valueNode.classList.add(
        "is-mono"
      );

    }


    item.appendChild(
      labelNode
    );


    item.appendChild(
      valueNode
    );


    return item;

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
      createElement(
        "section",
        "contract-fields-panel"
      );


    panel.id =
      "contractFieldsPanel";


    /*
     * Keep the order:
     *
     * Contract information
     * OCR issues
     * Markdown editor
     */
    const issuePanel =
      document.getElementById(
        "ocrIssuesPanel"
      );


    if (issuePanel) {

      editor.parentElement
        .insertBefore(
          panel,
          issuePanel
        );

    } else {

      editor.parentElement
        .insertBefore(
          panel,
          editor
        );

    }

  }


  function renderUnavailable() {

    createPanel();


    panel.innerHTML =
      "";


    const header =
      createElement(
        "div",
        "contract-fields-header"
      );


    header.appendChild(
      createElement(
        "strong",
        "",
        "合同信息"
      )
    );


    header.appendChild(
      createElement(
        "span",
        "contract-fields-source",
        "等待生成"
      )
    );


    const empty =
      createElement(
        "div",
        "contract-fields-empty",
        "这份合同暂时还没有结构化信息。"
      );


    panel.appendChild(
      header
    );


    panel.appendChild(
      empty
    );

  }


  function renderTableCheck(
    check
  ) {

    const card =
      createElement(
        "div",
        "contract-math-card"
      );


    const heading =
      createElement(
        "div",
        "contract-math-heading"
      );


    heading.appendChild(
      createElement(
        "strong",
        "",
        "租赁金额校验"
      )
    );


    const badge =
      createElement(
        "span",
        (
          check.passed
            ? "contract-check-badge is-ok"
            : "contract-check-badge is-warning"
        ),
        (
          check.passed
            ? "一致"
            : "需核对"
        )
      );


    heading.appendChild(
      badge
    );


    const equation =
      createElement(
        "div",
        "contract-math-equation"
      );


    const quantity =
      formatNumber(
        check.quantity
      );


    const years =
      formatNumber(
        check.years
      );


    const unitPrice =
      formatNumber(
        check.unitPrice
      );


    const expectedTotal =
      formatNumber(
        check.expectedTotal
      );


    equation.textContent =
      `${quantity} × ${years} × ${unitPrice} = ${expectedTotal}`;


    const detail =
      createElement(
        "div",
        "contract-math-detail"
      );


    detail.textContent =
      `合同总金额：${
        formatNumber(
          check.documentTotal
        )
      } · 原件第 ${
        check.page || "—"
      } 页`;


    card.appendChild(
      heading
    );


    card.appendChild(
      equation
    );


    card.appendChild(
      detail
    );


    return card;

  }


  function renderFields(
    payload
  ) {

    createPanel();


    panel.innerHTML =
      "";


    const fields =
      payload.fields
      ||
      {};


    const checks =
      Array.isArray(
        payload.tableChecks
      )
        ? payload.tableChecks
        : [];


    const header =
      createElement(
        "div",
        "contract-fields-header"
      );


    const titleGroup =
      createElement(
        "div",
        "contract-fields-title"
      );


    titleGroup.appendChild(
      createElement(
        "strong",
        "",
        "合同信息"
      )
    );


    titleGroup.appendChild(
      createElement(
        "span",
        "contract-fields-note",
        "确定性提取"
      )
    );


    const toggle =
      createElement(
        "button",
        "contract-fields-toggle",
        "收起"
      );


    toggle.type =
      "button";


    header.appendChild(
      titleGroup
    );


    header.appendChild(
      toggle
    );


    const body =
      createElement(
        "div",
        "contract-fields-body"
      );


    const grid =
      createElement(
        "div",
        "contract-fields-grid"
      );


    grid.appendChild(
      makeField(
        "合同编号",
        allValues(
          fields.contractNumbers
        ),
        {
          mono: true
        }
      )
    );


    grid.appendChild(
      makeField(
        "甲方",
        allValues(
          fields.partyA
        )
      )
    );


    grid.appendChild(
      makeField(
        "乙方",
        allValues(
          fields.partyB
        )
      )
    );


    grid.appendChild(
      makeField(
        "文件日期",
        fields.filenameDate
        || "—"
      )
    );


    grid.appendChild(
      makeField(
        "正文明确日期",
        allValues(
          fields.labeledDates
        )
      )
    );


    body.appendChild(
      grid
    );


    if (
      checks.length > 0
    ) {

      const checksContainer =
        createElement(
          "div",
          "contract-math-list"
        );


      for (
        const check
        of checks
      ) {

        checksContainer
          .appendChild(
            renderTableCheck(
              check
            )
          );

      }


      body.appendChild(
        checksContainer
      );

    }


    if (
      Number(
        payload.consistencyIssueCount
        || 0
      ) > 0
    ) {

      const warning =
        createElement(
          "div",
          "contract-fields-warning",
          `发现 ${
            payload.consistencyIssueCount
          } 个字段一致性问题，请在下方待核对项中处理。`
        );


      body.appendChild(
        warning
      );

    }


    toggle.addEventListener(
      "click",
      () => {

        const collapsed =
          body.hidden;


        body.hidden =
          !collapsed;


        toggle.textContent =
          collapsed
            ? "收起"
            : "展开";

      }
    );


    panel.appendChild(
      header
    );


    panel.appendChild(
      body
    );

  }


  async function loadFields() {

    if (
      !contractId
      ||
      !editor
    ) {

      return;

    }


    try {

      const response =
        await fetch(
          `/api/contracts/${
            encodeURIComponent(
              contractId
            )
          }/fields`,
          {
            credentials:
              "same-origin",

            headers: {
              Accept:
                "application/json"
            }
          }
        );


      let payload =
        null;


      try {

        payload =
          await response.json();

      } catch (_) {
        // Ignore invalid JSON here.
      }


      if (
        !response.ok
        ||
        !payload?.ok
      ) {

        throw new Error(
          payload?.error
          ||
          `HTTP ${response.status}`
        );

      }


      if (
        !payload.available
      ) {

        renderUnavailable();

        return;

      }


      renderFields(
        payload
      );


    } catch (error) {

      console.error(
        "[contract fields]",
        error
      );


      createPanel();


      panel.innerHTML =
        "";


      panel.appendChild(
        createElement(
          "div",
          "contract-fields-empty",
          `无法读取合同信息：${error.message}`
        )
      );

    }

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      loadFields
    );

  } else {

    loadFields();

  }

})();

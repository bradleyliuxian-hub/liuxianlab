(() => {
  "use strict";


  const STORAGE_KEY =
    "liuxianlab-contract-current-job";


  const POLL_MS =
    2000;


  const nativeFetch =
    window.fetch.bind(
      window
    );


  let currentId =
    localStorage.getItem(
      STORAGE_KEY
    );


  let timer =
    null;


  function leafElements() {

    return [
      ...document.querySelectorAll(
        "span, p, small, strong, b, div"
      )
    ].filter(
      element =>
        element.children.length === 0
    );

  }


  function replaceExact(
    values,
    replacement
  ) {

    for (
      const element
      of leafElements()
    ) {

      const text =
        element
          .textContent
          .trim();


      if (
        values.includes(
          text
        )
      ) {

        element.textContent =
          replacement;

        return element;

      }

    }


    return null;

  }


  function stageLabel(
    payload
  ) {

    if (
      payload.status ===
      "failed"
    ) {

      return "解析失败";

    }


    if (
      payload.status ===
      "completed"
    ) {

      return "已完成";

    }


    if (
      payload.stage ===
      "reviewing"
    ) {

      return "等待人工校对";

    }


    if (
      payload.stage ===
      "parsing"
    ) {

      return "正在解析";

    }


    if (
      payload.status ===
      "processing"
    ) {

      return "正在处理";

    }


    return "等待解析";

  }


  function updateStatusUi(
    payload
  ) {

    replaceExact(
      [
        "QUEUED",
        "PROCESSING",
        "COMPLETED",
        "FAILED"
      ],
      String(
        payload.status
        || "queued"
      ).toUpperCase()
    );


    replaceExact(
      [
        "等待解析",
        "正在解析",
        "正在处理",
        "等待人工校对",
        "解析完成",
        "解析失败",
        "已完成",
        "任务已创建"
      ],
      stageLabel(
        payload
      )
    );


    const percentage =
      `${Number(
        payload.progress || 0
      )}%`;


    for (
      const element
      of leafElements()
    ) {

      if (
        /^\d+%$/.test(
          element
            .textContent
            .trim()
        )
      ) {

        element.textContent =
          percentage;

        break;

      }

    }


    const bars =
      document.querySelectorAll(
        [
          "[role='progressbar']",
          ".progress-fill",
          ".progress__fill",
          "[data-progress-fill]"
        ].join(",")
      );


    for (
      const bar
      of bars
    ) {

      bar.setAttribute(
        "aria-valuenow",
        String(
          payload.progress || 0
        )
      );


      if (
        bar.classList.contains(
          "progress-fill"
        )
        ||
        bar.classList.contains(
          "progress__fill"
        )
        ||
        bar.hasAttribute(
          "data-progress-fill"
        )
      ) {

        bar.style.width =
          percentage;

      }

    }

  }


  function findStatusHost() {

    const direct =
      document.getElementById(
        "statusPanel"
      );


    if (direct) {
      return direct;
    }


    const candidates = [
      ...document.querySelectorAll(
        "section, article, div"
      )
    ];


    candidates.sort(
      (
        a,
        b
      ) =>
        a.querySelectorAll("*").length
        -
        b.querySelectorAll("*").length
    );


    for (
      const element
      of candidates
    ) {

      const text =
        element.textContent
        || "";


      if (
        (
          text.includes(
            "解析任务"
          )
          ||
          text.includes(
            "审阅任务"
          )
        )
        &&
        /\d+%/.test(
          text
        )
      ) {

        return element;

      }

    }


    return (
      document.querySelector(
        "main"
      )
      ||
      document.body
    );

  }


  function removeReviewEntry() {

    document
      .getElementById(
        "contract-review-entry"
      )
      ?.remove();

  }


  function renderReviewEntry(
    payload
  ) {

    removeReviewEntry();


    /*
     * This is deliberately strict.
     *
     * A review button belongs ONLY to this
     * exact current contract when the same UUID
     * has really reached reviewing / >=90%.
     */
    if (
      !currentId
      ||
      String(
        payload.id
      ) !==
        String(
          currentId
        )
      ||
      payload.status !==
        "processing"
      ||
      payload.stage !==
        "reviewing"
      ||
      Number(
        payload.progress
      ) < 90
    ) {

      return;

    }


    const host =
      findStatusHost();


    const box =
      document.createElement(
        "div"
      );


    box.id =
      "contract-review-entry";

    box.className =
      "contract-review-entry";


    const copy =
      document.createElement(
        "div"
      );


    const title =
      document.createElement(
        "strong"
      );


    title.textContent =
      "OCR 已完成，等待人工校对";


    const description =
      document.createElement(
        "div"
      );


    description.textContent =
      "请对照原合同检查并修正 Markdown 内容。";

    description.className =
      "contract-review-entry-description";


    copy.appendChild(
      title
    );

    copy.appendChild(
      description
    );


    const link =
      document.createElement(
        "a"
      );


    link.href =
      `/tools/contract-review/review?id=${
        encodeURIComponent(
          payload.id
        )
      }`;


    link.textContent =
      "开始人工校对 →";


    link.className =
      "contract-review-entry-button";


    box.appendChild(
      copy
    );

    box.appendChild(
      link
    );


    host.appendChild(
      box
    );

  }


  async function getJson(
    url
  ) {

    const response =
      await nativeFetch(
        url,
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

      return null;

    }


    const payload =
      await response.json();


    return (
      payload?.ok
        ? payload
        : null
    );

  }


  function selectCurrent(
    payload
  ) {

    if (
      !payload?.id
    ) {
      return;
    }


    currentId =
      payload.id;


    localStorage.setItem(
      STORAGE_KEY,
      currentId
    );


    /*
     * Switching to a new UUID immediately removes
     * any action belonging to the previous contract.
     */
    removeReviewEntry();


    updateStatusUi(
      payload
    );


    renderReviewEntry(
      payload
    );

  }


  async function refreshCurrent() {

    if (
      !currentId
    ) {

      removeReviewEntry();

      return;

    }


    try {

      const payload =
        await getJson(
          `/api/contracts/${
            encodeURIComponent(
              currentId
            )
          }/status`
        );


      if (!payload) {

        /*
         * Stale UUID.
         *
         * Do NOT replace it with another contract.
         */
        localStorage.removeItem(
          STORAGE_KEY
        );

        currentId =
          null;

        removeReviewEntry();

        return;

      }


      updateStatusUi(
        payload
      );


      renderReviewEntry(
        payload
      );


    } catch (error) {

      console.warn(
        "[current contract]",
        error
      );

    }

  }


  /*
   * Capture exactly the newly-created contract UUID.
   */
  window.fetch =
    async function (
      input,
      init
    ) {

      const response =
        await nativeFetch(
          input,
          init
        );


      try {

        let url = "";

        let method =
          init?.method
          || "GET";


        if (
          typeof input ===
          "string"
        ) {

          url =
            input;

        } else if (
          input
        ) {

          url =
            input.url
            || "";

          method =
            init?.method
            ||
            input.method
            ||
            "GET";

        }


        const parsed =
          new URL(
            url,
            window.location.origin
          );


        if (
          String(
            method
          ).toUpperCase() ===
            "POST"
          &&
          parsed.pathname ===
            "/api/contracts"
        ) {

          const copy =
            response.clone();


          const payload =
            await copy.json();


          if (
            payload?.ok
            &&
            payload?.id
          ) {

            selectCurrent(
              payload
            );

            /*
             * Ask the history panel to refresh too.
             */
            window.dispatchEvent(
              new CustomEvent(
                "contract-created",
                {
                  detail: {
                    id:
                      payload.id
                  }
                }
              )
            );

          }

        }


      } catch (error) {

        console.warn(
          "[contract upload tracking]",
          error
        );

      }


      return response;

    };


  function start() {

    /*
     * Unlike the previous version,
     * we DO NOT call /latest here.
     *
     * The active task remains the active UUID only.
     */
    refreshCurrent();


    timer =
      setInterval(
        refreshCurrent,
        POLL_MS
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

(() => {
  "use strict";


  const STORAGE_KEY =
    "liuxianlab.contractReviewGuide.v1";


  const steps = [
    {
      number: "01",
      eyebrow: "先认识页面",
      title: "左边看原合同，右边改 Markdown",
      description:
        "人工校对页采用左右对照方式。左侧是原始 PDF，右侧是 MinerU 生成的 Markdown 校对稿。",
      points: [
        "左侧 PDF 是最终判断依据。",
        "右侧 Markdown 可以直接编辑。",
        "修改 Markdown 不会改变原始 PDF，也不会覆盖 MinerU 原始解析文件。"
      ],
      tip:
        "校对时始终以左侧原合同内容为准。"
    },

    {
      number: "02",
      eyebrow: "检查待核对项",
      title: "先逐项查看系统标出的疑似问题",
      description:
        "OCR 待核对区域会列出系统检测到的文字、图片、边缘内容或一致性疑点。",
      points: [
        "点击「定位原件」，左侧 PDF 会跳到对应页并标出位置。",
        "对照原合同判断 Markdown 是否需要修改。",
        "系统提示只是辅助信息，不代表一定存在错误。"
      ],
      tip:
        "发现疑点不等于合同内容一定错误，需要人工判断。"
    },

    {
      number: "03",
      eyebrow: "修改 Markdown",
      title: "一个问题一个问题检查，但不用逐个点“已核对”",
      description:
        "你的主要工作是把右侧 Markdown 修改正确。可以手工修改，也可以在确认建议正确后使用「采用建议」。",
      points: [
        "建议正确：点击「采用建议」。",
        "建议不正确：直接在 Markdown 中手工修改。",
        "没有建议的项目：对照原件后，必要时手工修改。",
        "可以连续处理所有问题，不需要处理一项就确认一项。"
      ],
      tip:
        "「采用建议」只修改对应文字，不代表该问题已经完成最终确认。"
    },

    {
      number: "04",
      eyebrow: "完成全部修改",
      title: "所有内容检查完后，再点“一键已核对全部”",
      description:
        "当你已经逐项看过原件，并把所有需要修改的 Markdown 都处理完成后，再统一确认。",
      points: [
        "点击「一键已核对全部 N 项」。",
        "系统会先保存当前最新 Markdown。",
        "随后把全部剩余待核对项统一标记为“已核对”。",
        "待核对数量应变成 0。"
      ],
      tip:
        "一键已核对不会自动采用任何 OCR 建议，也不会自动修改 Markdown。"
    },

    {
      number: "05",
      eyebrow: "生成最终版本",
      title: "确认待核对项为 0，再生成最终 Markdown",
      description:
        "一键已核对完成后，请确认没有剩余待处理项目，然后执行最终确认。",
      points: [
        "确认页面显示待核对项为 0。",
        "点击「确认并生成最终 Markdown」。",
        "生成后合同状态会变成 COMPLETED。",
        "完成后的 Markdown 会进入只读状态。"
      ],
      tip:
        "生成最终版本是独立动作，一键已核对不会自动提交最终版本。"
    },

    {
      number: "06",
      eyebrow: "完成",
      title: "下载最终 Markdown",
      description:
        "最终版本生成成功后，原来的确认按钮会变成「下载最终 Markdown」。",
      points: [
        "点击「下载最终 Markdown」保存最终文件。",
        "最终文件包含你人工校对后的内容。",
        "以后可以从合同历史记录再次查看或下载。",
        "如需重新查看教学，可随时点击页面顶部「使用说明」。"
      ],
      tip:
        "完整流程：查看原件 → 修改 Markdown → 一键已核对 → 生成最终版本 → 下载。"
    }
  ];


  let currentStep =
    0;


  let overlay =
    null;


  let stepNumber =
    null;


  let eyebrow =
    null;


  let title =
    null;


  let description =
    null;


  let pointList =
    null;


  let tip =
    null;


  let progress =
    null;


  let prevButton =
    null;


  let nextButton =
    null;


  function setSeen() {

    try {

      window.localStorage.setItem(
        STORAGE_KEY,
        "1"
      );

    } catch (_) {
      // localStorage may be unavailable.
    }

  }


  function hasSeen() {

    try {

      return (
        window.localStorage.getItem(
          STORAGE_KEY
        ) === "1"
      );

    } catch (_) {

      return false;

    }

  }


  function createGuide() {

    if (overlay) {
      return;
    }


    overlay =
      document.createElement(
        "div"
      );


    overlay.className =
      "review-guide-overlay";


    overlay.hidden =
      true;


    const dialog =
      document.createElement(
        "section"
      );


    dialog.className =
      "review-guide-dialog";


    dialog.setAttribute(
      "role",
      "dialog"
    );


    dialog.setAttribute(
      "aria-modal",
      "true"
    );


    dialog.setAttribute(
      "aria-labelledby",
      "reviewGuideTitle"
    );


    const header =
      document.createElement(
        "div"
      );


    header.className =
      "review-guide-header";


    const headerText =
      document.createElement(
        "div"
      );


    const headerEyebrow =
      document.createElement(
        "div"
      );


    headerEyebrow.className =
      "review-guide-main-eyebrow";


    headerEyebrow.textContent =
      "CONTRACT REVIEW GUIDE";


    const headerTitle =
      document.createElement(
        "strong"
      );


    headerTitle.textContent =
      "合同人工校对 · 使用说明";


    headerText.appendChild(
      headerEyebrow
    );


    headerText.appendChild(
      headerTitle
    );


    const closeButton =
      document.createElement(
        "button"
      );


    closeButton.type =
      "button";


    closeButton.className =
      "review-guide-close";


    closeButton.setAttribute(
      "aria-label",
      "关闭使用说明"
    );


    closeButton.textContent =
      "×";


    closeButton.addEventListener(
      "click",
      closeGuide
    );


    header.appendChild(
      headerText
    );


    header.appendChild(
      closeButton
    );


    const body =
      document.createElement(
        "div"
      );


    body.className =
      "review-guide-body";


    const stepTop =
      document.createElement(
        "div"
      );


    stepTop.className =
      "review-guide-step-top";


    stepNumber =
      document.createElement(
        "span"
      );


    stepNumber.className =
      "review-guide-step-number";


    eyebrow =
      document.createElement(
        "span"
      );


    eyebrow.className =
      "review-guide-step-eyebrow";


    stepTop.appendChild(
      stepNumber
    );


    stepTop.appendChild(
      eyebrow
    );


    title =
      document.createElement(
        "h2"
      );


    title.id =
      "reviewGuideTitle";


    title.className =
      "review-guide-title";


    description =
      document.createElement(
        "p"
      );


    description.className =
      "review-guide-description";


    pointList =
      document.createElement(
        "ol"
      );


    pointList.className =
      "review-guide-points";


    tip =
      document.createElement(
        "div"
      );


    tip.className =
      "review-guide-tip";


    body.appendChild(
      stepTop
    );


    body.appendChild(
      title
    );


    body.appendChild(
      description
    );


    body.appendChild(
      pointList
    );


    body.appendChild(
      tip
    );


    const footer =
      document.createElement(
        "div"
      );


    footer.className =
      "review-guide-footer";


    progress =
      document.createElement(
        "div"
      );


    progress.className =
      "review-guide-progress";


    const actions =
      document.createElement(
        "div"
      );


    actions.className =
      "review-guide-actions";


    prevButton =
      document.createElement(
        "button"
      );


    prevButton.type =
      "button";


    prevButton.className =
      "button button-secondary review-guide-nav";


    prevButton.textContent =
      "上一步";


    prevButton.addEventListener(
      "click",
      () => {

        if (
          currentStep > 0
        ) {

          currentStep -= 1;

          renderStep();

        }

      }
    );


    nextButton =
      document.createElement(
        "button"
      );


    nextButton.type =
      "button";


    nextButton.className =
      "button button-primary review-guide-nav";


    nextButton.addEventListener(
      "click",
      () => {

        if (
          currentStep <
          steps.length - 1
        ) {

          currentStep += 1;

          renderStep();

          return;

        }


        closeGuide();

      }
    );


    actions.appendChild(
      prevButton
    );


    actions.appendChild(
      nextButton
    );


    footer.appendChild(
      progress
    );


    footer.appendChild(
      actions
    );


    dialog.appendChild(
      header
    );


    dialog.appendChild(
      body
    );


    dialog.appendChild(
      footer
    );


    overlay.appendChild(
      dialog
    );


    overlay.addEventListener(
      "click",
      event => {

        if (
          event.target === overlay
        ) {

          closeGuide();

        }

      }
    );


    document.body.appendChild(
      overlay
    );

  }


  function renderStep() {

    const step =
      steps[currentStep];


    stepNumber.textContent =
      step.number;


    eyebrow.textContent =
      step.eyebrow;


    title.textContent =
      step.title;


    description.textContent =
      step.description;


    pointList.replaceChildren();


    for (
      const point
      of step.points
    ) {

      const item =
        document.createElement(
          "li"
        );


      item.textContent =
        point;


      pointList.appendChild(
        item
      );

    }


    tip.textContent =
      `提示：${step.tip}`;


    progress.replaceChildren();


    for (
      let index = 0;
      index < steps.length;
      index += 1
    ) {

      const dot =
        document.createElement(
          "span"
        );


      dot.className =
        "review-guide-progress-dot";


      if (
        index === currentStep
      ) {

        dot.classList.add(
          "is-active"
        );

      }


      if (
        index < currentStep
      ) {

        dot.classList.add(
          "is-complete"
        );

      }


      progress.appendChild(
        dot
      );

    }


    const progressText =
      document.createElement(
        "span"
      );


    progressText.className =
      "review-guide-progress-text";


    progressText.textContent =
      `${currentStep + 1} / ${steps.length}`;


    progress.appendChild(
      progressText
    );


    prevButton.disabled =
      currentStep === 0;


    nextButton.textContent =
      currentStep ===
      steps.length - 1
        ? "开始使用"
        : "下一步";

  }


  function openGuide() {

    createGuide();


    currentStep =
      0;


    renderStep();


    overlay.hidden =
      false;


    document.body.classList.add(
      "review-guide-open"
    );


    setSeen();


    window.setTimeout(
      () => {

        nextButton?.focus();

      },
      0
    );

  }


  function closeGuide() {

    if (!overlay) {
      return;
    }


    overlay.hidden =
      true;


    document.body.classList.remove(
      "review-guide-open"
    );


    setSeen();

  }


  function bindTrigger() {

    const button =
      document.getElementById(
        "reviewGuideButton"
      );


    if (!button) {

      return;

    }


    button.addEventListener(
      "click",
      openGuide
    );

  }


  document.addEventListener(
    "keydown",
    event => {

      if (
        !overlay
        ||
        overlay.hidden
      ) {
        return;
      }


      if (
        event.key ===
        "Escape"
      ) {

        closeGuide();

        return;

      }


      if (
        event.key ===
        "ArrowLeft"
        &&
        currentStep > 0
      ) {

        currentStep -= 1;

        renderStep();

        return;

      }


      if (
        event.key ===
        "ArrowRight"
        &&
        currentStep <
        steps.length - 1
      ) {

        currentStep += 1;

        renderStep();

      }

    }
  );


  bindTrigger();


  /*
   * First-time onboarding:
   * automatically show once in this browser.
   *
   * Afterwards the user can always reopen it
   * through the persistent "使用说明" button.
   */
  if (
    !hasSeen()
  ) {

    window.setTimeout(
      openGuide,
      450
    );

  }


  window.ContractReviewGuide = {
    open:
      openGuide,

    close:
      closeGuide
  };

})();

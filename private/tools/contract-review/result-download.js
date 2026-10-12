(() => {
  "use strict";

  const nativeFetch =
    window.fetch.bind(window);

  const BUTTON_ID =
    "contract-result-download";


  function findHost() {

    return (
      document.querySelector(
        "#statusPanel"
      ) ||

      document.querySelector(
        ".status-panel"
      ) ||

      document.querySelector(
        "[data-status-panel]"
      ) ||

      document.querySelector(
        "main"
      ) ||

      document.body
    );

  }


  function getButton() {

    let button =
      document.getElementById(
        BUTTON_ID
      );


    if (button) {
      return button;
    }


    button =
      document.createElement(
        "a"
      );


    button.id =
      BUTTON_ID;


    button.textContent =
      "下载 Markdown";


    button.style.display =
      "none";

    button.style.alignItems =
      "center";

    button.style.justifyContent =
      "center";

    button.style.width =
      "fit-content";

    button.style.marginTop =
      "16px";

    button.style.padding =
      "10px 18px";

    button.style.borderRadius =
      "10px";

    button.style.textDecoration =
      "none";

    button.style.fontWeight =
      "600";

    button.style.background =
      "var(--accent, #2563eb)";

    button.style.color =
      "#ffffff";


    findHost().appendChild(
      button
    );


    return button;

  }


  function hideButton() {

    const button =
      document.getElementById(
        BUTTON_ID
      );


    if (button) {

      button.style.display =
        "none";

    }

  }


  function showButton(
    contractId
  ) {

    const button =
      getButton();


    button.href =
      `/api/contracts/${
        encodeURIComponent(
          contractId
        )
      }/result.md`;


    button.style.display =
      "inline-flex";

  }


  window.fetch =
    async function (...args) {

      const response =
        await nativeFetch(
          ...args
        );


      try {

        const input =
          args[0];


        const url =
          typeof input ===
            "string"
            ? input
            : input?.url || "";


        const match =
          url.match(
            /\/api\/contracts\/([0-9a-f-]{36})\/status(?:[?#].*)?$/i
          );


        if (match) {

          const copy =
            response.clone();


          copy
            .json()
            .then(
              payload => {

                if (
                  payload?.ok &&
                  payload.status ===
                    "completed"
                ) {

                  showButton(
                    payload.id ||
                    match[1]
                  );

                } else {

                  hideButton();

                }

              }
            )
            .catch(
              () => {}
            );

        }

      } catch (error) {

        console.warn(
          "[contract-result-download]",
          error
        );

      }


      return response;

    };

})();

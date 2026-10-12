"use strict";

const fs = require("fs");
const path = require("path");
const {
  spawn
} = require("child_process");


function startContractWorker({
  root,
  contractId = null
}) {

  const pythonBin =
    path.join(
      root,
      ".mineru",
      "bin",
      "python"
    );


  if (
    !fs.existsSync(
      pythonBin
    )
  ) {

    throw new Error(
      `MinerU Python not found: ${pythonBin}`
    );

  }


  const logDir =
    path.join(
      root,
      "logs"
    );


  fs.mkdirSync(
    logDir,
    {
      recursive: true
    }
  );


  const logPath =
    path.join(
      logDir,
      "contract-worker.log"
    );


  const logFd =
    fs.openSync(
      logPath,
      "a"
    );


  const args = [
    "-m",
    "services.contract_review.worker"
  ];


  if (contractId) {

    args.push(
      "--contract-id",
      String(
        contractId
      )
    );

  }


  const child =
    spawn(
      pythonBin,
      args,
      {
        cwd: root,

        detached: true,

        env: {
          ...process.env,

          MINERU_MODEL_SOURCE:
            "local",

          MINERU_MODEL_SMALL_BACKEND:
            "torch",

          MINERU_MODEL_VLM_ENGINE:
            "llama-cpp"
        },

        stdio: [
          "ignore",
          logFd,
          logFd
        ]
      }
    );


  child.on(
    "error",
    error => {

      console.error(
        "[contract-worker spawn]",
        error
      );

    }
  );


  child.unref();


  fs.closeSync(
    logFd
  );


  console.log(
    "[contract-worker]",
    "spawned",
    child.pid,
    contractId || "queue"
  );


  return child.pid;
}


module.exports = {
  startContractWorker
};

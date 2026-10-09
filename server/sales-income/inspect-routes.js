"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const { spawn } = require("child_process");


function resolvePython(projectRoot) {
  const localPython = path.join(
    projectRoot,
    ".venv",
    "bin",
    "python"
  );

  if (fs.existsSync(localPython)) {
    return localPython;
  }

  return "python3";
}


function runInspector({
  python,
  script,
  inputFile,
  cwd
}) {
  return new Promise((resolve, reject) => {

    const child = spawn(
      python,
      [
        script,
        inputFile
      ],
      {
        cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1"
        }
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on(
      "data",
      chunk => {
        stdout += chunk.toString("utf8");
      }
    );

    child.stderr.on(
      "data",
      chunk => {
        stderr += chunk.toString("utf8");
      }
    );

    child.on(
      "error",
      reject
    );

    child.on(
      "close",
      code => {
        resolve({
          code,
          stdout,
          stderr
        });
      }
    );

  });
}


function createSalesIncomeInspectRouter(options = {}) {

  const router = express.Router();

  const projectRoot =
    options.projectRoot ||
    path.resolve(
      __dirname,
      "..",
      ".."
    );


  const jobsRoot = path.join(
    projectRoot,
    "storage",
    "excel",
    "sales-income",
    "jobs"
  );


  const inspectScript = path.join(
    projectRoot,
    "workers",
    "excel",
    "sales_income",
    "inspect_excel.py"
  );


  fs.mkdirSync(
    jobsRoot,
    {
      recursive: true
    }
  );


  const storage = multer.diskStorage({

    destination(req, file, callback) {

      try {

        const jobId =
          req.salesIncomeJobId;

        const inputDir = path.join(
          jobsRoot,
          jobId,
          "input"
        );

        fs.mkdirSync(
          inputDir,
          {
            recursive: true
          }
        );

        callback(
          null,
          inputDir
        );

      } catch (error) {

        callback(error);

      }

    },


    filename(req, file, callback) {

      callback(
        null,
        "input.xlsx"
      );

    }

  });


  const upload = multer({

    storage,

    limits: {
      files: 1,
      fileSize:
        25 * 1024 * 1024
    },

    fileFilter(req, file, callback) {

      const extension =
        path
          .extname(
            file.originalname || ""
          )
          .toLowerCase();


      if (extension !== ".xlsx") {

        callback(
          new Error(
            "仅支持 .xlsx Excel 文件"
          )
        );

        return;

      }


      callback(
        null,
        true
      );

    }

  });


  function prepareJob(
    req,
    res,
    next
  ) {

    req.salesIncomeJobId =
      crypto.randomUUID();

    next();

  }


  function receiveUpload(
    req,
    res,
    next
  ) {

    upload.single("file")(
      req,
      res,
      error => {

        if (!error) {

          next();
          return;

        }


        res
          .status(400)
          .json({
            ok: false,
            error:
              error.message ||
              "文件上传失败"
          });

      }
    );

  }


  router.post(
    "/inspect",

    prepareJob,

    receiveUpload,

    async (req, res) => {

      const jobId =
        req.salesIncomeJobId;


      try {

        if (!req.file) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "没有收到 Excel 文件"
            });

        }


        const analysisType =
          String(
            req.body.analysisType ||
            "sales"
          )
            .trim()
            .toLowerCase();


        if (
          analysisType !== "sales" &&
          analysisType !== "income"
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "分析类型无效"
            });

        }


        if (
          !fs.existsSync(
            inspectScript
          )
        ) {

          return res
            .status(500)
            .json({
              ok: false,
              error:
                "inspect_excel.py 不存在"
            });

        }


        const python =
          resolvePython(
            projectRoot
          );


        const result =
          await runInspector({
            python,
            script:
              inspectScript,
            inputFile:
              req.file.path,
            cwd:
              projectRoot
          });


        if (result.code !== 0) {

          console.error(
            "[sales-income inspect]",
            result.stderr ||
            result.stdout
          );


          return res
            .status(500)
            .json({
              ok: false,
              error:
                (
                  result.stderr ||
                  result.stdout ||
                  "Excel 表头读取失败"
                )
                  .trim()
                  .slice(0, 4000)
            });

        }


        let inspection;

        try {

          inspection =
            JSON.parse(
              result.stdout
            );

        } catch (error) {

          console.error(
            "[sales-income inspect] invalid JSON",
            result.stdout
          );


          return res
            .status(500)
            .json({
              ok: false,
              error:
                "Python 返回的表头数据无法解析"
            });

        }


        const jobDir = path.join(
          jobsRoot,
          jobId
        );


        const metadata = {

          jobId,

          status:
            "inspected",

          analysisType,

          originalName:
            req.file.originalname,

          inputFile:
            "input.xlsx",

          createdAt:
            new Date()
              .toISOString()

        };


        await fsp.writeFile(
          path.join(
            jobDir,
            "job.json"
          ),

          JSON.stringify(
            metadata,
            null,
            2
          ),

          "utf8"
        );


        return res.json({

          ok: true,

          jobId,

          analysisType,

          originalName:
            req.file.originalname,

          sheets:
            inspection.sheets || []

        });


      } catch (error) {

        console.error(
          "[sales-income inspect]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              error.message ||
              "读取 Excel 失败"
          });

      }

    }
  );


  return router;
}


module.exports = {
  createSalesIncomeInspectRouter
};

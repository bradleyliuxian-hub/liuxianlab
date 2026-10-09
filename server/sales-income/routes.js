"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const { spawn } = require("child_process");


/* =========================================================
   Helpers
========================================================= */

function resolvePython(projectRoot) {
  if (process.env.SALES_INCOME_PYTHON) {
    return process.env.SALES_INCOME_PYTHON;
  }

  const candidates = [
    path.join(
      projectRoot,
      ".venv",
      "bin",
      "python"
    ),

    path.join(
      projectRoot,
      ".venv",
      "Scripts",
      "python.exe"
    )
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "python3";
}


function validJobId(jobId) {
  return /^[0-9a-f-]{36}$/i.test(
    String(jobId || "")
  );
}


async function newestXlsx(directory) {
  const entries = await fsp.readdir(
    directory,
    {
      withFileTypes: true
    }
  );

  const files = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".xlsx")
  );

  if (!files.length) {
    return null;
  }

  const candidates = await Promise.all(
    files.map(
      async (entry) => {
        const fullPath = path.join(
          directory,
          entry.name
        );

        const stat = await fsp.stat(
          fullPath
        );

        return {
          name: entry.name,
          fullPath,
          mtimeMs: stat.mtimeMs
        };
      }
    )
  );

  candidates.sort(
    (a, b) =>
      b.mtimeMs - a.mtimeMs
  );

  return candidates[0];
}


function runPython({
  python,
  script,
  analysisType,
  inputFile,
  outputDir,
  cwd
}) {
  return new Promise(
    (resolve, reject) => {

      const child = spawn(
        python,
        [
          script,
          analysisType,
          inputFile,
          outputDir
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
        (chunk) => {

          stdout += chunk.toString(
            "utf8"
          );

          if (stdout.length > 65536) {
            stdout = stdout.slice(
              -65536
            );
          }

        }
      );


      child.stderr.on(
        "data",
        (chunk) => {

          stderr += chunk.toString(
            "utf8"
          );

          if (stderr.length > 65536) {
            stderr = stderr.slice(
              -65536
            );
          }

        }
      );


      child.on(
        "error",
        reject
      );


      child.on(
        "close",
        (code) => {

          resolve({
            code,
            stdout,
            stderr
          });

        }
      );

    }
  );
}


/* =========================================================
   Router factory
========================================================= */

function createSalesIncomeRouter(options = {}) {
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


  const pythonScript = path.join(
    projectRoot,
    "workers",
    "excel",
    "sales_income",
    "main.py"
  );


  fs.mkdirSync(
    jobsRoot,
    {
      recursive: true
    }
  );


  /* =======================================================
     Upload configuration
  ======================================================= */

  const storage = multer.diskStorage({

    destination(
      req,
      file,
      callback
    ) {
      try {

        const jobDir = path.join(
          jobsRoot,
          req.salesIncomeJobId
        );


        const inputDir = path.join(
          jobDir,
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

        callback(
          error
        );

      }
    },


    filename(
      req,
      file,
      callback
    ) {

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

    fileFilter(
      req,
      file,
      callback
    ) {

      const extension =
        path
          .extname(
            file.originalname || ""
          )
          .toLowerCase();


      if (extension !== ".xlsx") {

        return callback(
          new Error(
            "仅支持 .xlsx Excel 文件"
          )
        );

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

    upload.single(
      "file"
    )(
      req,
      res,
      (error) => {

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
              "Excel 上传失败"
          });

      }
    );

  }


  /* =======================================================
     POST /jobs

     Create analysis job
  ======================================================= */

  router.post(
    "/jobs",

    prepareJob,

    receiveUpload,

    async (
      req,
      res
    ) => {

      const jobId =
        req.salesIncomeJobId;


      try {

        const analysisType =
          String(
            req.body.analysisType ||
            ""
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
                "analysisType 必须为 sales 或 income"
            });

        }


        if (!req.file) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "没有收到 Excel 文件"
            });

        }


        if (
          !fs.existsSync(
            pythonScript
          )
        ) {

          return res
            .status(500)
            .json({
              ok: false,
              error:
                "Python 分析模块不存在"
            });

        }


        const jobDir = path.join(
          jobsRoot,
          jobId
        );


        const outputDir = path.join(
          jobDir,
          "output"
        );


        await fsp.mkdir(
          outputDir,
          {
            recursive: true
          }
        );


        const inputFile =
          req.file.path;


        const python =
          resolvePython(
            projectRoot
          );


        const startedAt =
          new Date().toISOString();


        console.log(
          "[sales-income]",
          "job started:",
          jobId,
          analysisType
        );


        const result =
          await runPython({
            python,
            script:
              pythonScript,
            analysisType,
            inputFile,
            outputDir,
            cwd:
              projectRoot
          });


        if (result.code !== 0) {

          console.error(
            "[sales-income]",
            "python failed:",
            jobId,
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
                  "Python 分析失败"
                )
                  .trim()
                  .slice(
                    0,
                    4000
                  )
            });

        }


        const output =
          await newestXlsx(
            outputDir
          );


        if (!output) {

          return res
            .status(500)
            .json({
              ok: false,
              error:
                "Python 已执行，但没有找到输出 Excel"
            });

        }


        const metadata = {

          jobId,

          analysisType,

          originalName:
            req.file.originalname,

          inputFile:
            path.basename(
              inputFile
            ),

          outputFile:
            output.name,

          createdAt:
            startedAt,

          completedAt:
            new Date()
              .toISOString(),

          pythonOutput:
            result.stdout
              .trim()
              .slice(
                -4000
              )

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


        console.log(
          "[sales-income]",
          "job completed:",
          jobId,
          output.name
        );


        return res.json({

          ok: true,

          jobId,

          analysisType,

          originalName:
            req.file.originalname,

          outputFile:
            output.name,

          downloadUrl:
            `/api/sales-income/jobs/${jobId}/download`

        });


      } catch (error) {

        console.error(
          "[sales-income]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              error.message ||
              "分析任务执行失败"
          });

      }

    }
  );


  /* =======================================================
     GET /jobs/:jobId/download

     Download generated Excel
  ======================================================= */

  router.get(
    "/jobs/:jobId/download",

    async (
      req,
      res
    ) => {

      try {

        const jobId =
          req.params.jobId;


        if (
          !validJobId(
            jobId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的任务编号"
            });

        }


        const jobDir = path.join(
          jobsRoot,
          jobId
        );


        const metadataPath =
          path.join(
            jobDir,
            "job.json"
          );


        if (
          !fs.existsSync(
            metadataPath
          )
        ) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "分析任务不存在"
            });

        }


        const metadata =
          JSON.parse(
            await fsp.readFile(
              metadataPath,
              "utf8"
            )
          );


        const outputFile =
          path.join(
            jobDir,
            "output",
            metadata.outputFile
          );


        if (
          !fs.existsSync(
            outputFile
          )
        ) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "结果文件不存在"
            });

        }


        return res.download(
          outputFile,
          metadata.outputFile
        );


      } catch (error) {

        console.error(
          "[sales-income]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "下载结果失败"
          });

      }

    }
  );


  return router;
}


module.exports = {
  createSalesIncomeRouter
};

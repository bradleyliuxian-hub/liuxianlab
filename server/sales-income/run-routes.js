"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { spawn } = require("child_process");


function validJobId(value) {
  return /^[0-9a-f-]{36}$/i.test(
    String(value || "")
  );
}


function resolvePython(projectRoot) {
  if (process.env.SALES_INCOME_PYTHON) {
    return process.env.SALES_INCOME_PYTHON;
  }

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


function runPython({
  python,
  script,
  analysisType,
  inputFile,
  outputDir,
  configFile,
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
          outputDir,
          configFile
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
      let finished = false;

      const timeout = setTimeout(
        () => {

          if (finished) {
            return;
          }

          child.kill("SIGTERM");

        },
        5 * 60 * 1000
      );


      child.stdout.on(
        "data",
        chunk => {

          stdout +=
            chunk.toString(
              "utf8"
            );

          if (
            stdout.length >
            65536
          ) {

            stdout =
              stdout.slice(
                -65536
              );

          }

        }
      );


      child.stderr.on(
        "data",
        chunk => {

          stderr +=
            chunk.toString(
              "utf8"
            );

          if (
            stderr.length >
            65536
          ) {

            stderr =
              stderr.slice(
                -65536
              );

          }

        }
      );


      child.on(
        "error",
        error => {

          clearTimeout(
            timeout
          );

          reject(
            error
          );

        }
      );


      child.on(
        "close",
        code => {

          finished = true;

          clearTimeout(
            timeout
          );

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


async function newestXlsx(directory) {
  const entries =
    await fsp.readdir(
      directory,
      {
        withFileTypes: true
      }
    );

  const candidates =
    [];

  for (const entry of entries) {

    if (
      !entry.isFile() ||
      !entry.name
        .toLowerCase()
        .endsWith(".xlsx")
    ) {
      continue;
    }

    const fullPath =
      path.join(
        directory,
        entry.name
      );

    const stat =
      await fsp.stat(
        fullPath
      );

    candidates.push({
      name: entry.name,
      fullPath,
      mtimeMs:
        stat.mtimeMs
    });

  }

  candidates.sort(
    (a, b) =>
      b.mtimeMs -
      a.mtimeMs
  );

  return (
    candidates[0] ||
    null
  );
}


function createSalesIncomeRunRouter(
  options = {}
) {
  const router =
    express.Router();

  const projectRoot =
    options.projectRoot ||
    path.resolve(
      __dirname,
      "..",
      ".."
    );


  const jobsRoot =
    path.join(
      projectRoot,
      "storage",
      "excel",
      "sales-income",
      "jobs"
    );


  const pythonScript =
    path.join(
      projectRoot,
      "workers",
      "excel",
      "sales_income",
      "main.py"
    );


  router.post(
    "/jobs/:jobId/run",

    async (req, res) => {

      const jobId =
        req.params.jobId;


      try {

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
                "无效任务编号"
            });

        }


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


        const sheetName =
          String(
            req.body.sheetName ||
            ""
          );


        const headerRow =
          Number(
            req.body.headerRow
          );


        const mapping =
          req.body.mapping;


        if (!sheetName) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "没有选择工作表"
            });

        }


        if (
          !Number.isInteger(
            headerRow
          ) ||
          headerRow < 1 ||
          headerRow > 1000
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "表头行无效"
            });

        }


        if (
          !mapping ||
          typeof mapping !==
          "object" ||
          Array.isArray(mapping)
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "字段 mapping 无效"
            });

        }


        const required =
          analysisType === "sales"
            ? [
                "document",
                "reference",
                "amount",
                "text",
                "partner"
              ]
            : [
                "document",
                "amount",
                "text",
                "partner"
              ];


        for (
          const key
          of required
        ) {

          if (
            !String(
              mapping[key] || ""
            ).trim()
          ) {

            return res
              .status(400)
              .json({
                ok: false,
                error:
                  `缺少字段: ${key}`
              });

          }

        }


        const jobDir =
          path.join(
            jobsRoot,
            jobId
          );


        const metadataPath =
          path.join(
            jobDir,
            "job.json"
          );


        const inputFile =
          path.join(
            jobDir,
            "input",
            "input.xlsx"
          );


        if (
          !fs.existsSync(
            metadataPath
          ) ||
          !fs.existsSync(
            inputFile
          )
        ) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "上传任务不存在或已经失效"
            });

        }


        let metadata =
          JSON.parse(
            await fsp.readFile(
              metadataPath,
              "utf8"
            )
          );


        const outputDir =
          path.join(
            jobDir,
            "output"
          );


        await fsp.rm(
          outputDir,
          {
            recursive: true,
            force: true
          }
        );


        await fsp.mkdir(
          outputDir,
          {
            recursive: true
          }
        );


        const config = {
          analysisType,
          sheetName,
          headerRow,
          mapping
        };


        const configFile =
          path.join(
            jobDir,
            "config.json"
          );


        await fsp.writeFile(
          configFile,
          JSON.stringify(
            config,
            null,
            2
          ),
          "utf8"
        );


        metadata = {
          ...metadata,

          status:
            "running",

          analysisType,

          sheetName,

          headerRow,

          mapping,

          startedAt:
            new Date()
              .toISOString()
        };


        await fsp.writeFile(
          metadataPath,
          JSON.stringify(
            metadata,
            null,
            2
          ),
          "utf8"
        );


        const python =
          resolvePython(
            projectRoot
          );


        console.log(
          "[sales-income]",
          "running job:",
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
            configFile,
            cwd:
              projectRoot
          });


        if (
          result.code !== 0
        ) {

          metadata.status =
            "failed";

          metadata.failedAt =
            new Date()
              .toISOString();

          metadata.error =
            (
              result.stderr ||
              result.stdout ||
              "Python 分析失败"
            )
              .trim()
              .slice(
                0,
                4000
              );


          await fsp.writeFile(
            metadataPath,
            JSON.stringify(
              metadata,
              null,
              2
            ),
            "utf8"
          );


          console.error(
            "[sales-income]",
            metadata.error
          );


          return res
            .status(500)
            .json({
              ok: false,
              error:
                metadata.error
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
                "分析完成，但未找到输出 Excel"
            });

        }


        metadata.status =
          "completed";

        metadata.completedAt =
          new Date()
            .toISOString();

        metadata.outputFile =
          output.name;

        metadata.pythonOutput =
          result.stdout
            .trim()
            .slice(
              -4000
            );


        await fsp.writeFile(
          metadataPath,
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

          status:
            "completed",

          outputFile:
            output.name,

          downloadUrl:
            `/api/sales-income/jobs/${jobId}/download`
        });


      } catch (error) {

        console.error(
          "[sales-income run]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              error.message ||
              "运行分析失败"
          });

      }

    }
  );


  return router;
}


module.exports = {
  createSalesIncomeRunRouter
};

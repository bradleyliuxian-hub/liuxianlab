"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");

const { startContractWorker } = require("./parse-runner");

const { readPdfPageCount } = require("./pdf-meta");

const {
  normalizeParseMode,
  validateUploadOptions
} = require("./contract-options");

const tokenCrypto =
  require("./token-crypto");

const {
  createContract,
  deleteContractById,
  deleteContractCredential,
  getContractById,
  getContractForOwner,
  getLatestContractForOwner,
  saveContractCredential,
  updateContractState
} = require("./repository");

const contractRepository = require("./repository");

const {
  getReviewPaths,
  readDraft,
  writeDraft,
  readIssues,
  resolveIssue,
  finalizeDraft
} = require("./review-store");



const MAX_FILE_SIZE =
  25 * 1024 * 1024;

const DEFAULT_CREDENTIAL_TTL_HOURS =
  24;


function validContractId(value) {

  return /^[0-9a-f-]{36}$/i.test(
    String(value || "")
  );

}


function normalizeOriginalFilename(value) {

  const raw =
    String(
      value || ""
    )
      .replace(
        /[\0\r\n]/g,
        ""
      )
      .trim();


  if (!raw) {
    return "contract.pdf";
  }


  /*
   * Some multipart parsers may expose an UTF-8
   * filename through latin1.
   */
  if (
    /[\u0080-\u00ff]/.test(
      raw
    )
  ) {

    try {

      const decoded =
        Buffer
          .from(
            raw,
            "latin1"
          )
          .toString(
            "utf8"
          );


      if (
        decoded &&
        !decoded.includes(
          "\uFFFD"
        )
      ) {

        return decoded;

      }

    } catch (_) {
      // Keep raw value.
    }

  }


  return raw;
}


function createContractRouter(
  options = {}
) {

  const router =
    express.Router();


  const root =
    options.root ||
    path.resolve(
      __dirname,
      "..",
      ".."
    );


  const storageRoot =
    path.join(
      root,
      "storage",
      "contracts"
    );


  fs.mkdirSync(
    storageRoot,
    {
      recursive: true
    }
  );


  /*
   * [contract-worker] recovery timer
   *
   * Also checks for abandoned queued jobs.
   * PostgreSQL advisory locking ensures that
   * only one MinerU worker actually parses.
   */
  const recoveryTimer =
    setInterval(
      () => {

        try {

          startContractWorker({
            root
          });

        } catch (error) {

          console.error(
            "[contract-worker recovery]",
            error
          );

        }

      },
      60 * 1000
    );


  recoveryTimer.unref();


  const startupRecovery =
    setTimeout(
      () => {

        try {

          startContractWorker({
            root
          });

        } catch (error) {

          console.error(
            "[contract-worker startup]",
            error
          );

        }

      },
      1500
    );


  startupRecovery.unref();


  function contractDir(
    contractId
  ) {

    return path.join(
      storageRoot,
      contractId
    );

  }


  function legacyMetadataPath(
    contractId
  ) {

    return path.join(
      contractDir(
        contractId
      ),
      "job.json"
    );

  }


  function sourcePath(
    contractId
  ) {

    return path.join(
      contractDir(
        contractId
      ),
      "source.pdf"
    );

  }


  /*
   * Store a relative path in PostgreSQL.
   *
   * This makes the database portable between
   * the Mac and the Ubuntu server.
   */
  function relativeSourcePath(
    contractId
  ) {

    return path
      .relative(
        root,
        sourcePath(
          contractId
        )
      )
      .split(
        path.sep
      )
      .join("/");

  }


  function serverMineruToken() {

    return String(
      process.env.MINERU_API_TOKEN
      || ""
    ).trim();

  }


  function credentialTtlMs() {

    const hours =
      Number(
        process.env.CONTRACT_CREDENTIAL_TTL_HOURS
        || DEFAULT_CREDENTIAL_TTL_HOURS
      );


    const safeHours =
      Number.isFinite(hours)
        ? Math.max(
            1,
            Math.min(
              168,
              Math.floor(hours)
            )
          )
        : DEFAULT_CREDENTIAL_TTL_HOURS;


    return safeHours * 60 * 60 * 1000;

  }


  function cloudConfigPayload() {

    return {
      serverTokenConfigured:
        Boolean(serverMineruToken()),

      encryptionKeyConfigured:
        tokenCrypto.isConfigured()
    };

  }


  async function removeContractDir(
    contractId
  ) {

    await fsp.rm(
      contractDir(
        contractId
      ),
      {
        recursive: true,
        force: true
      }
    );

  }


  function ownerUsername(req) {

    return String(
      req.session
        ?.auth
        ?.username ||
      ""
    );

  }


  async function readLegacyJob(
    contractId
  ) {

    const file =
      legacyMetadataPath(
        contractId
      );


    if (
      !fs.existsSync(
        file
      )
    ) {

      return null;

    }


    return JSON.parse(
      await fsp.readFile(
        file,
        "utf8"
      )
    );

  }


  async function writeLegacyJob(
    job
  ) {

    await fsp.writeFile(
      legacyMetadataPath(
        job.id
      ),

      JSON.stringify(
        job,
        null,
        2
      ),

      "utf8"
    );

  }


  function prepareContract(
    req,
    res,
    next
  ) {

    req.contractId =
      crypto.randomUUID();

    next();

  }


  const storage =
    multer.diskStorage({

      destination(
        req,
        file,
        callback
      ) {

        try {

          const directory =
            contractDir(
              req.contractId
            );


          fs.mkdirSync(
            directory,
            {
              recursive: true
            }
          );


          callback(
            null,
            directory
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
          "source.pdf"
        );

      }

    });


  const upload =
    multer({

      storage,

      limits: {

        files: 1,

        fileSize:
          MAX_FILE_SIZE

      },


      fileFilter(
        req,
        file,
        callback
      ) {

        const extension =
          path
            .extname(
              file.originalname ||
              ""
            )
            .toLowerCase();


        const acceptableMime =
          file.mimetype ===
            "application/pdf" ||
          file.mimetype ===
            "application/octet-stream";


        if (
          extension !== ".pdf" ||
          !acceptableMime
        ) {

          callback(
            new Error(
              "仅支持 PDF 文件"
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


  function receivePdf(
    req,
    res,
    next
  ) {

    upload.single(
      "file"
    )(
      req,
      res,
      error => {

        if (!error) {

          next();
          return;

        }


        if (
          error.code ===
          "LIMIT_FILE_SIZE"
        ) {

          return res
            .status(413)
            .json({

              ok: false,

              error:
                "PDF 不能超过 25 MB"

            });

        }


        return res
          .status(400)
          .json({

            ok: false,

            error:
              error.message ||
              "PDF 上传失败"

          });

      }
    );

  }


  /*
   * POST /api/contracts
   *
   * PDF:
   *     private filesystem
   *
   * Metadata:
   *     PostgreSQL
   *
   * job.json:
   *     temporary compatibility copy
   */
  router.post(
    "/",

    prepareContract,

    receivePdf,

    async (req, res) => {

      const contractId =
        req.contractId;

      let created =
        null;


      try {

        if (!req.file) {

          return res
            .status(400)
            .json({

              ok: false,

              error:
                "没有收到 PDF 文件"

            });

        }


        const owner =
          ownerUsername(req);


        if (!owner) {

          throw new Error(
            "Authenticated username is missing"
          );

        }


        /*
         * Parse backend is per-contract. parseMode stays
         * independent (auto / fast / accurate).
         *
         * Cloud requests require explicit consent and a token
         * source: either this request's token (encrypted) or the
         * server MINERU_API_TOKEN.
         */
        const options =
          validateUploadOptions({

            parseMode:
              req.body?.parseMode,

            parserBackend:
              req.body?.parserBackend,

            cloudProcessingConsent:
              req.body?.cloudProcessingConsent,

            userToken:
              req.body?.mineruApiToken,

            serverTokenConfigured:
              Boolean(serverMineruToken()),

            encryptionConfigured:
              tokenCrypto.isConfigured()

          });


        if (!options.ok) {

          await removeContractDir(
            contractId
          );


          return res
            .status(400)
            .json({

              ok: false,

              error:
                options.error

            });

        }


        const parseMode =
          options.mode;

        const parserBackend =
          options.backend;

        let userToken =
          options.storeToken
            ? options.token
            : "";


        const originalName =
          normalizeOriginalFilename(
            req.file.originalname
          );


        const now =
          new Date()
            .toISOString();


        /*
         * Best-effort input page count (never fails the upload).
         */
        const pageCount =
          await readPdfPageCount(
            sourcePath(
              contractId
            )
          );


        const job = {

          id:
            contractId,

          ownerUsername:
            owner,

          originalName,

          storedName:
            "source.pdf",

          filePath:
            relativeSourcePath(
              contractId
            ),

          size:
            req.file.size,

          mimeType:
            req.file.mimetype,

          status:
            "queued",

          stage:
            "queued",

          progress:
            0,

          language:
            null,

          pageCount,

          parseModeRequested:
            parseMode,

          parseBackendRequested:
            parserBackend,

          sourceSha256:
            null,

          createdAt:
            now,

          updatedAt:
            now,

          error:
            null

        };


        /*
         * PostgreSQL is now the source of truth.
         */
        created =
          await createContract(
            job
          );


        /*
         * A user-supplied cloud token is encrypted before any
         * worker starts. It is never written to job.json,
         * metrics, logs, or the API response.
         */
        if (
          parserBackend === "cloud"
          && options.storeToken
        ) {

          try {

            const encrypted =
              tokenCrypto.encryptToken(
                userToken,
                {
                  contractId,
                  ownerUsername: owner
                }
              );


            await saveContractCredential({
              contractId,
              ownerUsername: owner,
              ciphertext:
                encrypted.ciphertext,
              iv:
                encrypted.iv,
              authTag:
                encrypted.authTag,
              keyVersion:
                encrypted.keyVersion,
              expiresAt:
                new Date(
                  Date.now()
                  + credentialTtlMs()
                )
            });

          } catch (credentialError) {

            console.error(
              "[contract-review credential]",
              credentialError.code
              || "SAVE_FAILED"
            );


            await deleteContractById(
              contractId
            );

            created = null;

            await removeContractDir(
              contractId
            );


            return res
              .status(500)
              .json({

                ok: false,

                error:
                  "无法安全保存云端解析凭证，未创建任务"

              });

          } finally {

            userToken = "";

          }

        }


        /*
         * Keep job.json temporarily during migration.
         */
        await writeLegacyJob(
          {
            ...job,

            createdAt:
              created.createdAt,

            updatedAt:
              created.updatedAt
          }
        );


        console.log(
          "[contract-review]",
          "contract queued:",
          contractId,
          originalName
        );


        /*
         * [contract-worker] auto-start after upload
         *
         * Uploading the PDF now immediately starts
         * the background MinerU parser.
         */
        try {

          startContractWorker({
            root,
            contractId
          });

        } catch (workerError) {

          console.error(
            "[contract-review worker start]",
            workerError
          );

        }


        return res
          .status(201)
          .json({

            ok: true,

            id:
              created.id,

            status:
              created.status,

            stage:
              created.stage,

            progress:
              created.progress,

            requestedMode:
              created.parseModeRequested
              ?? parseMode,

            requestedBackend:
              created.parseBackendRequested
              ?? parserBackend

          });


      } catch (error) {

        console.error(
          "[contract-review upload]",
          error
        );


        /*
         * Do not leave an orphaned row/PDF when a later
         * upload step fails. The worker has not started yet.
         */
        if (created) {

          try {

            await deleteContractById(
              contractId
            );

          } catch (deleteError) {

            console.error(
              "[contract-review upload cleanup]",
              deleteError
            );

          }

        }


        await removeContractDir(
          contractId
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "无法创建合同审阅任务"

          });

      }

    }
  );


  /*
   * GET /api/contracts/:id/result.md
   *
   * Download the generated Markdown result.
   * Authentication is handled by the parent router.
   * Ownership is checked again here.
   */
  router.get(
    "/:id/result.md",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({

              ok: false,

              error:
                "无效的合同任务编号"

            });

        }


        const owner =
          ownerUsername(req);


        const job =
          await getContractForOwner(
            contractId,
            owner
          );


        if (!job) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "合同任务不存在"

            });

        }


        if (
          job.status !==
          "completed"
        ) {

          return res
            .status(409)
            .json({

              ok: false,

              error:
                "合同尚未解析完成"

            });

        }


        const resultPath =
          getReviewPaths(
            root,
            contractId
          ).finalMarkdownPath;


        try {

          await fsp.access(
            resultPath,
            fs.constants.R_OK
          );

        } catch (_) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "Markdown 结果不存在"

            });

        }


        const originalBase =
          path
            .basename(
              String(
                job.originalName ||
                "contract.pdf"
              )
            )
            .replace(
              /\.pdf$/i,
              ""
            )
            .replace(
              /[\/\\\0\r\n]/g,
              "_"
            )
            .trim();


        const downloadName =
          `${
            originalBase ||
            "contract"
          }.md`;


        return res.download(
          resultPath,
          downloadName
        );


      } catch (error) {

        console.error(
          "[contract-review result]",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "无法下载 Markdown 结果"

          });

      }

    }
  );


  /*
   * GET /api/contracts/cloud-config
   *
   * Safe booleans only. Never returns the server token,
   * encryption key, or MinerU base URL.
   */
  router.get(
    "/cloud-config",

    async (req, res) => {

      return res.json({
        ok: true,
        ...cloudConfigPayload()
      });

    }
  );


  /*
   * GET /api/contracts/history
   *
   * List every contract belonging to the
   * currently authenticated user.
   *
   * Each contract keeps its own independent
   * UUID and processing state.
   */
  router.get(
    "/history",

    async (req, res) => {

      try {

        const owner =
          ownerUsername(req);


        const contracts =
          await contractRepository
            .listContractsForOwner(
              owner
            );


        return res.json({

          ok: true,

          contracts:
            contracts.map(
              job => ({

                id:
                  job.id,

                originalName:
                  job.originalName,

                status:
                  job.status,

                stage:
                  job.stage,

                progress:
                  Number(
                    job.progress || 0
                  ),

                error:
                  job.error || null,

                createdAt:
                  job.createdAt,

                updatedAt:
                  job.updatedAt,

                progressMessage:
                  job.progressMessage
                  ?? null,

                requestedMode:
                  job.parseModeRequested
                  ?? null,

                requestedBackend:
                  job.parseBackendRequested
                  ?? null,

                actualTier:
                  job.parseTierActual
                  ?? null,

                parseBackend:
                  job.parseMetrics
                    ?.parseBackend
                  ?? null,

                parseModelVersion:
                  job.parseMetrics
                    ?.parseModelVersion
                  ?? null,

                cacheHit:
                  Boolean(
                    job.parseCacheHit
                  ),

                fallbackUsed:
                  Boolean(
                    job.parseFallbackUsed
                  ),

                fallbackReason:
                  job.parseFallbackReason
                  ?? null

              })
            )

        });


      } catch (error) {

        console.error(
          "[contract history]",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "无法读取合同历史记录"

          });

      }

    }
  );


  /*
   * GET /api/contracts/latest
   *
   * Return the newest contract belonging
   * to the currently authenticated user.
   */
  router.get(
    "/latest",

    async (req, res) => {

      try {

        const owner =
          ownerUsername(req);


        const job =
          await getLatestContractForOwner(
            owner
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "暂无合同任务"
            });

        }


        return res.json({

          ok: true,

          id:
            job.id,

          originalName:
            job.originalName,

          status:
            job.status,

          stage:
            job.stage,

          progress:
            Number(
              job.progress || 0
            ),

          createdAt:
            job.createdAt,

          updatedAt:
            job.updatedAt,

          error:
            job.error || null,

          progressMessage:
            job.progressMessage
            ?? null,

          requestedMode:
            job.parseModeRequested
            ?? null,

          requestedBackend:
            job.parseBackendRequested
            ?? null,

          actualTier:
            job.parseTierActual
            ?? null,

          parseBackend:
            job.parseMetrics
              ?.parseBackend
            ?? null,

          parseModelVersion:
            job.parseMetrics
              ?.parseModelVersion
            ?? null,

          cacheHit:
            Boolean(
              job.parseCacheHit
            ),

          fallbackUsed:
            Boolean(
              job.parseFallbackUsed
            ),

          fallbackReason:
            job.parseFallbackReason
            ?? null

        });


      } catch (error) {

        console.error(
          "[contract-review latest]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法读取最新合同任务"
          });

      }

    }
  );


  /*
   * DELETE /api/contracts/:id
   *
   * Delete is available at every contract stage.
   *
   * If MinerU is currently parsing:
   * - hide/soft-delete immediately
   * - worker performs physical cleanup safely
   *
   * Otherwise:
   * - remove files immediately
   * - remove database row immediately
   */
  router.delete(
    "/:id",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({

              ok: false,

              error:
                "无效的合同任务编号"

            });

        }


        const owner =
          ownerUsername(
            req
          );


        const job =
          await contractRepository
            .softDeleteContractForOwner(
              contractId,
              owner
            );


        if (!job) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "合同任务不存在"

            });

        }


        const isActivelyParsing =
          (
            job.status ===
              "processing"
            &&
            job.stage ===
              "parsing"
          );


        if (
          isActivelyParsing
        ) {

          return res.json({

            ok: true,

            id:
              contractId,

            deleted:
              true,

            cleanup:
              "pending",

            message:
              "合同已删除，后台解析结束后将自动清理文件。"

          });

        }


        try {

          await deleteContractCredential(
            contractId
          );

        } catch (credentialError) {

          console.error(
            "[contract delete credential]",
            credentialError.code
            || "DELETE_FAILED"
          );

        }

        await fsp.rm(
          contractDir(
            contractId
          ),
          {
            recursive: true,
            force: true
          }
        );


        await contractRepository
          .hardDeleteContract(
            contractId
          );


        return res.json({

          ok: true,

          id:
            contractId,

          deleted:
            true,

          cleanup:
            "completed"

        });


      } catch (error) {

        console.error(
          "[contract delete]",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "删除合同失败"

          });

      }

    }
  );


  /*
   * GET /api/contracts/:id/preview
   *
   * Authenticated, owner-only PDF preview.
   */
  router.get(
    "/:id/preview",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        const previewPath =
          path.join(
            contractDir(
              contractId
            ),
            "source.pdf"
          );


        try {

          await fsp.access(
            previewPath,
            fs.constants.R_OK
          );

        } catch (_) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "原合同文件不存在"
            });

        }


        res.setHeader(
          "Content-Type",
          "application/pdf"
        );

        res.setHeader(
          "Content-Disposition",
          'inline; filename="contract.pdf"'
        );


        return res.sendFile(
          previewPath
        );


      } catch (error) {

        console.error(
          "[contract-review preview]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法打开原合同"
          });

      }

    }
  );


  /*
   * GET /api/contracts/:id/draft
   */
  router.get(
    "/:id/draft",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        const draft =
          await readDraft(
            root,
            contractId
          );


        return res.json({

          ok: true,

          id:
            contractId,

          content:
            draft.content,

          bytes:
            draft.bytes,

          updatedAt:
            draft.updatedAt,

          status:
            job.status,

          stage:
            job.stage,

          progress:
            job.progress

        });


      } catch (error) {

        console.error(
          "[contract-review draft get]",
          error
        );


        if (
          error.code ===
          "ENOENT"
        ) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "校对稿尚未生成"
            });

        }


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法读取校对稿"
          });

      }

    }
  );


  /*
   * PUT /api/contracts/:id/draft
   */
  router.put(
    "/:id/draft",

    express.json({
      limit: "5mb"
    }),

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        if (
          job.stage !==
          "reviewing"
        ) {

          return res
            .status(409)
            .json({
              ok: false,
              error:
                "当前任务不处于人工校对阶段"
            });

        }


        const content =
          req.body?.content;


        const saved =
          await writeDraft(
            root,
            contractId,
            content
          );


        return res.json({

          ok: true,

          id:
            contractId,

          bytes:
            saved.bytes,

          updatedAt:
            saved.updatedAt

        });


      } catch (error) {

        console.error(
          "[contract-review draft save]",
          error
        );


        if (
          error.code ===
          "DRAFT_TOO_LARGE"
        ) {

          return res
            .status(413)
            .json({
              ok: false,
              error:
                "Markdown 校对稿过大"
            });

        }


        return res
          .status(400)
          .json({
            ok: false,
            error:
              error.message ||
              "无法保存校对稿"
          });

      }

    }
  );


  /*
   * GET /api/contracts/:id/issues
   */
  router.get(
    "/:id/issues",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        const document =
          await readIssues(
            root,
            contractId
          );


        return res.json({

          ok: true,

          id:
            contractId,

          ...document

        });


      } catch (error) {

        console.error(
          "[contract-review issues]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法读取 OCR 校对问题"
          });

      }

    }
  );


  /*
   * POST /api/contracts/:id/issues/:issueId/resolve
   */
  router.post(
    "/:id/issues/:issueId/resolve",

    express.json({
      limit: "128kb"
    }),

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        /*
         * ISSUE_RESOLVE_REVIEW_STAGE_GUARD_V1
         *
         * Issues may only be resolved while the
         * contract is actively under human review.
         */
        if (
          job.stage !==
          "reviewing"
        ) {

          return res
            .status(409)
            .json({

              ok: false,

              error:
                "当前任务不处于人工校对阶段"

            });

        }


        const result =
          await resolveIssue(
            root,
            contractId,
            req.params.issueId,
            {
              resolution:
                req.body?.resolution,

              note:
                req.body?.note
            }
          );


        return res.json({

          ok: true,

          id:
            contractId,

          ...result

        });


      } catch (error) {

        if (
          error.code ===
          "ISSUE_NOT_FOUND"
        ) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "OCR 校对问题不存在"
            });

        }


        console.error(
          "[contract-review issue resolve]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法确认 OCR 校对问题"
          });

      }

    }
  );


  /*
   * POST /api/contracts/:id/finalize
   */
  router.post(
    "/:id/finalize",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({
              ok: false,
              error:
                "无效的合同任务编号"
            });

        }


        const job =
          await getContractForOwner(
            contractId,
            ownerUsername(req)
          );


        if (!job) {

          return res
            .status(404)
            .json({
              ok: false,
              error:
                "合同任务不存在"
            });

        }


        if (
          job.stage !==
          "reviewing"
        ) {

          return res
            .status(409)
            .json({
              ok: false,
              error:
                "当前任务不处于人工校对阶段"
            });

        }


        /*
         * FINALIZE_UNRESOLVED_GUARD_V1
         *
         * Never trust only the browser's issue count.
         * The server independently checks issues.json
         * immediately before finalization.
         */
        const issuesDocument =
          await readIssues(
            root,
            contractId
          );


        const unresolvedIssues =
          (
            Array.isArray(
              issuesDocument?.issues
            )
              ? issuesDocument.issues
              : []
          ).filter(
            issue =>
              issue?.status !==
              "resolved"
          );


        if (
          unresolvedIssues.length > 0
        ) {

          return res
            .status(409)
            .json({

              ok: false,

              error:
                `还有 ${unresolvedIssues.length} 个待核对项未处理`,

              unresolvedCount:
                unresolvedIssues.length

            });

        }


        const finalized =
          await finalizeDraft(
            root,
            contractId
          );


        const updated =
          await updateContractState(
            contractId,
            {
              status:
                "completed",

              stage:
                "completed",

              progress:
                100,

              error:
                null
            }
          );


        return res.json({

          ok: true,

          id:
            contractId,

          status:
            updated.status,

          stage:
            updated.stage,

          progress:
            updated.progress,

          bytes:
            finalized.bytes,

          updatedAt:
            finalized.updatedAt

        });


      } catch (error) {

        console.error(
          "[contract-review finalize]",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              "无法生成最终 Markdown"
          });

      }

    }
  );


  /*
   * GET /api/contracts/:id/status
   *
   * PostgreSQL is queried first.
   *
   * Legacy JSON fallback only exists so that
   * jobs created before Phase 2B still work.
   */
  router.get(
    "/:id/status",

    async (req, res) => {

      try {

        const contractId =
          req.params.id;


        if (
          !validContractId(
            contractId
          )
        ) {

          return res
            .status(400)
            .json({

              ok: false,

              error:
                "无效的合同任务编号"

            });

        }


        const owner =
          ownerUsername(req);


        let job =
          await getContractForOwner(
            contractId,
            owner
          );


        /*
         * Old Phase 1 jobs may only exist
         * as job.json files.
         */
        if (!job) {

          const legacy =
            await readLegacyJob(
              contractId
            );


          if (
            legacy &&
            legacy.ownerUsername ===
              owner
          ) {

            job = legacy;

          }

        }


        if (!job) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "合同任务不存在"

            });

        }


        return res.json({

          ok: true,

          id:
            job.id,

          originalName:
            job.originalName,

          status:
            job.status,

          stage:
            job.stage,

          progress:
            Number(
              job.progress ||
              0
            ),

          createdAt:
            job.createdAt,

          updatedAt:
            job.updatedAt,

          error:
            job.error ||
            null,

          pageCount:
            job.pageCount
            ?? job.page_count
            ?? null,

          requestedMode:
            job.parseModeRequested
            ?? null,

          requestedBackend:
            job.parseBackendRequested
            ?? null,

          actualTier:
            job.parseTierActual
            ?? null,

          parseBackend:
            job.parseMetrics
              ?.parseBackend
            ?? null,

          parseModelVersion:
            job.parseMetrics
              ?.parseModelVersion
            ?? null,

          cacheHit:
            Boolean(
              job.parseCacheHit
            ),

          fallbackUsed:
            Boolean(
              job.parseFallbackUsed
            ),

          fallbackReason:
            job.parseFallbackReason
            ?? null,

          progressMessage:
            job.progressMessage
            ?? null,

          parseMetrics:
            job.parseMetrics
            ?? null

        });


      } catch (error) {

        console.error(
          "[contract-review status]",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "无法读取合同任务状态"

          });

      }

    }
  );


  
  /*
   * CONTRACT_FIELDS_API_V1
   *
   * GET /api/contracts/:id/fields
   *
   * Return deterministic contract fields generated
   * after MinerU parsing.
   *
   * The contract must belong to the current user.
   */
  router.get(
    "/:id/fields",

    async (req, res) => {

      try {

        const contractId =
          String(
            req.params.id
            || ""
          );


        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(
              contractId
            )
        ) {

          return res
            .status(400)
            .json({

              ok: false,

              error:
                "无效的合同任务编号"

            });

        }


        const owner =
          req.session
          ?.auth
          ?.username;


        if (!owner) {

          return res
            .status(401)
            .json({

              ok: false,

              error:
                "请先登录"

            });

        }


        const contracts =
          await contractRepository
            .listContractsForOwner(
              owner
            );


        const contract =
          contracts.find(
            item =>
              String(
                item.id
              )
              ===
              contractId
          );


        if (!contract) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "合同任务不存在"

            });

        }


        const nodePath =
          require(
            "node:path"
          );


        const nodeFs =
          require(
            "node:fs/promises"
          );


        const fieldsPath =
          nodePath.join(
            root,
            "storage",
            "contracts",
            contractId,
            "parsed",
            "document.fields.json"
          );


        let document;


        try {

          const raw =
            await nodeFs.readFile(
              fieldsPath,
              "utf8"
            );


          document =
            JSON.parse(
              raw
            );


        } catch (error) {

          if (
            error?.code ===
            "ENOENT"
          ) {

            return res.json({

              ok: true,

              available:
                false,

              id:
                contractId,

              originalName:
                contract.originalName
                ||
                contract.original_name
                ||
                null

            });

          }


          throw error;

        }


        return res.json({

          ok: true,

          available:
            true,

          id:
            contractId,

          originalName:
            document.originalName
            ||
            contract.originalName
            ||
            contract.original_name
            ||
            null,

          generatedAt:
            document.generatedAt
            ||
            null,

          source:
            document.source
            ||
            "deterministic",

          fields:
            document.fields
            ||
            {},

          tableChecks:
            Array.isArray(
              document.tableChecks
            )
              ? document.tableChecks
              : [],

          consistencyIssueCount:
            Number(
              document.consistencyIssueCount
              || 0
            )

        });


      } catch (error) {

        console.error(
          "[contract fields]",
          error
        );


        return res
          .status(500)
          .json({

            ok: false,

            error:
              "无法读取合同信息"

          });

      }

    }
  );


return router;
}


module.exports = {
  createContractRouter
};

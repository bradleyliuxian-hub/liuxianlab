# PROJECT STATUS

## Current Goal
Excel Review Assistant V1.4.2 — 上传主链路 Regression Fix：单 `.xlsx` / 多 `.xlsx` / `.zip` 统一走同一个 canonical Job 创建实现；失败时给出准确原因（区分数据库不可用等），不再显示笼统错误。

## Current Task
完成 `job-factory.js`（唯一建 Job 实现）、`routes.js` 改造（内存上传 + 精确错误码 + 新路由 `/archive`）、前端错误码映射、ZIP 解压体积上限、契约回归测试。**未 commit / 未 push / 未 deploy / 未跑生产 migration。**

## Root Cause（诊断结论）
单文件与 ZIP 失败**同一根因**：`repository.createJob` 无法连接 PostgreSQL。
**真实定位**：`.env` `DATABASE_URL`（本机 127.0.0.1:5432 的库），但本机 **PostgreSQL 未运行**；PostgreSQL 数据目录下的 `postmaster.pid` 是上次非正常关机遗留的**陈旧锁**（PID 被无关进程复用）导致无法自启。**已处理**：删除陈旧锁 → 启动 PG 16 → 以应用凭据应用 `002`（此前仅 001）→ 重启 dev server。`createJob` 往返验证通过，dev 日志不再 `ECONNREFUSED 5432`。
- `POST /api/excel-reviews` 命中 catch → 500 `无法创建 Excel 复核任务。`
- `/archive` 对每个成员同样失败并被 catch → 400 `压缩包内没有可处理的 .xlsx 文件。`
HTTP → Multer → 校验 → 存储 → Python worker 链路**未回归**：用真实 PostgreSQL（临时集群，应用 001+002）+ 真实文件验证，单文件、多文件、ZIP 全部成功。

## Completed
- **Canonical Job 创建**：`server/excel-review/job-factory.js#createExcelReviewJobFromBuffer()`，唯一实现；单文件与 ZIP 每个 `.xlsx` 均调用它（含目录/`source.xlsx`/`meta.json`/建库/入队/清理）。
- **精确错误码**：`UNAUTHENTICATED / INVALID_XLSX / INVALID_FILE_TYPE / UPLOAD_TOO_LARGE / STORAGE_WRITE_FAILED / DB_UNAVAILABLE(503) / JOB_CREATE_FAILED / WORKER_ENQUEUE_FAILED`；前端 `ERROR_MESSAGES` 映射。
- **无 ghost job**：建库前失败清理目录；入队失败把该行标记 failed；ZIP 单成员失败隔离。
- **ZIP 加固**：`archive vs workbook` 由路由+扩展名判定（`.xlsx` 也是 PK，绝不按 magic 分流）；`MAX_ARCHIVE_TOTAL_UNCOMPRESSED=200MB` 防 zip 炸弹；成员 ≤50、单成员 ≤20MB。
- 未改 Contract Review；未恢复回写 / reply upload / final.xlsx。

## Changed Files
- 新增：`server/excel-review/job-factory.js`、`tests/excel-review/upload-pipeline.test.js`（+ 既有 `tests/excel-review/archive.test.js`）。
- 修改：`server/excel-review/routes.js`（内存上传、canonical helper、错误码、archive 路由健壮化）、`server.js`（挂载 control-log 路由，V1.4）、`private/tools/excel-review/{index.html,script.js,excel-review-history.js,styles.css,DEVLOG.md}`、`package.json`、`config/tools.json`（v1.4.2）、`PROJECT_STATUS.md`。
- V1.4 其余新增（control-log-*、control_log.py/worker、migration 002）保持不变。

## Verification（本地真实链路）
- 临时本地 PostgreSQL 16（端口 5433，应用 `001`+`002`）+ 本地 harness（session stub）：
  - 单文件小 xlsx → 202 → `review_ready`，Q=2。
  - 单文件真实 4.9MB `Spreadsheet_Vision Star.xlsx` → 202 → `review_ready`，Q=28；`source.xlsx` SHA256 与上传文件一致。
  - ZIP（legacy + threaded + no_comment + notes.txt）→ 202 → 3 jobs → `review_ready` Q=2 / 27 / 0；忽略 txt。
  - `.xlsx` 投递到 `/archive` → 400 `INVALID_FILE_TYPE`（**证明不按 PK magic 误判**）。
  - 停库后：单文件 `/` 与 `/archive` 均返回 **503 `DB_UNAVAILABLE`**（即原“无法创建任务”的真实原因）。
  - Control Log：5 个已完成 Job → `review_ready`，files=5 / questions=59；`control_log.xlsx` 可重开（Dashboard/Control Log/Source Files/_Mapping）。
- `npm test`：**143 pass / 0 fail**（含 upload-pipeline 6 + archive 5）。
- Python：`services/excel_review` **79 pass / 0 fail**。
- Contract Review：**99 pass / 2 import errors**（`psycopg` 缺失，环境问题、与本次无关）。
- `node --check` 全过；`git diff --check` 干净。

## Known Issues
- 生产需 PostgreSQL 可达（否则现在会明确返回 503 DB_UNAVAILABLE）；生产还需应用 migration `002` 并重启 Node。
- 仅后缀 `.xlsx`（ZIP 内成员亦须 `.xlsx`）。

## Git State
- branch: main；HEAD `ec3df9d`（未 commit）。
- 详见报告 `~/Downloads/excel-review-v1.4.2-regression-fix-report.md`。

## Deployment Impact
- 无新依赖 / 无 env；生产需应用 `002_excel_review_control_logs.sql` 并重启 Node（PM2）以加载新路由。

## Next Action
- 人工评审；生产 preflight（PG 可达校验、migration、PM2 重启审批）。等待批准：不 commit / push / deploy。

## Session Log
- 2026-10-15：V1.4.2 上传回归修复（canonical job-factory + 错误码 + ZIP 加固 + 契约测试）；真实 PG 链路验证通过；npm test 143 pass。

## Last Updated
2026-10-15

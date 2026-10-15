# Excel 复核意见 · 开发日志（DEVLOG）

> 工具：Excel Review Assistant
> 入口：`/tools/excel-review`
> 产品定位：**只读抽取** Excel 批注并生成可 F5 定位的复核清单；不回写原文件。
> 当前 UI 版本：`v1.4.3`（工具卡片 badge：Beta）
> 最近更新：2026-10-15

本文件记录该工具的**版本功能**与**版本修改**，供开发者（AI 接手）与使用者查阅。
详细的分版本实现报告见仓库 `docs/excel-review-*.md`。

---

## 1. 功能概述

从 `.xlsx` 中提取两类批注，汇总为一份带定位信息的「复核清单」工作簿：

- **传统 Excel 批注 / Note**（legacy）
- **Microsoft 365 新版线程批注**（threaded comment + reply）

分析完成后网页直接展示：问题总数、新旧批注分布、问题提出人统计。
生成的 Review 工作簿包含 Dashboard 与两张可自由编辑的清单，每条记录带 Excel
Address（F5 / Ctrl+G 可跳转）与 Source Reference。

**明确不做的事**：上传已回复文件、自动写回原批次注、生成 final.xlsx。
系统只产出清单，不读取用户本地填写的「回复 / 状态」列。

---

## 2. 版本历史（功能 + 修改）

### V1.4.3（2026-10-15）— 上传文件名 UTF-8 编码修复

**根因**：multipart/form-data 的 filename 参数由 busboy 默认按 **latin1** 解码，UTF-8 字节被单字节解码 → `【`(E3 80 90) 变成 `â€‹`（Windows-1252 渲染），再原样入库/显示。

- **修复（根因）**：两处 `multer(...)` 增加 `defParamCharset: 'utf8'`（multer 2.4.0 → busboy 1.6 支持），`req.file.originalname` 直接为正确 UTF-8。
- **历史数据修复**：新增 `server/excel-review/encoding.js#repairMojibake()`，对**已是乱码**的存量文件名在读取时还原（ASCII/正常中文/西文原名不动；仅当可无损按单字节回退为合法 UTF-8 时生效）；用于 `publicJob.originalFilename`、下载名、Control Log 的 Source File。
- **未改**：HTML/JS/CSS/JSON 编码（本就 UTF-8）、DB（UTF8）、二进制下载（xlsx/zip 仍按 binary stream）。
- 测试：`tests/excel-review/encoding.test.js`（latin1 与 Windows-1252 两种乱码还原、正常文本不动）+ `upload-pipeline.test.js` 增加 UTF-8 文件名往返；`npm test` 147 pass。


### V1.4.2（2026-10-15）— 上传主链路 Regression Fix（单 XLSX / ZIP）

**真实环境定位（2026-10-15 复现）**：`.env` 的 `DATABASE_URL` = `127.0.0.1:5432/liuxianlab`，但本机 **PostgreSQL 未运行**（端口 5432 关闭；PostgreSQL 数据目录下的 `postmaster.pid` 为上次非正常关机遗留的**陈旧锁文件**，其 PID 已被无关进程复用）。→ `repository.createJob` 连接被拒 → 单文件 500 / ZIP 400。

**处理**：删除陈旧 `postmaster.pid` → 启动 PostgreSQL 16 → 用应用凭据应用 `002_excel_review_control_logs.sql`（此前只应用过 001）→ 重启开发服务器加载修复代码。验证：`repository.createJob` 往返成功；dev 日志不再出现 `ECONNREFUSED 5432`。

**根因（同一个）**：`repository.createJob` 无法连接 PostgreSQL（本机 `ECONNREFUSED 127.0.0.1:5432`）。单文件 `POST /api/excel-reviews` 命中 catch → 500 `无法创建 Excel 复核任务。`；ZIP 路由对每个成员同样失败并 catch → 400 `压缩包内没有可处理的 .xlsx 文件。`。HTTP/Multer/校验/存储/Python worker 链路本身未回归（用真实 PG + 真实文件验证：单文件、多文件、ZIP 均成功）。

- **Canonical Job 创建**：新增 `server/excel-review/job-factory.js#createExcelReviewJobFromBuffer()`，**唯一**的建 Job 实现；单文件上传与 ZIP 每个 `.xlsx` 成员都调用它（`routes.js` 改为内存上传 → factory 负责目录/`source.xlsx`/`meta.json`/建库/入队）。
- **精确错误码/信息**：`UNAUTHENTICATED / INVALID_XLSX / INVALID_FILE_TYPE / UPLOAD_TOO_LARGE / STORAGE_WRITE_FAILED / DB_UNAVAILABLE(503) / JOB_CREATE_FAILED / WORKER_ENQUEUE_FAILED`；前端按 code 映射友好文案（数据库不可用不再伪装成“无法创建任务”）。
- **无 ghost job**：建库前失败 → 清理目录；入队失败 → 标记该行为 failed；ZIP 单成员失败隔离、不入 Control Log。
- **ZIP 加固**：PK 头仅表示“是 ZIP 容器”，**archive vs workbook 由路由 + 扩展名决定**（`.xlsx` 也是 PK，绝不按 magic 分流）；新增累计解压上限 `MAX_ARCHIVE_TOTAL_UNCOMPRESSED=200MB` 防 zip 炸弹。
- **测试**：`tests/excel-review/upload-pipeline.test.js`（stub DB 锁定契约：单文件 202+job.id、`.xlsx` 不被当作 archive、ZIP→每成员一个 Job、空包 400、**DB 故障→503 DB_UNAVAILABLE**、成员失败隔离）；`npm test` 143 pass。


### V1.4.1（2026-10-15）— 压缩包（.zip）上传

- 上传框可接受一个 `.zip`（内含多个 `.xlsx`）：`POST /api/excel-reviews/archive` 服务端用 vendored `fflate` **安全解压**，为每个 `.xlsx` 建立**独立 Job**（仍复用现有校验/存储/worker/owner scope），返回 jobs 列表；前端随后正常轮询，可继续汇总 Control Log。
- 安全：入口名不用作文件系统路径（每个 Job 目录是新 UUID，天然防 zip-slip）；额外过滤目录 / `__MACOSX` / 隐藏 / `._` / 非 `.xlsx` / `..` / 绝对路径；单包上限 50MB、成员上限 50、单成员 ≤20MB。
- 前端：多选支持 `.xlsx` 与 `.zip` 混选；zip 会展开为多个任务行。能力在 `/meta` 暴露 `archiveUpload`/`archiveAccepted`/`maxArchiveSize`/`maxArchiveFiles`。
- 新增测试：`tests/excel-review/archive.test.js`（PK 头、入口名过滤、zip-slip 拒绝、非 zip 拒绝、成员上限）。


### V1.4（2026-10-15）— 多文件 Review Control Log

**新增上层汇总对象 Control Log**，单文件 Job 架构不变（1 Excel = 1 Job）。

- **批量上传**：上传框支持多选 `.xlsx`；每个文件仍走原有校验 → storage → 独立 Job → worker（不创建“多文件 Job”）。per-file 状态与错误隔离（部分失败不影响其它文件）。
- **历史多选**：历史记录可勾选多个已完成任务（或批量上传完成后），点击「创建 Control Log」。
- **统一生成路径**：批量上传与历史多选最终都 `POST /api/excel-review-control-logs { jobIds }`，只有一套生成逻辑。
- **数据模型**：新增 `excel_review_control_logs` 与 `excel_review_control_log_jobs`（relation，`PRIMARY KEY(control_log_id, excel_review_job_id)`，job id 为普通 UUID，不 FK/不级联 → 删除源 Job 不影响 Control Log）。migration：`server/excel-review/migrations/002_excel_review_control_logs.sql`（additive/幂等/BEGIN-COMMIT）。
- **独立快照**：创建时 Python worker 读取各 Job 的 `extracted.json`，写出 `storage/excel-review-control-logs/<id>/{control_log.json, control_log.xlsx}`；此后不依赖源 Job artifacts（删源 Job 后仍可下载）。
- **身份 / 去重**：Control Log 用 `control_log_id + control_item_id` 作为机器身份，`control_no=CL-0001...` 仅显示；来源靠 `source_job_id + source_item_id`（`source_filename`/sheet/cell 不作唯一身份）。同一 Job / 同一 source item 只入一次（DB 唯一约束 + service 与 build 双重防御去重）。
- **统计口径沿用 V1.3**：Question = legacy note + threaded root；threaded reply 不计为问题（`statistics.py` 复用）。Author = 批注作者，空 → 未知作者。
- **Control Log 工作簿**：`Dashboard` + `Control Log` + `Source Files` + 隐藏 `_Mapping`；可见表无 worksheet protection；Control Log 表转为 Excel Table（`ControlLogTable`/`SourceFilesTable`），Dashboard 用结构化引用 + IFERROR。
- **Control Log 列**：Control No. / Source File / Sheet / Cell / Excel Address / Type / Original Value / Review Issue / Author / Reply / Status / Owner / Priority / Due Date / Notes / Source Reference（+ 隐藏 `_CONTROL_ITEM_ID`）。Reply/Owner/Priority/Due Date/Notes 默认空，Status 默认 Open。
- **API**：`POST/GET/GET :id/GET :id/file/DELETE :id` 于 `/api/excel-review-control-logs`（requireAuth + owner scope + 私有下载）。
- **不做**：回复上传 / 自动回写 / final.xlsx；不新增 AI / 协作 / 新数据库 / 前端框架。删除 Control Log 不删除源 Job。
- 新增：`server/excel-review/{control-log-repository.js,control-log-runner.js,control-log-routes.js,migrations/002_excel_review_control_logs.sql}`、`services/excel_review/{control_log.py,control_log_worker.py}`、`services/excel_review/tests/test_control_log.py`；前端 `index.html/script.js/excel-review-history.js/styles.css`。


### V1（2026-10-13）— 首个可用版本（只读 legacy 批注）

- 新增登录保护的 `/tools/excel-review`；`.xlsx` 上传（扩展名 + MIME + ZIP 头 + 20MB 校验）。
- PostgreSQL 任务表 `excel_review_jobs`（独立表，不改 contracts）。
- openpyxl 提取传统批注：Sheet / Cell 地址 / 当前值 / 批注正文 / 作者。
- 生成 `review.xlsx`：`Comments` 表 + 隐藏 `_Mapping`；Mapping 防篡改 token + source SHA256。
- **当时**支持重新上传已回复文件写回批次注、生成 `final.xlsx`（源文件不受影响）。
- 历史记录、删除、owner 隔离、私有下载、progress/status。
- 新增：`server/excel-review/{migrations/001_excel_review.sql,repository.js,parse-runner.js,routes.js}`、
  `services/excel_review/*`、`private/tools/excel-review/*`；修改 `server.js`（挂载）、`config/tools.json`。
- 测试：Python 22 pass；Node 端到端 25 项断言。
- 报告：`docs/excel-review-v1-report.md`

### V1.1（2026-10-13）— 支持 Microsoft 365 新版线程批注

**根因**：openpyxl 3.1.5 不认识 `xl/threadedComments/*` 与 `xl/persons/*`；且
`load_workbook() -> save()` 会**删除**这些 part，因此含线程的工作簿绝不能由 openpyxl 重新保存。

- 新增 OOXML 低层解析：`ooxml_package.py`（OPC/ZIP + relationships）、
  `ooxml_threaded_comments.py`（按 relationships 动态定位，不按文件名猜 sheet）。
- 统一批注模型：`legacy | threaded | threaded_reply`，含 threadId / parentThreadId / personId。
- Review 结构升级：新增 Source File / Source Reference / Type 等列。
- **移除所有 worksheet protection**（改为无保护、可自由编辑）。
- Mapping 升级到 **V2**（item UUID、source SHA256、token、version、thread identity）。
- 写回改为双模式：纯 legacy 用 openpyxl；含线程用 **OOXML 手术式补丁**，逐字节保留
  threadedComments / persons / rels / Content Types。
- **原生线程 Reply 写回未实现**（环境无桌面 Excel 可验证），改为明确上报 `threadedRepliesSkipped`。
- 测试：36 pass；Node 端到端 13 项。
- 报告：`docs/excel-review-v1.1-report.md`、`docs/excel-review-v1.1-verification-report.md`

### V1.2（2026-10-13）— 两表结构 + 原始值取缓存结果

**根因**：V1.1 用 `data_only=False` 读值，公式单元格会暴露公式字符串 / `#VALUE!` 等错误。

- 同时打开两个 workbook：结构用 `data_only=False`，显示值用 `data_only=True` 取**缓存结果**；
  统一经 `normalize_display_value()`，公式永不输出、错误值与无缓存值留空。
- Review 固定为**两张可见表**：`新版批注`（threaded + reply）、`旧版批注`（legacy）+ 隐藏 `_Mapping`。
- 可见表移除全部技术字段（ID / Thread ID / token / hash / 时间等）。
- 新增隐藏列 `_ITEM_ID`（随行排序移动），用于安全定位；Mapping 升级 **V3**。
- 测试：42 pass。
- 报告：`docs/excel-review-v1.2-report.md`

### V1.2 收口（2026-10-13）— Excel Address + 取消自动回写

- 产品流程收敛为：`source.xlsx → review.xlsx → 下载 → 人工查看 / F5 定位`。
- 新增 `format_excel_address()`，可见表插入 **G 列 Excel Address**（如 `'财务复核'!B5`，单引号转义）。
- **移除**：回复上传、自动写回、`reply_writer.py`、final.xlsx、`replies` / `final-file` 路由（返回 404）。
- 「回复 / 状态」列仍保留供本地维护，但后台不读取。
- 测试：28 pass。
- 报告：`docs/excel-review-v1.2-simplification-report.md`

### 线程状态修复（2026-10-13）— `done` 语义

- **根因**：状态列被硬编码为 `pending`；且 `done` 只识别 `=="true"`，真实 Excel 写的是 `done="1"`。
- `parse_done()` 支持 `1/true/yes/on`；parser 传播 root 的 resolved 到全部后代。
- 新状态规则：legacy → pending；threaded root 无 done → pending；`done` → completed；
  threaded reply 继承 root；孤立 reply 保守判 pending。
- 测试：58 pass。
- 报告：`docs/excel-review-thread-status-fix-report.md`

### V1.3（2026-10-13）— Dashboard + 网页统计

- 新增 `statistics.py`：单一统计对象（问题总数 / 新旧分布 / 作者分布），Web 与 Excel 共同消费。
- Review 新增 **Dashboard** 为第一张表：KPI + 按作者统计，全部用 Structured References 公式
  （`fullCalcOnLoad`，随「回复」列自动更新）。
- 网页新增分析结果 Summary（问题数 / 新旧 / 提出人 / 按作者列表）。
- 问题定义：legacy note 与 threaded root 计为 question，threaded reply 不计入。
- 测试：43 pass。
- 报告：`docs/excel-review-v1.3-report.md`

### 线程合并为单行（2026-10-13）

- 一个线程（root + 若干 reply）在 Review 中只占 **一行**；回复文本合并写入该行「回复」列。
- `build_review_workbook` 只写 threaded root，按 `rootThreadId` 归组回复。
- 报告：`docs/excel-review-thread-single-row-report.md`

### 提交与发布

| commit / tag | 说明 |
|---|---|
| `009fa48` | `feat: add Excel Review Assistant tool`（V1→V1.3 + 线程修复合并入库） |
| `e8ea6a9` | `fix: prevent formula injection in Excel review output` |
| tag `excel-tools-v1.0.0` | Excel 工具（复核 + 小数检查）发布点 |
| — | **生产部署已完成**（migration 001 + PM2 restart，用户确认） |

**公式注入修复（`e8ea6a9`）**：所有用户来源字符串（文件名 / Sheet / 单元格 / 批注正文 / 作者 /
时间 / thread+person id / Source Reference / Excel Address）统一经 `set_literal_cell`，
强制 `data_type='s'`，避免以 `=` 开头的文本被 openpyxl 当作公式；Dashboard 公式保持公式。

---

## 3. 当前实现结构

```
private/tools/excel-review/             前端（登录后可用）
  index.html / styles.css / script.js / excel-review-history.js

server/excel-review/                    Node 路由层
  migrations/001_excel_review.sql       任务表（additive、幂等）
  repository.js                         任务 CRUD / owner 隔离
  parse-runner.js                       调用 Python worker
  routes.js                             /api/excel-reviews/*

services/excel_review/                  Python 抽取层
  parser.py                             双 workbook 读值 + 统一模型 + Excel Address
  ooxml_package.py / ooxml_threaded_comments.py   线程批注 OOXML 解析
  review_workbook.py                    Dashboard + 两表 + 隐藏 _Mapping
  statistics.py                         统计模型
  status.py / worker.py                 CLI 入口
```

### Review 工作簿结构

```
1. Dashboard   问题总数 / 已回答 / 未回答 / 回答率 / 新旧分布 / 按作者统计（公式驱动）
2. 新版批注    A 类型 | B 原文件 | C Sheet | D Cell | E 原始值 | F 批注内容 |
               G Excel Address | H 作者 | I 回复 | J 状态 | K Source Reference | L _ITEM_ID(隐藏)
3. 旧版批注    同上列结构
4. _Mapping    hidden：item UUID / source SHA256 / token / thread identity / mapping_version(v3)
```

### API

```
POST   /api/excel-reviews                  上传 source.xlsx -> 提取
GET    /api/excel-reviews                  当前用户历史
GET    /api/excel-reviews/:id              状态 / progress / stats
GET    /api/excel-reviews/:id/review-file  下载 review.xlsx
DELETE /api/excel-reviews/:id              删除任务与文件
GET    /api/excel-reviews/meta             能力信息
```

全部挂载于 `requireAuth` + same-origin 校验；文件路径由 job UUID 推导，无用户输入进入路径。

---

## 4. 测试

```
Excel Review tests:    65 pass / 0 fail
  .venv/bin/python -m unittest discover -s services/excel_review/tests -t .
Contract Review 回归:  135 pass（未受影响）
```

---

## 5. 已知限制

- 仅支持 `.xlsx`；`.xls` / `.xlsm` 不支持。
- 网页**无法得知**用户下载后在本机填写的回复；「已回答 / 回答率」只在 Excel 内 Dashboard 随「回复」列变化。
- 不回写原文件、不生成 final.xlsx（V1.2 起主动下线）。
- 复杂 OOXML 高级对象（图片 / 图表 / 数据透视）不保证全量保真；本工具只读、不重建工作簿。
- `_Mapping` 为权威机器身份，不要手改；可见字段（排序 / 加列 / 改文案）不影响定位。

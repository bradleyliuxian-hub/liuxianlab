# Excel Review Assistant v1 — 本地实现报告

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地 V1 完成，**未 commit / 未 push / 未 deploy / 未执行生产 migration**

## 1. 已实现功能

- 登录保护的 `/tools/excel-review` 页面（复用现有 session / owner / 同源保护）。
- `.xlsx` 上传（扩展名 + MIME + ZIP 头 + 20MB 上限校验）。
- PostgreSQL job（`excel_review_jobs`，独立表，不改 contracts）。
- 多 Sheet 扫描，提取传统 Excel Comment / Note：Sheet 名、Cell 地址、当前值、批注正文、作者。
- 稳定索引：每条记录生成 `item_id` (UUID) + 展示用 `review_id` (`C001`)。
- 生成 `review.xlsx`：`Comments` 表 + 隐藏 `_Mapping` 表；Reply 列可编辑，其余列受工作表保护。
- Mapping 防篡改 token + source SHA256 + mapping_version，写回前强校验。
- 重新上传已回复的 Review 文件 -> 校验 -> 把回复写回原单元格批注（保留原作者/原文）。
- 生成 `final.xlsx`（复制源文件后修改，源文件永不改动）+ 可重新打开校验。
- 历史记录、删除、owner 权限隔离、私有下载、progress/status。
- Python 单元测试 22 个；Node 端 25 项断言端到端验证。

## 2. 实际新增文件

Node：
- `server/excel-review/migrations/001_excel_review.sql`
- `server/excel-review/repository.js`
- `server/excel-review/parse-runner.js`
- `server/excel-review/routes.js`

Python：
- `services/excel_review/__init__.py`
- `services/excel_review/status.py`
- `services/excel_review/parser.py`
- `services/excel_review/review_workbook.py`
- `services/excel_review/reply_writer.py`
- `services/excel_review/worker.py`
- `services/excel_review/tests/__init__.py`
- `services/excel_review/tests/test_excel_review.py`

前端：
- `private/tools/excel-review/index.html`
- `private/tools/excel-review/styles.css`
- `private/tools/excel-review/script.js`
- `private/tools/excel-review/excel-review-history.js`

## 3. 实际修改文件

- `server.js`（仅新增 require + 1 个 `app.use` 挂载）
- `config/tools.json`（新增 1 个工具卡片）

未改动的既有用户文件：`AGENTS.md`、`PROJECT_STATUS.md`（保持原样，未覆盖）。

## 4. 数据库变化

新 migration：`server/excel-review/migrations/001_excel_review.sql`
- `BEGIN/COMMIT`、`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`，可重复执行。
- 新表 `excel_review_jobs`，不触碰 contracts schema。
- 本地已在**隔离测试库** `liuxianlab_ertest` 验证（建表 + 重复执行幂等），随后已 drop。
- **未在生产执行。**

## 5. API

```
POST   /api/excel-reviews                 上传 source.xlsx -> 提取
GET    /api/excel-reviews                 当前用户历史
GET    /api/excel-reviews/:id             状态 / progress
GET    /api/excel-reviews/:id/review-file 下载 review.xlsx
POST   /api/excel-reviews/:id/replies     上传已回复 Review -> 写回
GET    /api/excel-reviews/:id/final-file  下载 final.xlsx
DELETE /api/excel-reviews/:id             删除任务与文件
GET    /api/excel-reviews/meta            能力信息
```

全部挂载于 `requireAuth` + `sameOriginForStateChange`。文件路径由 job UUID + 固定文件名推导，无用户输入进入文件系统路径。

## 6. Excel 数据流

```
source.xlsx
  -> extraction (parser.extract)
       -> extracted.json (items + sourceSha256 + mappingToken)
       -> review.xlsx (Comments + hidden _Mapping)
  -> user fills Reply column
  -> reply import (review_workbook.validate_and_read_replies)
       -> token / version / source hash / item identity 校验
  -> final write-back (reply_writer.write_final)
       -> copy source.xlsx -> final.xlsx
       -> append "---\nReply:\n<reply>" to original comment
       -> verify reopen
  -> final.xlsx
```

## 7. 测试

- Python：`services/excel_review/tests` **22 tests / 22 pass / 0 fail**
  （`.venv/bin/python -m unittest discover -s services/excel_review/tests -t .`）
- 复杂工作簿端到端：多 Sheet + 中文/空格/隐藏表 + 公式 + 合并单元格 + 超链接 + 空单元格批注 + 多条回复，全部通过。
- Node 端到端（隔离测试库 + 真实 Express 路由）：25 项断言全通过
  （上传 / 状态 / 下载 review / 写回 / 下载 final / owner 隔离 / 404 / 400 / path traversal / 删除）。
- 现有 Contract Review regression：**135 tests OK**（未受影响）。
- 语法：`node --check`（server.js、3 个新 Node 文件、2 个新前端 JS）、`py_compile`、`git diff --check` 全部通过。

## 8. 当前已知限制

- **Threaded Comments（Microsoft 365 协作批注）**：V1 不解析。检测到时会给出 warning，不谎称已全部提取。
- **复杂 Excel OOXML**：openpyxl 重新保存可能影响部分高级对象（如图片、部分图表、数据透视等）；V1 只承诺 xlsx 常规内容（Sheet/公式/合并/超链接/批注）并给出限制提示，不 silent corrupt。
- **`.xls` / `.xlsm`**：V1 不支持，仅 `.xlsx`。
- Reply 写回是写入真实单元格批注，**不生成** Microsoft 365 原生 thread reply UI。
- 无 AI 回复/分类/排序、无在线协作、无批量多文件。
- 生产部署需人工执行 migration 001 并重启 PM2（本次未做）。

## 9. Git 状态

见命令输出（本次不 commit）。新增目录：`server/excel-review/`、`services/excel_review/`、`private/tools/excel-review/`；修改：`server.js`、`config/tools.json`。

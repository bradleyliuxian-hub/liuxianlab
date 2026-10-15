# PROJECT STATUS

## Current Goal
Excel Review Assistant V1.4.3 — 修复生产端上传文件名 UTF-8 乱码（`【NEW】 23-26331 …` → `â€‹ NEWâ€‹ 23-26331 …`）。仅修编码链路，不加新功能。

## Current Task
完成根因修复（multipart 文件名按 UTF-8 解码）+ 存量乱码读取还原 + 测试。**未 commit / 未 push / 未 deploy。**

## Root Cause
`multipart/form-data` 的 filename 参数由 **busboy 默认按 latin1 解码**，UTF-8 字节被单字节解码：`【`(E3 80 90) → `â€‹`（Windows-1252 渲染），随后原样写入 DB 与页面。
- 发生层：**上传解析（server, multer/busboy）**，不是 HTML/JS/CSS/JSON/DB/Nginx。
- 证据：`defParamCharset` 缺省时 `req.file.originalname` 码点为 `e3,80,90…`；加 `defParamCharset:'utf8'` 后为 `3010,4e,45…`（正确 `【NEW】`）。

## Completed
- **根因修复**：`server/excel-review/routes.js` 两处 `multer({...})` 增加 `defParamCharset: 'utf8'`（multer 2.4.0 转发给 busboy 1.6）→ `originalname` 直接为正确 UTF-8，落库/回显/review.xlsx/Control Log 均正确。
- **存量数据还原**：新增 `server/excel-review/encoding.js#repairMojibake()`，对**已是乱码**的存量文件名在读取时无损还原（正常 ASCII/中文/西文原名不动）。用于 `publicJob.originalFilename`、review 下载名、Control Log 的 `sourceFile`。
- **未改动**（本已正确）：HTML `<meta charset="utf-8">`；JS/CSS/JSON 文件均 UTF-8；Express `res.json` / static 均 `charset=utf-8`；PostgreSQL `server_encoding/client_encoding = UTF8`；xlsx/zip 二进制下载不做字符转码；前端用 `textContent`（无 `innerHTML`，无 XSS 回归）。
- 版本 → v1.4.3（缓存 bust）；changelog/DEVLOG 更新。

## Verification
- 单测/集成：`tests/excel-review/encoding.test.js`（latin1 与 Windows-1252 乱码还原、正常文本不动，3 条）+ `upload-pipeline.test.js` UTF-8 文件名往返（1 条）。`npm test` **147 pass / 0 fail**。
- 真机（本地 PG `liuxianlab`，应用凭据 + 真实 repository）：POST `【NEW】 财务复核测试.xlsx` → HTTP 202，response `job.originalFilename` 与 DB `original_filename` 均为 `【NEW】 财务复核测试.xlsx`（无乱码）。
- Python `services/excel_review` **79 pass**；`git diff --check` 干净；`node --check` 全过。
- 未触碰二进制下载与 Contract Review。

## Known Issues
- 已存在（乱码入库）的旧任务：**页面显示**已由 `repairMojibake` 修复；其 review.xlsx / Control Log 快照在生成时已写入乱码，如需完全一致需**重新上传**（或对历史产物做一次性重建）。
- 生产 Nginx 配置不在本仓库；`charset utf-8;` 建议（对 text/* 生效，勿作用于 xlsx/zip）——需按部署环境单独确认。

## Changed Files
- 新增：`server/excel-review/encoding.js`、`tests/excel-review/encoding.test.js`。
- 修改：`server/excel-review/routes.js`、`server/excel-review/control-log-routes.js`、`tests/excel-review/upload-pipeline.test.js`、`private/tools/excel-review/{index.html,DEVLOG.md}`、`config/tools.json`。
- 未改：前端 `script.js`/`excel-review-history.js`（本就用 `textContent`）、DB schema、Contract Review。

## Git State
- branch: main；HEAD `6cf772b`（已推送）；本轮改动未 commit。

## Deployment Impact
- 纯服务端代码 + 版本号；无新依赖 / 无 env / 无 migration。**生效需重启 Node（PM2）**。前端资源版本 v1.4.3。

## Next Action
- 生产部署（另行批准）：重启 Node → 验证 `curl -I` charset、API JSON、页面文件名。等待批准：不 commit / push / deploy。

## Session Log
- 2026-10-15：V1.4.3 上传文件名 UTF-8 编码修复（defParamCharset + repairMojibake）；npm test 147 pass；本地真机 DB 往返验证通过。

## Last Updated
2026-10-15

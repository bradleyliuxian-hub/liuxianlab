# Project Status

Updated: 2026-10-22

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`；HEAD：`6ea15eeb4dba5037302232ef918c860f39a3cf7f`。
- 工作区：dirty（Phase 1–4A 未提交成果；未 reset / checkout / stash / clean / commit / push）。
- 生产：未部署；未改生产数据库。

## Current Focus

**序时账分析 v1.3.1：大型结果分页/懒加载与 Phase 5B.1 浏览器验证已完成；生产部署未执行。**

- 单文件：upload → inspect → mapping/preview → worker → result → voucher detail → export → history；支持 DEBIT_CREDIT / DIRECTION_AMOUNT / SIGNED_AMOUNT。
- 批量：`/api/journal-entry-batches`；`journal_entry_batches` + `journal_entry_batch_items`；每个文件是普通 child job，继续使用单文件 API/Worker。
- 共享运行时：`server/journal-entry/runtime.js` 由 `server.js` 创建一次并注入 single/batch routers；只有 **一个** 进程内 Queue，`JOURNAL_ENTRY_MAX_CONCURRENT` 为 single + batch 全局上限。
- 批量上传：最多 20 个、单文件 25 MB、总计 100 MB；先全量校验 extension + magic，再创建，一个非法文件整批拒绝。
- 批量开始：start-ready 只启动已配置且 preview 通过的 draft；未就绪项保持 draft；可重复调用，不重跑 queued/running/completed/failed；返回 started/skipped/notReady。
- 批量摘要：只聚合 completed child 的 `summary_json`；Business Coverage / Review Rate 使用加权公式，不平均子任务百分比。
- 批量输出：`POST /api/journal-entry-batches/:id/exports` 生成 `batch-summary.xlsx`、`merged-standardized-journal.xlsx`、`manifest.json`、`batch-report.zip`；只消费 completed child，不重跑分析；快照持久化，支持刷新后重新下载。
- 输出 ZIP：逐文件报告使用 position 前缀安全文件名；manifest 不含财务明细；公式注入与 Zip Slip 防护已测试。
- 批量 UI：`private/tools/journal-entry-analysis/batch.html`；逐文件配置复用单文件页 iframe；显示 ready/pending、批量进度/摘要/历史/逐文件结果与导出。
- 筛选拆分：`split.html` + `/api/journal-entry-splits`；先筛选、再按 1–3 个有序维度组合分组（科目/客户/供应商/往来单位/月份/期间/主体/来源文件）；支持多 Sheet 或 ZIP；Preview 先于生成，分片/分组/行数上限、结构化 index/manifest、快照、刷新恢复、owner 隔离。
- 拆分模板：内置模板 + `/api/journal-entry-split-presets` 个人 CRUD；应用后必须重新 Preview；不兼容字段明确提示；历史 output 保存完整 spec 与 preset 快照。
- Canonical 可选字段：customer/supplier/counterparty code/name 已贯通 mapping → normalize → result → per-file export → batch merge → split export；不从摘要猜测。
- 单文件结果页使用轻量 UI projection + 服务器分页/懒加载；浏览器不再下载完整 result.json；批量 child 与历史任务复用同一 Result Viewer。
- 单文件页支持 `?job=<id>` 与 `embedded=1`；工具卡 v1.3.1；页面已加版本更新说明。
- 契约/身份：internal_line_key 用于详情定位；external line_id 只作展示/追溯；Contra 使用 source/target internal key。
- 数据迁移：`002` batch、`003` batch outputs、`004` split outputs、`005` split presets、`006` storage lifecycle（additive，无破坏 SQL；已在本地隔离 schema 验证；本机开发库已应用 002–006）。

Flowchart-to-Excel 仍为 PAUSED / Coming Soon。

## Known Broken / Unresolved

- 生产部署与迁移 **NOT RUN**；`002`–`006` 尚未应用到生产库。
- 本机未启动常驻 8080；未做生产 PM2/Nginx 检查。
- 完整凭证拆分模式（full voucher）未实现。
- 生产环境 cleanup 未执行；本机仅执行 dry-run。
- 批量页面仅做 headless E2E + 截图检查；人工交互式视觉复核 **NOT RUN**。
- 真实生产数据规模未压测；100k/300k synthetic browser 已通过；300k 生产配置建议 16 GiB RAM。
- 300k preview/start 仍为同步请求（约 65 s）；生产 Nginx 超时待确认。
- 旧 Golden Fixture / V4 视觉 QA / Windows Excel 验收问题仍保持原状态。

## Last Verification

- 2026-10-22 Phase 5B.1：
  - Journal Entry Python **260 pass / 0 fail**
  - Excel Review Python **79 pass / 0 fail**
  - Journal Entry Node **61 pass / 0 fail**（routes 18 + batch 16 + queue 2 + splits 9 + presets 3 + cleanup 5 + ui-result 8）
  - `npm test` **466 pass / 0 fail**
  - browser E2E **PASS**（normal + batch child result viewer + 100k + 300k）
  - 100k initial result-view payload **23,210 bytes**（旧 full result 169,724,487）；300k **23,225 bytes**（旧 510,730,683）
  - 100k/300k dashboard 在 completed 后 **0.00 s** 可用；100k/300k heap 约 5.6 MB / 3.4–3.8 MB
  - 100k/300k network hard assertion：**full result.json requests = 0**
  - UI projection 100k **62,164,152 bytes**；300k **186,671,569 bytes**（details zlib）
  - cleanup dry-run / smoke / compileall / git diff --check **PASS**
  - migration：本阶段无新增；Phase 5B 001–006 rehearsal 仍为 PASS
  - **结论：LARGE RESULT DELIVERY READY；Remaining P0 = None；生产 RAM/proxy/disk 待服务器端确认。**
- Phase 3 基线：voucher detail internal_line_key、duplicate line_id、browser E2E 已通过。
- Phase 2 基线：SIGNED_AMOUNT API/UI/Worker/export 已通过。
- Phase 1 基线：部署脚本、迁移检查、Python 依赖、storage/worker/API smoke 已验证。

## Phase 5B.1 Checkpoint

大型结果交付已完成，详细架构、API、Before/After、正确性、容量与测试见
`docs/agent/journal-entry-analysis/phase5b1-report.md`。

本阶段未执行生产部署、生产迁移或生产 cleanup；本地 bench metadata 已清理。

## Pending Decision

- 是否 commit / push Phase 1–4A 变更并进入生产部署窗口。
- 部署前必须确认生产库执行 `002_journal_entry_batches.sql`，并保持 PM2 单实例（进程内队列）。
- Phase 5B.1 结论为 LARGE RESULT DELIVERY READY；是否按此进入生产部署窗口，以及生产 RAM/proxy/disk 验证安排。

## Next Action

- 决定是否 commit / push Phase 1–5B 变更；不自动提交。
- 在生产窗口应用 002–006 migrations，并确认 PM2 fork/单实例、Nginx 100 MB 上传/600 s 输出超时、磁盘与 RAM 余量。
- 部署后在真实登录浏览器复核批量工作台、拆分页与 v1.3.1 更新说明。

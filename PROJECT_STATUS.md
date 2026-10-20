# Project Status

Updated: 2026-10-20

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`
- HEAD：`7cd4a30`
- 工作区：dirty（包含上一轮序时账接入与本轮采购与退货对抵，均未提交、未 push）。
- 未跟踪：`services/journal_entry.zip` 为既有下载包，未改动。
- 最近操作：模块由 sales-reconciliation 重命名为 purchase-reconciliation（含目录、API、表、页面与文档）；本地迁移、API/UI 验证与测试；未部署。

## Current Goal

把 SAP 采购收货/退货正负数量 FIFO 对抵作为原生模块接入 Liuxian Lab：上传 → 字段识别 → 异步 FIFO → Dashboard / 分页结果 / CSV ZIP / XLSX。

## Completed This Round

- Python 服务 `services/purchase_reconciliation/`
  - `schema.py`（canonical fields + 别名）、`column_mapper.py`
  - `excel_reader.py` OOXML 流式读取，跳过 SAP 百万空行
  - `engine.py` 业务键 + 双指针 FIFO、Decimal、金额守恒
  - `exporters.py` CSV ZIP（UTF-8 BOM）与 write-only XLSX
  - `inspection.py`、`worker.py`、`job_io.py`
- Node 模块 `server/purchase-reconciliation/`
  - `routes.js`、`repository.js`、`job-factory.js`
  - `inspection-runner.js`、`worker-runner.js`（队列、超时、重启恢复、TTL 清理）
  - `result-store.js`（NDJSON 服务端分页 / 搜索 / 排序 / 未匹配过滤）
  - `schema.js`、`migrations/001_purchase_reconciliation.sql`
- 前端 `private/tools/purchase-reconciliation/`
  - 原生 App Shell + 既有 Card/Table/Tabs/Drawer/Toast 视觉
  - 上传、sheet/header 重新识别、字段完整度、规则说明、进度
  - 10 项 KPI、金额结构条形图、移动类型表、FIFO 配对段 / 已对抵 / 剩余 / 未匹配
  - 服务端分页（默认 50，最大 200）、搜索、排序、追溯 Drawer
- 接入：`server.js`、`config/tools.json`、`private/script.js` IA（Excel → 专业分析）、README、PROJECT_INDEX、pre-push-check。
- 文档：`docs/agent/purchase-reconciliation/web-integration.md`。
- 本地数据库已应用 migration 001（`purchase_reconciliation_jobs`）。

## Verification

- Python：`.venv/bin/python -m unittest discover -s services/purchase_reconciliation/tests -t .` = **24 tests OK（1 skipped：未设真实文件 env）**。
- 真实 SAP 回归（`筛选后的_2026梦果子采购SAP抽凭.xlsx`）：
  - 34,297 原始记录 / 634 配对段 / 948 参与 / 33,501 剩余
  - 对抵 14,913,418.90 / 最终净额 570,865,672.91 / 守恒差异 0.00 / `conservation_ok=true`
  - 总计耗时约 2.1s（读取 + 引擎）
- Node：`npm test` = **275 passed**（新增 8 个路由/分页/下载测试）。
- 真实 HTTP 全链路：上传 201（1.4s）→ start 202 → completed；summary/matches/matched/remaining/unmatched/segment/detail/download 均 200。
- Chrome Headless UI 冒烟：上传 → 识别 34,297 行 / 12 字段 → 开始 → Dashboard → 四个 Tab 分页 → Drawer → XLSX ready；**无 console error / exception**。
- XLSX 程序化打开：5 个 sheet；对抵分段 635 行（含表头）、已对抵明细 949、剩余 33,502。
- `journal_entry` Python 回归：235 passed（未改该模块行为）。

## Known Issues / Limits

- 仅支持 OOXML `.xlsx` / `.xlsm`；旧 `.xls` 不解析。
- V1 UI 固定默认匹配键与 FIFO；后端 `ReconciliationConfig` 已预留扩展。
- XLSX 使用 openpyxl write-only，无原生 Excel 图表；CSV ZIP 为快速下载。
- 结果默认保留 72 小时；过期返回 410。
- Node/Python 进程均未重启（本轮未启动 8080 常驻服务）。

## Pending

- 是否提交/推送本轮与上一轮改动待确认；提交前跑 `scripts/local/pre-push-check.sh --full`。
- 生产需先应用 `server/purchase-reconciliation/migrations/001_purchase_reconciliation.sql`，再重启 Node。
- 生产真实登录、上传、下载与并发/大文件验证未执行。

## Next Action

1. 检查 diff，确认是否提交（含序时账与 FIFO 两块）。
2. 如上线：先应用两个 migration，再重启 Node；用真实登录做一次 FIFO 全链路冒烟。
3. 保留回滚路径（删除新表与 storage 目录、回退 Node 版本）。

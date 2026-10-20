# 采购与退货对抵 — Web Integration

原生集成（非独立项目嵌入式）。页面在 Liuxian Lab 现有 App Shell 内，使用项目既有
Layout、Card、Table、Upload、Tabs、Drawer、Toast 与设计 token；FIFO 参考项目只提供
采购/退货业务算法参考，UI 与路由均为本项目原生实现。

## Flow

1. `POST /api/purchase-reconciliations` 上传 `.xlsx` / `.xlsm` 到
   `storage/purchase-reconciliation/<uuid>/source.*`，创建 `draft` 行。
2. 上传后同步执行 Python inspection（OOXML 流式读取），返回工作表、表头行、
   数据行数、字段映射、缺失字段、3 行样本。
3. 用户在页面确认工作表 / 表头行；`POST .../:id/inspect` 可重新识别。
4. `POST .../:id/start` 再次校验表头与必要字段，写入 `request.json`，置为 `queued`
   并进入 Node 进程内队列。
5. Node runner `claim` 行后 spawn `python -m services.purchase_reconciliation.worker`。
6. Worker：流式读取 → 标准化 → FIFO → 写 `summary.json` / `segments.ndjson` /
   `matched.ndjson` / `remaining.ndjson` → 写 CSV ZIP → `status=completed` →
   继续生成 XLSX → `xlsx=ready|error`。
7. 页面轮询 `GET .../:id`；汇总与分页表格按需读取 NDJSON，不把 30,000+ 行
   一次性返回浏览器。
8. 下载：CSV ZIP 立即可用；XLSX 生成完成后按钮才可用。

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/purchase-reconciliations/meta` | 文件限制、字段 schema、默认匹配键、分页上限 |
| `POST` | `/api/purchase-reconciliations` | 上传 → draft + inspection |
| `GET` | `/api/purchase-reconciliations` | 当前用户历史任务（最多 50） |
| `POST` | `/api/purchase-reconciliations/:id/inspect` | 重新识别 sheet / header |
| `POST` | `/api/purchase-reconciliations/:id/start` | 校验字段并入队 |
| `GET` | `/api/purchase-reconciliations/:id` | 状态 / 进度 / XLSX 状态 |
| `GET` | `/api/purchase-reconciliations/:id/summary` | Dashboard 汇总 |
| `GET` | `/api/purchase-reconciliations/:id/matches` | FIFO 配对段（分页） |
| `GET` | `/api/purchase-reconciliations/:id/matches/:matchId` | 配对段 + 正负原始记录 |
| `GET` | `/api/purchase-reconciliations/:id/matched` | 已对抵原始记录（分页） |
| `GET` | `/api/purchase-reconciliations/:id/remaining` | 剩余数据（分页，`unmatched=1` 过滤负向剩余） |
| `GET` | `/api/purchase-reconciliations/:id/download?format=xlsx\|zip` | 下载 |
| `DELETE` | `/api/purchase-reconciliations/:id` | 删除非运行中任务与文件 |

所有路由在 `server.js` 挂载时经过 `requireAuth` + `sameOriginForStateChange`；
resolver 内再次校验 owner，跨用户返回 404。文件路径来自数据库且限制在
`storage/purchase-reconciliation/` 下，原始文件名只用于下载展示，不作为磁盘路径。

## Business rules

- 方向只由数量符号决定：`>0` 正向，`<0` 负向，`=0` 不参与。
- 默认匹配键：供应商 + 采购订单 + 采购订单项目 + 物料编码 + 订单单位 + 单价 + 每。
- 同一业务键内按 `送货日期 ASC, 原始行号 ASC` 双指针 FIFO。
- 剩余数量与金额见 `services/purchase_reconciliation/engine.py`；金额按原金额同比例分摊，
  不使用 binary float。
- MATCH ID 按业务键首次出现顺序与 FIFO 段顺序生成，重复运行稳定。

## Files

```text
server/purchase-reconciliation/
├── routes.js
├── repository.js
├── job-factory.js
├── inspection-runner.js
├── worker-runner.js
├── result-store.js
├── schema.js
└── migrations/001_purchase_reconciliation.sql

services/purchase_reconciliation/
├── schema.py
├── column_mapper.py
├── excel_reader.py
├── engine.py
├── exporters.py
├── inspection.py
├── job_io.py
└── worker.py

private/tools/purchase-reconciliation/
├── index.html
├── styles.css
└── script.js
```

## Migration

Manual, not auto-applied:

```bash
psql "$DATABASE_URL" -f server/purchase-reconciliation/migrations/001_purchase_reconciliation.sql
```

## Environment

Optional: `PURCHASE_RECONCILIATION_PYTHON_BIN`、`PURCHASE_RECONCILIATION_TIMEOUT_MS`、
`PURCHASE_RECONCILIATION_INSPECTION_TIMEOUT_MS`、`PURCHASE_RECONCILIATION_MAX_CONCURRENT`、
`PURCHASE_RECONCILIATION_RETENTION_HOURS` (default 72).

## Regression

Real SAP export (34,297 rows) is **not committed**. Run:

```bash
PURCHASE_RECONCILIATION_FIXTURE="/path/to/sap-export.xlsx" \
  .venv/bin/python -m unittest services.purchase_reconciliation.tests.test_regression -v
```

Expected: 634 segments, 948 matched records, 33,501 remaining, matched amount
14,913,418.90, final net 570,865,672.91, conservation difference 0.00.

## Known limits

- Only OOXML `.xlsx` / `.xlsm`; legacy `.xls` is not parsed.
- V1 UI fixes the default match key and FIFO; engine config is ready for future options.
- XLSX uses write-only openpyxl (no native Excel chart); CSV ZIP is the fast download.
- Result retention defaults to 72h; expired files return 410.

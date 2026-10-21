# Liuxian Lab

Liuxian Lab 是一个需要登录才能访问的私有工具工作台。当前架构采用 Node.js + Express 负责服务端认证与页面分发，主界面集中展示工具入口，每个工具在独立目录中开发。

## 本地运行

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:8080`，健康检查：`GET /health`。

## 账号管理

账号由管理员在终端创建，不提供公开注册。

```bash
npm run user:create -- liuxian
npm run user:list
```

## 工具配置

工具卡片集中在：

```text
config/tools.json
```

新增仅展示的工具只需先加配置；实现后访问 `/tools/<slug>` 会加载真实页面，否则展示统一“开发中”占位页。

## 开发一个新工具

工具位于 `private/tools/<slug>/`，典型结构：

```text
private/tools/<slug>/
├── index.html
├── styles.css   (或 tool.css)
└── script.js    (或 tool.js)
```

`server.js` 会自动检测 `private/tools/<slug>/index.html`。可复制 `private/tools/_template/` 作为起点。

## 已实现工具

- `excel-standardizer` — Excel 标准化（Node 路由 + Python worker：`server/excel-standardizer/`、`services/excel_standardizer/`）
- `sales-income-analysis` — 销售收入分析（`server/sales-income/`、`workers/excel/sales_income/`）
- `contract-review` — 合同数字化审阅（Node 路由 + PostgreSQL + Python worker：`server/contracts/`、`services/contract_review/`、迁移在 `server/contracts/migrations/`）
- `excel-review` — Excel 复核意见（逻辑在 `services/excel_review/`、`server/excel-review/`）
- `journal-entry-analysis` — 序时账分析（Node 路由 + PostgreSQL + Python worker：`server/journal-entry/`、`services/journal_entry/`，迁移在 `server/journal-entry/migrations/`）
- `purchase-reconciliation` — 采购与退货对抵（Node 路由 + PostgreSQL + Python worker：`server/purchase-reconciliation/`、`services/purchase_reconciliation/`，迁移在 `server/purchase-reconciliation/migrations/`）
- `equity-structure` — 股权结构图识别（Node 路由 + PostgreSQL + 独立 PaddleOCR 环境：`server/equity-structure/`、`services/equity_structure/`，迁移在 `server/equity-structure/migrations/`）
- `excel-decimal-check` — Excel 小数检查（纯浏览器本地处理，`private/tools/excel-decimal-check/`）
- `flowchart-excel` — **ARCHIVED / Coming Soon**：外部 AI 辅助文件导入与人工复核工作台；当前暂停开发，不再开放新任务或正式 XLSX 导出（`server/flowchart-excel/`、`services/flowchart_excel/`、`private/tools/flowchart-excel/`）。封存档案：`docs/agent/flowchart-excel/archive/PROJECT-ARCHIVED.md`
- `flowchart-excel` Slice 5（历史）— 模板 profile JSON 与原生 Open XML 导出 POC（`docs/agent/flowchart-excel/trade-purchase-template-profile.json`、`/Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc`）；正式导出 gate 仍关闭
- `flowchart-excel` Slice 5.1（历史）— 63 节点/58 连线 A/B anchor 验收：Mac A/B PASS；Windows NOT RUN；视觉 QA FAIL；`edit_as=pending`、`exportReady=false`（`docs/agent/flowchart-excel/slice5-1-anchor-validation-report.md`）
- `flowchart-excel` Slice 5.2（历史）— 视觉修复候选：独立布局计划、标题/节点碰撞改善；仍有 13 条文本溢出与 61 条近似连线穿越；视觉 QA FAIL，正式导出关闭（`docs/agent/flowchart-excel/slice5-2-visual-fix-report.md`）
- `flowchart-excel` Slice 5.3（历史）— 画布占用/可读性 v2：内容占比约 73%×87%，文本溢出 0；仍有 23 条近似连线穿越、泳道/图例/控制标记未达目标样式；视觉 QA FAIL，正式导出关闭（`docs/agent/flowchart-excel/slice5-3-visual-fix-v2-report.md`）
- `flowchart-excel` Slice 5.4（历史）— V3 图 rank 布局：节点碰撞 0、文本溢出 0；仍有 39 条近似连线穿越，控制标记/图例/泳道未达目标样式；视觉 QA FAIL，正式导出关闭（`docs/agent/flowchart-excel/slice5-4-visual-layout-report.md`）

## 断点续连（Checkpoint / Resume）

- `PROJECT_STATUS.md` 是当前状态的持久快照，用于跨会话恢复上下文。
- `/checkpoint`：更新快照，不 commit、不 push、不部署。
- `/resume`（别名 `/recover`）：读取 `AGENTS.md`、`PROJECT_STATUS.md` 与 Git 状态后恢复上下文。

## 目录

```text
liuxianlab-online/
├── server.js                 # Express 入口
├── server/                   # 各工具的 Node 路由与持久化
│   ├── contracts/            #   合同审阅（PostgreSQL + PDF 解析）
│   ├── excel-standardizer/   #   Excel 标准化
│   ├── excel-review/         #   Excel 批注整理
│   ├── journal-entry/        #   序时账分析（PostgreSQL）
│   ├── purchase-reconciliation/ #   采购与退货对抵（PostgreSQL）
│   ├── equity-structure/     #   股权结构图识别（PostgreSQL + PaddleOCR）
│   └── sales-income/         #   销售收入分析
├── services/                 # Python 服务 / worker
│   ├── contract_review/      #   合同审阅
│   ├── excel_review/         #   Excel 批注整理
│   ├── journal_entry/        #   序时账分析
│   ├── purchase_reconciliation/ #   采购与退货对抵
│   ├── equity_structure/     #   股权结构图识别（PaddleOCR/OpenCV）
│   └── excel_standardizer/   #   Excel 标准化
├── workers/excel/            # 销售分析 Python worker（sales_income/）
├── private/                  # 需登录的工作台与工具页面
│   ├── index.html            #   工作台
│   └── tools/<slug>/         #   各工具
├── public/                   # 登录页
├── config/                   # tools.json、Excel 配置
├── scripts/                  # 本地辅助脚本
├── AGENTS.md                 # 面向 AI agent 的开发规范
├── PROJECT_STATUS.md         # 断点续连状态快照
├── .opencode/                # opencode agents / commands
└── .env.example              # 环境变量样例（真实 .env 勿提交）
```

## 部署方向

正式上线：Nginx + HTTPS → Node.js 绑定 `127.0.0.1:8080`（进程由 PM2 经 `ecosystem.config.js` 管理），公网只开放 80/443，Node 端口不直接暴露。

不要提交 `.env`、`data/users.json`、`sessions/` 会话文件或 `storage/` 运行期数据。

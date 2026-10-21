# Phase 1 实施计划：数据契约、适配器与网站集成

状态：Slice 1 已实施；其余切片仍为设计稿（见 `phase1-slice1-validation-report.md`）。
目标：把“图片 → 辅助文件 → 人工复核 → Excel 原生导出”接入现有 Liuxian Lab，但**第一步只做契约与旧文件适配**。
依据：真实仓库 `server.js`、`config/tools.json`、`server/equity-structure/*`、`server/excel-review/*`、`services/excel_review/ooxml_package.py`、Phase 0 POC。

---

## 1. 设计原则

1. 不重写现有网站；新增模块按现有 Router/worker/storage 模式接入。
2. Node/Express 仍是认证、上传、权限、任务状态和下载边界。
3. Python 负责多模态理解，不直接对浏览器暴露。
4. .NET/Open XML SDK 负责 XLSX DrawingML，不参与 AI。
5. React/TS/Vite/X6 只用于新工具，不迁移旧页面。
6. 所有跨服务数据必须经过统一 schema + 应用层交叉校验。
7. 先做最小切片，不在第一阶段引入数据库迁移、AI 调用或浏览器 UI。
8. 任何 DrawingML 结果都必须经过真实 Excel 拖动/保存/重开验收。

---

## 2. 目标模块与真实文件路径

### 2.1 本次已创建（设计/契约）

```text
docs/agent/flowchart-excel/
├── flowchart-data-contract.md
├── flowchart.schema.json
├── legacy-helper-files-adapter.md
├── architecture-decision-record.md
├── phase1-implementation-plan.md
└── phase0-phase1-readiness-report.md
```

### 2.2 Phase 1 第一切片（建议新增）

```text
server/flowchart-excel/contract/
├── validate-flowchart.js          # Ajv 2020-12 + 应用层交叉校验
├── adapt-legacy-helper.js         # 旧辅助文件 -> 新契约
└── legacy-adapter-version.js      # adapter 版本常量

scripts/local/
└── check-flowchart-contract.js    # CLI: 校验/适配/输出 adaptation-report

tests/flowchart-contract/
├── schema.test.js                 # schema 编译、合法/非法样例
├── adapter.test.js                # 旧字段映射、端口策略、未知字段保留
├── cross-reference.test.js        # 悬空边、lane 引用、ID 唯一
└── fixtures/
    └── legacy-helper-minimal.json # 合成数据，不含客户业务内容
```

第一切片**不修改**：

```text
server.js
config/tools.json
private/
数据库
现有 Python worker
现有 .NET POC
```

第一切片唯一可能新增的依赖：Node devDependency `ajv@8.x`（用于真正执行 Draft 2020-12 校验）。当前任务不安装；实施时再锁定版本。

### 2.3 Phase 1 后续切片（仅设计）

```text
server/flowchart-excel/
├── routes.js
├── repository.js
├── job-factory.js
├── worker-runner.js
└── migrations/001_flowchart_jobs.sql

services/flowchart_ai/
├── worker.py
├── stage1_extract.py
├── stage2_reconcile.py
└── requirements.txt

tools/flowchart-excel-exporter-poc/     # 演进为生产导出器/服务
docs/agent/flowchart-excel/*

private/tools/flowchart-excel/          # 后续 React build 输出
```

前端源码建议单独放：

```text
frontend/flowchart-excel/                # React + TS + Vite + X6
```

构建产物输出到 `private/tools/flowchart-excel/`，由现有 `/app` 认证静态路由提供。**不得**把源码和 build 产物混在一起。

---

## 3. API 设计

所有 API 都必须挂载 `requireAuth`；状态变更必须加 `sameOriginForStateChange`。

### 3.1 任务

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/api/flowchart-jobs` | 上传图片，创建 `draft` 任务 |
| `GET` | `/api/flowchart-jobs` | 当前用户历史 |
| `GET` | `/api/flowchart-jobs/:id` | 状态/进度/错误 |
| `POST` | `/api/flowchart-jobs/:id/extract` | 入队阶段一视觉提取 |
| `POST` | `/api/flowchart-jobs/:id/reconcile` | 入队阶段二联合核验 |
| `GET` | `/api/flowchart-jobs/:id/graph` | 当前契约 JSON |
| `PUT` | `/api/flowchart-jobs/:id/graph` | 保存人工修订（需 schema + 权限） |
| `POST` | `/api/flowchart-jobs/:id/approve` | 确认最终图结构 |
| `POST` | `/api/flowchart-jobs/:id/export-xlsx` | 入队导出 |
| `GET` | `/api/flowchart-jobs/:id/download` | 下载 XLSX |
| `GET` | `/api/flowchart-jobs/:id/artifacts` | 辅助文件列表 |
| `GET` | `/api/flowchart-jobs/:id/artifacts/:name` | 辅助文件下载 |
| `DELETE` | `/api/flowchart-jobs/:id` | 软删除/清理（非运行中） |

约束：

- owner 从 session 取，不能由客户端传 owner。
- 路径只使用服务端生成的 UUID。
- 下载前检查 owner、status、文件存在和路径位于 storage 根目录。
- 错误统一 `{ ok:false, code, message }`。
- 不在响应中返回绝对服务器路径、密钥、模型原始响应。

### 3.2 状态机

```text
draft
  -> queued
  -> extracting
  -> helpers_ready
  -> reconciling
  -> review_required
  -> approved
  -> exporting
  -> completed

failed
cancelled
```

允许的例外：

- `failed` 可重试回 `queued`（同一任务，受最大尝试次数限制）。
- `review_required` 可重新 `reconcile`，但必须保留旧版本。
- `approved` 后如需修改，创建新 revision，回到 `review_required`。
- `cancelled` 只允许在 queued 或安全中断点；运行中的 Python 任务通过取消标记 + 进程终止处理。

---

## 4. 文件存储与用户隔离

建议目录：

```text
storage/flowchart-excel/<job-uuid>/
├── source.png
├── meta.json
├── status.json
├── stage1/
│   ├── flowchart.json
│   ├── nodes.csv
│   ├── edges.csv
│   ├── style.json
│   ├── conversion_report.md
│   ├── review_overlay.png
│   └── auxiliary-files.zip
├── contract/
│   ├── graph.draft.json
│   ├── graph.reconciled.json
│   └── graph.final.json
├── reviews/
│   └── revision-0001.json
├── exports/
│   ├── export-request.json
│   ├── export-report.json
│   └── flowchart.xlsx
├── worker.log
└── status.json
```

规则：

- 目录权限 0700；文件 0600。
- 只通过服务端 UUID + owner 查询定位；不接受客户端路径。
- 上传先写临时文件，校验 MIME/扩展名/魔数/尺寸后再原子移动。
- 原图、辅助文件、最终 JSON、XLSX 均按同一任务隔离。
- 默认保留期可配置（例如 7 天/168 小时）；定时清理过期任务。
- 删除采用软删除 + 文件清理；运行中禁止删除。
- 不把原图/模型响应/客户内容写入普通日志；worker 日志也必须受控并可清理。

上传限制建议（可调）：

```text
图片：PNG/JPG/JPEG/WebP
单文件：≤ 100MB
像素：由后端解码后限制（例如 ≤ 2.2 亿像素）
MIME + 扩展名 + 魔数三重校验
```

与现有 `server/equity-structure/job-factory.js` 的模式一致：先 `imageKind()` 检查魔数，再创建 UUID 目录并写 `meta.json`。

---

## 5. 数据库设计（后续切片，不在本次执行迁移）

现有项目已有 PostgreSQL 任务表模式，可参考 `equity_structure_jobs`：

```sql
CREATE TABLE flowchart_jobs (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    source_ext TEXT NOT NULL,
    mime_type TEXT,
    file_size BIGINT,
    image_width INTEGER,
    image_height INTEGER,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft','queued','extracting','helpers_ready',
            'reconciling','review_required','approved',
            'exporting','completed','failed','cancelled'
        )),
    progress SMALLINT NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100),
    progress_message TEXT,
    source_path TEXT,
    source_sha256 TEXT,
    helper_dir TEXT,
    graph_draft JSONB,
    graph_reconciled JSONB,
    graph_final JSONB,
    reconciliation JSONB,
    export_path TEXT,
    export_report JSONB,
    error_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

索引：

```sql
CREATE INDEX ... ON flowchart_jobs (owner_username, created_at DESC);
CREATE INDEX ... ON flowchart_jobs (status, created_at);
CREATE INDEX ... ON flowchart_jobs (owner_username, source_sha256);
```

版本表（Phase 1 后段）：

```sql
CREATE TABLE flowchart_job_revisions (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES flowchart_jobs(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    graph_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, revision_number)
);
```

约束：

- 迁移采用 additive `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`。
- 不在第一切片执行迁移。
- 任务表不存原图二进制；文件在受控目录。
- 不把模型密钥或完整模型响应存数据库。

---

## 6. Python AI worker

### 6.1 环境

- Python **3.12+**，独立 venv，例如项目根 `.flowchart-venv`（gitignored）。
- 通过 `FLOWCHART_AI_PYTHON_BIN` 或默认 `.flowchart-venv/bin/python` 定位。
- 不在现有 `.venv`（Python 3.9）中混装。
- 安装脚本建议：`scripts/local/setup-flowchart-ai.sh`（后续）。
- 依赖建议：`requests`、`Pillow`，以及模型 SDK 仅在需要时添加；不要引入大型本地模型除非明确要求。

### 6.2 阶段一

```text
python -m services.flowchart_ai.worker --job-dir <dir> --stage extract
```

输入：`source.*`、`meta.json`
输出：`stage1/flowchart.json`、CSV、style、report、overlay、ZIP
同时写 `status.json`（原子写入），字段：

```json
{
  "status": "extracting|helpers_ready|failed",
  "progress": 0,
  "message": "...",
  "error": null
}
```

### 6.3 阶段二

```text
python -m services.flowchart_ai.worker --job-dir <dir> --stage reconcile
```

输入：原图 + 阶段一文件 + 当前 contract JSON
输出：`graph.reconciled.json`、`reconciliation.json`、`status.json`
不得覆盖人工 revision；只产生变更列表。

### 6.4 Node runner 模式

复用 `server/equity-structure/worker-runner.js` 的模式：

- 进程内队列（`maxConcurrent` 可配置）。
- `spawn` Python，`cwd=root`，stdout/stderr 写 `worker.log`（0600）。
- 轮询 `status.json`（500–700ms），同步 DB 状态/进度。
- 超时（阶段一/二建议 15 分钟，可配置）→ SIGTERM，再 SIGKILL。
- 启动恢复：`queued` 重新入队；`running` 标记 `failed`（或按 interrupt 恢复策略）。
- 清理：TTL 到期删除任务目录 + DB 记录（软删除/硬删除按产品规则）。
- 失败消息截断（≤500/800 字符），不把密钥/客户内容写入 error。

---

## 7. Node ↔ .NET 导出器协议

### 7.1 第一版：进程调用

```text
Node 写:
  storage/flowchart-excel/<job>/exports/export-request.json
  storage/flowchart-excel/<job>/contract/graph.final.json

执行:
  dotnet FlowchartExcelExporter.dll \
    --input export-request.json \
    --output exports/flowchart.xlsx \
    --report exports/export-report.json

返回:
  exit code 0/非0
  export-report.json（结构校验、validator、shape/connector 映射）
```

优点：无端口、无网络暴露、易于超时和隔离。
缺点：每次启动进程有冷启动成本；可在后续改为常驻内部服务。

### 7.2 后续：内部服务

如果需要常驻：

- 只绑定 `127.0.0.1` 或 Unix socket。
- Node 使用短期内部 token + 请求签名。
- 不把 .NET 服务暴露到公网。
- 请求体只含 JSON 路径/内容，不接受客户端任意路径。
- 健康检查、超时、并发限制、临时文件清理必须实现。

### 7.3 导出请求

```json
{
  "schema_version": "1.0.0",
  "job_id": "...",
  "graph_path": "contract/graph.final.json",
  "output_path": "exports/flowchart.xlsx",
  "template_profile_id": "trade_purchase_cn",
  "template_profile_version": "1.0.0",
  "anchor_mode": "twoCellAnchor",
  "edit_as": "pending",
  "require_windows_acceptance": false
}
```

### 7.4 导出报告

至少：

```text
shape_count, connector_count, shape_mapping,
connector_binding (stCxn/endCxn),
drawing_part, worksheet_drawing_rel, content_types,
validator_errors, merged_lane_ranges,
warnings, gate_status
```

---

## 8. 错误处理、幂等、重试、超时、取消

### 幂等

- 上传：`owner + source_sha256` 命中已完成任务可复用；未完成不自动复用，避免串任务。
- `extract`：同 job 已在 `queued/extracting` 时返回当前状态，不重复入队。
- `reconcile`：同版本已在处理时返回 409；新版本才允许新任务。
- `export`：以 `job_id + graph revision + exporter version` 作为幂等键；相同输入复用已有 XLSX。
- 下载：只读，无副作用。

### 重试

- 只允许 `failed` 的显式重试；每次 `attempt_count++`。
- 最大尝试次数可配置（例如 3）。
- 不自动无限重试模型调用；避免重复计费。
- 重试保留旧错误和旧输出，不覆盖人工 revision。

### 超时

| 阶段 | 建议 |
|---|---|
| 上传 | 30s |
| 阶段一 | 15 min |
| 阶段二 | 15 min |
| Excel 导出 | 5 min |
| 下载 | 普通 HTTP 超时 |

### 取消

- `queued`：直接从队列移除，状态 `cancelled`。
- `extracting/reconciling`：写取消标记；runner 终止子进程；状态 `cancelled`。
- `exporting`：终止 .NET 进程；删除未完成输出；状态 `cancelled`。
- 已完成/已批准任务不提供“取消”，只能删除/新版本。

---

## 9. 安全与隐私

- 模型 API Key 只在服务端秘密管理；浏览器永远不接触。
- 用户必须确认图片是否允许发送到云端模型端点。
- 客户制度/审计资料优先使用获批的本地模型或授权云端。
- 不接受客户端传入 storage 路径；全部由服务端 UUID 派生。
- 上传校验 MIME + 扩展名 + 魔数 + 大小 + 像素。
- 不把原图、完整模型响应、客户文本写入普通应用日志。
- worker.log 受控 0600，按保留期清理。
- 下载必须 owner 校验；短期签名可选。
- .NET/Python 内部服务不得公网暴露。
- 模型输出视为不可信：schema + 交叉校验 + 人工复核。
- 不把密钥、session、storage、日志写入 ZIP/报告。

---

## 10. 测试策略

### 第一切片（契约/adapter）

- Schema 编译（Ajv 2020-12）。
- 合法最小文档通过。
- 非法版本/缺字段/非法枚举被拒绝。
- 旧辅助文件 adapter：字段映射、bbox 归一化、端口推断/null、review_status、provenance、未知字段保留。
- 交叉校验：lane_id、source/target、ID 唯一、悬空边、bbox 越界。
- 适配报告：节点/边数量守恒、无静默修复。
- `node --test tests/flowchart-contract/*.test.js`
- `node scripts/local/check-flowchart-contract.js ...`

### 后续切片

- Node API 路由测试（stub repository/worker），owner 隔离，401/403/404/409/410。
- Python worker 单元测试（mock 模型响应，不调用真实模型）。
- 阶段二 diff 不静默覆盖人工修改。
- .NET 导出器结构测试 + Open XML SDK validator + Excel 手动验收。
- 现有 `npm test` 基线不得回退。
- 真实 Excel：Mac 已通过；Windows 用户确认已验收但详细证据待补录。

---

## 11. 回滚方案

- 新工具卡片初始 `status: "beta"` 或仅管理员可见；不替换旧工具。
- 新 API 独立 mount；出问题移除 mount/卡片即可，不影响旧工具。
- DB 迁移仅 additive；回滚保留表但停止写入（不 drop）。
- 文件目录按 job UUID 隔离；可整体清理。
- Python/.NET 进程独立；停用不阻塞网站。
- 前端 build 独立目录；可回退到占位页。
- 不修改 `server.js` 认证/静态/错误处理核心逻辑，只增加 mount。
- 每个切片单独提交/测试，便于 revert。

---

## 12. 实施顺序与验收

### Slice 0（本次）

- 文档、schema、adapter 设计、ADR、Phase 0 summary。
- 不写业务代码、不迁移 DB、不安装依赖。
- 验收：文档路径存在、schema 可编译、无现有文件覆盖。

### Slice 1（Phase 1 第一小切片）

- 新增 schema validator + legacy adapter + tests + CLI。
- 使用合成旧辅助文件样例。
- 不改 `server.js` / `config/tools.json` / 页面 / DB。
- 验收：

```bash
node --test tests/flowchart-contract/*.test.js
node scripts/local/check-flowchart-contract.js \
  --schema docs/agent/flowchart-excel/flowchart.schema.json \
  --input tests/flowchart-contract/fixtures/legacy-helper-minimal.json \
  --out-dir /tmp/flowchart-contract-check
```

必须：

- schema 编译通过；
- 合法样例通过；
- 非法样例被拒绝；
- adapter 输出通过 schema；
- 交叉引用全部有效或进入 unresolved；
- 节点/边数量守恒；
- 未知字段保留；
- 不生成 XLSX、不调用模型、不写 DB。

### Slice 2

- Node `server/flowchart-excel` skeleton + API + repository + storage + task runner。
- 仅用 fake/stub worker；不接真实 AI。

### Slice 3

- Python stage1 worker。
- 阶段一辅助文件 + contract draft。
- 不接前端审查工作台。

### Slice 4

- Stage2 reconciliation + diff + review model。
- 人工修订 API + revisions。

### Slice 5

- React/TS/Vite/X6 复核工作台（只用于新工具）。
- 上传、进度、辅助文件预览、低置信度筛选、编辑与保存。

### Slice 6

- .NET 导出器接入；生成 XLSX；Mac/Windows Excel 验收。

### Slice 7

- 生产化：队列、限流、日志、保留、备份、部署、监控。

---

## 13. Phase 1 第一小切片的 OpenCode 执行任务（未来执行）

```text
只实现 Slice 1：
1. 读取 docs/agent/flowchart-excel/flowchart.schema.json。
2. 在 server/flowchart-excel/contract/ 实现 validate-flowchart.js：
   - Ajv 2020-12 编译 schema；
   - 应用层交叉引用检查；
   - 返回结构化 errors。
3. 实现 adapt-legacy-helper.js：
   - 按 legacy-helper-files-adapter.md 映射；
   - 保留未知字段；
   - 端口推断/null + unresolved；
   - 生成 adaptation-report。
4. 添加 tests/flowchart-contract/*.test.js 和合成 fixtures。
5. 添加 scripts/local/check-flowchart-contract.js。
6. 不修改 server.js、config/tools.json、private/、数据库、Python worker、.NET POC。
7. 运行：
   node --test tests/flowchart-contract/*.test.js
   node scripts/local/check-flowchart-contract.js ...
8. 输出实际测试结果；不生成 XLSX，不调用模型。
```

---

## 14. 验收标准

第一小切片通过必须满足：

```text
[ ] schema 可被 Ajv 2020-12 编译
[ ] 合法最小文档通过
[ ] 非法 schema_version / 缺字段 / 非法枚举被拒绝
[ ] adapter 输出通过 schema
[ ] lane_id / source / target 交叉校验通过或有 unresolved
[ ] 节点/边数量与输入一致
[ ] 未知字段保留
[ ] 缺端口不伪造；要么推断并标记，要么 null + unresolved
[ ] review_status 缺失时 pending
[ ] provenance 缺失时 image_extraction + legacy metadata
[ ] adaptation-report 可审计
[ ] 现有网站测试不受影响
[ ] 不生成 XLSX、不调用 AI、不新增 DB 迁移
```

---

## 15. 当前不做

- 不实现网页、上传 API、任务表、Python AI worker、.NET 服务接入。
- 不修改 `server.js`、`config/tools.json`、现有页面。
- 不安装任何依赖。
- 不处理客户图片/PDF。
- 不生成最终 XLSX。

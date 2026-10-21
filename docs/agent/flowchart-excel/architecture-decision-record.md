# Architecture Decision Record：Flowchart Excel 工作台

状态：Accepted for planning（Phase 1 Slice 1 已实施；其余未实施）
日期：2026-10-20
相关：`phase1-implementation-plan.md`、`flowchart-data-contract.md`、POC `reports/phase0-final-summary.md`

---

## ADR-001：保留 Node/Express 作为认证与 API 边界

### 决策

现有 `liuxianlab-online` 的 Node/Express、session、`requireAuth`、`sameOriginForStateChange`、工具注册和静态 `/app` 路由继续作为唯一浏览器入口。

新增流程图功能通过：

```text
server/flowchart-excel/routes.js
app.use('/api/flowchart-jobs', requireAuth, sameOriginForStateChange, ...)
```

接入，不重写现有网站。

### 理由

- 项目已有成熟登录、权限、会话、限流、Helmet/CSP、错误处理。
- 所有工具都遵循 `config/tools.json` + `private/tools/<slug>/` + `server/<module>/` 模式。
- 浏览器不应直接持有模型密钥或调用内部 Python/.NET 服务。
- 任务状态、owner 隔离、下载路径都必须在 Node 边界校验。

### 不采用

- 新建独立 Web 应用：会重复认证/部署/审计。
- 浏览器直连 AI 或 .NET：会泄露密钥/扩大攻击面。

### 后果

- 需要新增 Router、repository、job runner，但复用现有安全模型。
- `server.js` 只增加 mount，不改认证核心。
- 需要保持现有 dirty 状态，不覆盖用户修改。

---

## ADR-002：Python 3.12+ 负责 AI 图像理解

### 决策

阶段一视觉提取、阶段二图片+辅助文件联合核验由独立 Python worker 负责，运行在项目专用 `.flowchart-venv`（Python 3.12+），由 Node spawn 调用。

### 理由

- Python 多模态生态成熟，适配云端/本地 OpenAI-compatible 端点更容易。
- 现有网站已有 Python worker 模式（Excel/Equity/Contract），可复用进程管理、status.json、超时和清理。
- AI 逻辑与 Node API 解耦，便于替换模型端点。

### 不采用

- 在 Node 内直接调用模型：依赖/流式/图像处理能力弱。
- 把 AI 塞进 .NET 导出服务：职责混乱。

### 后果

- 需要独立 venv 和安装脚本；不得混用现有 Python 3.9 `.venv`。
- 必须处理模型 API Key、图片外发授权、超时、重试成本。
- 阶段一/阶段二输出必须是契约 JSON，不直接生成 XLSX。

---

## ADR-003：.NET 10 LTS + Open XML SDK 负责 XLSX DrawingML

### 决策

Excel 导出服务独立使用 .NET 10 LTS + DocumentFormat.OpenXml 3.5.1，负责：

- XLSX 包、工作表、合并单元格；
- `xdr:sp` 原生形状；
- `xdr:cxnSp` 原生连接器；
- `a:stCxn` / `a:endCxn`；
- `twoCellAnchor` / `editAs`；
- 导出前结构校验。

### 理由

- Open XML SDK 对 OOXML 有强类型对象模型，适合构造 DrawingML 和关系。
- Phase 0 已用该路线生成并通过 Mac Excel 实测；结构测试 11/11、SDK validator 0 errors。
- Python `openpyxl` 只适合单元格/样式，且 round-trip 会删除 drawing part；实测不可用于最终注入后保存。

### 不采用

- Python `openpyxl` 生成图形/连接器：无可靠工作表 shape API，保存会丢 drawing。
- 手写字符串拼整个 XLSX：难以维护、验证弱。
- 图片/多段线伪装：不满足产品要求。

### 后果

- 需要独立 .NET 服务/进程、版本锁定、部署和 Excel 验收。
- 必须保留 `global.json`、NuGet 包版本和导出报告。
- 仍必须在真实 Excel 中测试；SDK validator 通过不等于拖动行为通过。

---

## ADR-004：React + TypeScript + Vite + AntV X6 只用于新工具

### 决策

后续复核工作台使用 React + TS + Vite + AntV X6，放在新目录：

```text
frontend/flowchart-excel/       # 源码
private/tools/flowchart-excel/  # build 输出
```

不迁移现有 Vanilla 页面。

### 理由

- X6 提供节点/边/端口/连接/选择/缩放等交互能力，适合复核工作台。
- React/TS 提供组件化和类型安全。
- 现有网站工具仍为 Vanilla，项目明确要求未经批准不要引入 React；用户已批准仅用于新工具。

### 不采用

- 全站迁移 React：高风险、无收益。
- 继续纯手写 SVG 编辑器：可行但交互/撤销/端口/路由成本高。
- 让前端生成 XLSX：无法保证 DrawingML 与包关系。

### 后果

- 新增前端构建链、CSP/静态资源/构建产物管理。
- 需要独立 E2E 测试（Playwright 等，后续）。
- 现有页面不受影响。

---

## ADR-005：服务间调用采用受保护的本地进程/内部服务

### 决策

第一阶段：

```text
Node -> spawn Python worker（job-dir 协议）
Node -> spawn .NET exporter（JSON request/report）
```

后续如需常驻服务：

```text
Node -> 127.0.0.1 / Unix socket 内部 HTTP
+ 短期内部 token/签名
```

### 理由

- 进程调用无公网端口、易隔离、易超时/清理，符合当前单机部署。
- 现有 equity/excel-review worker 已验证 spawn + status.json 模式。
- .NET 冷启动可接受；后续再优化。

### 不采用

- 浏览器直连 Python/.NET。
- 无认证地把内部服务暴露公网。
- 引入消息队列（Redis/RabbitMQ）作为 MVP 前置条件。

### 后果

- Node 必须负责子进程生命周期、超时、日志、取消、重启恢复。
- 文件目录必须按 job UUID 隔离。
- 后续常驻服务需要健康检查、认证、并发限制。

---

## ADR-006：MVP 先使用现有进程内队列，不先上消息队列

### 决策

沿用 `server/equity-structure/worker-runner.js` / `server/excel-review/parse-runner.js` 模式：

- Node 进程内队列；
- `maxConcurrent` 可配置；
- `status.json` 轮询；
- DB 记录状态；
- 启动恢复 queued / 失败 running；
- TTL 清理。

只有在以下条件出现时才引入外部队列：

- 多实例部署；
- 任务量/等待时间显著上升；
- 需要跨进程可靠重试/优先级；
- 任务恢复要求超过当前 runner 能力。

### 理由

- 当前网站是单 Node 进程 + 小型 CPU 主机；Redis/队列会增加运维复杂度。
- 现有 worker 模式已经过 equity/excel-review 生产式验证（文档与测试）。
- 先解决产品链路，再优化吞吐。

### 后果

- Node 重启会中断运行中任务；需要恢复策略。
- 并发受单进程限制。
- 不能把“进程内队列”当成多实例可靠队列。

---

## ADR-007：版本锁定与环境隔离

### 决策

| 组件 | 版本/策略 |
|---|---|
| Node | 生产建议 Node 20/22 LTS；当前开发机 v25.9.0，未作为生产承诺 |
| Python AI | 3.12+，独立 `.flowchart-venv` |
| .NET | 10.0.402（`global.json` 固定，rollForward latestPatch） |
| Open XML SDK | DocumentFormat.OpenXml 3.5.1 |
| React/Vite/X6 | 后续选型后锁定精确版本与 lockfile |
| 数据库 | PostgreSQL，迁移 additive |

### 理由

- 现有项目已固定 `engines.node >= 20`，但开发机 Node 25 不代表生产。
- POC 已验证 .NET 10.0.402 + OpenXML 3.5.1。
- Python 3.9 不能运行现有辅助脚本的 3.10+ 语法，必须独立 3.12 venv。
- 版本不锁定会导致 Excel 行为/构建不可复现。

### 后果

- 新增 `scripts/local/setup-flowchart-ai.sh`（后续）。
- 生产部署需要安装 .NET runtime/SDK 或 self-contained publish。
- 需要记录实际版本到导出报告。

---

## ADR-008：twoCellAnchor family 作为目标锚点；editAs 仍待决策

### 决策

Phase 0 生产候选（anchor family）：

```text
xdr:twoCellAnchor
edit_as = "pending"（目标模板默认 twoCell；POC 验证 oneCell）
```

所有 shape 和 connector 统一使用 twoCellAnchor；不混用 absoluteAnchor。`edit_as` 必须在目标模板视觉与 POC 绑定可靠性之间做对照测试后显式决定。

### 已实测（macOS Excel 16.113.1）

- 3 个 `xdr:sp`、2 个 `xdr:cxnSp`；
- 2 条 connector 各有 `stCxn` / `endCxn`；
- 拖动、保存、关闭、重开仍绑定；
- 行高/列宽调整后节点随网格移动，尺寸不变（Phase 0 的 oneCell POC）；
- 泳道 `A5:B15` 仍合并（旧 POC；Trade purchase 模板另按 profile）；
- Open XML SDK validator 0 errors；
- 自动测试 11/11。

### 已知风险

1. **Windows 证据缺口**
   - 用户已确认“Windows 已验收”；
   - POC 中没有 Windows Excel 版本、步骤、逐项结果或文件哈希；
   - 因此只能记录为“用户报告已验收，详细证据待补录”，不能写成已确认的 Windows 事实。

2. **`a:xfrm` 与 marker**
   - 生成时两者一致；
   - Excel 调整行高/列宽后，marker 更新，`editAs="oneCell"` 的 `a:xfrm` 可能保留旧值；
   - 视觉位置以 marker 为准；
   - 重新导入必须解析 marker，不能只信 `a:xfrm`；
   - 若要求编辑后 `a:xfrm` 同步，需另测 `editAs="twoCell"`。

3. **尺寸不缩放**
   - `oneCell` 只移动，不随单元格缩放；
   - 若产品要求节点随泳道缩放，需评估 `twoCell`。

4. **复杂布局未验证**
   - 避障、交叉线、文字溢出、多泳道、判断分支未验证。

### 不采用

- 回到 absoluteAnchor：不随泳道单元格移动，不符合长期布局目标。
- 图片/多段线：明确禁止。
- 在没有证据时宣称 Windows 已通过全部细节。

### 后果

- Phase 1 可以基于 twoCellAnchor 设计导出器。
- 生产发布前必须补 Windows 证据和复杂布局测试。
- 导出器/重新导入器必须区分 anchor 类型和 marker。

---

## ADR-009：统一契约由 JSON Schema + 应用层校验共同保证

### 决策

- `flowchart.schema.json`（Draft 2020-12）负责结构/枚举/必填/数值范围。
- 应用层负责跨引用（lane/node/edge）、ID 唯一、端口最终 gate、unresolved 策略。
- 前端、Python、.NET 共用同一 `schema_version`。
- 不使用各自私有字段名。

### 理由

- JSON Schema 无法验证 `lane_id`/`source_node_id` 是否存在于另一个数组。
- 旧辅助文件需要 adapter，不能直接当最终契约。
- 跨服务字段漂移是最大集成风险。

### 后果

- 第一切片先实现 schema validator + adapter + cross-reference tests。
- 任何 schema 变更必须升版本并更新三端。
- 导出前必须执行应用层 gate。

---

## ADR-010：设计与归档阶段的实施边界（Slice 1 已实施，其余未实施）

### 决策

本次不修改：

```text
server.js
config/tools.json
private/
数据库
现有 Python worker
.NET POC 核心实现
```

不安装依赖，不调用模型，不生成新 XLSX。

### 理由

- 用户明确要求归档/审查/契约/计划。
- Phase 0 的 Windows 细节仍待补录。
- Phase 1 第一切片需要单独评审后再实施。

### 后果

- 当前交付是文档、schema、adapter 设计、Phase 0 summary。
- Phase 1 第一切片按 `phase1-implementation-plan.md` 执行。


---

## ADR-011：目标 Excel 模板是最高优先级视觉/结构规范

### 决策

最终 Excel 的版式、图形、颜色、字体、线条、阴影、图例、页面设置和锚点语义，以用户提供的：

```text
/Users/a123/Downloads/Trade purchase.CN.xlsx
```

为最高优先级。结构化样式规范位于：

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

### 理由

- 用户明确指定该文件为最终结果样式参考。
- 旧通用 style tokens 与目标模板存在冲突（颜色、行带/泳道、锚点 editAs、连接点 idx 0–5）。
- 如果不建立模板 profile，后续容易把旧 sales flowchart 或默认 POC 样式误当最终样式。

### 约束

- 业务语义仍来自客户图片/确认数据，不复制模板中的采购示例文字、教学图例或 “Remove before use”。
- 不复制模板中未绑定的连接器；最终每条逻辑边必须是新生成的、具有 `stCxn`/`endCxn` 的单个 `xdr:cxnSp`。
- 旧 `style.json` theme/excel_export_rules 只能进入 `extensions.legacy`，不能覆盖模板 profile。
- `style_overrides` 只允许 `source=user_explicit`，且不得覆盖硬性导出规则。
- 模板 profile 的机器可读 tokens 尚未建立；当前 Markdown profile 是规范来源，后续可抽取 JSON tokens。

### 后果

- Schema 增加 `template_profile_id/version/ref` 与受限的 `style_overrides`。
- Adapter 默认绑定 `trade_purchase_cn`。
- `edit_as=pending`：目标模板 default twoCell 与 POC oneCell 的差异必须在导出器阶段用实际 Excel 测试决定。
- `swimlane_background/legend=template_defined`：不强制旧合并单元格/单元格图例规则。

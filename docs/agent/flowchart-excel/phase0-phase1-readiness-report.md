# Phase 0 / Phase 1 Readiness Report

> 后续更新：Phase 1 Slice 1（schema validator + legacy adapter + reference validator + tests）已实施，结果见 `phase1-slice1-validation-report.md`。本报告其余部分保留实施前的设计与证据快照。

- 日期：2026-10-20
- 性质：归档、审查、契约设计、实施计划
- 明确声明：**本次没有实现网页、AI、数据库迁移或最终 XLSX 导出功能。**

---

## 1. 仓库与工作区状态

### 网站仓库

```text
路径：/Users/a123/AI-Workspace/projects/liuxianlab-online
branch：main
HEAD：ea3a3127881393f1eae1542419268b571a8e79f6
状态：dirty（执行前已存在）
未提交条目：执行前 21 项；新增 `docs/agent/flowchart-excel/` 后为 22 项（仅新增目录，未修改旧文件）
```

执行前已存在的 dirty 包括 `.env.example`、`AGENTS.md`、`server.js`、`package.json`、`config/tools.json`、equity-structure 等。本次：

- 未执行 `git reset`、`git clean`、`stash`；
- 未修改 `server.js`、`config/tools.json`、`private/`、数据库或现有业务 API；
- 仅新增 `docs/agent/flowchart-excel/` 下的设计/契约文档。

### POC

```text
路径：/Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc
Git：不是 Git 仓库
```

POC 文件保留；未覆盖 absoluteAnchor 基线；本次未修改 POC 核心导出实现，只新增 `reports/phase0-final-summary.md`。

### 服务

```text
GET http://127.0.0.1:8080/health -> {"ok":true}
```

未启动、重启或干扰 8080 服务。

---

## 2. 读取的关键文件

### 网站规则与架构

```text
AGENTS.md
PROJECT_INDEX.md
README.md
PROJECT_STATUS.md
docs/agent/architecture.md
docs/agent/tools.md
docs/agent/project-map.md
docs/agent/security.md
docs/agent/excel-review/workbook.md
docs/agent/excel-review/testing.md
docs/agent/equity-structure/overview.md
```

### 网站实现

```text
server.js
config/tools.json
server/equity-structure/routes.js
server/equity-structure/job-factory.js
server/equity-structure/worker-runner.js
server/equity-structure/repository.js
server/equity-structure/migrations/001_equity_structure.sql
server/excel-review/routes.js
server/excel-review/parse-runner.js
server/contracts/db.js
services/excel_review/ooxml_package.py
services/excel_review/ooxml_threaded_comments.py
services/equity_structure/exporters.py
private/tools/_template/index.html
private/tools/equity-structure/index.html
package.json
```

### POC

```text
README.md
reports/phase0-validation-report.md
reports/excel-manual-acceptance.md
reports/anchor-comparison-report.md
reports/two-cell-anchor-manual-acceptance.md
src/FlowchartExcelExporter/Models.cs
src/FlowchartExcelExporter/SampleFlowchart.cs
src/FlowchartExcelExporter/SheetGrid.cs
src/FlowchartExcelExporter/DrawingFactory.cs
src/FlowchartExcelExporter/ConnectorFactory.cs
src/FlowchartExcelExporter/ExcelFlowchartExporter.cs
src/FlowchartExcelExporter/PackageValidator.cs
src/FlowchartExcelExporter/Program.cs
tests/FlowchartExcelExporter.Tests/PackageStructureTests.cs
tests/FlowchartExcelExporter.Tests/TwoCellAnchorTests.cs
```

---

## 3. Phase 0 文件与验收证据核对

### 3.1 文件

| 文件 | 状态 |
|---|---|
| `output/flowchart-native-connectors-poc.xlsx` | 存在，4,596 bytes，SHA-256 `5645900444eb180878a66649e3b150c2db13bc7ccaffde471d1543fda486b4be` |
| `output/anchor-comparison/two-cell-anchor.xlsx` | 存在，4,804 bytes，SHA-256 `2f4e713de9f087046935bf9bd0da7d915bbbab11ae3ae4024f0cacee771ad1b8` |
| `output/anchor-comparison/two-cell-anchor-excel-move-save.xlsx` | 存在，移动/保存/重开副本 |
| `output/anchor-comparison/two-cell-anchor-excel-save-reopen.xlsx` | 存在，行/列调整后副本 |

absoluteAnchor 基线未被覆盖。

### 3.2 自动测试

实际运行：

```text
dotnet test FlowchartExcelExporter.slnx -c Release
11 passed / 0 failed
```

### 3.3 Open XML SDK validator

实际运行：

```text
two-cell-anchor.xlsx: 0 errors
two-cell-anchor-excel-move-save.xlsx: 0 errors
two-cell-anchor-excel-save-reopen.xlsx: validator 0 errors
```

布局调整后的副本：

- `all twoCell markers valid`：PASS（使用实际工作表行列尺寸）
- `twoCell markers match xfrm`：FAIL（Excel 更新 marker，`oneCell` 的 `a:xfrm` 保留旧值）
- 连接器引用仍有效；Open XML SDK validator 0 errors

### 3.4 macOS 验收

环境：Microsoft Excel for Mac 16.113.1
结果：PASS

证据：

```text
reports/two-cell-excel-move-save-only.txt
reports/two-cell-excel-layout.txt
reports/two-cell-excel-final.txt
reports/two-cell-package-validation-move-save.txt
reports/two-cell-package-validation-after-layout.txt
reports/absolute-layout-probe.txt
```

已实测：

- 拖动 Start / Process / End；
- 保存、关闭、重开；
- 两条连接器仍绑定；
- 行高/列宽调整后节点移动、尺寸不变；
- 泳道 `A5:B15` 仍合并；
- `bentConnector3` 仍是单对象；
- `beginSite=4` / `endSite=2`，对应 XML `idx=3` / `idx=1`。

### 3.5 Windows 验收

用户已明确表示“Windows 已验收”。

但 POC 中没有：

- Windows Excel 版本；
- 逐项测试步骤；
- 保存后文件或 XML 复核；
- 测试人/时间；
- 失败/警告记录。

现有 POC 报告仍保留历史状态 `NOT RUN`（这是归档时的真实文件状态）。

本报告记录：

```text
Windows Excel：用户报告已验收；详细版本/步骤/逐项证据待补录。
```

不得把 macOS 结果写成 Windows 结果。

---

## 4. 当前代码事实（POC）

- 默认 `AnchorMode.Absolute`；twoCell 通过 `AnchorMode.TwoCell` 显式生成。
- `DrawingFactory` 同时支持 absoluteAnchor 与 twoCellAnchor。
- `ConnectorFactory` 同时支持两种 anchor；`stCxn` / `endCxn` 位于 `xdr:nvCxnSpPr/xdr:cNvCxnSpPr`。
- Shape ID：2/3/4；Connector ID：102/103。
- 连接点（DrawingML 0-based）：right=3，left=1。
- 箭头：`a:tailEnd type="triangle"`。
- twoCell 使用 `editAs="oneCell"`。
- `SheetGrid` 负责 EMU → cell marker + offset；支持不同列宽/行高和越界报错。
- 生成时 `a:xfrm` 与 marker 一致；Excel 调整行列后 marker 是实际位置，`a:xfrm` 可能旧值。

---

## 5. 新增文档

```text
docs/agent/flowchart-excel/flowchart-data-contract.md
docs/agent/flowchart-excel/flowchart.schema.json
docs/agent/flowchart-excel/legacy-helper-files-adapter.md
docs/agent/flowchart-excel/phase1-implementation-plan.md
docs/agent/flowchart-excel/architecture-decision-record.md
docs/agent/flowchart-excel/phase0-phase1-readiness-report.md
docs/agent/flowchart-excel/phase1-slice1-validation-report.md
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

POC：

```text
reports/phase0-final-summary.md
```

未覆盖任何既有同名文档；目标目录原本不存在。

---

## 6. JSON Schema 验证方式

### 6.1 本次实际执行

使用环境中已存在的 Node Ajv 8.20.0（未新增项目依赖）：

```js
const Ajv2020 = require('ajv/dist/2020');
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
```

结果：

```text
schema compile: OK
valid synthetic document: true
invalid schema_version: false
```

本验证使用临时脚本/内存数据，不写入客户数据，不修改项目依赖。

### 6.2 Schema 限制

JSON Schema 无法验证：

- `nodes[].lane_id` 是否存在于 `lanes`
- `edges[].source_node_id` / `target_node_id` 是否存在于 `nodes`
- ID 是否全局唯一
- bbox 是否在图像范围内（只能验证 0..1，无法验证 x+width<=1 的跨字段和）
- 最终导出 gate 是否满足

因此 `flowchart-data-contract.md` 第 13 节定义了应用层交叉校验；Phase 1 第一切片必须实现。

### 6.3 未来

- 第一切片增加 Ajv 依赖（devDependency 或 runtime dependency，按实施方式决定）。
- 添加合法/非法 fixture。
- 增加 cross-reference validator。
- 不把 schema 校验等同于业务正确性。

---

## 7. 统一数据契约的关键决策

1. `schema_version` 固定 `1.0.0`。
2. 坐标统一为归一化 `bbox`，原始像素另存 `source_bbox_px`。
3. `lane` → `lane_id`；`source/target` → `source_node_id/target_node_id`。
4. 端口为 `top/right/bottom/left/null`；null 必须进入 unresolved，最终导出 gate 拒绝。
5. `confidence`、`review_status`、`provenance` 严格分离。
6. `controls` 统一 CA/PRP/TOE，含 display/attribution_status。
7. `unresolved_items` 统一 type/severity/status/action。
8. `reconciliation` 只产生 diff/变更，不静默覆盖。
9. `revisions` 记录人工修订。
10. `export_profile` 强制 `twoCellAnchor`、原生 shape/connector、合并单元格泳道、真实 Excel 验收。
11. 未知字段保留到 `extensions.legacy`。
12. 旧文件不能直接进入导出器，必须 adapter。

---

## 8. 现有网站集成的真实路径

| 能力 | 真实路径/模式 |
|---|---|
| 工具注册 | `config/tools.json` 数组；字段 slug/name/description/category/status/version/icon/keywords |
| 工具页面 | `private/tools/<slug>/index.html`；`/tools/:slug` 自动检测 |
| 静态资源 | `/app` → `private/`，需 `requireAuth` |
| 认证 | `server.js` `requireAuth`，JSON 401/HTML redirect |
| 同源检查 | `sameOriginForStateChange` |
| API mount | `app.use('/api/...', requireAuth, sameOriginForStateChange, router)` |
| 上传 | `multer.memoryStorage()` + 扩展名/MIME/魔数/大小校验 |
| 下载 | `res.download()` / `res.sendFile()`，owner 校验，路径服务端派生 |
| 任务状态 | PostgreSQL + `status.json` + Node runner |
| Worker | `spawn(python, ['-m', module, '--job-dir', dir])`，stdout/stderr 写 `worker.log` |
| 超时 | `setTimeout` + SIGTERM，后续 SIGKILL |
| 进度 | 轮询 `status.json`，更新 DB |
| 恢复 | queued 重新入队；running 标记失败/中断 |
| 清理 | TTL/保留期定时清理 |
| DB 访问 | `server/contracts/db.js` 的 `pg.Pool` + `query()` |
| 迁移 | `server/<module>/migrations/*.sql`，additive |
| OOXML 包补丁 | `services/excel_review/ooxml_package.py` |
| 破坏 DrawingML 的路径 | `openpyxl` 保存会丢 drawing part；现有 equity 导出只用 openpyxl 写单元格 |
| 测试 | `npm test`（Node `node:test`）；Python unittest；POC xUnit |
| 现有测试基线 | `npm test` 285 pass / 0 fail（本次只读核查，未修改业务代码） |

`ooxml_package.py` 可复用边界：

- `OoxmlPackage` 只读 ZIP 视图
- `normalize_part`
- `rels_part_for`
- `parse_relationships`
- `workbook_sheets`
- `rels_of`
- `part_for_relationship`
- `write_patched_package`：复制 ZIP，只替换/新增指定 part

它**不提供** DrawingML shape/connector 生成；.NET 导出器负责该部分。

---

## 9. Phase 1 第一小切片

本次建议的 Slice 1：

```text
只做契约校验与旧辅助文件 adapter。
不修改 server.js / config/tools.json / private/ / DB / Python worker / .NET POC。
```

新增（未来执行）：

```text
server/flowchart-excel/contract/validate-flowchart.js
server/flowchart-excel/contract/adapt-legacy-helper.js
server/flowchart-excel/contract/legacy-adapter-version.js
scripts/local/check-flowchart-contract.js
tests/flowchart-contract/schema.test.js
tests/flowchart-contract/adapter.test.js
tests/flowchart-contract/cross-reference.test.js
tests/flowchart-contract/fixtures/legacy-helper-minimal.json
```

验收：

```bash
node --test tests/flowchart-contract/*.test.js
node scripts/local/check-flowchart-contract.js \
  --schema docs/agent/flowchart-excel/flowchart.schema.json \
  --input tests/flowchart-contract/fixtures/legacy-helper-minimal.json \
  --out-dir /tmp/flowchart-contract-check
```

必须满足：

- schema 编译通过；
- 合法文档通过，非法文档被拒绝；
- adapter 输出通过 schema；
- 交叉引用通过或进入 unresolved；
- 节点/边数量守恒；
- 未知字段保留；
- 缺端口不伪造；
- review_status pending；
- provenance 缺失时 `image_extraction` + legacy metadata；
- adaptation-report 可审计；
- 不生成 XLSX、不调用 AI、不写 DB。

---

## 10. 尚未确定的问题与风险

1. **Windows 详细证据缺失**：用户已确认，但版本/步骤/保存后 XML 未记录。
2. **`a:xfrm` / marker**：Excel 调整行列后 `oneCell` 的 xfrm 可能是旧值；重新导入必须按 marker。
3. **`editAs="twoCell"`**：是否适合需要缩放的节点，未测试。
4. **复杂布局**：避障、交叉、回接、多泳道、文字溢出未验证。
5. **模板样式导入**：如何从现有模板抽取样式而不带入隐藏 sheet/外链。
6. **模型端点/隐私**：云端/本地模型选择、图片外发授权、成本控制。
7. **前端构建链**：React/Vite/X6 与现有 CSP/静态路由的集成方式。
8. **.NET 服务化**：进程调用 vs 常驻服务、部署与版本锁定。
9. **Node 版本**：开发机 Node 25，生产建议 LTS；需回归矩阵。
10. **Schema 校验依赖**：第一切片需确定 Ajv vs Python jsonschema，并锁定版本。

---

## 11. 本次没有实现的内容

明确没有：

- 新增/修改网页；
- 新增上传/AI/任务 API；
- 调用视觉模型；
- 上传图片或 PDF；
- 新增数据库表或迁移；
- 修改 `config/tools.json` / `server.js`；
- 生成最终 XLSX；
- 安装新依赖；
- 新增客户业务样例。

本次交付仅：

- Phase 0 归档/核对；
- POC 阶段总结；
- 统一数据契约；
- JSON Schema；
- 旧文件 adapter 设计；
- Phase 1 实施计划；
- ADR；
- readiness report。

# Slice 5 — Excel Export Validation Report

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- POC：`/Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc`
- 目标模板：`/Users/a123/Downloads/Trade purchase.CN.xlsx`
- 结论：**Gate A 已通过（显式保存 reviewed graph 并重新 approve）；Gate C 仍缺 Windows Excel 证据；已生成实验 XLSX，正式 exportReady 保持 false。**

---

## 1. Git / 环境基线

```text
site pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
site status: dirty (29 entries before this slice)
POC: not a Git repository
```

执行中保留了所有既有 dirty/untracked 修改；没有 reset/clean/stash/checkout/restore。

.NET：

```text
.NET SDK 10.0.402
Host 10.0.13
DocumentFormat.OpenXml 3.5.1
macOS 15.5 / arm64
```

路径：

```text
$HOME/.dotnet/dotnet
```

8080 保持运行，`GET /health` = `{"ok":true}`；未重启，未做无关服务操作。

---

## 2. Gate A — Approved graph 检查

发现当前用户任务：

```text
job id: 551a6811-52aa-40ba-a790-b472e695b549
meta.status: review_approved
initial review revision: 2
issues: 22 waived
workerMode: external_import
exportReady: false
```

初始缺少：

```text
review/flowchart.reviewed.json        # 最终 approved canonical graph
```

已按用户“打通导出”的明确要求执行**显式**保存 + 重新批准，没有自动修改业务图：

```text
revision 4: saveGraph(imported canonical graph) -> review_in_progress
revision 5: approve -> review_approved
created: review/flowchart.reviewed.json
created: review/nodes.reviewed.csv
created: review/edges.reviewed.csv
created: review/style.reviewed.json
```

Graph：

```text
3 lanes / 63 nodes / 58 edges
22 unresolved, all waived
no blocking pending
template_profile_id=trade_purchase_cn
edit_as=pending
exportReady=false
```

Gate A 结论：**PASS（reviewed graph 已持久化，approved revision 5）**。

原始 imported graph、ZIP、import report 和 revisions 均保留；没有把原始 graph 冒充为 reviewed graph，也没有删除审计记录。

---

## 3. Gate B — 机器可读模板 profile

新增：

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.json
services/flowchart_excel/template_profile.js
tests/flowchart-excel/template-profile.test.js
```

模板 SHA-256：

```text
c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80
```

已验证并写入 profile：

- 1 个 sheet，`Trade purchase WT`；used range `A1:AH9`；print area `A1:AG9`；
- landscape、A3（paperSize=8）、scale 48、fitToPage；
- margins left/right 0.7"，top/bottom 0.75"，header/footer 0.3"；
- 仅 `A8:A9` 合并；行 4/5 隐藏；关键行高 24.75 / 318.65 / 113.4 / 409.6 / 266 / 373.25 / 409.6；
- theme accent1 `4472C4` 等完整主题色；
- 91 shapes / 74 connectors / 165 twoCellAnchor；无显式 `editAs`；
- shape preset counts；直接填色 yellow/red/green；line/shadow/text；
- 74 connector 中仅 50 条完整绑定；57 stCxn / 51 endCxn；
- lane 实现为 `row_band_plus_column_a_label_cells`；
- 未确认项明确放入 `unverified`；
- `production_edit_as: pending`，`export_ready: false`。

Profile validator 校验：

```text
profile ID/hash
required sections
connector binding defect counts
A8:A9 lane evidence
anchor explicit editAs = null
production editAs = pending
exportReady = false
```

---

## 4. Gate C — Anchor A/B

POC 扩展：

```text
src/FlowchartExcelExporter/CanonicalAdapter.cs
src/FlowchartExcelExporter/Models.cs
src/FlowchartExcelExporter/DrawingFactory.cs
src/FlowchartExcelExporter/ConnectorFactory.cs
src/FlowchartExcelExporter/ExcelFlowchartExporter.cs
src/FlowchartExcelExporter/Program.cs
src/FlowchartExcelExporter/PackageValidator.cs
tests/FlowchartExcelExporter.Tests/TwoCellAnchorTests.cs
tests/FlowchartExcelExporter.Tests/CanonicalAdapterTests.cs
```

生成：

```text
output/anchor-comparison/two-cell-anchor-default-editAs.xlsx   # A
output/anchor-comparison/two-cell-anchor-oneCell.xlsx          # B
```

自动结构：

| 检查 | A | B |
|---|---|---|
| twoCellAnchor | 5 | 5 |
| sp / cxnSp | 3 / 2 | 3 / 2 |
| stCxn / endCxn | 2 / 2 | 2 / 2 |
| A/B editAs | 无 | oneCell |
| Open XML SDK | 0 errors | 0 errors |
| images | 0 | 0 |

真实 Excel（同一生成器 A/B 样例，Microsoft Excel for Mac 16.113.1）：

```text
A: Mac PASS（移动、保存、重开、行高/列宽调整后连接器仍绑定）
B: Mac PASS（同样步骤；节点尺寸保持不变）
Windows: NOT RUN
```

A/B 的 Mac 证据不能替代 Windows target-style 验收。

新增 target-style candidate（从 reviewed graph 生成）：

```text
output/target/trade-purchase-candidate-default-editAs.xlsx  # A
output/target/trade-purchase-candidate-oneCell.xlsx         # B
```

结构：63 shapes / 58 connectors / 121 twoCell anchors / 58 完整 stCxn+endCxn / 0 images / A3 landscape / print area。

Mac Excel 16.113.1 对 A target candidate 已执行：
- 打开、移动 N001、保存、关闭、重开；
- E001 连接器 `begin/end connected = true`；
- 无修复提示（自动化打开未报错）。

Windows Excel：NOT RUN。

Gate C 结论：**PARTIAL**。生产 `edit_as` 仍为 `pending`，正式 exportReady 仍为 false。

## 4.1 实验导出 API

已新增：

```text
POST /api/flowchart-excel/jobs/:jobId/export-xlsx
body: { "mode": "experimental", "anchor": "default" }
```

条件：owner、review_approved、reviewed graph、无 blocking、profile 存在。调用 .NET target exporter，写 `xlsx_candidate` artifact。只生成实验产物，不会把 `exportReady` 改为 true。

---

## 5. Canonical synthetic exporter

新增 `CanonicalAdapter` 作为**合成测试适配器**，读取 canonical JSON 并生成 4 节点 / 3 边的原生 shape/connector 文件：

```text
samples/canonical-minimal.json
output/canonical/canonical-minimal-default-editAs.xlsx
output/canonical/canonical-minimal-oneCell.xlsx
```

结构：

```text
4 shapes / 3 connectors
每条 connector 均 stCxn + endCxn
3 个 connector ID 唯一
无图片
```

这不是客户正式产物，也没有把示例文字、模板教学文字或原始未绑定 connector 带入。

---

## 6. 测试结果

```text
dotnet build FlowchartExcelExporter.slnx -c Release
  PASS — 0 warnings / 0 errors

dotnet test FlowchartExcelExporter.slnx -c Release
  PASS — 14/14 tests

Node profile validator
  PASS — 5/5 tests

Node flowchart suite
  PASS — 115/115 tests

npm test
  PASS — 400/400 tests
```

（Node 数字以本轮最终执行结果为准；profile 新增 5 个测试。）

---

## 7. 交付物

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.json
docs/agent/flowchart-excel/slice5-export-validation-report.md
services/flowchart_excel/template_profile.js
tests/flowchart-excel/template-profile.test.js

POC:
  src/FlowchartExcelExporter/CanonicalAdapter.cs
  samples/canonical-minimal.json
  output/anchor-comparison/two-cell-anchor-default-editAs.xlsx
  output/anchor-comparison/two-cell-anchor-oneCell.xlsx
  output/canonical/canonical-minimal-default-editAs.xlsx
  output/canonical/canonical-minimal-oneCell.xlsx
  reports/anchor-variant-comparison.md
  reports/excel-export-manual-acceptance.md
```

---

## 8. 正式 XLSX / 实验 XLSX

已生成并可下载实验 XLSX：

```text
artifact: xlsx-candidate
name: flowchart-candidate-default.xlsx
job: 551a6811-52aa-40ba-a790-b472e695b549
```

API 形态：

```text
mode=experimental
anchor=default
```

正式 XLSX 仍未生成；原因：

1. Gate C 仍缺 Windows target-style Excel 验收；
2. `profile.anchor.production_edit_as` 仍为 `pending`。

因此：

```text
exportReady = false
edit_as = pending
formal customer XLSX = NOT GENERATED
experimental candidate XLSX = generated
```

不能把实验候选文件标记为客户正式结果。

---

## 9. 下一步

1. 在 Windows Excel 对 target-style A/B 做真实 Excel 验收，记录版本和步骤。
2. 将 profile `production_edit_as` 从 pending 改成 confirmed 的单一选择。
3. 通过 Gate C 后，才把 `exportReady` 改为 true，并将实验 API 升级为正式导出。

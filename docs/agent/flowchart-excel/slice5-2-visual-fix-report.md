# Slice 5.2 — Excel 视觉修复报告

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch：`main`
- HEAD：`ea3a3127881393f1eae1542419268b571a8e79f6`
- dirty：本轮开始前为既有 dirty；未 reset/clean/stash/checkout/restore/commit/push
- 8080：`{"ok":true}`，未重启
- 输入 graph：job `551a6811-52aa-40ba-a790-b472e695b549`，review revision 5，3 lanes / 63 nodes / 58 edges
- reviewed graph SHA-256：`e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

结论：**视觉 QA 仍为 FAIL；本轮新候选仍是实验产物，`edit_as=pending`、`exportReady=false`。**

---

## 1. 新版本化输出

不覆盖 Slice 5.1 A/B、当前实验候选、approved graph、revisions 或原始 ZIP。

```text
~/Downloads/flowchart-excel-visual-fix-2026-10-20/
├── flowchart-revision5-visual-fix-default-twoCell.xlsx
├── export-layout.json
├── layout-validation-report.json
├── text-overflow-report.json
├── structure.json
├── sha256.txt
├── build.log
├── preview/
│   ├── visual-preview.png
│   ├── flowchart-revision5-visual-fix-default-twoCell.pdf
│   └── soffice.log
├── move.txt
└── reopen.txt
```

候选：

```text
SHA-256 e876cc2cbbcc49ef832d7446ed697f60f36876193ef03ac8d0ea34dee16751f4
```

---

## 2. 本次修复实施

新增独立布局/导出器：

```text
/Users/a123/AI-Workspace/tools/flowchart-excel-visual-fix/
├── VisualFixExporter.csproj
└── Program.cs
```

设计：

- 读取 approved revision 5 canonical graph；
- 按 lane order 生成独立泳道行带；
- 节点按 lane 内 6 列网格放置；
- 预留标题、泳道、图例和分支标签空间；
- 每个业务节点生成 `xdr:sp`；
- 每条逻辑边生成一个 `xdr:cxnSp`，使用 `bentConnector3` 和真实 `stCxn/endCxn`；
- 为带 label 的 15 条边增加独立小矩形标签形状（不替代业务节点/边）；
- 使用 twoCellAnchor，不显式设置 editAs（Variant A）；
- A3 landscape / scale 48 / print area A1:AH67；
- 输出 `export-layout.json`、布局/文本溢出报告。

没有修改 reviewed graph 的业务文字、节点/边数量、source/target 或 unresolved 状态。

---

## 3. 自动结构验收

`structure.json`：

```text
63 业务节点 + 15 分支标签 = 78 xdr:sp
58 xdr:cxnSp
58/58 stCxn + endCxn
58/58 端点指向真实 shape
Shape/Connector IDs unique
0 xdr:pic / 0 media
0 external links / 0 customXml
0 Open XML SDK validator errors
136 twoCellAnchor，全部无显式 editAs
A3 landscape / paperSize 8 / scale 48
print area 'Flowchart Review'!$A$1:$AH$67
```

布局检查：

```text
node overlaps: 0
outside print/grid: 0
text overflow warnings: 13
approx connector/non-endpoint-node crossings: 61
```

说明：

- 连通性/包结构 PASS；
- 布局碰撞 PASS；
- 文本溢出和连接线穿越仍为 blocker；
- connector 路径检查是基于 `export-layout.json` 的近似中心线检查，Excel 可能自动重路由，不能代替 Excel 视觉复查。

---

## 4. 视觉 QA

预览：

```text
preview/visual-preview.png
```

生成工具：LibreOffice headless → PDF → PNG。仅辅助，不等同于 Excel。

已改善：

- 标题不再位于画布外；标题 `Flowchart Review` 可见；
- 节点采用独立网格，自动检查无节点矩形重叠；
- 泳道在 A 列有行带标签，节点不再覆盖标题；
- 为“是/否”分支增加独立标签形状；
- A3/scale/print area 存在；
- 无模板示例采购文字、Remove before use、external links 或 customXml。

仍为 FAIL：

1. **13 条文本溢出**：长节点文字仍可能截断/换行不足；
2. **61 个近似连接线穿越**：多个非端点节点被连接线穿过；
3. 判断分支标签虽然生成，但部分位置仍可能落在连线/节点附近；
4. CA/PRP/TOE 仍是普通文字节点（N060–N063），没有复现目标模板的控制标记图形/布局；
5. 图例是通用两层文本，不是目标模板图例层级；
6. 泳道标签是 A 列行带，但没有严格复现目标模板的采购部/仓库/应付账款行号和单元格样式；
7. 与目标模板的视觉 token 仍有差异：Decision 填充、文本边距、阴影和分支标签层级未完成像素级对齐。

因此本阶段视觉 QA **未通过**，不能交给正式客户导出。

---

## 5. Mac / Windows

### Mac

本次新 `visual-fix` 候选的 Excel 自动化验收：**NOT RUN**（本轮未完成可靠的 A/B 自动化；不将其伪称为 PASS）。

Slice 5.1 的旧 A/B 证据仍有效，但只对应旧候选：

```text
A/B 63/58 移动、保存、重开、行列调整后 58/58 绑定 PASS
```

### Windows

**NOT RUN**。验收包仍使用 Slice 5.1 的 Windows 包；本新候选尚未进入 Windows。

---

## 6. 当前状态

```text
edit_as = pending
exportReady = false
formal customer XLSX = NOT GENERATED
visual QA = FAIL
```

唯一剩余 blockers：

1. 13 条文本溢出；
2. 61 条近似连接线穿越；
3. CA/PRP/TOE、图例、泳道和分支标签未达到目标模板视觉层级；
4. Windows 正式验收未执行。

---

## 7. 测试结果

```text
Node flowchart: 115 pass / 0 fail
npm test: 400 pass / 0 fail
.NET POC: 14/14 pass
VisualFixExporter build: 0 errors
Open XML SDK visual-fix candidate: 0 errors
```

---

## 8. 交付物

```text
docs/agent/flowchart-excel/slice5-2-visual-fix-report.md
docs/agent/flowchart-excel/excel-visual-qa-report.md
docs/agent/flowchart-excel/anchor-decision-record.md
/Users/a123/Downloads/flowchart-excel-visual-fix-2026-10-20/
```

旧 A/B 候选、reviewed graph、revision history、原始 external ZIP 均未覆盖。

# Slice 5.3 — 画布占用与可读性修复报告

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch：`main`
- HEAD：`ea3a3127881393f1eae1542419268b571a8e79f6`
- dirty：30 项（既有 dirty 保留；未 reset/clean/stash/checkout/restore/commit/push）
- 8080：`{"ok":true}`，未重启
- graph：job `551a6811-52aa-40ba-a790-b472e695b549`，review revision 5，3 lanes / 63 nodes / 58 edges
- reviewed graph SHA-256：`e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

结论：**画布利用率和文字溢出明显改善；视觉 QA 仍为 FAIL，正式导出继续关闭。**

---

## 1. 黑色区域诊断

用户看到的视觉预览：

```text
1191 × 842 RGBA PNG
alpha_min = 0
content bbox = (50, 53) - (917, 783)
content ratio = 72.9% width / 86.8% height
```

结论：

- 黑色/空白不是 Excel 工作簿背景，也不是模板颜色；
- PNG 含真实 alpha channel，查看器把透明区域显示为黑色；
- XLSX 的 PDF 页面为 A3 横向 `1190.55 × 841.89`；
- 内容确实可从左上开始，但 v2 已把内容占比提升到约 73% × 87%；
- 不能通过给 XLSX 填黑背景“修复”；
- 已生成白色扁平化预览和内容裁切预览：

```text
preview/visual-preview-white.png
preview/visual-preview-cropped.png
```

裁切预览只用于观察，不改变 XLSX 页面或打印设置。

---

## 2. 新实验候选

版本化目录：

```text
~/Downloads/flowchart-excel-visual-fix-v2-2026-10-20/
```

候选：

```text
flowchart-revision5-visual-fix-v2-default-twoCell.xlsx
SHA-256 85bde120538b18df74db1f7e10304a2cc03584e5e63a12e793f65374e5c8a892
```

不覆盖 Slice 5.1/5.2 文件、approved graph、revision 或原始 ZIP。

布局改动：

- 数据列宽从 7 提升到 9.9；
- 行高从 10 提升到 20；
- 每泳道 5 列节点布局，节点宽度 5 列、高度 4 行；
- 标题、泳道、图例、节点和分支标签保留独立区域；
- 仍使用 `twoCellAnchor` 且不显式设置 editAs；
- A3 横向 / scale 48 / print area `A1:AH82`。

未修改业务节点、边、source/target、文本和 unresolved。

---

## 3. 自动结构验收

```text
63 business nodes + 15 branch label shapes = 78 xdr:sp
58 xdr:cxnSp
58/58 stCxn + endCxn
58/58 endpoint references real shapes
Shape/Connector IDs unique
0 xdr:pic / 0 media
0 external links / 0 customXml
0 Open XML SDK validator errors
136 twoCellAnchor，全部无显式 editAs
A3 landscape / paper size 8 / scale 48
print area 'Flowchart Review'!$A$1:$AH$82
```

布局：

```text
node overlaps: 0
objects outside grid/print area: 0
text overflow: 0（历史 13 项已消除）
approx connector/non-endpoint-node crossings: 23（Slice 5.2 为 61）
```

连接器路径仍是近似中心线检查；LibreOffice 和 Excel 可能重路由 `bentConnector3`，不能把 23 当作最终 Excel 真实路径结论。

---

## 4. 已修复

- 标题：完整显示，没有位于页面外；
- 页面占用：内容区域从约 53% × 38% 提升到 73% × 87%；
- 节点碰撞：业务节点矩形重叠 0；
- 文字溢出：13 → 0（按当前估算规则）；
- 分支标签：15 个独立标签形状；
- 原生连接器：58/58 保留绑定；
- 无图片替代；
- Open XML SDK 0 errors。

---

## 5. 仍为 blocker（视觉 QA FAIL）

1. **23 个近似连接线穿越**：仍可能穿过非端点节点；需要逐条分类并继续调整节点/通道，不能用降低阈值的方式清零。
2. **泳道标签显示**：A 列长标签仍有视觉截断/可读性问题，未严格复现目标模板短部门标签和行号结构。
3. **CA/PRP/TOE**：N060–N063 仍是普通文本节点，不是目标模板的实际控制标记语义/样式。
4. **图例**：仍是通用两层文本，不是目标模板图例形状层级。
5. **目标样式**：标题/填充/文本边距/阴影/分支标签尚未完成像素级或 XML token 级对齐。
6. **Mac/Windows**：新 v2 候选的 Excel 实测均未执行（旧 A/B 结果不能替代）。
7. **视觉预览**：LibreOffice 辅助预览不能代替 Excel 实测。

因此视觉 QA 未通过，不能交给正式客户导出。

---

## 6. 交付物

```text
~/Downloads/flowchart-excel-visual-fix-v2-2026-10-20/
├── flowchart-revision5-visual-fix-v2-default-twoCell.xlsx
├── export-layout.json
├── layout-validation-report.json
├── text-overflow-report.json
├── connector-routing-report.json
├── structure.json
├── sha256.txt
├── build.log
└── preview/
    ├── visual-preview.png              # 原始 RGBA，透明区域不是 Excel 背景
    ├── visual-preview-white.png        # 白色扁平化 QA 预览
    ├── visual-preview-cropped.png      # 内容边界裁切 QA 预览
    └── flowchart-revision5-visual-fix-v2-default-twoCell.pdf
```

---

## 7. 状态

```text
edit_as = pending
exportReady = false
formal customer XLSX = NOT GENERATED
visual QA = FAIL
```

测试：

```text
Node flowchart: 115 pass / 0 fail
npm test: 400 pass / 0 fail
.NET POC: 14/14 pass
Visual-fix v2 build: PASS
Open XML SDK v2: 0 errors
```

下一阶段必须先修复 23 条近似穿越、泳道/图例/控制标记和真实 Mac/Windows 验收，再讨论正式导出。

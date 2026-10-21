# Slice 5.4 — 拓扑布局、形状映射与连接器避障 V3

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch：`main`
- HEAD：`ea3a3127881393f1eae1542419268b571a8e79f6`
- dirty：30 项；未 reset/clean/stash/checkout/restore/commit/push
- 8080：`{"ok":true}`，未重启
- graph：job `551a6811-52aa-40ba-a790-b472e695b549`，review revision 5，3 lanes / 63 nodes / 58 edges
- reviewed graph SHA-256：`e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

结论：**V3 结构/文字/节点碰撞通过，但连接器避障和目标模板样式仍未通过；视觉 QA FAIL，正式导出关闭。**

---

## 1. V2 → V3 变更

V2：

```text
固定 5 列节点顺序
23 近似 connector crossings
13 text overflow
内容占比约 73% × 87%
```

V3：

- 不再按 N001…N063 编号机械填充；
- 先计算 incoming-edge rank（cycles 作为反馈，不删除边）；
- 按 lane 分组，在 lane 内按 rank 排序；
- 评估过 ELK.js 0.12.0；其 layered/partition 输出不能直接保证三条横向 lane 行带，最终采用 graph-rank + lane 行带后处理；仍未完全达到目标，保留为实验；
- 每 lane 5 列、5 行块布局；
- 列宽/行高保持可读性；
- 增加 15 个分支标签形状；
- 新输出目录，不覆盖 V1/V2。

```text
~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/
```

V3 XLSX：

```text
SHA-256 677b9882cdb5d8f9385a555e3ee55777cfcb291d38a4008640bef5e9593cb97b
```

---

## 2. 结构验收

```text
63 business nodes + 15 branch label shapes = 78 xdr:sp
58 xdr:cxnSp
58/58 stCxn + endCxn
58/58 endpoint references real shapes
IDs unique
0 xdr:pic / 0 media / 0 external links / 0 customXml
0 Open XML SDK validator errors
136 twoCellAnchor，全部无显式 editAs
A3 landscape / paper 8 / scale 48
print area 'Flowchart Review'!$A$1:$AL$87
```

布局：

```text
node overlaps: 0
outside print/grid: 0
text overflow: 0
approx connector/non-endpoint-node crossings: 39
```

V2/V3 对比：

```text
V2 23 review edges
V3 仍 review 15 条 V2 边
V3 新出现 24 条 review 边
V3 total 39 review edges
```

V2 23 条边的逐条结果：

```text
E004 clear
E005 clear
E006 clear
E007 still review
E010 clear
E012 still review
E016 clear
E017 clear
E023 still review
E024 still review
E029 still review
E031 still review
E038 still review
E040 still review
E042 still review
E045 clear
E047 still review
E049 still review
E050 still review
E051 clear
E054 still review
E056 still review
E058 still review
```

结论：图 rank 布局没有改善整体，且有 24 条新近似穿越。不能声称路由修复完成。

---

## 3. 形状语义映射

实际 DrawingML preset 计数：

```text
flowChartProcess 22（含 4 个控制标记节点）
flowChartTerminator 14
flowChartPredefinedProcess 12
flowChartDecision 8
flowChartDocument 3
flowChartInputOutput 2
flowChartMagneticDrum 2
rect 15（分支标签）
```

与业务 graph 对照：

```text
terminator 14 -> flowChartTerminator 14
process 18 -> flowChartProcess 18（业务）
predefined_process 12 -> flowChartPredefinedProcess 12
decision 8 -> flowChartDecision 8
document 3 -> flowChartDocument 3
input_output 2 -> flowChartInputOutput 2
database 2 -> flowChartMagneticDrum 2
control marker 4 -> flowChartProcess（失败：未按 CA/PRP/TOE 独立渲染）
```

详见 `shape-style-mapping-report.md`。

---

## 4. 仍未满足的视觉要求

1. 39 条近似连接线穿越；V2 23 条中有 15 条仍存在，新增 24 条。
2. `CA/PRP/TOE` 仍是普通 `flowChartProcess` 文本节点，不是模板控制标记。
3. 图例仍是通用两层文本，不是目标模板图例层级。
4. 泳道标签仍是 A 列长文本，未严格复现目标模板部门行带/短标签。
5. 连接器 routing 仍是 `bentConnector3` 的连接点中心线，未实现专用回接/跨泳道通道。
6. V2/V3 的黑色预览背景已确认是 PNG alpha，已生成白底/裁切版本；这不是 Excel 背景。
7. V3 Mac/Windows Excel 实测均 NOT RUN。
8. `edit_as=pending`、`exportReady=false`。

---

## 5. 预览

```text
preview/visual-preview.png          # RGBA，alpha 透明
preview/visual-preview-white.png    # 白底 QA 预览
preview/visual-preview-cropped.png  # 内容裁切 QA 预览
```

内容占页面约 73% × 87%（裁切尺寸约 867×731 / 1191×842）。
LibreOffice 预览只用于辅助，不是 Excel 实测。

---

## 6. 测试

```text
Node flowchart: 115 pass / 0 fail
npm test: 400 pass / 0 fail
.NET POC: 14/14 pass
VisualFixExporter V3 build: PASS
Open XML SDK V3: 0 errors
```

---

## 7. 文件

```text
~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/
├── flowchart-revision5-visual-fix-v3-default-twoCell.xlsx
├── export-layout.json
├── connector-routing-report.json
├── layout-validation-report.json
├── text-overflow-report.json
├── structure.json
├── sha256.txt
├── preview/
└── windows-target-style-acceptance-v3-2026-10-20.zip
```

---

## 8. 停止结论

本阶段不能标记视觉 QA PASS：

- 布局仍不是稳定无穿越的流程拓扑布局；
- 连接器 confirmed collision 不为 0；
- 控制标记/图例/泳道尚未匹配目标模板；
- Mac/Windows 新 V3 未实测。

保留实验候选，不开放正式客户导出。

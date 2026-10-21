# Slice 5.5 — ELK 分层布局与正交连接器路由（V4）

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch：`main`
- HEAD：`ea3a3127881393f1eae1542419268b571a8e79f6`
- dirty：30 项；未 reset / clean / stash / checkout / restore / commit / push
- 8080：`{"ok":true}`，未重启
- approved graph：job `551a6811-52aa-40ba-a790-b472e695b549`，review revision 5，3 lanes / 63 nodes / 58 edges
- reviewed graph SHA-256：`e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68`
- 目标模板：`/Users/a123/Downloads/Trade purchase.CN.xlsx`，SHA-256 `c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`
- profile JSON SHA-256：`c802c65b25c0539689bf112e93a61341dd0295551a440292b5297e8a4b8358e2`
- Node：v25.9.0；.NET SDK：10.0.402；ELK.js：0.12.0

## 1. 结论

V4 已把 V2/V3 的“固定 5 列网格 + 中心线连接”替换为：

```text
每条 lane 独立 ELK layered 布局
→ lane 内按边关系分层
→ 三条 lane 纵向堆叠
→ 节点尺寸按文本估算
→ A* 正交路由（节点/标签/图例为障碍）
→ 58 条原生 xdr:cxnSp（custGeom 折线 + stCxn/endCxn）
```

在生成文件的实际几何上：

```text
63 业务节点 / 58 连接器 / 15 分支标签
节点重叠 0
连接器穿越非端点节点 0
连接器穿越分支标签 0
文本溢出 0（10pt 估算）
Open XML SDK 0 errors
58/58 连接器两端绑定有效
V2 的 23 条 review edge 全部 clear
```

因此本阶段可以标记 **V4 自动几何验收 PASS**，但**不能**标记客户正式导出 PASS：

```text
edit_as = pending
exportReady = false
Mac Excel = NOT RUN
Windows Excel = NOT RUN
custom-geometry connector 的 Excel 编辑行为 = 未验收
```

## 2. V2 / V3 / V4 对比

| 项目 | V2 | V3 | V4 |
|---|---|---|---|
| 布局 | 固定 5 列 / lane 顺序 | lane 内 graph-rank + 5 列换行 | 每 lane ELK layered，再纵向堆叠 |
| 节点尺寸 | 固定 | 固定 | 按文本估算 |
| 连接器 | `bentConnector3` 中心线 | `bentConnector3` 中心线 | 正交 custGeom 折线 |
| 非端点节点穿越 | 23 | 39 | 0 |
| 文本溢出 | 0（报告口径） | 0 | 0（10pt 估算） |
| 分支标签 | 15 | 15 | 15，避开节点/连线 |
| 结构 | 78 sp / 58 cxn | 78 sp / 58 cxn | 87 sp（含泳道/图例）/ 58 cxn |

V2 的 23 条 review edge 在 V4 中全部为 `clear`：

```text
E004 E005 E006 E007 E010 E012 E016 E017 E023 E024 E029 E031
E038 E040 E042 E045 E047 E049 E050 E051 E054 E056 E058
```

## 3. 布局实现

- 引擎：ELK.js `0.12.0`，`elk.layered`，方向 `RIGHT`。
- 每条 lane 独立布局，输入该 lane 的节点和 lane 内边；三条 lane 之间没有跨 lane 边（本图 58 条边全部为 lane 内边）。
- 节点尺寸：
  - 按 11pt 文本和中文/英文宽度估算；
  - 长标签 220px 宽，短标签 165px 宽；
  - 高度按行数计算，最大约 118px。
- lane 堆叠：
  - lane 横向缩放到统一内容宽度 2400px；
  - lane 1/2 自然宽度较小，按比例横向拉伸，避免页面左侧堆积；
  - lane 标签使用 A 列合并单元格（深色填充、白色 12pt、水平换行）。
- 画布：
  - `2602 × 2036.5 px`（plan 像素）；
  - A3 landscape，`scale=48`，`fitToWidth=1`，`fitToHeight=1`；
  - 48% 下内容约 `936.7 × 733.1 pt`，加页边距约 `1037.5 × 841.1 pt`，落在 A3 `1191 × 842 pt` 内；
  - LibreOffice PDF 实测 1 页（辅助预览，不是 Excel 实测）。

## 4. 路由实现

- 由 lane 布局得到 source/target 的相对位置，选择端口：
  - 目标在右侧：`right → left`；
  - 目标在下方：`bottom → top`；
  - 其余：`top → bottom`。
- 先把简单路径作为候选（直线、L 形、Z 形），做障碍碰撞检查；失败后使用 A* 正交路由。
- 障碍：
  - 节点矩形；
  - 分支标签矩形；
  - 泳道标签；
  - 标题和图例。
- 路径全部为水平/垂直折线，禁止对角线段。
- 分支标签在路由完成后放置，避开节点、其他标签和所有连接线。
- 每条逻辑边只生成一个 `xdr:cxnSp`：
  - `a:custGeom` 折线；
  - `a:stCxn` / `a:endCxn` 指向真实 shape id；
  - 端点索引按所选边映射到 `top/left/bottom/right`。
- 路由结果：0 条 blocked，0 条 confirmed collision；2 条路径需要 6 个弯（A* 绕行）。

## 5. 形状映射

实际 `a:prstGeom/@prst` 计数（含图例）：

```text
rect 18（15 分支标签 + 3 泳道带）
flowChartTerminator 15（14 业务 + 1 图例）
flowChartProcess 20（18 业务 + 2 图例）
flowChartPredefinedProcess 12
flowChartDecision 9（8 业务 + 1 图例）
flowChartDocument 4（3 业务 + 1 图例）
flowChartInputOutput 2
flowChartMagneticDrum 2
flowChartConnector 5（4 控制标记 + 1 图例）
```

业务节点：

```text
terminator 14 / process 18 / predefined_process 12 / decision 8
document 3 / input_output 2 / database 2 / control marker 4
```

`CA/PRP/TOE` 对应的 4 个 `other` 节点已改为 `flowChartConnector` 绿色标记形状，不再使用普通 `flowChartProcess`；但其与业务节点的关联关系仍为 `unverified`。

## 6. 与原模板的差异 / 剩余 blocker

1. **custGeom connector 未在真实 Excel 中验收**：当前是原生 `xdr:cxnSp` 且绑定有效，但 Excel 对该自定义几何连接器的编辑/重排行为尚未验证。
2. **Mac / Windows Excel 均 NOT RUN**；V4 的自动预览不能替代 Excel 实测。
3. **正文 10pt**：为消除 5 行长标签的裁切风险，V4 使用 10pt；目标模板为 11pt。若必须严格 11pt，需要更高节点或分页。
4. **控制标记关联**：4 个 control marker 已使用独立绿色 `flowChartConnector`，但布局关联与 profile token 仍为 `unverified`。
5. **泳道**：使用 A 列合并标签 + 形状背景带；与模板“行带 + 单一 A8:A9 合并”不完全相同。
6. **图例**：6 项通用图例，形状/颜色对齐 profile，但层级未逐项复刻模板。
7. **`edit_as`**：全部 `twoCellAnchor`，未写显式 `editAs`，即默认 twoCell；`edit_as=pending`。
8. **正式导出 gate 仍关闭**：`exportReady=false`。
9. **尚未接入 website 导出路由**：V4 仍是 `tools/` 下的独立 POC 候选；网站正式导出继续使用原有 gate，未切到 V4。

## 7. 自动验收

```text
Node layout planner: 58/58 edges routed
A* blocked routes: 0
Open XML SDK: 0 errors
87 xdr:sp / 58 xdr:cxnSp
58/58 stCxn + endCxn
0 invalid endpoint references
0 xdr:pic / 0 media / 0 external links / 0 customXml
节点重叠 0
连接器穿越非端点节点 0（按生成文件的 marker + custGeom 路径）
连接器穿越分支标签 0
文本溢出 0（10pt 估算）
A3 landscape / paper 8 / scale 48 / fitToPage 1x1
print area A1:KU228
LibreOffice PDF: 1 页（辅助）
Node flowchart tests: 115 pass / 0 fail
npm test: 400 pass / 0 fail
.NET POC tests: 14 pass / 0 fail
V4 build: PASS
```

## 8. 文件

```text
~/Downloads/flowchart-excel-visual-fix-v4-2026-10-20/
├── flowchart-revision5-visual-fix-v4-default-twoCell.xlsx
├── export-layout.json
├── connector-routing-report.json
├── layout-validation-report.json
├── text-overflow-report.json
├── structure.json
├── sha256.txt
├── preview/
│   ├── visual-preview.png
│   ├── visual-preview-white.png
│   └── visual-preview-cropped.png
└── windows-target-style-acceptance-v4-2026-10-20.zip
```

XLSX SHA-256：

```text
c8605b9fafc0de21cb5fb26299db47f1d1d125c589f68dd4ef23a8e705aa95a1
```

## 9. 下一步

1. 在 Mac Excel 与 Windows Excel 打开 V4，确认 custGeom connector 可编辑、端点保持绑定、打印/分页符合预期。
2. 若 Excel 重排 custGeom 导致穿越，回退为 `bentConnector3/5` 或改为 Excel 原生正交 routing，并重新做碰撞检查。
3. 按目标模板确认 control marker 与业务节点的关联、图例层级和 11pt 文本策略。
4. 只有以上通过后，才允许把 `exportReady` 改为 true。

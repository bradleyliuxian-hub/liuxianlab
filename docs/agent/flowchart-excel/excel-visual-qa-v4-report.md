# Excel Visual QA — Slice 5.5 / V4

状态：**自动几何 QA PASS；客户正式导出仍 NOT ACCEPTED**

- 候选：`flowchart-revision5-visual-fix-v4-default-twoCell.xlsx`
- SHA-256：`c8605b9fafc0de21cb5fb26299db47f1d1d125c589f68dd4ef23a8e705aa95a1`
- 预览：`preview/visual-preview.png`、`visual-preview-white.png`、`visual-preview-cropped.png`
- 预览工具：LibreOffice headless → PDF → PNG；仅辅助，不等同 Excel 实测
- PDF 页数：1（LibreOffice）

## 对照模板 profile

| 项目 | 模板 profile | V4 | 结果 |
|---|---|---|---|
| A3 横向 / scale 48 | 要求 | 已设置，fitToPage 1x1 | PASS |
| 打印区域 | 明确区域 | `A1:KU228` | PASS（结构） |
| 原生 shape/connector | 必须 | 87 sp / 58 cxn | PASS |
| 58/58 connector 绑定 | 必须 | 58/58 | PASS |
| 图片替代 | 禁止 | 0 | PASS |
| 外链/customXml | 禁止 | 0 / 0 | PASS |
| 节点重叠 | 0 | 0 | PASS |
| 连接器穿越非端点节点 | 0 confirmed | 0 | PASS（生成几何） |
| 文本溢出 | 0 | 0（10pt 估算） | PASS（估算） |
| 分支标签 | 独立矩形 | 15 个独立 rect | PASS |
| 泳道 | 行带 + 标签 | A 列合并标签 + 形状背景带 | 部分 PASS |
| 图例 | 模板层级 | 6 项通用图例 | 部分 PASS |
| CA/PRP/TOE | 模板控制标记 | 4 个绿色 `flowChartConnector` | 样式 PASS / 关联 unverified |
| 正文 11pt | 模板 | 10pt（防裁切） | 偏差 |
| Mac/Windows Excel | 实测 | NOT RUN | FAIL/未验收 |
| custGeom connector 编辑 | 实测 | NOT RUN | 未验收 |

## 预览观察

- 三条泳道独立分层，主流程自左向右，lane 3 的密集节点仍保持可读。
- 连接器全部为正交折线，未观察到穿越节点或分支标签。
- 分支标签位于连线附近，未覆盖节点。
- 控制标记集中在 lane 3 顶部，绿色，与普通活动区分。
- 整页视图下文字仍偏小；这是 A3 单页 + 63 节点 + 48% 打印缩放的结构性限制。

## 结论

```text
visual QA (automatic geometry) = PASS
visual QA (real Excel Mac/Windows) = NOT RUN
formal customer export = NOT ACCEPTED
edit_as = pending
exportReady = false
```

V4 只作为实验候选。正式导出前必须完成真实 Excel 验收，尤其是 custGeom connector 的编辑与打印行为。

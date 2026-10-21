# V4 形状语义映射与目标样式核对

- 日期：2026-10-20
- 输入：approved graph revision 5（3 lanes / 63 nodes / 58 edges）
- 输出：`flowchart-revision5-visual-fix-v4-default-twoCell.xlsx`
- 目标 profile：`trade-purchase-template-profile.json`（SHA-256 `c802c65b25c0539689bf112e93a61341dd0295551a440292b5297e8a4b8358e2`）

## 业务节点映射

| 业务 shape | 数量 | 输出 `a:prstGeom/@prst` | 结果 |
|---|---:|---|---|
| terminator | 14 | `flowChartTerminator` | PASS |
| process | 18 | `flowChartProcess` | PASS |
| predefined_process | 12 | `flowChartPredefinedProcess` | PASS |
| decision | 8 | `flowChartDecision` | PASS |
| document | 3 | `flowChartDocument` | PASS |
| input_output | 2 | `flowChartInputOutput` | PASS |
| database | 2 | `flowChartMagneticDrum` | PASS |
| other / control marker | 4 | `flowChartConnector` | 样式 PASS；关联 `unverified` |

## 辅助形状

```text
rect 15        分支标签（Yes/No）
rect 3         泳道背景带
rect 6         图例项（含 terminator/process/decision/document/connector）
```

实际 preset 总计：

```text
rect 18
flowChartTerminator 15
flowChartProcess 20
flowChartPredefinedProcess 12
flowChartDecision 9
flowChartDocument 4
flowChartInputOutput 2
flowChartMagneticDrum 2
flowChartConnector 5
```

## 颜色与线条

- 普通活动 / 终止 / 预定义 / 输入输出 / 数据库：`D9E2F3`（浅蓝）。
- Document：`FFFF00`。
- Control marker：`92D050`。
- Preparation：`FF0000`（本图无该业务 shape）。
- 节点线：`4472C4`，`12700 EMU`（1pt）。
- 连接器线：`4472C4`，`28575 EMU`（2.25pt），尾部三角箭头。
- 节点/连接器：`outerShdw` blur 50800、dist 38100、dir 2700000、black alpha 40000。
- 字体：`Microsoft YaHei UI`；节点 10pt（为消除长文本裁切，低于模板 11pt）；分支标签 9pt；泳道 12pt；标题 24pt；图例 10pt。
- 文本：水平居中、垂直居中、`wrap=square`。

## 未通过 / 未验证

1. 控制标记与业务节点的关联关系未在 profile 中证实，标记为 `unverified`。
2. 10pt 正文与模板 11pt 不一致；严格 11pt 需要更大节点或分页。
3. 图例为通用 6 项，未逐项复刻模板的完整层级。
4. 泳道使用 A 列合并标签 + 形状背景带；模板只存在 `A8:A9` 合并，视觉实现不完全相同。
5. Decision 的实际填充仍按浅蓝处理；模板依赖 style/主题，未做逐像素比对。

# Shape Style Mapping Report — V3

来源：approved graph revision 5，V3 XLSX DrawingML 实际解析。

## 业务语义 → preset

| Graph shape | Preset | V3 count | 结果 |
|---|---|---:|---|
| terminator | `flowChartTerminator` | 14 | PASS |
| process | `flowChartProcess` | 18 business（另有 4 control marker 也落入此 preset） | business PASS |
| predefined_process | `flowChartPredefinedProcess` | 12 | PASS |
| decision | `flowChartDecision` | 8 | PASS |
| document | `flowChartDocument` | 3 | PASS |
| input_output | `flowChartInputOutput` | 2 | PASS |
| database | `flowChartMagneticDrum` | 2 | PASS |
| other/control marker | `flowChartProcess` | 4 | **FAIL** |
| edge label | `rect` | 15 | 结构通过，位置仍需视觉复核 |

## 控制标记

V3 中 N060–N063：

```text
flowChartProcess
D9E2F3 fill
普通节点文字
```

它们不是目标模板的 CA/PRP/TOE 独立图形，也没有经过 profile 确认的控制标记 token。

结论：**控制标记映射 FAIL**。不能把旧 sales flowchart 红/绿/黄样式直接套用；必须先由目标模板/profile 确认形状和颜色。

## 填充/文本

V3 实际：

```text
D9E2F3 shape fill: 75（含业务节点/标签/控制标记）
FFFF00 document fill: 3
```

目标模板常见主题 `accent1` + lumMod/lumOff 与显式 document/preparation 颜色并未完全以 DrawingML token 复现。
目标样式仍为 **partial/unverified**。

## 分支标签

15 条 graph edge 有 label，V3 生成 15 个 `rect` 形状：

```text
E006 No, E007 Yes, E012 Yes, E013 No, E016 Yes, E017 No,
E024 Yes, E025 No, E028 Yes, E029 No, E033 Yes, E040 Yes,
E042 No, E046 Yes, E047 No
```

结构上每条标签对应真实 edge，但标签中心线避障和最终 Excel 视觉仍未人工验收。

## 结论

- 业务活动/决策/文档/IO/数据存储 preset 基本正确；
- 控制标记仍错误；
- 分支标签已生成但需位置复核；
- 目标模板颜色/字体/阴影 token 未完全落实；
- 不能标记 shape-style QA PASS。

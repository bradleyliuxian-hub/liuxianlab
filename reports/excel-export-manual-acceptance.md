# Excel Export Manual Acceptance — 63 节点 / 58 连线

状态：**PARTIAL — Mac A/B PASS；Windows NOT RUN；视觉 QA FAIL；正式导出关闭**

- 业务图：job `551a6811-52aa-40ba-a790-b472e695b549`
- revision：5
- 数量：3 lanes / 63 nodes / 58 edges
- 模板：`Trade purchase.CN.xlsx`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

## 文件

```text
~/Downloads/flowchart-excel-anchor-validation-2026-10-20/
├── flowchart-revision5-anchor-default-twoCell.xlsx
├── flowchart-revision5-anchor-oneCell.xlsx
├── A-after-move-layout-save.xlsx
├── B-after-move-layout-save.xlsx
├── A-structure.json
├── B-structure.json
├── A-after-save-structure.json
├── B-after-save-structure.json
├── preview/
└── windows-target-style-acceptance-2026-10-20.zip
```

## Mac Excel 16.113.1

对 A/B 分别执行：

| 步骤 | A | B |
|---|---|---|
| 打开、无修复提示 | PASS（自动化未报错） | PASS（自动化未报错） |
| 移动 N001/N002/N004/N063 | PASS | PASS |
| 58/58 连接器移动后绑定 | PASS | PASS |
| 保存、关闭、重开 | PASS | PASS |
| 重开后 58/58 绑定 | PASS | PASS |
| 调整 1:20 行高、A:P 列宽 | PASS | PASS |
| 调整后 58/58 绑定 | PASS | PASS |
| A3 打印预览 | NOT RUN（仅 PDF 辅助预览） | NOT RUN（仅 PDF 辅助预览） |
| 保存后 OpenXML 结构 | 63 shapes / 58 connectors / 0 errors | 同 A |
| marker/xfrm 保存后差异 | 0/121 | 89/121 |

## Windows

状态：**NOT RUN**。使用 `windows-target-style-acceptance-2026-10-20.zip`，不得伪造结果。

## 视觉 QA

状态：**FAIL**。预览显示标题裁切、节点文字重叠、连接线穿越、泳道/图例/分支标签/控制标记未按目标模板层级生成。详见：

```text
docs/agent/flowchart-excel/excel-visual-qa-report.md
```

## 结论

```text
Mac A/B connector stability: PASS
Windows: NOT RUN
Visual QA: FAIL
edit_as: pending
exportReady: false
formal customer XLSX: NOT GENERATED
```

实验候选可下载，但不能作为正式客户结果。


## Slice 5.4 V3

状态：**NOT RUN**（新 V3 候选未做 Mac/Windows Excel 实测）。

V3：

```text
flowchart-revision5-visual-fix-v3-default-twoCell.xlsx
SHA-256 677b9882cdb5d8f9385a555e3ee55777cfcb291d38a4008640bef5e9593cb97b
```

结构 63/58 通过；节点重叠 0、文本溢出 0；近似连接线穿越 39；视觉 QA FAIL。
Windows 验收包：`~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/windows-target-style-acceptance-v3-2026-10-20.zip`。

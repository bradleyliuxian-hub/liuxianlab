# Anchor Variant Comparison — Slice 5

- 日期：2026-10-20
- 项目：`/Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc`
- 目标模板：`/Users/a123/Downloads/Trade purchase.CN.xlsx`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

## 1. 生成变体

两个变体使用同一 3 节点 / 2 逻辑边样例和同一网格，只改变 anchor 的 `editAs`：

```text
A: output/anchor-comparison/two-cell-anchor-default-editAs.xlsx
B: output/anchor-comparison/two-cell-anchor-oneCell.xlsx
```

文件 SHA-256：

```text
A 0c181c0a5285b72d53b2382801e58d4d0c7a7a4cb0b544ae9ae84799d9cb6441
B 4874115b82a4256f38b7e3eb4813eac4dbafd9fbe6dd31811a1ce7b0623f67a1
```

## 2. 自动结构结果

| 检查 | A（无 editAs） | B（oneCell） |
|---|---|---|
| `xdr:twoCellAnchor` | 5 | 5 |
| `xdr:sp` | 3 | 3 |
| `xdr:cxnSp` | 2 | 2 |
| `stCxn` / `endCxn` | 2 / 2 | 2 / 2 |
| 引用真实 shape | PASS | PASS |
| 每逻辑边一个 connector | PASS | PASS |
| 图片对象 | 0 | 0 |
| Open XML SDK validator | 0 errors | 0 errors |
| ZIP 完整性 | PASS | PASS |
| `editAs` | 未写（模板默认语义） | `oneCell` |

完整命令输出：

```text
dotnet test FlowchartExcelExporter.slnx -c Release
14/14 PASS
```

## 3. 真实 Excel 验收状态

| 变体 | macOS Excel | Windows Excel | 结论 |
|---|---|---|---|
| A（无 editAs） | PASS（移动、保存、重开、行高/列宽后连接器绑定） | NOT RUN | Mac 通过，Windows 待验 |
| B（oneCell） | PASS（移动、保存、重开、行高/列宽后连接器绑定；节点尺寸不变） | NOT RUN | Mac 通过，Windows 待验 |

Mac 环境：Microsoft Excel for Mac 16.113.1。

Target-style candidate（从 reviewed graph 生成）A 也已在 Mac 上执行：打开、移动 N001、保存、关闭、重开，E001 `begin/end connected=true`。Windows 仍 NOT RUN。

目标模板的 165 个绘图对象均使用 `twoCellAnchor` 且没有显式 `editAs`，但这只是 OOXML 事实，不等于已验证目标模板默认语义的拖动/保存/重开行为。

## 4. 决策

```text
profile.anchor.type = twoCellAnchor
profile.anchor.explicit_edit_as = null
profile.anchor.production_edit_as = pending
profile.status.production_anchor_confirmed = false
```

Gate C 未通过：

- 缺少 A/B 本次文件的 Mac/Windows 真实 Excel 验收；
- 不能把 `edit_as` 改成 confirmed；
- 不能把 `exportReady` 改为 true；
- 不能生成正式客户 XLSX。

## 5. 待执行手工验收

对 A、B 分别执行：

1. Excel 打开无修复提示；
2. 移动 Start/Process/End；
3. 检查两条 connector 仍绑定；
4. 保存、关闭、重开，再检查绑定；
5. 调整行高、列宽，检查节点与 connector；
6. 检查泳道/合并区域；
7. 记录 Excel 版本与结果。

未执行项必须保持 NOT RUN。

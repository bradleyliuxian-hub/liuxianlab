# Slice 5.1 — Anchor 定版与目标样式验收

- 日期：2026-10-20
- 网站：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- 分支：`main`
- HEAD：`ea3a3127881393f1eae1542419268b571a8e79f6`
- dirty：29 项（本轮未 reset/clean/stash/checkout/restore）
- 8080：`{"ok":true}`，未重启
- 结论：**Anchor 未定版；`edit_as=pending`，`exportReady=false`。**

---

## 1. 输入核验

### Approved graph

```text
job: 551a6811-52aa-40ba-a790-b472e695b549
review revision: 5
review status: review_approved
reviewed graph: storage/.../review/flowchart.reviewed.json
reviewed graph SHA-256: e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68
lanes/nodes/edges: 3 / 63 / 58
issues: 22 waived
blocking pending: 0
template_profile_id: trade_purchase_cn
edit_as: pending
exportReady: false
```

### 目标模板

```text
Trade purchase.CN.xlsx
SHA-256: c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80
```

### 当前实验候选

```text
artifact: xlsx-candidate
SHA-256: 355ec6eba04080e746e0aef4f0df87cbd33272dc925789d7b2959b0cfb423eb7
size: 14145 bytes
```

未覆盖该候选、approved graph、revisions 或外部 ZIP。

---

## 2. A/B 候选

目录：

```text
~/Downloads/flowchart-excel-anchor-validation-2026-10-20/
```

文件：

```text
A: flowchart-revision5-anchor-default-twoCell.xlsx
   SHA-256 9b712b47ada34f041ac0bc9ff3f34de05ee6c36ac4d33c00defa91c34fe05ecf

B: flowchart-revision5-anchor-oneCell.xlsx
   SHA-256 946b2662b7bc29df65ce99286786499198a9200003ac4dd11fe5f5b243506058
```

差异：

```text
A: twoCellAnchor，不写 editAs（目标模板默认语义）
B: twoCellAnchor editAs="oneCell"
```

除 `editAs` 外，Drawing XML 归一化签名相同：

```text
A/B normalized drawing SHA-256: 33ef7dfcbfeb53bdd91771d18eb612a2fa45fa719209aedb6de05c22cc7ad8a5
```

即业务 graph、shape IDs、节点位置、样式与打印设置一致。

---

## 3. 自动结构验收

| 检查 | A | B |
|---|---|---|
| ZIP 完整 / content types | PASS | PASS |
| Drawing relationship | PASS | PASS |
| Open XML SDK validator | 0 errors | 0 errors |
| `xdr:sp` | 63 | 63 |
| `xdr:cxnSp` | 58 | 58 |
| Shape IDs unique | PASS | PASS |
| Connector IDs unique | PASS | PASS |
| 58/58 stCxn + endCxn | PASS | PASS |
| 端点指向真实 shape | PASS | PASS |
| `xdr:pic` / media | 0 / 0 | 0 / 0 |
| external links / customXml | 0 / 0 | 0 / 0 |
| A3 landscape / scale 48（结构） | PASS | PASS |
| Excel A3 打印预览 | NOT RUN | NOT RUN |
| print area | `'Flowchart Review'!$A$1:$AF$40` | 同 A |
| marker/xfrm 差异（初始） | 0/121 | 0/121 |
| marker/xfrm 差异（Mac 保存后） | 0/121 | 89/121 |

结构日志：

```text
A-structure.json
B-structure.json
A-after-save-structure.json
B-after-save-structure.json
```

---

## 4. Mac Excel 实测

环境：

```text
macOS 15.5 / Apple M4
Microsoft Excel for Mac 16.113.1
```

对 A/B 分别执行：

- 移动 N001、N002、N004、N063；
- 检查 58 条连接器绑定；
- 保存、关闭、重新打开；
- 调整 1:20 行高、A:P 列宽；
- 再检查 58 条连接器。

说明：Excel 打开文件未弹出自动修复对话框；这是自动化打开结果，不是逐像素/弹窗截图证据。A3 打印预览未在 Excel 中人工检查。

结果：

```text
A MOVE: badBefore=0, badAfterMove=0
A REOPEN/LAYOUT: badAfterReopen=0, badAfterLayout=0

B MOVE: badBefore=0, badAfterMove=0
B REOPEN/LAYOUT: badAfterReopen=0, badAfterLayout=0
```

保存后结构：

```text
A: 63 shapes / 58 connectors / 58 bound / 0 OpenXML errors
B: 63 shapes / 58 connectors / 58 bound / 0 OpenXML errors
```

Mac 结论：**A PASS / B PASS**。

注意：Mac 保存后 B 出现 **89/121** 个 marker 与 `a:xfrm` 差异；A 为 0/121。
这不影响连接器绑定，但影响后续几何一致性和重导入可靠性，是 anchor 决策的重要差异。

---

## 5. Windows Excel 实测

状态：**NOT RUN**

已生成验收包：

```text
~/Downloads/flowchart-excel-anchor-validation-2026-10-20/windows-target-style-acceptance-2026-10-20.zip
```

包内包含 A/B、Mac 保存后参考副本、结构 JSON、SHA-256 和逐步清单。

未伪造 Windows 版本、步骤或结果。

---

## 6. 视觉 QA

预览：

```text
preview/flowchart-revision5-anchor-default-twoCell.pdf
preview/A-preview.png
```

预览由 LibreOffice 生成，仅作辅助，不等于 Excel 实测。

结论：**FAIL / NOT ACCEPTED**。

主要问题：

1. 标题被裁切，顶部区域文字溢出；
2. 多个节点/文字在顶部重叠；
3. 连接线穿越节点或文字，缺少避障；
4. 判断分支标签没有按目标样式独立布局（当前 exporter 未生成独立分支标签形状）；
5. 泳道仍是 POC 的 `A5:B15` 合并方式，不是目标模板 `A6/A7/A8:A9` 行带 + A 列标签；
6. 图例是 POC 通用图例，不是目标模板图例层级；
7. CA/PRP/TOE 控制标记仍作为普通节点/文字，未按目标模板的实际标记样式生成；
8. 长文本没有自动扩大节点或可靠换行，存在截断。

通过项：

- A3 横向、scale 48；
- 原生 shape/connector、无图片；
- 所有连接器绑定；
- 未复制模板采购示例、Remove before use、external links、customXml。

因此实验候选不能作为正式目标样式 XLSX。

---

## 7. Anchor 决策

当前决策：**pending**。

| 维度 | A（默认 twoCell） | B（oneCell） |
|---|---|---|
| 目标模板忠实度 | 高（模板无显式 editAs） | 低/需偏离模板 |
| Mac 拖拽/保存/重开 | PASS | PASS |
| 移动后绑定 | PASS | PASS |
| 行列调整后绑定 | PASS | PASS |
| marker/xfrm 保存后一致性 | 0/121 差异 | 89/121 差异 |
| 节点尺寸稳定性 | 默认语义可能随行列变化 | 尺寸更稳定 |
| Windows | NOT RUN | NOT RUN |
| 视觉 QA | FAIL | FAIL |

倾向：**A 是更忠实的目标模板候选**，但 Windows 未实测且视觉 QA 失败，不能定版。
不修改 `edit_as`，不打开 `exportReady`。

---

## 8. 唯一剩余阻塞

1. Windows Excel 对 A/B 的完整 63/58 验收（已准备包，NOT RUN）。
2. 目标样式视觉修复：泳道、图例、分支标签、控制标记、文字溢出/避障、标题裁切。
3. 修复后才能重新生成 A/B 并复验。

当前仍允许下载实验 XLSX，但不得称为正式客户产物。

---

## 9. 测试结果

```text
Node flowchart: 115 pass / 0 fail
npm test: 400 pass / 0 fail
.NET POC: 14/14 pass
Open XML SDK A/B: 0 errors
```

8090/8080 未使用新端口；8080 health 正常，未重启。

---

## 10. 报告与证据

```text
~/Downloads/flowchart-excel-anchor-validation-2026-10-20/
├── A-structure.json
├── B-structure.json
├── A-after-save-structure.json
├── B-after-save-structure.json
├── after-mac-save/
├── preview/
├── windows-acceptance/
├── windows-target-style-acceptance-2026-10-20.zip
├── sha256.txt
├── flowchart-revision5-anchor-default-twoCell.xlsx
└── flowchart-revision5-anchor-oneCell.xlsx
```

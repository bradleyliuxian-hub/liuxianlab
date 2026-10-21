# Excel Visual QA — Slice 5.1

状态：**FAIL / NOT ACCEPTED for formal export**

- 候选：`flowchart-revision5-anchor-default-twoCell.xlsx`
- 预览：`~/Downloads/flowchart-excel-anchor-validation-2026-10-20/preview/A-preview.png`
- 预览工具：LibreOffice headless → PDF → PNG
- 注意：预览只作辅助，不等同于 Excel 实测。

## 对照模板 profile

| 项目 | 模板 profile | 当前候选 | 结果 |
|---|---|---|---|
| A3 横向 / scale 48 | 要求 | 已设置 | PASS |
| print area | 目标有明确区域 | `A1:AF40` | PASS（结构存在） |
| 原生 shape/connector | 必须 | 63 / 58 | PASS |
| 58/58 connector 绑定 | 必须 | 58/58 | PASS |
| 图片替代 | 禁止 | 0 | PASS |
| 模板示例文字/外链/customXml | 禁止复制 | 未发现 | PASS |
| 泳道实现 | A 列行带 + 行高；仅 A8:A9 合并 | POC 的 A5:B15 合并 + 单一标签 | FAIL |
| 图例 | 模板层级 | POC 通用图例 | FAIL |
| 分支“是/否”标签 | 独立小矩形 | 当前 exporter 未生成独立分支标签形状 | FAIL |
| CA/PRP/TOE | 目标模板实际标记 | 仍为普通节点/文字 | FAIL |
| 长文本/换行 | 目标字号/边距/换行 | 顶部文字裁切、节点重叠 | FAIL |
| 连接线避障 | 不穿节点/文字 | 多处穿越 | FAIL |
| 标题/顶部布局 | 目标版面 | 标题被裁切 | FAIL |
| 节点尺寸 | 目标语义 | 尚未定版 | UNKNOWN |

## 预览观察

1. 左上标题被裁切。
2. 顶部多个节点/文字重叠。
3. 连接器穿过节点/文字。
4. 泳道/图例/控制标记没有按目标模板层级生成。
5. 分支标签没有独立文本框。
6. A3 输出可打开/可打印，但业务可读性不达标。

## 结论

当前候选仅能作为：

```text
experimental candidate
```

不能作为正式客户 XLSX。必须在修复布局、泳道、图例、分支标签、控制标记、文字溢出/避障后重新生成并 QA。

---

## Slice 5.2 update — 2026-10-20

新候选：

```text
flowchart-revision5-visual-fix-default-twoCell.xlsx
SHA-256 e876cc2cbbcc49ef832d7446ed697f60f36876193ef03ac8d0ea34dee16751f4
```

自动结果：

```text
63 business nodes + 15 branch labels = 78 xdr:sp
58 xdr:cxnSp / 58 bound / 0 Open XML errors / 0 images
node overlaps 0 / outside print area 0
text overflow 13
approximate connector/non-endpoint-node crossings 61
```

视觉 QA 结果：**FAIL — NOT ACCEPTED**。

已改善：标题不再被裁切；节点矩形无重叠；泳道标签行、分支标签形状和独立布局计划已生成。

仍失败：13 条文本溢出、61 条近似连线穿越、CA/PRP/TOE 样式、图例层级、泳道行号/样式未达到目标模板。

预览仍为 LibreOffice 辅助，不等同于 Excel 实测；正式导出保持关闭。

---

## Slice 5.3 update — v2 画布/可读性

新候选：

```text
flowchart-revision5-visual-fix-v2-default-twoCell.xlsx
SHA-256 85bde120538b18df74db1f7e10304a2cc03584e5e63a12e793f65374e5c8a892
```

黑色区域诊断：

- 视觉预览 PNG 为 1191×842 RGBA，alpha_min=0；
- 黑色是查看器对透明 alpha 的显示，不是 Excel 背景或模板颜色；
- 内容 bbox (50,53)-(917,783)，占页面约 73% 宽 / 87% 高；
- 已生成白色扁平化和裁切预览。

自动结果：

```text
78 xdr:sp（63 业务节点 + 15 分支标签）
58 xdr:cxnSp / 58 bound / 0 Open XML errors
0 图片 / 0 外链 / 0 customXml
节点重叠 0 / 超出打印区域 0
文本溢出 0（Slice 5.2 为 13）
近似连接线穿越 23（Slice 5.2 为 61）
```

视觉 QA 仍为 **FAIL**：23 条近似连线穿越、泳道标签可读性、CA/PRP/TOE 样式、图例层级和目标模板 token 对齐仍未完成；Mac/Windows 新候选均未实测。

正式导出继续关闭：`edit_as=pending`、`exportReady=false`。

---

## Slice 5.4 update — V3 graph-rank

V3 使用 lane 内 incoming-edge rank 排序，不再按 node ID 机械填充；结构仍为 63 business + 15 labels / 58 connectors，节点重叠 0、文本溢出 0、Open XML 0 errors。近似连接线 review 从 V2 的 23 增加到 39：V2 23 条中 8 条变 clear、15 条仍 review，同时新增 24 条。

控制标记、图例、泳道和目标模板样式仍未完成；V3 Mac/Windows Excel 均 NOT RUN。视觉 QA 继续 FAIL，`exportReady=false`。

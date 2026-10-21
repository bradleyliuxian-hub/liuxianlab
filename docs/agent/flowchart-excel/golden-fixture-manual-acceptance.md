# Golden Fixture — Mac / Windows Excel Manual Acceptance

- 日期：2026-10-21
- 文件：`/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/golden-fixture-package-repaired.xlsx`
- SHA-256：`3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32`
- 当前状态：**Mac = NOT RUN / Windows = NOT RUN**
- 本文件只定义验收步骤；未执行的结果不得写成 PASS。
- 不要使用 `output/golden-fixture-default-twoCell.xlsx`：该原始文件已确认包结构缺陷并保留为修复证据。
- 原始文件 SHA-256：`dfedfd79e0ad0f7a6b7c85821f32b33545b057cb122de5fb0a3f6f4312896357`

## 0. 前置约束

- 只打开 fixture XLSX，不打开 63 节点客户候选。
- 不修改 approved graph、revision 5、网站 `exportReady` 或 `edit_as`。
- 不提交、不推送、不重启 8080。
- 验收失败时保留失败的 XLSX、保存后副本、截图和 Excel 版本，不要删除证据，不要放宽阈值。

## 1. 记录环境

```text
macOS 版本：
Excel for Mac 版本 / build：
Windows 版本：
Excel for Windows 版本 / build：
验收人：
验收时间：
```

## 2. 打开文件

1. 双击 `golden-fixture-package-repaired.xlsx`。
2. 确认 Excel 没有弹出“修复/恢复”对话框。
3. 确认工作表名称是 `Golden Fixture`。
4. 确认画布是 A3 横向、fit-to-page、单页视图（打印预览另测）。
5. 记录标题、两条泳道标签是否可见：
   - 标题：`Golden Fixture — 9 节点合成流程图（无客户数据）`
   - LANE_A：`业务处理`
   - LANE_B：`财务控制`

> 文件使用模板 token `Microsoft YaHei UI`。如果本机没有该字体，Excel 可能替换字体；请记录实际显示字体和中文是否正常。LibreOffice headless 预览无法渲染该字体的中文字形，不能据此判定 Excel 失败。

## 3. 结构检查

| 检查 | 期望 |
|---|---|
| 业务节点数 | 9 个 shape |
| 连接器数 | 9 个 connector |
| G01 | terminator，文本 `Start` |
| G03 | decision 菱形，文本 `资料是否完整？` |
| G07 | document 形状，黄色填充，文本 `归档审批及相关凭证文件` |
| G08 | process，长中文文本，约 3 行换行 |
| G09 | 绿色 `flowChartConnector`，文本 `控制点 CA1`，位于 LANE_B |
| 分支标签 | `是` / `否` 两个独立标签 |
| 泳道 | A 列标签 `A17:A58` / `A60:A84` |
| 图形替代 | 无图片、无外链、无模板采购示例文字 |

## 4. 连接器绑定检查

对 9 条边逐条选中 connector，检查：

1. connector 是单个对象，不是多条独立 line。
2. 起点/终点落在对应节点的边中心：
   - GE01 G01 right → G02 left
   - GE02 G02 right → G03 left
   - GE03 G03 bottom → G04 top
   - GE04 G03 right → G05 left
   - GE05 G04 left → G02 left（回接）
   - GE06 G05 right → G06 left
   - GE07 G06 right → G07 left
   - GE08 G08 top → G06 bottom
   - GE09 G07 bottom → G09 top（跨泳道）
3. 端点与节点的距离应为 0px；不应出现 8px 外间隙。
4. 线型应为正交折线，不应出现斜线。
5. 连接线不应穿越非端点节点。

连接器 ID 映射见 `golden-fixture-connector-map.md`。

## 5. 拖拽 / 保存 / 重开

分别执行以下操作：

```text
1. 移动 G02 一个节点宽度
2. 移动 G06 一个节点高度
3. 移动 G07（跨泳道边的起点）
4. 移动 G09（控制标记）
5. 保存
6. 关闭
7. 重新打开
8. 再移动 G07 和 G09
```

每步记录：

```text
9 条 connector 是否仍为 9 条：
每条 connector 是否仍有且只有一个起点/终点绑定：
端点是否仍在正确连接点：
GE09 是否跳到 flowChartConnector 的其他 site 或脱离：
是否出现自动修复、拆分、丢失：
```

**GE09 是重点风险项。** `flowChartConnector` 的 connection site index 没有模板绑定证据；如果 Excel 在移动/重开后改变 GE09 的端点，记录为 `indeterminate → FAIL`，不要写成 PASS。

保存后请保留副本：

```text
golden-fixture-after-mac-save.xlsx
golden-fixture-after-windows-save.xlsx
```

并重新计算 SHA-256。

## 6. 打印预览

1. 打开打印预览。
2. 确认 A3 横向、缩放/适应页面行为与设置一致。
3. 确认是否单页；若变成多页，记录页数和断点。
4. 检查 11pt 正文字号在纸面上的可读性；记录是否接近不可读（48% 时约 5.28pt）。
5. 确认标题、泳道标签、G08 长文本没有被裁切。
6. 记录打印预览截图。

本阶段不比较单页/多页/总览+详情方案；那是 Phase 7。这里只记录事实。

## 7. 结果记录

请将结果补到：

```text
docs/agent/flowchart-excel/golden-fixture-phase1-report.md
```

建议格式：

```text
Mac Excel version:
Mac open/no-repair:
Mac shape/connector count:
Mac drag/save/reopen:
Mac GE09 behavior:
Mac print preview:
Windows Excel version:
Windows open/no-repair:
Windows shape/connector count:
Windows drag/save/reopen:
Windows GE09 behavior:
Windows print preview:
```

在真实 Mac/Windows 结果补齐前，Phase 1 的 Excel 状态保持：

```text
Mac Excel     = NOT RUN
Windows Excel = NOT RUN
connector spike = NOT STARTED
```

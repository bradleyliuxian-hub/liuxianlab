# 流程图转 Excel — Phase 0 只读基线与根因审计

- 版本：replan 2.0 / Phase 0
- 日期：2026-10-21
- 仓库：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- 分支 / HEAD：`main` / `28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- 工作区：dirty 17 项（9 个已跟踪文件修改 + 8 个未跟踪目录/文件），均为审计前既有改动
- 网站：本轮未重启、未部署；8080 为上一轮已启动状态
- 结论：**只读审计完成。V4 的结构与自动几何指标可复现，但“模板驱动、Excel 绑定几何、打印可读性、真实 Excel 验收”四项均未成立。等待审阅，不进入 Phase 1。**

证据标签：

- `current-code`：本轮实际读取的实现文件。
- `artifact`：本轮实际解析的生成物/报告 JSON。
- `documented`：仅来自既有报告或文档，未在本轮重跑。
- `inferred`：基于 OOXML/Excel 行为的推断，未在真实 Excel 中复现。
- `unverified`：没有真实 Excel 证据。

---

## 0. 审计结论

V4 不是“已经接近完成、只差验收”，而是仍有四个结构性缺口：

1. **目标模板 profile 没有驱动输出。** `Program.cs` 只对 profile 做 SHA-256，没有读取其中任何样式、泳道、图例、打印或连接点属性。当前所有样式都是 `build-layout.js` 和 `Program.cs` 里的硬编码。
2. **58 条连接器的 DrawingML 几何端点与绑定连接点不一致。** 所有 58 条边的 custGeom 端点都在绑定侧中心之外：固定 8px 间隙 + 最多 22px 的侧向偏移，最大偏差 23.4px；`a:stCxn` / `a:endCxn` 却绑定到侧中心索引。ID 绑定通过，不代表连接语义通过。
3. **打印语义与模板不同。** V4 没有 `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`，只有 `scale=48` 和 `fitToWidth/fitToHeight` 属性；模板本身使用 `fitToPage=1`。同时 10pt × 48% 的纸面等效字号约 4.8pt，A3 横向高度只剩约 0.9pt 余量。
4. **“自动 QA PASS”是自证式通过。** 校验器只有 `clear` / `confirmed_collision`，没有 `indeterminate`；连接器报告却明确写了 `indeterminate = 58`。V4 的 Mac/Windows Excel 实测均为 `NOT RUN`。

因此 V2/V3/V4 的反复失败不能归因于“布局算法还不够好”，而是同一轮同时改布局、路由、样式、打印和绑定，且没有先用 8–10 节点金样隔离根因。

---

## 1. V1–V4 文件、报告与 SHA-256

### 1.1 候选工作簿

| 版本 | 文件 | SHA-256 |
|---|---|---|
| V1 | `~/Downloads/flowchart-excel-visual-fix-2026-10-20/flowchart-revision5-visual-fix-default-twoCell.xlsx` | `e876cc2cbbcc49ef832d7446ed697f60f36876193ef03ac8d0ea34dee16751f4` |
| V2 | `~/Downloads/flowchart-excel-visual-fix-v2-2026-10-20/flowchart-revision5-visual-fix-v2-default-twoCell.xlsx` | `85bde120538b18df74db1f7e10304a2cc03584e5e63a12e793f65374e5c8a892` |
| V3 | `~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/flowchart-revision5-visual-fix-v3-default-twoCell.xlsx` | `677b9882cdb5d8f9385a555e3ee55777cfcb291d38a4008640bef5e9593cb97b` |
| V4 | `~/Downloads/flowchart-excel-visual-fix-v4-2026-10-20/flowchart-revision5-visual-fix-v4-default-twoCell.xlsx` | `c8605b9fafc0de21cb5fb26299db47f1d1d125c589f68dd4ef23a8e705aa95a1` |

### 1.2 相邻基线

| 项目 | 文件 | SHA-256 |
|---|---|---|
| 目标模板 | `~/Downloads/Trade purchase.CN.xlsx` | `c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80` |
| 模板 profile | `~/Downloads/flowchart-excel-trade-purchase-template-profile-2026-10-20.json` | `c802c65b25c0539689bf112e93a61341dd0295551a440292b5297e8a4b8358e2` |
| Anchor A（旧候选） | `~/Downloads/flowchart-excel-anchor-validation-2026-10-20/flowchart-revision5-anchor-default-twoCell.xlsx` | `9b712b47ada34f041ac0bc9ff3f34de05ee6c36ac4d33c00defa91c34fe05ecf` |
| Anchor B（旧候选） | `~/Downloads/flowchart-excel-anchor-validation-2026-10-20/flowchart-revision5-anchor-oneCell.xlsx` | `946b2662b7bc29df65ce99286786499198a9200003ac4dd11fe5f5b243506058` |

### 1.3 报告索引

```text
docs/agent/flowchart-excel/slice5-1-anchor-validation-report.md
docs/agent/flowchart-excel/slice5-2-visual-fix-report.md
docs/agent/flowchart-excel/slice5-3-visual-fix-v2-report.md
docs/agent/flowchart-excel/slice5-4-visual-layout-report.md
docs/agent/flowchart-excel/slice5-5-elk-orthogonal-routing-report.md
docs/agent/flowchart-excel/connector-routing-v4-report.md
docs/agent/flowchart-excel/excel-visual-qa-v4-report.md
docs/agent/flowchart-excel/shape-style-mapping-v4-report.md
docs/agent/flowchart-excel/anchor-decision-record.md
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

### 1.4 实现代码位置与可复现性

V4 的生成代码不在 `liuxianlab-online` 仓库内，也不在 Git 版本控制中：

```text
/Users/a123/AI-Workspace/tools/flowchart-excel-layout/build-layout.js
/Users/a123/AI-Workspace/tools/flowchart-excel-layout/optimize.js
/Users/a123/AI-Workspace/tools/flowchart-excel-layout/test.js
/Users/a123/AI-Workspace/tools/flowchart-excel-visual-fix-v4/Program.cs
/Users/a123/AI-Workspace/tools/flowchart-excel-visual-fix-v4/validate.py
/Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc/src/FlowchartExcelExporter/SheetGrid.cs
```

`current-code`。这些路径不属于 `liuxianlab-online` 的 Git 工作区；本轮未修改。

**基线漂移（必须记录）：**

- V1–V4 报告写的 HEAD 是 `ea3a312`；当前实际 HEAD 是 `28efb24`（2026-10-20 21:01 的 equity-structure 提交）。
- 也就是说，V4 产物生成时记录的是旧 HEAD；之后仓库前进了两个与 flowchart 无关的提交。
- `PROJECT_STATUS.md` 仍写 HEAD `ea3a312`、dirty 29 项；实际为 HEAD `28efb24`、dirty 17 项、9 个已跟踪修改。
- V4 实现代码本身没有 Git 历史，只有 Downloads 里的产物和报告。这使“从代码重放 V4”无法依靠 Git 完成。

---

## 2. Approved graph revision 5

`artifact` + `current-code`（审查了受保护目录中该任务的 review 元数据与 reviewed graph 哈希；未读取或输出 source.png）。

```text
job:              551a6811-52aa-40ba-a790-b472e695b549
review revision:  5
review status:    review_approved
approvedAt:       2026-10-20T11:46:50.779Z
approvedBy:       liuxian
reviewed graph:   storage/flowchart-excel/551a6811-.../review/flowchart.reviewed.json
SHA-256:          e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68
lanes / nodes / edges: 3 / 63 / 58
```

对象摘要：

| 项目 | 值 |
|---|---|
| lane | `LANE01` 18 节点 / `LANE02` 12 节点 / `LANE03` 33 节点 |
| node ID | `N001`–`N063` |
| edge ID | `E001`–`E058` |
| edge kind | sequence 33 / branch 15 / loopback 5 / document_output 5 |
| 分支标签 | 15 |
| 跨泳道边 | **0** |
| shape 语义 | process 18 / terminator 14 / predefined_process 12 / decision 8 / other 4 / document 3 / input_output 2 / database 2 |
| control marker | `N060` `N061` `N062` `N063`（shape=`other`，均无连线） |
| unresolved | 22 条，已 waived；blocking pending 0 |
| export profile | `trade_purchase_cn` / 1.0.0 |
| exportReady | false |
| edit_as | pending |

V4 的 `export-layout.json` 记录了同一哈希：

```text
source_graph_sha256 = e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68
```

逐字段核对（`artifact`）：

```text
节点集合一致：63 / 63
边集合一致：58 / 58
node label / shape / lane_id 不一致：0
edge source / target / label / kind 不一致：0
分支标签：15 / 15
自动补节点 / 补边 / 改控制点：0
```

结论：Track A 的**生成输入层面**成立；布局坐标只存在于 `export-layout.json`，没有回写 reviewed graph 的 `bbox` / `source_bbox_px`。

---

## 3. V4 布局引擎真实调用路径

`current-code`。实际调用命令没有落盘到 V4 产物目录；以下是从入口和产物反证出的调用链。

```text
reviewed graph JSON
  -> node build-layout.js <graph.json> <export-layout.json>
       - 每 lane 独立 elk.layered，direction=RIGHT
       - lane 自然宽度缩放到 2400px，节点宽高同步横向缩放
       - 三条 lane 纵向堆叠，y 从 150 开始
       - 先尝试简单正交路径，再 A* 正交路由
       - 输出节点 x/y/w/h、边 points、标签 label_rect、泳道 band
  -> dotnet run --project flowchart-excel-visual-fix-v4 -- <graph> <profile> <plan> <xlsx>
       - 读取 plan 的 canvas/lanes/nodes/edges/legend
       - px -> EMU（9525 EMU/px）
       - 生成 87 个 xdr:sp、58 个 xdr:cxnSp
       - profile 只参与 Sha256(profilePath)
  -> python3 validate.py <xlsx> <export-layout.json>
       - 解析 marker / xfrm / custGeom / stCxn / endCxn
       - 写结构、碰撞、文本溢出报告
```

### 3.1 ELK 是否真正控制最终位置

**是。** 证据：

- `build-layout.js` 的 `layoutLane()` 调用 `new ELK().layout()`，并用 `laid.children` 的 `x/y` 计算 `rawX/rawY`。
- `Program.cs` 对 63 个业务节点直接使用 `plan.nodes[].x/y/w/h` 生成 `a:off` / `a:ext`。
- 本轮逐节点比对：63/63 个 `a:xfrm` 与 plan 的 `x/y/w/h` 在 2 EMU 内一致。
- 58/58 条 `custGeom` 路径点与 plan 的 `points` 在 2 EMU 内一致。

所以 V4 不是“把 ELK 名字写进报告但不用它”。

### 3.2 但仍不是模板式布局

- 每 lane 独立布局，**跨泳道边没有参与 ELK**；本图跨泳道边为 0，所以暂时不暴露，但金样必须覆盖跨泳道。
- lane 内容被强制横向拉伸到 2400px，节点宽度也按同一比例拉伸，属于“填满画布”的后处理，不是模板的自然行带布局。
- 节点尺寸按 11pt 估算（`FONT_PX = 11 * 96 / 72`），输出文字却是 10pt；测量与渲染不是同一套参数。
- 这不是本轮新增的猜测，均为 `current-code`。

---

## 4. Connector route points → DrawingML custGeom

`current-code` + `artifact`。

V4 实际结构：

```text
xdr:sp        87
xdr:cxnSp     58
twoCellAnchor 145（87 + 58）
oneCellAnchor 0
absoluteAnchor 0
custGeom      58
prstGeom      87
stCxn/endCxn  58 / 58
invalid refs  0
```

每条边只生成一个 `xdr:cxnSp`，没有拆成多条 line/sp；`stCxn` / `endCxn` 指向真实 shape id；这些是结构层 PASS。

### 4.1 几何端点与绑定连接点不一致（关键根因）

`Program.cs` 的 `portPoint()` 在选中侧的中心基础上加了两类偏移：

```text
固定 8px 外侧间隙
+ sideCounters 产生的沿边偏移（最多 ±22px）
```

但 `PortIndex()` 只把 `top/left/bottom/right` 映射为 `0/1/2/3`，`stCxn/endCxn` 绑定的是该侧的**中心连接点**。

本轮对 58 条边逐条计算“custGeom 端点 vs 绑定侧中心”：

```text
端点偏差 > 1px 的边：58 / 58
最大偏差：23.4px
两侧固定间隙：8px / 8px（58 条全部）
```

这不是“XML 里看起来绑定成功”的问题，而是**绑定的连接点语义与画出来的几何不是同一个点**。Excel 打开时可能按 custGeom 画，但移动节点/编辑端点/保存重开时，连接器可能跳到中心连接点，或者 Excel 重算几何。V4 没有真实 Excel 证据，因此这是 `unverified`，但风险已经被几何数据直接证明。

### 4.2 preset-specific 连接点未实现

模板 profile 明确记录：

```text
flowChartInputOutput.observed_indices = [4, 5]
flowChartMagneticDrum.observed_indices = [4]
note: Do not hardcode one index for all presets.
```

V4 对所有 preset 统一使用 `top=0/left=1/bottom=2/right=3`。本图受影响：

```text
E004  N003 -> N005(input_output, left, idx=1)
E005  N005(input_output, bottom, idx=2) -> N002
E042  N040 -> N043(input_output, left, idx=1)
E043  N043(input_output, right, idx=3) -> N044
E007  N004 -> N007(magnetic_drum, left, idx=1)
```

其中 `idx=3`（E043）在模板的 input_output 观察中没有出现；`idx=1/2` 虽在模板中出现过，但不能据此证明 V4 的侧别映射正确。`connector-routing-v4-report.md` 的括注“本图未使用输入输出/数据库的 4/5 端口”在字面上成立（V4 确实从不输出 idx 4/5），但它掩盖了真正的问题：本图仍然绑定了 4 个 input_output/database 节点，而 profile 的要求是“不要对所有 preset 硬编码同一个索引”，不是“只要不用 4/5 就可以统一用 0–3”。

### 4.3 QA 状态模型不满足新验收标准

`validate.py` 的实际状态只有：

```text
clear
confirmed_collision
```

它没有 `indeterminate`，并把 58 条边全部写成 `clear`。而 `connector-routing-v4-report.md` 自己写的是：

```text
indeterminate = 58（Excel 运行时行为尚未实测）
```

同一份 V4 交付里，机器报告与文字报告对“是否有运行时不确定性”给出了相反口径。新 replan 的 Track C/Phase 6 要求把 `indeterminate` 单独计数，本项当前不满足。

### 4.4 校验器与生成器的列宽模型不一致

- 生成器 `SheetGrid.ColumnWidthToEmu()` 对首列 21.25 字符按 170px 计算。
- 校验器 `validate.py.column_px()` 对同一列按 168px 计算。
- 结果：校验器从 marker 解出的所有 x 坐标比 `a:xfrm` 小 2px；本轮 63 个节点的 x 差异均为 19050 EMU（2px）。

因为所有对象整体平移，节点之间的相对碰撞结论基本不受影响；但这说明“最终几何从 marker 读取”的口径并不精确，`outside_print_or_grid` 和分页边界也会受影响。属于低/中风险，但应统一为一个坐标模型。

---

## 5. Shape semantic → `a:prstGeom/@prst` 逐节点映射

`artifact`。V4 的实际 preset 与 `export-layout.json` 完全一致（63/63，0 mismatch），节点填充也一致。

| graph shape | 节点 | 输出 preset | 填充 |
|---|---|---|---|
| terminator | `N001` `N006` `N008` `N019` `N031` `N036` `N042` `N049` `N050` `N055` `N056` `N057` `N058` `N059` | `flowChartTerminator` | `D9E2F3` |
| process | `N002` `N009` `N013` `N018` `N020` `N025` `N030` `N032` `N033` `N035` `N038` `N044` `N045` `N047` `N048` `N052` `N053` `N054` | `flowChartProcess` | `D9E2F3` |
| predefined_process | `N003` `N010` `N011` `N014` `N016` `N021` `N022` `N026` `N028` `N039` `N041` `N051` | `flowChartPredefinedProcess` | `D9E2F3` |
| decision | `N004` `N012` `N015` `N024` `N027` `N034` `N040` `N046` | `flowChartDecision` | `D9E2F3` |
| document | `N017` `N029` `N037` | `flowChartDocument` | `FFFF00` |
| input_output | `N005` `N043` | `flowChartInputOutput` | `D9E2F3` |
| database | `N007` `N023` | `flowChartMagneticDrum` | `D9E2F3` |
| other / control marker | `N060` `N061` `N062` `N063` | `flowChartConnector` | `92D050` |

辅助形状：

```text
rect 18 = 15 分支标签 + 3 泳道背景带
flowChartTerminator 15 = 14 业务 + 1 图例
flowChartProcess 20 = 18 业务 + 2 图例
flowChartPredefinedProcess 12 = 12 业务
flowChartDecision 9 = 8 业务 + 1 图例
flowChartDocument 4 = 3 业务 + 1 图例
flowChartInputOutput 2 = 2 业务
flowChartMagneticDrum 2 = 2 业务
flowChartConnector 5 = 4 业务控制标记 + 1 图例
```

要点：

- 业务 shape 语义到 preset 的映射本身是**逐节点可核对**的，V4 在这一层没有偷换形状。
- 4 个 control marker 没有连线，因此它们的连接点索引不影响当前路由；但“CA/PRP/TOE → flowChartConnector 绿色标记”的语义仍是 `unverified`。profile 记录模板中控制标记同时出现 `flowChartPreparation`（3）和 `flowChartConnector`（3），V4 只用了后者。
- `flowChartPreparation` 在本图没有业务节点，不能据此认为映射完整。

---

## 6. 模板 profile 到 DrawingML 的真实映射

`current-code` + `artifact`。

### 6.1 结论：profile 没有被消费

`Program.cs` 对 profile 的全部使用只有：

```csharp
template_profile_sha256 = Sha256(profilePath)
```

没有 `JsonDocument.Parse(profilePath)`，没有读取 theme、shape_style、lane_style、legend_style、page_setup、anchor、connector_style 中任何字段。`build-layout.js` 也完全不接收 profile。

因此当前输出是**硬编码样式 + 事后记录 profile 哈希**，不是“从模板 profile 生成”。这是 V4 无法收敛到模板的首要结构性根因。

### 6.2 逐项对照

| profile 事实 | 模板真实值 | V4 实现 | 结论 |
|---|---|---|---|
| 正文字号 | 11pt（`body_size_hundredths=1100`） | 10pt（`FontSize=1000`） | 偏差 |
| 分支标签字号 | 次要 10pt | 9pt（`FontSize=900`） | 偏差，未验证 |
| 字体 | Microsoft YaHei UI | Microsoft YaHei UI | 一致（硬编码巧合） |
| 普通节点填充 | theme accent1 lumMod 20 / lumOff 80 | sRGB `D9E2F3` | 视觉近似，未做主题映射 |
| Document | `FFFF00` | `FFFF00` | 一致 |
| Control marker | observed `92D050`，语义未证实 | `92D050` | 颜色一致，语义 `unverified` |
| 节点线宽 | 默认 9525 EMU（0.75pt） | 12700 EMU（1pt） | 偏差 |
| 连接器线 | accent1 / 28575 EMU / triangle | `4472C4` / 28575 / triangle | 一致（硬编码） |
| 阴影 | blur 50800 / dist 38100 / dir 2700000 / alpha 40000 | 同参数 | 一致（硬编码） |
| 文本边距 | 观察值多处为 0；其余依赖默认 | 左/右 18000，上/下 9000 | 偏差，未验证 |
| 泳道实现 | 行带 + A 列标签，`A6`/`A7`/`A8:A9` | 3 个全宽 drawing 背景带 + A 列整段合并 | 结构性偏差 |
| 泳道标签样式 | 11pt 粗体、黑色、theme fill 3 tint -0.25 | 12pt 粗体、白色、`17365D` 深底 | 结构性偏差 |
| 图例 | 模板层级，禁止复制示例文字 | 6 项通用图例（Start/End、Activity 等） | 未复刻 |
| 页面 | A3 横向、`fitToPage=1`、scale 48 | A3 横向、scale 48、`fitToWidth/Height`、无 `fitToPage` | 语义偏差 |
| 打印区域 | 模板没有 `_xlnm.Print_Area` 定义名 | 显式 `A1:KU228` | 不同模型 |
| anchor | twoCell 默认；`edit_as=pending` | twoCell，无显式 editAs | 结构一致，未定版 |

### 6.3 profile 自身的一处不准确

`profile.page_setup.printing.print_area` 写的是 `A1:AG9`，但模板 `xl/workbook.xml` 中没有 `_xlnm.Print_Area` 定义名；模板的 used range 是 `A1:AH9`。因此该字段不是直接从 OOXML 的打印区域定义读出的，至少应标记为 `inferred`，不能作为“已验证模板打印区域”使用。

### 6.4 没有 theme part

V4 输出包没有 `xl/theme/theme1.xml`。颜色/字体全部以 sRGB 或直接字体名写入。这意味着即使后续想“使用模板主题”，当前包也没有主题基线；Excel 打开时可能补默认主题，但这不是模板主题。

---

## 7. Grid 列数与 print area `A1:KU228`

`artifact`。V4 的数值是一致的：

```text
colCount = ceil((2602 - 170) / 8) + 3 = 307  -> 第 307 列 = KU
rowCount = ceil(2036.5 / (6.8 * 96 / 72)) + 3 = 228
print_area = 'Flowchart Review'!$A$1:$KU$228
```

所以“列数与 print area 不一致”在 V4 中**不再作为算术错误存在**；`KU=307`、`228` 行来自同一组 `colCount/rowCount`。

但仍有三点不同：

1. 模板 used range 是 `A1:AH9`（34 列），且没有 Print_Area 定义名；V4 是 307 列 × 228 行。两者不是同一打印模型。
2. V4 的列宽模型在生成器（170px 首列）与校验器（168px 首列）之间相差 2px；这是坐标模型不一致，不是 print area 算术错误。
3. V4 有 print area，但没有 `sheetPr/pageSetUpPr`，所以 `fitToWidth/fitToHeight` 是否被 Excel 采用仍未验证。

---

## 8. 单页 A3 / scale 48 / fit-to-page 的打印可读性风险

`artifact` + `inferred`。

数值：

```text
画布：2602 × 2036.5 px
48% 纸面：936.7 × 733.1 pt
A3 横向：1191 × 842 pt
页边距：左右 0.7in（100.8pt），上下 0.75in（108pt）
可用区域：1090.2 × 734 pt
高度余量：734 - 733.1 = 0.9 pt
```

字号：

```text
节点正文 10pt × 48% ≈ 4.8pt
分支标签 9pt × 48% ≈ 4.32pt
模板正文 11pt × 48% ≈ 5.28pt
```

风险：

- 0.9pt 的高度余量极其脆弱；字体度量、行高、打印机驱动或 Excel 版本任一变化都可能变成 2 页。
- 4.8pt 已经是“可打印但难以阅读”的级别；9pt 标签更小。只用 LibreOffice PDF 页数不能证明 Excel 打印可读。
- V4 没有 `fitToPage=1`；`fitToWidth=1/fitToHeight=1` 只是属性，是否生效取决于 Excel 对缺少 `pageSetUpPr` 的处理（`inferred`）。
- 旧 anchor A 在 Mac Excel 保存后，`fitWidth/fitHeight` 已变成 `null`（`documented` + `artifact`：`A-after-save-structure.json`），说明这些属性可能在保存时被 Excel 丢弃。
- V4 的 Mac/Windows 打印预览均 `NOT RUN`；LibreOffice 1 页只是辅助。

按新 replan，本阶段**不能**在 A（单页 A3）、B（多页）、C（总览 + 详情）之间定版；需要 Phase 7 用同一 approved graph 做真实打印预览对比。

---

## 9. 真实 Excel 验收证据矩阵

`documented` / `artifact`。

| 对象 | 检查 | 结果 | 证据 |
|---|---|---|---|
| V1 anchor A | Mac Excel 移动/保存/重开/行列调整后绑定 | PASS（58/58） | `slice5-1-anchor-validation-report.md` |
| V1 anchor B | 同上 | PASS（58/58） | 同上 |
| V1 anchor A | Mac 保存后 marker/xfrm 差异 | 0/121 | `A-after-save-structure.json` |
| V1 anchor B | Mac 保存后 marker/xfrm 差异 | 89/121 | `B-after-save-structure.json` |
| V1 anchor A/B | Windows Excel | NOT RUN | 同上 |
| V1 anchor A/B | 视觉 QA | FAIL | `slice5-1` / `excel-visual-qa-report.md` |
| V2 | Mac/Windows | NOT RUN | `slice5-3` |
| V2 | 视觉 QA | FAIL（23 穿越 / 13 溢出） | `slice5-3` |
| V3 | Mac/Windows | NOT RUN | `slice5-4` |
| V3 | 视觉 QA | FAIL（39 穿越） | `slice5-4` |
| V4 | Mac Excel | **NOT RUN** | `slice5-5` / `excel-visual-qa-v4-report.md` |
| V4 | Windows Excel | **NOT RUN** | 同上 |
| V4 | custGeom connector 编辑/保存/重开 | **NOT RUN** | 同上 |
| V4 | Excel 打印预览 | **NOT RUN** | 同上 |
| V4 | 生成几何 QA | PASS（但见第 4 节口径问题） | `layout-validation-report.json` |
| V4 | Open XML SDK validator | 0 errors（文档产物，本轮未重跑生成器） | `.validation.json` |

**不能把 V1 anchor 的 Mac 证据外推到 V4。** V1 anchor 使用的是旧候选和旧连接器实现；V4 是 custGeom，且未做任何真实 Excel 编辑测试。

---

## 10. 最小 golden fixture 与 connector spike 计划

### 10.1 Golden fixture（8–10 节点，不含客户内容）

固定 ID，固定预期，不依赖真实业务图：

```text
Lane A（业务流程）
  G01 Start (terminator)
  G02 Process (process)
  G03 Decision (decision)          -- Yes / No 两个 branch label
  G04 Yes Process (process)
  G05 No Process (process)
  G06 Merge / Rejoin (process)
  G07 Document (document)          -- 或 input_output
  G08 长中文文本节点（process）     -- 用于文本测量/换行

Lane B（财务/控制）
  G09 Control Marker (control marker, PRP/CA/TOE 之一)
```

边：

```text
G01 -> G02
G02 -> G03
G03 -> G04  (Yes)
G03 -> G05  (No)
G04 -> G06
G05 -> G06
G06 -> G07
G07 -> G09  (跨泳道边)
G08 -> G06  (长文本节点回接，制造一条非直线边)
```

要求：

- 至少 1 条直线连接器（G01→G02）。
- 至少 1 条单对象正交/折线连接器（G08→G06 或 G07→G09）。
- 至少 1 条跨泳道边（G07→G09）。
- 1 个 decision + 2 个分支标签。
- 1 个 merge/rejoin。
- 1 个 document 或 input_output。
- 1 个 control marker。
- 1 个长中文文本，长度接近真实 5 行标签。
- 使用目标模板的**真实**样式 profile；不是复制采购示例内容。
- 所有坐标、期望端口、期望路径写入 `golden-fixture.expected.json`，作为后续回归基准。

### 10.2 Connector spike（Phase 2）

在 golden fixture 上，只比较连接器方案，不改 63 节点图：

| 方案 | 连接器 | 目的 |
|---|---|---|
| A | `straightConnector1` | 原生直线；验证绑定、端点、编辑 |
| B | `bentConnector3`（或适用的原生 bent preset） | 原生折线；验证 Excel 自身路由 |
| C | 当前 `a:custGeom` 单对象正交折线 | 验证自定义几何在 Excel 中的编辑/保存行为 |

对每个方案，Mac Excel 与 Windows Excel 各执行：

```text
1. 打开，确认无“修复”提示
2. 记录初始 stCxn/endCxn、idx、xfrm、custGeom/marker
3. 移动两个端点节点（一个直线端点、一个折线端点）
4. 保存、关闭、重新打开
5. 再移动一次节点
6. 解析保存后的 XLSX
```

通过标准（全部满足才算 PASS）：

```text
每个逻辑边仍恰好 1 个 xdr:cxnSp
stCxn/endCxn 仍指向真实 shape
端点与绑定连接点的距离 <= 1px（或明确记录允许的间隙）
Excel 未把路径改造成穿越非端点节点
未出现连接器拆分、丢失、自动修复
custGeom 方案在 Mac 与 Windows 均通过；任一 NOT RUN 则不得定版
```

必须记录：Excel 版本/build、文件 SHA-256、每步截图或解析结果、保存后 diff。

### 10.3 明确不做的事

- 不在 Phase 2 改 63 节点布局。
- 不在没有 Mac/Windows 证据时定版 `edit_as`。
- 不用放宽碰撞阈值让 QA 变绿。
- 不把 Open XML validator 通过当作视觉通过。
- 不用 LibreOffice 预览替代 Excel。

---

## 11. 本轮实际执行命令与结果

`current-code` / `artifact`。全部为读取与测试；没有生成 XLSX。

```text
shasum -a 256 ...
  -> V1–V4、anchor A/B、模板、profile 哈希（见第 1 节）

python3 (zipfile + ElementTree)
  -> 解析 V4 XLSX 的 sheet1.xml / drawing1.xml / workbook.xml
  -> 统计 87 sp / 58 cxnSp / 145 twoCellAnchor / 58 custGeom / 58 stCxn + 58 endCxn
  -> 逐节点比对 63 个 a:xfrm 与 plan：0 mismatch
  -> 逐边比对 58 个 custGeom 点与 plan：0 mismatch
  -> 逐边计算 custGeom 端点 vs 绑定侧中心：58/58 > 1px，最大 23.4px
  -> 解析模板 sheet1.xml：存在 sheetPr/pageSetUpPr fitToPage=1；无 Print_Area 定义名

rg -n "profile|Profile" ...
  -> Program.cs 只在 usage 和第 213 行 Sha256(profilePath) 使用 profile
  -> build-layout.js 不读取 profile

node --test tests/flowchart-excel/*.test.js
  -> 115 pass / 0 fail

npm test
  -> 400 pass / 0 fail

.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t .
  -> 14 tests OK

~/.dotnet/dotnet test (flowchart-excel-exporter-poc)
  -> 14 passed / 0 failed

git status --short（前后）
  -> 17 项，9 个已跟踪修改，审计前后不变
```

说明：

- `dotnet` 不在默认 PATH；使用 `~/.dotnet/dotnet`。
- V4 生成器本轮**未重跑**，因为重跑会写 XLSX；其构建结果沿用既有产物，标记为 `documented`。
- Open XML SDK validator 本轮**未重跑**；`.validation.json` 记录 0 errors，标记为 `artifact`。
- Mac/Windows Excel 本轮未运行，全部 `NOT RUN`。

---

## 12. 零改动声明

本轮只新增了本报告文件及其 Downloads 副本：

```text
/Users/a123/AI-Workspace/projects/liuxianlab-online/docs/agent/flowchart-excel/replan-phase0-root-cause-report.md
~/Downloads/replan-phase0-root-cause-report-2026-10-21.md
```

明确声明：

- 未修改任何核心代码。
- 未生成、覆盖或再保存任何 XLSX。
- 未修改 approved graph、revision 5、review 状态或原始 `bbox` / `source_bbox_px`。
- 未改变 `exportReady`（仍为 `false`）或 `edit_as`（仍为 `pending`）。
- 未重启网站、未部署、未提交、未推送 Git。
- 审计前既有 dirty 17 项保持不变；`git status --short` 前后一致。

---

## 13. 下一步

**停在这里，等待审阅。**

不在本轮自动开始 Phase 1。审阅通过后再做两件事：

1. 先建立 golden fixture 与其 `expected.json`，只验证 Track A/B 的最小闭环。
2. 再做 Phase 2 connector spike；没有 Mac/Windows 证据的方案一律 `NOT RUN`，不得定版。

在 Phase 1/2 通过前，V4 只能继续作为实验候选，不能接入正式导出，也不能打开 `exportReady`。

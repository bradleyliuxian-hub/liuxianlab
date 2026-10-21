# Trade purchase CN — 目标 Excel 模板样式 Profile

状态：模板样式规范（最高优先级）
目标文件：

```text
/Users/a123/Downloads/Trade purchase.CN.xlsx
```

文件大小：53 KB
SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`

> **优先级声明**
>
> 本文件是最终 Excel 版式、图形、颜色、字体、线条、锚点、页面设置和图例样式的**唯一最高优先级来源**。
> 旧 `style.json`、旧 sales flowchart 模板、通用默认颜色和此前提示词中的通用样式建议，只有在目标模板没有定义相关属性时才能作为回退。
>
> 本文件只描述样式与结构；不得复制目标文件中的示例业务文字、教学图例、“Remove before use”内容、隐藏内容、external links 或 customXml 到客户交付件。
>
> **机器可读 profile**：`docs/agent/flowchart-excel/trade-purchase-template-profile.json`。运行时以该 JSON 为 token source；Markdown 继续作为人工说明。JSON 的 `anchor.production_edit_as` 仍为 `pending`，Gate C 未通过前不得正式导出。
>
> 目标文件中的未绑定连接器是缺陷，不是规范。最终输出每条逻辑边必须使用真正绑定的原生连接器。

---

## 1. 工作簿与页面设置

直接读取 `xl/workbook.xml`、`xl/worksheets/sheet1.xml` 得到：

| 属性 | 值 |
|---|---|
| 工作表数量 | 1 |
| 工作表名 | `Trade purchase WT` |
| 使用范围 | `A1:AH9` |
| 打印区域 | `A1:AG9`（defined name `_xlnm.Print_Area`） |
| 页面方向 | `landscape` |
| 纸张 | `paperSize="8"`（A3） |
| 打印缩放 | `scale="48"` |
| fitToPage | `sheetPr/pageSetUpPr fitToPage="1"` |
| 页边距 | left/right `0.7"`，top/bottom `0.75"`，header/footer `0.3"` |
| 默认列宽 | `9.9140625` |
| 默认行高 | `14.5` |
| 合并单元格 | 仅 `A8:A9` |
| 视图 | `pageBreakPreview`，zoom 70% |
| 隐藏行 | 行 4、5 隐藏 |
| 行高（关键） | 行 3 = 24.75；行 6 = 409.6；行 7 = 266；行 8 = 373.25；行 9 = 409.6 |

### 版式含义

目标文件不是全宽合并单元格泳道背景：

- 标题/审计信息在 A1–A3；
- 行 4–5 是隐藏的教学/说明内容；
- 三个部门通过 **行带 + A 列标签单元格** 表现：
  - 行 6：`采购部`
  - 行 7：`仓库`
  - 行 8–9：`应付账款`（`A8:A9` 合并）
- 部门标签单元格有填充与边框；流程图对象跨行/列布局；
- 只有 `A8:A9` 一个合并区域；不能据此推断所有泳道都用合并单元格。

**未来实现应先决定是否复刻“行带 + 标签单元格”方式；不得未经核查就强制改成全宽合并背景。**

---

## 2. Drawing 结构与锚点

| 属性 | 值 |
|---|---|
| Drawing part | `xl/drawings/drawing1.xml` |
| `xdr:sp` | 91 |
| `xdr:cxnSp` | 74 |
| `xdr:grpSp` | 0 |
| `xdr:pic` | 0 |
| Anchor 总数 | 165 |
| Anchor 类型 | **全部 `xdr:twoCellAnchor`** |
| `oneCellAnchor` / `absoluteAnchor` | 0 |
| 显式 `editAs` | **无**（默认 `twoCell`） |
| Shape ID / Connector ID | 同一 Drawing part 内唯一；模板中存在不连续 ID |

### 重要观察

- 目标模板使用 `twoCellAnchor`，但没有写 `editAs`；OOXML 默认是 `twoCell`。
- 当前 Phase 0 POC 的 `twoCellAnchor + editAs="oneCell"` 是另一种行为：
  - `oneCell`：移动但不随单元格缩放；
  - `twoCell`：可能移动并缩放。
- **未来导出器必须在“模板视觉/布局优先 + 连接器绑定可靠”的约束下明确测试并选择**；不能因为 POC 通过就默认用 `oneCell`，也不能因为模板没有 `editAs` 就无条件沿用 `twoCell`。
- 目标文件有 15 个 shape 的 `a:xfrm` 高度为 0，但 `xdr:from` / `xdr:to` 仍有实际跨度；Excel 以 marker 为实际几何依据。未来重新导入/校验必须以 marker 为准，不能只信 `a:xfrm`。

---

## 3. 形状语义与 preset

| 计数 | `a:prstGeom` | 业务语义 |
|---:|---|---|
| 22 | `flowChartProcess` | 活动/流程步骤 |
| 17 | `flowChartTerminator` | 开始/结束/会计分录终止节点 |
| 12 | `flowChartPredefinedProcess` | 系统活动/预定义流程 |
| 8 | `flowChartDecision` | 判断 |
| 5 | `flowChartDocument` | 文档/单据 |
| 3 | `flowChartPreparation` | WCGW/PRP/风险准备 |
| 3 | `flowChartConnector` | Control / T.AC 控制标记 |
| 3 | `flowChartInputOutput` | IPE / 例外报告 |
| 2 | `flowChartMagneticDrum` | 数据存储/主数据 |
| 1 | `homePlate` | 转至其他流程/离页 |
| 15 | `rect` | 分支标签（是/否）、图例/说明文本框 |

### 连接点索引

模板连接点使用 `idx 0–5`，不只 0–3：

- `flowChartInputOutput` 使用 `idx 4`、`idx 5`
- `flowChartMagneticDrum` 使用 `idx 4`

因此未来契约/导出器不能假设所有 preset 只有 4 个连接点。建议：

- 保留 `top/right/bottom/left` 作为业务端口名；
- 另外支持显式 `source_connection_index` / `target_connection_index`，或维护 preset-specific port → idx 映射；
- 不得把模板中的 idx 4/5 简单映射到 0–3。

---

## 4. 主题色与显式颜色

主题 `xl/theme/theme1.xml`：

| Token | 值 |
|---|---|
| `dk1/windowText` | `000000` |
| `lt1/window` | `FFFFFF` |
| `dk2` | `44546A` |
| `lt2` | `E7E6E6` |
| `accent1` | `4472C4` |
| `accent2` | `ED7D31` |
| `accent3` | `A5A5A5` |
| `accent4` | `FFC000` |
| `accent5` | `5B9BD5` |
| `accent6` | `70AD47` |

直接 RGB/主题覆盖观察：

| 元素 | 颜色 |
|---|---|
| Process / Terminator / Predefined Process / InputOutput / MagneticDrum | `schemeClr accent1`，`lumMod=20000`、`lumOff=80000`（浅蓝） |
| Document | `srgbClr FFFF00`（黄） |
| Preparation（WCGW/PRP） | `srgbClr FF0000`（红） |
| Connector（Control/T.AC） | `srgbClr 92D050`（绿） |
| Decision | 无显式 solidFill；依赖 `xdr:style` / 主题默认，需视觉复核 |
| 文本 | 主要为 `sysClr windowText` / `tx1`；部分主题 `lt1` |
| 分支标签 | 独立 `rect` 文本框，非连接器标签 |

`xdr:style` 统一引用：

```xml
<xdr:style>
  <a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>
  <a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>
  <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
  <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
</xdr:style>
```

注意：具体形状的 `solidFill` 会覆盖 style 的 fillRef；提取 tokens 时应同时记录 style 引用和显式覆盖。

---

## 5. 字体与文本

| 属性 | 观察 |
|---|---|
| 主题字体 | `+mn-lt`（minor） |
| 单元格字体 | `Microsoft YaHei UI`，10pt / 11pt，部分加粗 |
| Drawing run 字号 | 11pt（208 次）、10pt（19 次）、20pt（6 次） |
| 文本对齐 | `algn="ctr"` 86 次；`algn="l"` 6 次 |
| `bodyPr` 垂直锚点 | `anchor="ctr"` 87 次；`anchor="t"` 4 次 |
| 换行 | 15 个 `rect` 使用 `wrap="square"`；流程图形状多使用 `vertOverflow="clip" horzOverflow="clip"` |
| 文本边距 | 多数流程形状未显式设置；部分 Preparation/Connector 使用 `lIns="0" rIns="0"` |
| 标题/说明 | 使用主题字体；标题 20pt 量级，正文 11pt |

未来导出应优先复刻：

- `Microsoft YaHei UI` 或主题 minor font；
- 11pt 正文；
- 居中、垂直居中；
- 节点文本 clip/换行策略；
- 分支标签独立文本框。

---

## 6. 线条、阴影、箭头

| 属性 | 观察 |
|---|---|
| 连接器线宽 | 74 条为 `w="28575"`（2.25pt） |
| 部分 rect 线宽 | 15 条为 `w="9525"`（0.75pt） |
| 箭头 | 73 个 `a:tailEnd type="triangle"`；无 headEnd |
| 阴影 | 74 个对象含 `a:outerShdw`：blur 50800、dist 38100、dir 2700000、black alpha 40000 |
| 连接器 geometry | `straightConnector1` 51、`bentConnector3` 17、`bentConnector2` 5、`line` 1 |

**连接器可靠性缺陷（不可复制）：**

```text
74 条连接器：
  50 条同时有 stCxn + endCxn
   7 条仅起点
   1 条仅终点
  16 条无绑定
```

108 个端点引用都指向真实 Shape ID，但仍有大量未绑定/半绑定连接器。最终输出必须每条边一个 `xdr:cxnSp`，且恰有一个 `stCxn`、一个 `endCxn`。

---

## 7. 图例与教学内容

模板包含：

- Start/End
- Manual Activity
- Automated Activity
- Document
- Decision
- WCGW
- Control
- IPE
- Process activity Knowledge ID
- Connector between shapes
- “Guidance - Remove before use” 等说明

这些是**样式参考**，不得原样进入客户交付件。

图例使用与流程图形状相同的主题风格、线宽和阴影层级；分支标签“是/否”是独立小矩形文本框，适合作为未来图例/分支标签样式参考。

---

## 8. 可抽取的 tokens

可以抽取为 profile tokens：

- 页面设置：A3、landscape、scale 48、fitToPage、margins、print area；
- 主题色和显式强调色；
- 字体家族、字号层级、对齐/换行/文本边距；
- 形状 preset → 语义映射；
- 连接器 geometry、线宽、箭头、阴影；
- 部门行带的行高、标签单元格填充/边框、`A8:A9` 合并方式；
- 图例形状/文字层级；
- `twoCellAnchor` 作为模板 anchor 类型（editAs 需另行决策）。

## 9. 依赖具体结构、不能简单 token 化的内容

- 具体 cell marker / offset / xfrm 坐标；
- 具体 Shape ID / Connector ID；
- 每个 preset 的连接点 idx 映射（需单独维护）；
- 目标模板中 15 个 `xfrm cy=0` 的历史几何异常；
- external links、customXml、hidden rows 和教学说明；
- 原始 DrawingML 中未绑定的 connector 对象。

## 10. 未来客户的样式引用契约

数据契约应包含：

```json
{
  "template_profile_id": "trade_purchase_cn",
  "template_profile_version": "1.0.0",
  "template_profile_ref": "docs/agent/flowchart-excel/trade-purchase-template-profile.md",
  "style_overrides": {
    "source": "user_explicit",
    "reason": "客户明确要求局部颜色调整",
    "tokens": {}
  }
}
```

规则：

- 默认必须使用 `trade_purchase_cn` profile。
- `style_overrides` 只能由用户明确要求产生，必须记录 source/reason。
- 不得通过 override 修改 `export_profile`、`anchor_mode`、原生连接器要求、图例/泳道硬性规则。
- 旧 `style.json` 的 theme/excel_export_rules 只能进入 `extensions.legacy`，不能覆盖模板 profile。
- 任何覆盖都要在报告中可见，不能静默生效。

## 11. 未确认事项

- 目标模板默认 `twoCell` 与 POC `oneCell` 在生产中的最终选择；
- Decision 形状的实际填充（依赖 style/主题，需视觉复核）；
- 15 个 `xfrm cy=0` 对象的 Excel 实际显示与编辑行为；
- 部门行带的完整视觉规则（是否要复刻单元格标签 vs 全宽背景）；
- Windows Excel 中对 twoCell/oneCell 的最终验收细节；
- 目标模板的 external links/customXml 是否影响复用（不得直接复制）。

## 12. 结论

Trade purchase.CN.xlsx 的视觉语言是：

> **横向 A3 审计流程图 + 三部门行带 + 主题色原生图形 + 阴影/线宽层级 + 顶部图例 + 独立分支标签 + twoCellAnchor 布局。**

它只作为视觉/结构参考；最终交付必须使用新生成的、100% 绑定的原生连接器，且不得复制示例文字、教学图例、隐藏内容或未绑定连接器。

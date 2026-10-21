# Flowchart Excel 统一数据契约（v1.0.0）

状态：设计稿
适用范围：React/TypeScript 前端、Python AI worker、Node/Express API、.NET Open XML 导出器
规范文件：`docs/agent/flowchart-excel/flowchart.schema.json`

---

## 1. 目标

本契约是流程图画布、AI 提取、人工复核、版本保存和 Excel 原生导出之间**唯一的图结构交换格式**。

它解决旧辅助文件中的字段分裂：

| 旧辅助文件 | 统一契约 |
|---|---|
| `nodes[].lane` | `nodes[].lane_id` |
| `nodes[].bbox_px` | `nodes[].bbox`（归一化）+ 可选 `source_bbox_px` |
| `edges[].source` | `edges[].source_node_id` |
| `edges[].target` | `edges[].target_node_id` |
| 无 `source_port` / `target_port` | 明确 port；无法推断时为 `null` |
| 无 `review_status` | `pending` / `confirmed` / `rejected` |
| `provenance` 不完整 | 明确 `image_extraction` / `reconciliation` / `manual_edit` / `legacy_adapter` |
| 无版本 | `schema_version: "1.0.0"` |

**业务节点 ID、Excel Shape ID、Excel Connector ID 必须分离。**

---

## 2. 顶层结构

```json
{
  "schema_version": "1.0.0",
  "template_profile_id": "trade_purchase_cn",
  "template_profile_version": "1.0.0",
  "template_profile_ref": "docs/agent/flowchart-excel/trade-purchase-template-profile.md",
  "document": {},
  "lanes": [],
  "nodes": [],
  "edges": [],
  "style": {},
  "style_overrides": {},
  "unresolved_items": [],
  "reconciliation": {},
  "revisions": [],
  "export_profile": {},
  "extensions": {}
}
```

必填：

```text
schema_version,
template_profile_id, template_profile_version, template_profile_ref,
document, lanes, nodes, edges, style,
unresolved_items, export_profile
```

可选：

```text
reconciliation, revisions, style_overrides, extensions
```

---

## 3. document

```json
{
  "job_id": "8f14e45f-ea9b-4f0d-a1d0-5f7f7c9d8e11",
  "title": "销售与收款循环",
  "source_type": "image",
  "source_image_name": "flowchart.png",
  "source_image_sha256": "64位小写十六进制或null",
  "source_image_size_px": { "width": 2400, "height": 1600 },
  "created_at": "2026-10-20T16:00:00Z",
  "extraction_status": "draft_requires_human_validation",
  "disclaimer": "视觉模型识别结果需要人工复核。"
}
```

规则：

- `source_type`：`image | pdf | structured_json`
- `extraction_status`：
  - `draft_requires_human_validation`
  - `reconciled`
  - `approved`
- `source_image_sha256`：源图哈希；没有图片时为 `null`，不得伪造。
- `job_id` 可选；Phase 1 第一切片可以没有数据库，因而允许为空。
- 不得在 `document` 中写入 API Key、模型响应原文或客户敏感内容。

---

## 4. lanes

```json
{
  "id": "lane_sales",
  "label": "销售部",
  "order": 1,
  "orientation": "horizontal",
  "bbox": {
    "x": 0.02,
    "y": 0.10,
    "width": 0.96,
    "height": 0.14,
    "coordinate_space": "normalized"
  },
  "source_bbox_px": {
    "x": 48,
    "y": 160,
    "width": 2304,
    "height": 224,
    "coordinate_space": "source_pixels"
  },
  "extensions": {}
}
```

规则：

- `id` 唯一，稳定。
- `order` 从 0 或 1 开始均可，但同一文档内必须一致；建议从 1 开始。
- `orientation`：`horizontal | vertical`。
- `bbox` 是**布局坐标**，归一化到 0..1。
- `source_bbox_px` 只用于追溯，不用于导出布局。
- 泳道背景最终由合并单元格/填充/边框实现，不由 lane 数据直接生成大矩形 Shape。

---

## 5. nodes

```json
{
  "id": "n_review",
  "label": "审核客户准入条件",
  "shape": "process",
  "lane_id": "lane_sales",
  "bbox": {
    "x": 0.18,
    "y": 0.22,
    "width": 0.16,
    "height": 0.07,
    "coordinate_space": "normalized"
  },
  "source_bbox_px": {
    "x": 432,
    "y": 352,
    "width": 384,
    "height": 112,
    "coordinate_space": "source_pixels"
  },
  "controls": [
    {
      "kind": "CA",
      "code": "CA1",
      "display": "badge",
      "attribution_status": "confirmed",
      "extensions": {}
    }
  ],
  "confidence": "high",
  "review_status": "pending",
  "provenance": {
    "source": "image_extraction",
    "source_ref": "stage1:vision",
    "notes": ""
  },
  "extensions": {}
}
```

### 5.1 shape 枚举

```text
terminator
process
decision
predefined_process
document
input_output
database
connector
note
manual_input
delay
display
off_page_connector
other
```

映射到 Excel `a:prstGeom` 由 .NET 导出器负责，不在 JSON 中写 Excel preset。

### 5.2 lane_id

- 必须是 `lanes[].id` 之一，或 `null`（未归属）。
- JSON Schema 无法验证跨数组引用；应用层必须校验。
- 最终导出 gate 要求非空。

### 5.3 bbox

统一使用归一化坐标：

```json
{
  "x": 0.1,
  "y": 0.2,
  "width": 0.12,
  "height": 0.06,
  "coordinate_space": "normalized"
}
```

- 数值范围 0..1。
- `width` / `height` > 0。
- 应用层校验 `x + width <= 1`、`y + height <= 1`（JSON Schema 不能直接表达和约束）。
- 原始像素坐标放 `source_bbox_px`，不得混用。

### 5.4 confidence / review_status / provenance

必须区分：

| 字段 | 含义 |
|---|---|
| `confidence` | 模型对识别结果的自信程度：`high / medium / low` |
| `review_status` | 用户是否确认：`pending / confirmed / rejected` |
| `provenance` | 数据来源：`image_extraction / reconciliation / manual_edit / legacy_adapter` |

**模型说 high 不代表业务事实已确认。**

`provenance` 建议字段：

```json
{
  "source": "image_extraction",
  "source_ref": "stage1:vision",
  "model": "configured-model-name",
  "notes": "",
  "legacy": {}
}
```

`legacy` 用于适配旧辅助文件时保留未知字段/原始值。

---

## 6. edges

```json
{
  "id": "e_review_branch_yes",
  "source_node_id": "n_review",
  "target_node_id": "n_approve",
  "source_port": "bottom",
  "target_port": "top",
  "kind": "branch",
  "label": "是",
  "route_hint": "orthogonal_vertical_first",
  "confidence": "medium",
  "review_status": "pending",
  "provenance": {
    "source": "image_extraction",
    "source_ref": "stage1:vision"
  },
  "extensions": {}
}
```

### 6.1 port

```text
top | right | bottom | left | null
```

- `null` 表示旧数据无法安全推断，必须进入 `unresolved_items`。
- 最终 Excel 导出 gate 要求 `source_port` / `target_port` 非空。
- 连接点映射由导出器负责：
  - 模板证据：`top=0, left=1, bottom=2, right=3`（DrawingML 0-based）
  - Excel AppleScript 报告为 1-based：top=1、left=2、bottom=3、right=4。
  - **目标模板 Trade purchase.CN.xlsx 实际使用 idx 0–5**：`flowChartInputOutput` 使用 4/5，`flowChartMagneticDrum` 使用 4。`top/right/bottom/left` 不足以表达所有 preset 的连接点；未来需显式 `source_connection_index` / `target_connection_index` 或 preset-specific port map。

### 6.2 kind / route_hint

`kind`：

```text
sequence
branch
loopback
document_output
exception
other
```

`route_hint`：

```text
straight_horizontal
straight_vertical
orthogonal_vertical_first
orthogonal_horizontal_first
loopback
manual_review
```

### 6.3 引用

- `source_node_id` / `target_node_id` 必须引用存在节点。
- JSON Schema 无法验证跨引用；应用层必须校验。
- 不得用 Connector ID 或 Excel Shape ID 充当 node ID。
- 每条逻辑边只对应一个 Excel `xdr:cxnSp`，不得拆成多段。

---

## 7. controls

```json
{
  "kind": "PRP",
  "code": "PRP1",
  "display": "badge",
  "attribution_status": "inferred",
  "extensions": {}
}
```

规则：

- `kind`：`CA | PRP | TOE`
- `code` 规范：`^(CA|PRP|TOE)[-_]?[0-9]{1,4}[A-Za-z]?$`
- `display`：`badge | inline_text | separate_shape`
- `attribution_status`：`confirmed | inferred | unresolved | needs_review`
- 旧格式中 `P1` 等非规范编号：不得静默改名；保留原值到 `extensions.legacy` 并标记 unresolved。
- 编号缺口只报警，不自动创建节点。

---

## 8. 模板 profile 与 style

### 8.1 模板优先级

最终 Excel 的视觉、版式、颜色、字体、线条、阴影、图例、页面设置和锚点语义，以：

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

为唯一最高优先级来源。旧 `style.json`、旧 sales flowchart 模板和通用默认值不得覆盖它。

### 8.2 根级模板字段

```json
{
  "template_profile_id": "trade_purchase_cn",
  "template_profile_version": "1.0.0",
  "template_profile_ref": "docs/agent/flowchart-excel/trade-purchase-template-profile.md"
}
```

- 三个字段必填。
- `template_profile_ref` 必须指向真实存在的 profile 文件；缺失时应用层发出明确 warning，并阻止生产导出。
- 未来如新增模板，使用新的 profile id/version/ref，不得复用旧 id 并静默改变语义。

### 8.3 style / overrides

```json
{
  "style": {
    "theme": {},
    "excel_export_rules": {
      "native_shapes_only": true,
      "native_bound_connectors_only": true,
      "one_logical_edge_one_connector": true,
      "anchor_mode": "twoCellAnchor",
      "edit_as": "pending",
      "swimlane_background": "template_defined",
      "legend": "template_defined",
      "require_excel_drag_save_reopen_test": true,
      "require_windows_acceptance": false
    }
  },
  "style_overrides": {
    "source": "user_explicit",
    "reason": "客户明确要求局部颜色调整",
    "tokens": {}
  }
}
```

规则：

- 最终样式默认来自 `trade_purchase_cn` profile。
- `style.theme` 不再作为最终样式来源；旧 theme 只能进入 `style.extensions.legacy`。
- `style_overrides` 只在用户明确要求时出现，必须记录 `source=user_explicit` 和 `reason`。
- 不得通过 `style_overrides.tokens` 覆盖 `export_profile`、`anchor_mode`、`edit_as`、原生连接器要求、图例/泳道硬性规则。
- `edit_as` 允许 `pending`：模板默认是 `twoCell`，POC 验证的是 `oneCell`，最终导出器必须显式决策；pending 时 `exportReady=false`。
- 不得用图片或大矩形背景替代模板实际的分区实现；模板的部门行带/标签单元格方式以 profile 为准。

---

## 9. unresolved_items

```json
{
  "id": "u_missing_port_e1",
  "type": "missing_port",
  "severity": "high",
  "description": "旧辅助文件中的边 e1 没有 source_port / target_port。",
  "action": "人工确认端口后重新导出。",
  "related_ids": ["e1"],
  "status": "pending",
  "extensions": {}
}
```

`type` 建议枚举：

```text
dangling_edge
missing_port
low_confidence
possible_number_gaps
ambiguous_branch
coordinate_out_of_bounds
unknown_shape
noncanonical_control_code
other
```

`severity`：`high | medium | low`
`status`：`pending | resolved | rejected`

---

## 10. reconciliation

第二阶段不是直接覆盖第一阶段，而是产生变更记录：

```json
{
  "status": "in_review",
  "generated_at": "2026-10-20T16:10:00Z",
  "model": "configured-reconciliation-model",
  "changes": [
    {
      "change_id": "c1",
      "entity_type": "edge",
      "entity_id": "e1",
      "field": "target_port",
      "before": null,
      "after": "top",
      "reason": "原图中连接器从判断框底部进入活动框顶部。",
      "evidence": { "source": "image", "note": "visible arrow direction" },
      "confidence": "medium",
      "decision": "pending",
      "provenance": { "source": "reconciliation" }
    }
  ],
  "extensions": {}
}
```

规则：

- `status`：`not_started | in_review | applied | rejected`
- `decision`：`pending | accepted | rejected`
- 不得静默覆盖人工修改。
- 应用变更后必须生成 revision/diff。
- 无依据的补造不得进入 `accepted`。

---

## 11. revisions

```json
{
  "revision_id": "rev_2",
  "revision_number": 2,
  "actor": "user@example",
  "created_at": "2026-10-20T16:20:00Z",
  "reason": "修正判断分支端口",
  "changes": [
    { "path": "/edges/3/target_port", "before": null, "after": "left" }
  ]
}
```

- 人工修改必须可追溯。
- 服务端版本存储可以在 Phase 1 之后接入；第一切片可以只定义字段。
- 不得把完整客户内容写入普通日志。

---

## 12. export_profile

```json
{
  "target": "editable_excel_native_drawingml",
  "anchor_mode": "twoCellAnchor",
  "edit_as": "pending",
  "native_shapes_only": true,
  "native_bound_connectors_only": true,
  "one_logical_edge_one_connector": true,
  "swimlane_background": "template_defined",
  "legend": "template_defined",
  "require_excel_drag_save_reopen_test": true,
  "require_windows_acceptance": false,
  "shape_mapping": {
    "process": "flowChartProcess",
    "decision": "flowChartDecision",
    "terminator": "flowChartTerminator",
    "predefined_process": "flowChartPredefinedProcess",
    "document": "flowChartDocument",
    "input_output": "flowChartInputOutput",
    "database": "flowChartMagneticDrum",
    "connector": "flowChartConnector",
    "off_page_connector": "homePlate"
  }
}
```

强制要求：

- 每个业务节点映射到唯一 Excel Shape ID。
- 每条逻辑边映射到一个 `xdr:cxnSp`。
- 连接器必须有 `a:stCxn` / `a:endCxn`，并引用真实 Shape ID。
- 泳道/分区实现以 `trade-purchase-template-profile.md` 的实际结构为准；不得未经核查强制改成全宽合并单元格背景。
- 图例以模板 profile 为准；不得复制模板中的教学图例、示例文字或 “Remove before use”。
- 禁止图片、SVG 截图、多段独立线段。
- 注入 DrawingML 后不得用会删除绘图对象的库保存。
- 必须在真实 Excel 中做拖动、保存、关闭、重开测试。
- Windows 验收证据必须单独记录；没有证据时 `require_windows_acceptance` 不得被标记为已满足。

`shape_mapping` 是建议映射；最终 .NET 导出器可以集中维护，不必由模型生成。

---

## 13. 应用层必做的交叉校验

JSON Schema 只能验证单对象结构和枚举，**不能验证跨数组引用**。应用层必须检查：

1. `schema_version === "1.0.0"`
2. `lanes[].id` 唯一
3. `nodes[].id` 唯一
4. `edges[].id` 唯一
5. `nodes[].lane_id` 为 `null` 或存在于 lanes
6. `edges[].source_node_id` / `target_node_id` 存在于 nodes
7. `edges[].source_node_id != target_node_id`（自环需显式例外）
8. `source_port` / `target_port` 为 null 或合法枚举
9. `bbox` 在 0..1 且不越界
10. `controls[].code` 规范；非规范格式进入 unresolved
11. `unresolved_items[].related_ids` 尽量指向现有实体
12. `reconciliation.changes[].entity_id` 指向现有实体
13. `review_status` / `confidence` 不混用
14. `export_profile` 强制项未被覆盖
15. 最终导出 gate：无 high severity unresolved、端口非空、关键分支已确认

---

## 14. 版本策略

- 当前：`1.0.0`
- 修改破坏性字段：提升 major。
- 增加可选字段：提升 minor。
- 仅文档/说明修改：提升 patch。
- 不允许前端、Python、.NET 各自维护不同字段名。
- 旧辅助文件通过 adapter 转换，不直接进入最终导出器。
- 每个导出 XLSX 应保留对应 `flowchart.final.json` 与 schema_version。

---

## 15. 示例边界

本契约不包含：

- 客户原始图片/PDF
- 模型 API 响应全文
- 数据库凭证、密钥、Cookie
- 任意 Excel Shape ID（由导出器生成）
- 任意布局像素绝对坐标（布局用归一化 bbox，源图像素另存）

---

## 16. 与旧辅助文件的关系

旧辅助文件（`flowchart.json`、`nodes.csv`、`edges.csv`、`style.json`）仍是阶段一的可读产物，但：

- 不能直接作为最终导出契约；
- 必须经过 `legacy-helper-files-adapter.md` 定义的 adapter；
- 转换后生成新契约 JSON，再做 schema + 交叉校验；
- 转换不得静默删除未知字段或补造节点/边。

详见 `docs/agent/flowchart-excel/legacy-helper-files-adapter.md`。

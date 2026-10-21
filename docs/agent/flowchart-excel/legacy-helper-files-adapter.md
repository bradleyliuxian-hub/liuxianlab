# Legacy Helper Files Adapter（旧辅助文件 → 统一契约）

状态：设计稿
输入：图片识别阶段生成的 `flowchart.json`、`nodes.csv`、`edges.csv`、`style.json`
输出：符合 `flowchart.schema.json` v1.0.0 的统一图结构
原则：**只转换，不补造；未知字段保留；所有不确定性进入 `unresolved_items`。**

---

## 1. 旧格式事实

旧辅助文件的 `flowchart.json` 主要字段：

```text
document
coordinate_system
lanes[]       { id, label, order, bbox_px, orientation, notes }
nodes[]       { id, label, shape, lane, bbox_px, controls, confidence,
                text_status, notes }
edges[]       { id, source, target, kind, label, route_hint, confidence,
                source_of_relationship, notes }
unresolved_items[]
style_ref
export_profile
```

旧 `style.json` 包含：

```text
schema_version
status
theme
excel_export_rules
source_image_name
coordinate_system
```

旧文件没有：

- `lane_id`（只有 `lane`）
- 统一 `bbox`（只有 `bbox_px`）
- `source_node_id` / `target_node_id`（只有 `source` / `target`）
- `source_port` / `target_port`
- 统一 `review_status`
- 完整 `provenance`
- `reconciliation` / `revisions`
- 新契约要求的 `controls[].display` / `attribution_status`
- 新契约要求的 `unresolved_items[].status`

---

## 2. 转换总流程

```text
读取旧 flowchart.json + style.json
  -> 保留原始 JSON（只读，不修改）
  -> 建立 lane 显示名/ID -> lane_id 映射
  -> 将 bbox_px 转为 normalized bbox
  -> 将 source/target 迁为 source_node_id/target_node_id
  -> 推断或标记 source_port/target_port
  -> 设置 review_status=pending
  -> 构造 provenance（image_extraction + legacy metadata）
  -> 补充 controls 显示字段（无法确定则 unresolved）
  -> 绑定 trade_purchase_cn 模板 profile
  -> 旧 theme 仅保留到 extensions.legacy；强制 excel_export_rules
  -> 补充 unresolved_items.status
  -> 生成 adaptation-report.json
  -> 运行 schema + 交叉引用校验
```

**不得直接修改旧文件。** 输出写入新目录或新文件名，例如：

```text
adapters/flowchart.contract.v1.json
adapters/adaptation-report.json
```

---

## 3. document 映射

| 旧字段 | 新字段 | 规则 |
|---|---|---|
| `document.title` | `document.title` | 保留 |
| `document.source_type` | `document.source_type` | `image`/`pdf`/`structured_json` |
| `document.source_image_name` | `document.source_image_name` | 保留 |
| `document.source_image_sha256` | `document.source_image_sha256` | 64 位小写十六进制；缺失/`not-provided` → `null`，原值放 extensions |
| `document.source_image_size_px` | 同名字段 | width/height 正整数；缺失则无法做 bbox 归一化 |
| `document.generated_at_utc` | `document.created_at` | 必须是 ISO-8601 UTC；无法解析则报错/待补 |
| `document.extraction_status` | 同名字段 | 默认 `draft_requires_human_validation` |
| `document.disclaimer` | 同名字段 | 保留；缺失用标准免责声明 |
| `coordinate_system` | `document.extensions.legacy.coordinate_system` | 归档保留 |
| 未知字段 | `document.extensions.legacy.unknown_fields` | 不删除 |

`job_id` 在旧辅助文件中通常不存在；第一切片可以留空，后续接入任务系统时再由服务端补。

## 4. lanes 映射


| 旧字段 | 新字段 | 规则 |
|---|---|---|
| `lanes[].id` | `lanes[].id` | 保留；重复则报错 |
| `lanes[].label` | `lanes[].label` | 保留 |
| `lanes[].order` | `lanes[].order` | 保留；缺失按数组顺序 |
| `lanes[].orientation` | `lanes[].orientation` | `horizontal/vertical`；非法值改为 `horizontal` 并记 unresolved |
| `lanes[].bbox_px` | `lanes[].source_bbox_px` | 保留原始像素 bbox |
| `lanes[].bbox_px` | `lanes[].bbox` | 按源图尺寸归一化 |
| `notes` | `provenance.notes` 或 `extensions.legacy.notes` | 保留 |

`lane_id` 映射：

1. 若节点 `lane` 精确等于某 lane 的 `id`，直接使用。
2. 若节点 `lane` 等于某 lane 的 `label`，映射到该 lane 的 `id`。
3. 若 `lane` 为空或找不到，`lane_id=null`，生成 `missing_lane` unresolved（type `other` 或扩展 `missing_lane`）。
4. 不得凭名称相似度自动合并泳道。

---

## 5. bbox 映射

旧 `bbox_px`：

```json
{ "x": 100, "y": 200, "w": 300, "h": 80 }
```

新 `bbox`：

```json
{
  "x": 0.0417,
  "y": 0.125,
  "width": 0.125,
  "height": 0.05,
  "coordinate_space": "normalized"
}
```

公式：

```text
x_norm = x_px / image_width_px
y_norm = y_px / image_height_px
w_norm = w_px / image_width_px
h_norm = h_px / image_height_px
```

规则：

- 源图尺寸优先取旧 `document.source_image_size_px`，其次取 `coordinate_system`。
- 没有尺寸 → 无法转换，标记 `coordinate_out_of_bounds` / `other` unresolved，不猜测。
- `x+w` 或 `y+h` 超出 1 → 保留原始值，归一化值 clamp 到 0..1 会改变几何，**不得静默 clamp**；应标记 `coordinate_out_of_bounds`，保留原始 `source_bbox_px`，并让人工处理。
- 旧字段 `w/h` 统一映射为 `width/height`。
- 原始像素 bbox 始终保留在 `source_bbox_px`。

---

## 6. nodes 映射

| 旧字段 | 新字段 | 规则 |
|---|---|---|
| `id` | `id` | 保留；重复则报错 |
| `label` | `label` | 保留；空字符串保留并标记低质量 |
| `shape` | `shape` | 合法枚举直接映射；未知值 → `other` + unresolved |
| `lane` | `lane_id` | 按 lane 映射规则 |
| `bbox_px` | `bbox` + `source_bbox_px` | 按 bbox 规则 |
| `controls` | `controls` | 保留 kind/code；补 display/attribution_status |
| `confidence` | `confidence` | high/medium/low；缺失 → `low` + unresolved |
| `text_status` | `extensions.legacy.text_status` | 新契约不直接用；保留 |
| `notes` | `provenance.notes` / `extensions.legacy.notes` | 保留 |
| 未知字段 | `extensions.legacy.*` | **不得删除** |

`review_status`：

- 旧数据没有 → 一律 `pending`。
- 不得把模型 `confidence=high` 自动写成 `confirmed`。

`provenance`：

- 旧 `provenance` 存在 → 保留 source/source_ref/model/notes。
- 缺失 → `source="image_extraction"`，`source_ref="legacy_helper_files"`，并填 `legacy` 元数据。
- 不把适配器伪装成人工修改或第二阶段核验。

---

## 7. edges 映射

| 旧字段 | 新字段 | 规则 |
|---|---|---|
| `id` | `id` | 保留；重复则报错 |
| `source` | `source_node_id` | 保留；不存在 → unresolved |
| `target` | `target_node_id` | 保留；不存在 → unresolved |
| 无 | `source_port` | 推断或 null |
| 无 | `target_port` | 推断或 null |
| `kind` | `kind` | 合法枚举；未知 → `other` + unresolved |
| `label` | `label` | 保留；空 → null |
| `route_hint` | `route_hint` | 合法枚举；未知 → `manual_review` + unresolved |
| `confidence` | `confidence` | 保留；缺失 → low |
| `source_of_relationship` | `provenance.source_ref` 或 legacy | 保留 |
| `notes` | `provenance.notes` | 保留 |
| 未知字段 | `extensions.legacy.*` | **不得删除** |

### 6.1 端口推断策略

旧数据没有端口。**不能默认都设成 right/left，也不能假装高置信度。**

仅当以下条件全部满足时推断：

- 两端节点都有合法 `bbox`；
- 边不是 `loopback` / `manual_review`；
- 两端 bbox 不重叠；
- 源/目标中心点关系明确（水平或垂直主方向）。

推断算法：

```text
dx = target.center_x - source.center_x
dy = target.center_y - source.center_y

if abs(dx) >= abs(dy):
    if dx >= 0:
        source_port = "right"; target_port = "left"
    else:
        source_port = "left";  target_port = "right"
else:
    if dy >= 0:
        source_port = "bottom"; target_port = "top"
    else:
        source_port = "top";    target_port = "bottom"
```

推断结果：

- `source_port` / `target_port` 写入推断值；
- `provenance.legacy.port_inference = "geometry_v1"`；
- 添加 `missing_port` unresolved（severity `medium`，action 要求人工确认）；
- 不把推断当作 owner 已确认。

否则：

- `source_port=null` / `target_port=null`；
- 添加 `missing_port` unresolved（severity `high`）；
- 最终导出 gate 会阻止导出。

### 6.2 悬空边

- `source_node_id` / `target_node_id` 找不到 → 仍转换，但 `confidence=low`、`review_status=pending`，添加 `dangling_edge` high unresolved。
- **不得删除悬空边**，也不得自动创建节点。
- 最终导出 gate 阻止导出。

---

## 8. controls 映射

| 旧字段 | 新字段 |
|---|---|
| `kind` | `kind`（CA/PRP/TOE） |
| `code` | `code`（规范化检查） |
| `style_token` | `extensions.legacy.style_token` 或 theme 引用 |
| 无 | `display` 默认 `badge` |
| 无 | `attribution_status` 默认 `needs_review` |

规则：

- `display=badge` 是默认表现，不代表业务归属已确认。
- `attribution_status=needs_review` 表示旧数据不足以确认归属。
- `P1`、`CA-1`、`PRP 1` 等非规范格式：
  - 保留原 code 到 `extensions.legacy.original_code`；
  - 不自动改写；
  - 添加 `noncanonical_control_code` unresolved；
  - 若必须规范化为 `PRP1`，需人工确认并在 revision 中记录。
- 编号缺口只报警，不创建控制点。

---

## 9. style 与 template profile 映射

旧 `style.json` 的 `theme` **不能**作为最终样式来源。最终样式以：

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

为最高优先级。adapter 输出根级字段：

```json
{
  "template_profile_id": "trade_purchase_cn",
  "template_profile_version": "1.0.0",
  "template_profile_ref": "docs/agent/flowchart-excel/trade-purchase-template-profile.md"
}
```

旧 theme 保留到：

```text
style.extensions.legacy.original_theme
```

`style.theme` 默认为 `{}`，不得把旧 `style.json` 的通用颜色/泳道规则当成最终样式。

`excel_export_rules` 必须强制规范化，不能信任旧文件/模型：

```json
{
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
```

说明：

- `edit_as="pending"`：目标模板默认 `twoCell`，POC 验证 `oneCell`；正式导出器必须比较后显式决策，不能由 adapter 或模型单方面决定。
- `swimlane_background/legend="template_defined"`：以目标模板实际结构为准，不强制 merged-cell 泳道或单元格图例。
- `require_windows_acceptance=false`：不伪造 Windows 验收状态。

旧 `style.status`、`source_image_name`、`coordinate_system`、`excel_export_rules` 等放入 `style.extensions.legacy`。

`style_overrides` 默认不生成；只有用户明确要求时才允许：

```json
{
  "source": "user_explicit",
  "reason": "客户明确要求局部颜色调整",
  "tokens": {}
}
```

不得通过 `tokens` 覆盖 `anchor_mode`、`edit_as`、原生连接器要求、模板 profile 或 export rules。

---

## 10. unresolved_items 映射

旧条目通常有：

```json
{ "id": "u_...", "type": "...", "description": "...", "severity": "...", "action": "..." }
```

新契约补充：

- `status = "pending"`
- `related_ids = []`（若能从描述/ID 推断则填）
- 缺失 `action` → `"请人工确认。"`
- 未知 `type` → `"other"`，原值放 `extensions.legacy.original_type`

不得删除旧 unresolved；可以新增 adapter 自己的 unresolved（例如 `missing_port`、`missing_lane`）。

---

## 11. 未知字段保留

旧 JSON 中无法映射的字段一律放入最近的 `extensions.legacy`：

```json
{
  "extensions": {
    "legacy": {
      "unknown_fields": {
        "some_old_field": "..."
      },
      "source_file": "flowchart.json",
      "adapter_version": "1.0.0"
    }
  }
}
```

规则：

- 不静默删除未知字段。
- 不把未知字段提升为正式契约字段。
- 如果未知字段包含疑似敏感信息，仍保留在受控文件中，但不写日志、不打包到公共 ZIP。

---

## 12. 适配报告

每次转换生成 `adaptation-report.json`，至少包含：

```json
{
  "adapter_version": "1.0.0",
  "input_files": ["flowchart.json", "style.json"],
  "output_schema_version": "1.0.0",
  "counts": {
    "lanes_in": 2,
    "lanes_out": 2,
    "nodes_in": 10,
    "nodes_out": 10,
    "edges_in": 9,
    "edges_out": 9
  },
  "mapped_fields": [],
  "inferred": {
    "ports": 4,
    "lane_ids": 0
  },
  "unresolved_added": [],
  "unknown_fields_preserved": [],
  "dropped_entities": [],
  "diff_summary": "no nodes/edges added or removed"
}
```

硬性要求：

- `nodes_out == nodes_in`，`edges_out == edges_in`；除非输入本身有非对象项，此时报告跳过并说明。
- 不得凭空新增节点/边。
- 不得静默修复悬空边或缺失端口。
- diff 应能按 ID 对齐 before/after 字段。

---

## 13. 转换后的校验

1. JSON 可解析。
2. 用 `docs/agent/flowchart-excel/flowchart.schema.json` 做 Draft 2020-12 校验。
3. 应用层交叉校验：
   - lane_id 引用；
   - edge 端点引用；
   - ID 唯一；
   - bbox 0..1；
   - 端口合法；
   - unresolved related_ids；
   - export_profile 强制项。
4. `adaptation-report.json`：节点/边数量守恒、未知字段保留、无静默修复。
5. 与旧文件做 ID 对齐 diff。

---

## 14. 不得做的事情

- 不得把旧 `flowchart.json` 直接送进 .NET 导出器。
- 不得因为 schema 有必填字段就伪造端口、lane 或 provenance。
- 不得自动把 `P1` 改成 `PRP1` 而不留记录。
- 不得把缺失 `review_status` 设成 `confirmed`。
- 不得丢弃未知字段。
- 不得在适配阶段调用视觉模型。
- 不得在适配阶段生成 XLSX。

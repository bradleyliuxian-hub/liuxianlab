# 流程图转 Excel — 外部 AI 包兼容修复报告

- 生成时间：2026-10-20 18:35 CST
- 项目：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- 服务：`http://localhost:8080`
- 范围：外部 AI 辅助文件包的 manifest 兼容、external AI graph 变体兼容、8080 上线验证
- 本阶段未调用 AI、未生成 XLSX、未修改 .NET POC、未执行数据库迁移

---

## 1. 结论

已修复连续两次外部包导入失败：

1. 第一次：`INVALID_MANIFEST`
2. 第二次：`SCHEMA_VALIDATION_FAILED`

修复后，使用用户实际上传的同一 ZIP 已完整跑通：

```text
status: review_required
sourceFormat: external_ai_variant
schemaValid: true
referencesValid: true
lanes: 3
nodes: 63
edges: 58
warnings: 8
unresolved: 22
exportReady: false
```

8080 已重启并加载修复，健康检查正常。旧失败任务不会自动重试，需要重新上传同一组文件生成新任务。

---

## 2. 输入材料

### 原始图片

```text
filename: PixPin_2026-10-20_17-52-15.png
size: 443254 bytes
dimensions: 1402 x 1133
sha256: a53ce3bc4c544aabdb97b68517d6e06571edb1876336a7210b911ca680a8d71e
```

### 外部 AI ZIP

```text
size: 305177 bytes
sha256: b1613a3f5ef5211e09add605400443c4dc4c8dd4aa2507fabb157eabc4e77e6e
members: manifest.json, flowchart.json, nodes.csv, edges.csv, style.json, conversion_report.md, review_overlay.png
```

### 实际失败任务

```text
job id: 02abccde-ce1a-4dfd-bb8d-3e01ddf3b140
error: SCHEMA_VALIDATION_FAILED
message: 外部图结构未通过 Schema 校验。
```

---

## 3. 第一次失败：Manifest 格式不兼容

外部包使用旧/变体 manifest：

```json
{
  "package_schema_version": "1.0.0",
  "package_type": "flowchart_helper_files",
  "files": [
    { "path": "flowchart.json", "sha256": "..." }
  ],
  "source_image": {
    "filename": "...",
    "width_px": 1402,
    "height_px": 1133,
    "sha256": "..."
  },
  "template_profile": { "id": "trade_purchase_cn" },
  "notes": ["..."]
}
```

当前 canonical manifest 要求：

```text
schema_version
package_version
files 为哈希对象
source_image.size
```

### 修复

新增无损归一化：

- `package_schema_version` -> `schema_version` / `package_version`
- `files` 数组 `{name/path, sha256}` -> 哈希对象
- `size_bytes/bytes/file_size` -> `size`（存在时）
- 缺少 `source_image.size` 时允许通过，由网站记录实际大小并产生 warning
- `width_px/height_px` 保留
- `package_type/template_profile/notes` 作为兼容元数据忽略
- 忽略 manifest 自身 hash
- 不补齐、不伪造任何文件 hash

真实文件 hash、原图 hash、ZIP 白名单和引用校验没有放宽。

涉及文件：

```text
services/flowchart_excel/manifest_validator.js
docs/agent/flowchart-excel/manifest.schema.json
server/flowchart-excel/external-import.js
```

---

## 4. 第二次失败：Graph 格式被误判为目标契约

外部 `flowchart.json` 有 `schema_version`、`template_profile_id` 和 `lane_id`，但没有 canonical root `style`，且字段结构不同。旧检测逻辑因此误判为“已经是目标格式”，直接进入 Schema 校验。

实际差异：

- 缺少 `style`
- `document` 缺 `source_type/source_image_name/source_image_sha256/source_image_size_px/created_at/extraction_status/disclaimer`
- 泳道缺少 `orientation`
- 泳道使用 `bbox_px`
- 节点 `bbox.coordinate_space = normalized_image_0_1`
- 节点 `source_bbox_px.coordinate_space = original_image_px`
- provenance 使用 `source_image/method/evidence`
- edge kind 使用 `sequence_flow/conditional_flow/...`
- route hint 使用 `straight/orthogonal/feedback/uncertain`
- unresolved 使用 `item_type/related_node_ids/recommended_review`
- 控制码使用 `T.AC1`、`PRP 1-4` 等非规范格式

### 修复原则

采用“显式兼容层”，不做静默猜测：

1. 只有具备 canonical `style` 的输入才视为已经是目标契约。
2. 外部变体先转换为目标契约，再运行 Schema 和引用校验。
3. 不新增节点、不删除节点、不伪造连线。
4. 非规范控制码不强行映射为 CA/PRP；保留原值并生成 unresolved item。
5. 无法确定的 route hint 标为 `manual_review`。
6. 所有推断和缺失信息都写入 warnings / unresolved。

### 字段映射

```text
document.image_width_px/height_px -> source_image_size_px
document.source_image          -> source_image_name
meta.sourceSha256              -> source_image_sha256
meta.createdAt                 -> created_at
lanes[].bbox_px                -> normalized bbox + source_bbox_px
lanes[].orientation            -> horizontal（缺失时，产生 warning）
bbox.coordinate_space          -> normalized
source_bbox_px.coordinate_space-> source_pixels
edge sequence_flow             -> sequence
edge conditional_flow          -> branch
edge feedback_flow             -> loopback
edge document_flow             -> document_output
edge cross_lane_flow           -> other
edge route straight            -> straight_horizontal / straight_vertical（按端口）
edge route orthogonal          -> manual_review
edge route feedback            -> loopback
edge route uncertain           -> manual_review
unresolved item_type           -> 目标枚举
```

控制码处理：

```text
T.AC1      -> 不自动映射，unresolved: noncanonical_control_code
T.AC2      -> 不自动映射，unresolved: noncanonical_control_code
PRP 1-4    -> 不自动映射，unresolved: noncanonical_control_code
PRP 5      -> 不自动映射，unresolved: noncanonical_control_code
```

`control_marker` 节点保留为 `other`，原始形状和原始 controls 存入 `extensions.legacy`。

涉及文件：

```text
services/flowchart_excel/legacy_adapter.js
server/flowchart-excel/external-import.js
```

---

## 5. 实际导入结果

使用用户上传的真实 ZIP 和后端测试路由执行完整导入：

```text
lanes_in/out: 3 / 3
nodes_in/out: 63 / 63
edges_in/out: 58 / 58
schema_valid: true
references_valid: true
status: review_required
exportReady: false
```

生成 artifact：

```text
external-helper-package.zip
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
review_overlay.png
flowchart-helper-files.zip
import-validation-report.json
```

### 警告（8 条）

```text
1. manifest 未提供原图大小；已由网站记录实际上传值。
2. 流程图未提供 created_at；已使用任务创建时间。
3-5. 三个泳道缺少 orientation；已按 horizontal 处理。
6. 判断节点 N034 只有 1 条出边，可能缺少分支。
7-8. Windows Excel 验收尚未标记为 true（export_profile / style 两处）。
```

### 待人工确认（22 条）

```text
8 条  非规范控制码（T.AC1 / T.AC2 / PRP 1-4 / PRP 5）
4 条  control_marker 形状映射为 other
10 条 外部 AI 原始 unresolved，包括：
      - 中间泳道是否重复/分页
      - 跨泳道红色连线端点
      - N034 的 No 分支目标
      - 数据存储连线端口
      - 低可读文字
      - 控制分类与编号
      - 坐标基准
      - Schema 与模板样式未随包提供
```

这些不是导入失败，而是需要人工复核的内容。

---

## 6. 测试与部署

### 测试

```text
node --test tests/flowchart-excel/*.test.js
93 pass / 0 fail

.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t .
14 tests OK

npm test
378 pass / 0 fail
```

新增覆盖：

- 旧 manifest 归一化
- external AI graph 变体归一化
- 非规范控制码不伪造映射
- 真实 ZIP 完整导入
- 首页工具库映射

### 8080

```text
listener: node server.js @ 127.0.0.1:8080
PID: 81227
health: {"ok":true}
```

启动日志无错误。

---

## 7. 使用方式

1. 打开 `http://localhost:8080/`。
2. 刷新或强制刷新页面。
3. 进入“流程图转 Excel”。
4. 重新选择原图和同一个外部 AI ZIP。
5. 点击“上传并校验”。
6. 预期进入 `review_required`，而不是 `failed`。
7. 下载 `import-validation-report.json` 和辅助文件。

旧任务 `02abccde-ce1a-4dfd-bb8d-3e01ddf3b140` 会保留为失败审计记录，不能原地重试；重新上传会创建新任务。

---

## 8. 当前边界

- 本阶段只导入、校验、规范化，不包含图形化人工复核编辑器。
- 最终 Excel 样式仍以 `trade_purchase_cn` profile 为最高优先级。
- `edit_as` 仍为 `pending`。
- `exportReady` 始终为 false。
- 未调用 AI，未生成 XLSX。
- 未做浏览器自动化登录/上传；使用真实 ZIP 的后端集成测试已通过。

## 9. 建议下一步

优先做人工复核工作台，处理这 22 条 unresolved，尤其是：

1. 控制码映射与控制编号。
2. 中间泳道是否为重复/分页。
3. N034 的 No 分支端点。
4. 跨泳道红色连线端点。
5. 低置信度文字与坐标。

完成人工复核后，再进入联合理解和 Excel 导出 gate。

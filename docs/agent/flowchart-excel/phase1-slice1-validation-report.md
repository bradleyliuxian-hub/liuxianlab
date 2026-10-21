# Phase 1 Slice 1 Validation Report

- 日期：2026-10-20
- 范围：共享 JSON Schema validator + 旧辅助文件 adapter + 跨引用校验 + 合成 fixture + `node:test`
- 明确未做：网页、Express API、AI 调用、图片上传、数据库迁移、XLSX 生成、React/Vite/X6、.NET POC 修改

---

## 1. Git 状态

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
```

执行前为 dirty（执行前 21 项，新增设计文档后 22 项）。本次完成后实际未提交条目为 **26 项**，新增内容包括：

```text
docs/agent/flowchart-excel/（设计文档）
services/flowchart_excel/（本切片代码）
tests/flowchart-excel/（测试）
tests/fixtures/flowchart-excel/（合成 fixture）
package.json / package-lock.json（Ajv 直接依赖 + 新测试 glob）
```

未执行 `git reset`、`git clean`、`stash`、`checkout`、`restore`；未提交。

---

## 2. 新增/修改文件

### 新增代码

```text
services/flowchart_excel/validator.js
services/flowchart_excel/legacy_adapter.js
services/flowchart_excel/reference_validator.js
```

### 新增测试与 fixture

```text
tests/flowchart-excel/validator.test.js
tests/flowchart-excel/legacy-adapter.test.js
tests/flowchart-excel/reference-validator.test.js
tests/fixtures/flowchart-excel/legacy-minimal.json
```

### 修改

```text
package.json         # 增加 ajv direct dependency；test script 加入 tests/flowchart-excel/*.test.js
package-lock.json    # Ajv 8.20.0 及其 4 个传递依赖
docs/agent/flowchart-excel/flowchart.schema.json
docs/agent/flowchart-excel/flowchart-data-contract.md
docs/agent/flowchart-excel/legacy-helper-files-adapter.md
```

### 新增模板 profile

```text
docs/agent/flowchart-excel/trade-purchase-template-profile.md
```

### 未修改

```text
server.js
config/tools.json
private/
数据库 / migration
现有业务 API
POC /Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc
```

---

## 3. Schema 与 adapter 数据转换规则

### 3.1 Schema

唯一 Schema 文件：

```text
docs/agent/flowchart-excel/flowchart.schema.json
```

`validator.js` 从该路径读取并只编译一次（进程内缓存）。使用 Ajv 2020-12，`strict:false`、`allErrors:true`。

错误结构：

```json
{
  "code": "SCHEMA_VALIDATION_FAILED",
  "instancePath": "/nodes/0/shape",
  "schemaPath": "#/$defs/node/properties/shape/enum",
  "keyword": "enum",
  "message": "must be equal to one of the allowed values",
  "params": {}
}
```

不把原始文档内容放进错误消息。

### 3.2 Adapter

`legacy_adapter.js` 的规则：

- `schema_version` 输出固定 `1.0.0`
- 根级写入 `template_profile_id=trade_purchase_cn`、`template_profile_version=1.0.0`、`template_profile_ref`
- 旧 `style.json` theme 不进入最终 `style.theme`；保留到 `style.extensions.legacy.original_theme`
- `nodes[].lane` → `lane_id`
  - 先按旧 lane ID 精确匹配
  - 再按 unique label 匹配，并写 `LANE_MAPPED_BY_LABEL` warning
  - 模糊/重复/缺失 → `lane_id=null` + unresolved
- `bbox_px {x,y,w,h}` → 归一化 `bbox`；保留 `source_bbox_px`
  - 原图尺寸从 `document.source_image_size_px` 或 `coordinate_system` 读取
  - 超出边界不 clamp；记录 unresolved；节点缺 bbox 时 adapter 返回 `ok:false`
- `edges[].source/target` → `source_node_id` / `target_node_id`
- 端口：
  - 旧值合法则保留
  - 否则按两端 bbox 中心相对位置推断，并记录 `PORT_INFERRED` + `provenance.legacy.port_inference="geometry_v1"` + `missing_port` unresolved
  - loopback/manual_review 或无 bbox → `null` + high unresolved
- `review_status`：旧值合法则保留，否则 `pending`
- `confidence`：合法则保留，否则 `low`
- `provenance`：旧值合法则保留，否则 `image_extraction` + `legacy_helper_files`，并保留旧 ID
- `controls`：
  - 只接受 CA/PRP/TOE 和规范 code
  - `display` 默认 `badge`
  - `attribution_status` 默认 `needs_review`
  - 非规范控制标记不进入 `controls`，原始对象保留到 `extensions.legacy.invalid_controls`，并写 unresolved
- 未知字段：保留到最近的 `extensions.legacy.unknown_fields`
- 旧 unresolved：补 `status=pending`、默认 action、相关 ID
- 旧 style theme 只保留审计副本；最终视觉以 `trade_purchase_cn` profile 为准
- 已经是 `1.0.0` 且含 `lane_id` 的契约：返回 `alreadyAdapted:true`，不二次嵌套
- 同一输入/同一 adapter 版本：输出与报告可重复

### 3.3 `needs_review`

本切片将 `attribution_status` 枚举补充为：

```text
confirmed | inferred | unresolved | needs_review
```

理由：旧辅助文件通常不足以确认 CA/PRP/TOE 归属；`needs_review` 比假装 `confirmed` 或只写 `inferred` 更准确。Schema 与契约文档已同步。

### 3.4 强制 export rules

Adapter 不信任输入 style / export_profile：

```text
native_shapes_only = true
native_bound_connectors_only = true
one_logical_edge_one_connector = true
anchor_mode = twoCellAnchor
edit_as = pending
swimlane_background = template_defined
legend = template_defined
require_excel_drag_save_reopen_test = true
require_windows_acceptance = false
```

`require_windows_acceptance=false` 是刻意的：POC 仍缺 Windows 详细证据；adapter 不声称已满足。Reference validator 会发出 `WINDOWS_ACCEPTANCE_PENDING` warning，`exportReady=false`。

`edit_as=pending` 也是刻意的：目标模板默认 `twoCell`，POC 验证的是 `oneCell`；正式导出器必须先做对照测试后显式决策。`edit_as=pending` 时 `exportReady=false`。

---

## 4. 错误 / 警告 / unresolved 的区分

### Schema errors（硬失败）

- 非法 `schema_version`
- 非法 shape/kind/route/confidence/review_status
- 缺必填字段
- bbox 数值越界/非有限
- 非法 `anchor_mode`

### 跨引用 / 结构 errors（硬失败）

- 重复 node/lane/edge ID
- 不存在的 `lane_id`
- 悬空 `source_node_id` / `target_node_id`
- 非法端口值
- 非法控制 kind/code
- 非法 export rules
- 非法 template profile id/version
- `style_overrides.source` 不是 `user_explicit`
- `style_overrides` 尝试覆盖硬性规则
- 非法 unresolved item 结构

### warnings（不单独导致失败）

- 泳道按显示名称映射
- 端口由几何推断
- 分支标签缺失
- 判断节点出边少于 2
- 控制编号缺口
- `require_windows_acceptance=false`
- 模板 profile 文件不存在
- 缺少泳道（同时产生 unresolved）

### unresolved（待人工确认，不自动修复）

- 悬空边（high）
- 端口为空（high）
- 端口推断待确认（medium）
- 模糊/缺失泳道（medium）
- 控制编号缺口（medium）
- 旧 unresolved 保留并补 status

`reference_validator.js` 的 `valid` 只由 errors 决定；warnings 不使其失败。
`exportReady` 额外要求无 high unresolved、export rules 合规、Windows gate 为 true。

---

## 5. Ajv 依赖类型与理由

执行前检查：

```text
npm ls ajv --depth=0 -> empty
node require('ajv') -> 8.20.0 from /Users/a123/AI-Workspace/node_modules
```

Ajv 是 workspace 根部的间接/环境依赖，不是本项目 package.json 的直接依赖。本切片 validator 在运行时需要 Ajv，因此添加：

```json
"dependencies": {
  "ajv": "^8.20.0"
}
```

实际锁定：**Ajv 8.20.0**，新增 4 个传递依赖（fast-deep-equal、fast-uri、json-schema-traverse、require-from-string）。没有升级其他依赖。

---

## 6. 实际执行命令与结果

### 新测试

```bash
cd /Users/a123/AI-Workspace/projects/liuxianlab-online
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 45
pass 45
fail 0
```

### 全量测试

```bash
npm test
```

结果：

```text
tests 330
pass 330
fail 0
```

原基线 285 pass；新增 45 个测试后为 330 pass。

### 健康检查

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

未启动、重启或干扰 8080 服务。

---

## 7. 测试覆盖

### Schema

- 合法适配文档通过
- `source_image_sha256=null` 通过
- 错误 schema_version / shape / bbox / anchor_mode / 缺字段失败
- 非法 JSON 字符串返回稳定错误
- 输入修改不会污染共享编译后的 schema

### Adapter

- lane ID 优先映射
- 唯一显示名称映射
- 模糊/重复泳道名称 → null + unresolved
- bbox 归一化 + source_bbox_px 保留
- source/target 迁移
- 端口几何推断 + 推断记录
- loopback 无端口 → null + high unresolved
- confidence 与 review_status 分离
- CA/PRP/TOE 迁移 + needs_review
- 未知字段保留
- 悬空边保留并报告
- 缺原图尺寸安全失败，不伪造坐标
- 同输入可重复
- 已是目标版本不二次迁移

### Reference validator

- 重复 node/lane/edge ID
- 无效 lane_id
- 悬空 source/target
- 非法端口
- bbox 越界/非有限
- 非法 control kind/code
- 分支标签缺失 → warning + unresolved
- 控制编号缺口 → warning + unresolved，不创建控制点
- export_profile / style rules 覆盖 → error
- 错误 template profile id、模板 profile 引用缺失（含 profile 文件存在性）
- 不可信/越权的 style_overrides
- 显式 user_explicit style_override 允许局部 tokens
- high unresolved / pending editAs / Windows gate → `exportReady=false`

---

## 8. 对现有服务的影响

预期且实际：**无影响**。

- 未修改 `server.js`、`config/tools.json`、`private/`、数据库或业务 API。
- 未新增 Express 路由。
- 未调用 AI、未上传图片、未生成 XLSX。
- `npm test` 通过；`/health` 仍为 ok。
- 新代码目前是独立服务模块，尚未被任何路由调用。

---

## 9. 未完成事项与下一步

未完成：

- Node API / 任务表 / 文件存储 / worker runner；
- Python stage1/stage2 AI worker；
- React/X6 复核工作台；
- .NET 导出服务接入；
- Windows 详细验收补录；
- 页面与工具卡片注册；
- 数据库迁移；
- 目标模板 anchor 最终策略（`twoCell` vs POC `oneCell`，当前 contract 为 `pending`）；
- 模板 profile 的机器可读 tokens 文件（当前以 Markdown profile 为规范）。

下一步建议：

1. 评审本切片契约与 adapter 行为；
2. 再执行 Slice 2：`server/flowchart-excel` 任务骨架 + 上传/状态/权限 + fake worker；
3. 在接入真实 AI 前，先确定模型端点、图片外发授权与成本；
4. 在接入 .NET 导出前，补录 Windows 逐项证据；
5. 真实导出前，保持 `require_windows_acceptance=false`，不得伪装已满足。

---

## 10. 明确未做

```text
未修改 server.js
未修改 config/tools.json
未创建/修改 private/tools/
未创建 Express API
未修改数据库 schema/migration
未调用 AI
未上传图片/PDF
未生成 XLSX
未修改 .NET POC
未开始 React/Vite/X6
未提交 Git commit
```

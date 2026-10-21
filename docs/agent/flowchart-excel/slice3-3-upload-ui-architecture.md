# Slice 3.3 — Manifest Schema + 外部辅助文件上传 UI

状态：已实施（上传/校验/任务结果；无图形编辑器）
目标：把 Slice 3.2 的外部辅助文件导入后端变成网站工具页面；不调用 AI、不生成 XLSX。

---

## 1. 工具入口

- slug：`flowchart-excel`
- URL：`/tools/flowchart-excel`
- 页面：`private/tools/flowchart-excel/index.html`
- 样式：`private/tools/flowchart-excel/styles.css`
- 脚本：`private/tools/flowchart-excel/script.js`
- 工具卡片：`config/tools.json`
- 首页工具库映射：`private/script.js` 的 `TOOL_IA` 增加 `flowchart-excel -> Excel / 专业分析`

页面沿用现有 Vanilla HTML/CSS/JS + `app-shell`，没有引入 React/Vite/X6。

---

## 2. Manifest Schema

新增：

```text
docs/agent/flowchart-excel/manifest.schema.json
services/flowchart_excel/manifest_validator.js
```

Schema（Draft 2020-12）校验：

- `schema_version = 1.0.0`
- `package_version = 1.0.0`
- `generation_mode = external_ai`
- `ai_extraction_performed_by_website = false`
- `source_image.filename` 普通文件名，不允许路径
- `source_image.size` 可选正整数；缺失时由网站记录实际上传值并 warning
- `source_image.width_px` / `height_px` 可选
- `source_image.sha256` 64 位 hex 或 null
- `files` 包含五个核心文件 hash
- 可选 `review_overlay.png` hash
- `model` / `prompt_version` 可选
- 拒绝额外字段

应用层仍重新计算所有真实文件 hash、检查原图 hash、ZIP 白名单、Schema/reference；JSON Schema 只做结构校验，不是真实性证明。

为兼容外部 AI 常见的旧/变体 manifest，先做无损归一化：

- `package_schema_version` -> `schema_version/package_version`
- `files` 数组 `{name/path, sha256}` -> 哈希对象
- `source_image.width_px/height_px` 保留为可选元数据
- `size_bytes/bytes/file_size` -> `size`（若存在）
- 忽略 `package_type`、`template_profile`、`notes`
- 不补齐或伪造任何文件 hash；真实 hash 仍由应用层重新计算

外部 `flowchart.json` 若使用 “已有 nodes/edges、但缺 canonical root/style/document 字段” 的 AI 变体，也会先归一化：

- `document.image_width_px/height_px` -> `source_image_size_px`
- `lanes[].bbox_px` -> normalized bbox + `source_bbox_px`
- `bbox.coordinate_space=normalized_image_0_1` -> `normalized`
- `source_bbox_px.coordinate_space=original_image_px` -> `source_pixels`
- 外部 edge kind/route hint -> 目标枚举；无法确定的 route hint 标为 `manual_review`
- 非规范控制码（如 `T.AC1`、`PRP 1-4`）不伪造映射，转入 unresolved item
- 外部 `control_marker` 形状转为 `other`，保留原值并进入待确认项
- `style.json` 只作为审计扩展；最终使用 `trade_purchase_cn` + forced `edit_as=pending` 导出规则

实现位置：

- `manifest_validator.js`
- `external-import.js` 在 `validateManifest` 前调用 `validateManifestSchema`
- 失败返回 `INVALID_MANIFEST`

---

## 3. UI 流程

```text
选择原图 + ZIP
  -> 浏览器本地预览图片
  -> POST /api/flowchart-excel/jobs/import-helper-package
     FormData: image, package, generationMode=external_ai
  -> 轮询 GET /api/flowchart-excel/jobs/:id
  -> 终态后 GET /artifacts
  -> 按 artifact ID 下载
  -> 读取 import-validation-report.json 摘要
```

页面功能：

- 原图上传区（PNG/JPG/JPEG/WebP，本地预览，object URL 清理）
- ZIP 上传区（.zip，必需文件说明）
- 上传按钮仅在两个文件都选择后启用；提交时禁用
- 任务状态、进度、warnings/unresolved、review_required 提示
- `exportReady=false` 明确展示
- artifact 列表/按 ID 下载
- import-validation-report 摘要
- 历史任务列表（owner-scoped）
- 空/加载/失败状态

---

## 4. 认证与安全

- 页面由现有 `/tools/:slug` 自动加载，需登录。
- API 由 `requireAuth` + `sameOriginForStateChange` 保护。
- 前端 `fetch` 使用 `credentials: 'same-origin'`；不使用自定义 token。
- 前端不持有模型 API Key、不调用模型端点。
- 下载 URL 只使用服务端 artifact ID，不拼接文件路径。
- 动态文本通过 `textContent` 写入，不使用 `innerHTML`。
- 本地预览使用 `URL.createObjectURL`，在清除/卸载时 `revokeObjectURL`。
- 轮询 1.5s，最长 5 分钟；终态停止；`beforeunload` 清理。

---

## 5. 任务字段

外部导入继续使用：

```text
workerMode: external_import
generationMode: external_ai
aiExtractionPerformedByWebsite: false
resultKind: external_helper_files
exportReady: false
templateProfileId: trade_purchase_cn
editAs: pending
```

页面显示 `Excel 导出尚未开放：edit_as 仍为 pending，exportReady=false`。

---

## 6. 目标模板优先级

- 最终 Excel 视觉以 `trade_purchase_cn` profile 为最高优先级。
- 页面不把外部 `style.json` 或 UI 颜色当最终 Excel 样式。
- 不复制模板采购示例、教学图例或 “Remove before use”。
- 不修改 `edit_as`，不打开 export gate。

---

## 7. 测试

- `tests/flowchart-excel/manifest-schema.test.js`
- `tests/flowchart-excel/ui.test.js`
- 既有 external import / fake / real 测试

UI 测试是静态结构/契约测试，不引入浏览器自动化框架。手动测试需重启/启动一个新的开发服务实例，不要干扰现有 8080。

---

## 8. 下一阶段

建议先做**人工复核工作台**，再做第二阶段联合理解：

1. 外部 AI 结果本身需要人工确认；先做复核能尽快发现结构/文字/连线错误。
2. 联合理解依赖一个可审阅、可修订的数据基线；否则会把外部结果的不确定性叠加。
3. 复核工作台可以复用现有 canonical JSON/CSV/overlay/artifact API。
4. 最终 Excel 样式和 `edit_as` 决策也应在人工确认与导出 gate 之后。

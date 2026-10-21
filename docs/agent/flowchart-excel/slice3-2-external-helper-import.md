# Slice 3.2 — 外部 AI 辅助文件包导入

状态：已实施（后端导入路径；无正式 UI）
目标：上传原始图片 + 外部 AI 生成的 `flowchart-helper-package.zip`，网站校验、规范化、存档并进入人工复核前状态。
明确跳过：网站内视觉模型调用。不需要 `FLOWCHART_BASE_URL` / `FLOWCHART_MODEL` / `FLOWCHART_API_KEY`。

---

## 1. 用户流程

```text
原始图片 + 外部 AI ZIP
  -> POST /api/flowchart-excel/jobs/import-helper-package
  -> ZIP 安全校验
  -> manifest/哈希校验
  -> flowchart.json 直接验证或 legacy adapter
  -> Schema + reference validation
  -> 网站重新生成规范化辅助文件
  -> external_helpers_ready / review_required
```

任务元数据：

```text
workerMode: "external_import"
generationMode: "external_ai"
aiExtractionPerformedByWebsite: false
resultKind: "external_helper_files"
exportReady: false
templateProfileId: "trade_purchase_cn"
editAs: "pending"
```

不启动 real/fake worker，不调用任何视觉模型。

---

## 2. API

```text
POST /api/flowchart-excel/jobs/import-helper-package
```

multipart 字段：

```text
image          原始 PNG / JPG / JPEG / WebP
package        外部 AI 生成的 ZIP
generationMode 必须为 external_ai
```

成功后返回 201 和 job；后续状态/artifact 沿用现有 API。

状态：

```text
uploaded
-> validating_package
-> normalizing
-> validating_graph
-> building_helpers
-> external_helpers_ready | review_required
```

硬错误 -> `failed`。warning/unresolved -> `review_required` 或成功状态带 warnings。

---

## 3. 外部包规范

ZIP 根目录只允许：

```text
manifest.json           必需
flowchart.json          必需
nodes.csv               必需
edges.csv               必需
style.json              必需
conversion_report.md    必需
review_overlay.png      可选
```

不允许子目录、额外文件、嵌套 ZIP、可执行文件或其他扩展名。

### manifest.json

```json
{
  "schema_version": "1.0.0",
  "package_version": "1.0.0",
  "generation_mode": "external_ai",
  "ai_extraction_performed_by_website": false,
  "source_image": {
    "filename": "flowchart.png",
    "size": 123456,
    "sha256": "64位小写十六进制或 null"
  },
  "files": {
    "flowchart.json": "sha256",
    "nodes.csv": "sha256",
    "edges.csv": "sha256",
    "style.json": "sha256",
    "conversion_report.md": "sha256",
    "review_overlay.png": "可选 sha256"
  },
  "model": {
    "name": "外部模型名",
    "provider": "外部模型服务"
  },
  "prompt_version": "1.0.0"
}
```

规则：

- `generation_mode` 必须 `external_ai`。
- `ai_extraction_performed_by_website` 必须 `false`。
- 必需文件实际 SHA-256 必须与 manifest 一致。
- 原图 SHA-256 必须与上传图片一致；manifest 为 null 时记录 warning，不得伪造。
- manifest 文件自身不需要出现在 `files` 哈希表中。
- `source_image.filename/size` 与上传文件不一致时记录 warning；以实际上传为准。

---

## 4. ZIP 安全

`safe-zip.js` 自己解析 EOCD/central directory，不把 ZIP 当字符串拼接：

- 拒绝 ZIP Slip、`../`、绝对路径、Windows drive path、反斜杠路径；
- 拒绝目录条目；
- 拒绝大小写不敏感重复文件名；
- 拒绝加密 ZIP（flag bit 0）；
- 拒绝符号链接（Unix external attrs）；
- 拒绝嵌套 ZIP；
- 拒绝非 UTF-8 文件名、空名、NUL；
- 拒绝 ZIP64；
- 只支持 stored/deflate；
- 限制包大小、条目数、单文件解压大小、总解压大小、压缩比；
- 用 `zlib.inflateRawSync({ maxOutputLength })` 限制解压输出；
- 校验 CRC32；
- 只允许白名单文件名。

默认限制：

```text
package <= 15 MiB
entries <= 12
single uncompressed <= 10 MiB
total uncompressed <= 30 MiB
compression ratio <= 200
```

原图仍受 Slice 2/3 限制：25 MiB、50,000,000 像素。Node 先做扩展名/MIME/魔数/结构探测；随后 `external-import.js` 调用 `.flowchart-venv` 的 `image_validation --check` 做 Pillow 完整像素解码。该 Python 步骤只验证图片，不调用模型、不发送图片。

---

## 5. 图结构处理

- `flowchart.json` 若已是统一契约 1.0.0 + `template_profile_id=trade_purchase_cn` + `lane_id`，直接 Schema/reference 校验。
- 否则使用 `legacy_adapter.js` 转换后校验。
- 外部导入路径不调用 `vision_worker`/`real-worker`。
- 不信任外部 CSV：以最终规范化 JSON **重新生成** `nodes.csv` / `edges.csv`，原 CSV 只作为审计 ZIP 的一部分保留。
- `style.json` 只做冲突检查；最终 `style.json` 由网站重新生成，固定：
  - `template_profile_id=trade_purchase_cn`
  - `template_profile_version=1.0.0`
  - `edit_as=pending`
- 外部 `conversion_report.md` 只作为审计材料；网站另生成 canonical report。
- 外部 `review_overlay.png` 可选；通过 PNG 探测后原样归档，若无效则 warning。
- `node.lane_id`、`edge.source_node_id/target_node_id`、端口、bbox、shape/kind/route_hint、controls 由现有 validators 检查。
- `review_status` 仍默认 pending；`confidence` 不自动变成 confirmed。
- 编号缺口只报警，不补造。

---

## 6. Artifacts

成功后注册：

```text
external-helper-package.zip    原始外部包（audit）
flowchart.json                 网站规范化契约
nodes.csv                      由规范化 JSON 重生成
edges.csv                      由规范化 JSON 重生成
style.json                     固定 template profile + export rules
conversion_report.md           网站生成的报告
review_overlay.png             可选，外部导入
flowchart-helper-files.zip     网站生成的辅助文件包
import-validation-report.json  网站实际校验报告
```

失败时：

```text
validation-errors.json
```

不含 API Key、完整请求头、原图内容或敏感模型响应。

---

## 7. 权限

- 沿用 `requireAuth` + `sameOriginForStateChange`。
- 外部导入任务 owner 隔离。
- 所有 artifact 下载走现有 white-list/owner API。
- 不接受客户端提供的任意文件路径。
- 原始 ZIP 作为审计 artifact，只有 owner 可下载。

---

## 8. 与 fake/real 的关系

| 模式 | workerMode | 结果 |
|---|---|---|
| fake | `fake` | `mock_helpers_ready` / synthetic |
| real | `real` | `helpers_ready` / AI 识别 |
| external import | `external_import` | `external_helpers_ready` / `review_required` |

外部导入不调用视觉模型、不生成 `vision/` 模型输出目录；仅调用本地 Python Pillow 做原图完整解码校验。

---

## 9. 后续

- 正式 UI 上传“图片 + ZIP”页面；
- 人工复核工作台；
- 第二阶段联合理解；
- 数据库迁移；
- 最终 XLSX 导出。

最终 Excel 仍以 `trade_purchase_cn` 为最高优先级，`edit_as` 仍为 `pending`，`exportReady=false`。

# Slice 3.2 Validation Report — 外部 AI 辅助文件包导入

- 日期：2026-10-20
- 范围：外部 AI ZIP + 原图导入、ZIP 安全、manifest/哈希校验、adapter/schema/reference、规范化 artifacts、owner 权限
- 未做：网站内 AI 调用、正式 UI、第二阶段联合理解、数据库迁移、XLSX、.NET POC 修改、真实模型验收

---

## 1. Git 状态

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
status: dirty
未提交条目：27
```

未执行 reset、clean、stash、checkout、restore 或 commit。既有 dirty 修改保留。

---

## 2. 新增/修改文件

### 新增

```text
server/flowchart-excel/safe-zip.js
server/flowchart-excel/external-import.js
tests/flowchart-excel/external-import.test.js
docs/agent/flowchart-excel/slice3-2-external-helper-import.md
docs/agent/flowchart-excel/slice3-2-validation-report.md
```

### 修改

```text
server/flowchart-excel/routes.js       # POST /jobs/import-helper-package
server/flowchart-excel/service.js      # external_import 模式、startExternalImport、jobDir
server/flowchart-excel/artifacts.js    # 支持外部 overlay buffer
services/flowchart_excel/image_validation.py  # --check CLI（Pillow 完整解码）
```

未修改：

```text
server.js（Slice 2 已 mount）
config/tools.json
private/
数据库 migration
real/fake worker 行为
.NET POC
```

---

## 3. API

```text
POST /api/flowchart-excel/jobs/import-helper-package
```

multipart：

```text
image           PNG / JPG / JPEG / WebP
package         外部 AI helper ZIP
generationMode  external_ai（必需）
```

状态：

```text
uploaded
-> validating_image
-> validating_package
-> normalizing
-> validating_graph
-> building_helpers
-> external_helpers_ready | review_required
```

失败 -> `failed`。
不调用 `real-worker`，不调用 AI，不生成 `vision/raw-extraction.json`。

任务标记：

```text
workerMode: external_import
generationMode: external_ai
aiExtractionPerformedByWebsite: false
resultKind: external_helper_files
exportReady: false
templateProfileId: trade_purchase_cn
editAs: pending
```

---

## 4. ZIP 安全

`safe-zip.js` 自行解析 EOCD / central directory：

- ZIP Slip / `../` / 绝对路径 / Windows drive path / 反斜杠路径
- 目录条目
- 大小写不敏感重复文件名
- 加密 ZIP（flag bit 0）
- 符号链接（Unix external attributes）
- 嵌套 ZIP
- 非 UTF-8 / 空名 / NUL 文件名
- ZIP64
- 非 stored/deflate 方法
- 包大小、条目数、单文件大小、总解压大小、压缩比
- 用 `zlib.inflateRawSync({ maxOutputLength })` 限制解压
- CRC32 校验
- 严格 allow-list：

```text
manifest.json
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
review_overlay.png（可选）
```

默认限制：

```text
package <= 15 MiB
entries <= 12
single uncompressed <= 10 MiB
total uncompressed <= 30 MiB
compression ratio <= 200
```

原图上传统一保持：25 MiB、50,000,000 像素；Node 结构探测后，`external-import.js` 调用 `.flowchart-venv` Pillow `image_validation --check` 做完整像素解码。该步骤不调用模型。

---

## 5. manifest 与哈希

manifest 必需字段：

```json
{
  "schema_version": "1.0.0",
  "package_version": "1.0.0",
  "generation_mode": "external_ai",
  "ai_extraction_performed_by_website": false,
  "source_image": { "filename": "...", "size": 123, "sha256": "64-hex-or-null" },
  "files": {
    "flowchart.json": "sha256",
    "nodes.csv": "sha256",
    "edges.csv": "sha256",
    "style.json": "sha256",
    "conversion_report.md": "sha256"
  }
}
```

检查：

- `generation_mode` 必须是 `external_ai`；
- 不得声称网站执行 AI；
- 原图 SHA-256 必须与实际上传图片一致；manifest 为 null 时记录 warning；
- 必需文件实际 SHA-256 必须匹配；
- 原图 filename/size 不一致只警告，以实际上传为准；
- 原始 ZIP 作为 audit artifact 保存，只有 owner 可下载。

---

## 6. 图结构处理

- 若 `flowchart.json` 已是统一契约 1.0.0（含 `lane_id`、`template_profile_id=trade_purchase_cn`），直接 Schema/reference 校验。
- 否则走现有 `legacy_adapter.js`。
- 外部 CSV 只校验文件 hash + AZIP 审计；网站从最终规范 JSON 重新生成 canonical `nodes.csv` / `edges.csv`，避免 JSON/CSV 双源冲突。
- 外部 `style.json` 只做冲突检查；网站重新生成 canonical style：
  - `template_profile_id=trade_purchase_cn`
  - `edit_as=pending`
  - `exportReady=false`
- 外部 `conversion_report.md` 不冒充网站报告；网站生成自己的 report。
- 外部 `review_overlay.png` 可选；无效 PNG 警告并跳过。
- 硬 Schema/reference 错误 -> failed，不生成正式 helper ZIP。
- warnings/unresolved -> 允许生成 helper，状态 `review_required`。

---

## 7. Artifacts

成功：

```text
external-helper-package.zip     原始外部包（audit）
flowchart.json                  网站规范化契约
nodes.csv                       从规范 JSON 重生成
edges.csv                       从规范 JSON 重生成
style.json                      固定 profile
conversion_report.md            网站生成
review_overlay.png              可选
flowchart-helper-files.zip      网站生成
import-validation-report.json   网站实际校验报告
```

失败：

```text
validation-errors.json
```

`import-validation-report.json` 明确区分：

- 外部 AI 声称的 model/provider/prompt/hash；
- 网站实际执行的 ZIP/manifest/Schema/reference 校验；
- warnings/unresolved；
- `aiExtractionPerformedByWebsite=false`；
- `exportReady=false`。

---

## 8. 权限

- 沿用 `requireAuth` + `sameOriginForStateChange`。
- task owner 隔离；其他用户 404。
- artifact 通过现有 ID allow-list 下载，不接受客户端路径。
- 原始 ZIP audit artifact 也按 owner 隔离。
- 不读取或输出 storage 中其他用户数据。

---

## 9. 真实测试结果

### Node flowchart

```bash
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 77
pass 77
fail 0
```

Slice 3.2 新增 10 个测试，覆盖：

- 正常外部包导入 -> review_required
- owner 隔离
- 缺少文件、无效 manifest generation mode
- 文件 hash / 原图 hash 不匹配
- ZIP Slip / 绝对路径 / 反斜杠路径
- 嵌套 ZIP / 大小写重复
- ZIP bomb / 条目过多 / 加密 / 符号链接
- Schema 失败 / 悬空边
- 新格式直接使用 / 旧格式 adapter
- style profile 覆盖拒绝
- canonical CSV 重生成
- 不生成 `vision/`，不调用 real worker
- external job 标记与 `exportReady=false`

### Python

```bash
.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t .
```

结果：

```text
Ran 14 tests
OK
```

### 全量

```bash
npm test
```

结果：

```text
tests 362
pass 362
fail 0
```

历史基线 352；Slice 3.2 新增 10 个 Node 测试后为 362。

### /health

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

8080 未重启；新路由通过测试服务器验证，尚未加载到当前常驻进程。

---

## 10. 是否调用 AI / 生成 XLSX

- 真实模型：**未调用**
- 外部图片发送：**未发生**
- 网站内视觉识别：**未发生**
- 第二阶段联合理解：**未开始**
- XLSX：**未生成**
- 数据库迁移：**未执行**
- .NET POC：**未修改**

---

## 11. 未完成 / 风险

- 正式 UI 尚未开发。
- manifest 目前是应用层约定，尚无独立 manifest JSON Schema 文件。
- 外部 CSV 只做 hash 校验与审计，不做逐行业务一致性比较；canonical CSV 已重生成。
- 外部 ZIP 安全限制为固定默认值，尚未配置化。
- 正式人工复核工作台未开发。
- 第二阶段联合理解、数据库任务表迁移、最终 XLSX 未开始。
- `edit_as` 仍 `pending`，`exportReady` 始终 false。
- 目标 Excel 样式仍以 `trade_purchase_cn` profile 为最高优先级。

---

## 12. 下一步

1. 评审外部导入 API 与 ZIP 限制；
2. 定义正式 manifest JSON Schema；
3. 开发“图片 + ZIP”上传 UI（后续）；
4. 进入人工复核工作台；
5. 再进行第二阶段联合理解与最终 Excel 导出。

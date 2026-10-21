# Slice 3 Validation Report — 真实图片识别 Worker 与辅助阅读文件

- 日期：2026-10-20
- 范围：Node real worker、Python 3.12/Pillow 完整解码、OpenAI-compatible 客户端、adapter/validator、helper artifacts、artifact 权限
- 明确未做：正式 UI、第二阶段联合理解、数据库迁移、XLSX、.NET POC 修改
- 真实模型：**未调用**

---

## 1. Git 状态

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
status: dirty
未提交条目：27（含既有修改与 Slice 1–3 新增文件）
```

没有 `git reset`、`git clean`、`stash`、`checkout`、`restore` 或 commit。
既有 dirty 修改全部保留。

---

## 2. 新增/修改文件

### Node

```text
server/flowchart-excel/real-worker.js
server/flowchart-excel/artifacts.js
server/flowchart-excel/model-config.js
server/flowchart-excel/routes.js       # 增加 /meta、real/fake 分流、consent/config gate
server/flowchart-excel/service.js      # real worker 启动、real/fake 元数据、取消
server/flowchart-excel/worker.js       # fake worker 保留，未改成 real
server/flowchart-excel/image.js        # 保持上传阶段结构探测
```

### Python

```text
services/flowchart_excel/image_validation.py
services/flowchart_excel/vision_client.py
services/flowchart_excel/vision_worker.py
services/flowchart_excel/extraction_prompt.txt
services/flowchart_excel/requirements.txt
services/flowchart_excel/tests/__init__.py
services/flowchart_excel/tests/test_image_validation.py
services/flowchart_excel/tests/test_vision_client.py
services/flowchart_excel/tests/test_vision_worker.py
```

### 测试

```text
tests/flowchart-excel/real-worker.test.js
tests/flowchart-excel/routes.test.js   # 增加 real gate/meta 测试
```

### 配置/文档

```text
.gitignore                              # 忽略 .flowchart-venv/
docs/agent/flowchart-excel/slice3-real-image-worker-architecture.md
docs/agent/flowchart-excel/slice3-validation-report.md
```

未修改：

```text
server.js（Slice 2 已 mount）
config/tools.json
private/
数据库 migration
.NET POC
```

---

## 3. Node ↔ Python 调用

Node `startRealWorker` 使用 `spawn`：

```bash
.flowchart-venv/bin/python -m services.flowchart_excel.vision_worker --job-dir <job-dir>
```

- `cwd` 为项目根目录，保证 `services.flowchart_excel` 可导入。
- job dir：`storage/flowchart-excel/<job-id>/`
- stdout/stderr → `worker.log`（0600）
- 默认超时 10 分钟；SIGTERM → 5 秒后 SIGKILL
- 取消：`cancelRealWorker` 尽力终止子进程
- Python 成功后 Node 读取：
  - `vision/raw-extraction.json`
  - `vision/metadata.json`
  - `vision/review_overlay.png`
- Python 失败时 Node 读取 `vision/error.json`，只保留 code/message。

Python 环境：

```text
.flowchart-venv Python 3.12.15
Pillow 13.0.0
```

---

## 4. 图片完整解码

`image_validation.py` 使用 Pillow：

- 完整 `Image.open` + `load()`
- EXIF transpose
- 50,000,000 像素上限
- `DecompressionBombWarning` 提升为错误
- 拒绝损坏/截断/伪造格式
- 最长边 2200px 缩放，输出规范 PNG
- 原图尺寸、准备图尺寸、SHA-256
- 临时 PNG 0600
- 生成 `review_overlay.png` 供人工检查

Node 上传阶段仍有 25 MiB + 结构/尺寸探测；Python 是完整解码和最终安全门。

---

## 5. 模型配置与 consent gate

当前环境检查（不打印值）：

```text
FLOWCHART_BASE_URL: 未配置
FLOWCHART_MODEL: 未配置
FLOWCHART_API_KEY: 未配置
FLOWCHART_PROVIDER: 未配置
FLOWCHART_TIMEOUT_SECONDS: 未配置
FLOWCHART_MAX_OUTPUT_TOKENS: 未配置
```

`GET /api/flowchart-excel/meta` 只返回：

```text
modelConfiguration.configured
modelConfiguration.missingVariables
modelConfiguration.provider
realWorkerAvailable
requiresModelProcessingConsent
templateProfileId
templateProfileVersion
editAs = pending
```

不返回 API Key、model URL 或任何秘密值。

行为：

- 默认 `mode=fake`，保留 Slice 2 fake 行为。
- `mode=real` + 配置缺失 → 503 `CONFIGURATION_REQUIRED`，不创建任务。
- `mode=real` + 无 `modelProcessingConsent=true` → 403 `CONSENT_REQUIRED`，不创建任务。
- fake 任务永不调用模型。
- 只有真实模型成功、输出有效、adapter/validator 通过后，`aiExtractionPerformed=true`。
- `edit_as` 保持 `pending`；`exportReady` 保持 false。

---

## 6. 真实模型客户端

`vision_client.py`：

- OpenAI-compatible `/chat/completions`
- 图片 data URL
- `response_format=json_object`；兼容端点 400/404/422 时单次回退
- 严格 `json.loads`；Markdown 围栏、额外文字、非法 JSON 均拒绝
- 5 MB 响应上限
- HTTP/连接/超时错误映射为稳定 code
- 错误不包含请求头、API Key 或图片内容
- 模型名/provider/prompt version/duration 写入 metadata；不含密钥
- 允许通过 `opener` 注入 mock；测试不访问网络

Prompt version：`1.0.0`
Prompt 枚举来自共享 Schema，不在 Python 中另起一套枚举。

---

## 7. 辅助文件生成

Node `artifacts.js` 在 adapter/validator 通过后生成：

```text
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
review_overlay.png
flowchart-helper-files.zip
```

- `flowchart.json`：统一契约 v1.0.0
- CSV：UTF-8 BOM，保留业务 ID、lane_id、端口、confidence、review_status
- `style.json`：只写 `trade_purchase_cn` profile 引用和强制 export rules，不把模型 theme 当最终视觉
- `conversion_report.md`：模型名/provider/prompt version/输入 SHA/尺寸/计数/warnings/unresolved；不含密钥/原始图片
- ZIP：五份核心文件 + overlay
- 硬错误不生成正式 helper ZIP；写 `validation-errors.json`，状态 failed
- 所有 artifact 走现有 white-list/owner 下载接口

---

## 8. Adapter / Schema / Reference Validator

```text
raw model JSON
  -> legacy_adapter.js
  -> validator.js
  -> reference_validator.js
  -> artifacts.js
```

- adapter 负责 lane_id、归一化 bbox、source/target、ports、controls、provenance
- schema 负责结构与枚举
- reference 负责跨引用、分支、控制编号、export rules
- 硬错误 → failed
- warning/unresolved → 允许 helper，但写入 meta/report
- `review_status` 默认 pending；`confidence` 不自动变 confirmed
- `template_profile_id`/`edit_as=pending` 不被模型覆盖

---

## 9. Fake / Real 隔离

| 项 | fake | real |
|---|---|---|
| worker | `worker.js` | `real-worker.js` |
| 状态终点 | `mock_helpers_ready` | `helpers_ready` |
| `workerMode` | `fake` | `real` |
| `isMock` | true | false |
| `resultKind` | `synthetic_test_result` | `flowchart_helper_files` |
| AI 调用 | 永不 | 仅 config + consent |
| artifacts | mock-* | 正式 helper files |

fake worker 未删除，fake 测试仍通过。

---

## 10. 实际测试

### Node flowchart

```bash
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 67
pass 67
fail 0
```

### Python

```bash
.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t . -v
```

结果：

```text
Ran 14 tests
OK
```

覆盖：完整解码 PNG/JPEG/WebP、损坏/像素超限、配置缺失不联网、Markdown 围栏拒绝、HTTP 错误不泄露 Key、超时、响应过大、空响应、vision worker 无配置、mock 输出生成 raw/overlay。

### 全量

```bash
npm test
```

结果：

```text
tests 352
pass 352
fail 0
```

历史基线 345；新增 7 个 Node 测试后 352。

### /health

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

8080 未重启；新路由通过测试服务器验证，尚未加载到现有常驻进程。

---

## 11. 是否调用真实模型

**未调用。**

原因：

- 没有 `FLOWCHART_BASE_URL` / `FLOWCHART_MODEL` / API Key。
- 没有用户本轮的上传图片和明确 `modelProcessingConsent=true`。
- 没有自动上传任何 Downloads/客户图片。
- 所有模型路径均通过 mock/opener 或缺失配置路径测试。

---

## 12. 缺少的配置变量

```text
FLOWCHART_BASE_URL
FLOWCHART_MODEL
```

若使用 OpenAI 云端，还需要：

```text
FLOWCHART_API_KEY
```

可选：

```text
FLOWCHART_PROVIDER
FLOWCHART_TIMEOUT_SECONDS
FLOWCHART_MAX_OUTPUT_TOKENS
FLOWCHART_PYTHON_BIN
```

安全配置方法：

- 在服务端环境/秘密管理设置，不写入源码、不提交、不回显。
- 使用获准的本地或云端 OpenAI-compatible 多模态端点。
- 用户上传时 UI 必须明确说明图片会发送到该端点；仅在明确同意后发送。

---

## 13. 未验证 / 未完成

- 真实视觉模型端到端识别（缺配置与授权）。
- 真实模型对复杂流程图的识别质量。
- 真实模型响应的成本、速率限制和重试策略。
- 真实 worker 重启恢复（当前 Node runner 仅超时/取消基础处理）。
- 正式 UI / 工具注册。
- 第二阶段图片 + 辅助文件联合理解。
- 数据库任务表迁移。
- 最终 XLSX 与 `edit_as` 决策。
- Windows Excel 详细验收。

---

## 14. 下一阶段

只有在本切片通过评审后，才进入：

1. 配置并授权真实模型端点；
2. 用户明确 consent 后用真实图片验收；
3. 检查真实辅助文件的节点/边/泳道/控制点质量；
4. 进入第二阶段联合理解与差异复核；
5. 之后才进入人工确认和 Excel 原生导出。

当前 Excel 导出 gate 仍关闭，`edit_as` 仍为 `pending`。

# Slice 3 — 真实图片识别 Worker 与辅助阅读文件架构

状态：代码与 mock 测试完成；真实模型未调用
范围：Node real worker、Python Pillow 完整解码、OpenAI-compatible 视觉客户端、adapter/validator、正式辅助文件、artifact 注册
未做：正式 UI、第二阶段联合理解、数据库迁移、XLSX、.NET POC 修改

---

## 1. 现有架构与复用

在 Slice 2 的认证上传、文件型任务存储、owner 权限、artifact 下载和 fake worker 基础上扩展：

```text
server/flowchart-excel/
├── routes.js          # API、上传、meta、real/fake 分流
├── service.js         # 任务/目录/状态/artifact/取消/TTL
├── worker.js          # fake worker（保留）
├── real-worker.js     # Node real worker 编排
├── artifacts.js       # 辅助文件 + ZIP
├── image.js           # 上传阶段结构/尺寸探测
└── model-config.js    # 只返回配置状态，不返回值
```

Python：

```text
services/flowchart_excel/
├── image_validation.py    # Pillow 完整解码/限制/预处理/overlay
├── vision_client.py       # OpenAI-compatible 视觉客户端
├── vision_worker.py       # stage-1 CLI
├── extraction_prompt.txt  # 提取提示词
├── requirements.txt       # Pillow
└── tests/                 # unittest
```

Python 环境：

```text
项目级 .flowchart-venv
Python 3.12.15
Pillow 13.0.0
```

`.flowchart-venv/` 已加入 `.gitignore`。

---

## 2. Node ↔ Python 调用

Node `startRealWorker` 通过 `spawn` 启动：

```bash
.flowchart-venv/bin/python -m services.flowchart_excel.vision_worker --job-dir <job-dir>
```

- `cwd` 是项目根目录，确保可导入 `services.flowchart_excel`。
- job dir 是 `storage/flowchart-excel/<job-id>`。
- stdout/stderr 写入 job 内 `worker.log`（0600）；不包含密钥设计。
- 超时默认 10 分钟；SIGTERM，随后 SIGKILL。
- 取消时 `cancelRealWorker` 尝试 SIGTERM/SIGKILL。
- Python 退出后 Node 读取：
  - `vision/raw-extraction.json`
  - `vision/metadata.json`
  - `vision/review_overlay.png`
- Node 不在 Python 内做 adapter/validator；由 Node 调用共享 JS 模块。

Python 退出码：

```text
0 success
2 model configuration missing
3 image validation/decode failure
4 model request/response failure
```

错误写入 `vision/error.json`，只含 code/message，不含密钥、请求头或图片内容。

---

## 3. 图片完整解码

`services/flowchart_excel/image_validation.py`：

- Pillow `Image.open` + `load()` 完整解码
- EXIF transpose
- 限制 50,000,000 像素
- `DecompressionBombWarning` 提升为错误
- 拒绝损坏、截断、伪造格式
- 超过 2200px 最长边时缩放，输出规范 PNG
- 保存原图尺寸、准备图尺寸、SHA-256
- PNG 临时文件 0600
- 生成 `review_overlay.png`（人工检查，不是最终 Excel 内容）

Node 上传阶段仍做 25 MiB + 结构/尺寸探测；Python 是第二道完整解码和最终安全门。

---

## 4. 模型配置与 consent gate

服务端环境变量：

```text
FLOWCHART_BASE_URL
FLOWCHART_MODEL
FLOWCHART_API_KEY（OpenAI 云端必需；本地端点可不需要）
FLOWCHART_PROVIDER
FLOWCHART_TIMEOUT_SECONDS
FLOWCHART_MAX_OUTPUT_TOKENS
FLOWCHART_PYTHON_BIN（可选，默认 .flowchart-venv/bin/python）
```

当前机器检查结果（不打印值）：

```text
FLOWCHART_BASE_URL: 未配置
FLOWCHART_MODEL: 未配置
FLOWCHART_API_KEY: 未配置
FLOWCHART_PROVIDER: 未配置
FLOWCHART_TIMEOUT_SECONDS: 未配置
FLOWCHART_MAX_OUTPUT_TOKENS: 未配置
```

规则：

- 只有 `mode=real` 且 `modelProcessingConsent=true` 才允许真实模型。
- `POST /jobs` 默认 `mode=fake`，保留 Slice 2 行为。
- `mode=real` 且配置缺失 → 503 `CONFIGURATION_REQUIRED`，返回缺失变量名，不创建任务。
- `mode=real` 且无 consent → 403 `CONSENT_REQUIRED`，不创建任务、不调用模型。
- fake 任务永不调用模型。
- `GET /meta` 返回配置布尔状态和缺失变量名，不返回变量值。
- API Key 只在服务端环境/秘密管理；不进入响应、日志、artifact。

---

## 5. 真实 worker 状态与语义

```text
uploaded
-> queued
-> validating_image
-> extracting
-> normalizing
-> validating_graph
-> building_helpers
-> helpers_ready
```

失败/取消：

```text
-> failed
-> cancelled
```

- `workerMode: "real"` / `"fake"` 明确区分。
- `aiExtractionPerformed: true` 只在真实模型返回有效 JSON、adapter/validator 成功且辅助文件生成后设置。
- `resultKind: "flowchart_helper_files"` 只用于真实辅助文件成功。
- fake 仍是 `synthetic_test_result` / `mock_helpers_ready`。
- `exportReady` 仍为 false；`edit_as` 仍为 `pending`。
- `template_profile_id=trade_purchase_cn` 写入任务和辅助文件。

---

## 6. 辅助文件生成

`artifacts.js` 从通过 schema + reference validation 的统一数据生成：

```text
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
review_overlay.png
flowchart-helper-files.zip
```

规则：

- `flowchart.json` 是统一契约 v1.0.0。
- CSV UTF-8 BOM，保留业务 ID/端口/confidence/review_status。
- `style.json` 只写 `trade_purchase_cn` profile 引用和强制 export rules；不把模型 theme 当最终样式。
- `conversion_report.md` 包含模型名/provider/prompt version/输入 SHA/尺寸/计数/warnings/unresolved；不含密钥或原始图片内容。
- `review_overlay.png` 供人工检查，不是最终 Excel。
- ZIP 包含五个核心文件和 overlay。
- 所有 artifact 通过 Slice 2 的白名单下载接口，owner 隔离不变。
- 硬错误不生成正式 helper ZIP；写 `validation-errors.json` 并标记 failed。

---

## 7. Adapter / Schema / Reference Validator

调用顺序：

```text
Python raw-extraction.json
  -> legacy_adapter.js (adapter: lane_id, normalized bbox, source/target, ports, controls, provenance)
  -> validator.js (Draft 2020-12)
  -> reference_validator.js (cross references, controls, branches, export rules)
  -> artifacts.js
```

- 任何硬错误：status failed，errorCode `INVALID_MODEL_OUTPUT` / `SCHEMA_VALIDATION_FAILED` / `REFERENCE_VALIDATION_FAILED`。
- warnings/unresolved 允许生成 helper，但写入任务元数据和 conversion report。
- `review_status` 默认 pending；`confidence` 不自动变 confirmed。
- 端口推断/缺失规则沿用 Slice 1 adapter。
- `template_profile_id` 和 `edit_as=pending` 由 adapter/contract 强制。

---

## 8. Failure / timeout / cancel

- Python Worker 超时：Node SIGTERM → SIGKILL，状态 failed / `WORKER_TIMEOUT`。
- 模型 4xx/5xx/空响应/超大响应：Python `vision/error.json`，Node `failed`，错误不含请求头/密钥/图片内容。
- 取消：Node 更新 cancelled 并调用 `cancelRealWorker` 终止子进程（尽力），不生成成功 artifact。
- 重启恢复：本切片仍使用现有文件型任务；未实现真实 worker 的中断恢复，和 Slice 2 的 fake 模式一样需要后续 runner 设计。

---

## 9. 测试策略

Node：

- real route gating: config missing / consent missing / meta 状态
- Node real pipeline: adapter/validator/artifacts/zip owner
- real worker spawns Python and stops at missing config, no network
- Slice 2 fake worker/权限/artifact/cancel 测试继续通过

Python：

- Pillow 完整解码 PNG/JPEG/WebP
- 损坏/截断/像素超限
- 缺失配置不调用网络
- 严格 JSON、Markdown 围栏拒绝
- HTTP 错误不含 API Key
- 空响应
- vision worker 无配置不调用模型
- mock 模型输出生成 raw + overlay

---

## 10. 数据库与后续

本切片仍不执行数据库迁移。真实 worker 接入生产前建议：

- 将文件型任务迁到 `flowchart_jobs`（schema 见 Slice 2 文档）；
- 增加真实 worker 重启恢复/队列；
- 增加模型调用成本记录和限流；
- 增加 phase-2 reconciliation 接口；
- 人工复核后才允许 export gate；
- 最终 XLSX 样式仍以 `trade_purchase_cn` profile 为准。

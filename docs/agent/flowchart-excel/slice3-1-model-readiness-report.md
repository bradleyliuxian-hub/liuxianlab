# Slice 3.1 — 真实模型配置就绪检查报告

- 日期：2026-10-20
- 目标：检查真实视觉模型配置与图片授权，准备一次单张图片端到端验收
- 结论：**未调用真实模型，未上传图片，未生成真实辅助文件**

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

## 2. 模型配置检查

只检查变量是否存在，不读取或打印值：

```text
FLOWCHART_BASE_URL: 未配置
FLOWCHART_MODEL: 未配置
FLOWCHART_API_KEY: 未配置
FLOWCHART_PROVIDER: 未配置
FLOWCHART_TIMEOUT_SECONDS: 未配置
FLOWCHART_MAX_OUTPUT_TOKENS: 未配置
FLOWCHART_PYTHON_BIN: 未配置
```

说明：

- `FLOWCHART_PYTHON_BIN` 未配置不是阻塞项；代码会默认使用 `.flowchart-venv/bin/python`。
- `FLOWCHART_BASE_URL` 和 `FLOWCHART_MODEL` 缺失是硬阻塞。
- 如果使用 OpenAI 云端端点，还需要 `FLOWCHART_API_KEY`。
- 当前没有猜测端点、模型名或供应商。
- ChatGPT 网页订阅没有作为 API Key。

---

## 3. 图片选择与本地检查

用户已明确指定图片：

```text
/Users/a123/Downloads/PixPin_2026-10-20_17-52-15.png
```

只读本地检查结果：

```text
文件大小：433 KB
格式：PNG
尺寸：1402 x 1133
像素数：1,588,466
颜色模式：RGB
SHA-256：a53ce3bc4c544aabdb97b68517d6e06571edb1876336a7210b911ca680a8d71e
完整解码：PASS（Pillow 13.0.0）
```

该图片在 25 MiB / 50,000,000 像素限制内，且可被完整解码。

但仍未执行：

- 图片上传到本机任务目录；
- 图片发送到模型端点；
- 任何模型识别；
- 任何真实辅助文件生成。

当前仍缺少：

1. 获准使用的模型端点、模型名和所需凭证；
2. 针对该具体模型端点的外发授权。

**图片选择已满足；不能把“用这个图片”自动解释为对任何未指定模型端点的外发同意。**

---

## 4. 是否调用真实模型

**未调用。**

原因：

- `FLOWCHART_BASE_URL` 未配置；
- `FLOWCHART_MODEL` 未配置；
- 没有获准的模型端点/模型名；
- 没有本轮针对具体模型端点的外发授权；
- 无 API Key 配置。

没有产生任何真实任务、辅助文件、overlay 或 ZIP。
现有 mock/单元测试状态未受影响。

---

## 5. 安全配置方法

### 5.1 选择并配置端点

使用经批准的 OpenAI-compatible 多模态端点。至少设置：

```text
FLOWCHART_BASE_URL=https://<approved-endpoint>/v1
FLOWCHART_MODEL=<approved-vision-model>
```

云端 OpenAI 还需要在服务端秘密管理中设置：

```text
FLOWCHART_API_KEY=<secret>
```

可选：

```text
FLOWCHART_PROVIDER=<provider-label>
FLOWCHART_TIMEOUT_SECONDS=240
FLOWCHART_MAX_OUTPUT_TOKENS=<optional>
FLOWCHART_PYTHON_BIN=/absolute/path/to/.flowchart-venv/bin/python
```

配置要求：

- 只放在服务端环境变量或秘密管理；
- 不写入源码、`.env.example` 实际值、日志、报告、命令行参数或浏览器；
- 不把 ChatGPT 网页订阅当作 API Key；
- 配置后只输出“已配置/未配置”，不输出值。

### 5.2 准备授权图片

请提供：

```text
图片绝对路径（已提供）：
/Users/a123/Downloads/PixPin_2026-10-20_17-52-15.png
```

并明确说明：

```text
我授权将这张图片发送到上述已配置的模型端点，用于本次流程图结构识别测试。
```

图片应满足：

- PNG / JPEG / WebP；
- ≤ 25 MiB；
- ≤ 50,000,000 像素；
- 可被 Pillow 完整解码；
- 不含未获准外发的客户敏感内容。

### 5.3 创建任务时

请求必须显式携带：

```text
mode=real
modelProcessingConsent=true
```

不得由服务器默认补 `true`。

---

## 6. 配置完成后的验收方式

配置和图片授权完成后，只运行一次：

1. 通过受认证的网站 API 上传该图片；
2. 设置 `mode=real`、`modelProcessingConsent=true`；
3. 检查任务状态：
   `uploaded → queued → validating_image → extracting → normalizing → validating_graph → building_helpers → helpers_ready`；
4. 下载并检查：
   - `flowchart.json`
   - `nodes.csv`
   - `edges.csv`
   - `style.json`
   - `conversion_report.md`
   - `review_overlay.png`
   - `flowchart-helper-files.zip`
5. 运行 Schema/reference validator，检查 ID、引用、bbox、枚举、分支标签、控制标记；
6. 人工核对节点文字、类型、泳道、端口、分支、控制点归属；
7. 检查 `template_profile_id=trade_purchase_cn`、`edit_as=pending`、`exportReady=false`；
8. 检查 CSV 中文和 overlay 位置；
9. 记录模型/provider/prompt version/耗时，不记录密钥、请求头或图片内容。

---

## 7. 当前状态

```text
真实模型调用：未执行
图片上传：未执行
图片外发：未执行
真实辅助文件：未生成
XLSX：未生成
数据库迁移：未执行
第二阶段联合理解：未开始
```

现有 Slice 3 能力保持：

- Node real/fake worker 代码；
- Python Pillow 完整解码；
- 模型客户端与 consent gate；
- adapter/schema/reference validator；
- 正式辅助文件生成管线；
- mock/单元测试。

---

## 8. 需要用户提供的最小信息

1. 获准的 `FLOWCHART_BASE_URL`；
2. 获准的 `FLOWCHART_MODEL`；
3. 云端端点所需的 `FLOWCHART_API_KEY`（只放在服务端秘密环境，不在聊天中发送值）；
4. 对该图片发送到上述具体端点的明确外发授权。

在这些信息齐备前，真实模型验收保持阻塞。

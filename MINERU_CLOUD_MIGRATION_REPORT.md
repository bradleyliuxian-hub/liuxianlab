# 合同审阅：MinerU 云端 API 迁移报告

日期：2026-10-19

> 后续更新（同日）：已加入每份合同独立的 Local/Cloud UI 选择、数据库
> `parse_backend_requested`、加密的每任务 Token 与 `contract_credentials`。
> 最新实现与验收以 `~/Downloads/MINERU_BACKEND_UI_REPORT.md` 和当前代码为准；
> 本文件保留为第一轮云端后端的实现记录。
范围：仅替换合同审阅的 MinerU 解析执行后端；未改动合同审阅业务语义、人工复核、质量门控或生产环境。

> 说明：任务描述在“7.4 Structured JSON 适配”处截断。本报告与实现严格按前文已明确的目标、安全和接口要求完成，未擅自扩展范围。

## 1. Git baseline（开发前）

- 仓库：`~/AI-Workspace/projects/liuxianlab-online`
- 分支：`main`
- HEAD：`4c1f2ee`（与 `origin/main` 一致）
- 开发前工作区：仅 `PROJECT_STATUS.md` 有本地修改（上班恢复时修正的状态快照）；无未跟踪文件。
- 当前源码路径与任务提示词列出的路径一致，未发现需要以“真实源码为准”修正的路径差异。
- 未执行：`git add/commit/push/merge/rebase/reset/clean`；未连接生产服务器；未读取 `.env` / Token。

## 2. 结论

已完成可配置的双后端：

- `CONTRACT_MINERU_BACKEND=local`（默认）：保留现有本地 MinerU CLI，含
  `LIUXIANLAB_MINERU_PRODUCTION_ENV_V1` 与 `LIUXIANLAB_SAFE_SEAL_CROP_V3`，作为回滚路径。
- `CONTRACT_MINERU_BACKEND=cloud`：走 MinerU 精准解析 API v4。

合同审阅的 FAST / ACCURATE / AUTO、Quality Gate、Critical Integrity、人工复核、
Finalize 均未改变。AUTO 仍只在“质量门控失败”或“关键字段完整性要求 Standard”时升级；
云端 API/网络错误直接使任务失败，不会被伪装成质量失败，也不会自动重复提交。

## 3. 变更文件

新增：

- `services/contract_review/mineru_api_client.py`
  - 仅用 Python 标准库的云端客户端 + 解析产物适配层。
- `services/contract_review/tests/test_mineru_api_client.py`
  - 云端流程、结果匹配、适配器、ZIP 安全、错误脱敏、HTTP 传输、后端分发测试。
- `docs/agent/contract-review/mineru-cloud.md`
  - 云端后端事实文档（配置、流程、输出映射、错误语义、回滚、安全）。
- `MINERU_CLOUD_MIGRATION_REPORT.md`（本文件）。

修改：

- `services/contract_review/parse_profile.py`
  - 后端选择、云端模型映射、云端配置读取、缓存签名隔离、profile `v1.2.0`。
- `services/contract_review/mineru_service.py`
  - `parse_contract()` 变为后端分发器；本地实现原样保留为 `_parse_contract_local()`。
- `services/contract_review/worker.py`
  - 云端阶段进度/文案、`parseBackend` / `parseModelVersion` 指标；状态机未改。
- `services/contract_review/parse_cache.py`
  - manifest 记录 `backend` / `modelVersion`；签名仍为权威隔离。
- `services/contract_review/tests/test_parse_profile.py`
  - 后端/云端映射/签名隔离测试。
- `services/contract_review/tests/test_worker_orchestration.py`
  - 云端 API 错误不触发 Standard fallback 的回归测试。
- `.env.example`、`PROJECT_INDEX.md`、`docs/agent/contract-review*.md`
  - 配置占位与文档。

未修改：`server/contracts/*`、数据库 schema、migrations、前端上传/复核页面、
`scripts/patch_mineru_seal.py`、本地 MinerU 安全标记。

## 4. 模式与模型映射

| 产品模式 | 本地 tier | 云端模型（默认） | AUTO 行为 |
|---|---|---|---|
| FAST | basic | pipeline | 只跑 basic，不升级 |
| ACCURATE | standard | vlm | 只跑 standard |
| AUTO | basic → standard | pipeline → vlm | basic 质量/关键字段失败才升级 |

这是产品策略，不声称 `pipeline`/`vlm` 与本地 `basic`/`standard` 完全等价。
可用 `MINERU_API_MODEL_BASIC` / `MINERU_API_MODEL_STANDARD` 覆盖。

## 5. 云端调用流程

1. `POST {MINERU_API_BASE_URL}/file-urls/batch`
   - 单文件，`name` 使用 ASCII 的 `contract-<contract_id>.pdf`；
   - `data_id` = 合同 UUID，用于在批量结果中精确匹配；
   - `model_version`、`language`、`enable_table`、`enable_formula`、`file.is_ocr` 可配置。
2. 从响应取 `batch_id`、`file_urls[0]`；要求恰好 1 个上传链接。
3. `PUT` 私有 PDF 到签名 URL：
   - 不附加 Authorization；
   - 不附加 Content-Type；
   - 只发送 Content-Length / User-Agent；
   - 流式发送，不拼接签名 URL。
4. 轮询 `GET /extract-results/batch/{batch_id}`：
   - 先按 `data_id` 匹配；仅当结果项没有 `data_id` 时才按文件名匹配；
   - 多个结果且无法匹配时拒绝随机选择，直接报可诊断错误；
   - 处理 `waiting-file/pending/uploading/running/converting/done/failed`；
   - 超时失败，明确提示“任务可能仍在云端处理，不会自动重复提交”。
5. `done` 后下载 `full_zip_url`：仅 HTTPS、超时、声明/实际大小双重限制。
6. 安全解压：拒绝绝对路径、`..`、符号链接、超量文件、超量解压字节。
7. 适配并写入现有稳定产物路径。

## 6. 解析产物适配

| 云端 ZIP | 稳定文件 | 处理 |
|---|---|---|
| `full.md` | `document.raw.md` | UTF-8（含 BOM）严格解码；空文件报错；不自动纠正 OCR 文本 |
| `layout.json`（middle.json） | `document.middle.json` | 结构校验/转换后写入，不是简单改名 |
| `*_content_list.json` | `document.structured.json` | 优先作为云端结构化产物 |
| `*_model.json` | `document.structured.json` | 仅当 content list 缺失时回退 |
| 整个 ZIP | `mineru-cloud-output.zip` | 保留诊断 |
| 解压目录 | `mineru-cloud-export/` | 保留图片等资源 |
| 事件日志 | `mineru.log` | 仅状态/页数/耗时；无 Token、无签名 URL、无合同文本 |

### 6.1 Middle JSON 适配（重点）

`layout.json` 可能存在多种形态，适配层接受并验证：

- MinerU 4 的 `{"pages": [{"page_idx", "blocks", ...}]}`；
- 页面列表；
- `{"pages": {index: page}}` 映射；
- 旧版 `{"pdf_info": [...]}`（`preproc_blocks` / `para_blocks` / `lines`）。

对每个页面/块：

- 保留 `page_idx`（0 基；缺失时用位置索引）；
- `blocks` 兼容 `preproc_blocks` / `para_blocks` / `layout_blocks` / `lines`；
- `bbox` 统一为 4 个数字；
- `content` 优先取 `content` / `text` / `value`；没有直接字符串时，从 `lines` /
  `spans` 提取文本并写入 `content`；
- `type` 兼容 `type` / `block_type` / `category` / `label`。

如果 `layout.json` 缺失或无效，且存在 `*_content_list.json`，则按
`page_idx + bbox + text` 生成保守的 middle JSON。该回退会写入 `mineru.log`，
并在结果中标记 `middle_json_source=content_list_fallback`。
不会用空 JSON 或伪造字段让 Quality Gate 假通过。

`bbox` 语义：MinerU 4 的 middle JSON 契约（docvortex schema）使用归一化坐标；
适配层保留该坐标，前端现有实现也按归一化 [0,1] 映射。**未用真实云端响应复核**
该字段；上线前应使用一份非生产样例确认。若云端返回绝对坐标，需要基于真实
fixture 扩展适配层，而不是猜测。

## 7. 错误分类与 AUTO fallback 边界

会触发 AUTO Standard fallback 的只有：

- 结构 Quality Gate 失败；
- Critical Integrity `requiresStandard`。

以下错误直接失败（不会触发 fallback）：

- Token 缺失/无效/过期；
- 网络超时、连接失败；
- 上传链接申请失败；
- 签名上传失败；
- 云端 `failed`；
- ZIP 下载/解压失败；
- 缺少 `full.md`、`layout.json` 且无可用 content list；
- 云端返回多结果且无法按 `data_id` 匹配。

重试策略：

- 轮询 GET、签名 PUT、ZIP 下载：对网络错误 / 429 / 5xx 做有限重试
  （`MINERU_API_MAX_RETRIES`，默认 2），指数退避，尊重 `Retry-After`（上限 30 秒）。
- 上传链接 POST：不自动重试，避免网络歧义导致重复云端任务。
- 轮询超时不重提；任务失败并提示用户稍后重试/重新处理。

## 8. 缓存与元数据

- 缓存签名加入后端与云端配置：
  - local：`mineru=<ver>;tier;backend=local;source;small_backend;vlm;profile;seal`
  - cloud：`mineru=cloud;tier;backend=cloud;api_base;api_model;api_lang;api_ocr;api_table;api_formula;profile`
- 因此本地缓存与云端缓存、不同模型/OCR 配置的缓存互不复用。
- `CONTRACT_PARSE_PROFILE_VERSION` 从 `v1.1.0` 升到 `v1.2.0`（有意使旧缓存失效）。
- manifest 新增 `backend` / `modelVersion`（诊断用；签名仍是权威）。
- `parse_metrics` 新增 `parseBackend` / `parseModelVersion`，无数据库 migration。

## 9. 安全

- Token 只从环境变量读取；未写入仓库、日志、错误、URL、前端。
- 错误信息对 URL、`Bearer ...`、精确 Token 值做脱敏；测试覆盖。
- JSON API 禁止跟随重定向，避免 Authorization 被转发到其它主机。
- 签名上传不发送 Authorization / Content-Type。
- 结果下载仅 HTTPS，并有超时/大小限制。
- ZIP 解压有路径穿越、符号链接、文件数、解压体积防护。
- 合同源文件仍必须位于 `storage/contracts/`。
- 启用 cloud 会将合同 PDF 发送到 MinerU；生产启用前需确认数据合规/保密要求。
- 本地 MinerU 安全代码、生产环境固定项与回滚能力未删除。

## 10. 配置

```dotenv
CONTRACT_MINERU_BACKEND=cloud
MINERU_API_TOKEN=            # 只在服务器 .env，不回传、不提交
MINERU_API_BASE_URL=https://mineru.net/api/v4
MINERU_API_MODEL_BASIC=pipeline
MINERU_API_MODEL_STANDARD=vlm
MINERU_API_LANGUAGE=ch
MINERU_API_ENABLE_TABLE=true
MINERU_API_ENABLE_FORMULA=true
MINERU_API_IS_OCR=true       # 扫描件合同建议保持 true
MINERU_API_TIMEOUT_SECONDS=60
MINERU_API_POLL_INTERVAL_SECONDS=3
MINERU_API_POLL_TIMEOUT_SECONDS=900
MINERU_API_MAX_RETRIES=2
```

`.env.example` 只含空值/占位，无真实 Token。正常链路由 Node
`parse-runner.js` 继承 dotenv 环境；若手工运行 `scripts/run_contract_worker.sh`，
需先自行 export 这些变量（该脚本不 source `.env`）。

## 11. 验证

执行环境：`.mineru/bin/python`（3.12.15，项目用于 contract_review 测试）。

- `python -m unittest discover -s services/contract_review/tests -t .`
  - **PASS**：177 tests / 0 failures。
- `python -m py_compile` 所有改动 Python 文件：**PASS**。
- `git diff --check`：**PASS**（无 trailing whitespace / EOF 空行问题）。
- `.venv/bin/python` 同一测试：**BLOCKED BY ENVIRONMENT**（`.venv` 未安装
  `psycopg`，3 个 import errors；与本次改动无关；项目 contract 测试实际使用
  `.mineru` 环境）。
- 真实 MinerU 云端 API：**NOT RUN**（未索取 Token、未上传任何真实合同、未产生云端费用）。
- 生产部署：**NOT RUN**（未连接服务器）。

新增测试覆盖：

- 云端成功产物映射、tier→model 映射；
- 多结果按 `data_id` 匹配，歧义拒绝；
- `failed` 状态、缺少 Token、页数/大小限制、上传链接数量异常；
- `layout.json` 缺失时 content list 回退；
- 旧版 `pdf_info` / `lines` 适配；
- ZIP 路径穿越、绝对路径、符号链接、解压体积限制；
- Token/签名 URL 错误脱敏；API 重定向不跟随；可重试 API code 有限重试；
- AUTO 下云端 API 错误不触发 Standard fallback；
- local/cloud 分发；
- 缓存签名按后端/模型隔离。

## 12. 未验证 / 风险

1. **真实云端响应结构未验证**：本机未调用 MinerU API。`layout.json` 的
   `pages/blocks/content/bbox` 结构、`*_content_list.json` 命名、ZIP 目录层级
   均基于官方文档与 MinerU 4 输出契约实现；上线前必须用一份非生产合同做
   一次性冒烟测试。
2. **bbox 坐标语义**：按 MinerU 4 归一化坐标处理；未用真实云端响应复核。
3. **生产 `.venv` / 环境变量**：未读取生产 `.env`；生产是否已配置
   `MINERU_API_TOKEN` 未知。
4. **生产性能/额度**：云端耗时、每日页数额度、失败率未验证。
5. **迁移回滚**：只需 `CONTRACT_MINERU_BACKEND=local` 并重启 worker；
   不需要回滚数据库或前端。

## 13. 上线前建议（需用户执行）

1. 在服务器 `.env` 增加 `CONTRACT_MINERU_BACKEND=cloud` 与 `MINERU_API_TOKEN`。
2. 先用一份**非生产/脱敏合同**在测试环境跑一次 cloud 解析，确认：
   - 任务到达 `reviewing`；
   - `document.raw.md`、`document.middle.json` 非空；
   - issue 的 page/bbox 在 PDF 上位置正确；
   - `mineru.log` 无 Token/签名 URL。
3. 观察一次 AUTO 的 basic 通过路径，以及一次人为低质量/关键字段失败的
   Standard fallback 路径。
4. 确认后再对生产合同启用；保留 `local` 作为一键回滚。

## 14. Git 状态

本报告生成时未执行 commit / push / merge / rebase / reset / clean。
所有改动仍在工作区，等待用户审查。

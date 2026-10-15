# Contract Digitization v1.1 — 实施汇报（供交叉审查）

> 用途：交给另一个 AI 做代码审查 / 正确性核对。
> 分支：`feature/contract-speed-v1.1`（基于 `main` @ `93aff52`）
> 状态：**已实现，未提交、未 push、未部署**
> 生成时间：2026-10-12

---

## 0. 审查须知（给审查 AI）

- 本报告描述的是对现有生产基线 `contract-review-v1.0.2` 的**增量**改动，不是重写。
- 请重点核对：AUTO fallback 逻辑、Quality Gate 阈值与 reasons、cache 的 owner 隔离与"只缓存 MinerU artifacts"、cache-hit 后 review 状态独立性、progress 单调性、migration 的 additive/backward-compatible 性、旧字段/API 兼容。
- 所有新增/修改文件的绝对路径都列在 §3/§4；可直接打开源码核对。
- 本地未能运行真实 MinerU（原因见 §10），真实 benchmark 与 migration 尚未在真机验证——这点已在报告中如实标注，请勿视为已通过。

---

## 1. 任务约束（本次唯一主题：提速）

在不升级硬件、不引入 GPU、不降低现有生产稳定性的前提下提高合同 PDF 解析速度。

硬性约束（必须保持）：
- 保留生产 MinerU 环境：`MINERU_MODEL_SOURCE=local`、`MINERU_MODEL_SMALL_BACKEND=onnx`、`MINERU_MODEL_VLM_ENGINE=llama-cpp`
- 保留 `scripts/patch_mineru_seal.py` 的 `LIUXIANLAB_SAFE_SEAL_CROP_V3`
- 保留 `mineru_service.py` 的 `LIUXIANLAB_MINERU_PRODUCTION_ENV_V1`
- worker 并发保持 1（不增加并发）
- 不删除现有字段/API；migration 必须 additive/backward-compatible
- 不改 review/finalize/删除/bbox/history 业务逻辑
- 不做 AI 质量判断、不接 OpenAI、不换库、不换 MinerU、不做 Docker/GPU/Redis/Celery/Kafka
- 不自动部署；不执行 `git reset --hard` / `git clean -fd`

本次范围仅 4 件事：
1. AUTO / FAST / ACCURATE 三种模式
2. AUTO = Basic First + 确定性 Quality Gate + Standard Fallback
3. SHA256 MinerU artifact cache（owner 隔离）
4. 更真实、更细粒度的解析进度

---

## 2. 现状架构（改动前，PHASE 0 结论）

解析链路：
1. `POST /api/contracts`（`server/contracts/routes.js`）：multer diskStorage 写入 `storage/contracts/<uuid>/source.pdf` → `repository.createContract`（`status=queued/stage=queued/progress=0`）→ 写兼容 `job.json` → `parse-runner.startContractWorker` detached 启动 `python -m services.contract_review.worker --contract-id <id>`。
2. `worker.py`：`contract_worker_lock`（PG advisory lock，并发=1）→ `claim_next_contract`（置 processing/parsing/10）→ `mineru_service.parse_contract`（原先硬编码 `--tier standard`）→ 写 `parsed/document.raw.md|middle.json|structured.json` → 删除检查 → `prepare_review_artifacts`（draft.md + issues.json）→ `build_consistency_artifacts`(document.fields.json) → 置 processing/reviewing/90。
3. 人工审阅：`review.html` + `review.js/review-*.js`；草稿 PUT（5MB parser）；`POST /:id/issues/:issueId/resolve`（仅 reviewing）；`POST /:id/finalize` → `final/document.md` → completed/100；`GET /:id/result.md` 下载。
4. Node DB：`db.js`（pg Pool，`DATABASE_URL`）+ `repository.js`。

关键点：
- `mineru_service.py` 原来硬编码 `--tier standard`。
- `os.environ` 在 `mineru_service` 导入时固定 `local/onnx/llama-cpp`。
- **仓库没有自动 migration runner**；migration 是幂等 SQL 手动执行（`001` 用 `CREATE TABLE IF NOT EXISTS`+BEGIN/COMMIT，`002` 用 `ADD COLUMN IF NOT EXISTS`）。
- 前端：`script.js` 上传（FormData 仅 file）+ 每 3s 轮询 `/status`；`workflow.js` 劫持 `window.fetch` 捕获新 id + 每 2s 轮询；`contract-history.js` 列表；`index.html` 状态卡含 `#stageText`。

---

## 3. 修改文件清单（8）

| 文件 | 改动要点 |
|---|---|
| `server/contracts/routes.js` | 新增 `normalizeParseMode()`；上传时校验 `parseMode`（缺失→auto，非法→400 并清理已落盘 PDF）；用 `readPdfPageCount` 取页数；`createContract` 传 `parseModeRequested/sourceSha256(空)/pageCount`；upload 响应加 `requestedMode`；`/:id/status`、`/latest`、`/history` 返回新字段 |
| `server/contracts/repository.js` | `mapContract` 新增 `sourceSha256/parseModeRequested/parseTierActual/parseCacheHit/parseFallbackUsed/parseFallbackReason/progressMessage/parseMetrics`；`createContract` INSERT 增列 `parse_mode_requested/source_sha256/page_count` |
| `services/contract_review/worker.py` | 新增 `ProgressReporter`；编排 hash→cache→tier→gate→fallback→artifacts；保留 claim/lock/delete/cleanup/error 语义 |
| `services/contract_review/mineru_service.py` | `parse_contract(contract, *, tier=standard, on_stage=None)`；命令用 `--tier {tier}`；`subprocess.run` 改 `Popen` 逐行写 `mineru.log` 并解析稳定关键词→`on_stage`；返回值加 `tier` |
| `services/contract_review/database.py` | claim/get 的 RETURNING/SELECT 增列；新增 `update_contract_progress()`、`update_parse_metadata()`；引入 `psycopg.types.json.Jsonb` |
| `private/tools/contract-review/index.html` | 新增解析模式 radio group（自动/快速/高精度，默认自动）；新增 `#progressMessage`、`#parseModeBadge`；资源版本号 bump（styles v4.2.0、script v1.2.0） |
| `private/tools/contract-review/script.js` | 上传 FormData 追加 `parseMode`；轮询渲染 `progressMessage`；`parseBadgeText/updateParseBadge` 显示模式/fallback/缓存 badge；`resetStatus` 清理 |
| `private/tools/contract-review/styles.css` | 追加 `.parse-mode*`、`.progress-message`、`.parse-badge` 样式 |

## 4. 新增文件清单（10）

| 文件 | 说明 |
|---|---|
| `server/contracts/migrations/003_contract_speed_v11.sql` | 见 §5 |
| `server/contracts/pdf-meta.js` | Node 端 best-effort 读取 PDF 页数（动态 import `pdfjs-dist/legacy/build/pdf.mjs`），失败返回 null |
| `services/contract_review/parse_profile.py` | 模式/tier 映射、集中 profile 版本、parser signature |
| `services/contract_review/quality_gate.py` | 确定性质量门 + 集中阈值 |
| `services/contract_review/parse_cache.py` | owner 隔离 artifact cache |
| `services/contract_review/tests/__init__.py` | 测试包 |
| `services/contract_review/tests/test_parse_profile.py` | 模式/tier/signature 测试 |
| `services/contract_review/tests/test_quality_gate.py` | 质量门测试 |
| `services/contract_review/tests/test_parse_cache.py` | 缓存测试 |
| `services/contract_review/tests/test_worker_orchestration.py` | 编排测试（mock DB + mock parse） |
| `scripts/local/benchmark-contract-speed.py` | benchmark（--mock / --real） |

（注：§4 实际为 11 个条目，因 tests 目录含 4 个测试文件。）

---

## 5. 数据库 migration `003_contract_speed_v11.sql`

新增列（全部 `ADD COLUMN IF NOT EXISTS`）：
- `source_sha256 TEXT`
- `parse_mode_requested TEXT`（auto/fast/accurate）
- `parse_tier_actual TEXT`（basic/standard）
- `parse_cache_hit BOOLEAN NOT NULL DEFAULT FALSE`
- `parse_fallback_used BOOLEAN NOT NULL DEFAULT FALSE`
- `parse_fallback_reason TEXT`
- `progress_message TEXT`
- `parse_metrics JSONB`

Backfill（仅历史行）：
```sql
UPDATE contracts SET parse_mode_requested='accurate', parse_tier_actual='standard'
WHERE parse_mode_requested IS NULL;
```
之后 `ALTER COLUMN parse_mode_requested SET DEFAULT 'auto'`。索引：`idx_contracts_owner_source_sha256 (owner_username, source_sha256)`。

幂等性：`ADD COLUMN IF NOT EXISTS` + `WHERE ... IS NULL` backfill → 重复执行 no-op。无删除/重命名 → backward compatible。
**未在真实 PostgreSQL 执行验证。**

---

## 6. 模式决策逻辑

`parse_profile.normalize_mode`：缺失/空/未知 → `auto`（向后兼容旧客户端）；`is_valid_mode` 用于 API 严格校验。
`tier_for_mode`：fast→basic，accurate→standard，auto→None（basic-first）。

`worker.process_contract` 决策（伪代码）：
```
mode = normalize_mode(parse_mode_requested)
sha  = sha256(pdf 流式)                     # progress 3
sel  = select_cached_parse(owner, sha, mode) # progress 5

if sel == use(standard):  restore standard; actual=standard; cacheHit=true
elif sel == use(basic):   restore basic;    actual=basic;    cacheHit=true
elif sel == standard_fallback:              # AUTO 命中质量不合格的 basic 缓存
     run standard; actual=standard; fallback=true; reason=cached_basic_quality_gate_failed
else:
     if mode==accurate: run standard; actual=standard
     else:  # fast 或 auto
        run basic; actual=basic
        if fast: (gate 结果仅记录, 绝不 fallback)
        if auto:
           gate = evaluate(...)
           store basic cache(qualityPass=gate.passed)
           if not gate.passed: run standard; fallback=true; reason=basic_quality_gate_failed:<reasons>
if not cacheHit and actual==standard: store standard cache
-> prepare_review_artifacts + build_consistency_artifacts（始终重新生成）
-> update_parse_metadata(...); reviewing/90
```

`select_cached_parse`（AUTO）：优先 standard cache → 其次 basic cache（`qualityPass==true` 则用，否则 standard_fallback）。FAST 只查 basic；ACCURATE 只查 standard。

---

## 7. Quality Gate（`quality_gate.py`）

确定性，不调用 AI，不伪造 OCR confidence。`evaluate_parse_quality(markdown_path, *, middle_json_path=None, page_count=None)` → `{passed, reasons, metrics}`。

检查项（machine-readable reasons）：
- `missing_markdown` / `empty_markdown`
- `missing_middle_json` / `invalid_middle_json`
- `page_count_mismatch`（仅当 `page_count` 可靠提供，`parsed < input*0.8`）
- `extremely_low_text_volume`（`min_total_chars = max(300, pages*chars_per_page)`）
- `excessive_illegible_markers`（**绝对值 ≥20 且 比例 ≥2%** 双判；复用 `issue_detector.ILLEGIBLE_MARKERS`）
- `encoding_noise`（U+FFFD 绝对值 ≥20 且比例 ≥1%）
- `insufficient_page_coverage`（有效页占比 <50%）

阈值集中在 `thresholds()`，可 env 覆盖（`CONTRACT_QG_*`）。少量 `[Illegible]`/单字符差异不触发（避免把普通 OCR 问题当成 fallback 理由）。
`fallback_reason(reasons)` → `basic_quality_gate_failed:<reason1>,<reason2>`。

---

## 8. Cache（`parse_cache.py`）

- Cache root：`storage/contracts-cache/`（gitignored，不通过 HTTP 暴露）。
- 目录：`<sha256(owner_username)>/<source_sha256>/<parser_signature>/<tier>/`。
- Parser signature = `sha256(mineru版本;tier;source;backend;vlm;profile=v1.1.0;seal=v3)`；basic/standard 天然隔离；改 profile/backend 即失效。
- 只缓存 MinerU 原始 artifacts：`document.raw.md`、`document.middle.json`、`document.structured.json`（存在才存）。
- **不缓存**：`document.draft.md`、`issues.json`、`document.fields.json`、`final/document.md`、任何人工编辑/resolved 状态。
- 命中后 `restore()` 把 artifacts 复制进新任务的 `parsed/`，再重新跑 `prepare_review_artifacts` + `build_consistency_artifacts` → review 状态永远独立。
- 原子写：写 `.tmp-*` → 拷贝全部 artifacts → 写 `manifest.json` → `os.replace` 发布；异常清理 tmp。
- 损坏处理：manifest 缺失/损坏/版本不符/artifact 缺失 → quarantine 并视为 miss（cache 不成为单点故障）。
- TTL：`CONTRACT_PARSE_CACHE_DAYS`（默认 30）+ `prune_expired()`（best-effort，worker 末尾调用，不阻塞主流程）。
- Manifest 字段：`version, sourceSha256, tier, parserSignature, qualityPass, createdAt, files, metrics`。

---

## 9. Progress

`ProgressReporter`（worker 内）：单调（新值 < 旧值则钳到旧值）；仅当消息/阶段/状态变化、或进度增长 ≥2、或距上次写库 ≥1s 才写库，避免打爆 PostgreSQL。

映射：3 检查文件 → 5 检查缓存 → 20 命中缓存/恢复 →（basic）15 启动→20 layout→32 vlm→40/46 ocr→50 seal →60 质量检查 →65 自动切换高精度 →（standard）65 启动→68/74/78/81/84 →88 生成校对文件 →90 等待人工校对 →100 finalize。fallback 时进度不倒退（basic 55→60→65→standard 70…85→88→90）。

`on_stage` 由 `mineru_service` 解析稳定关键词（`Layout Predict`/`VLM Predict`/`OCR-det`/`OCR-rec`/`OCR-seal`）触发；关键词缺失则退化为阶段级。**未解析 ANSI 进度条，不伪造精确百分比。**

前端：上传卡显示"解析模式"（自动/快速/高精度）；状态卡显示 `progressMessage` 与模式 badge（快速解析/高精度解析/自动·高精度/…·已复用）。

---

## 10. 测试与验证

### 单测（38 个，全部通过）
运行：`.mineru/bin/python -m unittest discover -s services/contract_review/tests -t .`
结果：`Ran 38 tests ... OK`
覆盖：parseMode 校验、auto pass、auto fail→standard、fast 仅 basic、accurate 仅 standard、同输入同 key、basic/standard key 不同、不同 owner key 不同、profile 版本改变→miss、corrupt cache→安全 miss、auto+合格 basic 缓存命中、auto+不合格 basic 缓存→standard、standard 缓存命中、gate 各类 fail、少量 illegible 不 fail、progress 单调、cache hit 仍重生 review artifacts。

### 语法检查
- `python3 -m py_compile`（worker/mineru_service/quality_gate/parse_cache/parse_profile/database/tests×4/benchmark）→ OK
- `node --check`（server.js/routes.js/repository.js/pdf-meta.js/script.js/workflow.js/contract-history.js）→ OK

### Benchmark
mock（真实 worker 编排 + 缓存 + gate，模拟解析耗时；非真实 MinerU）：

```
mode      run   actualTier  fallbackUsed  cacheHit  totalMs  basicParseMs  standardParseMs
fast      cold  basic       False         False     57       54            -
fast      warm  basic       False         True      1        -             -
accurate  cold  standard    False         False     157      -             154
accurate  warm  standard    False         True      1        -             -
auto      cold  basic       False         False     57       55            -
auto      warm  basic       False         True      1        -             -
```

真实 MinerU benchmark：**未运行**。原因：本机 `~/.mineru/models/MinerU-4_models_onnx` 缺失（缺 `ch_PP-OCRv6_tiny_det_infer.onnx`），仅有 `MinerU-4_models_torch`。未伪造数据。运行命令（需 ONNX 环境）：
```
.mineru/bin/python scripts/local/benchmark-contract-speed.py --real --pdf <pdf> --tiers basic,standard
```

---

## 11. 已知限制 / 未验证项 / 风险

- 真实 MinerU（basic/standard）未在本机跑；端到端 FAST/ACCURATE/AUTO→review→finalize 未在本机验证。
- migration `003` 未在真实 PostgreSQL 执行（本地未连接 DB）。
- `page_count` 依赖 pdfjs，失败为 null（gate 跳过该项）。
- 阶段进度依赖 MinerU 关键词，关键词变更会导致退化（仅阶段级，不影响正确性）。
- `mineru_service` 从 `subprocess.run` 改为 `Popen` 逐行读取：已保持 cwd/env/日志/returncode/zip 校验逻辑，但属生产关键路径，建议真机回归一次。
- worker 编排加了 cache/gate/progress，逻辑变大；claim/lock/delete/cleanup/error 语义保持，但建议真机跑一次真实合同。
- DeepSeek thinking 变体等与本任务无关项未涉及。

---

## 12. 兼容性与安全性核对

- 旧字段/API 全部保留；新字段在 status/latest/history 中增量返回；legacy `job.json` 任务在 status 端点仍可读（新字段用 `?? null` 兜底）。
- parseMode 缺失 → auto（旧客户端不受影响）；非法 → HTTP 400 且清理已落盘 PDF。
- cache 不通过 HTTP 暴露、不在 `public/`；目录名用 owner hash；不同 owner 不能复用。
- 未改 `requireAuth`/same-origin/上传大小/最终化/issue schema/bbox。
- 未新增依赖；env 全部可选；未部署、未提交、未 push。

---

## 13. 建议下一步（供决策）

1. 在装好 ONNX 的机器跑真实 cold/warm benchmark（FAST/ACCURATE/AUTO），如实报告是否达到 ≥50% 提速。
2. 在真实 PostgreSQL 验证 migration `003`（全新库 + v1.0.2 升级 + 重复执行幂等）。
3. 端到端人工验收 Scenario A–G。
4. 审阅通过后按仓库规范提交（本报告未触发 commit/push/deploy）。

---

## 14. `git diff --stat`（未提交，工作区）

```
 private/tools/contract-review/index.html    |  83 ++-
 private/tools/contract-review/script.js     | 180 ++++++
 private/tools/contract-review/styles.css    | 131 ++++
 server/contracts/repository.js              |  39 +-
 server/contracts/routes.js                  | 186 ++++++-
 services/contract_review/database.py        | 194 +++++++
 services/contract_review/mineru_service.py  | 107 +++-
 services/contract_review/worker.py          | 845 ++++++++++++++++++++++++++++-
 8 files changed, 1736 insertions(+), 29 deletions(-)
```

新增文件（不在 `git diff --stat`，为 untracked）：
`server/contracts/migrations/003_contract_speed_v11.sql`、`server/contracts/pdf-meta.js`、`services/contract_review/{parse_profile,quality_gate,parse_cache}.py`、`services/contract_review/tests/*`、`scripts/local/benchmark-contract-speed.py`。

---

## 附：审查者重点核对清单

- [ ] FAST 是否**只**走 basic、绝不 fallback（即使 gate fail）
- [ ] ACCURATE 是否**只**走 standard
- [ ] AUTO 是否 basic-first，且仅 gate fail 才 standard
- [ ] gate 是否纯确定性、无 AI、无伪造 confidence
- [ ] cache 是否**只**存 MinerU artifacts，绝不存 draft/issues/fields/final
- [ ] cache key 是否含 owner scope（A 不能用 B 的缓存）
- [ ] basic/standard cache 是否隔离
- [ ] profile/backend/vlm 变化是否 invalidate cache
- [ ] cache 损坏是否安全降级为 miss（不影响任务）
- [ ] cache hit 后是否仍重新生成 draft/issues/fields（review 状态独立）
- [ ] progress 是否单调、fallback 不倒退、是否限频写库
- [ ] migration 是否 additive/backward-compatible、历史行是否正确 backfill 为 accurate/standard
- [ ] 旧 API/字段/legacy job 是否仍可用
- [ ] 生产修复（ONNX/llama-cpp/V3 seal）是否保留
- [ ] worker 并发是否仍为 1

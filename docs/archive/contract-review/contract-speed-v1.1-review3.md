# Contract Digitization v1.1 — 收尾评审（review3）

> 用途：交给另一个 AI 复核本次 3 个收尾项。
> 分支：`feature/contract-speed-v1.1`（基线 `93aff52`，含生产 `d60119f` / tag `contract-review-v1.0.2`）
> 状态：**已收尾修正，未提交、未 push、未 merge、未部署、未跑真实生产 migration**
> 生成时间：2026-10-12

---

## 1. `003_contract_speed_v11.sql` 完整 SQL

```sql
BEGIN;

-- Contract Digitization v1.1 (contract-speed-v1.1)
--
-- Additive / backward-compatible only.
-- No column is dropped or renamed.
--
-- Columns:
--   source_sha256          streaming SHA256 of the uploaded source PDF
--   parse_mode_requested   auto | fast | accurate (user intent)
--   parse_tier_actual      basic | standard (what MinerU actually ran)
--   parse_cache_hit        whether MinerU artifacts were reused from cache
--   parse_fallback_used    AUTO only: basic quality gate failed -> standard
--   parse_fallback_reason  machine-readable reason, e.g. basic_quality_gate_failed:page_count_mismatch
--   progress_message       human-readable, non-technical progress text
--   parse_metrics          JSONB timing / quality metrics (no contract text)

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS source_sha256 TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_mode_requested TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_tier_actual TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_cache_hit BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_fallback_used BOOLEAN
        NOT NULL DEFAULT FALSE;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_fallback_reason TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS progress_message TEXT;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS parse_metrics JSONB;

-- page_count already exists from 001_contracts.sql
-- (INTEGER NULL CHECK (page_count IS NULL OR page_count >= 0)).
-- This line is a defensive, idempotent no-op so that any
-- environment whose schema drifted still ends up consistent with
-- repository.js INSERT/SELECT and the worker's usage.
-- It is nullable, additive, backward-compatible, and needs no
-- backfill (historical rows keep NULL).
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS page_count INTEGER;

-- Historical v1.0.2 contracts were all parsed with the
-- Standard tier, so backfill them as accurate/standard.
--
-- The WHERE clause only touches rows that have never been
-- classified, so re-running this migration is a no-op.
UPDATE contracts
SET
    parse_mode_requested = 'accurate',
    parse_tier_actual = 'standard'
WHERE parse_mode_requested IS NULL;

-- New contracts default to AUTO (customer-facing "自动").
ALTER TABLE contracts
    ALTER COLUMN parse_mode_requested
    SET DEFAULT 'auto';

ALTER TABLE contracts
    ALTER COLUMN parse_cache_hit
    SET DEFAULT FALSE;

ALTER TABLE contracts
    ALTER COLUMN parse_fallback_used
    SET DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS
    idx_contracts_owner_source_sha256
ON contracts (
    owner_username,
    source_sha256
);

COMMIT;
```

### page_count 结论（关键）
- **`page_count` 早已由 `001_contracts.sql` 定义**：`page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0)`。
- 因此 003 **不新增**语义字段，仅加一条**幂等防御** `ADD COLUMN IF NOT EXISTS page_count INTEGER`（存在则整体跳过，不会与已有 CHECK 冲突）。
- 该语句 nullable / additive / backward-compatible / 无需 backfill（历史行保持 NULL）。
- 未删除或修改任何生产字段。
- Quality Gate 仅在 `page_count > 0`（可靠）时才使用该值（见 §5）。

---

## 2. `repository.js` 中 page_count 的 INSERT / 读取

- `createContract()` 的 INSERT 列表包含 `page_count`（第 14 个占位 `$14`），参数 `contract.pageCount ?? null`：
  ```sql
  INSERT INTO contracts (
    id, owner_username, original_name, stored_name, file_path,
    size_bytes, mime_type, status, stage, progress, error_message,
    parse_mode_requested, source_sha256, page_count
  ) VALUES ($1 ... $14) RETURNING *
  ```
- `mapContract()` 读取 `row.page_count` → 输出 `pageCount`。
- `updateContractState()` 支持 `page_count = COALESCE($7, page_count)`（既有 v1.0.2 行为，未改）。
- 上传时由 `routes.js` 用 `pdf-meta.js`（pdfjs）写入 `pageCount`（best-effort，失败为 null）。

静态验证：`services/contract_review/tests/test_schema_consistency.py`
`test_repository_insert_columns_exist_in_schema` 解析 `repository.js` 的 INSERT 列并断言全部存在于 migration schema（含 `page_count`）。

---

## 3. Python worker / database 如何取得 page_count

- `database.claim_next_contract()` / `claim_contract()` 的 `RETURNING` 含 `page_count`（`c.page_count`）。
- `database.get_contract()` 的 `SELECT` 含 `page_count`。
- `worker.process_contract()`：`input_page_count = contract.get("page_count")`；传给 `evaluate_parse_quality(..., page_count=input_page_count)`。
- `database.update_parse_metadata(..., page_count=...)` 写回 `page_count = COALESCE(%s, page_count)`；worker 写回 `parsed_pages or input_page_count`。
- Quality Gate 只在 `page_count` 可解析为正整数时启用 page 校验。

静态验证：`test_worker_database_reads_page_count_and_v11_columns` 断言 `database.py` 覆盖全部 v1.1 列（含 `page_count`）。

---

## 4. 最终 progress mapping

| progress | 含义 |
|---|---|
| 10 | worker claimed（`claim_next_contract` / `_update_contract_state`）|
| 12 | 正在检查文件（SHA256）|
| 15 | 正在检查解析缓存 |
| 20 | 命中解析缓存 / 启动快速解析 |
| 30 | 正在分析页面布局（basic layout）|
| 38 | 正在识别合同文字（basic vlm）|
| 44 / 48 | 正在识别合同文字（basic ocr_det / ocr_rec）|
| 52 | 正在识别印章与图片文字（basic ocr_seal）|
| 60 | 正在检查快速解析质量（gate）|
| 65 | 快速解析质量不足，正在自动切换高精度解析 / 启动高精度解析 |
| 68 | 高精度 layout |
| 74 | 高精度 vlm |
| 78 / 81 | 高精度 ocr_det / ocr_rec |
| 84 | 高精度 ocr_seal |
| **86** | **高精度解析完成（真实 Standard parse 结束）** |
| 70 | 恢复解析结果（**仅 cache restore**）|
| 88 | 正在生成校对文件 |
| 90 | 等待人工校对 |
| 100 | finalize（Node 侧）|

`ProgressReporter`：`floor=10`，写入单调；仅消息/阶段/状态变化或增长 ≥2 且距上次写 ≥1s 才写库。
本次修正明确区分：**cache restore = 70** 与 **真实 Standard parse = 68/74/78/81/84 + 86**，二者不再混用同一数字。

---

## 5. Standard 全路径 progress sequence

真实 Standard（ACCURATE，cold）：
```
10 → 12 → 15 → 65 → 68 → 74 → 78 → 81 → 84 → 86 → 88 → 90 → (finalize 100)
```

AUTO fallback（Basic 失败 → Standard，cold）：
```
10 → 12 → 15 → 20 → 30 → 38 → 44 → 48 → 52 → 60 → 65 → 68 → 74 → 78 → 81 → 84 → 86 → 88 → 90
```

Standard cache restore：
```
10 → 12 → 15 → 20 → 70 → 88 → 90
```

Basic cache restore（gate 通过）：
```
10 → 12 → 15 → 20 → 60 → 70 → 88 → 90
```

Basic cache 命中但 gate 失败 → Standard：
```
10 → 12 → 15 → 20 → 60 → 65 → 68 → 74 → 78 → 81 → 84 → 86 → 88 → 90
```

FAST 真实 Basic：
```
10 → 12 → 15 → 20 → 30 → 38 → 44 → 48 → 52 → 60 → 88 → 90
```

所有序列**天然单调**，不需要依赖 ProgressReporter clamp；真实 Standard 路径不会出现 `84 → 70`。
新增测试：`test_standard_real_parse_progress_sequence`（含 86、不含 70、天然有序）、`test_standard_cache_restore_uses_70_not_86`。

---

## 6. `git status --short`

```
 M PROJECT_STATUS.md
 M private/tools/contract-review/index.html
 M private/tools/contract-review/script.js
 M private/tools/contract-review/styles.css
 M server/contracts/repository.js
 M server/contracts/routes.js
 M services/contract_review/database.py
 M services/contract_review/mineru_service.py
 M services/contract_review/worker.py
?? docs/contract-speed-v1.1-report.md
?? docs/contract-speed-v1.1-review2.md
?? scripts/local/benchmark-contract-speed.py
?? server/contracts/migrations/003_contract_speed_v11.sql
?? server/contracts/pdf-meta.js
?? services/contract_review/parse_cache.py
?? services/contract_review/parse_profile.py
?? services/contract_review/quality_gate.py
?? services/contract_review/tests/
```

---

## 7. 文件提交分类

**A. v1.1 功能代码（建议纳入 v1.1 feature commit）**
- `server/contracts/routes.js`
- `server/contracts/repository.js`
- `server/contracts/pdf-meta.js`
- `server/contracts/migrations/003_contract_speed_v11.sql`
- `services/contract_review/worker.py`
- `services/contract_review/mineru_service.py`
- `services/contract_review/database.py`
- `services/contract_review/parse_profile.py`
- `services/contract_review/quality_gate.py`
- `services/contract_review/parse_cache.py`
- `services/contract_review/tests/`（含 test_schema_consistency.py）
- `private/tools/contract-review/index.html`
- `private/tools/contract-review/script.js`
- `private/tools/contract-review/styles.css`
- `scripts/local/benchmark-contract-speed.py`（dev 工具，DoD 要求）

**B. 文档 / 报告 / 状态（可选提交，建议分开或不进 feature commit）**
- `docs/contract-speed-v1.1-report.md`
- `docs/contract-speed-v1.1-review2.md`
- `docs/contract-speed-v1.1-review3.md`
- `PROJECT_STATUS.md`

**C. 与本任务无关，不应提交**
- 仓库内：**无**。
- 说明：`~/.config/opencode/AGENTS.md`（个人全局配置，默认把汇报文件复制到 `~/Downloads`）位于仓库之外，不属于任何 commit。

### 关于 `PROJECT_STATUS.md` 的 46/47 行修改
- 它是**断点续连状态快照**（checkpoint），内容为"当前项目状态"全文覆盖，不是 v1.1 功能代码。
- 该 diff 混合了历史任务（agent 配置/权限/断点续连/冗余清理）与本次 v1.1 状态描述，因此行数变化大。
- 与本任务无直接功能关系 → 归入 **B**。**不删除用户内容**，但**不纳入 v1.1 功能 commit**（可单独作为 status 提交或保留在工作区）。

---

## 8. 测试总数与结果

```
$ .mineru/bin/python -m unittest discover -s services/contract_review/tests -t .
Ran 49 tests in 0.144s
OK
```

构成：parse_profile(9) + quality_gate(13) + parse_cache(10) + worker_orchestration(13) + schema_consistency(4)。

Python 语法检查：
```
$ python3 -m py_compile services/contract_review/{worker,mineru_service,quality_gate,parse_cache,parse_profile,database}.py \
    services/contract_review/tests/*.py scripts/local/benchmark-contract-speed.py
PY OK
```

Node 语法检查：
```
OK server.js
OK server/contracts/routes.js
OK server/contracts/repository.js
OK server/contracts/pdf-meta.js
OK private/tools/contract-review/script.js
OK private/tools/contract-review/workflow.js
OK private/tools/contract-review/contract-history.js
```

真实 MinerU benchmark：仍未运行（本机缺 ONNX 模型），未伪造。未执行任何真实生产 migration。

---

## 9. `git diff --stat`

```
 PROJECT_STATUS.md                          |  47 +-
 private/tools/contract-review/index.html   |  83 ++-
 private/tools/contract-review/script.js    | 180 ++++++
 private/tools/contract-review/styles.css   | 131 ++++
 server/contracts/repository.js             |  39 +-
 server/contracts/routes.js                 | 186 +++++-
 services/contract_review/database.py       | 194 ++++++
 services/contract_review/mineru_service.py | 135 ++++-
 services/contract_review/worker.py         | 906 ++++++++++++++++++++++++++++-
 9 files changed, 1850 insertions(+), 51 deletions(-)
```

（untracked 新增文件不在 `git diff --stat`：`003_contract_speed_v11.sql`、`pdf-meta.js`、`parse_profile/quality_gate/parse_cache.py`、`tests/`、`benchmark-contract-speed.py`、`docs/*`。）

---

## 复核关注点

- [ ] `page_count` 是否确认已在 001 定义、003 仅幂等防御
- [ ] schema 与 repository INSERT / database 读取是否一致（含静态测试）
- [ ] Standard 是否区分 70(cache) 与 68-84+86(real)，且无 84→70
- [ ] progress 是否天然单调、无 clamp 依赖
- [ ] 提交分类是否合理、PROJECT_STATUS.md 是否未混入 feature commit

未提交、未 push、未 merge、未部署、未跑真实生产 migration。

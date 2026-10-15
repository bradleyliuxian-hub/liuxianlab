# Contract Digitization v1.1 — 上线前修正评审（review2）

> 用途：交给另一个 AI 复核本次"冻结后修正"。
> 分支：`feature/contract-speed-v1.1`（基线 `93aff52`，包含生产 `d60119f` / tag `contract-review-v1.0.2`）
> 状态：**已修正，未提交、未 push、未部署，未新增功能**
> 生成时间：2026-10-12

---

## 1. Ancestry 验证结果 ✅

```
$ git merge-base --is-ancestor d60119f 93aff52        ; echo $?
0
$ git merge-base --is-ancestor d60119f feature/contract-speed-v1.1 ; echo $?
0
$ git merge-base feature/contract-speed-v1.1 main
93aff52...
```

```
* 93aff52 (HEAD -> feature/contract-speed-v1.1, origin/main, main) chore: refresh PROJECT_STATUS snapshot
* f112b24 chore: optimize opencode for low-cost token usage
* 0f783e7 chore: remove stale files and refresh README
* d60119f (tag: contract-review-v1.0.2) fix: stabilize production MinerU contract parsing
* a759519 chore: add initial PROJECT_STATUS recovery snapshot
...
```

结论：`d60119f`（contract-review-v1.0.2）**是** `feature/contract-speed-v1.1` 的祖先。基线正确，无需 rebase/reset。

---

## 2. 四个问题的修正

### 问题 2：Progress 初始值冲突（已修正）
- 现状确认：`claim_next_contract` / `claim_contract` 仍将 DB `progress` 置为 **10**（未改动，保持旧行为）。
- 之前 `ProgressReporter` 会先写 3，导致 DB 从 10 回退到 3。
- 修正：
  - `ProgressReporter.__init__` 新增 `floor`（默认 0），worker 以 `floor=10` 构造，使任何后续写入都 >= 10。
  - 映射整体上移：hash 3→**12**，cache lookup 5→**15**，Basic 起始 15→**20**；其余见 §3。
- 新增测试：`test_progress_never_below_ten`（有 fallback 的 auto，断言所有 reporter 写入 >= 10）与既有 `test_progress_is_monotonic`（fallback 全程单调）。

### 问题 3：Basic cache 的 stale `qualityPass`（已修正）
- 采用推荐方案：**cache hit 后重新跑当前 Quality Gate**（轻量），manifest 里的 `qualityPass` 只保留作 metrics/debug。
- `_select_cached_parse` 不再根据存储的 `qualityPass` 决定是否 fallback；AUTO 命中 Basic 缓存后：
  - restore 原始 MinerU artifacts → 用**当前** `quality_gate.py` 重新 `evaluate_parse_quality`
  - PASS → 使用 Basic（`cacheHit=true`）
  - FAIL → Standard fallback（`fallbackUsed=true`、`cacheHit=false`，重新解析 Standard）
- FAST 命中 Basic 缓存：仍重新评估（记录 metrics），但**绝不 fallback**。
- ACCURATE：只查 Standard 缓存。
- 新增测试：
  - `test_cached_basic_stale_pass_is_revalidated_to_standard`（manifest `qualityPass=true`，当前 gate 失败 → AUTO 转 Standard）
  - `test_cached_basic_stale_fail_is_revalidated_to_basic`（manifest `qualityPass=false`，当前 gate 通过 → AUTO 用 Basic）
  - 更新 `test_auto_rejected_basic_cache_goes_standard`（reason 现为 `basic_quality_gate_failed:...`）
- 未采用"保留旧 qualityPass 作 fast-path + gate 独立 signature"方案；因重新评估成本极低且更安全。

### 问题 4：page_count 规则收紧（已修正）
- 之前：`parsed < input * 0.8` 宽松容忍。
- 现在：当 **input page count 与 middle JSON parsed page count 都可可靠获得**时，`parsed != input` **即** `page_count_mismatch`（严格相等，含 parsed > input）。
- 移除了 `page_count_mismatch_ratio` 阈值常量。
- **无 blank-page 特例**：未凭空放宽。若将来有真实"空白页被 MinerU 合理省略"的证据，需连同**固定 fixture** 与说明一起加回。
- 新增测试：`test_page_count_equal_no_mismatch`、`test_page_count_extra_pages_mismatch`；保留 `test_page_count_mismatch`（10 vs 1）。

### 问题 5：Popen 审查（已加固，见 §6）
- 确认 **stdout=PIPE、stderr=STDOUT（合并为单一管道）**，只有一个 reader，**不存在双管道 deadlock**。
- 增加异常路径清理：读取/回调抛异常时 `terminate → kill` 并 `wait`，避免僵尸/残留子进程。

---

## 3. 修改后的 Progress 映射（全部 >= 10，单调）

| progress | progressMessage | 触发点 |
|---|---|---|
| 10 | （claim 阶段）| `claim_next_contract` / `_update_contract_state` |
| 12 | 正在检查文件 | SHA256 流式 |
| 15 | 正在检查解析缓存 | cache lookup |
| 20 | 命中解析缓存 / 启动快速解析 | cache hit 或 Basic 开始 |
| 30 | 正在分析页面布局 | basic layout |
| 38 | 正在识别合同文字 | basic vlm |
| 44 / 48 | 正在识别合同文字 | basic ocr_det / ocr_rec |
| 52 | 正在识别印章与图片文字 | basic ocr_seal |
| 60 | 正在检查快速解析质量 | quality gate |
| 65 | 快速解析质量不足，正在自动切换高精度解析 | AUTO fallback |
| 68 / 74 / 78 / 81 / 84 | （高精度各阶段）| standard layout/vlm/ocr_det/ocr_rec/ocr_seal |
| 70 | 恢复解析结果 | cache restore（standard 或 basic 通过）|
| 88 | 正在生成校对文件 | review artifacts |
| 90 | 等待人工校对 | reviewing |
| 100 | — | finalize（Node 侧）|

`ProgressReporter` 保证：`floor=10`、写入值单调不减、仅消息/阶段/状态变化或增长 ≥2 且距上次 ≥1s 才写库。

---

## 4. 修改后的 Cache-hit Quality Gate 流程

```
select_cached_parse(owner, sha, mode):
  ACCURATE -> standard cache? use(standard) : miss
  FAST     -> basic cache?    use(basic)    : miss
  AUTO     -> standard cache? use(standard)
              : basic cache?  use(basic)
              : miss

on use(basic):
  restore artifacts
  gate = evaluate_parse_quality(current thresholds, restored artifacts)
  FAST:                                -> use basic（只记录 gate）
  AUTO: gate.passed ? use basic        -> cacheHit=true
        gate.fail   ? run standard     -> fallbackUsed=true, cacheHit=false,
                                          reason=basic_quality_gate_failed:<reasons>
on use(standard):
  use standard（不重跑 gate）
```

manifest 的 `qualityPass` 仅用于 metrics/debug，**不参与** AUTO 当前决策。

---

## 5. page count 规则

- 仅当 `input_page_count`（Node/pdfjs 提供，>0）与 `parsed_page_count`（middle JSON `pages` 长度）都可靠时检查。
- 规则：`parsed_page_count != input_page_count` → `page_count_mismatch`（严格相等，无容差）。
- 无 blank-page 例外；如需，必须附 fixture。

---

## 6. Popen 实现（完整片段）

```python
process = subprocess.Popen(
    command,
    cwd=str(PROJECT_ROOT),
    env=env,
    stdout=subprocess.PIPE,
    # stderr 合并进 stdout → 只有 1 个管道、1 个 reader，无双管道 deadlock；
    # 印章/跳过等 stderr 警告仍写入 mineru.log。
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)

try:
    for line in process.stdout:          # 单管道顺序读取到 EOF
        log_file.write(line)
        log_file.flush()                 # mineru.log 实时、完整
        if on_stage is None:
            continue
        lowered = line.lower()
        for stage, keywords in _STAGE_KEYWORDS:
            if stage in stage_seen:
                continue
            if any(keyword in lowered for keyword in keywords):
                stage_seen.add(stage)
                try:
                    on_stage(stage)      # 回调异常被吞掉，不影响解析
                except Exception:
                    pass
                break
    process.wait()
except BaseException:
    # 读取/回调抛错也不留僵尸或残留子进程
    if process.poll() is None:
        try:
            process.terminate()
            process.wait(timeout=10)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
            try:
                process.wait(timeout=5)
            except Exception:
                pass
    raise
finally:
    if process.stdout is not None:
        process.stdout.close()

returncode = process.returncode
if returncode != 0:
    error_tail = log_path.read_text(encoding="utf-8", errors="replace")[-3000:]
    raise RuntimeError(f"MinerU failed with exit code {returncode}\n{error_tail}")
```

逐点确认：
- **stdout 读取**：`for line in process.stdout`（text 模式，逐行）。
- **stderr 读取**：不单独读取；`stderr=subprocess.STDOUT` 合并进 stdout 同一管道。
- **stderr=STDOUT**：是。
- **pipe deadlock**：不会。只有一个管道、一个消费者；不存在"两个 PIPE 但不并发消费"的问题。
- **returncode**：`process.wait()` 后读 `process.returncode`，非 0 时抛 `RuntimeError` 并附日志尾部。
- **mineru.log 完整性**：合并流逐行写入并 `flush()`；成功与失败路径都保留完整日志。
- **V3 seal warning**：属 stderr，合并进同一管道后写入日志，保留不变（`LIUXIANLAB_SAFE_SEAL_CROP_V3` 逻辑未改）。
- **子进程异常退出**：非 0 → 抛出并带日志尾部；读取阶段异常 → `terminate/kill + wait` 清理后重新抛出。
- **删除 contract 时 worker 行为**：`worker.process_contract` 在解析前后/生成 artifacts 前后的删除检查与 `cleanup_deleted_contract` 逻辑**未改动**；`mineru_service` 只是在完成后返回/抛错，删除分支仍由 worker 处理。

---

## 7. 新增 / 更新测试

新增：
- `test_worker_orchestration.py`
  - `test_cached_basic_stale_pass_is_revalidated_to_standard`
  - `test_cached_basic_stale_fail_is_revalidated_to_basic`
  - `test_progress_never_below_ten`
  - 辅助 `_prestore_basic()`（预置 Basic cache + 指定 stale qualityPass）
- `test_quality_gate.py`
  - `test_page_count_equal_no_mismatch`
  - `test_page_count_extra_pages_mismatch`

更新：
- `test_auto_rejected_basic_cache_goes_standard`：fallback reason 断言改为 `startswith("basic_quality_gate_failed")`

---

## 8. 测试总数与结果

```
$ .mineru/bin/python -m unittest discover -s services/contract_review/tests -t .
Ran 43 tests in 0.063s
OK
```
（上一轮 38 → 本轮 **43**，全部通过。）

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

Mock benchmark（修正后仍正常，cache cold→warm 生效）：
```
mode      run   actualTier  fallbackUsed  cacheHit  totalMs
fast      cold  basic       False         False     57
fast      warm  basic       False         True      1
accurate  cold  standard    False         False     156
accurate  warm  standard    False         True      1
auto      cold  basic       False         False     56
auto      warm  basic       False         True      2
```
真实 MinerU benchmark：仍未运行（本机缺 ONNX 模型），未伪造。

---

## 9. `git diff --stat`（未提交）

```
 PROJECT_STATUS.md                          |  46 +-
 private/tools/contract-review/index.html   |  83 ++-
 private/tools/contract-review/script.js    | 180 ++++++
 private/tools/contract-review/styles.css   | 131 ++++
 server/contracts/repository.js             |  39 +-
 server/contracts/routes.js                 | 186 +++++-
 services/contract_review/database.py       | 194 +++++++
 services/contract_review/mineru_service.py | 135 ++++-
 services/contract_review/worker.py         | 886 ++++++++++++++++++++++++++++-
 9 files changed, 1829 insertions(+), 51 deletions(-)
```

新增文件（untracked）：
`server/contracts/migrations/003_contract_speed_v11.sql`、`server/contracts/pdf-meta.js`、
`services/contract_review/{parse_profile,quality_gate,parse_cache}.py`、`services/contract_review/tests/*`、
`scripts/local/benchmark-contract-speed.py`、`docs/contract-speed-v1.1-report.md`、`docs/contract-speed-v1.1-review2.md`。

---

## 10. 复核关注点

- [ ] Progress 是否全部 >= 10 且 fallback 不倒退
- [ ] Basic cache hit 是否**重新**跑当前 gate（stale qualityPass 不再决定 AUTO）
- [ ] Standard cache hit 是否直接使用
- [ ] page_count 是否严格相等（无 0.8 容差）
- [ ] Popen 是否单管道、无 deadlock、日志完整、异常清理
- [ ] 删除 contract 行为是否未变
- [ ] 是否未新增功能 / 未提交 / 未部署

未提交、未 push、未部署。

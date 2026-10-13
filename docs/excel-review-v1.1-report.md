# Excel Review Assistant V1.1 报告

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地 V1.1 完成，**未 commit / 未 push / 未 deploy / 未执行生产 migration**

## 1. Root Cause

- **为什么 V1 读不到 Microsoft 365 Threaded Comments**
  V1 只读取 openpyxl 的 `cell.comment`。openpyxl 3.1.5 不支持 threaded comments：
  它既不解析 `xl/threadedComments/*`，也不认识 `xl/persons/*`。真实文件里，Excel
  会为每条线程批注额外写入一条 legacy “fallback note”（作者形如 `tc={threadId}`，
  正文以 `[线程批注]` 开头），V1 会把这条 fallback 当作普通批注读取，于是文本被污染、
  丢失作者/时间/线程关系，且真正的线程批注并未被正确识别。
- **为什么 Review 原文件定位对用户不够清晰**
  V1 可见列只有 ID/Sheet/Cell，没有 Source File、Source Reference、Type、Thread ID 等；
  用户只能靠隐藏 `_Mapping` 才知道来源。
- **为什么之前有 worksheet protection**
  V1 用 worksheet protection + 锁定单元格来“防止误改”。这既阻碍用户自由排序/筛选/加列，
  也不是真正的安全边界。

**关键实测结论**：对真实文件做 `openpyxl load_workbook() -> save()`，`xl/threadedComments/*`
与 `xl/persons/*` **被完全删除**。因此凡是含线程批注的工作簿，绝不能走 openpyxl 重新保存。

## 2. 实际新增文件

- `services/excel_review/ooxml_package.py` — OPC/ZIP + relationships 低层工具，最小化补丁写回
- `services/excel_review/ooxml_threaded_comments.py` — 基于 relationship 的 threadedComments / persons 解析
- `services/excel_review/tests/threaded_fixture.py` — 合成 threaded 工作簿生成器（含回复链）
- `services/excel_review/tests/test_threaded_comments.py` — 线程批注 + OOXML 保真测试
- `services/excel_review/tests/fixtures/threaded_real_baseline.xlsx` — 真实 Microsoft 365 文件（已脱敏显示名/邮箱，结构未改）

## 3. 实际修改文件

- `services/excel_review/parser.py` — 统一 legacy + threaded 提取；跳过 fallback note；新字段
- `services/excel_review/review_workbook.py` — 新列/新可见结构；Mapping V2；**移除所有保护**；按表头读 Reply；重复 ID 检测
- `services/excel_review/reply_writer.py` — 双模式写回（legacy-only 用 openpyxl；含线程用 OOXML 手术式补丁）
- `services/excel_review/worker.py` — 读取原始文件名；上报跳过的线程回复
- `services/excel_review/status.py` — （未改字段，保持兼容）
- `services/excel_review/__init__.py` — 导出新模块
- `services/excel_review/tests/test_excel_review.py` — 更新到新模型 + 新增稳健性/校验测试
- `server/excel-review/routes.js` — 写 `meta.json`（原始文件名）；`/meta` 返回真实能力
- `private/tools/excel-review/index.html`、`script.js` — 能力文案与结果提示

未改动：`server.js`（V1 已挂载）、`config/tools.json`、contract 全部代码、`.env`。

## 4. Threaded OOXML Architecture

定位链（全部通过 relationships 动态解析，绝不按文件编号猜 sheet）：

```
xl/workbook.xml  <sheets><sheet name r:id>
        │
        ▼
xl/_rels/workbook.xml.rels        (r:id -> worksheets/sheetN.xml; 也声明 person 关系)
        │
        ▼
xl/worksheets/sheetN.xml
        │
        ▼
xl/worksheets/_rels/sheetN.xml.rels
        │   Type = .../2017/10/relationships/threadedComment
        ▼
xl/threadedComments/threadedCommentM.xml   (ref/dT/personId/id/parentId/done + <text>)
        │
        ▼
xl/persons/personP.xml   (id -> displayName，经 workbook rels Type=.../person)
```

## 5. OOXML 实际结构

真实文件 `threaded_real_baseline.xlsx` 中发现（不含用户敏感正文）：

- threaded part：`xl/threadedComments/threadedComment1.xml`
  命名空间 `http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments`
  节点 `<threadedComment ref="D4" dT="2026-10-13T06:00:38.62" personId="{...}" id="{...}"><text>…</text></threadedComment>`
- person part：`xl/persons/person.xml`
  `<person displayName="…" id="{...}" userId="S::…::…" providerId="AD"/>`
- worksheet→threaded relationship：
  `http://schemas.microsoft.com/office/2017/10/relationships/threadedComment` → `../threadedComments/threadedComment1.xml`
- workbook→person relationship：
  `http://schemas.microsoft.com/office/2017/10/relationships/person` → `persons/person.xml`
- content types：`application/vnd.ms-excel.threadedcomments+xml`、`application/vnd.ms-excel.person+xml`
- 同一 sheet 同时存在 legacy `comments1.xml`（`.../relationships/comments`）与 VML 绘图

## 6. Unified Item Model

```
itemId, reviewId,
commentType,          # legacy | threaded | threaded_reply
sheetName, cellAddress, cellValue,
commentText, author, commentDatetime,
threadId, parentThreadId, personId,
originalTextHash, legacyCommentHash,
sourceFilename, sourceReference
```

## 7. Review.xlsx Columns

```
A Review ID | B Type | C Source File | D Sheet | E Cell | F Source Reference |
G Original Value | H Original Comment | I Author | J Comment Time |
K Thread ID | L Parent Thread ID | M Reply | N Status
```

## 8. Source Reference

格式：`<Source File> → <Sheet> → <Cell>`，例如：

```
ProjectBudget.xlsx → 财务复核 → B5
```

## 9. Mapping V2

`_Mapping`（hidden，无密码，无保护）字段：

```
mapping_version, job_id, item_id, review_id,
source_sha256, source_filename,
comment_type, sheet_name, cell_address,
original_text_hash, legacy_comment_hash,
thread_id, parent_thread_id, person_id,
mapping_token
```

- **identity 校验**：每行 `cell_address / sheet_name / comment_type / original_text_hash`
  必须与 `extracted.json` 一致；`review_id` 集合必须完全一致。
- **hash 校验**：`source_sha256` 必须一致；写回前再次计算源文件 SHA256。
- **token 校验**：token = SHA256(canonical JSON of identity fields)，存入每行 `mapping_token`；
  读取时重算并比对，同时校验每行 `mapping_token` 与重算值一致。
- **version 校验**：`mapping_version == excel-review-mapping-v2`，否则提示
  “Review 文件版本不兼容，请重新生成 Review 文件。”（V1 文件不会被 V1.1 误解释）
- 可见 `Comments` 仅人工工作区；改 Sheet/Cell/Original Comment/Author/排序/加列都**不影响写回定位**。

## 10. Worksheet Protection

```
Comments protected: false
_Mapping visible? hidden (无密码)
其他可见 Sheet: 无（仅 Comments）
所有已写单元格 locked=false；无 password protection
```

## 11. Native Threaded Reply

```
Native Threaded Reply write-back: NO
```

- **已实现到什么程度**：线程批注（含 roots/replies/作者/时间/线程与父子 ID）已能正确读取并进入 Review；
  含线程的工作簿在写回时走 OOXML 手术式补丁，只改需要改的 legacy `comments*.xml`，
  其余 part（含 threadedComments、persons、relationships、Content Types）**逐字节保持不变**。
- **还缺什么**：把 Reply 作为原生 `<threadedComment parentId=…>` 追加进线程，并同步 Excel 的
  legacy fallback note（`tc={threadId}`）以保持新旧读取器一致。
- **为什么未强行完成**：
  1. 本环境**没有桌面 Excel 可做“打开无修复”验证**，而任务明确要求：无法可靠验证时不得冒险写入；
  2. 需要同时维护 threadedComments 与 fallback note 的一致性，属高风险 OOXML 变更；
  3. 缺乏一份真实“含回复（parentId）”的 Microsoft 365 样本可供对照。
- **当前安全行为**：含线程工作簿写回时，线程批注的 Reply **不写入、不降级、不伪造**，
  但在结果消息与 `result.threadedRepliesSkipped / skippedRefs` 中**明确上报**，绝不静默丢失。
- **推荐后续实现**：拿到真实“含回复”的 Excel 样本后，按 MS Open XML SDK 的
  `ThreadedComment{ Ref, PersonId, Id, ParentId, DT }` 追加节点，复用已有 person，
  并同步更新该单元格的 legacy fallback note；配套“Excel 打开无修复”人工验收。

## 12. OOXML Preservation

- 含线程工作簿：**绝不** openpyxl 保存。仅对需要写入的 legacy `comments*.xml` 做
  定向字符串补丁（在目标 `<comment>` 的 `<text>` 内追加一个 `<r><t>` 运行），
  其余所有 part 原样复制。
- 实测（真实文件 + 25 条 legacy 回复）：39 个 part 中**仅 6 个 `comments*.xml` 改变**，
  `threadedComments/*`、`persons/*`、`[Content_Types].xml`、所有 sheet、styles、
  sharedStrings、rels 全部**逐字节一致**；无新增/删除 part。
- 纯 legacy 工作簿（无线程）：继续使用原有 openpyxl 写回，行为不变。

## 13. Tests

```
Excel Review tests:   36 / 36 pass
Node tests:           13 / 13 pass   (threaded 真实文件端到端)
Contract Review tests:135 / 135 pass
Syntax:               PASS (node --check ×3 + py_compile 全部模块)
git diff --check:     PASS
```

覆盖要点：legacy/中文/空单元格/多 sheet/隐藏 sheet/空格 sheet/公式/合并/超链接；
threaded 单条/多条/中文/作者/时间/线程 ID/父线程 ID/回复链/混合；
Review 列与 Source Reference；无保护；Mapping V2；排序安全；新增列安全；
可见字段篡改不影响定位；Mapping 删除/篡改/重复 ID/版本不兼容/源 hash 不匹配均拒绝；
OOXML 保真；源文件不被修改；final 可重新打开；owner 隔离与删除。

## 14. Known Limitations

- 原生线程回复写回 **NO**（见 §11）；线程回复会明确上报为 skipped。
- 复杂 OOXML（图片/图表/数据透视/高级扩展）不保证全量保真；本模块只做最小补丁，不重建工作簿。
- 仅支持 `.xlsx`。
- 含重复 Review ID 且回复冲突会拒绝（同值去重）。
- 生产部署仍需人工执行 migration 001 并重启 PM2（本轮未做）。

## 15. Git Status

见下方 `git status --short` / `git diff --stat`（不 commit）。

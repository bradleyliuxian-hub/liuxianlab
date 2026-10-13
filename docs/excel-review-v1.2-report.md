# Excel Review Assistant V1.2 报告

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地 V1.2 完成，**未 commit / 未 push / 未 deploy / 未执行生产 migration**

## 1. Root Cause

- **为什么 V1.1 的 Original Value 会出现公式 / #VALUE!**
  V1.1 用同一个 `data_only=False` 的 openpyxl workbook 读取单元格值。对公式单元格，
  它返回公式字符串（如 `=B6+C6`）；对某类错误缓存则可能暴露 `#VALUE!` / `#REF!`。
  这些既不是用户想看的业务内容，也不是可靠数据。
- **当前如何读取显示值（V1.2）**
  parser 现在同时打开两个 workbook：
  - Formula workbook：`data_only=False` —— 用于结构、legacy 批注、styles、判断单元格。
  - Value workbook：`data_only=True` —— 用于 Original Value，取 Excel 保存的**缓存结果**。
  统一经 `normalize_display_value()`：
  - 非公式单元格 → 直接取实际值；
  - 公式单元格 → 取 data_only 缓存结果；
  - 缓存结果是 Excel error（`#VALUE!` 等）→ 输出空；
  - 无缓存结果（openpyxl 不计算公式）→ 输出空；绝不输出公式字符串。

## 2. Review Workbook 新结构

固定三表（不随数据动态增删）：

```
1. 新版批注     （可见）
2. 旧版批注     （可见）
3. _Mapping    （hidden）
```

### 新版批注（Microsoft 365 Threaded Comment + Threaded Reply）

```
A 类型 | B 原文件 | C Sheet | D Cell | E 原始值 | F 批注内容 | G 作者 | H 回复 | I 状态 | J Source Reference
K _ITEM_ID   （隐藏列，随整行排序移动）
```
类型取值：`新版批注` / `新版回复`。

### 旧版批注（Legacy Note / Comment）

```
A 类型 | B 原文件 | C Sheet | D Cell | E 原始值 | F 批注内容 | G 作者 | H 回复 | I 状态 | J Source Reference
K _ITEM_ID   （隐藏列）
```
类型取值：`旧版批注`。

两表：无保护、可编辑、header 冻结、合理列宽、批注/回复列自动换行。

### _Mapping（hidden，权威机器身份）

```
mapping_version, job_id, item_id, review_id,
source_sha256, source_filename,
comment_type, sheet_name, cell_address,
original_value, original_text, original_text_hash,
author, comment_datetime,
thread_id, parent_thread_id, person_id,
legacy_comment_hash, source_reference,
visible_sheet_name, visible_row_number,
mapping_token
```

## 3. ID / 时间隐藏方案

**从可见表移除（不再展示）**：Review ID、Item ID、Thread ID、Parent Thread ID、Person ID、
Comment Time / 创建时间、Job ID、Mapping Token、SHA256、各种 Hash、UUID。

**仍完整保留在 `_Mapping`**：上述全部字段 + identity + hash + token + source reference +
visible_sheet_name / visible_row_number。

**隐藏行身份 `_ITEM_ID`**：
- 两个可见表在最后一个可见列（Source Reference）之后追加隐藏列 `K = _ITEM_ID`。
- `column_dimensions["K"].hidden = True`，用户视觉看不到 ID。
- **排序安全**：用户排序整行时，隐藏的 `_ITEM_ID` 随该行一起移动。
- **筛选不影响**：openpyxl 读取全部行，不受筛选影响。
- **用户新增列不影响**：`_ITEM_ID` 按表头名定位，插入列导致其列位移动也能找到。

## 4. Formula / Value 处理规则

| 源单元格 | Original Value |
|---|---|
| 文本 `"合同编号 HT-2026-001"` | `合同编号 HT-2026-001` |
| 整数 `92000` | `92000`（数值，非文本、非 repr） |
| 小数 `50000.25` | `50000.25` |
| 日期 | `2026-10-13`（纯日期）；带时间则 `YYYY-MM-DD HH:MM:SS` |
| 布尔 `TRUE` | `TRUE` / `FALSE` |
| 空值 | 空 |
| 公式 `=B6+C6`，有缓存 `300` | `300` |
| 公式，缓存为 Excel error（`#VALUE!` 等） | 空 |
| 公式，无缓存（openpyxl 不计算公式） | 空 |
| 公式字符串 | **永不输出** |

- 不引入 LibreOffice / Excel COM / 公式引擎。
- 不新增公式列。
- 不修改 source.xlsx（只读缓存）。

## 5. Reply Import

- 上传后先校验 `_Mapping`：结构完整、`mapping_version == excel-review-mapping-v3`、
  token 重算一致、逐行 identity（cell/sheet/comment_type/original_text_hash）与源 SHA256 一致。
- 回复匹配使用**隐藏 `_ITEM_ID`**（不是可见列）：遍历 `新版批注`、`旧版批注` 两个可见表，
  按表头名找 `_ITEM_ID` 与 `回复` 列，用 `item_id → review_id` 回写。
- 排序后：`_ITEM_ID` 随行移动，因此仍正确定位；不依赖初始行号。
- 不会串位：真实 identity 来自 `_Mapping`（item_id + comment_type + sheet + cell + source hash）。
- 重复 `_ITEM_ID` 且回复冲突 → 拒绝；同值去重。
- 缺少 `_ITEM_ID`/`回复` 列、`_Mapping` 被删/被改 → 明确拒绝，不静默误写。

## 6. 修改文件列表

- `services/excel_review/parser.py` — 双 workbook 读取；`normalize_display_value`；`MAPPING_VERSION → v3`
- `services/excel_review/review_workbook.py` — 两表结构 + 隐藏 `_ITEM_ID` + Mapping V3 + 按 `_ITEM_ID` 读取回复
- `services/excel_review/worker.py` — 适配 `build_review_workbook` 返回 mapping rows
- `services/excel_review/tests/test_excel_review.py` — 全面改写（结构/隐藏/值/公式/回写/校验）
- `services/excel_review/tests/test_threaded_comments.py` — 适配新结构 + 拆表/双表回复/排序测试
- `server/excel-review/routes.js` — `/meta` 版本升级为 v3 + `reviewLayout: two-sheets`
- `private/tools/excel-review/index.html` — 说明文案更新（两表）

未改动：`services/excel_review/ooxml_*.py`（V1.1 线程解析）、`reply_writer.py`、`status.py`、
`server.js`、`config/tools.json`、contract 全部代码、`.env`。

## 7. Tests

```
Excel Review tests:   42 pass / 0 fail
Contract Review tests:135 pass / 0 fail
Node E2E (真实 threaded 文件): 10 项断言全通过
Syntax (node --check ×3 + py_compile): PASS
git diff --check: PASS
```

覆盖：两表固定存在、表头、Source Reference 为最后可见列、技术字段不可见但仍存于 mapping、
无保护、隐藏 `_ITEM_ID`；文本/整数/小数/日期/空值/布尔、公式缓存数值/缓存错误/无缓存；
新旧拆表、Threaded Reply 归入新版、legacy 归入旧版；排序不串位（5+5）、新增列、可见字段篡改；
Mapping 删除/篡改/版本不兼容/源 hash 不匹配/缺列/重复冲突；旧版回写回归；OOXML 保真回归。

## 8. Git

```
git status --short
 M AGENTS.md            (原有)
 M PROJECT_STATUS.md    (原有)
 M config/tools.json    (V1)
 M server.js            (V1)
?? server/excel-review/  ?? services/excel_review/  ?? private/tools/excel-review/
?? docs/excel-review-v1-report.md  ?? docs/excel-review-v1.1-report.md
?? docs/contract-speed-v1.1-*.md   (原有)

git diff --stat
 AGENTS.md | 4 ++--  PROJECT_STATUS.md | 54 +++---  config/tools.json | 18 +  server.js | 10 +
```
未 commit / 未 push / 未 deploy。

## 9. 已知限制

- openpyxl **不计算公式**：若源 Excel 未保存公式缓存（极少见，通常 Excel 保存过的文件都有），
  V1.2 会**留空**而不是输出公式或错误值。
- 原生 Threaded Reply 写回仍为 **NO**（V1.1 结论不变）；线程回复会明确上报为 skipped。
- 复杂 OOXML 高级对象不保证全量保真（只做最小补丁）。
- 仅支持 `.xlsx`。
- 生产部署仍需人工执行 migration 001 + 重启 PM2（本轮未做）。

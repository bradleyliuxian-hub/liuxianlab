# Excel Review Assistant V1.3 报告（Dashboard + Web 问题统计）

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地完成，**未 commit / 未 push / 未 deploy / 未执行生产 migration**
> 说明：本轮未触碰同工作区中用户的其他在研内容（`excel-decimal-check`、`private/vendor/xlsx`、`tests/`、`package.json`）。

## 1. Root cause / 当前原统计结构

V1.2 之前，`parser` 只输出 `items`，没有任何聚合统计；`extracted.json` 不含统计对象，Review 也没有汇总表，网页只显示"共生成 N 条批注"。因此：
- 用户必须下载 Excel 才知道问题总量；
- 网页无法显示新旧批注分布与作者分布；
- 也没有单一的"问题"口径。

本轮引入**单一 statistics 对象**，由 Python 计算一次，Web 与 Review Workbook 共同消费。

## 2. 实际新增文件

- `services/excel_review/statistics.py` — 统一统计模型 + 作者规范化 + 问题定义
- `services/excel_review/tests/test_statistics.py` — 统计/作者/问题口径/Web-Excel 一致性测试

## 3. 实际修改文件

- `services/excel_review/parser.py` — 使用 `normalize_author`；输出 `statistics`
- `services/excel_review/review_workbook.py` — 新增 Dashboard Sheet + Excel Table + 公式
- `services/excel_review/worker.py` — 传递 statistics；`item_count` 改为“问题数”
- `services/excel_review/__init__.py` — 导出 statistics
- `server/excel-review/routes.js` — `GET /:id` 返回 `stats`；meta 更新
- `private/tools/excel-review/index.html` — 新增分析结果 Summary；版本号与 cache-busting
- `private/tools/excel-review/script.js` — 渲染 Web Summary
- `private/tools/excel-review/styles.css` — Summary 样式
- `private/tools/excel-review/excel-review-history.js` — 历史显示“问题 N 个”
- `services/excel_review/tests/test_excel_review.py`、`test_threaded_comments.py` — 适配 Dashboard 首表

未改动：`server.js`、`config/tools.json`、OOXML 解析器、contract 全部代码、`.env`、DB schema。

## 4. statistics 数据模型

```json
{
  "questions_total": 28,
  "threaded_questions": 18,
  "legacy_questions": 10,
  "threaded_replies": 12,
  "authors_total": 5,
  "authors": [
    { "author": "Alice", "questions": 8 }
  ]
}
```
字段名沿用当前 Python 项目风格（snake_case）。`authors` 按 questions 降序、作者名升序稳定排序。

## 5. Question 定义

- Legacy Note / Comment = question
- Microsoft 365 Threaded **Root** Comment = question
- Microsoft 365 Threaded **Reply** ≠ question（只计入 `threaded_replies`，不计入问题总数、作者问题数）

来源：`statistics.is_question()` / `QUESTION_TYPES = ("legacy","threaded")`。

## 6. Dashboard 结构

Review Workbook Sheet 顺序：

```
1. Dashboard   （新增，第一张，无保护）
2. 新版批注    （Excel Table: tblThreadedReview）
3. 旧版批注    （Excel Table: tblLegacyReview）
4. _Mapping    （hidden，无保护）
```

Dashboard 顶部：标题、Source File（静态）、Generated At（静态）。
KPI：问题总数 / 已回答 / 未回答 / 回答率；问题类型（新版/旧版）；问题提出人数；按作者统计表。

## 7. Dashboard 公式

全部使用 Structured References，随本地 Reply 变化自动更新（`fullCalcOnLoad` 已开启）：

```
问题总数      = IFERROR(COUNTIF(tblThreadedReview[类型],"新版批注"),0)
                + IFERROR(COUNTA(tblLegacyReview[类型]),0)
已回答        = IFERROR(COUNTIFS(tblThreadedReview[类型],"新版批注",tblThreadedReview[回复],"<>"),0)
                + IFERROR(COUNTIF(tblLegacyReview[回复],"<>"),0)
未回答        = 问题总数 - 已回答
回答率        = IF(问题总数=0,0,已回答/问题总数)   (0.0%)
新版问题      = IFERROR(COUNTIF(tblThreadedReview[类型],"新版批注"),0)
旧版问题      = IFERROR(COUNTA(tblLegacyReview[类型]),0)
作者 问题总数 = IFERROR(COUNTIFS(tblThreadedReview[作者],A,tblThreadedReview[类型],"新版批注"),0)
                + IFERROR(COUNTIF(tblLegacyReview[作者],A),0)
作者 已回答    = IFERROR(COUNTIFS(tblThreadedReview[作者],A,tblThreadedReview[类型],"新版批注",tblThreadedReview[回复],"<>"),0)
                + IFERROR(COUNTIFS(tblLegacyReview[作者],A,tblLegacyReview[回复],"<>"),0)
作者 未回答    = 作者问题总数 - 作者已回答
作者 回答率    = IF(作者问题总数=0,0,作者已回答/作者问题总数)
```

- 作者姓名由 Python 写入（规范化空作者为“未知作者”、去重、排序）；数字全部为公式。
- `Answered` 完全由 Reply 是否非空决定，**不依赖 Status**。
- 所有公式用 `IFERROR` 包裹：当某张表不存在（该类批注为 0）时返回 0，不会出错。

## 8. Excel Table

- `新版批注` → `tblThreadedReview`
- `旧版批注` → `tblLegacyReview`
- ref = `A1:K{n}`（仅可见列；隐藏 `_ITEM_ID`（L 列）在表范围之外）
- 表样式 `TableStyleMedium2`，含 autofilter。
- 某类批注为 0 时不创建空表（Excel 要求表至少一行数据）；Dashboard 公式用 `IFERROR` 兼容。

## 9. Web UI

分析完成后在工具页显示：
- 共发现 N 个问题
- Microsoft 365 新版批注：X
- 传统批注 / Note：Y
- 问题提出人：Z
- 按问题提出人：每人问题数（列表）
- 下载 Review Excel

历史记录卡片显示“问题 N 个”。

## 10. API

- `GET /api/excel-reviews/:id`：在 job 上增加 `stats`（读取该 job 的 `extracted.json.statistics`）。
- `GET /api/excel-reviews`（history）：复用 DB 的 `item_count`（现为“问题数”）显示问题数。
- `GET /api/excel-reviews/meta`：`capabilities.reviewDashboard = true`，`reviewLayout = dashboard-two-sheets`。

## 11. Database

**No migration.** 未改 schema。统计明细存于 `extracted.json`；列表页复用现成的 `item_count`（语义改为“问题总数”）。未新增统计表。

## 12. Tests

```
Excel Review tests:   43 pass / 0 fail
Contract Review tests:135 pass / 0 fail
Node E2E (真实 threaded 文件): 13 项断言全通过
Syntax (py_compile + node --check ×5): PASS
git diff --check: PASS
```

覆盖：问题定义（root vs reply）、4 root/7 reply/5 legacy = 9、作者统计（Alice 5 / Bob 4 / Carol 不因回复计入）、空作者→未知作者、Unicode、排序、仅 reply 时为 0；Dashboard 首表/无保护/公式/表格/calc 设置；Web-Excel 一致性（stats == 表行数）；history 问题数；API stats；owner/delete/download 无回归。

## 13. Git

```
git status --short
 M AGENTS.md  M PROJECT_STATUS.md  M config/tools.json  M server.js  M package.json
?? server/excel-review/  ?? services/excel_review/  ?? private/tools/excel-review/
?? private/tools/excel-decimal-check/  ?? private/vendor/  ?? tests/
?? docs/excel-review-v1*.md  ...

git diff --stat
 AGENTS.md | 4  PROJECT_STATUS.md | 54  config/tools.json | 18  server.js | 10
```
（`package.json`、`excel-decimal-check`、`private/vendor`、`tests/` 为用户其他在研内容，未改动。）
未 commit / 未 push / 未 deploy。

## 14. 已知限制

- **网页无法得知用户下载后在本机 Excel 中填写的 Reply**。网页只显示源 Excel 分析即可确定的数据（问题总数、新旧分布、作者分布）；「已回答 / 未回答 / 回答率」只在 **Excel 内 Dashboard** 通过公式随本地 Reply 变化。不会恢复上传/回写来自动同步离线回答。
- Excel 公式由 Excel 打开时计算（openpyxl 不计算）；已设置 `fullCalcOnLoad`。文件名/作者若含 `*`、`?` 等通配符，COUNTIF 可能受影响（未做转义，属边界情况）。
- 仅支持 `.xlsx`；Original Value 仍不显示公式/错误值。

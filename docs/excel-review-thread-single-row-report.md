# Excel Review Assistant — 新版线程合并为单行 修复报告

> 日期：2026-10-13
> 状态：本地完成，**未 commit / 未 push / 未 deploy**

## 需求

新版（Microsoft 365 Threaded）批注：一个线程（主批注 + 若干回复）在 Review Excel 中
只能占 **一行**；回复内容放入该行问题的 **「回复」列**，而不是每条回复各占一行（不再是三行）。

## Root Cause

`review_workbook.build_review_workbook` 之前把线程的 root 与每一条 reply 都当作独立可见行
写入「新版批注」表（`threaded_items = root + threaded_reply 全部`），且「回复」列恒为空。
因此一条 root + 2 replies 会显示成 3 行。

## 修改

- `services/excel_review/review_workbook.py`
  - `_write_visible_sheet(..., reply_text=None)`：新增 `reply_text` 参数，把「回复」列写为
    该行线程的合并回复文本。
  - `build_review_workbook`：
    - 「新版批注」表只写 **threaded root**（每个线程一行）；不再写 `threaded_reply` 行。
    - 以 `rootThreadId` 归组，把同线程全部回复文本用换行 `\n` 合并，写入 root 行的「回复」列。
    - `_Mapping` 只保留可见行（root + legacy）的映射；回复作为 root 的合并内容，无独立行。
- `services/excel_review/tests/test_thread_status.py`：新增
  `TestThreadSingleRow`（合成线程 = 1 行 + 回复合并；真实文件每线程 1 行）。

未改动：parser（回复仍被完整提取进 `extracted.json`，不丢失）、statistics（回复本就不计为问题）、
`server/excel-review/*`、contract、DB schema。

## 真实文件结果（threaded_status_real.xlsx）

```
新版批注 表数据行 = 3（D4 / F4 / B5），此前为 6
  D4  新版批注  pending   回复='测试过了，是有的\n回复有效吗，能测出来吗\n再测一下'   （root + 3 回复合并为一行）
  F4  新版批注  completed 回复=None
  B5  新版批注  pending   回复=None
```

「旧版批注」表：每条 legacy note 仍各占一行，「回复」列为空。Dashboard 仍为第一张表、无保护。

## 影响说明（重要）

- 线程回复现在位于「回复」列。按既有规则「已回答 = 回复列非空」，因此**源文件中本来就有
  回复的线程，其 Excel Dashboard 会显示为“已回答”**（例如上面的 D4）。这是该需求的直接结果。
- 「问题总数 / 新版 / 旧版」不受影响（回复不参与问题计数）。
- 网页统计仍只基于源文件可确定的数据，不显示“已回答”。

## 测试

```
Excel Review tests:   60 pass / 0 fail
Contract Review tests:135 pass / 0 fail
py_compile / node --check / git diff --check: PASS
```

新增/覆盖：单线程 root + 多回复 → 1 行且回复合并；真实文件 D4/F4/B5 各 1 行；状态与关闭语义不变。

## Git

```
git status --short
 M AGENTS.md  M PROJECT_STATUS.md  M config/tools.json  M server.js
?? services/excel_review/  ?? server/excel-review/  ?? private/tools/excel-review/  ?? docs/excel-review-*.md
```
未 commit / 未 push / 未 deploy。

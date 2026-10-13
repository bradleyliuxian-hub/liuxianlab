# Excel Review Assistant — Threaded Comment 状态修复报告

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地完成，**未 commit / 未 push / 未 deploy**

## 1. Root Cause

不是"读了 done 但 writer 猜错"，而是**两处叠加**：

1. **`docs/../review_workbook.py`：`_write_visible_sheet` 把「状态」列硬编码为 `"pending"`**
   （`values = [..., "", "pending", ...]`），无论来源如何。
2. **`ooxml_threaded_comments.py` 对 `done` 的判断只支持 `=="true"`**
   （`(node.get("done") or "").lower() == "true"`）：真实 Excel 写的是 `done="1"`，因此被判为 False。
   而且该值**没有被 parser 带走**：`parser._extract_threaded_items` 未保留 `done`，
   `extracted.json` 里也没有任何 `resolved/status` 字段。

数据链因此断裂：

```
OOXML threadedComment.done  ->  被读但"1"判错 & 未传出  ->  item 无状态  ->  Review 写死 pending
```

## 2. 实际 OOXML 差异（真实文件）

对比同一真实文件中的两类会话（`xl/threadedComments/threadedComment1.xml`）：

```
未关闭 / unresolved（D4 线程 root + 3 replies，B5 root）:
    <threadedComment ref="D4" ... id="{E409...}">          ->  没有 done 属性
    <threadedComment ref="D4" ... parentId="{E409...}">     ->  没有 done 属性

已关闭 / resolved（F4，先批注后直接 Resolve，无回复）:
    <threadedComment ref="F4" ... id="{712F...}" done="1">   ->  done="1"
```

结论：Excel 在 **root** 节点上写 `done="1"` 表示 resolved；未关闭时**不写** `done`；回复节点不带 `done`。

## 3. 修改文件

- `services/excel_review/ooxml_threaded_comments.py` — 新增 `parse_done()`（1/true/yes/on→True；0/false/no/off/缺失/未知→False），节点输出 `resolved` + `doneRaw`。
- `services/excel_review/parser.py` — 线程条目保留 `resolved/doneRaw`；新增 `normalize_thread_status()`（建 id→node、找 root、把 root resolved 传播到全部后代，含环/缺失父节点保护）；item 输出 `resolved`、`status`、`rootThreadId`。
- `services/excel_review/review_workbook.py` — 「状态」列写 `item["status"]`（不再硬编码 pending）；`_Mapping` 增加 `resolved`、`status`。
- `services/excel_review/tests/threaded_fixture.py` — 支持注入 `done` 属性。
- 新增 `services/excel_review/tests/test_thread_status.py` — 状态解析/传播/真实文件测试。
- 新增 fixture `services/excel_review/tests/fixtures/threaded_status_real.xlsx`（真实文件脱敏副本，保留 `done="1"`）。

未改动：`server.js`、`config/tools.json`、`server/excel-review/*`、contract 全部、`.env`、DB schema。

## 4. 新状态规则

```
Legacy Note / Comment        -> pending（不变）
Threaded root, 无 done        -> pending
Threaded root, done=1/true    -> completed
Threaded reply                -> 继承所属 root 的 resolved
                                 （通过 parentId 链找到 rootThreadId）
孤立 reply（父节点缺失/环）    -> 保守判 pending，且不误归其它线程，不崩溃
```

- 状态是**线程级**：同一 conversation 的 root 与全部 replies 状态一致。
- 已 resolved 的会话**不会被过滤**，仍完整进入 Review。
- 内部使用布尔 `resolved`，用户可见 `Status` 仅 `pending` / `completed`。
- 不依赖"是否有回复"、不依赖作者/时间/文本推断；不使用 Status 反写源线程。

## 5. Tests

```
Excel Review tests:   58 pass / 0 fail
Contract Review tests:135 pass / 0 fail
py_compile:           PASS
node --check:         PASS
git diff --check:     PASS
```

新增覆盖（含任务要求的 15 项）：done 缺失/0/false→pending；1/true→completed；
无回复但 resolved→completed；root+多 replies 未关闭→全 pending；root+多 replies 已关闭→全 completed；
两线程不同状态不串；同/不同 cell 多线程各自正确；legacy 不受影响；Review 状态列正确；
extracted.json resolved/status 正确；resolved 会话仍出现；孤立 reply 不崩溃不误归。

## 6. 真实端到端结果

对真实文件（`threaded_status_real.xlsx`：D4 线程 root+3 replies、F4 resolved、B5 未关闭）运行 worker：

```
新版批注  cell=D4  type=新版批注  status=pending
新版批注  cell=D4  type=新版回复  status=pending
新版批注  cell=D4  type=新版回复  status=pending
新版批注  cell=D4  type=新版回复  status=pending
新版批注  cell=F4  type=新版批注  status=completed   <- 无回复但已 Resolve
新版批注  cell=B5  type=新版批注  status=pending
旧版批注  状态 = pending
Sheet 顺序: Dashboard / 新版批注 / 旧版批注 / _Mapping
```

即：

```
Unresolved thread        = pending
Resolved thread (no reply) = completed
Resolved thread replies  = completed
```

## 7. Git

```
git status --short   （本节为当前工作区状态）
git diff --stat
```
未 commit / 未 push / 未 deploy。

## 已知限制

- 仅识别真实 `done` 语义；若某第三方工具用非标准布尔写 `done`，按 0/false/未知 处理为 pending。
- 用户下载后在本机对 Review「状态」列的手工修改不会回写源线程（本轮不实现该能力）。

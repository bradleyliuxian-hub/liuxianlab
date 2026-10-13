# Excel Review Assistant V1.2 收口报告（Excel Address + 取消自动回写）

> 日期：2026-10-13
> 项目：Liuxian Lab (`~/AI-Workspace/projects/liuxianlab-online`)
> 状态：本地完成，**未 commit / 未 push / 未 deploy / 未执行生产 migration**

## 1. 产品流程变化

```
旧流程：source.xlsx → review.xlsx → 上传已填回复 → 后台写回 → final.xlsx
新流程：source.xlsx → review.xlsx → 下载 → 人工查看 / F5 定位
```

Excel Review Assistant 现在是「Excel 复核意见抽取与定位工具」，不再回写原文件：
- 取消：回复上传、自动写回、final.xlsx 生成、Reply import、Final 下载。
- 保留：批注提取、新版/旧版批注、Threaded Reply 读取、Original Value、Source Reference、Excel F5 Address、Review Excel 的 Reply/Status 工作列。

## 2. Excel Address 实现

- helper：`services/excel_review/parser.py::format_excel_address(sheet_name, cell_address)`
- 规则：始终给 Sheet 名加单引号；单引号按 Excel 规则转义 `'` → `''`；输出 `'<sheet>'!<cell>`；写入时作为**文本**（不是公式、不是超链接）。
- 示例：
  - `'Sheet1'!A1`
  - `'财务复核'!B5`
  - `'Sheet With Space'!D5`
  - `'Manager''s Review'!C7`
  - `'隐藏数据'!B2`
- 位置：可见表 **G 列，紧跟在「批注内容」之后**；Source Reference 仍是最后一列（K）。
- Threaded Reply 与其父批注同 cell → Excel Address 相同（F5 定位的是单元格）。
- 同步写入隐藏 `_Mapping` 的 `excel_address` 列。

## 3. Review Excel 最终列结构

Workbook 固定三表：`新版批注` / `旧版批注` / `_Mapping`(hidden)。

新版批注：
```
A 类型 | B 原文件 | C Sheet | D Cell | E 原始值 | F 批注内容 | G Excel Address | H 作者 | I 回复 | J 状态 | K Source Reference
L _ITEM_ID（隐藏列）
```
旧版批注：完全相同的列结构。
- 类型：新版批注 / 新版回复 / 旧版批注。
- Source Reference 为最后一个**可见**业务列；`_ITEM_ID` 为其后的隐藏列。

## 4. 自动回写移除情况

- 删除的 API：`POST /api/excel-reviews/:id/replies`、`GET /api/excel-reviews/:id/final-file`（现返回 404）。
- 删除的 UI：上传已回复 Review 的拖拽区、写回按钮、Final 下载面板；History 中的「下载 Final」；回复进度/等待/最终文件相关文案。
- 删除的 Python 逻辑：`run_apply`、apply 分支、`validate_and_read_replies`、`_read_sheet_replies`。
- `reply_writer.py`：**已删除**（其唯一职责是写回 + 生成 final）。
- final.xlsx：**不再生成**；worker 只产出 `review.xlsx` 与 `extracted.json`（source.xlsx 仍保留在私有目录）。
- job 状态：生成 review 后即 job 完成（`review_ready`）。`applying_replies`/`completed` 不再产生（DB CHECK 保留旧值以兼容历史数据，未做 destructive 变更）。

## 5. 保留能力

- Microsoft 365 Threaded Reply **抽取**仍保留（主批注/回复链/作者/时间/线程 ID → 全部进入新版批注）。
- Review Excel 中 **「回复」「状态」列仍保留**，供用户本地自行维护；后台不读取、不校验、不导入。
- 隐藏 `_Mapping` 仍保留（追溯 / 审计 / item identity / source identity / threaded identity）。已新增 `excel_address`。为回写服务的读取逻辑已移除；旧的 stable 字段（含 visible_row_number）保留，未做大规模重构。

## 6. 修改文件

- `services/excel_review/parser.py` — 新增 `format_excel_address` + item `excelAddress`
- `services/excel_review/review_workbook.py` — 新增 Excel Address 列 + `_Mapping.excel_address`；移除 reply-import 读取逻辑
- `services/excel_review/worker.py` — 仅保留提取；移除 apply
- `services/excel_review/status.py` — 移除 apply/reply_count 状态
- `services/excel_review/reply_writer.py` — **删除**
- `services/excel_review/__init__.py` — 更新导出与说明
- `server/excel-review/routes.js` — 删除 replies/final-file 路由；publicJob 精简；meta 更新
- `server/excel-review/parse-runner.js` — 去掉 phase/apply/final
- `server/excel-review/repository.js` — claimJob 简化（固定 extract）
- `private/tools/excel-review/index.html`、`script.js`、`excel-review-history.js` — 移除回写相关 UI
- `services/excel_review/tests/test_excel_review.py`、`test_threaded_comments.py` — 删除回写测试，新增 Excel Address 测试

未改动：`server.js`、`config/tools.json`、`ooxml_*.py`、contract 全部代码、`.env`、DB migration。

## 7. 测试

```
Excel Review tests:   28 pass / 0 fail
Contract Review tests:135 pass / 0 fail
Node E2E (真实 threaded 文件): 11 项断言全通过
Syntax (node --check ×5 + py_compile 全部): PASS
git diff --check: PASS
```

Excel Address 语法单测覆盖：英文 / 中文 / 空格 / 单引号转义 / 隐藏 Sheet / 空值；每行可见记录均有非空 Excel Address；threaded reply 与其父批注地址一致。

## 8. Git

```
git status --short
 M AGENTS.md  M PROJECT_STATUS.md  M config/tools.json  M server.js   (前两者为原有)
?? server/excel-review/  ?? services/excel_review/  ?? private/tools/excel-review/
?? docs/excel-review-v1*.md

git diff --stat
 AGENTS.md | 4  PROJECT_STATUS.md | 54  config/tools.json | 18  server.js | 10
```
未 commit / 未 push / 未 deploy。

## 9. 已知限制

- Excel Address 是「工作表 + 单元格」定位：用户需先**打开对应的原始 Excel**，再按 `F5` / `Ctrl+G` 粘贴地址跳转；它不包含文件路径（路径在不同电脑上不可靠）。
- 若某条批注数据本身没有 cell（异常数据），不会伪造地址（该行 Excel Address 为空）。
- 仅支持 `.xlsx`。
- Original Value 仍不显示公式/错误值；无可靠缓存时留空（openpyxl 不计算公式）。

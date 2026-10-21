# Project Status

Updated: 2026-10-21

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`
- HEAD：`28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- 工作区：dirty 19 项（11 个已跟踪文件修改 + 8 个未跟踪目录/文件）。
- 既有 dirty 改动未清理；本轮未 reset / clean / stash / checkout / restore / commit / push。

## Current Focus

**Flowchart-to-Excel 已暂停 / 封存，网站标记 Coming Soon。**

- 状态：`PAUSED / ARCHIVED`
- 工具：`flowchart-excel`
- 配置状态：`coming-soon`
- `exportReady=false`；`edit_as=pending`
- 不再继续修复 Golden Fixture、connector、布局、样式或导出器。
- 不再进入 connector spike / V5 / V6。

封存档案：

```text
docs/agent/flowchart-excel/archive/PROJECT-ARCHIVED.md
docs/agent/flowchart-excel/archive/ARTIFACT-INDEX.md
docs/agent/flowchart-excel/archive/coming-soon-rollback.md
docs/agent/flowchart-excel/archive/coming-soon-validation-report.md
```

## Coming Soon 状态

- 工具卡片显示 `Coming Soon`。
- 流程图入口页显示“功能暂未开放，当前版本正在封存评估中”；上传/历史/新建入口隐藏。
- 复核页为只读 Coming Soon；保存/完成复核/批量复核/导出按钮禁用。
- 后端写接口返回 `503 FEATURE_COMING_SOON`：
  - `POST /api/flowchart-excel/jobs`
  - `POST /api/flowchart-excel/jobs/import-helper-package`
  - `PUT/POST /review/*` 写操作
  - `POST /export-xlsx`
  - `POST /cancel`
- 历史任务只读查询/下载、owner 隔离、artifact allow-list 保留。
- 8080 **未重启**；线上是否加载新状态未确认，需维护窗口重启。

## Known Broken / Unresolved

- Golden Fixture 原始 XLSX 在 Excel 中触发修复提示；包结构修复版已生成，但 **Mac/Windows Excel 均 NOT RUN**。
- V4 大图布局、connector runtime、泳道/图例/控制标记、模板样式仍未通过视觉 QA。
- 打印可读性未定版（10pt × 48% ≈ 4.8pt；A3 高度余量约 0.9pt）。
- Windows Excel 对目标业务规模候选验收缺失。
- `edit_as=pending`；正式 `exportReady=false`。
- V4 / layout / Golden Fixture 代码位于 `~/AI-Workspace/tools/`，不在网站 Git 仓库内。
- 本机 LibreOffice 未渲染 Microsoft YaHei UI 中文字形，预览不能替代 Excel。

## Last Verification

- 2026-10-21 Coming Soon 后：
  - `node --test tests/flowchart-excel/*.test.js` = **123 pass / 0 fail**
  - `npm test` = **408 pass / 0 fail**
  - `services/flowchart_excel` Python = **14 tests OK**
  - `GET /health` = `{"ok":true}`
- 2026-10-21 Golden Fixture：
  - .NET 19 pass；Node schema 5 pass；Python 6 OK；
  - static validation 73 PASS；package audit 38/38 PASS；Open XML SDK 0 errors。
- 历史：Slice 5.1 旧 anchor 候选 Mac A/B 58/58 PASS；V2–V4 视觉 QA FAIL；Windows NOT RUN。

## Pending Decision

- 是否永久放弃，或未来重新进入开发。
- 若恢复：先阅读封存档案，再按 `coming-soon-rollback.md` 恢复状态；不得直接打开正式导出。

## Next Action

- 当前不继续开发。
- 可选人工验证（仅在决定恢复时）：按 `golden-fixture-manual-acceptance.md` 在 Mac/Windows Excel 打开修复版 Golden Fixture，确认无修复提示后再决定是否进入 Phase 2。
- 生产维护窗口：重启 8080 后确认 `config/tools.json` 的 Coming Soon 和写 API gate 已加载。
- 未删除代码/数据；未生成 XLSX；未调用 AI；未改数据库。

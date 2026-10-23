# Project Status

Updated: 2026-10-23

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`；工作区：clean（v1.3.3 Export Preview Workspace 已提交；详见本文件末尾 Git 记录）。
- 生产：未部署；未改生产数据库。

## Current Focus

**序时账分析 v1.3.3：导出数据预览工作台已完成（拆分 / 单文件 / 批量合并）；生产部署仍未执行。**

- 单文件：upload → inspect → mapping/preview → worker → result → voucher detail → export/history。
- 拆分：筛选 → 拆分方式 → 导出数据预览（真实表格 + 列选择 + 行排除）→ 分组预览 → Excel/ZIP。
- 行身份：`job_id + internal_line_key`；默认 `all_except`，只保存被排除行；显式行上限 5,000。
- 预览表格：服务器分页 25/50/100/200；浏览器不下载完整结果；列勾选即时反映到表格。
- 排除行后实时重算保留行、凭证数、分组、分组借贷合计与空白列统计。
- 修改筛选清空手工行选择并提示；修改拆分维度/输出方式保留行选择；模板不保存行身份。
- 单文件与批量合并新增“标准序时账导出预览”，支持查看、选列、排除行、导出。
- 生成快照保存 selected_columns / column_order / row_selection_mode / excluded_rows /
  included_rows / candidate_line_count / final_line_count。
- 全局 16 KB JSON 限制仅对预览/导出 POST 路由放行，路由内使用 2 MB 解析。
- 计算语义未改：Reader / Mapping / Normalize / Business / Contra / Anomaly / 拆分组语义。
- Flowchart-to-Excel 仍为 PAUSED / Coming Soon。

## Known Broken / Unresolved

- 生产部署与迁移 **NOT RUN**；`002`–`006` 尚未应用到生产库。
- 完整“分析报告”中的标准序时账 Sheet 仍使用原列集；按报告配置列/行暂只在新标准序时账导出工作台提供。
- 300k 导出预览未重新压测；100k 服务端单次预览约 2.4–2.6 s。
- 批量拆分预览已支持行排除，但浏览器 E2E 覆盖的是批量导航；批量跨文件行排除由 Python 测试覆盖。
- 本机未启动常驻 8080；未做生产 PM2/Nginx 检查。
- 生产环境 cleanup 未执行；本机仅执行 dry-run。

## Last Verification

- 2026-10-23 Export Preview Workspace：
  - Journal Entry Python **271 pass / 0 fail**；Excel Review Python **79 pass / 0 fail**。
  - npm test **475 pass / 0 fail**；smoke **PASS**；compileall / git diff --check **PASS**。
  - browser E2E **PASS**（1440、1366×768、1920×1080）：行排除/恢复、筛选重置、导出不含排除行、
    标准序时账预览排除行后导出行数减一；console/pageerror/404 = 0。
  - 100k synthetic：首屏 2.58 s、第 2 页 2.46 s、排除并重算 2.39 s；浏览器仅拿当前页。
  - Excel 手工/程序检查：列与网页选择一致、排除行不存在、空列未导出、中文表头、金额/日期格式正确。
  - 生产仍未部署。
- 2026-10-22 Export Columns：263 Python / 468 npm / E2E PASS。
- 2026-10-22 Phase 5B.1：大结果分页与懒加载基线保持。

## Pending Decision

- 是否进入生产部署窗口；部署前必须执行 `002`–`006` migrations，保持 PM2 单实例。
- 300k 预览性能与 Nginx 超时需在生产配置下确认。
- 是否把“完整分析报告”的标准序时账 Sheet 也接入列/行设置（当前为 P2）。

## Next Action

- 若继续开发：P2 完整分析报告导出设置 → 批量管理页的合并预览入口视觉优化。
- 若上线：先做部署 preflight，再在生产窗口应用 002–006 migrations，确认 PM2 fork/单实例、
  Nginx 100 MB 上传 / 600 s 输出超时、磁盘与 RAM 余量。
- 部署后在真实登录浏览器复核批量工作台、拆分预览、标准序时账预览与 v1.3.3 更新说明。

## Git Record

- 本次 release 提交：见 `git log -1`（v1.3.3 Export Preview Workspace）。
- 上一 release：`f437782dce2ed87797cb5e3e9f02c76d834473a2`。

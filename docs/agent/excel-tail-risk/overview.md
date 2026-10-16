# excel-tail-risk / overview

Excel 尾差风险检查 (`/tools/excel-decimal-check`): find cells whose ACTUAL value
has more than two decimals and grade them by *tail risk* — a finder, not a fixer.
Browser-local.

- 只发现，不修改；源文件永不被改写。下载项：问题清单（6 表）+ 标黄对比副本（最小 OOXML 补丁，共享 highlighter）。
- 类别：普通数值 / 公式结果 / 公式不可判定 / 隐藏区域（可选扫描）/ 百分比（独立分类）/ 汇率（独立分类 + 单独 Sheet）。
- 业务类型：`normal_number`(2 位) / `exchange_rate`(4 位) / `suspected_exchange_rate`(不豁免) / `percentage`。汇率按上下文识别（见 `business-type.md`），不靠数值范围。
- 风险分级：高 / 中 / 低 / 单独观察；同一风险等级内按**下游引用数**（去重的可达节点数）降序，其次直接引用数。
- 引用分析：真实正向依赖图 + 直接引用数 + 下游可达数（去重、循环安全、跨表）。
- Skill: `.opencode/skills/excel-tail-risk/`.
- Modules: `decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、`decimal-workbook.js`。

Authority / deep detail: `private/tools/excel-decimal-check/DEVLOG.md` + code.

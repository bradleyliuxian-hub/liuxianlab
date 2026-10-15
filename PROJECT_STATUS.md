# PROJECT STATUS

## Current Goal
`excel-hardcode-check` 精度优化（第三轮）：ROUND 千元/万元换算豁免、ROUND 主体外人工尾差（ROUNDING_PLUG）强化、输入/数据列抑制。不新增规则框架。

## Current Task
完成 UNIT_CONVERSION 豁免、HC006 无邻居兜底、HC101/HC103 数据列抑制；全部单测与压力回归通过。未 commit / 未 push / 未部署。

## Completed
- **UNIT_CONVERSION（HC204 收敛）**：ROUND/ROUNDUP/ROUNDDOWN/ROUNDBANK/MROUND 的值参数中经 `*`/`/` 的 `1000/10000/...` 视为正常公共换算常量（非死数、非高风险证据）；ROUND 位数参数 `0/2` 仍为控制参数。独立 `A1/1000` 仍 HC204。
- **HC006 ROUNDING_PLUG**：ROUND 主体之外的小额 `+/-` 常量（±0.01/0.02、±1..±5）标记为 ROUNDING_PLUG。左右/上下同类公式一致且仅当前格额外出现 → HIGH；无邻居或单侧 → 至少 SUSPICIOUS；不因金额小而忽略。
- **HC101 收紧**：crossing run 命中时，若正交轴为纯数据列（两侧均为非公式且存在）→ 不报。
- **HC103 收紧**：横向 formula run 右侧的固定值，仅当其所在列也含公式时视为断点；否则按数据/结果列处理不报（修复正交空格导致的漏抑制）。
- **HC104**：保持退役（无触发路径）。

## Pending
- 真实样本人工标注 → precision；是否 commit / push。

## Changed Files
- 工具：`private/tools/excel-hardcode-check/{formula-parser.js,formula-pattern.js,hardcode-core.js}`（工作簿/前端未见行为回归）。
- 测试：`tests/excel-hardcode-check/{formula-parser.test.js,formula-pattern.test.js,hardcode-core.test.js}`（新增 12 用例）。
- `PROJECT_STATUS.md`。（未跟踪工具/测试/benchmark 仍在工作区。）

## Verification
- `npm test`：111 pass / 0 fail（含压力回归 43/22/28、15/3/25 基线，未改夹具、未改规则 ID）。
- Vision Star：173 → 161（HIGH 48→48 / SUSP 26→34 / NOTICE 99→79）。
  - HC204 17→0；HC006 41→51（28 HIGH / 23 SUSP）；HC103 9→7（数据列 X100/X101 抑制）；HC201 72→69（3 条 `/1000` 常量转 HC006）；HC101 2→2。
- 报告：`~/Downloads/【NEW】23-26331 Spreadsheet_Vision Star_死数检查报告_v3.xlsx`（已回读校验）。

## Known Issues
- HC006 无邻居兜底为 SUSPICIOUS，量大时需人工批量确认（本轮 Vision Star 新增 10 条）。
- HC101 在 Vision Star 的 2 条均为公式列硬编码打断，倾向为真，未再收紧。
- 整行范围 `1:1`、复杂数组常量、动态数组未支持（v1 跳过）。

## Git State
- branch: main；HEAD `51036b8`（tag `liuxianlab-v1.1.0`）；origin/main 同步。
- dirty：`config/tools.json`、`package.json`、`PROJECT_STATUS.md`；未跟踪 `private/tools/excel-hardcode-check/`、`tests/excel-hardcode-check/`、`scripts/local/hardcode-benchmark.js`。

## Deployment Impact
- 纯前端静态资源 + 工具配置；无 server.js 改动、无依赖、无 migration；PM2 无需重启。

## Next Action
- 人工复核 v3 报告（重点 HC006 ROUNDING_PLUG）；仅对可复现模式做受控调参，保持 111 测试全绿。等待人工审核：不 push、不部署。

## Session Log
- 2026-10-15：UNIT_CONVERSION + HC006 兜底 + HC101/HC103 数据列抑制；npm test 111 pass；Vision Star 重扫 161 条并生成 v3 报告。

## Last Updated
2026-10-15

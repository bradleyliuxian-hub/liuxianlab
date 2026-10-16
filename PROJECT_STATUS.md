# Project Status

Updated: 2026-10-16

> 简短当前状态快照。每次覆盖；不写历史、不写 diff、不写 secret。
> 事实源是真实仓库 + Git；若本文件与之冲突，以 Git 为准。

## Git

- 分支：`main`（查询：`git branch --show-current`）
- HEAD：`ffb2935`（查询：`git rev-parse --short HEAD`）
- 工作区：干净（已全部提交并推送至 `origin/main`）。
- 已上线内容：本地 pre-push 检查器；Excel 标准化修复（解释器回落 `.venv`、
  中文文件名乱码 `defParamCharset:utf8`+`repairMojibake`）与后端迁移
  （`server/excel/`→`server/excel-standardizer/`、`workers/excel/*`→`services/excel_standardizer/*`）。
- 部署踩坑：新增 `services/excel_standardizer/requirements.txt` 触发服务器 deployer 的
  DEPENDENCY CHECK（任何 Python 依赖清单变更需人工评审）→ 已移除（openpyxl 已由
  `workers/excel/requirements.txt` 声明）。见 `docs/agent/deployment.md` 部署不变量。

## Current Focus

1. 「本地 pre-push / pre-deploy 检查器」（DEV TOOLING）：与生产部署器同源，本地提前
   拦截 `git diff --check`（trailing whitespace / EOF 空行）、Node/Python 语法、敏感文件；
   默认 QUICK，`--full` 条件回归。任何 push（含「上传github」）前必须先跑
   `scripts/local/pre-push-check.sh`（AGENTS.md §10，`/publish`）。
2. Excel 标准化：修复“无法运行”（默认 `python3` 无 openpyxl → 现回落 `.venv/bin/python`，
   与 excel-review 一致）；后端迁移到 `server/excel-standardizer/` + `services/excel_standardizer/`
   以对齐 excel-review 布局。前端 `private/tools/excel-standardizer/` 不变；
   `config/excel_profiles/` 暂留原位。修复上传文件名乱码（multer `defParamCharset:'utf8'`
   + `server/excel-standardizer/encoding.js` 的 repairMojibake，与 excel-review 同源）。

## Known Broken

- 应用层无已确认问题（标准化已完成端到端验证）。
- Workspace 根 `~/AI-Workspace` **不是** Git 仓库 —— 绝不要从根目录运行项目 git 命令。

## Pending Decisions

- 是否提交并推送以上改动（等待用户确认）。
- `config/excel_profiles/` 是否一并移入服务目录（现暂留）。
- 生产服务器 `.venv` 是否含 openpyxl（本地已确认；生产 `.env` 受保护未读，UNVERIFIED）。

## Next Action

1. 等待用户审查标准化迁移与运行时修复。
2. 确认后通过 `/publish` 提交并推送（先跑 `scripts/local/pre-push-check.sh`）。

## Last Verification

- 标准化修复：worker 端到端（隔离任务目录）从 `ModuleNotFoundError` 失败 → `completed`
  （总修改 7~8 项）；新路径 `server/excel-standardizer/jobs.js` 调度成功。
- 服务器可启动，`/health`=200，`/api/excel/meta` 需鉴权（302→/login）。
- `npm test` = 216 pass / 0 fail；`node --check` 3 个 JS 通过；
  `scripts/local/pre-push-check.sh` QUICK PASSED（12 个 Python 语法检查通过）。
- 文件名修复：raw UTF-8 中文文件名上传后 `originalName`/`outputName` 正确
  （`测试_报价表 …-standardized.xlsx`），任务 `completed`；旧乱码串 repair 往返 OK。

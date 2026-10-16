# Project Status

Updated: 2026-10-15

> 简短当前状态快照。每次覆盖；不写历史、不写 diff、不写 secret。
> 事实源是真实仓库 + Git；若本文件与之冲突，以 Git 为准。

## Git

- 分支：`main`（查询：`git branch --show-current`）
- HEAD：`e715557`（查询：`git rev-parse --short HEAD`）
- 工作区：未提交的治理/文档改动（`PROJECT_STATUS.md`、
  `docs/agent/deployment.md`、`docs/agent/deployment/runbook.md`）；无业务代码。
  查询：`git status --short`。

## Current Focus

Workspace 与 AI/OpenCode 治理已收口；项目控制面稳定，可恢复常规开发。

- Active skills（恰好 7）：`repo-inspector`、`development-task`、
  `contract-review`、`excel-review`、`excel-tail-risk`、`excel-hardcode`、
  `deployment-safety`。
- Workspace 基线记录在 `~/AI-Workspace/WORKSPACE_RULES.md`
  （workspace 根不是 Git 仓库；一个项目一个仓库）。
- Contract Review v1.1 知识在 `docs/agent/contract-review/quality-and-cache.md`；
  原始报告在 `docs/archive/contract-review/`。

## Known Broken

- 应用层无已确认问题。
- Workspace 根 `~/AI-Workspace` **不是** Git 仓库 —— 绝不要从根目录运行项目 git 命令。

## Pending Decisions

- 重启 OpenCode（配置类改动不会热加载）。
- 路由验证（一次真实的 bug / feature / review / deploy 请求）—— 尚未运行；状态 UNVERIFIED。
- Deploy 脚本 invariant 已提炼进 `docs/agent/deployment*`；归档脚本仅为参考
  （不是已确认的当前 deployer）。

## Next Action

1. 恢复本项目常规开发。
2. 未经明确批准，不要 push / deploy。

## Last Verification

- 治理收口：workspace 根不是 Git 仓库；项目在 `e715557` clean；恰好 7 active
  skills / 5 agents / 9 commands；`git diff --check` clean。本轮未跑业务测试
  （未改业务代码）。
- 文档语言：本次治理涉及的文件已改为中文（`WORKSPACE_RULES.md`、
  `shared-skills/README.md`、本文件、`deployment.md`/`runbook.md` 的新增段落）。

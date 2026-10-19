# Project Status

Updated: 2026-10-19

> 简短当前状态快照。每次覆盖；不写历史、不写 diff、不写 secret。
> 事实源是真实仓库 + Git；若本文件与之冲突，以 Git 为准。

## Git

- 分支：`main`（查询：`git branch --show-current`）
- 代码提交：`da80aff`（parser-selection 抽取 + 安全测试）；HEAD 以
  `git rev-parse --short HEAD` 为准。
- 工作区：本 status 提交后应为干净；查询：`git status --short`。
- 本地 `.env` 已配置 `MINERU_API_TOKEN_ENCRYPTION_KEY`（32 字节 hex；值未输出、
  未进入 Git）；本地 Node 已重启并识别为 configured；**生产 `.env` 未修改**。
- 本地 dev DB（127.0.0.1/liuxianlab）已应用 migration 004；**生产未执行**。
- 未连接生产服务器；本次仅 commit/push GitHub；生产部署 / PM2 / 生产 `.env` 未操作。

## Current Focus

1. 合同审阅上传页新增「解析引擎」Local/Cloud（默认 Local），与
   AUTO/FAST/ACCURATE 独立；后端按 `contracts.parse_backend_requested`
   逐任务执行，不再依赖全局环境切换。
2. 云端 Token 优先级：本次任务 Token（AES-256-GCM 存入
   `contract_credentials`）→ 服务器 `MINERU_API_TOKEN` → 拒绝。
3. 已排查“未配置凭证加密密钥”问题：根因为本地 `.env` 缺少
   `MINERU_API_TOKEN_ENCRYPTION_KEY`，非代码缺陷；本地已配置并验证
   Node/Python 密钥一致，用户可重试自定义 Token。
4. 生产部署（含 migration 004）仍未执行；本地 dev server 运行于 8080。
5. 上线顺序：生产先应用 migration 004，再配置 Token/加密密钥，再重启 Node/worker。
6. 当前增量已 commit；GitHub 推送随本轮执行；生产部署未执行。

## Workspace-level（不在本 repo 内，仅作上下文）

- `~/AI-Workspace/shared-skills/` 已通过全局配置 `~/.config/opencode/opencode.jsonc` 的
  `skills` path 注册：`audit-accounting-advisor`、`ui-ux-pro-max` 变为**按名可显式调用**，
  并已设 `metadata.opencode/autoinvoke: "false"`（默认不自动参与普通任务）。
- canonical source 保留在 shared-skills（无复制、无 symlink）；`WORKSPACE_RULES.md` C 节已附机制说明。
- 与本项目无耦合；项目 `.opencode/skills/` 仍为 7 个，未改。

## Known Broken

- 真实 MinerU 云端 API **未验证**；`layout.json` 结构/bbox/ZIP 层级未用真实响应复核。
- 未通过真实登录 Session 做上传 HTTP 集成测试；Node 侧以纯校验/加密测试覆盖，
  本地 DB 已做 Node→DB→Python 凭证往返验证。
- `.venv` 运行 contract 测试会因缺少 `psycopg`/`cryptography` 出现 import errors；
  contract 测试使用 `.mineru/bin/python`。
- 潜在运行时风险（未在生产验证）：`server/sales-income/*` 硬编码 `python3`，系统
  `python3` 无 `openpyxl`；Excel 模块已回落 `.venv`，销售/收入模块未回落。
- Workspace 根 `~/AI-Workspace` **不是** Git 仓库 —— 绝不要从根目录运行项目 git 命令。

## Pending Decisions

- 生产是否启用云端解析；使用哪个 MinerU 账号/额度。
- 生产 `.env` 是否配置 `MINERU_API_TOKEN` 与
  `MINERU_API_TOKEN_ENCRYPTION_KEY`（未读取，UNVERIFIED）。
- 云端 `MINERU_API_IS_OCR` 默认 `true`（扫描件安全）；纯电子合同是否改为 `false`。
- 生产 migration 004 的执行时点（必须先于新代码重启）。
- 是否统一 Python 解释器解析：`server/sales-income/*` 硬编码 `python3`。
- 是否引入 `uv` + `pyproject.toml` / `uv.lock`（现无）。

## Next Action

1. 审查工作区 diff（UI、routes、token-crypto、migration 004、worker、credential_store）。
2. 生产前：先应用 migration 004，再配置加密密钥（如需用户 Token），再重启 Node/worker。
3. 用非生产合同做一次 Local + Cloud 冒烟；核对 page/bbox、Markdown、middle JSON、
   Token/URL 不落日志，以及 `contract_credentials` 在任务终态后为空。
4. 冒烟通过后再走 `deployment-safety` / `/deploy`；本次仅 push GitHub，生产部署需单独批准。
5. 回滚：新上传改为 Local（或把 `parse_backend_requested` 置回 local）；旧代码可运行在
   已扩展的 schema 上，无需回滚数据库。

## Last Verification

- Python：`.mineru/bin/python -m unittest discover -s services/contract_review/tests -t .`
  = 198 tests PASS / 0 fail。
- Node：`node --test tests/contracts/*.test.js` = 42 tests PASS（本轮 pre-push）。
- 跨语言凭证：Node AES-GCM → 本地 DB → Python 解密 = PASS（虚构 Token）；
  实际本地配置下 Node 加密 → Python 解密 = `NODE_PYTHON_KEY_MATCH`。
- 配置诊断：修复前 Node `isConfigured()`=false、Python key absent；
  修复后 Node true、Python 32-byte valid。
- `py_compile`、`node --check`、`git diff --check`、
  `pre-push-check.sh --full` PASS（Python 198 + Node 42）。
- 本地 migration 004 已应用（127.0.0.1/liuxianlab，7 行历史合同 backfill local）。
- 真实云端 API：NOT RUN；生产部署 / 生产 DB / 生产 `.env`：NOT RUN。
- Python 环境：`.mineru`=3.12.15（含 cryptography 50.0.2）；`.venv`=3.9.6（BLOCKED）。

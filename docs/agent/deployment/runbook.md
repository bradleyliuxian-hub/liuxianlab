# deployment / runbook

Preflight -> approve -> apply -> verify -> rollback. Steps live in the
`deployment-safety` skill checklist. The active deploy script location is not
confirmed in-repo — verify it before use.

Never push / SSH / restart PM2 / modify Nginx / run migrations without explicit
approval after the preflight.

## 操作顺序（先检查，再执行）

预检（只读）：

1. production 干净 —— 分支 `main`，工作区干净。
2. 动手前本地健康预检通过。
3. 活跃工作扫描 —— 无 queued/processing 的 Contract Review 或 Excel Review 任务，
   且无正在运行的 parser/worker 进程。等待人工审核的项不阻塞。
4. 发布身份 —— 预期的 annotated tag、从当前 commit 可 fast-forward、
   可从 `origin/main` 到达。
5. 依赖检查 —— Node 依赖段变更需要匹配的 lockfile 变更；部署器会先提取目标
   release，在备份/切换代码之前通过
   `scripts/local/python-dependency-manager.sh check` 按 registry 检查完整目标
   `requirements*.txt` 与已登记环境。dry-run 只检查/展示计划，不安装、不建 venv。
   缺失包需显式批准后，在备份之后、代码切换之前安装并复检；未登记清单/环境
   fail-closed。首次应用新 deploy 脚本前备份生产脚本；代码回滚不会卸载 Python 包。
6. 迁移检查 —— 仅新增的 migration 文件；无历史 migration 被修改/重命名/删除；
   破坏性 SQL 停下。
7. 存在备份点。
8. 语法（`node --check` / `py_compile`）与真实测试套件通过。
9. MinerU production-env 与 seal-patch 标记完好。

执行（需批准）：如 lock 变更则 npm ci -> Python 依赖检查/经批准安装 -> 仅应用
新 migration -> `nginx -t` -> 重启 PM2 -> 验证。

验证：本地健康通过；再把 public 健康作为附加信号；确认工作区干净且 HEAD 等于目标。

回滚（操作者备注）：把代码回退到上一个 commit；如 lock 变更则重装依赖；重启。
Python 包安装不会随代码回滚自动卸载。数据库变更**不会**自动回滚 —— schema
回滚是独立的、需评审的操作。

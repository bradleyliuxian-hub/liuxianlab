# Liuxian Lab

Liuxian Lab 是一个需要登录才能访问的私有工具工作台。当前架构采用 Node.js + Express 负责服务端认证与页面分发，主界面集中展示工具入口，每个工具在独立目录中开发。

## 本地运行

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:8080`，健康检查：`GET /health`。

## 账号管理

账号由管理员在终端创建，不提供公开注册。

```bash
npm run user:create -- liuxian
npm run user:list
```

## 工具配置

工具卡片集中在：

```text
config/tools.json
```

新增仅展示的工具只需先加配置；实现后访问 `/tools/<slug>` 会加载真实页面，否则展示统一“开发中”占位页。

## 开发一个新工具

工具位于 `private/tools/<slug>/`，典型结构：

```text
private/tools/<slug>/
├── index.html
├── styles.css   (或 tool.css)
└── script.js    (或 tool.js)
```

`server.js` 会自动检测 `private/tools/<slug>/index.html`。可复制 `private/tools/_template/` 作为起点。

## 已实现工具

其余工具（`ai-writer`、`pdf-toolbox` 等）仍为 `planned`，完整清单见 `config/tools.json`。

- `excel-standardizer` — Excel 标准化（Node 路由 + Python worker：`server/excel/`、`workers/excel/`）
- `sales-income-analysis` — 销售收入分析（`server/sales-income/`、`workers/excel/sales_income/`）
- `contract-review` — 合同数字化审阅（Node 路由 + PostgreSQL + Python worker：`server/contracts/`、`services/contract_review/`、迁移在 `server/contracts/migrations/`）

## 断点续连（Checkpoint / Resume）

- `PROJECT_STATUS.md` 是当前状态的持久快照，用于跨会话恢复上下文。
- `/checkpoint`：更新快照，不 commit、不 push、不部署。
- `/resume`（别名 `/recover`）：读取 `AGENTS.md`、`PROJECT_STATUS.md` 与 Git 状态后恢复上下文。

## 目录

```text
liuxianlab-online/
├── server.js                 # Express 入口
├── server/                   # 各工具的 Node 路由与持久化
│   ├── contracts/            #   合同审阅（PostgreSQL + PDF 解析）
│   ├── excel/                #   Excel 标准化
│   └── sales-income/         #   销售收入分析
├── services/contract_review/ # 合同审阅 Python 服务 / worker
├── workers/excel/            # Excel / 销售分析 Python worker
├── private/                  # 需登录的工作台与工具页面
│   ├── index.html            #   工作台
│   └── tools/<slug>/         #   各工具
├── public/                   # 登录页
├── config/                   # tools.json、Excel 配置
├── scripts/                  # 本地辅助脚本
├── AGENTS.md                 # 面向 AI agent 的开发规范
├── PROJECT_STATUS.md         # 断点续连状态快照
├── .opencode/                # opencode agents / commands
└── .env.example              # 环境变量样例（真实 .env 勿提交）
```

## 部署方向

正式上线：Nginx + HTTPS → Node.js 绑定 `127.0.0.1:8080`（进程由 PM2 经 `ecosystem.config.js` 管理），公网只开放 80/443，Node 端口不直接暴露。

不要提交 `.env`、`data/users.json`、`sessions/` 会话文件或 `storage/` 运行期数据。

# Coming Soon — Validation Report

- 日期：2026-10-21
- 任务：暂停 Flowchart-to-Excel 开发、封存现状、网站标记 Coming Soon
- 分支：`main`
- HEAD：`28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- 结论：**封存文档完成；Coming Soon 静态/API 测试 PASS；8080 未重启，线上未确认加载；Mac/Windows Excel NOT RUN。**

---

## 1. 执行前后 Git 状态

### 1.1 执行前

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: 28efb24f08a8c7e83067e5dc52b8ad00172a5314
git status --short: 17 项
已跟踪修改: 9
```

### 1.2 执行后

```text
branch: main
HEAD: 28efb24f08a8c7e83067e5dc52b8ad00172a5314
git status --short: 19 项（11 个已跟踪修改 + 8 个未跟踪目录/文件）
已跟踪修改: 11
```

执行前既有 dirty 未清理、未 reset、未 stash、未 checkout、未 restore。未提交、未推送。

---

## 2. 读取的真实项目文件

```text
AGENTS.md
PROJECT_STATUS.md
PROJECT_INDEX.md
README.md
config/tools.json
server.js
server/flowchart-excel/routes.js
private/index.html
private/script.js
private/styles.css
private/tool.js
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/script.js
private/tools/flowchart-excel/styles.css
private/tools/flowchart-excel/review.html
private/tools/flowchart-excel/review.js
private/tools/flowchart-excel/review.css
tests/flowchart-excel/*（相关测试）
docs/agent/flowchart-excel/（Phase 0、Slice 3–5、Golden Fixture 报告）
```

未读取 `.env`、API Key、Token、Cookie、sessions、其他用户 storage 内容。

---

## 3. 变更文件与原因

| 文件 | 原因 |
|---|---|
| `config/tools.json` | `flowchart-excel.status` 改为 `coming-soon`，描述改为暂未开放/实验产物 |
| `private/index.html` | 工具卡新增 Coming Soon 状态徽标 |
| `private/script.js` | 根据 `tool.status` 渲染 Coming Soon；不改变其他工具逻辑 |
| `private/styles.css` | Coming Soon 徽标/卡片样式 |
| `private/tools/flowchart-excel/index.html` | 新增 Coming Soon 封存说明；隐藏上传/历史/新建入口 |
| `private/tools/flowchart-excel/script.js` | `COMING_SOON=true`，禁用上传、新建、刷新并阻止初始化写流程 |
| `private/tools/flowchart-excel/styles.css` | Coming Soon 横幅样式 |
| `private/tools/flowchart-excel/review.html` | 新增只读 Coming Soon 横幅；按钮标记 Coming Soon |
| `private/tools/flowchart-excel/review.js` | 写按钮 disabled 条件加入 `COMING_SOON` |
| `private/tools/flowchart-excel/review.css` | 只读横幅样式 |
| `server/flowchart-excel/routes.js` | 新增 `comingSoon` 选项；非 GET 写请求返回 503 `FEATURE_COMING_SOON`；`/meta` 暴露状态 |
| `server.js` | 从 `config/tools.json` 派生 `comingSoon` 传入 router |
| `tests/flowchart-excel/coming-soon.test.js` | 新增 Coming Soon 配置/UI/API/只读/owner 测试 |
| `tests/flowchart-excel/ui.test.js` | 状态断言改为 coming-soon；新增隐藏写入口断言 |
| `tests/flowchart-excel/review-ui.test.js` | 新增复核页只读 Coming Soon 断言 |
| `docs/agent/flowchart-excel/archive/*` | 封存档案、索引、回滚、验证报告 |

未修改流程图的业务生成器、approved graph、revision history、数据库、POC 历史基线或正式导出 gate。

### 3.1 归档文档清单

```text
docs/agent/flowchart-excel/archive/PROJECT-ARCHIVED.md
docs/agent/flowchart-excel/archive/ARTIFACT-INDEX.md
docs/agent/flowchart-excel/archive/coming-soon-rollback.md
docs/agent/flowchart-excel/archive/coming-soon-validation-report.md
```

---

## 4. 网站 Coming Soon 表现

### 4.1 工具列表卡片

- 卡片读取 `config/tools.json` 的 `status`；
- `coming-soon` 显示 `Coming Soon` 徽标；
- 描述显示“功能暂未开放，当前版本正在封存评估中”；
- 其他工具卡片状态不受影响。

### 4.2 工具入口页

- 顶部显示 `Coming Soon`；
- 主视觉显示：
  - 中文标题：流程图转 Excel
  - 状态：Coming Soon
  - 说明：功能暂未开放，当前版本正在封存评估中。
  - 补充：此前的导出结果仅为实验产物，不代表正式交付能力。
- 上传区、历史区默认 `hidden`；
- “新建导入”隐藏且 disabled；
- 上传按钮 disabled，文字为 Coming Soon；
- 不显示客户 job ID、文件名、绝对路径或业务内容。

### 4.3 复核页

- 显示 `Coming Soon · 只读历史` 横幅；
- 保存修改、完成复核、批量复核、导出 XLSX 按钮 disabled，并标记 Coming Soon；
- 历史数据只读查看能力保留；
- 后端写 gate 作为第二道保护。

---

## 5. 后端写 API Gate

`server/flowchart-excel/routes.js` 在认证与 same-origin 检查之后，对非 `GET/HEAD/OPTIONS` 请求返回：

```json
HTTP 503
{
  "ok": false,
  "code": "FEATURE_COMING_SOON",
  "message": "流程图转 Excel 功能暂未开放，当前版本正在封存评估中。"
}
```

被 gate 的写接口：

```text
POST /jobs
POST /jobs/import-helper-package
PUT  /jobs/:jobId/review/graph
PUT  /jobs/:jobId/review/issues/:issueId
POST /jobs/:jobId/review/bulk-review
POST /jobs/:jobId/review/approve
POST /jobs/:jobId/export-xlsx
POST /jobs/:jobId/cancel
```

保留的只读接口：

```text
GET /meta
GET /jobs
GET /jobs/:jobId
GET /jobs/:jobId/source
GET /jobs/:jobId/review
GET /jobs/:jobId/review/revisions
GET /jobs/:jobId/review/files/:name
GET /jobs/:jobId/artifacts
GET /jobs/:jobId/artifacts/:artifactId
```

未修改认证、same-origin、owner 隔离或 artifact allow-list。

---

## 6. 测试命令与真实结果

### 6.1 执行前基线（2026-10-21）

```text
node --test tests/flowchart-excel/*.test.js = 115 pass / 0 fail
npm test = 400 pass / 0 fail
GET /health = {"ok":true}
```

### 6.2 执行后

```text
node --test tests/flowchart-excel/*.test.js = 123 pass / 0 fail
npm test = 408 pass / 0 fail
.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t . = 14 tests OK
node --check server.js / private/script.js / flowchart script.js / review.js = syntax OK
GET /health = {"ok":true}
```

新增 Coming Soon 测试覆盖：

```text
config/tools.json 可解析、slug 唯一、status=coming-soon
工具页/复核页显示 Coming Soon
上传/历史/新建入口 hidden/disabled
POST /jobs、import、export、review graph、cancel -> 503 FEATURE_COMING_SOON
未认证 -> 401；跨源 -> 403（gate 之前）
GET /jobs、/meta、历史任务 -> 200
其他 owner 读取 -> 404
其他工具路由 -> 200
历史任务 exportReady=false
```

---

## 7. 8080 与服务加载状态

```text
GET /health = {"ok":true}
8080 PID = 3151（启动于 2026-10-21 09:23:59，早于本轮代码修改）
本次是否重启 = 否
```

由于没有重启，当前 8080 进程可能仍加载旧配置/旧代码；**不能声称 Coming Soon 已线上生效**。需要在维护窗口重启 Node 服务后再次验证：

```text
GET /health
登录后 GET /api/tools -> flowchart-excel.status=coming-soon
POST /api/flowchart-excel/jobs -> 503 FEATURE_COMING_SOON
GET /api/flowchart-excel/jobs -> 只读历史仍可用
```

---

## 8. 未运行 / 未验证

```text
真实浏览器 UI 冒烟 = NOT RUN
Mac Excel = NOT RUN
Windows Excel = NOT RUN
生产部署/PM2/Nginx = NOT RUN
```

本次只做静态页面测试和 in-memory API 测试；没有启动 Excel 或进行 GUI 操作。

---

## 9. 明确声明

- 未删除任何代码、测试、XLSX、ZIP、报告、review revision、approved graph 或用户文件。
- 未生成 XLSX。
- 未调用 AI。
- 未修改数据库。
- 未修改 `edit_as`（仍为 pending）。
- 未将 `exportReady` 改为 true（仍为 false）。
- 未重启 8080。
- 未提交或推送 Git。
- 未进入 connector spike、V5/V6 或任何后续开发。

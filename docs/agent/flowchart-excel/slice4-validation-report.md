# Slice 4 Validation Report — 人工复核工作台

- 日期：2026-10-20
- 范围：review API、复核数据持久化、revision/audit、Vanilla 复核页面、任务详情入口
- 未做：AI 调用、XLSX、数据库迁移、.NET POC、`edit_as` 决策、`exportReady=true`

---

## 1. 执行前基线

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
dirty: 29 entries before this slice
```

既有 dirty/untracked 修改均保留；没有 reset、clean、stash、checkout、restore。

实际读取的代码/文档：

```text
AGENTS.md
PROJECT_INDEX.md
README.md
server.js
server/flowchart-excel/routes.js
server/flowchart-excel/service.js
server/flowchart-excel/external-import.js
server/flowchart-excel/artifacts.js
services/flowchart_excel/validator.js
services/flowchart_excel/reference_validator.js
services/flowchart_excel/legacy_adapter.js
docs/agent/flowchart-excel/flowchart.schema.json
docs/agent/flowchart-excel/flowchart-data-contract.md
docs/agent/flowchart-excel/trade-purchase-template-profile.md
docs/agent/flowchart-excel/slice3-3-external-ai-variant-fix-report.md
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/script.js
private/tools/flowchart-excel/styles.css
tests/flowchart-excel/*
```

---

## 2. 实际任务基线

真实外部包任务：

```text
job id: 02abccde-ce1a-4dfd-bb8d-3e01ddf3b140
status: failed (SCHEMA_VALIDATION_FAILED — 旧版本导入时失败)
source: PixPin_2026-10-20_17-52-15.png (1402 x 1133)
package: external-helper-package.zip (305177 bytes)
```

该失败任务不能原地重试。为了验证 Slice 4，使用同一真实图片和同一真实 ZIP 在临时 test root 中重新导入，然后用 review API 读取：

```text
status: review_required
lanes: 3
nodes: 63
edges: 58
unresolved: 22
warnings: 8
blocking pending: 13
canApprove: false
templateProfileId: trade_purchase_cn
edit_as: pending
exportReady: false
```

分组：

```text
控制码 / 控制点: 14
结构 / 泳道: 2
连线 / 端口: 2
判断分支: 1
文字与置信度: 1
坐标: 1
模板 / 元数据: 1
```

非规范控制码示例仍为 `T.AC1`、`T.AC2`、`PRP 1-4`、`PRP 5`，没有被自动映射为 CA/PRP/TOE。

### v0.2.1 一键复核真实包验证

对同一真实 ZIP 执行 `POST /review/bulk-review`：

```text
HTTP: 200
updated: 22
graph unchanged: true
pending after bulk: 0
approve HTTP: 200
review status: review_approved
edit_as: pending
exportReady: false
```

一键复核只标记“已复核保留”，没有改图；`approve` 仍需单独调用，导出 gate 保持关闭。

---

## 3. 实现

### 后端

新增 `server/flowchart-excel/review.js`：

- 读取 imported graph 或 reviewed graph
- 生成 issues（状态持久化）与只读 warnings
- 校验 graph Schema + references
- 强制 profile/export rules
- 保存 reviewed graph、review CSV、style
- revision 目录 append-only
- optimistic concurrency
- issue 状态/处理说明
- approve 阻断检查
- review files/source owner scope

路由：

```text
GET  /api/flowchart-excel/jobs/:jobId/review
PUT  /api/flowchart-excel/jobs/:jobId/review/graph
PUT  /api/flowchart-excel/jobs/:jobId/review/issues/:issueId
POST /api/flowchart-excel/jobs/:jobId/review/approve
GET  /api/flowchart-excel/jobs/:jobId/review/revisions
GET  /api/flowchart-excel/jobs/:jobId/review/files/:name
GET  /api/flowchart-excel/jobs/:jobId/source
```

### 前端（v0.2.1 一键复核）

新增安全批量复核：仅在用户 confirm 后，把 pending unresolved 标为“已复核保留”，不改图、不自动映射控制码、不伪造 Windows 验收；完成后仍需单独 approve。API：`POST /review/bulk-review`。

新增：

```text
private/tools/flowchart-excel/review.html
private/tools/flowchart-excel/review.css
private/tools/flowchart-excel/review.js
```

技术选择：Vanilla HTML/CSS/JS + 内嵌 SVG。没有引入 React/Vite/X6，因为当前仓库没有构建链，且 CSP 为 `script-src 'self'`。

任务详情入口：

```text
/app/tools/flowchart-excel/review.html?job=<jobId>
```

在 `review_required` / `review_in_progress` / `review_approved` 状态显示入口。

### 版本说明

- `config/tools.json` v0.2.0
- 上传页 v0.2.0 + 更新说明
- 复核页 v0.2.0 + 更新说明

---

## 4. 安全与 gate 证据

- 所有 review API 使用现有 `requireAuth`、same-origin 状态变更保护、owner 校验。
- 跨源 PUT 返回 403；未认证 GET 返回 401；owner B 返回 404。
- source/review files/revisions 均 owner-scoped。
- 不调用 AI、不上传图片到外部端点。
- 不生成 XLSX。
- 未执行数据库迁移。
- `template_profile_id=trade_purchase_cn` 在 import/review/save 后保持不变。
- `edit_as=pending` 在 UI/API/graph 保存后保持。
- `exportReady=false` 在 review/approve 后保持。
- Windows Excel 验收 warning 只读；普通 issue 操作不能伪造。
- 原始 ZIP / imported flowchart / import report 不被覆盖。
- review graph 保存到 `review/flowchart.reviewed.json`，CSV 从最新 graph 重生成。
- 非规范控制码不自动映射。
- 人工新增 branch edge 必须有真实 endpoints 和 label。
- 一键复核必须 `confirm=true`，不改变 graph；写入一条 `bulk_reviewed` revision。

---

## 5. 测试

### Node flowchart

```bash
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 109
pass 109
fail 0
```

覆盖新增：

- review API 认证/同源/owner
- 读取 imported graph + 22 条真实 unresolved（实际数据临时测试）
- Schema/reference 保存失败
- optimistic concurrency `409`
- issue 状态与处理说明持久化
- 警告不可编辑
- reviewed CSV 重新生成
- 原始 artifacts 不被覆盖
- approve 阻断检查
- revision history owner scope
- source owner scope
- 非规范控制码不自动映射
- 一键复核显式确认、审计记录、图不变
- 人工分支必须填写 label / 真实 endpoints
- 首页入口与版本说明
- 无 `innerHTML`、无模型端点/Key、无 localStorage

### Python

```bash
.flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t .
```

结果：

```text
Ran 14 tests
OK
```

### 全量

```bash
npm test
```

结果：

```text
tests 394
pass 394
fail 0
```

### Health

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

**8080 已获授权重启**：listener PID 90545，health `{"ok":true}`；未登录 review 页面/API 均 302 到 `/login`。真实登录后的浏览器复核/保存/历史仍为 NOT RUN；API 运行验证使用临时 test root 和真实 ZIP。

额外在独立 `PORT=8091` 启动 smoke 实例：`/health` 通过，`/app/tools/flowchart-excel/review.html` 未登录 302 到 `/login`，启动日志无错误；随后停止 8091。

---

## 6. 手工浏览器验收

状态：**NOT RUN**

原因：

- 8080 已重启，但尚未使用真实账号执行浏览器复核。
- 没有使用真实账号读取/操作会话。
- 没有引入浏览器自动化框架。

执行手工步骤见：

```text
docs/agent/flowchart-excel/slice4-manual-acceptance.md
```

---

## 7. 文件清单

新增：

```text
server/flowchart-excel/review.js
private/tools/flowchart-excel/review.html
private/tools/flowchart-excel/review.css
private/tools/flowchart-excel/review.js
tests/flowchart-excel/review.test.js
tests/flowchart-excel/review-ui.test.js
docs/agent/flowchart-excel/slice4-review-workbench-architecture.md
docs/agent/flowchart-excel/slice4-validation-report.md
docs/agent/flowchart-excel/slice4-manual-acceptance.md
```

修改：

```text
server/flowchart-excel/routes.js
server/flowchart-excel/service.js
server/flowchart-excel/artifacts.js
server.js
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/script.js
private/tools/flowchart-excel/styles.css
config/tools.json                       # v0.2.1 一键复核
```

---

## 8. 未完成 / 风险

- 8080 已重启，但未做真实登录后的浏览器手工验收。
- 没有图形画布自由拖拽；只有原图/SVG 定位、高亮、属性编辑。
- 没有删除节点/泳道；泳道只提供“移动节点到其他泳道”，避免静默删除。
- 没有 Windows 验收附件上传；该 warning 只读。
- 没有数据库迁移。
- 22 条 unresolved 仍需业务人工判断；一键复核只做“保留原结果”的审计确认，不自动修复。
- 旧失败任务 `02abccde-ce1a-4dfd-bb8d-3e01ddf3b140` 保留审计状态。

## 9. 下一步

1. 使用真实登录执行手工验收。
2. 用真实图片 + ZIP 重新上传生成新的 `review_required` 任务。
3. 逐项处理 22 条 unresolved，其中 13 条阻断项优先。
4. 联合理解/Excel 导出仍留在复核与导出 gate 之后。

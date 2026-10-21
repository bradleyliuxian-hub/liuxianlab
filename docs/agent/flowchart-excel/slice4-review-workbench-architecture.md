# Slice 4 — 流程图人工复核工作台

状态：已实现（核心复核、保存、问题状态与修订历史）
范围：在现有 Liuxian Lab 网站内打开已导入的流程图任务，按真实 graph/issues/warnings 复核并保存；不调用 AI，不生成 XLSX。

---

## 1. 技术选择

### 采用：Vanilla HTML/CSS/JS + 内嵌 SVG 定位层

原因：

- 当前项目没有 React/Vite 构建链；`server.js` 的 CSP 是 `script-src 'self'`，直接加载未构建 TSX 不可行。
- `AGENTS.md` 明确当前前端工具是 Vanilla；不为一个工具引入整套前端迁移。
- 本切片优先保证列表、属性编辑、保存、审计历史可用；图形层只需要定位/高亮，不需要图编辑器。
- 复用现有 `private/tools/flowchart-excel/` 静态目录和 `/app` 认证静态路由。

未引入 React、Vite、AntV X6、Tailwind 或新的数据库。

### 页面入口

```text
/app/tools/flowchart-excel/review.html?job=<jobId>
```

版本：`v0.2.1`。v0.2.1 增加安全的一键复核。

上传/导入页面的任务详情在 `review_required`、`review_in_progress`、`review_approved` 状态显示“打开人工复核工作台”。

没有新增 `/tools/:slug` 子路由；`review.html` 由现有 `app.use('/app', requireAuth, express.static(PRIVATE_DIR))` 提供。

---

## 2. 数据与不可变边界

任务仍保存在：

```text
storage/flowchart-excel/<jobId>/
├── meta.json
├── source.<ext>
├── artifacts/                  # 原始导入件与导入报告，保持不可变
└── review/
    ├── flowchart.reviewed.json # 当前人工复核 canonical graph
    ├── nodes.reviewed.csv
    ├── edges.reviewed.csv
    ├── style.reviewed.json
    ├── issues.json             # 问题状态/处理说明/备注
    ├── review-meta.json        # revision / review status
    └── revisions/
        └── 000001.json ...     # append-only 修订记录
```

规则：

- 不覆盖原始 `artifacts/external-helper-package.zip`。
- 不覆盖原始 `artifacts/flowchart.json`。
- 不覆盖原始 `artifacts/import-validation-report.json`。
- 复核保存写入新的 `review/flowchart.reviewed.json` 与新的 review artifact，例如 `flowchart.reviewed.json`。
- `nodes.reviewed.csv` / `edges.reviewed.csv` 从最新复核 graph 重新生成。
- `style.reviewed.json` 仍由 `trade_purchase_cn` 强制规则生成，不采用外部 style 作为最终 Excel 样式。
- `edit_as` 保持 `pending`，`exportReady` 永远为 false。

---

## 3. 状态机

导入后：

```text
review_required
```

第一次保存 graph 或更新问题：

```text
review_in_progress
```

用户明确完成复核且没有阻断项：

```text
review_approved
```

限制：

- `failed` 任务不能直接变成复核任务；旧失败任务保留审计记录。
- `review_approved` 不会打开 Excel 导出。
- 再次编辑 graph 会回到 `review_in_progress`。
- 只有 owner 能读取和修改。

阻断项定义：未解决 `unresolved` 且 `severity` 为 `high` 或 `medium`。`low` unresolved 和导入 warnings 不阻止“完成复核”，但仍显示并要求人工阅读。

---

## 4. API

全部沿用现有 `requireAuth`、same-origin 状态变更保护、owner 校验。

```text
GET  /api/flowchart-excel/jobs/:jobId/review
PUT  /api/flowchart-excel/jobs/:jobId/review/graph
PUT  /api/flowchart-excel/jobs/:jobId/review/issues/:issueId
POST /api/flowchart-excel/jobs/:jobId/review/approve
GET  /api/flowchart-excel/jobs/:jobId/review/revisions
GET  /api/flowchart-excel/jobs/:jobId/review/files/:name
GET  /api/flowchart-excel/jobs/:jobId/source
```

### GET review

返回：

- canonical graph（优先 reviewed，否则 imported）
- unresolved issues（带持久化状态）
- 只读 warnings
- review progress / blocking count
- revision / review status
- profile（`trade_purchase_cn`、`edit_as=pending`、`exportReady=false`）
- source / overlay URL

### PUT graph

请求：

```json
{ "expectedRevision": 0, "graph": { ... } }
```

- `expectedRevision` 必须匹配当前 revision，否则 `409 REVISION_CONFLICT`。
- 强制 `template_profile_id/version/ref`。
- 强制 `style.excel_export_rules` 为 `trade_purchase_cn` 规则，`edit_as=pending`。
- 强制 `export_profile`（native shapes、twoCellAnchor、export gate 不允许被客户端改开）。
- `unresolved_items` 由服务端保留，不能通过 graph 保存静默删除。
- 执行 `flowchart.schema.json` Schema 校验与 `reference_validator`。
- 人工新增 branch edge 必须填写 label，且 source/target 必须存在。
- 保存成功写入 review graph、CSV、style、review artifacts，并追加 revision。

### PUT issues/:issueId

请求：

```json
{ "expectedRevision": 1, "status": "resolved", "resolution": "已对照原图确认。", "note": "" }
```

- 只接受 graph 当前 unresolved 的 issue；warnings 不可编辑。
- `resolved` / `waived` 必须提供处理说明。
- 更新 `issues.json`，追加 revision。
- 不会自动把非规范控制码映射为 CA/PRP/TOE。

### POST bulk-review（v0.2.1）

请求：

```json
{
  "expectedRevision": 0,
  "confirm": true,
  "resolution": "一键复核：用户确认保留当前识别结果；未修改图结构、控制码或连线。"
}
```

- 必须显式 `confirm=true`。
- 将当前所有 pending unresolved 标为 `waived`（“已复核保留”），不修改 graph、不自动映射控制码、不创建连线。
- 不处理 warnings，不伪造 Windows 验收。
- 写入 `bulk_reviewed` revision；不自动 approve。
- 之后仍需单独 `approve`，Excel 导出仍保持关闭。

### POST approve

- 必须带 `expectedRevision`。
- 存在阻断级 pending issue 时返回 `409 REVIEW_BLOCKED` 和 blockers。
- 成功只写入 `review_approved`，绝不改变 `exportReady`。
- Windows Excel 验收不能通过 issues/approve 伪造；它仍是导出 gate 的独立证据要求。

### revisions / files / source

- revisions 按 revision 倒序返回，只给 owner。
- files 仅允许四个 review 文件名。
- source 只返回当前 owner 的原图，`Cache-Control: private, no-store`。

---

## 5. Revision / audit

每次 graph 保存、issue 更新、approve 都创建：

```text
review/revisions/<6-digit revision>.json
```

记录：

- revision
- action（`graph_saved` / `issue_updated` / `review_approved`）
- target（graph/job/issue）
- changes（changed object/field、old/new；最多 200 项）
- actor（owner username）
- created_at
- reason / resolution

保存使用临时文件 + `fsync` + rename。修订目录 append-only，不删除历史。

---

## 6. UI

四个区域：

1. 顶部任务摘要：文件名、job ID、状态、3/63/58、待确认进度、warnings、profile、export gate、revision。
2. 左侧：问题 / 对象 / 警告 / 历史。问题按结构、控制码、分支、连线端口、坐标、文字、元数据、其他分组；支持状态、严重度、分组过滤。
3. 中央：原图、review_overlay 切换、缩放、SVG 定位层、泳道/节点/边高亮。
4. 右侧：节点、连线、泳道属性；问题状态与处理说明。

安全：

- 动态文本全部通过 `textContent` / DOM API。
- 不使用 `innerHTML`。
- 不读取模型配置，不调用 AI。
- 不上传文件到外部端点。
- 不显示本机绝对路径。
- 不把 overlay 当最终 Excel 内容。
- 不把显示缩放坐标写回 `source_bbox_px`。

### 特殊处理

- 非规范控制码：导入时保留在 unresolved，工作台不自动映射；用户确认后可手动添加规范 control。
- `control_marker` 映射为 `other`：保留原形状/原 controls 到 `extensions.legacy`，显示待确认项。
- N034 类分支：不自动创建边；可在“新增连线”中手工选择真实 target 并填写 label。
- 跨泳道/端口：连线表单允许显式选择 source/target/port，不确定时保留 null。
- 泳道重复/分页：泳道属性提供“移动节点到其他泳道（不删除泳道）”；空泳道保留待人工确认。
- 低可读文字：可直接修订 label；不伪造 OCR 原文。
- Windows 验收：warning 只读，不能标记已解决。
- 一键复核（v0.2.1）：显式确认后将 pending unresolved 标为“已复核保留”，不改图，不自动完成复核。

---

## 7. 涉及文件

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
server/flowchart-excel/routes.js        # review/source 路由，5MB graph parser
server/flowchart-excel/service.js       # resolveSource
server/flowchart-excel/artifacts.js     # export CSV/style helpers
server.js                               # review graph 绕过 16KB 全局 parser
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/script.js
private/tools/flowchart-excel/styles.css
config/tools.json                       # v0.2.1
```

---

## 8. 当前限制

- 未接入 React/Vite/X6；图形层是 SVG 定位/高亮，不是自由布局编辑器。
- 没有删除节点/泳道；避免静默删除审计内容。
- 没有自动修复 unresolved；这是有意的。
- 没有 Windows 验收附件上传；warning 只读。
- 未新增数据库迁移。
- 8080 已获授权重启并加载新 API；真实登录浏览器验收仍待执行。

## 9. 下一步

1. 使用真实登录执行浏览器手工验收。
2. 对真实任务处理 22 条 unresolved，特别是 13 条阻断项，然后保存历史。
3. 人工确认后再考虑联合理解与 Excel 导出 gate；本阶段不打开 exportReady。

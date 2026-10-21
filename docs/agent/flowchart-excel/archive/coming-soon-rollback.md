# Coming Soon — Rollback / Re-enable Notes

- 日期：2026-10-21
- 适用工具：`flowchart-excel`（流程图转 Excel）
- 当前状态：`coming-soon`
- 当前 `exportReady`：`false`
- 当前 `edit_as`：`pending`

本文件只说明如何恢复开发/页面入口；**不授权打开正式导出**。

---

## 1. 本次改动文件

### 1.1 产品状态

```text
config/tools.json
  flowchart-excel.status: ready -> coming-soon
  flowchart-excel.description: 改为暂未开放/封存说明
  flowchart-excel.version: 仍为 v0.2.2（最后实验版）
```

### 1.2 工具列表卡片

```text
private/index.html
  toolCardTemplate 新增 .tool-status-badge
private/script.js
  根据 status=coming-soon 显示 Coming Soon 徽标
private/styles.css
  .tool-status-badge / .tool-card.is-soon
```

### 1.3 流程图入口页

```text
private/tools/flowchart-excel/index.html
  新增 Coming Soon 横幅与说明
  uploadPanel / historyPanel 默认 hidden
  newJobButton hidden + disabled
  uploadButton disabled + "Coming Soon"
private/tools/flowchart-excel/script.js
  const COMING_SOON = true
  初始化末尾禁用写入口并提前 return
private/tools/flowchart-excel/styles.css
  Coming Soon 横幅/状态样式
```

### 1.4 复核页

```text
private/tools/flowchart-excel/review.html
  新增只读 Coming Soon 横幅
  保存/完成复核/批量复核/导出按钮文字标记 Coming Soon
private/tools/flowchart-excel/review.js
  const COMING_SOON = true
  四个写按钮 disabled 条件加入 COMING_SOON
private/tools/flowchart-excel/review.css
  只读横幅样式
```

### 1.5 后端写接口 gate

```text
server/flowchart-excel/routes.js
  createFlowchartRouter({ comingSoon = false })
  认证 + same-origin 之后，对非 GET/HEAD/OPTIONS 返回：
  HTTP 503 { code: "FEATURE_COMING_SOON" }
  GET /meta 增加 comingSoon / featureStatus
server.js
  从 config/tools.json 派生 comingSoon
  只在 flowchart-excel.status === 'coming-soon' 时启用
```

### 1.6 测试

```text
tests/flowchart-excel/coming-soon.test.js（新增）
tests/flowchart-excel/ui.test.js（状态/隐藏入口断言）
tests/flowchart-excel/review-ui.test.js（只读 Coming Soon 断言）
```

---

## 2. 恢复步骤

### 2.1 最小回滚（恢复页面与写 API）

1. 将 `config/tools.json` 中：

```json
"status": "coming-soon"
```

改为项目约定的开发状态（通常 `"ready"`；如果未来引入 `development`，需同步更新校验/渲染）。

2. 把 `config/tools.json` 的 description 恢复为功能描述。

3. 前端恢复：

- `private/tools/flowchart-excel/script.js`：把 `const COMING_SOON = true` 改为 `false`，或删除提前 return/禁用逻辑。
- `private/tools/flowchart-excel/index.html`：移除 `uploadPanel` / `historyPanel` 的 `hidden`，恢复 `newJobButton`、`uploadButton` 的可用状态，移除/隐藏 Coming Soon 横幅。
- `private/tools/flowchart-excel/review.html/js`：把 `const COMING_SOON = true` 改为 `false`，恢复按钮文字与 `disabled` 条件，移除只读横幅。
- 保留 `tool-status-badge` 支持；其他工具状态不受影响。

4. 后端：

- `server.js` 会根据 `config/tools.json` 的 status 自动派生 `comingSoon`。
- 改回 `ready` 后必须重启 Node 服务才会加载新配置；本次封存操作**没有重启** 8080。

5. 运行：

```bash
node --test tests/flowchart-excel/*.test.js
npm test
```

6. 在 Mac/Windows Excel 重新验收 Golden Fixture 修复版；通过前不要打开正式导出。

### 2.2 只恢复只读页面，不恢复写 API

如果只想恢复历史查看：

- 保留 `comingSoon: true` 和 gate；
- 在 `index.html` 恢复历史列表只读区域，但不要恢复上传/开始处理/导出；
- 不要修改 `exportReady`。

### 2.3 不要做的事

- 不要因为页面恢复而把 `exportReady` 改成 true。
- 不要把历史实验 artifact 注册成正式下载。
- 不要在未通过 Golden Fixture Mac/Windows Excel 验收前进入 connector spike。
- 不要删除历史任务、review revision、实验 XLSX 或报告。

---

## 3. 回滚后的验证清单

```text
[ ] config/tools.json 可解析；flowchart-excel 只有一个条目
[ ] 工具列表/详情显示正确状态
[ ] 上传/开始处理/保存/复核/导出入口按新状态可用或禁用
[ ] 写 API 不再返回 FEATURE_COMING_SOON（仅当明确恢复时）
[ ] GET 历史任务/审核数据仍按 owner 隔离
[ ] exportReady 仍为 false
[ ] edit_as 仍为 pending
[ ] Mac/Windows Excel 验收结果已记录
[ ] 8080 重启发生在维护窗口，并已检查 /health
```

---

## 4. 当前服务状态

本次封存**没有重启 8080**。因此：

- 当前运行的 Node 进程仍可能加载旧的配置/路由；
- 新 Coming Soon 状态在重启前不保证线上生效；
- 重启必须由维护窗口执行，不在本任务内自动完成。

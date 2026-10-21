# Slice 3.3 Validation Report — Manifest Schema + 上传 UI

- 日期：2026-10-20
- 范围：manifest.schema.json、manifest validator、流程图转 Excel 工具页面、上传/轮询/artifact/history UI、静态 UI 测试
- 未做：AI 调用、XLSX、第二阶段联合理解、图形编辑器、数据库迁移、.NET POC 修改

---

## 1. Git 状态

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
status: dirty
未提交条目：29
```

未执行 reset、clean、stash、checkout、restore 或 commit。既有 dirty 修改保留。

---

## 2. 新增/修改文件

### 新增

```text
docs/agent/flowchart-excel/manifest.schema.json
services/flowchart_excel/manifest_validator.js
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/styles.css
private/tools/flowchart-excel/script.js
tests/flowchart-excel/manifest-schema.test.js
tests/flowchart-excel/ui.test.js
docs/agent/flowchart-excel/slice3-3-upload-ui-architecture.md
docs/agent/flowchart-excel/slice3-3-validation-report.md
```

### 修改

```text
config/tools.json                 # 注册 flowchart-excel 工具卡片
server/flowchart-excel/external-import.js  # manifest schema 校验
```

未修改：

```text
server.js
server/flowchart-excel/routes.js
server/flowchart-excel/service.js
数据库
.NET POC
```

---

## 3. Manifest Schema

Schema：

```text
docs/agent/flowchart-excel/manifest.schema.json
```

Draft 2020-12，实际约定与 Slice 3.2 兼容：

```text
schema_version = 1.0.0
package_version = 1.0.0
generation_mode = external_ai
ai_extraction_performed_by_website = false
source_image.filename / sha256
source_image.size（可选，缺失时网站记录实际上传值并 warning）
source_image.width_px / height_px（可选）
files 五个核心文件 hash
可选 review_overlay.png hash
可选 model / prompt_version
```

规则：

- `source_image.filename` 拒绝 `/`、`\`、`.`、`..` 路径；
- `size` 可选正整数；
- `sha256` 64 位 hex 或 null；
- `files` 不允许额外字段；
- 归一化兼容 `package_schema_version`、`files` 数组、`width_px/height_px`、`size_bytes/bytes`、`template_profile`、`notes`；不伪造 hash；
- 额外根字段拒绝。

`external-import.js` 在应用层 hash/引用校验前调用：

```text
validateManifestSchema(manifest)
```

失败返回 `INVALID_MANIFEST`，不生成正式 helper。

仅 Schema 通过不等于真实 hash 通过；应用层仍重新计算：

- 原图 SHA-256；
- 五个必需文件 hash；
- ZIP 安全/白名单；
- Schema/reference validation。

---

## 4. 工具页面

- slug：`flowchart-excel`
- URL：`/tools/flowchart-excel`
- 文件：

```text
private/tools/flowchart-excel/index.html
private/tools/flowchart-excel/styles.css
private/tools/flowchart-excel/script.js
```

技术栈：现有 Vanilla HTML/CSS/JS + `app-shell`，未引入 React/Vite/X6。

页面功能：

- 原图上传：PNG/JPG/JPEG/WebP，本地 object URL 预览
- ZIP 上传：只接受 `.zip`，列出必需文件
- 按钮仅在两个文件都选择后启用
- 调用：

```text
POST /api/flowchart-excel/jobs/import-helper-package
FormData: image, package, generationMode=external_ai
```

- 轮询任务状态：1.5s，最长 5 分钟，终态停止，页面卸载清理
- 显示状态/进度/warnings/unresolved/review_required
- 显示 `exportReady=false`，明确 Excel 未开放
- artifact 按 ID 下载，不拼接路径
- 读取 `import-validation-report.json` 摘要
- 历史任务列表（服务端 owner-scoped）
- 空/加载/失败状态
- 不使用 `innerHTML` 写动态用户内容
- 不保存 API Key、不调用模型端点
- 本地预览 `createObjectURL`，清除/卸载时 `revokeObjectURL`

工具卡片已加入 `config/tools.json`：

```json
{
  "slug": "flowchart-excel",
  "name": "流程图转 Excel",
  "category": "数据",
  "status": "ready",
  "version": "v0.1.0",
  "icon": "F2X"
}
```

---

## 5. 认证与权限

- 页面由现有 `/tools/:slug` 自动加载，需要登录。
- API 由现有 `requireAuth` + `sameOriginForStateChange` 保护。
- 前端 `fetch` 使用同源 credentials；不使用自定义 token。
- 历史任务和 artifact 只显示/下载当前 owner 的数据。
- artifact 下载 URL 只使用服务端返回的 artifact ID。
- 不把本地文件系统路径暴露给浏览器。

---

## 6. 是否调用 AI / 生成 XLSX

- 网站内 AI：**未调用**
- 图片发送外部端点：**未发生**
- XLSX：**未生成**
- 第二阶段联合理解：**未开始**
- 数据库迁移：**未执行**
- .NET POC：**未修改**
- `edit_as`：仍为 `pending`
- `exportReady`：始终 false

最终 Excel 视觉规范仍以 `trade_purchase_cn` profile 为最高优先级。

---

## 7. 实际测试

### Node flowchart

```bash
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 93
pass 93
fail 0
```

新增：

- 6 个 manifest schema 测试（含旧格式归一化）
- 8 个 UI 静态/契约测试（含首页工具库映射）
- 1 个旧 manifest 外部导入兼容测试
- 1 个 external AI graph 变体导入测试

覆盖：

- manifest 合法/非法
- 旧/变体 manifest 归一化
- 缺 hash / 非法 hash / 非法 path / 额外字段
- generation mode / AI claim
- 工具注册
- 两个上传字段
- multipart 字段名
- 无模型端点/Key
- artifact ID 下载
- object URL 清理
- 轮询终态停止
- 既有 external import / ZIP 安全 / fake / real 测试继续通过

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
tests 378
pass 378
fail 0
```

历史 Slice 3.2 基线 362；新增 16 个 Node 测试后为 378。

### /health

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

未重启 8080。

---

## 8. 如何手工测试

当前 8080 常驻进程未重启，不能假设新 API/页面已加载。请在不干扰 8080 的前提下启动独立实例，例如：

```bash
cd /Users/a123/AI-Workspace/projects/liuxianlab-online
PORT=8090 npm run dev
```

然后：

1. 登录 `http://127.0.0.1:8090/`。
2. 打开 `/tools/flowchart-excel`。
3. 选择原始图片和外部 AI ZIP。
4. 确认页面提示“不调用 AI / 不生成 XLSX / trade_purchase_cn”。
5. 点击“上传并校验”。
6. 观察状态：`validating_image` → `validating_package` → ... → `review_required`。
7. 下载 `import-validation-report.json`、`flowchart.json`、CSV、ZIP。
8. 确认 `exportReady=false` 和 `edit_as=pending`。
9. 刷新页面，历史任务仍只显示当前用户任务。

不要停止或重启现有 8080 进程。

---

## 9. 8080 运行状态

用户明确要求把本工具放到现有 8080 服务。已停止旧 Node 进程并重新启动 `npm run dev`：

```text
listener: node server.js @ 127.0.0.1:8080
health: {"ok":true}
tool card: 流程图转 Excel
```

未认证访问：

```text
GET /tools/flowchart-excel -> 302 /login
GET /api/flowchart-excel/meta -> 302 /login
```

两者均不是 404，说明工具页面和 API mount 已加载到 8080；仍由现有登录认证保护。未使用真实账号做浏览器登录测试，避免读取或使用用户凭证。

启动日志：

```text
Liuxian Lab running at http://127.0.0.1:8080
Login: http://127.0.0.1:8080/login
```

## 10. 未完成 / 风险

- 只做上传/校验，不包含图形化人工复核编辑器。
- 旧 manifest 与 external AI graph 变体归一化是兼容层；真实文件 hash、ZIP 白名单和引用校验没有放宽。
- 非规范控制码不会自动映射为 CA/PRP；会进入 unresolved，等待人工确认。
- manifest schema 与 application validator 是两层；需同时通过。
- 外部 CSV 只作为审计材料；canonical CSV 已重生成。
- 未做浏览器自动化上传测试；当前是静态 UI/契约测试。真实浏览器交互需手工验证。
- 首页工具库需要前端 `TOOL_IA` 映射；已补 `flowchart-excel -> Excel/专业分析` 并提升 `app/script.js` 缓存版本。
- 第二阶段联合理解、数据库迁移、XLSX 导出未开始。
- `edit_as` 仍未决策。

---

## 11. 下一阶段建议

建议先做**人工复核工作台**，再做第二阶段联合理解。

理由：

1. 外部 AI 结果必须先由人工确认节点/边/文字/泳道/控制点。
2. 联合理解需要可靠的结构基线；否则会把外部结果的不确定性叠加。
3. 现有 canonical JSON/CSV/overlay/artifact API 已可直接支持复核工作台。
4. Excel 导出和 `edit_as` 决策应在人工复核 gate 之后。

最终 Excel 仍以 `Trade purchase.CN.xlsx` 的 `trade_purchase_cn` profile 为最高优先级。

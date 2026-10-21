# Slice 2 Validation Report — 上传、任务骨架与 fake worker

- 日期：2026-10-20
- 范围：认证上传、任务状态、owner 权限、artifact 下载、取消、TTL/清理、fake worker
- 明确未做：真实 AI 识别、真实辅助文件、XLSX、PDF、React/Vite/X6、数据库迁移、正式 UI

---

## 1. Git 状态

```text
pwd: /Users/a123/AI-Workspace/projects/liuxianlab-online
branch: main
HEAD: ea3a3127881393f1eae1542419268b571a8e79f6
status: dirty
未提交条目：27（含既有修改与本切片/前序切片新增文件）
```

本轮没有 `git reset`、`git clean`、`stash`、`checkout`、`restore` 或 commit。
既有未提交修改全部保留。

---

## 2. 新增/修改文件

### 新增

```text
server/flowchart-excel/routes.js
server/flowchart-excel/service.js
server/flowchart-excel/worker.js
server/flowchart-excel/image.js
tests/flowchart-excel/routes.test.js
tests/flowchart-excel/jobs.test.js
tests/fixtures/flowchart-excel/one-pixel.png
tests/fixtures/flowchart-excel/one-pixel.jpg
tests/fixtures/flowchart-excel/one-pixel.webp
docs/agent/flowchart-excel/slice2-upload-job-architecture.md
docs/agent/flowchart-excel/slice2-validation-report.md
```

### 修改

```text
server.js
```

只增加：

```js
const { createFlowchartRouter } = require('./server/flowchart-excel/routes');
app.use('/api/flowchart-excel', requireAuth, sameOriginForStateChange,
  createFlowchartRouter({ root: ROOT }));
```

未修改：

```text
config/tools.json
private/
数据库 schema / migrations
现有业务 API
.NET POC
```

没有创建正式工具页面，也没有把未完成工具注册为 `ready`。

---

## 3. 实际检查的现有架构

```text
server.js
config/tools.json
server/equity-structure/routes.js
server/equity-structure/job-factory.js
server/equity-structure/worker-runner.js
server/equity-structure/repository.js
server/equity-structure/migrations/001_equity_structure.sql
server/excel-review/routes.js
server/excel-review/parse-runner.js
server/contracts/db.js
services/excel_review/ooxml_package.py
docs/agent/architecture.md
docs/agent/tools.md
docs/agent/security.md
package.json
tests/equity-structure/routes.test.js
```

结论：

- 认证、同源、静态目录、错误处理统一在 `server.js`。
- 现有模块各自维护 PostgreSQL 表、repository、runner、status.json；没有通用任务表。
- 为避免未经评审的 DB migration，本切片使用受控文件型任务存储。
- 生产接入真实 worker 前建议新增 `flowchart_jobs` 表；本次只写提案，不执行。

---

## 4. API 与状态机

| Method | Path | 状态 |
|---|---|---|
| `POST` | `/api/flowchart-excel/jobs` | 上传 + 创建 fake 任务 |
| `GET` | `/api/flowchart-excel/jobs` | 当前用户任务列表 |
| `GET` | `/api/flowchart-excel/jobs/:jobId` | 状态/进度/artifact 摘要 |
| `GET` | `/api/flowchart-excel/jobs/:jobId/artifacts` | mock artifact 列表 |
| `GET` | `/api/flowchart-excel/jobs/:jobId/artifacts/:artifactId` | 下载 artifact |
| `POST` | `/api/flowchart-excel/jobs/:jobId/cancel` | 取消可取消任务 |

状态：

```text
uploaded -> queued -> fake_processing -> mock_helpers_ready
uploaded / queued / fake_processing -> cancelled
queued / fake_processing -> failed
```

没有使用 `helpers_ready`，因为本阶段没有真实识别。

每个任务/artifact 明确标记：

```text
workerMode: "fake"
isMock: true
resultKind: "synthetic_test_result"
aiExtractionPerformed: false
```

---

## 5. 权限与 artifact

- `server.js` 全局 `requireAuth` + `sameOriginForStateChange`。
- Router 内部再次 `requireUser`，并对非 GET 做 Origin/Host 检查。
- owner 从 session 取，不接受客户端传入。
- 用户 B 访问用户 A 的任务/artifact/cancel 统一 404。
- artifact 按 meta 白名单 ID 查找，文件名固定；下载路径不由客户端拼接。
- 路径穿越请求返回 404。
- 下载设置 `Cache-Control: private, no-store`。
- 错误响应不回显服务器路径或图片内容。

---

## 6. 上传校验

默认：

```text
单文件 25 MiB
最大 50,000,000 像素
PNG / JPG / JPEG / WebP
单文件字段 file
```

校验：

- 扩展名白名单
- MIME 白名单
- 魔数
- PNG/JPEG/WebP 结构/尺寸探测
- 像素上限
- SHA-256
- 服务端 UUID 目录
- 原始文件名只作为显示字段，不作为磁盘路径

**限制：** 当前是结构/尺寸探测，不是完整像素解码。完整解码应放到真实 worker 或后续图片库阶段；未声称已实现完整解码。

---

## 7. Fake worker 边界

`server/flowchart-excel/worker.js` 只生成：

```text
artifacts/job-manifest.json
artifacts/mock-result.json
artifacts/mock-report.md
```

不生成：

```text
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
```

不读取上传图片像素，不调用模型，不发送图片。
`mock-result.json` 是固定 synthetic 数据，明确 `is_mock: true`、`ai_extraction_performed: false`。

---

## 8. 存储、TTL、清理

文件型存储：

```text
storage/flowchart-excel/<job-uuid>/
├── meta.json
├── status.json
├── source.<ext>
└── artifacts/
```

- 目录 0700，文件 0600。
- `expiresAt` 默认 7 天。
- `cleanupExpired()` 惰性清理；任务列表请求时调用。
- 本切片没有常驻清理定时器；生产应复用现有 runner/TTL 或新增 cleanup worker。
- 没有读取或修改现有 `storage/` 内容。

---

## 9. 测试命令与真实结果

### Slice 2 新测试

```bash
node --test tests/flowchart-excel/routes.test.js tests/flowchart-excel/jobs.test.js
```

结果：

```text
tests 15
pass 15
fail 0
```

### 全部 flowchart 测试

```bash
node --test tests/flowchart-excel/*.test.js
```

结果：

```text
tests 60
pass 60
fail 0
```

### 全量回归

```bash
npm test
```

结果：

```text
tests 345
pass 345
fail 0
```

历史基线为 330 pass；新增 15 个 Slice 2 测试后为 345 pass。

### /health

```bash
curl -sS -m 3 http://127.0.0.1:8080/health
```

结果：

```json
{"ok":true}
```

未启动、重启或干扰 8080 服务。新路由通过临时测试服务器（随机端口）验证；现有 8080 进程未重启，因此尚未加载新路由。

---

## 10. 覆盖的测试点

- 未认证上传 401
- 跨源 POST 403
- PNG / JPEG / WebP 上传
- 错误扩展名 / MIME / 魔数
- 超大文件 413
- 不可解析图片 400
- 多文件上传拒绝
- 非法/不存在 job ID 404
- owner A/B 隔离（状态、artifacts、下载、取消）
- artifact 路径穿越 404
- fake flags / mock artifact 名称与内容
- cancel 前置状态；ready 后 409
- fake failure `WORKER_FAILED` 且不泄露路径
- TTL 惰性清理
- 既有 Slice 1 45 个测试仍通过

---

## 11. 是否需要数据库迁移

本切片：**不需要**。
生产接入真实 worker/多用户任务前：**建议新增 `flowchart_jobs` 表**，但本次只写 schema 提案，不执行 migration。

提案表字段见 `slice2-upload-job-architecture.md` 第 9 节。

---

## 12. 未实现 / 未验证

- 真实图片识别；没有调用任何视觉模型。
- 正式 `flowchart.json` / CSV / style / conversion report。
- 完整像素解码（当前仅结构/尺寸探测）。
- 数据库持久化与 migration。
- 正式 UI / React/Vite/X6。
- 真实 worker 超时/重启恢复（fake worker 仅生命周期模拟）。
- 目标模板 `edit_as` 最终决策（仍为 pending）。
- Windows Excel 详细证据。
- XLSX 生成。

---

## 13. 下一阶段

只有在本切片通过评审后，才进入：

1. 真实图片识别 worker 接入；
2. 正式辅助阅读文件生成；
3. 图片外发授权与模型端点配置；
4. 数据库任务表迁移（另行设计/评审）；
5. 原图 + 辅助文件联合理解；
6. 复核页面与最终 Excel 导出。

最终 Excel 仍以 `trade_purchase_cn` 为最高优先级视觉规范；本次未生成 XLSX。

# Slice 2 — 上传、任务骨架与 fake worker 架构

状态：已实施（fake worker 阶段）
范围：认证上传、任务状态、owner 权限、artifact 下载、取消、TTL/清理、fake worker 端到端测试
明确未做：真实 AI 识别、真实辅助文件、XLSX、PDF、React/Vite/X6、数据库迁移、正式 UI

---

## 1. 现有架构检查结论

检查的真实文件：

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
```

结论：

1. 认证/权限/同源/静态目录/错误处理都在 `server.js`。
2. 每个业务模块自己拥有 PostgreSQL 表、repository、runner 和 status.json，没有通用任务表/通用 runner 抽象。
3. 上传使用 `multer.memoryStorage()`，文件先校验再写 `storage/<module>/<uuid>/`，路径由服务端派生。
4. worker 采用 `spawn` + `status.json` + 轮询 + 超时 + 恢复；任务状态由 DB + 文件共同承载。
5. 没有现成通用流程图任务表；本切片不执行 DB migration。
6. `config/tools.json` 是工具卡片来源；本次没有正式 UI，因此不注册工具卡片。

---

## 2. 本切片的存储选择

为了避免在验证阶段引入未评审的数据库迁移，本切片使用：

```text
storage/flowchart-excel/<job-uuid>/
├── meta.json
├── status.json
├── source.<ext>
├── artifacts/
│   ├── job-manifest.json
│   ├── mock-result.json
│   └── mock-report.md
└── worker.log（后续真实 worker 使用）
```

这是**临时文件型任务存储**，用于验证 API、owner 隔离、artifact、TTL 和 fake worker；不是最终生产持久化方案。

生产 Phase 需要新增 `flowchart_jobs` PostgreSQL 表（见第 9 节），本切片不执行该迁移。

目录/文件权限：

- job 目录 0700
- 文件 0600
- 不放在 `public/` 或 `private/`
- 文件名由服务端 UUID/白名单派生，不使用原始文件名作为路径

---

## 3. API

挂载位置（`server.js`）：

```js
app.use('/api/flowchart-excel', requireAuth, sameOriginForStateChange,
  createFlowchartRouter({ root: ROOT }));
```

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/api/flowchart-excel/jobs` | 上传图片，创建 fake 任务 |
| `GET` | `/api/flowchart-excel/jobs` | 当前用户任务列表 |
| `GET` | `/api/flowchart-excel/jobs/:jobId` | 状态/进度/artifact 摘要 |
| `GET` | `/api/flowchart-excel/jobs/:jobId/artifacts` | 列出 mock artifacts |
| `GET` | `/api/flowchart-excel/jobs/:jobId/artifacts/:artifactId` | 下载指定 artifact |
| `POST` | `/api/flowchart-excel/jobs/:jobId/cancel` | 取消 uploaded/queued/fake_processing |

### 认证与权限

- `server.js` 全局 `requireAuth` + `sameOriginForStateChange`。
- Router 内再次做 `requireUser`，作为测试/防御层。
- Router 对非 GET 再做 Origin/Host 同源检查；与 server 全局检查形成防线。
- owner 从 `req.session.auth.username` 取，不接受客户端 owner。
- 不属于当前用户的任务统一 404，避免泄露任务是否存在。
- artifact 只按 `artifactId` 查 meta 白名单，路径由服务端 `artifact.name` 派生；不接受路径参数。
- 下载 `res.download`，设置 `Cache-Control: private, no-store`。

### 错误码

```text
UNAUTHENTICATED
ACCESS_DENIED
INVALID_FILE_TYPE
INVALID_IMAGE_SIGNATURE
IMAGE_DECODE_FAILED
IMAGE_TOO_LARGE
FILE_TOO_LARGE
TOO_MANY_FILES
NO_FILE
JOB_NOT_FOUND
JOB_NOT_CANCELLABLE
ARTIFACT_NOT_FOUND
WORKER_FAILED
INTERNAL_ERROR
```

错误响应只返回 code/message，不回显服务器路径或图片内容。

---

## 4. 上传验证

默认限制：

```text
单文件：25 MiB
最大像素：50,000,000
格式：PNG / JPG / JPEG / WebP
单文件字段：file
多文件：拒绝
```

校验顺序：

1. multer 大小/文件数限制（413 / 400）
2. 扩展名白名单
3. MIME 白名单
4. PNG/JPEG/WebP 文件魔数
5. 结构/尺寸探测（PNG IHDR、JPEG SOF、WebP VP8X/VP8/VP8L）
6. 宽高 > 0，像素数 <= 限制
7. SHA-256、原图尺寸写入 meta

当前实现是**结构/尺寸可解析检查**，不是完整像素解码；完整解码应放到真实 worker 或后续图片库阶段。该限制会在验证报告中明确记录。

---

## 5. 状态机

本切片使用 fake job 专用状态：

```text
uploaded
  -> queued
  -> fake_processing
  -> mock_helpers_ready

uploaded / queued / fake_processing
  -> cancelled

queued / fake_processing
  -> failed
```

- 不使用 `helpers_ready`，避免让用户误以为真实识别完成。
- 所有任务与 artifact 都标记：
  - `workerMode: "fake"`
  - `isMock: true`
  - `resultKind: "synthetic_test_result"`
  - `aiExtractionPerformed: false`
- `mock_helpers_ready` 是明确标记的合成测试终点。
- `mock_helpers_ready` 不允许 cancel（409 `JOB_NOT_CANCELLABLE`）。
- 不允许从 ready 倒退到 processing。

---

## 6. Fake worker 边界

文件：

```text
server/flowchart-excel/worker.js
```

只生成：

| Artifact | 内容 |
|---|---|
| `job-manifest.json` | 任务元数据、mock 标记、图片 hash/尺寸、无路径 |
| `mock-result.json` | 固定 synthetic lanes/nodes/edges，明确 `is_mock` / `ai_extraction_performed:false` |
| `mock-report.md` | 声明未执行图片识别、未调用模型 |

明确不生成：

```text
flowchart.json
nodes.csv
edges.csv
style.json
conversion_report.md
```

不读取图片像素，不做 OCR，不调用模型，不发送图片。

上传图片只写入私有 storage；fake worker 不分析内容。

---

## 7. TTL 与清理

- `expiresAt` 默认 7 天，可按 `retentionMs` 注入。
- `cleanupExpired()` 惰性扫描 `storage/flowchart-excel/<uuid>/meta.json`，删除过期目录。
- 在任务列表请求时调用 cleanup；本切片没有常驻清理定时器。
- 生产应复用现有 runner/TTL 定时器或新增独立 cleanup worker。
- 测试用 `retentionMs=5` 验证过期清理。

---

## 8. 测试

命令：

```bash
node --test tests/flowchart-excel/routes.test.js
node --test tests/flowchart-excel/jobs.test.js
npm test
```

覆盖：

- 未认证上传 401
- 跨源 POST 403
- PNG/JPEG/WebP 上传
- 错误扩展名/MIME/魔数
- 超大文件 413
- 不可解析图片 400
- 多文件拒绝
- 非法/不存在 job ID 404
- owner A/B 隔离（状态/artifacts/下载/取消）
- artifact 路径 traversal 404
- fake flags/artifact 名称与内容
- cancel 前置状态、ready 后 409
- fake failure `WORKER_FAILED` 且不泄露路径
- TTL 清理
- 现有 Slice 1 45 测试仍通过

---

## 9. 生产数据库提案（本次不执行）

推荐在真实 worker 接入前新增：

```sql
CREATE TABLE flowchart_jobs (
    id UUID PRIMARY KEY,
    owner_username TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    source_ext TEXT NOT NULL,
    mime_type TEXT,
    file_size BIGINT,
    image_width INTEGER,
    image_height INTEGER,
    status TEXT NOT NULL,
    progress SMALLINT NOT NULL DEFAULT 0,
    progress_message TEXT,
    source_path TEXT,
    source_sha256 TEXT,
    template_profile_id TEXT NOT NULL DEFAULT 'trade_purchase_cn',
    template_profile_version TEXT NOT NULL DEFAULT '1.0.0',
    artifacts_json JSONB,
    warnings_json JSONB,
    unresolved_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    worker_version TEXT,
    is_mock BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);
```

本次只提出 schema，未创建 migration。

---

## 10. 下一阶段

进入真实图片识别前必须先完成：

1. 评审本切片 API/存储/owner 权限；
2. 决定是否将 file-backed store 迁移到 `flowchart_jobs`；
3. 配置并授权真实视觉模型端点；
4. 明确图片来源外发授权；
5. 用真实 worker 替换 fake worker，并生成正式辅助文件；
6. 保持 `template_profile_id=trade_purchase_cn`；
7. 保持 `edit_as=pending`，直到导出器完成 anchor 对照测试；
8. 不在本阶段生成 XLSX。

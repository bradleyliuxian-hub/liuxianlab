# Flowchart-to-Excel — Project Archived

- 状态：**PAUSED / ARCHIVED**
- 决策：停止继续开发；不继续修复 Golden Fixture、connector、布局、样式或导出器；不进入下一阶段。
- 封存日期：2026-10-21
- 仓库：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- 当前 branch / HEAD：`main` / `28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- 工具 slug：`flowchart-excel`
- 当前产品状态：`coming-soon`
- 正式导出：`exportReady=false`；`edit_as=pending`（未修改）

> 事实优先级：真实代码与 Git > 本档案 > 聊天摘要。历史报告中的测试结果不代表当前重新运行结果；本档案单独标注来源和日期。

---

## 1. 项目目标与原始业务流程

目标：把流程图图片转换为可编辑的 Excel 原生流程图（shape + connector），用于审计/内部控制文档整理。

原始设计流程：

```text
用户上传流程图图片
  + 外部 AI 生成的辅助文件包 ZIP
  → ZIP 安全校验 / manifest / hash / Schema / reference 校验
  → 规范化 reviewed graph
  → 人工复核工作台（问题、节点、连线、泳道）
  → 目标模板 profile
  → 原生 Open XML Shape / Connector XLSX 实验
```

网站不调用 AI 识别图片；外部 AI 只在网站外生成辅助文件。正式导出必须通过 gate。

---

## 2. 已完成模块

以下为 `confirmed/current-code` 或 `documented`，以实际文件/报告为准：

### 2.1 外部辅助文件包导入

- `server/flowchart-excel/external-import.js`
- `services/flowchart_excel/legacy_adapter.js`
- `docs/agent/flowchart-excel/slice3-2-external-helper-import.md`
- 支持 manifest、flowchart、CSV、style、report、可选 overlay。
- 外部 AI 模式 `external_ai`；网站侧 `aiExtractionPerformedByWebsite=false`。

### 2.2 ZIP 安全与 Schema/reference 校验

- `server/flowchart-excel/safe-zip.js`
- `services/flowchart_excel/manifest_validator.js`
- `services/flowchart_excel/validator.js`
- `services/flowchart_excel/reference_validator.js`
- `docs/agent/flowchart-excel/flowchart.schema.json`
- `docs/agent/flowchart-excel/manifest.schema.json`
- 路径穿越、重复文件、加密、符号链接、嵌套 ZIP、解压炸弹、hash 校验。

### 2.3 任务权限与 artifact allow-list

- `server/flowchart-excel/service.js`
- `server/flowchart-excel/routes.js`
- `server/flowchart-excel/artifacts.js`
- 任务按 owner 隔离；artifact 通过 allow-list/ID 解析；下载在认证后返回。

### 2.4 人工复核工作台与 revisions

- `server/flowchart-excel/review.js`
- `private/tools/flowchart-excel/review.html/css/js`
- `docs/agent/flowchart-excel/slice4-review-workbench-architecture.md`
- 支持问题清单、原图定位、节点/连线/泳道编辑、保存、revision 历史、approve、bulk review。
- 复核通过不会自动打开正式导出。

### 2.5 .NET / Open XML 原生导出实验

- `tools/flowchart-excel-exporter-poc/`
- `tools/flowchart-excel-layout/`
- `tools/flowchart-excel-visual-fix-v4/`
- 原生 `xdr:sp` / `xdr:cxnSp`、`stCxn` / `endCxn`、twoCellAnchor、custGeom 实验。
- V1–V4 均为实验产物，不是正式客户 XLSX。

### 2.6 Golden Fixture

- `tools/flowchart-golden-fixture-phase1/`
- 9 节点 / 2 泳道 / 9 边合成图。
- 静态映射、端点几何、三态 QA、profile token、shared grid 检查。
- 2026-10-21 追加 package repair：修正 content types / relationships；修复版仍等待真实 Excel 验收。

---

## 3. 已验证的能力与证据

### 3.1 结构与导入

```text
Slice 3.2 / 3.3：外部辅助文件导入、manifest/hash、Schema/reference、ZIP 安全
Slice 4：复核工作台、保存、问题状态、revision、approve
```

证据：

```text
docs/agent/flowchart-excel/slice3-2-validation-report.md
docs/agent/flowchart-excel/slice3-3-validation-report.md
docs/agent/flowchart-excel/slice4-validation-report.md
tests/flowchart-excel/*.test.js
services/flowchart_excel/tests/
```

### 3.2 Golden Fixture 静态验收

```text
9 shapes / 9 connectors / 9 stCxn / 9 endCxn
9 条逻辑边各一个 connector
端点与绑定侧中心 0.0px
route status: clear 8 / confirmed_collision 0 / indeterminate 1（GE09）
Open XML SDK validator: 0 errors
package audit（修复后）: 38/38 PASS
```

证据：

```text
docs/agent/flowchart-excel/golden-fixture-phase1-report.md
docs/agent/flowchart-excel/golden-fixture-connector-map.md
docs/agent/flowchart-excel/golden-fixture-package-repair-report.md
tools/flowchart-golden-fixture-phase1/output/package-repair-v1/
```

### 3.3 历史 Mac Excel 证据（仅旧 anchor 候选）

```text
Slice 5.1：Mac Excel 16.113.1，A/B 移动/保存/重开/行列调整后 58/58 绑定 PASS
```

这只对应旧 anchor 候选，**不能外推**到 V4 或 Golden Fixture。

---

## 4. 未解决的问题

1. **Golden Fixture 原始 XLSX 在 Excel 中触发修复提示并消失。**
   - 已确认原始包缺少 `/xl/workbook.xml` Override，`Default xml` 错误等于 workbook main，关系 Target 为绝对路径。
   - 已生成 package repair 修复版；但修复版 **Mac/Windows Excel 仍为 NOT RUN**，不能声称已解决。
2. **V4 大图布局/路由/样式未通过视觉 QA。**
   - 泳道、图例、控制标记、分支标签、模板样式仍有偏差。
   - custGeom connector 的真实 Excel 编辑/重排行为未验收。
3. **打印可读性未定版。**
   - 10pt × 48% 约 4.8pt；单页 A3 高度余量约 0.9pt。
   - Mac/Windows 打印预览未执行；LibreOffice 预览不能替代 Excel。
4. **Windows Excel 验收缺失。**
   - 63 节点业务规模候选没有 Windows 真实 Excel 结果。
5. **`edit_as` 仍为 pending。**
6. **正式 `exportReady` 仍为 false。**
7. **V4 / layout 代码不在网站 Git 仓库内。**
   - 位于 `~/AI-Workspace/tools/`，缺少可重放的版本基线。
8. **CJK 字体/预览风险。**
   - 本机 LibreOffice headless 未渲染 Microsoft YaHei UI 中文字形；真实 Excel 字体回退未验收。

---

## 5. 最后已知测试结果与时间

### 5.1 封存操作前基线（2026-10-21，本任务实际运行）

```text
node --test tests/flowchart-excel/*.test.js = 115 pass / 0 fail
npm test = 400 pass / 0 fail
GET /health = {"ok":true}
```

### 5.2 Golden Fixture（2026-10-21 报告与本次任务）

```text
Phase 1 .NET = 19 pass / 0 fail
Phase 1 Node schema/reference = 5 pass / 0 fail
Phase 1 Python = 6 tests OK
Phase 1 static validation = 73 checks PASS
Package audit repaired = 38/38 PASS
Package audit broken = FAIL (6 项)
Open XML SDK validator = 0 errors
POC .NET = 14 pass / 0 fail
```

来源：

```text
docs/agent/flowchart-excel/golden-fixture-phase1-report.md
docs/agent/flowchart-excel/golden-fixture-package-repair-report.md
```

### 5.3 封存状态完成后（2026-10-21，本任务实际运行）

```text
node --test tests/flowchart-excel/*.test.js = 123 pass / 0 fail
npm test = 408 pass / 0 fail
services/flowchart_excel Python = 14 tests OK
GET /health = {"ok":true}
```

### 5.4 历史结果（不冒充当前重跑）

```text
Slice 5.1 Mac anchor A/B = PASS（旧候选，2026-10-20）
V2/V3/V4 视觉 QA = FAIL（2026-10-20）
V4 Mac/Windows Excel = NOT RUN
Windows 目标业务规模 = NOT RUN
```

---

## 6. 重要文件与代码索引

```text
网站代码
  server/flowchart-excel/
  services/flowchart_excel/
  private/tools/flowchart-excel/
  tests/flowchart-excel/
  config/tools.json

文档
  docs/agent/flowchart-excel/
  docs/agent/flowchart-excel/archive/

独立实验
  /Users/a123/AI-Workspace/tools/flowchart-excel-exporter-poc/
  /Users/a123/AI-Workspace/tools/flowchart-excel-layout/
  /Users/a123/AI-Workspace/tools/flowchart-excel-visual-fix-v4/
  /Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/

候选 XLSX / 报告
  ~/Downloads/flowchart-excel-*（V1–V4、anchor、visual QA、Golden Fixture）
```

逐项路径、SHA-256 和验证状态见 `ARTIFACT-INDEX.md`。

---

## 7. 恢复项目的步骤

不要直接打开 `exportReady`。建议顺序：

1. 阅读本档案、`ARTIFACT-INDEX.md`、`replan-phase0-root-cause-report.md`、`golden-fixture-package-repair-report.md`。
2. 在维护窗口把 `config/tools.json` 的 `flowchart-excel.status` 从 `coming-soon` 改回 `ready` 或项目约定的开发状态。
3. 前端：移除/隐藏 Coming Soon 横幅，恢复上传页与复核页写按钮；保留只读历史。
4. 后端：`server/flowchart-excel/routes.js` 的 `comingSoon` 由配置派生；确认配置改回后重启服务以加载 gate 状态。
5. 先验证 Golden Fixture 修复版在 Mac/Windows Excel 能正常打开、无修复提示。
6. 再按 Phase 2 connector spike、Phase 3 样式、Phase 4–8 的顺序继续；不要一次改全部。
7. 任何正式导出仍需原有 export gates；不得因为恢复页面而自动打开 `exportReady`。

回滚细节见 `coming-soon-rollback.md`。

---

## 7.1 生产依赖说明（2026-10-21 修正）

`services/flowchart_excel/requirements.txt` 已移除。Flowchart-to-Excel 当前为
PAUSED / Coming Soon，写接口已被 gate，历史任务只读；生产不需要为该归档模块安装
Pillow 或创建 `.flowchart-venv`。

如果未来恢复真实图片校验/视觉 worker，需要重新评审并安装 Pillow 到专用环境
（不要直接把 per-service manifest 重新加入生产部署路径）；详见
`slice3-real-image-worker-architecture.md` 和 `slice3-validation-report.md`。

## 8. 明确声明

- 当前没有正式客户 XLSX 生成能力被验收为可交付。
- 所有实验 XLSX、V1–V4、Golden Fixture 均为研究/回溯产物。
- 本次封存没有删除代码或数据。
- 本次封存没有生成 XLSX。
- 本次封存没有调用 AI。
- 本次封存没有更改数据库。
- 本次封存没有修改 approved graph、revision history 或 `exportReady` / `edit_as`。
- 本次封存没有重启 8080、没有提交或推送 Git。

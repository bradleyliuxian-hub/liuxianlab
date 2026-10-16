# UI Standards Install Report — Liuxian Lab Design System 接入

日期：2026-10-16
任务：把 `docs/design-tokens.md` + `docs/ui-guidelines.md` 接入现有项目（项目级 Design System / UI Governance 初始化）。
原则：先读规范 → 检查现有栈 → 最小安全接入 → 修复已知视觉基础问题。**未重做业务。**

---

## 0. 技术栈现状（先检查，未猜测）

- 前端：**无框架**（Vanilla HTML/CSS/JS）；无 React/Vue/Next；**无 TypeScript**；无 Tailwind/CSS Modules/styled-components。
- Node：CommonJS（Express）仅做认证与静态分发；无打包步骤。
- Token 现状（CSS variables）：`public/login.css`（自成体系，值已符合规范）、`private/styles.css`（App Shell）、`private/app-shell.css`（工具页桥接）、`private/tools/*/styles.css`、`private/tokens.css`（旧，未引用）。
- Excel/Grid：`private/shared/excel-viewer/*`（自研虚拟化）。
- 认证：`server.js`（bcrypt + express-session FileStore）。

## 1. 新增文件

- `docs/design-tokens.md`（规范，逐字安装；`docs/` 已存在，无同名冲突）
- `docs/ui-guidelines.md`（规范，逐字安装）
- `private/design-tokens.css` —— **项目级 Design Token 单一来源**：`--color-*` 语义 token（light `:root` / dark `body.dark` + `[data-theme="dark"]`），并把项目既有变量名（`--page/--surface/--text/--muted/--line/--accent/--primary/--blue/--navy/...`）**别名映射**到语义 token，附带 radius / shadow / spacing / type。

## 2. 修改文件（本次）

- `private/index.html`、`private/tool.html` 及 6 个工具页 `private/tools/{contract-review,excel-decimal-check,excel-hardcode-check,excel-review,excel-standardizer,sales-income-analysis}/index.html`：在 `<head>` 首位加入 `<link href="/app/design-tokens.css?v=1.0.0">`（作为**基础层**，既有样式随后覆盖，保证零回归）。
- 未改任何 `.js` 业务逻辑、`public/login.*`、`server*`。

> 说明：`private/tools/_template/index.html` 的改动来自**上一轮 UI V1 安装**（shell 资源标签），本次未再改它。

## 3. Token 系统（如何接入）

- 采用 **CSS variables**（项目既定方式），未引入第二套体系。
- `private/design-tokens.css` 是语义权威层（`--color-brand-primary`、`--color-text-primary`、`--color-surface`、`--color-border`、`--color-bg`、状态色、radius、shadow、spacing、type、`--shadow-focus`）。
- **迁移策略**：既有组件变量（`--page/--surface/--text/--muted/--line/--accent/...`）已在该文件内映射到语义 token；文件作为基础层加载，既有页面样式（已在同一调色板）继续生效 → **零视觉回归**，后续组件可直接使用 `--color-*`，逐步以内联 hex 收敛为 token。
- 登录页为**公开页**（不能加载 `/app/*`），其 `public/login.css` 采用与规范一致的独立变量（`#0B5BD3/#061A3A/#0F172A/#475569/#64748B/#F6F8FB/#FFFFFF/#D9E2EC` + 暗色 `#06101F/#0B1B31/#10233D/#F8FAFC/#CBD5E1/#94A3B8`）——等价语义值，已在文档中标注。

## 4. 已修复的问题（逐项，含“未修改”的如实说明）

| 问题 | 状态 |
|---|---|
| **蓝底黑字** | 已修复（此前 pass 已处理，本次 token 化确认）：深/品牌蓝底一律白字（`.tool-mark/.step-no/.download-button/.locate-button/.vwr-tab.active/...`），风险徽标使用浅底深字。 |
| **Dark mode contrast** | 已修复（此前 pass）：五级文字层级 `#F8FAFC / #CBD5E1 / #94A3B8`；表面 `#06101F / #0B1B31 / #10233D`；不再灰底灰字。本次新增 `docs` 规范并统一 token 值。 |
| **Excel 横向滚动** | 已修复（此前 pass，实测）：`scrollLeft` 可达 0 与 max。 |
| **Excel A 列可达** | 已修复（此前 pass，实测）：focus 模式不再对列做“居中窗口”，横向渲染 A..末列。实测 `left.firstCol='A'`。 |
| **Excel 纵向滚动** | 已修复（此前 pass）：全表画布 + 虚拟窗口。实测 `top.firstRow=1`。 |
| **第 1 行可达** | 已修复（实测 `scrollTop=0 → 行1`）。 |
| **repeated jumping / remount** | 已修复（此前 pass）：单一滚动引擎、单实例 Viewer、ResizeObserver 观察固定 frame、reveal 一次性。 |
| **Sidebar** | 已修复/正常（此前 pass）：Desktop 折叠/展开可用（含 rail 级展开按钮）；Mobile 抽屉 + backdrop + ESC + 滚动锁。 |
| **Dropdown 浮层** | 已修复（此前 pass）：Portal 到 `<body>` + `position:fixed` + 视口内 + 上翻。 |

> 本轮验证（实测）：`probe-scroll` → `top.firstRow=1`、`bottom.firstRow=1062/lastRow=1100`、`left.firstCol='A'`、`right.firstCol='W'`、reveal 居中一次；溢出矩阵 1440/1280/1024/768/390/375 → 工作台与工具页 `overflowX=0`。

## 5. 业务安全

- **Authentication: unchanged**（未改 `server.js`/`server/**`/`login.js` 提交流程/session/cookie）。
- **API: unchanged**（未改任何 endpoint / contract）。
- **Business logic: unchanged**（未改 `decimal-core/risk-core/reference-map/business-type/decimal-workbook/issue-filters`、hardcode 模块、`viewer-core`、`ooxml-highlight`、导出逻辑、`services/**`、`workers/**`、迁移）。
- 唯一 JS 改动为**上一轮**已完成的查看器稳定性与登录文案/样式（属 UI 层，非业务算法）。

## 6. 验证结果（真实）

- **TypeScript**：N/A —— 项目无 TypeScript（无 `tsconfig`、无 `.ts/.tsx`）。
- **Lint**：N/A —— 未配置 ESLint/Prettier。
- **Build**：N/A —— 原生 HTML/CSS/JS，无打包步骤（Express 直接静态分发）。
- **Tests**：`npm test`（`node --test`）→ **216 pass / 0 fail**。
- `node --check`（已改/相关 JS）：通过。
- 真实服务：`GET /login` 200；`/health` `{"ok":true}`。
- 视觉核验（无头 Chrome，同源）：工作台 light/dark、工具页 light/dark、登录 light/dark、移动端 390 —— 正常，无横向溢出。
- Excel 网格：A 列/第 1 行/末行/末列可达，无重复跳动/滚动重置。

## 7. 后续约定（写入规范后生效）

- 所有新 UI：先读 `docs/design-tokens.md` + `docs/ui-guidelines.md` → 复用 `--color-*` token 与既有组件 → 再开发页面。
- 需要新颜色时先定义 **semantic token**（如 `--color-tool-accent`），禁止在组件内散写 hex。
- 改全局 token 前：搜索用法 → 检查 light/dark → 检查表格/Excel 网格 → 检查认证/Sidebar/移动端 → 运行测试。

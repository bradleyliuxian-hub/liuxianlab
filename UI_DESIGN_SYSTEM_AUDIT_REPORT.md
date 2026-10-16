# UI_DESIGN_SYSTEM_AUDIT_REPORT.md
# Liuxian Lab — Design System Audit + Visual QA (第二阶段)

日期：2026-10-16
性质：审计为主 + 最小范围修复。**未重构业务、未改认证/API/Excel 算法。**
参考：`docs/design-tokens.md`、`docs/ui-guidelines.md`、`UI_STANDARDS_INSTALL_REPORT.md`。

---

## 1. Token Audit（是否单一来源）

- 技术栈：Vanilla HTML/CSS/JS，CSS variables（无 Tailwind/TS）。
- 本次将品牌色来源**收敛为单一文件**：`public/design-tokens.css`（语义 `--color-*` + 主题感知的别名层），通过新增**非认证静态路由** `/design-tokens.css` 提供给公开登录页与所有私有页面。
- 移除重复/失效：
  - 删除 `private/design-tokens.css`（上一轮的私有副本）。
  - 删除 `private/tokens.css`（早已未被任何页面引用）。
- 结果：登录页与 App/工具页现在引用**同一个** `design-tokens.css`；不再存在两套品牌色。
- ⚠️ **审计中发现并修复了一个 Critical**：别名层（`--bg/--text/...`）原先只声明在 `:root`，导致 `body.dark` 修改 `--color-*` 后**别名不随之改变** → 登录页暗色模式右侧面板仍是浅色。修复：别名层改为 `:root, body.dark, [data-theme="dark"]` 选择器（主题感知）。已复测通过。

## 2. Hardcoded Color Audit（分类）

各文件 `hex/rgb(a)/hsl(a)` 计数：`styles.css 149`、`app-shell.css 144`、`design-tokens.css 65`、`tool styles 45–65`、`login.css 64`（含已删除的本地 token；删除后下降）。

- **A｜合法例外（保留）**：品牌面板/侧栏的 navy 渐变（`#0b2348/#071b3a`）、阴影 `rgba()`、遮罩 `rgba()`、focus ring `rgba()`、深色状态软底（`#2A2110` 等）。
- **B｜应迁移到 token（建议，未批量改）**：工具旧样式中的零散字面量，如公式绿 `#2f6d2f`、进度渐变 `#9de51d`、问题黄 `#fff2cc` / 选中 `#dceeff`+`#4a90e2`、`vwr-tab` 等。**多数已被 `app-shell.css` 的 token 桥接覆盖/重着色**；原字面量仅作为回退，故列为 Medium（后续以内联 hex 收敛为 `--color-*`）。
- **C｜第三方**：无（`private/vendor/*` 为 JS 库，不产 UI 颜色；Viewer CSS 为自研）。
- **D｜数据可视化/语义**：风险等级色（danger/warning/success/info）与 Excel 风险格子着色——**属数据语义，保留**（已在 `design-tokens` 定义状态色，且 `app-shell` 用企业风险调色板覆盖）。
- **E｜状态色**：success/warning/danger/info——已 token 化；个别 `-soft` 深色变体为合法状态色。

结论：**未盲目替换颜色**；仅收敛重复 token 文件，B 类给出迁移建议。

## 3. Login Audit

- 文案与层级符合规范：`LIUXIAN LAB · PRIVATE WORKSPACE` → `专注专业工作，/洞察从这里开始` →（副标题已按要求移除）→ `企业级工作环境` → `MEMBER ACCESS` → `进入你的专业工作空间` → `登录工作台`。
- Colors：主蓝 `#0B5BD3` 按钮 + 白字；输入白底/`#CBD5E1` 边/`#0F172A` 文本/`#64748B` placeholder；focus 品牌蓝 ring。
- Desktop / Tablet / Mobile：≤900 品牌面板折叠到顶部、表单占主；≤520 输入/按钮 50px。
- **Light/Dark 均正常**（修复别名问题后复测）。无灰底灰字、无蓝底黑字、placeholder/icon 对比达标。

## 4. Dark Mode Audit

- Token：`bg #06101F`、`surface #0B1B31`、`raised #10233D`、`border #203653`、`text #F8FAFC/#CBD5E1/#94A3B8`、`primary #3B82F6`。
- 覆盖检查：按钮（蓝底白字）、输入（深底浅字浅边）、表格（表头 vs 正文分明）、Excel（网格/选中/风险）、Dropdown（门户暗色）、Sidebar（navy 常暗 + active 蓝）、Badge、Toast、Tooltip/Notice。
- **未发现** 深蓝底+深蓝字 / 蓝底黑字 / 深底不可读灰字（App 与工具页经此前 pass 已修复并由 token 保障）。

## 5. Sidebar Audit

- Desktop：浮动 navy 面板、圆角、轻微环境阴影、Active 蓝色指示、折叠/展开可用（含 rail 级展开按钮）。
- Mobile：抽屉 + backdrop + ESC + `body.drawer-open` 滚动锁；导航后自动关闭。
- 未发现巨大阴影/霓虹/过度玻璃拟态。

## 6. Excel Viewer Audit（仅 UI/滚动，未改算法）

实测（`probe-scroll`，1000 行 × A–Z，选中 Q325）：
- `scrollTop=0 → 第 1 行`；`scrollLeft=0 → A 列`；`scrollTop=max → 第 1062..1100 行`；`scrollLeft=max → 末列(W..)`。
- reveal 一次性居中（首行 302），**不循环自动居中**；无重复 mount（单实例）；ResizeObserver 观察固定 frame；无滚动位置重置。
- 横向/纵向滚动条稳定；Dropdown 门户不被 Excel 容器裁剪（Portal 到 `<body>`）。
- 结论：A 列可达、第 1 行可达、首末均可达、无反复跳动。

## 7. Responsive Audit

- 溢出矩阵（`documentElement.scrollWidth - clientWidth`，工作台/工具页 iframe 390/375）：**全部 0**。
- 登录页 iframe 测宽：390 → 0；375 → 0；768 → 0。
- Excel：仅网格容器内横向滚动，**整页不横滚**。
- 断点：Login 1080/900/520；App 1180/820/680；工具页 1100/860/560。

## 8. Accessibility / Contrast Audit

- 文字层级：primary/secondary/tertiary 明确；暗色 primary 保持明亮。
- Focus：`--shadow-focus` 品牌蓝 ring；键盘可操作（按钮/输入/抽屉/下拉 ESC）。
- 触控目标：工具/移动端关键控件 ≥40–44px；登录 ≤520 输入/按钮 50px。
- 状态色不只靠颜色（风险徽标含文字：高风险/中风险/低风险/单独观察）。
- 无移除 outline 无替代；无低对比“高级感”文字。

## 9. Resource Loading Audit

- `GET /design-tokens.css`（真实服务，公开）：**200**，`Content-Type: text/css; charset=UTF-8`，内容包含 `--color-brand-primary`（16 处匹配）。
- 改动前 `GET /app/design-tokens.css`（未登录）：302 → `/login`（`/app` 受 `requireAuth`）→ 这正是登录页无法引用私有 token 的原因。
- 静态资源结构检查：`public/` 未做通用 static，公开资源走显式路由（`/login.css`、`/login.js`）；新增 `/design-tokens.css` 沿用同一模式（**仅静态资源，无认证逻辑**）。
- 私有页面：`private/index.html`、`private/tool.html`、6 个工具页引用 `/design-tokens.css`（对应正确）。

## 10. 修改文件（本次）

| 文件 | 变更 |
|---|---|
| `public/design-tokens.css` | **新增**：单一来源 tokens（`--color-*` + 主题感知别名层） |
| `server.js` | 新增 `/design-tokens.css` 静态公开路由（镜像 `/login.css` 模式；**不涉及认证/会话/API**） |
| `public/login.html` | 在 `login.css` 前引用 `/design-tokens.css` |
| `public/login.css` | 移除本地 `:root/body.dark` token 块，改为消费统一 token |
| `private/index.html`、`private/tool.html`、`private/tools/{contract-review,excel-decimal-check,excel-hardcode-check,excel-review,excel-standardizer,sales-income-analysis}/index.html` | token 引用由 `/app/design-tokens.css` 改为 `/design-tokens.css`（同一文件） |
| 删除 | `private/design-tokens.css`、`private/tokens.css`（副本/失效） |

## 11. 未修改文件（业务核心）

`server/**`（除静态路由外的业务路由未动）、`services/**`、`workers/**`、迁移、`decimal-core/risk-core/reference-map/business-type/decimal-workbook/issue-filters`、hardcode 模块、`shared/excel-viewer/*`（除此前 UI 稳定性修复）、`shared/excel-highlight`、`public/login.js` 提交/校验/跳转逻辑、session/cookie/权限、`config/tools.json`。

## 12. 测试结果（真实）

- **TypeScript：N/A**（项目无 TS/tsconfig）。
- **Lint：N/A**（未配置 ESLint/Prettier）。
- **Build：N/A**（无打包步骤）。
- **Tests：`npm test` → 216 pass / 0 fail。**
- `node --check server.js`：通过。
- 真实服务：`/health` ok；`/login` 200；`/app/*` 302（认证未变）；`/design-tokens.css` 200。
- 浏览器核验：Login Light/Dark、Dashboard Light/Dark、Tool Light/Dark、Mobile 390 —— 正常。

## 13. 剩余问题（分级）

- **Critical: 0**（本轮发现并已修复 1 个 Critical：token 别名导致登录暗色失效）。
- **High: 0**
- **Medium: 2**
  1. 工具旧样式仍含 B 类零散字面量（公式绿 `#2f6d2f`、进度渐变 `#9de51d`、问题黄 `#fff2cc` 等）——已被 `app-shell` 主题覆盖，但未收敛为 `--color-*`（建议后续随改动逐步替换，勿一次性批量）。
  2. `public/login.css` 仍有少量字面量暗色变体（如 `.status-message` 暗色文字 `#9CC3FF/#FCA5A5/#6EE7B7`）——建议映射为状态 token。
- **Low: 1**
  1. 语义 token 文档与实际别名（`--page/--muted` 等）并存；后续新代码应统一用 `--color-*`，避免继续新增别名用法。

## 14. 建议

1. 新 UI 一律使用 `--color-*`；旧别名为兼容保留，逐步淘汰。
2. 收敛 Medium-1/2：把零散字面量替换为 `var(--color-*)`（分文件、可验证地做，不做全量 sweep）。
3. 若未来引入 `prefers-color-scheme` 自动主题，直接复用 `[data-theme="dark"]`（已在 token 文件预留）。
4. 保持 `/design-tokens.css` 为唯一品牌色入口；禁止再新增颜色体系。

---

### 业务安全声明
- Authentication：**unchanged**（仅新增公开静态 CSS 路由，未触碰认证逻辑）。
- API contract：**unchanged**。
- Excel 业务计算/风险检测/解析/下载：**unchanged**。

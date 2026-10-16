# UI_REPAIR_REPORT.md — Liuxian Lab UI V1 修复 / 集成 / 功能 QA

日期：2026-10-16
范围：**在保留 UI V1 视觉的前提下**，修复 Sidebar / 导航 / 认证集成 / 移动端 / 交互回归。
未重新设计、未改颜色/Layout/Card，未新增框架，未改业务。

---

## 1. 已发现的问题（基于实际交互探针，非猜测）

用无头 Chrome 对真实页面**模拟点击**（同源 iframe 探针）逐一验证，发现：

| # | 问题 | 证据 |
|---|---|---|
| P1 | **断点不一致导致 821–900px 侧栏不可用**：CSS 在 `≤900px` 把侧栏变成 off-canvas 抽屉并显示汉堡，但 JS（`script.js`）的移动阈值是 `≤820px`，`openSidebar()` 在 `width>820` 直接 return → 该区间点击汉堡无反应，侧栏既不可见也打不开。 | 探针 @880：`menuVisible:"grid"`、`sidebarOpen:false`（点击后仍 false） |
| P2 | **桌面折叠后无法再次展开**：折叠时 `.nav-panel{opacity:0;pointer-events:none;width:0}`，而折叠按钮 `#navCollapseButton` 就位于该面板内（且被 `opacity:0` 隐藏）→ 真实用户点击不到，永久塌陷。 | 探针 @1440：折叠后 `panelCollapse:"none"`，页面内无可点击的展开控件 |
| P3 | **移动抽屉缺少 body 滚动锁**：抽屉打开时背景仍可滚动（规范要求锁滚动）。 | 代码检查：`openSidebar/closeSidebar` 未切换任何锁滚动 class |
| P4 | **通用占位工具页未接入共享外壳**：`tool.html` 根节点是 `.tool-page`，而共享外壳（`app-shell.js`/`app-shell.css`）只匹配 `.page-shell` / `.tool-shell` → 占位页无 rail、未被主题化。 | 选择器核对 + 探针 |

> 说明：认证（登录/会话/受保护路由/登出）经实测**本身工作正常**（见 §5）；截图中“登录/用户状态异常”的表象，根因是上面的侧栏/抽屉不可用，而非认证被破坏。

## 2. Sidebar 原因

- P1：样式与脚本使用了两个不同的移动断点（CSS 900 / JS 820）。
- P2：折叠态把承载“展开”按钮的整个面板隐藏（opacity + pointer-events），却没有提供替代的展开入口。

## 3. Sidebar 修复方式（最小改动，保留 V1 视觉）

- **对齐断点**：`private/styles.css` 将 `@media (max-width: 900px)` 改为 `@media (max-width: 820px)`（与 `script.js` 的 820 阈值一致）。桌面（>820）保持浮动 rail + panel 与折叠；移动（≤820）保持抽屉。原 821–900 的死区消失。
- **折叠后可展开**：`private/index.html` 在 rail 底部新增 rail 级展开按钮 `#navCollapseButtonRail`（chevron），`private/styles.css` 规则：
  - `.rail-collapse{display:none}`（展开态隐藏）
  - `body.nav-collapsed .rail-collapse{display:grid}`（折叠态显示）
  - `body.nav-collapsed .panel-collapse{display:none}`（折叠态隐藏面板内按钮）
  `private/script.js` 将 rail 按钮绑定到同一 `toggleNavigation`，并在 `updateCollapseButton()` 同步 `aria-label/title/aria-expanded`（对两个按钮）。
- 结果（探针）：@1440/@900/@830 折叠 → `grid 316→84`、`railCollapse:grid`；点 rail 展开 → `grid 84→316`、`panelCollapse:grid`。✅

## 4. Login 原因

- V1 仅替换了 `public/login.css`（视觉层），`login.html`/`login.js` 与 HEAD 完全一致（已 diff 确认）。登录本身未损坏。
- 实测：`GET /login` 200；`POST /api/login` 空值 → 400，错误凭据 → 401（JSON）；受保护路由未登录 → 302 `/login`。**未做任何修改。**

## 5. Authentication 修复方式

- **无需修复**。`server.js` 的 `requireAuth`、`sameOriginForStateChange`、登录/登出、会话（FileStore）、`/api/session`、`/api/tools` 全部未改动。
- UI 只**消费**认证状态：`script.js#loadSession()` 读取 `/api/session` → 写入 `#sidebarUsername`、`#greetingUsername`、`#userAvatar`、`#topAvatar`（动态首字母，非写死）；`loadTools()` 读取 `/api/tools`；登出调用真实 `POST /api/logout` 后 `location.replace('/login')`。
- 未改 `login.js`、未写死用户名、未用 mock auth、未用 localStorage 代真认证。

## 6. Mobile Drawer 修复

- 断点对齐后（≤820），`#mobileMenuButton` 显示，点击 `openSidebar()` → `.sidebar-zone.open` + backdrop 显示 + `body.drawer-open`。
- 支持：点击遮罩关闭、`Escape` 关闭、点击导航项后 `closeSidebar()`（沿用原逻辑），且 backdrop 为 `blur(7px)` 半透明。
- 探针：@820/@800/@390 → 点击菜单 `sidebarOpen:true, drawerOpen:true, backdrop:visible`；ESC → 全部复位。✅

## 7. Responsive 修复

- 单一移动阈值 **820px**（CSS 与 JS 一致）：>820 桌面（浮动 rail+panel、可折叠），≤820 抽屉；≤680 进一步收紧（隐藏面包屑/键盘提示、单列卡片、抽屉更窄）。
- 实测无横向溢出：`documentElement.scrollWidth - clientWidth = 0`，覆盖 1440 / 900 / 830 / 820 / 800 / 390（工作台与工具页）。✅

## 8. JS 冲突

- 工作台：`script.js` 单文件单次加载，无重复初始化；键盘监听仅一处。
- 工具页：`app-shell.js` 有单例守卫 `if (!root || document.querySelector('.lx-shell-nav')) return;`，不会重复注入 rail/backdrop；其 `Escape` 监听只作用于工具页。
- 工作台脚本与 `app-shell.js` 不在同一页面同时加载（工作台用 `script.js`，工具页用 `app-shell.js`+各自 `script.js`），无同名冲突。
- 修复仅新增：`script.js` 绑定一个 rail 按钮 + 切换 `drawer-open` 类；无新增全局变量、无 MutationObserver、无高频监听。

## 9. CSS 冲突 / 作用域

- `app-shell.css` 使用 `body > .page-shell …` / `body > .tool-shell …` 作用域修饰，只影响工具页根节点与其直接子元素；token 桥接（`--page/--accent/--dark` 等）仅在该页面加载时生效。未对全站 `button{}`/`input{}`/`header{}` 做全局覆盖。
- 工作台 `styles.css` 为独立文件；两者不互相加载。
- 修复：将 `tool.html` 根节点改为 `class="tool-page tool-shell"`，使其被共享外壳覆盖（保留 `tool.css` 的 `.tool-page` 布局）。

## 10. 修改文件（本次修复）

| 文件 | 修复内容 |
|---|---|
| `private/styles.css` | 移动断点 900→820；新增 `.rail-collapse` 折叠态显隐；`body.drawer-open{overflow:hidden}`；移除失效的折叠按钮 absolute 规则 |
| `private/index.html` | rail 底部新增展开按钮 `#navCollapseButtonRail` |
| `private/script.js` | 绑定 rail 展开按钮；`openSidebar/closeSidebar` 切换 `body.drawer-open`；`updateCollapseButton` 同步两按钮 aria |
| `private/tool.html` | 根节点加 `tool-shell` 类，接入共享外壳 |

## 11. 未修改的业务文件（逐字未改）

`decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、`decimal-workbook.js`、`issue-filters.js`、hardcode 四模块、`shared/excel-viewer/*`、`shared/excel-highlight/*`、各工具业务 `script.js`、`server.js`、`server/**`、`services/**`、`workers/**`、迁移、`config/tools.json`、`package.json`、`login.js`。

## 12. QA 页面

工作台 `/`、`/tools/excel-decimal-check`、`/tools/excel-standardizer`、`/login`（视觉 + 交互）；
真实服务 `/login`、`/health`、未登录受保护路由跳转、`POST /api/login` 失败分支。

## 13. QA 结果

- 交互探针（无头 Chrome，同源）：侧栏折叠/展开 ✅；移动抽屉开/关/ESC ✅；drawer-open 锁滚动 ✅；工具页 rail 桌面显示、移动抽屉 ✅。
- 横向溢出：全部 0 ✅。
- `node --check`：`script.js`/`app-shell.js`/`tool.js`/`login.js`/工具脚本 全部通过。
- `npm test`：**216 pass / 0 fail**。
- 认证：`/login` 200；未登录 `/`、`/tools/*` → 302 `/login`；`/api/session` → 401；`POST /api/login` 错误 → 401 JSON。
- 真实服务 `/health` → `{"ok":true}`。

## 14. 已知问题 / 限制

- 受保护页面（`/`、`/tools/*`）的真实登录态截图未采集（无账号；创建测试账号会写 `data/users.json`，属改动项目）。改用同源 mock 渲染同一批文件做视觉/交互核验。
- 交互探针为程序化点击（`element.click()`）验证 DOM/class 状态；真实指针事件已通过 CSS（无 `pointer-events:none` 阻挡折叠入口）保证可点。
- 工具页顶部信封（通知）按钮为纯视觉元素（原项目无通知系统），不触发任何行为，不阻塞页面（符合要求）。
- 上一轮遗留的未引用文件保留未删：`private/tokens.css`、`UI_REDESIGN_SUMMARY.md`（V1 不引用）。
- `_template/index.html` 根节点无 `page-shell/tool-shell` 类，但其 slug 不在 `config/tools.json` 中（`/tools/_template` 会 404），不参与运行；未改动。

## 15. Business Logic Modified

```
Business Logic Modified: NO
```
本次仅修改 HTML/CSS 表现层与 `script.js`（工作台 UI 脚本）中的：一个 rail 按钮绑定、一个 `drawer-open` 滚动锁 class 切换、`aria` 同步。未触碰任何业务/认证/数据库/Excel 逻辑文件。

---

### 运行
```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```
未 commit / push。修复前工作区已备份至 `~/AI-Workspace/backups/liuxianlab-ui-before-v1-20261016-124814/`。

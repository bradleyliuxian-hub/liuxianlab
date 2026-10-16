# UI_REDESIGN_SUMMARY.md — Liuxian Lab 第一阶段 UI 重构

日期：2026-10-16
范围：**表现层（HTML/CSS + 少量 UI 脚本）**。业务逻辑、API、认证、数据库、Excel 计算/解析/导出模块**零改动**。

视觉定位：Enterprise / Consulting-grade（KPMG-inspired，非任何品牌仿制）。

---

## 1. 修改了哪些文件

| 文件 | 变更 |
|---|---|
| `private/tokens.css` | **新增**：统一 Design Tokens（颜色/阴影/圆角/间距/字号/动效 + 暗色） |
| `private/index.html` | App Shell 重构：Floating Sidebar + glass Topbar + Workbench |
| `private/styles.css` | 全部重写为新设计系统（Sidebar/Header/Cards/Sidebar 折叠/移动抽屉/响应式） |
| `private/tool.html` | 占位工具页改为与 App Shell 一致的 glass 顶栏 + 卡片舞台 |
| `private/tool.css` | 占位页样式重写 |
| `private/tools/excel-decimal-check/index.html` | 工具页重构：统一 glass 顶栏 + 面包屑 + 卡片 + 风险面板 + 复核工作台（所有 id 保留） |
| `private/tools/excel-decimal-check/styles.css` | 全部重写（含共享 viewer `.vwr-*` 与多选 `.ms-*` 的样式） |
| `public/login.html` | 版本号 + theme-color 更新 |
| `public/login.css` | 登录页重构（深蓝品牌面板 + 蓝色体系，自带 token） |
| `public/login.js` | 仅 theme-color 字符串更新 |

**未改动（业务核心）**：`decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、`decimal-workbook.js`、`issue-filters.js`、`hardcode-check/*`、`shared/excel-viewer/*`、`shared/excel-highlight/*`、`server.js`、`server/**`、`services/**`、`workers/**`、迁移、`config/tools.json`。两个工具页的 `script.js`、`viewer`/`highlight` 共享模块全部未改。

## 2. 新增了哪些组件/资产
- `tokens.css`（Design Token 单源）。
- Sidebar 结构（brand / side-nav / side-section / account / collapse）。
- Glass Topbar（breadcrumb + search + status + theme）。
- 统一 `.btn`（primary / secondary / ghost / block）。
- Risk Dashboard 卡片（`.risk-card` · 高/普通/公式/隐藏/百分比/不可判定）。
- Premium Drop Zone（`.drop-zone` + `.drop-icon`）。
- 复核工作台（清单 + 分隔条 + 查看器）样式；多选下拉（`.ms-*`）与查看器（`.vwr-*`）样式统一。
- 移动端：抽屉 Sidebar + backdrop；单列卡片。

## 3. 哪些业务模块没有修改
全部计算/解析/导出/风险/引用/筛选/汇率/高亮/认证/数据库逻辑（见上）。所有原有 DOM id 与 UMD 全局名保持不变，`script.js` 无需改动即可工作。

## 4. Design System（Token 清单，`private/tokens.css`）
- 品牌：`--color-primary #00338D`、`--color-primary-600 #1261D6`、`--color-primary-500 #2E90FA`、`--color-navy #071B3A`、`--color-primary-soft/-softest`。
- 中性/面：`--color-bg #F5F7FA`、`--color-surface #FFFFFF`、`--color-border #E4E8EF`、`--color-text #101828`、`--color-text-2 #667085`、`--color-muted #98A2B3`。
- 状态：`--color-success/warning/danger/info` + 各自 `-soft/-ink`。
- 阴影：`--shadow-xs..xl`（Sidebar=lg、Card=sm、Dropdown=md、Modal=xl）。
- 圆角：`--radius-sm 8 / md 10 / lg 14 / xl 18 / 2xl 22 / pill`。
- 间距：`--space-1..9`；字号：`--text-h1..micro`。
- 动效：`--motion-fast 120 / --motion 180 / --motion-slow 260`，`--ease cubic-bezier(.2,.8,.2,1)`。
- 暗色：`body.dark` 重映射同名字义 token。

## 5. Sidebar 如何实现
- **Floating**：`.sidebar` 为 `position: sticky` 的圆角面板（`--radius-2xl`），`--shadow-lg`，深海军蓝渐变（非纯黑），外边距 `--shell-pad`。
- Active：半透明白背景 + 左侧 3px 蓝色 indicator + 蓝色 icon；Hover：`rgba(255,255,255,.06)` + icon `translateX(1px)`。
- 折叠：`body.nav-collapsed` 由现有 `script.js` 切换 → 宽度 76px、仅图标、汉堡隐藏、`:hover` title 提示；`transition` 平滑。
- 由网格列宽驱动，页面不剧烈抖动。

## 6. Mobile 如何实现
- 断点 `≤860px`：Sidebar 变 **Fixed Drawer**（`translateX(-104%)` → `0`，圆角右缘，`--shadow-xl`），`#sidebarBackdrop` 应用 `rgba(7,27,58,.28)` + `backdrop-filter: blur(6px)`；点击遮罩 / ESC / 导航后自动关闭（沿用现有 `script.js` 行为）。
- Topbar 移动化：显示 `#mobileMenuButton`，隐藏 breadcrumb 前缀与状态药丸，搜索自适应。
- Tool grid：平板 2 列 → 手机 1 列；字号/内边距收敛；`env(safe-area-inset-*)` 适配。
- 经测量：390px 下 `scrollWidth == clientWidth`（**无横向滚动**）。

## 7. Excel Tool 如何升级
- 统一 App 视觉：glass `tool-topbar`（返回 + 品牌 mark + 标题 + 版本 + 本地处理徽标 + 主按钮）+ 面包屑。
- Premium Drop Zone、扫描选项、分析进度（进度条 + 阶段图例）、下载卡片。
- Risk Dashboard：6 张浅色系风险卡（高=浅红、普通=浅橙、公式/百分比=浅蓝、隐藏=蓝、不可判定=中性）。
- Risk Review Workspace：左清单（风险左色条 + chip + 引用统计）+ 可拖分隔条 + 右 Excel Viewer。
- **业务交互全部保留**：筛选 / 搜索 / 排序 / 上一个 / 下一个 / F5 / 复制地址 / 定位 / 下载问题清单 / 标黄对比 / 重置。

## 8. Responsive 如何实现
- 断点：`1200 / 1100 / 1024 / 860 / 560`（+ `prefers-reduced-motion`）。工具页另有 `1200/1100/860/560`。
- 桌面：Floating Sidebar + 3 列卡片；平板：折叠/抽屉 + 2 列；手机：Drawer + 单列 + 堆叠卡片与按钮。
- 复核工作台：`≤1100px` 由两栏塌为单栏，隐藏分隔条，清单限高滚动。

## 9. QA 测试了哪些页面
用本机 Chrome headless（临时 mock 服务，未改项目）截图核验：
- 工作台 `/`：1440×900、1024×768、390×844 ✅（无横向溢出）
- Excel 尾差工具 `/tools/excel-decimal-check`：1440×900、390×844 ✅
- 占位工具页 `/tools/excel-standardizer`：1440 ✅
- 登录页 `/login`：1440×900、390×844 ✅
- Excel Viewer 复核工作台（mock 工作簿/问题）：1200×900 ✅
- `npm test`：216 pass / 0 fail；DOM id 契约审计通过（App Shell / Excel 工具 / 占位页 = 0 缺失）。

## 10. 是否发现问题
- 复核清单里 **Chrome headless 的 `--window-size<500` 会被强制为 500**，导致最初手机截图被裁切——经测量确认是截图工具限制，**并非 CSS 横向溢出**（390 下 `overflow=0`），已用 iframe(390) 复测确认。
- 需注意：`/app/*` 与 `/login.css` 的 `?v=` 缓存参数已更新，避免旧样式残留。

## 11. 需要人工确认的视觉决策
1. **登录页**是否保留深色品牌面板（当前为深海军蓝 + 蓝色品牌），还是改为纯浅色？（我保留深色，因它最像“企业门户”。）
2. **Sidebar 默认展开/折叠**：当前沿用 localStorage 记忆，默认展开。
3. **主色**：采用 KPMG-inspired 深蓝 `#00338D`；如需更接近某指定品牌色请给出。
4. **中文标题字重**：H1 使用 800 字重（`Noto Sans SC` 若不可用则回退苹方/雅黑）；如需更轻可调。
5. **字体**：未引入 `Noto Sans SC` 网络字体（CSP 禁 CDN），使用系统字体栈；如需内嵌字体需另议。

---

### 运行
```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```
业务功能与 API 契约保持不变。

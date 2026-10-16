# UI_V1_2_REPAIR_REPORT.md — 对比度 + Excel Viewer 稳定性修复

日期：2026-10-16
范围：在不改变 UI V1 视觉方向（Navy + Enterprise Blue + Cool Gray + White）的前提下，
修复 **Excel Viewer 跳动**、**全站文字对比度**、**Viewer/风险列表/筛选/工具栏可读性**。
未重新设计、未新增框架、未改业务/认证。

---

## 1. Excel Jumping Bug 根因

逐行阅读 `private/shared/excel-viewer/excel-viewer.js`（渲染层）+ `viewer-core.js`（纯模型）后定位到
**三个叠加的“重排反馈 / 每帧重建”机制**：

- **R1（主因）ResizeObserver 观察了滚动容器本身**：
  `resizeObserver.observe(body)`（`body` = `.vwr-body`，`overflow:auto`）。
  当画布尺寸令滚动条出现/消失时，滚动容器的内容盒宽度/高度随之变化 → ResizeObserver 触发 →
  `schedule()` → `render()` → `setCanvas()` 改变画布尺寸 → 可能再次改变滚动条 → 再次触发。
  这是教科书式的 **scrollbar ↔ ResizeObserver 自反馈**，表现为网格“反复跳动/闪动/位置变化”。
- **R2 每次滚动都整帧重建**：`body.addEventListener('scroll', () => { syncHeaders(); schedule(); })`
  在 **focus 模式也会**触发 `render()`，而 `render()` 会 `canvas.textContent=''` 后重建全部单元格 →
  滚动时每帧重建 → 闪烁。
- **R3 画布尺寸随滚动增长**：`viewBounds()` 把 `scrollTop/scrollLeft` 计入 `maxRow/maxCol`，
  导致滚动时画布尺寸持续变化 → 滚动范围随之变化 → 位置漂移/跳动。

> 说明：在“滚动条始终存在”的合成场景里，该反馈会稳定；但当画布恰好处于滚动条出现的临界尺寸
> （真实工具中 focus 窗口按视口铺满时常见）时即进入震荡。修复即消除 R1/R2/R3 三个触发条件。

## 2. 修改前行为（证据）

- 代码证据：`observe(body)`；`scroll → schedule()`（无模式判断）；`viewBounds` 含 `scrollRow/scrollCol`。
- 行为后果：滚动/切换时网格重排、画布尺寸漂移、可能的滚动位置重置与闪烁。

## 3. 修复方式（`excel-viewer.js`）

- **R1**：改为观察**固定外框 `frame`**（`.vwr-frame`，尺寸不随内部滚动条变化），并对 ResizeObserver
  回调加**同尺寸去抖**（`lastObservedSize`，尺寸未变则 `return`）。
- **R2**：滚动监听改为 `syncHeaders()` 恒执行；仅当 `model.state().mode === 'sheet'`（虚拟滚动需要）才
  `schedule()`。focus 模式滚动**不再触发渲染**。
- **R3**：`viewBounds()` 去掉 `scrollTop/scrollLeft` 增长项 → 边界**稳定**（used range + 固定余量）。
- 额外：`setCanvas()` 仅在尺寸真正变化时写 style（避免冗余样式写入引发额外 layout）。

## 4. 为什么会跳动（机制小结）

滚动条出现 → 容器内容盒变化 → ResizeObserver → render → 画布尺寸变化 → 滚动条变化 → …（R1）；
叠加“每帧重建”（R2）与“画布随滚动增长”（R3），三者共同造成连续重排/闪烁/位置漂移。

## 5. 是否涉及 ResizeObserver

**是（主因 R1）**。已从“观察滚动容器”改为“观察固定 frame + 同尺寸去抖”。

## 6. 是否涉及 scrollIntoView

- **Viewer 内没有 `scrollIntoView`**；定位由 `.vwr-body.scrollTop/scrollLeft` 的**一次性 reveal** 完成，
  且仅在 `focusToken` / `mode` 变化时触发（`lastFocusToken/lastMode` 守卫），普通 render 不重新居中。
- 风险列表 `highlightActiveIssue()` 使用 `node.scrollIntoView({block:'nearest'})`（只作用于列表，
  就近滚动，非循环），保留未改。
- 结论：跳动**不来自 scrollIntoView**；其一次性 reveal 行为符合规范。

## 7. 是否涉及重复初始化

**否**。工具页 `initViewer()` 仅在扫描完成后调用一次；`resetResults()` 会 `viewer.destroy()` 并置空；
`app-shell.js` 有单例守卫（`.lx-shell-nav` 存在即 return）。无双重实例。

## 8. 是否涉及 CSS layout

- 网格本身**没有任何 transition/animation**（本次额外加了 `transition:none` 守卫确保不会引入）。
- 选中态使用 `outline`（不占布局），高亮使用 `box-shadow/inset`，**不改变单元格尺寸**。
- 真正相关的是“滚动条 ↔ 尺寸反馈”，已在 JS 侧修掉。

## 9. Typography 修改

- 工具页 token 对比度提升：`--muted #667085 → #475467`、`--muted-2 #98a2b3 → #667085`、
  `--line #e4e8ef → #d9e1ea`、`--line-strong → #c4d0dd`、`--text #101828`（工具页作用域）。
- 关键正文尺寸微调：`.issue-field strong/code` 11→12px、`.issue-reason/.issue-suggestion` 10→12px、
  `.card-head p` 10→12px、`.issue-field span` 8→11px；工作台 `.tool-description` 10→11px。

## 10. Contrast 修改

- 层级：一级 `#101828`、二级 `#344054`、三级 `#475467`、辅助 `#667085`；不再用 `#98a2b3` 承载长正文/数据。
- 按钮：主按钮 Navy `#00338d` + 白字；次按钮白底 `#d0d5dd` 边 + `#344054` 字；
  `定位`按钮改白字（原深字叠蓝底对比不足）；`复制地址` `#344054` + `#d0d5dd` 边。
- 公式栏：`#344054` 等宽字、底 `#f8fafc`、边 `#d0d5dd`。
- 筛选：控件字 `#344054`、边 `#d0d5dd`；placeholder `#475467`。
- 下载按钮：文字保持高对比（Navy / Enterprise Blue）。

## 11. Excel Grid 修改

- 网格线 `#d9e1ea`；表头底色 `#f2f4f7`、文字 `#475467`、边 `#d0d5dd`；单元格文字 `#101828`。
- 公式文本色统一为 `#0b4a8f`（格内）/ 公式栏 `#344054`。
- 风险高亮：由纯黄改为**浅 warning tint `#fff6e5` + 细橙色内描边 `rgba(247,144,9,.45)`**（overlay，不改数据）。
- 当前单元格：`2px #1261d6 outline`（`outline-offset:-2px`，**不改尺寸/不推挤相邻格**）。
- 网格数据区显式禁用过渡/动画。
- **未修改任何工作簿数据**；高亮仅为 DOM/CSS overlay，导出逻辑不变。

## 12. Risk List 修改

- `.issue-field span`（标签）`#667085`、字号提升；值 `#101828`；`.issue-sheet` `#475467`；
  `.issue-reason` `#344054`；`.issue-suggestion` `#05603a`；`.refstat` `#344054`；
  `下游引用` chip 改 Navy 底白字（原蓝底蓝字）；`.card-head p` `#475467`。
- 视觉结构、字段、定位/复制功能均未改。

## 13. Responsive 修改

- 未改断点结构（沿用 v1.1 修复后的 820 移动阈值 / 1180 / 680）。
- 本次验证：1440 / 1280 / 1024 / 820 / 800 / 390 —— **页面无横向溢出**；
  Excel Grid 在窄屏**仅网格容器内部横向滚动**（`.vwr-body{overflow:auto}`），body 不横向滚动。

## 14. 修改文件列表（本次 v1.2）

| 文件 | 修改 |
|---|---|
| `private/shared/excel-viewer/excel-viewer.js` | R1/R2/R3 稳定性修复 + `setCanvas` 去重 |
| `private/app-shell.css` | 追加“UI v1.2 readability”作用域块（token 对比度、网格/工具栏/公式栏、风险列表、筛选、按钮）+ 网格禁用过渡 |
| `private/styles.css` | 追加工作台对比度微调（颜色/字号，无布局改动） |

（此前 V1 应用与 v1.1 修复涉及的文件仍在工作区，未回退。）

## 15. 没有修改的业务核心文件

**逐字未改**：`decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、
`decimal-workbook.js`、`issue-filters.js`、`formula-parser.js`、`formula-pattern.js`、
`hardcode-core.js`、`hardcode-workbook.js`、`excel-viewer/viewer-core.js`、
`excel-highlight/ooxml-highlight.js`、各工具业务 `script.js`、`server.js`、`server/**`、
`services/**`、`workers/**`、迁移、`config/tools.json`、`login.js`。

## 16. QA 结果

- **Viewer 稳定性探针**（真实滚动条，1440）：focus 模式手动滚动到 `(91,140)` 后多个采样
  **保持 91/140 不重置**；切换 focus→sheet 后 **滚动位置保留、画布尺寸稳定、无震荡**。
- 截图核验：可读性明显提升（网格线/表头/单元格/公式栏/工具栏/风险高亮均清晰）；`查看完整工作表`
  正常切换（表格铺满、出现独立横向滚动条）。
- `node --check`：viewer/script/app-shell/工具脚本 全部通过。
- `npm test`：**216 pass / 0 fail**（未触碰业务，回归全绿）。
- 认证/侧栏/抽屉：未受影响（真实服务 `/health` ok；`/login` 正常）。

## 附：运行

```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```

**Business Logic Modified: NO**（未修改任何业务/认证/数据库/Excel 算法文件；
`excel-viewer.js` 的改动为共享查看器的稳定性与性能修复，不改变其对外契约与定位语义）。

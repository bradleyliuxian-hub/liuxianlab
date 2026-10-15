# Excel 小数检查 · 开发日志（DEVLOG）

> 工具：Excel Decimal Check
> 入口：`/tools/excel-decimal-check`
> 产品定位：**纯浏览器本地只读复核**，扫描超过两位小数的单元格，网页内定位复核，导出标黄对比文件与问题清单（不修改原文件）。
> 当前 UI 版本：`v1.2.0`（工具卡片 badge：可用；页面标记 Decimal v1.2）
> 最近更新：2026-10-15

本文件记录该工具的**版本功能**与**版本修改**，供开发者（AI 接手）与使用者查阅。

---

## 1. 功能概述

检查 Excel 中**实际数值超过两位小数**的单元格，并生成两类结果：

1. **标黄对比文件**：基于原始文件生成副本，仅对问题单元格添加黄色填充；公式、外部链接、结构不变，原文件不受影响。
2. **问题清单 Excel**：仅含异常单元格及 **Excel F5 定位地址**，便于人工逐项核对。

（原「修正后的 Excel」与「处理状态」已于 v1.2.0 移除：工具只读、只定位与标黄，不自动修改。）

**关键设计**：

- **浏览器本地处理**，文件不上传服务器；下载为新建文件，绝不覆盖原文件。
- 检查的是单元格**实际数值**，而非显示格式。因此「实际 1.23456、显示 1.23」仍判为异常。
- **尾随 0 不误报**（`10.120` 视为 `10.12`）；**JS 浮点误差不误报**（`0.1+0.2` 视为 `0.3`）。

---

## 2. 版本历史（功能 + 修改）

### v1.2.0（2026-10-15）— 只读复核 + 标黄对比（移除自动修正/状态）

- **移除自动修正与处理状态**：不再提供「下载修正后的 Excel」；issue 不再有 `status/fixedValue/fixedFormula`，问题清单去掉「修正后值 / 修正后公式 / 自动处理状态 / 备注」四列（列数 12 → 8）。
- **Viewer 只读**：扫描不再改写工作簿（`scanWorkbook` 纯读取），网页内展示**原始**工作簿 + 问题黄标。
- **新增「下载标黄对比文件」**：复用共享 `private/shared/excel-highlight/ooxml-highlight.js` + `fflate`，对原始文件做最小 OOXML 样式补丁，仅标黄问题单元格；公式/外部链接/命名范围/隐藏状态/图表等不变，原文件不改。仅支持 `.xlsx` / `.xlsm` 原文件，其余扩展名禁用该按钮并提示。
- **共享模块**：`ooxml-highlight.js` 迁至 `private/shared/excel-highlight/`（新增中立别名 `ExcelOoxmlHighlight`）；其严重级别默认改为「高亮全部非 IGNORE」，可用 `options.severities` 覆盖（死数检查行为不变）。
- 未改扫描/检测逻辑；未改 workbook。

### v1.1.0（2026-10-15）— 网页内定位复核（两栏工作台）

参照「Excel 死数检查」的复核体验，在结果页加入只读 **Excel Viewer**，与问题列表组成两栏：

- **布局**：页面近全宽；两栏 = 左侧问题列表（sticky、内部滚动）+ 可拖动分隔条 + 右侧 Excel Viewer（占主体，高 `clamp(650px,68vh,82vh)`）。
- **定位**：点击问题卡片或「定位」→ 切换 Sheet、定位单元格、聚焦窗口、公式栏显示原公式；上一个/下一个基于当前筛选；名称框可输入（如 `E163`）回车定位；「回到当前问题」按钮。
- **标记**：问题单元格浅黄 `#FFF2CC`（“显示问题标记”开关控制）；当前选中单元格淡蓝 `#DCEEFF` + 蓝框；选中且为问题时叠加黄色角标。`selected` 与 `viewport` 解耦——定位只移动一次，之后自由滚动。
- **模式**：问题聚焦（按视口铺满并居中）/ 完整工作表（虚拟滚动，随滚动持续扩展；ResizeObserver/分栏拖动自动补足）。空白行列照常显示行号/列头。
- **数据映射**：`decimal` issue 追加 `cellAddress=cell`、`severity=type`、`ruleType` 等字段后交给共享 viewer；原始字段（type/typeLabel/goto/originalValue/decimals/...）不动，报告与修正导出不受影响。
- **共享模块**：新增 `private/shared/excel-viewer/{viewer-core.js,excel-viewer.js}`（从死数检查抽出的通用 Viewer），死数检查与小数检查共用；死数检查仅改脚本引用路径。

### v1.0.2（2026-10-14）— 版本号展示与迭代记录

页面显示工具版本号与版本迭代说明。

### v1.0（2026-10-13）— 首个版本

单一提交：`8f267d6 feat: add Excel decimal check tool`（作者 bradleyliuxian-hub）。

**新增文件**

```
config/tools.json                                  新增工具卡片
package.json                                       新增 npm test 脚本
private/tools/excel-decimal-check/decimal-core.js  纯函数核心（无 DOM / 无 XLSX 依赖）
private/tools/excel-decimal-check/decimal-workbook.js  扫描 + 修正 + 导出（XLSX 引擎外置注入）
private/tools/excel-decimal-check/index.html        页面
private/tools/excel-decimal-check/script.js         交互 / 渲染 / 下载
private/tools/excel-decimal-check/styles.css        样式
private/vendor/xlsx/LICENSE                         SheetJS 许可证
private/vendor/xlsx/xlsx.full.min.js                本地 vendored SheetJS（无 CDN）
tests/excel-decimal-check/decimal-core.test.js      node:test 单测
tests/excel-decimal-check/decimal-workbook.test.js  node:test 单测
```

**核心能力**

- 支持 `.xlsx` / `.xlsm` / `.xlsb` / `.xls` 上传（单文件）。
- 遍历**所有工作表**，扫描每个单元格的**实际数值**（含公式的缓存结果）。
- 异常分三类：
  - `raw` 原始数据异常 —— 直接存储的数字 > 两位小数
  - `formula` 公式结果异常 —— 公式计算结果 > 两位小数
  - `unknown` 公式不可判定 —— 公式缺少可读取的缓存结果（不猜、不当作正常）
- **只读**：不修正、不改写工作簿；`scanWorkbook` 产出问题记录，供页面展示与问题清单导出共用（同一份口径）。
- **标黄对比文件**：`buildHighlightedWorkbook`（共享 `private/shared/excel-highlight/ooxml-highlight.js`）对原始文件做 OOXML 最小样式补丁，仅标黄问题单元格。
- 问题清单列：`序号 / 异常类型 / 工作表 / 单元格 / F5定位地址 / 原值 / 有效小数位 / 原公式`，含自动筛选。
- Excel F5 定位地址由 `buildExcelGotoReference()` 生成，按需加引号并转义单引号
  （`销售明细 10月` → `'销售明细 10月'!C18`；`Brad's Data` → `'Brad''s Data'!C18`）。
- 页面：拖拽 / 选择文件、进度、六项汇总指标（工作表 / 扫描单元格 / 原始异常 / 公式异常 /
  不可判定 / 问题总数）、按工作表与类型筛选、分页「显示更多」、两种下载按钮、Toast 提示。
- 继承现有 `/app/...` 静态资源路径与登录保护；`config/tools.json` 中的卡片自动出现在工作台。
- SheetJS **本地 vendored**（`private/vendor/xlsx/`），不依赖 CDN，保证内网 / 生产可用。

**未改动**：`server.js`、`server/`、`services/`、contract 与 excel-review、数据库、`.env`（无服务端逻辑）。

---

## 3. 技术要点

- `decimal-core.js`：UMD 风格，浏览器挂 `window.DecimalCheckCore`，Node 走 `module.exports`；纯函数、可单测。
  - `effectiveDecimalPlaces()`：计算**有效**小数位（去尾随 0、容忍浮点噪声），0..15，超范围返回 `null`。
  - `roundToTwo()`：15 位有效数字字符串法，`1.005` 仍正确进位为 `1.01`。
  - `isAlreadyRoundedFormula()` / `wrapFormulaWithRound()`：解析括号与顶层参数，避免生成
    `ROUND((ROUND(...)),2)` 之类的嵌套。
- `decimal-workbook.js`：SheetJS 命名空间作为参数注入，浏览器与 Node 共用同一实现
  （测试用真实 SheetJS 跑扫描 + 修正 + 导出）。
- 输出类型：`.xlsm` → `xlsm`、`.xlsb` → `xlsb`，其余回退 `xlsx`。

---

## 4. 测试

```
node:test (npm test):  21 pass / 0 fail
  node --test tests/excel-decimal-check/*.test.js
```

覆盖：有效小数位判定、尾随 0、浮点误差、`roundToTwo` 进位、`ROUND` 包裹与去重、
F5 地址引号 / 转义 / 中文 Sheet、三类异常扫描、自动修正结果与状态、
问题清单行与最终记录一致。

---

## 5. 已知限制

- 依赖 SheetJS 写出修正版，复杂工作簿（宏 / 特殊格式）保真度受 SheetJS 能力限制。
- 公式**不会**在浏览器中重算，只能读取源文件保存的缓存结果；无缓存时列为「不可判定」，
  不自动修正。
- 数据完全在浏览器处理；不进入服务器存储，因此**无历史记录 / 无服务端任务**。
- 日期单元格不参与小数检查（按日期格式排除）。

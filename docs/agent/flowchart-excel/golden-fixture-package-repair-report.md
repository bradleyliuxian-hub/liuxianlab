# Golden Fixture — Package Repair Report

- 日期：2026-10-21
- 阶段：Phase 1 package repair（不进入 connector spike）
- 网站仓库：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch / HEAD：`main` / `28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- dirty：17 项（9 个已跟踪文件修改 + 8 个未跟踪目录/文件；均为本轮前既有）
- 工作目录：`/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1`
- 结论：**包结构修复 PASS；Open XML SDK validator 0 errors；Mac/Windows Excel 仍为 NOT RUN。**

---

## 1. 问题

用户在 Microsoft Excel 打开以下文件时收到修复提示，随后文件/窗口消失：

```text
/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/golden-fixture-default-twoCell.xlsx
SHA-256 dfedfd79e0ad0f7a6b7c85821f32b33545b057cb122de5fb0a3f6f4312896357
```

原始文件已保留，没有覆盖。修复版输出到：

```text
/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/
```

---

## 2. 根因证据

### 2.1 [Content_Types].xml

修复前：

```xml
<Types ...>
  <Default Extension="xml"
           ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Default Extension="rels"
           ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Override PartName="/xl/styles.xml" ... />
  <Override PartName="/xl/worksheets/sheet1.xml" ... />
  <Override PartName="/xl/drawings/drawing1.xml" ... />
</Types>
```

问题：

- `Default Extension="xml"` 被错误声明为 **workbook main**；
- 没有 `/xl/workbook.xml` 的独立 `Override`；
- 其他未覆盖 XML 部件也会被错误解析为 workbook main。

### 2.2 Relationships

修复前：

```text
_rels/.rels:
  Target="/xl/workbook.xml"

xl/_rels/workbook.xml.rels:
  Target="/xl/styles.xml"
  Target="/xl/worksheets/sheet1.xml"

xl/worksheets/_rels/sheet1.xml.rels:
  Target="/xl/drawings/drawing1.xml"
```

这些是以 `/` 开头的绝对目标。Excel 对这类包结构敏感；本轮统一改为相对目标。

### 2.3 Open XML SDK validator 为何没发现

原文件（以及 POC 历史输出）都通过 Open XML SDK validator：

```text
open_xml_error_count = 0
```

说明 SDK validator 只验证 XML 内容模型，不验证：

- OPC `[Content_Types].xml` 的 Default/Override 语义；
- 关系目标是否为标准相对路径；
- Excel 实际打开时的包结构兼容性。

因此本阶段增加了独立的 OPC package audit。

---

## 3. 生成器修复

### 3.1 根因

根因不在业务 fixture，也不在 DrawingML：Open XML SDK 3.5.1 在当前环境写出的包默认是：

```text
Default Extension="xml" = workbook main
无 workbook Override
relationship Target 使用 /xl/... 绝对路径
```

仅修单个 XLSX 不够；必须修包 writer。

### 3.2 修改文件

```text
src/GoldenFixtureExporter/PackageRepair.cs       # 新增：OPC 包重建
src/GoldenFixtureExporter/WorkbookWriter.cs      # SDK 生成 -> PackageRepair.Rebuild -> validator
src/GoldenFixtureExporter/Program.cs             # 可选 openxml report 路径
tests/GoldenFixtureExporter.Tests/PackageStructureTests.cs  # 新增包结构回归
scripts/validate_package_repair.py               # 新增 OPC 审计
scripts/run_package_repair.sh                    # 新增修复流水线
fixtures/broken-package/golden-fixture-broken.xlsx  # 原始坏包副本，仅作回归证据
```

`PackageRepair` 使用 `System.IO.Packaging` 的 part / relationship API 重建包：

1. 枚举源包 part；
2. 用正确 ContentType 创建新 part；
3. 复制 part 字节；
4. 用 `PackUriHelper.GetRelativeUri` 计算 part-to-part 相对目标；
5. 根关系使用 `xl/workbook.xml` 相对目标；
6. 保留 relationship Id，确保 `r:id` 继续匹配；
7. 生成显式 content-type manifest；
8. 固定 ZIP 时间戳，保证输出可重复。

没有对单个 XLSX 做手工字符串替换。

---

## 4. 修复前后差异

### 4.1 Content Types

修复后：

```xml
<Types ...>
  <Default Extension="rels"
           ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml"
           ContentType="application/xml" />
  <Override PartName="/xl/workbook.xml"
           ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Override PartName="/xl/styles.xml"
           ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />
  <Override PartName="/xl/worksheets/sheet1.xml"
           ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />
  <Override PartName="/xl/drawings/drawing1.xml"
           ContentType="application/vnd.openxmlformats-officedocument.drawing+xml" />
</Types>
```

### 4.2 Relationships

修复后：

```text
_rels/.rels:
  Target="xl/workbook.xml"

xl/_rels/workbook.xml.rels:
  Target="styles.xml"
  Target="worksheets/sheet1.xml"

xl/worksheets/_rels/sheet1.xml.rels:
  Target="../drawings/drawing1.xml"
```

全部是相对路径，且能解析到真实 part。

### 4.3 业务 XML 未变

修复前后逐部件 SHA-256：

```text
xl/workbook.xml                   SAME
xl/styles.xml                     SAME
xl/worksheets/sheet1.xml          SAME
xl/drawings/drawing1.xml          SAME
[Content_Types].xml               DIFF（修复目标）
_rels/.rels                       DIFF（修复目标）
xl/_rels/workbook.xml.rels        DIFF（修复目标）
xl/worksheets/_rels/sheet1.xml.rels DIFF（修复目标）
```

因此不是重新布局，也不是重新画图；只修包元数据。

---

## 5. Package Audit

### 5.1 修复前

```text
overall: FAIL
checks: 38
failed: 6
```

主要失败：

```text
default_xml_not_workbook_main
default_xml_is_application_xml
workbook_override_present
workbook_override_is_main
override_/xl/workbook.xml
relationships_parse（4 个绝对 Target）
```

修复前 Open XML SDK validator 仍是 **0 errors**，说明它没有发现这些 OPC 缺陷。
```

报告：

```text
output/package-repair-v1/before-audit/package-validation-report.json
```

### 5.2 修复后

```text
overall: PASS
checks: 38
failed: 0
```

检查覆盖：

- `[Content_Types].xml` Default/Override；
- workbook / styles / worksheet / drawing 的显式类型；
- 所有关系目标存在且可解析；
- 根关系 → workbook；
- workbook → styles / worksheet；
- worksheet → drawing；
- `r:id` 与 Relationship Id；
- ZIP 无重复 part、无大小写冲突；
- 9 shapes / 9 connectors / 9 stCxn / 9 endCxn / 9 custGeom；
- 无图片、外链、customXml、显式 editAs。

报告：

```text
output/package-repair-v1/package-validation-report.json
output/package-repair-v1/content-types-report.json
output/package-repair-v1/relationships-report.json
```

---

## 6. Open XML SDK Validator 真实输出

```text
file: .../golden-fixture-package-repaired.xlsx
open_xml_error_count: 0
```

原始日志：

```text
output/package-repair-v1/openxml-sdk-validator.log
```

注意：SDK validator 0 errors 不能单独证明 Excel 可打开；它没有抓到原始包的 content-type/relationship 缺陷。必须同时看 OPC package audit 和真实 Excel。

### 6.1 其他结构检查

本轮没有把其他猜测性改动混入修复：

```text
worksheet / workbook / styles / drawing schema order  -> SDK validator 0 errors
pageSetup: paper 8 / landscape / scale 48 / fitToPage / fitToWidth=1 / fitToHeight=1
defined name _xlnm.Print_Area: localSheetId=0,
  'Golden Fixture'!$A$1:$CQ$92
twoCellAnchor from/to markers -> GridModel round-trip 0px
custGeom path coordinates -> 9 条边端点 0.0px
stCxn/endCxn -> 9/9，层级与 shape ID 引用有效
Shape/Connector IDs -> unique
[Content_Types].xml 与实际 parts -> 一致
所有 XML / .rels 可解析
```

`scale=48` 与 `fitToPage/fitToWidth/fitToHeight` 同时存在；模板也有 `scale=48` + `fitToPage=1`，因此本轮不把它当作已证实的修复原因，也没有为了“看起来更干净”而改动打印设置。真实 Excel 打印预览仍为 `NOT RUN`。

---

## 7. 输出

```text
output/package-repair-v1/
├── golden-fixture-package-repaired.xlsx
│   SHA-256 3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32
├── package-validation-report.json
├── openxml-sdk-validator.log
├── openxml-sdk-validator.json
├── relationships-report.json
├── content-types-report.json
├── sha256.txt
├── golden-fixture-structure.json
├── golden-fixture-validation-report.json
├── golden-fixture-grid.json
├── source-original-broken.xlsx
│   SHA-256 dfedfd79...（原始坏包副本）
├── before-audit/
│   ├── package-validation-report.json（FAIL 证据）
│   ├── content-types-report.json
│   ├── relationships-report.json
│   └── openxml-sdk-validator.log（修复前 0 errors，证明 SDK 漏检）
└── preview/
    └── golden-fixture-package-repaired.pdf
```

修复版保持：

```text
xdr:sp                 9
xdr:cxnSp              9
twoCellAnchor          18
custGeom               9
stCxn / endCxn         9 / 9
每条逻辑边一个 connector
无图片替代
默认 twoCellAnchor
edit_as = pending
exportReady = false
```

---

## 8. 自动化回归

| 测试 | 结果 |
|---|---|
| Phase 1 .NET build | PASS，0 warnings / 0 errors |
| Phase 1 xUnit | **19 pass / 0 fail** |
| 修复前包结构测试 | **FAIL（6 项，能复现原始缺陷）** |
| 修复后包结构测试 | **PASS（38 / 38 checks）** |
| Phase 1 Node schema/reference | **5 pass / 0 fail** |
| Website flowchart Node | **115 pass / 0 fail** |
| Website `npm test` | **400 pass / 0 fail** |
| Website Python flowchart | **14 tests OK** |
| Phase 1 Python validator | **6 tests OK** |
| POC .NET | **14 pass / 0 fail** |
| Open XML SDK validator | **0 errors** |
| 修复版重复生成 | 两次 SHA-256 相同（`3c271e4b...`） |

新增关键测试：

```text
BrokenPackageFailsContentTypeAndRelationshipAudit
RepairedPackagePassesContentTypeAndRelationshipAudit
RepairedPackageKeepsNineShapesConnectorsAndBindings
```

---

## 9. Mac / Windows Excel

```text
Mac Excel     = NOT RUN
Windows Excel = NOT RUN
```

用户在本轮修复前已遇到修复提示；修复版尚未由用户在 Excel 实测。人工步骤：

```text
docs/agent/flowchart-excel/golden-fixture-manual-acceptance.md
```

只有在用户确认修复版能正常打开、无修复提示后，才进入 Phase 2 connector spike。

如果仍出现修复提示：

1. 保留 Excel 的 repair log（如有）；
2. 保留保存后的 XLSX；
3. 记录 Excel 版本/build；
4. 不要猜测 Excel 修复了什么，先对比修复后的包结构。

---

## 10. 边界声明

- 原始 XLSX 未覆盖；原始 SHA-256 仍为 `dfedfd79...`。
- 未修改 63 节点 approved graph、revision history、review revisions。
- 未生成客户 XLSX、未进入 V5。
- 未修改网站功能源码、数据库、POC 历史基线。
- 抽查 POC 历史输出也出现同样的 `Default xml=workbook main` / 绝对 Target 模式；本轮只修 Phase 1 生成器，没有改动 POC 源码或历史产物。
- `exportReady` 仍为 `false`；`edit_as` 仍为 `pending`。
- 未重启 8080，未提交/推送。
- 未进入 connector spike。

**本阶段到此停止。**

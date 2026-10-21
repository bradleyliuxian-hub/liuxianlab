# Golden Fixture — Phase 1 Report

- 日期：2026-10-21
- 阶段：Phase 1（8–10 节点 Golden Fixture，只验证最小导出闭环）
- 网站仓库：`/Users/a123/AI-Workspace/projects/liuxianlab-online`
- branch / HEAD：`main` / `28efb24f08a8c7e83067e5dc52b8ad00172a5314`
- dirty：17 项（9 个已跟踪文件修改 + 8 个未跟踪目录/文件；均为本轮前既有）
- 独立工作目录：`/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/`
- 结论：**静态结构 / 几何 / profile token QA PASS；追加 package repair 后 OPC 结构 PASS；Mac/Windows Excel 均为 NOT RUN；未进入 Phase 2。**

---

## 1. 本轮目标与边界

本轮只做：

- 固定 9 节点合成图；
- 业务 node/edge ID → Excel shape/connector ID 映射；
- 每条边一个原生 `xdr:cxnSp`，一个有效 `stCxn` + `endCxn`；
- custGeom 端点与绑定侧中心 ≤ 1px；
- profile 最小 token 真正进入 DrawingML / 页面设置；
- 三态 QA（`clear` / `confirmed_collision` / `indeterminate`）；
- 生成器与校验器共用 grid/EMU 来源。

本轮不做：

- connector preset A/B/C 对比（Phase 2）；
- 63 节点重排、V5、客户图导出；
- 完整 profile engine；
- 正式导出、`exportReady` 变更；
- Mac/Windows Excel 实际验收。

---

## 2. 实际改动

新增独立目录（不在网站 Git 仓库内）：

```text
/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/
├── fixtures/
│   ├── golden-flowchart.json
│   ├── golden-layout.json
│   ├── golden-fixture.expected.json
│   └── golden-template-profile.json
├── src/GoldenFixtureExporter/
├── tests/
├── scripts/
├── output/
├── README.md
└── global.json
```

新增网站文档（仅文档，不改网站源码）：

```text
docs/agent/flowchart-excel/golden-fixture-phase1-report.md
docs/agent/flowchart-excel/golden-fixture-connector-map.md
docs/agent/flowchart-excel/golden-fixture-manual-acceptance.md
docs/agent/flowchart-excel/golden-fixture-package-repair-report.md
```

没有修改：

```text
63 节点 approved graph / revision 5 / review revisions
V1–V4 候选、原始 external ZIP、已有报告
server/flowchart-excel/、private/tools/flowchart-excel/ 等功能源码
config/tools.json、server.js、private/script.js
exportReady = false
edit_as = pending
```

`flowchart-excel-exporter-poc` 没有修改；本阶段新增代码在独立 Phase 1 目录。

---

## 3. 固定 Fixture

### 3.1 输入哈希

```text
graph     fixtures/golden-flowchart.json          a9fa20f2ac195c5d9d59a34cffbfd97e027f93cad5f3f7cdf8f85d82a13cb873
layout    fixtures/golden-layout.json             e284ad04483bdeac36086d45194e94a1a7578cb37bb9cacaabfa49e5f956507e
profile   fixtures/golden-template-profile.json   62e3cc79d310a3cb39590973a0923c8324d1004eca3356535d08d71f3f045a0b
expected  fixtures/golden-fixture.expected.json   fb364805ad8a931c984ea7478a3d1b63e645ff233974bfd775ad6b9cbba893a8
```

### 3.2 对象清单

```text
lanes: 2
nodes: 9
edges: 9
branch labels: 2（是 / 否）
cross-lane edges: 1（GE09 G07 → G09）
loopback edges: 1（GE05 G04 → G02）
document nodes: 1（G07）
control markers: 1（G09 CA1）
long text nodes: 1（G08）
```

节点：

```text
G01 Start                    terminator
G02 接收并核对申请资料        process
G03 资料是否完整？            decision
G04 补充缺失资料              process
G05 审核通过                  process
G06 登记处理结果              process（merge/rejoin）
G07 归档审批及相关凭证文件    document
G08 长中文文本节点            process
G09 控制点 CA1                other + controls=[CA1]
```

G09 没有被偷偷映射成普通业务节点：

```text
shape = other
controls[0] = { kind: CA, code: CA1, display: separate_shape, attribution_status: needs_review }
preset = flowChartConnector（样式候选，语义 unverified）
```

`golden-flowchart.json` 通过网站现有 JSON Schema + reference validator 校验：

```text
validateContract(valid) = true
validateReferences(valid) = true
```

---

## 4. 输出与映射

### 4.1 原始文件（已保留，不再作为交付物）

```text
output/golden-fixture-default-twoCell.xlsx
SHA-256 dfedfd79e0ad0f7a6b7c85821f32b33545b057cb122de5fb0a3f6f4312896357
状态：Excel 打开时触发修复提示
```

原始文件的业务 XML 与几何没有丢失，但包结构有缺陷：

```text
[Content_Types].xml Default Extension="xml" = workbook main
缺少 /xl/workbook.xml 的 Override
根/工作簿/工作表 relationship Target 使用绝对路径
```

原始文件保持不动，仅复制为修复证据：

```text
output/package-repair-v1/source-original-broken.xlsx
fixtures/broken-package/golden-fixture-broken.xlsx
SHA-256 同为 dfedfd79...
```

### 4.2 修复版交付物

```text
output/package-repair-v1/golden-fixture-package-repaired.xlsx
SHA-256 3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32
```

OPC 修复结果：

```text
Default rels = application/vnd.openxmlformats-package.relationships+xml
Default xml  = application/xml
Override /xl/workbook.xml = ...spreadsheetml.sheet.main+xml
Override /xl/styles.xml / worksheet / drawing = 各自正确类型
Root Target = xl/workbook.xml
Workbook Targets = styles.xml / worksheets/sheet1.xml
Worksheet Target = ../drawings/drawing1.xml
r:id / Relationship@Id = 全部匹配
```

结构（修复前后业务 XML 相同）：

结构：

```text
xdr:sp                 9
xdr:cxnSp              9
twoCellAnchor          18
custGeom               9
prstGeom               9
stCxn / endCxn         9 / 9
invalid endpoint refs  0
explicit editAs        0（全部默认 twoCell）
media / external       0 / 0
pictures / customXml   0 / 0
Open XML SDK errors    0
```

映射：

```text
G01–G09 → shape IDs 1001–1009
GE01–GE09 → connector IDs 2001–2009
```

完整逐项表见 `golden-fixture-connector-map.md`。

---

## 5. Profile 真实驱动

`golden-template-profile.json` 不是只算哈希。`WorkbookWriter` 读取并应用：

| token | 值 | 状态 |
|---|---|---|
| font family | `Microsoft YaHei UI` | 模板 OOXML 可见 |
| body font size | `1100`（11pt） | 模板 profile 已验证 |
| node line width | `9525` EMU（0.75pt） | 模板默认线宽 |
| node line color | `4472C4` | 模板 accent1 / 直接 sRGB |
| document fill | `FFFF00` | 模板直接 sRGB，已验证 |
| control fill | `92D050` | 模板观察值；语义 `unverified` |
| process/terminator/decision fill | `D9E2F3` | 由 accent1 lumMod/lumOff 推导，`inferred` |
| connector line | `4472C4` / `28575` / triangle | 模板 connector 验证 |
| shadow | blur 50800 / dist 38100 / dir 2700000 / alpha 40000 | 模板验证 |
| lane label | 11pt bold black / `D9D9D9` | 字体已验证；fill 为 `inferred` |
| lane band | `F2F2F2` | `inferred` |
| page | A3 横向 / scale 48 / fitToPage / margins 0.7/0.75 | 模板 OOXML 验证 |
| print area | `A1:CQ92` | **fixture-derived**；模板没有 Print_Area 定义名 |
| anchor | twoCellAnchor / edit_as pending | 未定版 |

验证“不是只算哈希”的测试：

```text
修改 profile：font=Arial, body=12pt, node line=19050,
connector color=112233, process fill=ABCDEF, lane label=12pt, scale=60
→ 重新生成
→ 输出 font/fill/line/connector color/lane font/scale 全部随之变化
→ ProfileDriveTests PASS
```

未验证 / 不声称：

- 普通节点 `D9E2F3` 与模板主题色的逐像素等价；
- 泳道 fill 的精确主题 tint；
- `flowChartConnector` 的 connection site index；
- CA/PRP/TOE 的语义等价；
- 真实 Excel 打印可读性。

---

## 6. 连接器几何

所有 9 条边使用 custGeom，一条边一个 `xdr:cxnSp`。端点不再加固定 8px 外侧间隙，也不再使用 side counter 偏移。

```text
端点 vs 绑定侧中心：
GE01–GE09 全部 0.0px
最大误差 0.0px
tolerance 1px（9525 EMU）
```

三态 QA：

```text
clear                8
confirmed_collision  0
indeterminate        1
indeterminate edge   GE09
reason               flowChartConnector connection site mapping unverified
```

GE09 的静态几何本身是 0px 误差；因为 `flowChartConnector` 的 site index 没有模板绑定证据，状态仍为 `indeterminate`，没有写成 `clear`。这是本阶段刻意保留的诚实状态，不是测试失败。

连接点索引：

```text
已验证 preset: flowChartTerminator / flowChartProcess / flowChartDecision / flowChartDocument
索引: top=0 / left=1 / bottom=2 / right=3
未验证: flowChartConnector / flowChartInputOutput (4,5) / flowChartMagneticDrum (4)
```

本 fixture 不使用 `input_output` / `database`，因此没有伪造它们的 site mapping。

---

## 7. Grid / EMU 共用

`GridModel` 是唯一换算实现：

```text
95 columns / 92 rows
first column 12.0 chars → 96px
other columns 2.0 chars → 16px
row height 6.8pt
canvas 15,240,000 × 7,945,120 EMU（1600 × 834.13px）
```

输出：

```text
output/golden-fixture-grid.json
```

Python 校验器只读取该文件的 `start_emu` / `width_emu`，不再用 168px/170px 各自推导。回归结果：

```text
shared_grid_marker_diffs = []
marker vs xfrm 最大差异 = 0
```

之前的 2px 生成器/校验器偏差在本 fixture 中消除。

---

## 8. 页面设置与打印

修复版 `golden-fixture-package-repaired.xlsx` 实际结构（业务 XML 与原始文件相同）：

```text
sheetPr/pageSetUpPr fitToPage = 1
pageSetup: paperSize=8 (A3), orientation=landscape, scale=48,
           fitToWidth=1, fitToHeight=1
pageMargins: left/right 0.7in, top/bottom 0.75in, header/footer 0.3in
print area: 'Golden Fixture'!$A$1:$CQ$92
```

说明：

- print area 由 fixture 画布计算，不是模板已验证值；目标模板没有 `_xlnm.Print_Area` 定义名。
- 真实 Mac/Windows 打印预览：`NOT RUN`。
- 11pt × 48% 的纸面等效字号约 5.28pt；可读性未验证。
- 修复版 `package-repair-v1/preview/golden-fixture-package-repaired.pdf` 由 LibreOffice headless 生成；本机未渲染 Microsoft YaHei UI 的中文字形，因此预览只用于结构核对，不能作为 Excel 视觉通过证据。

---

## 9. 自动化测试结果

| 测试 | 结果 |
|---|---|
| POC `.NET Release build` | PASS，0 errors |
| POC `.NET test` | 14 pass / 0 fail |
| Phase 1 exporter Release build | PASS，0 warnings / 0 errors |
| Phase 1 xUnit | **19 pass / 0 fail** |
| Phase 1 Node schema/reference | **5 pass / 0 fail** |
| Website flowchart Node tests | **115 pass / 0 fail** |
| Website `npm test` | **400 pass / 0 fail** |
| Website Python flowchart | **14 tests OK** |
| Phase 1 Python validator tests | **6 tests OK** |
| Phase 1 static validation | **73 checks PASS / 0 FAIL** |
| Open XML SDK validator | **0 errors** |
| Package audit（修复前） | **FAIL：6 项**（Default xml=workbook main、缺 workbook Override、4 个绝对 Target） |
| Package audit（修复后） | **PASS：38 / 38 checks** |

测试覆盖：

- lanes/nodes/edges 数量与 expected 一致；
- ID 唯一、source/target/lane 引用存在；
- 9 个业务节点 ↔ 9 个 shape；9 条边 ↔ 9 个 connector；
- 每条边一个 connector，每 connector 一个 stCxn + 一个 endCxn；
- 端点与绑定侧中心 ≤ 1px；
- 三态 QA（clear / confirmed_collision / indeterminate）；
- 生成器与校验器共用 grid；
- profile token 实际映射（修改 token 后输出变化）；
- A3 / fitToPage / print area / margins；
- ZIP / relationships / content types；
- 无 media / external links / customXml / pictures / 模板示例文字；
- 无显式 editAs；
- 修复前包结构测试能复现失败（6 项），修复后同一审计 38/38 PASS；
- 修复版 XLSX 可重复：两次生成 SHA-256 相同（`3c271e4b...`）；
- 业务 XML（workbook/styles/sheet/drawing）在修复前后逐字节相同，修复只改变包元数据与关系目标。

---

## 10. Mac / Windows Excel

```text
Mac Excel     = NOT RUN
Windows Excel = NOT RUN
```

本轮没有打开 Excel，也没有伪造拖拽、保存、重开、打印预览结果。验收步骤见：

```text
docs/agent/flowchart-excel/golden-fixture-manual-acceptance.md
```

在真实 Excel 结果补齐前：

- GE09 的 `flowChartConnector` site 行为仍是 `unverified`；
- `edit_as` 仍为 `pending`；
- `exportReady` 仍为 `false`；
- 不进入 connector spike，不生成 V5 大图。

---

## 11. 本轮实际命令

```text
pwd / git branch / git rev-parse HEAD / git status --short
~/.dotnet/dotnet --version
~/.dotnet/dotnet build FlowchartExcelExporter.slnx -c Release
~/.dotnet/dotnet test FlowchartExcelExporter.slnx -c Release
~/.dotnet/dotnet build src/GoldenFixtureExporter/... -c Release
~/.dotnet/dotnet run --project src/GoldenFixtureExporter/... -- <graph> <layout> <profile> <expected> <xlsx>
python3 scripts/validate_fixture.py <xlsx> <layout> <expected> <profile> <grid> <out>
python3 scripts/validate_package_repair.py <xlsx> <out>
scripts/run_package_repair.sh
~/.dotnet/dotnet test tests/GoldenFixtureExporter.Tests/... -c Release
node --test tests/fixture-schema.test.js
cd website && node --test tests/flowchart-excel/*.test.js
cd website && npm test
cd website && .flowchart-venv/bin/python -m unittest discover -s services/flowchart_excel/tests -t .
cd phase1 && .flowchart-venv/bin/python -m unittest discover -s tests -t . -p 'test_*.py'
soffice --headless --convert-to pdf ... ; sips -s format png ...
```

---

## 12. 输出文件

原始文件（保留，不再作为交付物）：

```text
/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/
└── golden-fixture-default-twoCell.xlsx     # broken package, SHA dfedfd79...
```

修复版交付物：

```text
/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/
├── golden-fixture-package-repaired.xlsx
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
├── preview/
│   └── golden-fixture-package-repaired.pdf
└── before-audit/
    ├── package-validation-report.json       # FAIL，证明修复前失败
    ├── content-types-report.json
    └── relationships-report.json
```

当前交付 XLSX SHA-256：

```text
3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32
```

---

## 13. 未完成 / 下一步

未完成：

- Mac Excel 验收；
- Windows Excel 验收；
- GE09 `flowChartConnector` connection site 行为；
- 真实打印可读性；
- connector preset A/B/C 对比；
- 63 节点扩展、V5、正式导出。

下一步（需用户审阅后）：

1. 按 `golden-fixture-manual-acceptance.md` 在 Mac/Windows Excel 打开修复版 fixture；
2. 记录 `golden-fixture-after-*-save.xlsx` 与截图；
3. 通过后再进入 Phase 2 connector spike；
4. 在真实 Excel 结果前，不修改 `edit_as`、不打开 `exportReady`。

**本阶段到此停止。**

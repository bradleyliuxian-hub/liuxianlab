# Project Status

Updated: 2026-10-30

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`；HEAD：`9e1f959 feat(journal-entry): ship v1.3.9 standard export preview and split workspace`。
- 工作区：clean。三个本地提交：
  - `e9b9e46` feat(company-map): add batch company address lookup V1.1；
  - `9e1f959` feat(journal-entry): ship v1.3.9 standard export preview and split workspace；
  - 本文件所在 `docs:` 提交。
- 未 deploy；未改生产数据库；未 restart PM2。

## Current Focus

**公司地图地址查询 V1.1 已完成本地实现与验收：标准 Excel 模板下载 + 网页临时 API Key。**

- 模板：`private/tools/company-map-lookup/template.js` 用 vendored SheetJS 在浏览器生成
  `公司地图地址查询模板.xlsx`，Sheet 为 `公司名单`（仅表头：公司名称、城市/地区（可选））
  与 `填写说明`（11 条规则）；无新增 npm 依赖。
- 用户 Key：页面步骤 01 选择高德/百度、输入自己的 Key（`type=password` + 显示/隐藏），
  `POST /api/company-map-lookup/provider/validate` 做一次最小真实查询验证；
  `POST /jobs` 接收 `{ provider, apiKey, items }`。
- Key 生命周期：仅存在于请求与 Job 执行闭包；不写入 localStorage/sessionStorage/
  IndexedDB/Cookie/URL/日志/DB/Job metadata/results/导出文件；终态后随闭包释放。
- Key 优先级：用户 Key > 服务端 `AMAP_WEB_SERVICE_KEY` / `BAIDU_MAP_AK`；都缺失返回
  `MAP_API_KEY_REQUIRED`。错误码区分 INVALID / QUOTA / FORBIDDEN / TIMEOUT / PROVIDER。
- 预览与去重：上传后显示 共识别 / 有效 / 无效 / 重复；完全相同的公司名称 + 地区合并为
  一次地图查询，导出时逐行展开对应原始记录。
- Provider 抽象、匹配策略（precision > recall）、review 人工确认、owner scope 均未改。
- Job 仍为 **memory only**，Node/PM2 重启后未完成任务与结果消失；未新增 migration。
- 任务前已有的 journal-entry dirty work 未被修改。

## Known Broken / Unresolved

- 真实地图 API smoke **NOT RUN**：未读取 `.env`、未消耗未授权 quota。
- Provider 参数错误码映射覆盖常见高德 infocode / 百度 status；未逐一连接真实网关验证。
- 生产部署与 migration **NOT RUN**；序时账 `002`–`006` 尚未应用到生产库。
- company-map Job 不做持久恢复。

## Pending Decision

- 是否配置开发/生产 Provider Key，并允许少量真实 API smoke（2–3 家公司）。
- 是否需要 company-map Job 持久化/历史回看；若需要，先做 additive、owner-scoped migration。
- 是否进入生产部署窗口；部署前必须完成 provider license/quota preflight 和序时账 migrations。

## Last Verification

- 2026-10-28 Company Map Lookup V1.1：
  - `node --check`（backend / frontend / template / tests）**PASS**。
  - `node --test tests/company-map-lookup/*.test.js` **35 pass / 0 fail**
    （backend 21、template 5、frontend contract 5、Chrome E2E 4）。
  - `npm test` **517 pass / 0 fail**。
  - `git diff --check` **PASS**；untracked company-map 文件 trailing whitespace / EOF **PASS**。
  - 模板：XLSX 生成、两个 Sheet、表头、无 Key 内容均 PASS；E2E 下载模板后可重新上传。
  - Key 泄漏检查：GET job / results / cancel / job store / 导出 CSV / 导出 XLSX / 浏览器
    storage / console 均未出现测试 Key；validate 需要登录且受 same-origin 保护。
  - 真实地图 API：**NOT RUN**。
- 2026-10-26 V1：npm 501 pass；真实地图 API NOT RUN。
- 2026-10-23 序时账：Python 273 pass、npm 476 pass、browser E2E PASS。

## Next Action

- 在登录浏览器复核新步骤 01、模板下载、数据预览与导出对应关系。
- 经明确授权后，配置本地 Provider Key 或使用用户 Key 跑 2–3 家真实公司 smoke；
  不要打印 key 或完整请求 URL。
- 若上线：先做部署 preflight；不要直接 commit/push/deploy。

## Git Record

- 本轮已 commit（company-map V1.1、序时账 v1.3.9、docs）；未 deploy。
- 最近提交见上方 Git State。
- company-map V1/V1.1 与 summary_structure 已纳入提交。

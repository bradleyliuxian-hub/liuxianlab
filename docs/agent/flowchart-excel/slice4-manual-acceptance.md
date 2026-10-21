# Slice 4 手工验收清单

状态：**PARTIAL — 8080 重启 PASS；浏览器步骤 NOT RUN**

前置条件：

- 8080 已获授权重启，加载 `server.js` 的 review graph parser 例外与 `/api/flowchart-excel` 新路由。
- 使用真实登录账号，不读取或打印 session/密钥。
- 不调用 AI，不生成 XLSX。

## 1. 启动与入口

1. 检查 `GET /health` 返回 `{"ok":true}`（PASS，PID 90545）。
2. 打开 `http://localhost:8080/tools/flowchart-excel`。
3. 上传原始图片 + 外部 AI ZIP，等待 `review_required`。
4. 任务详情应显示“打开人工复核工作台”按钮。
5. 点击后打开 `/app/tools/flowchart-excel/review.html?job=<jobId>`。
6. 顶部应显示实际文件名、job ID、3/63/58（真实任务）、22 unresolved、8 warnings、`trade_purchase_cn`、`edit_as=pending`、`exportReady=false`。

预期结果：PASS / FAIL / BLOCKED（记录实际）。

## 2. 问题列表与定位

1. 默认“待处理”筛选应显示 unresolved。
2. 分组应包含控制码、结构/泳道、连线/端口、判断分支、文字、坐标、元数据等实际分组。
3. 点击一个控制码问题，应定位到关联节点；图中高亮 bbox。
4. 点击“定位关联对象”，应切换到节点属性。
5. 切换严重度/分组筛选，列表应更新。
6. 点击“警告”Tab，应显示 8 条 warning；Windows 验收 warning 不应有可编辑状态按钮。
7. 点击“历史”Tab，首次应显示空状态或最近修订。

预期结果：PASS / FAIL / BLOCKED。

## 3. 图与 overlay

1. 原图应加载；显示尺寸/坐标基准。
2. 打开“显示 overlay”，应出现 overlay 叠层。
3. 泳道虚线、节点矩形、连线应显示。
4. 点击节点/连线/泳道，应选中并在右侧显示属性。
5. 缩放 +/− 应改变画布宽度；滚动可查看。
6. 修改节点文字后，图上选中标签/右侧字段应更新；保存前显示“未保存”。

预期结果：PASS / FAIL / BLOCKED。

## 4. 属性编辑与保存

1. 修改节点 label、shape、lane、bbox、confidence、review_status。
2. 修改连线 source/target/ports/kind/label/route/review_status。
3. 修改泳道 label/order/orientation/bbox。
4. 对错误 shape / dangling edge 点击保存，应显示具体 Schema/reference 错误，且保留编辑内容。
5. 对合法修改保存，应返回新 revision，右侧显示“未保存”消失，顶部 revision 变化。
6. 刷新页面，修改应仍在。
7. 点击复核文件下载，应能下载 `flowchart.reviewed.json` / CSV / style。

预期结果：PASS / FAIL / BLOCKED。

## 5. 控制码与分支

1. 检查 `T.AC1`、`T.AC2`、`PRP 1-4`、`PRP 5` 没有被自动映射为 CA/PRP/TOE。
2. 在节点控制标记区域手动添加一个合法控制标记，保存后 revision 历史应记录。
3. 尝试为 N034 新增分支连线但不填 label，应保存失败并提示 label 必填。
4. 选择真实 target 并填写“是/否”后保存，应成功。
5. 不能自动创建缺失节点或自动猜测端点。

预期结果：PASS / FAIL / BLOCKED。

## 6. 问题状态

1. 打开一个 unresolved，填写处理说明，标记 `resolved`。
2. 刷新后状态仍为已解决。
3. 标记 `resolved` 但不填处理说明，应被拒绝。
4. 尝试编辑 warning（如 Windows 验收）应被拒绝/不可编辑。
5. 完成所有阻断项后，“完成复核”按钮才可用。
6. 完成复核后顶部状态为“复核已完成”，但 Excel 仍显示未开放。

预期结果：PASS / FAIL / BLOCKED。

## 7. 历史与并发

1. 打开“历史”Tab，应看到 graph 保存/issue 更新/approve 记录。
2. 记录应包含 revision、action、actor、时间、变更数量/目标。
3. 同一账号两个标签页：A 保存后，B 用旧 revision 保存应收到 409 冲突。
4. B 不应覆盖 A 的修改。

预期结果：PASS / FAIL / BLOCKED。

## 8. 安全与边界

1. 未登录直接访问 review 页面应跳转登录。
2. 未登录调用 review API 应 401。
3. 跨源 PUT 应 403。
4. 用户 B 不应读取用户 A 的 review / revisions / source。
5. 页面不应显示本机绝对路径。
6. 不调用 AI、不生成 XLSX；network 中不应出现模型端点。

预期结果：PASS / FAIL / BLOCKED。

## 9. 当前状态记录

```text
8080 重启：PASS
/health：PASS
未登录 review 页面/API 302：PASS
真实浏览器入口：NOT RUN
真实任务复核 UI：NOT RUN
手工保存/历史：NOT RUN
```

原因：仅完成了服务启动和未登录路由检查；尚未使用真实登录账号执行浏览器交互。API 已用临时 test root 和真实 ZIP 验证。

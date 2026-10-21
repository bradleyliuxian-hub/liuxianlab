# V4 连接器路由验收报告

- 输入：approved graph revision 5，58 条逻辑边
- 输出：58 个原生 `xdr:cxnSp`
- 几何：`a:custGeom` 正交折线，`a:stCxn` / `a:endCxn` 绑定真实 shape id
- 验收方式：直接解析生成 XLSX 的 `twoCellAnchor` marker 与 custGeom 路径，不使用预览图或中心线近似

## 总体结果

```text
edges                 58
bound                 58/58
invalid endpoint refs 0
confirmed collisions  0
label collisions      0
blocked routes        0
max bends             6
```

## 与 V2 review edges 对照

V2 的 23 条 review edge 在 V4 全部 clear：

```text
E004 clear
E005 clear
E006 clear
E007 clear
E010 clear
E012 clear
E016 clear
E017 clear
E023 clear
E024 clear
E029 clear
E031 clear
E038 clear
E040 clear
E042 clear
E045 clear
E047 clear
E049 clear
E050 clear
E051 clear
E054 clear
E056 clear
E058 clear
```

## 路由方法

1. 每条 lane 由 ELK layered 生成节点位置。
2. 依据 source/target 相对位置选择端口。
3. 优先尝试直线、L 形、Z 形正交路径，逐段检查节点/标签/图例障碍。
4. 简单路径失败时使用 A* 正交搜索，转弯有惩罚，路径禁止对角。
5. 分支标签在路由后放置，避开节点、其他标签和所有连接线。
6. 每条边生成一个 `xdr:cxnSp`；没有拆分为多条 line/sp。

## 状态定义

- `confirmed_collision`：生成文件的实际 marker + custGeom 路径与某个非端点业务节点或分支标签相交。
- `clear`：上述几何检查无相交。
- `indeterminate`：Excel 实际运行时可能因连接器重排产生不同路径；当前未在 Excel 中运行，因此不计入 `clear` 的运行时保证。

本次自动检查结果：

```text
confirmed_collision = 0
indeterminate = 58（Excel 运行时行为尚未实测）
```

因此不能把“Excel 中永不穿越”写成已验收；只能在生成文件几何上声明 0 confirmed collision。

## 风险

1. Excel 对 `custGeom` 连接器的编辑、拖动端点、重排行为未验收。
2. 若 Excel 重算路径，可能重新产生穿越；需要 Mac/Windows 实测。
3. 4 条 A* 路径有 4–6 个弯，视觉可读性需人工确认。
4. 连接器端口索引使用 `top=0/left=1/bottom=2/right=3`；未对 template 的 idx 4/5 做特殊映射（本图未使用输入输出/数据库的 4/5 端口）。

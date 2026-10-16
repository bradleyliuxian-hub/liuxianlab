# excel-tail-risk / business-type (汇率)

Not every number obeys the same decimal standard. `business-type.js` classifies
a numeric cell and derives its `allowedDecimalPlaces`:

| businessType | allowedDecimalPlaces | treatment |
|---|---|---|
| `normal_number` | 2 | over 2 decimals ⇒ 普通数值问题 / 公式结果问题 |
| `exchange_rate` | 4 | ≤4 normal; >4 ⇒ 汇率精度问题 |
| `suspected_exchange_rate` | 2 (NOT exempted) | 单独观察 + 汇率检查 |
| `percentage` | — | analysed separately (never in the normal list) |

## Detection is CONTEXT based (never value / decimal count)

Strong evidence (→ `exchange_rate`, confidence high):
1. Same-row / same-column nearby title contains 汇率 / 兑换率 / 汇价 /
   exchange rate / fx rate / currency rate.
2. Title contains a currency pair (USD/CNY, EUR/USD, HKD/CNY, JPY/CNY, …).
3. Excel named range on the cell looks like a rate (exchangeRate, fxRate,
   currencyRate, USD_CNY_RATE).
4. A referenced source cell's title is a rate (derived rates).

Weak evidence (→ `suspected_exchange_rate`, confidence low): a currency code
(e.g. USD) appears nearby but there is no rate keyword/pair. Suspected rates are
**not exempted**; they are surfaced for human confirmation.

The title lookup stops at the nearest non-empty cell: a numeric neighbour blocks
it, so a title far to the left never leaks onto an unrelated value in the row.

## Precision + impact

- `exchange_rate`: precision 正常 when ≤4 decimals, else 超出4位 → an issue
  (risk 高 when referenced, else 中).
- `suspected_exchange_rate`: judged against 2; over ⇒ risk 观察 (汇率精度问题 flagged as 疑似).
- A precise rate is NOT a tail-risk issue, but is still counted for
  direct/downstream references; large reach is labelled 高影响基础参数.

## 汇率血缘（pure reference）

Exchange rate propagates along **pure references** (a formula whose body is
exactly one cell/name reference — `=B2`, `=$B$2`, `='FX'!$B$2`, `=USD_CNY_RATE`).
`business-type.js#pureReference` owns the parse; `=B2+0`, `=B2*1`, `=ROUND(B2,4)`,
`=ABS(B2)`, `=SUM(B2)`, `=(B2)` are NOT pure (they were computed).

- Pure reference to `exchange_rate` → inherits `exchange_rate` (`passthrough`,
  `depth = upstream + 1`, `source` = the originating cell). Chains recurse
  across sheets and special sheet names.
- Any real computation consuming a rate → `exchange_rate_derived`. A derived
  cell is NOT automatically granted 4 decimals (judged against 2); if its own
  context clearly names it a rate (e.g. a `CNY/USD` title) it is re-identified as
  `exchange_rate`.
- "References a rate" ≠ "is a rate": `=rate*amount` is an amount, not a rate.

Rate rows carry: 类型 (原始汇率 / 汇率直接引用 / 汇率派生计算 / 疑似汇率), 来源汇率,
传递层级, plus direct/downstream counts. A precise rate with large reach is
「高影响基础参数」 (影响), never 「尾差异常」.

## 汇率检查 sheet

Columns: 序号 / 工作表 / 单元格 / F5定位地址 / 当前值 / 公式 / 类型 / 来源汇率 /
传递层级 / 允许小数位 / 实际有效小数位 / 精度状态 / 直接引用次数 / 下游引用次数 /
影响等级 / 备注. All rate-family rows (raw / passthrough / derived / suspected) are
listed, sorted by `downstreamReferenceCount` desc.

Read when: changing business-type detection / exchange-rate rules.
Authority: `business-type.js`, `risk-core.js`, `decimal-workbook.js`, tests.

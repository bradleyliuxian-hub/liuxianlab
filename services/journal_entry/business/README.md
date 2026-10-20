# Journal Business Classification

This module classifies canonical `JournalEntry` vouchers into deterministic,
explainable business categories. It does not read Excel directly and does not
change Contra or Anomaly scoring.

## Public API

```python
from services.journal_entry.business import classify_entry, classify_entries

one = classify_entry(journal_entry)
all_results = classify_entries(journal_entries)
```

`BusinessClassificationEngine` is a small OO wrapper around the same pure
classification functions.

## Business categories

Stable codes `JE-B001` through `JE-B020` cover:

- 职工薪酬
- 税费
- 存货采购
- 长期资产
- 折旧摊销
- 销售收入
- 借款筹资
- 利息收支
- 日常费用
- 员工借款
- 单位往来
- 押金保证金
- 投资本金
- 分红股利
- 生产制造
- 研发
- 政府补助
- 资金内部往来
- 汇兑损益
- 其他业务

## Signals

Classification is deterministic and uses three signal classes:

1. hard rules for highly specific patterns such as bank-to-bank transfers,
   explicit employee advances, deposits/guarantees, FX descriptions, and
   depreciation/amortization;
2. debit/credit account-category structure;
3. account-name anchors plus weak description keywords.

Description text never overrides an incompatible accounting structure except
for explicitly documented hard rules.

## Confidence

`score` (0..100) is a heuristic match score. `confidence` (0..1) is a
rule-certainty indicator derived from the top score and candidate margin. It is
not a statistical probability.

If the top evidence is weak or competing categories are too close, the engine
conservatively returns `JE-B020 / 其他业务` and keeps the candidate scores for
review.

## Traceability

Every classification retains the voucher key plus source sheet names and source
row numbers. Candidate evidence is structured and includes structural rules,
matched accounts, and matched description keywords.

## Non-goals in this version

- no PMI or cross-customer learned matrix
- no BGE/embedding/NN/PyTorch
- no global customer-memory learning
- no LLM classification
- no user correction persistence
- no Web/API/DB changes

Those can be layered later without changing the canonical accounting core.

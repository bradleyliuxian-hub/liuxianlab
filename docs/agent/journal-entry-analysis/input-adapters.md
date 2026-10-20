# Journal Entry — Real Ledger Input Adapters

Source:

- `services/journal_entry/input_layouts.py`
- `services/journal_entry/mapping.py`
- `services/journal_entry/normalize.py`
- `services/journal_entry/reader.py`

The adapter converts supported Excel source layouts into canonical
`JournalLine.debit` / `JournalLine.credit`. Contra and anomaly never see the
source layout.

## Supported layouts

### DEBIT_CREDIT

```text
借方金额 | 贷方金额
100.00  | 0
0       | 100.00
```

This is the original Phase 1 layout and remains the highest-priority
auto-detection layout.

### DIRECTION_AMOUNT

```text
方向 | 金额
借   | 100.00
贷   | 100.00
```

Conversion:

```text
借 +100 -> debit 100, credit 0
贷 +100 -> debit 0, credit 100
借 -100 -> debit -100, credit 0
贷 -100 -> debit 0, credit -100
借 0    -> debit 0, credit 0
贷 0    -> debit 0, credit 0
```

Negative amounts are **not** converted to absolute values. They preserve the
Phase 1 red-letter semantics and are resolved later by the contra normalizer.

### SIGNED_AMOUNT

Signed amount is only accepted with an explicit convention:

```text
positive_side = debit
```

Then:

```text
+100 -> debit 100
-100 -> credit 100
```

For `positive_side = credit`, the sides are reversed.

Signed amount is never inferred from a column name or from positive/negative
values alone. A `positive_side` convention is required.

## Direction vocabulary

Accepted direction values (case-insensitive, surrounding spaces ignored):

```text
debit:  借, 借方, 借项, D, Debit, DR
credit: 贷, 贷方, 贷项, C, Credit, CR
```

Blank direction with a zero amount produces a zero canonical line.

Blank direction with a non-zero amount is a structured row issue.

Invalid values such as `收`, `付`, `?`, or an Excel error value are row issues.
There is no "default debit" or "default credit" fallback.

## Duplicate headers

Headers are stored with their real column index. A normalized header may occur
at multiple indices.

Example:

```text
摘要 at column 6
摘要 at column 13
```

Auto-mapping treats this as ambiguity:

```json
{
  "field": "description",
  "reason": "ambiguous",
  "candidates": [
    {"column_index": 6, "header": "摘要"},
    {"column_index": 13, "header": "摘要"}
  ]
}
```

No content-based AI guess is performed. The caller selects one by 1-based column
index:

```python
mapping = {"description": 6}
```

`FieldMapping.column_index` and `ColumnMapping.source_index()` resolve the
selected duplicate without overwriting the other one.

## Current real-ledger profile

The supplied `.xls` sample is handled with this explicit, neutral mapping profile:

```text
profile:          direction_amount_ledger_v1
header row:       1
amount layout:    direction_amount
voucher field:    凭证号数
date field:       日期
account code:     科目编码
account name:     科目名称
description:      摘要 at column 6 (1-based)
direction:        方向
amount:           金额
original amount:  原币
currency:         币种
ignored:          唯一列, 数量, 借正代付 (mapped only), 摘要 at column 13,
                  订单, 客供
```

The second `摘要` is kept as an ambiguity candidate, not silently selected.

## Mapping result / preview contract

`ColumnMapping.to_dict()` exposes:

```json
{
  "header_row": 1,
  "sheet_name": "序时账",
  "amount_layout": {
    "layout": "direction_amount",
    "direction_column": "方向",
    "amount_column": "金额"
  },
  "fields": {},
  "ambiguous": {},
  "ambiguous_candidates": {},
  "warnings": []
}
```

For header-row candidates and sheet structure, use
`WorkbookReader.inspect_sheet()` / `inspect_workbook()`.

`ColumnMappingError.details` includes missing fields, amount layout, ambiguity,
candidate column indices, and headers. It is suitable for a future mapping UI.

## Excel error values

Recognized error tokens include:

```text
#NAME?, #VALUE!, #REF!, #DIV/0!, #N/A, #NUM!, #NULL!,
#GETTING_DATA, #SPILL!, #CALC!, #CONNECT!, #BLOCKED!,
#UNKNOWN!, #FIELD!, #BUSY!
```

Critical fields:

```text
voucher_id, account_code/account_name, date,
direction, amount, debit, credit, signed_amount
```

An Excel error in a critical field becomes a row issue; the row is skipped.

Optional fields (`description`, `preparer`, `currency`, `detail_account`,
`period`, `entity`, `line_id`) become `None` with a structured row warning.

## Formula cells

The reader opens a second formula view (`data_only=False`) to identify formula
cells. If a formula cell has no cached value in the `data_only=True` view:

- critical field -> row issue `missing_cached_formula_value`
- optional field -> row warning

No formula is evaluated.

## XLS / XLSX status

```text
XLSX: SUPPORTED (openpyxl)
XLS:  SUPPORTED (xlrd 2.0.2)
```

Formal dependency (shared Python environment):

```text
workers/excel/requirements.txt
  openpyxl==3.1.5
  xlrd==2.0.2
```

The `.xls` reader is read-only and converts xlrd cell types into the same raw
table representation used by the openpyxl reader:

- date serial -> Python datetime/date
- number -> int/float (then Decimal in normalization)
- boolean -> bool
- xlrd error code -> Excel error token
- empty/blank -> None

No macro execution, external-link fetching, formula evaluation, or Office
conversion is used.

The real sample `序时账-巨效001-2025.xls` is a Composite Document File V2
(`.xls`) and is read directly with xlrd.

## Security boundary

- No network.
- No subprocess / shell.
- No `eval` / `exec`.
- No formula evaluation.
- No database.
- No model download.
- Reader accepts only a caller-provided workbook path.
- `.xlsx` via openpyxl and `.xls` via xlrd are supported.
- `.xlsm`, `.xlsb`, `.csv`, and archives are not supported.

## Local real-sample acceptance (aggregate only)

```text
format:                 .xls (Composite Document File V2)
sheet count:            1
selected sheet rows:    8,671
selected sheet columns: 17
header row:             1
amount layout:          direction_amount
raw data rows:          8,670
canonical lines:        8,668
row issues:             2 (blank voucher / summary rows)
voucher count:          1,674
exactly balanced:       1,674
within-tolerance only:  0
unbalanced:             0
largest voucher lines:  318
distinct account codes: 124
negative lines:         905
```

No financial rows, descriptions, account lists, or amounts were printed or
copied into the repository.

## Known limitations

- `xlrd` 2.x reads `.xls`, not `.xlsx`; openpyxl handles `.xlsx`.
- xlrd does not expose formula metadata for `.xls`; cached cell values are used.
- Signed amount requires an explicit `positive_side`.
- No fuzzy header matching.
- Duplicate headers require explicit column-index selection.
- No currency conversion; `原币` is mapped to `original_amount`.
- No customer “唯一列” dependency; voucher grouping stays canonical.
- Formula cells without cached values cannot be recalculated.
- No UI, upload API, worker, or export in this phase.

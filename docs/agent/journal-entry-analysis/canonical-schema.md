# Journal Entry — Canonical Schema

Source: `services/journal_entry/schema.py`.

## JournalLine

A `JournalLine` is one canonical journal line, traceable to one Excel row.

Required:

- `voucher_id`
- `account_code` or `account_name` (at least one)
- `sheet_name`
- `source_row` (1-based Excel row)

Optional:

- `account_code`
- `account_name`
- `detail_account`
- `date`
- `period`
- `entity`
- `currency`
- `original_amount`
- `description`
- `preparer`
- `line_id` (external business identifier; derived as `<sheet_name>:<source_row>` when omitted)
- `internal_line_key` (derived, internal unique identity)

Important identity rule:

```text
external line_id may repeat
internal_line_key is unique within the workbook
```

The internal key is length-prefixed, for example:

```text
3:序时账:2
```

It is used by contra node identity, allocation traceability, deduplication, and
solver signatures. `line_id` is retained for display and ERP/business identity.

`JournalEntry.from_lines()` rejects duplicate `internal_line_key` values inside
one entry. It does not reject duplicate external `line_id` values.

Source layouts are converted to canonical debit/credit before this point:

```text
debit_credit     -> debit / credit columns
direction_amount -> direction + amount
signed_amount    -> explicit positive_side convention
```

A source direction column or signed amount never enters `JournalLine`.

Amount fields:

- `debit` and `credit` are `Decimal`, quantized to `0.01`.
- `original_amount` is optional and also `Decimal`.
- A canonical line may contain a negative debit or credit (red-letter entry).
- A line with debit and credit both non-zero is allowed at the canonical layer;
  the contra normalizer reduces it to its net economic side and reports a
  warning.
- A zero line is allowed for traceability; it produces no contra node.

Float values are accepted only because openpyxl returns floats for numeric
cells. They are immediately converted through `Decimal(str(value))`; no float
arithmetic is used by the engine.

## JournalEntry

A `JournalEntry` is created only through `JournalEntry.from_lines(lines)`.

Fields:

- `voucher_id`
- `lines`
- `date`
- `period`
- `entity`
- `total_debit`
- `total_credit`
- `imbalance`
- `account_codes`
- `account_names`
- `description`
- `preparer`
- `validation_flags`

Computed behavior:

- `total_debit` / `total_credit` sum the canonical line amounts.
- `imbalance = total_debit - total_credit`.
Balance properties:

```python
exactly_balanced      = imbalance == Decimal("0.00")
is_within_tolerance   = abs(imbalance) <= AMOUNT_TOLERANCE
is_balanced           = exactly_balanced   # compatibility alias, never tolerance
```

`is_balanced` must **not** be used to hide a non-zero difference.

Validation flags currently include:

- `unbalanced`
- `within_tolerance`
- `rounding_residual`
- `mixed_entities`
- `mixed_periods`
- `mixed_dates`

Flag semantics:

| Case | exactly_balanced | within_tolerance | flags |
|---|---:|---:|---|
| `imbalance == 0` | true | true | none |
| `0 < abs(imbalance) <= 0.01` | false | true | `unbalanced`, `within_tolerance`, `rounding_residual` |
| `abs(imbalance) > 0.01` | false | false | `unbalanced` |

A `0.01` residual is therefore **not** called exactly balanced. Downstream code
may choose a lower severity because `is_within_tolerance` is true.

Decimal quantization happens before balance comparison. With currency precision
`0.01`, raw residuals `0.009`, `0.010`, and `0.011` all quantize to `0.01` for
the current line-level amounts. Tests document this explicitly rather than
pretending sub-cent values survive.

Account codes/names are sorted unique tuples for deterministic output.
Description/preparer join unique non-empty values in source order.

Flags do not reject the entry. Contra analysis can return a partial result.

## Voucher key strategy

Implemented by `make_voucher_key()`:

```text
(entity or "")
+ period, when present
+ otherwise exact date
+ otherwise empty discriminator
+ voucher_id
```

This prevents January `记-001` and February `记-001` from being merged when a
period or date is available. The empty discriminator is a documented limitation:
without period or date, the engine cannot distinguish cross-period reuse of the
same voucher id.

Current assumption:

> `voucher_id` is unique within `entity + period`.

Consequence: the same voucher id, same entity, same period, and different dates
are merged into one `JournalEntry` and flagged with `mixed_dates`.

```text
BUSINESS RULE TO CONFIRM
```

All grouping is centralized in `normalize.py`; reader, contra, and future
anomaly layers never re-group rows.

## Decimal and tolerance

- `CURRENCY_PRECISION = Decimal("0.01")`
- `AMOUNT_TOLERANCE = Decimal("0.01")`
- Rounding uses `ROUND_HALF_UP`.
- JSON serialization uses explicit two-decimal strings, e.g. `"1000.00"`.

## Missing and invalid values

- Empty amount (`None`, `""`, `"-"`) -> zero with state `empty`.
- Explicit zero -> state `zero`.
- Invalid amount (`"ABC"`, bool, NaN) -> structured `NormalizationError`; never
  silently coerced to zero.
- Invalid date -> structured row issue; the row is skipped.
- Missing voucher/account -> structured row issue; the row is skipped.

## Duplicate voucher handling

- Same voucher id in different periods/dates -> separate entries.
- Duplicate identical lines inside one voucher are preserved as separate lines.
- Contra allocation between duplicate identical nodes is deterministic by line
  id, but may be ambiguous (`solution_count > 1`).

## Source row traceability

Every line carries:

- `sheet_name`
- `source_row`
- `internal_line_key` (unique solver identity)
- `line_id` (external business identity, may repeat)

Every contra node and allocation carries:

- `internal_line_key` / `source_internal_key` / `target_internal_key`
- `line_id` / `source_line_id` / `target_line_id`
- node id

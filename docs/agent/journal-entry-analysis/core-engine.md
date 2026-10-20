# Journal Entry Analysis — Phase 1 Core Engine

Phase 1 is a **pure Python core** under `services/journal_entry/`.

Implemented:

- Phase 2 anomaly package under `services/journal_entry/anomaly/`
- canonical `JournalLine` / `JournalEntry` schema with separate external
  `line_id` and internal row identity
- read-only `.xlsx` intake, non-empty bounds, header-row inspection, and formula-cell detection
- source amount-layout adapter (`debit_credit`, `direction_amount`, explicit `signed_amount`)
- conservative column mapping (Chinese/English aliases + explicit mapping,
  duplicate-header indices, amount-layout selection)
- amount/date normalization with structured row errors
- voucher reconstruction (single pass, explicit voucher key)
- exact-balance vs within-tolerance separation with Decimal tolerance
- sink-source normalization
- deterministic, bounded multi-line contra allocation
- structured contra result models
- real `.xlsx` fixtures, golden JSON, and unittest coverage

Not implemented in the core package:

- Node API/routes
- PostgreSQL schema/migration
- job queue/worker
- frontend/viewer
- export workbook
- network or LLM calls

## Package layout

```text
services/journal_entry/
├── __init__.py
├── errors.py
├── input_layouts.py
├── schema.py
├── reader.py
├── mapping.py
├── normalize.py
├── anomaly/
│   ├── __init__.py
│   ├── constants.py
│   ├── models.py
│   ├── features.py
│   ├── grouping.py
│   ├── frequency.py
│   ├── materiality.py
│   ├── scoring.py
│   └── engine.py
├── contra/
│   ├── __init__.py
│   ├── models.py
│   ├── normalizer.py
│   ├── solver.py
│   ├── ranking.py
│   └── engine.py
└── tests/
    ├── fixtures/
    ├── fixture_factory.py
    └── test_*.py
```

## Typical usage

```python
from services.journal_entry.normalize import normalize_file
from services.journal_entry.contra import ContraEngine

normalized = normalize_file("ledger.xlsx", sheet_name="序时账")
for entry in normalized.entries:
    result = ContraEngine().analyze(entry)
    print(result.to_dict())
```

If header or mapping is uncertain, use the reader/mapping layers explicitly:

```python
from services.journal_entry.reader import WorkbookReader
from services.journal_entry.mapping import suggest_mapping

reader = WorkbookReader("ledger.xlsx")
inspection = reader.inspect_sheet("序时账")
mapping = suggest_mapping(
    headers,
    explicit={"voucher_id": "凭证号", "debit": "借方金额", "credit": "贷方金额"},
)
```

## Boundaries

- `reader.py` never performs accounting logic.
- `input_layouts.py` defines source-layout/direction/error models only.
- `mapping.py` never reads accounting values.
- `normalize.py` is the only voucher grouping layer.
- `contra/` consumes `JournalEntry` only.
- `anomaly/` consumes `JournalEntry` / `VoucherFeatures` only; it never reads
  workbooks or regroups vouchers.
- No module imports pandas, NumPy, network clients, subprocess, or database code.
- No module accepts shell commands or arbitrary server paths.

## Tests

```bash
.venv/bin/python -m unittest discover -s services/journal_entry/tests -t .
```

Fixtures are real `.xlsx` files generated from
`services/journal_entry/tests/fixture_factory.py`.

XLSX is supported via openpyxl. XLS is supported via xlrd 2.0.2
(both pinned in the shared `workers/excel/requirements.txt`). No Office
converter or subprocess is used. See `docs/agent/journal-entry-analysis/input-adapters.md`.

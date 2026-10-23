# Journal Entry Export Preview Workspace

Date: 2026-10-23
Version: v1.3.3

## Scope

This phase adds a real, server-paged export preview before Journal Entry export:

```text
canonical result
→ filters
→ candidate rows
→ manual row inclusion / exclusion
→ final export rows
→ grouping
→ column projection
→ Excel / ZIP
```

It does not change Reader / Mapping / Normalize / Business / Contra / Anomaly
semantics. Row exclusion is an export projection only; canonical results are
never modified.

## Row identity

Stable identity is `job_id + internal_line_key`.

- Single job: `job_id` is filled server-side when omitted.
- Batch: both fields are required in practice because internal keys can repeat
  across files.
- `line_id`, source row and array position are never used as identity.
- Manual row lists are capped at 5,000 explicit identities. For larger sets the
  user must use filters. Default mode only stores exclusions (`all_except`).

## Row selection modes

```json
{
  "rowSelectionMode": "all_except",
  "excludedRows": [{ "job_id": "...", "internal_line_key": "3:序时账:2" }]
}
```

```json
{
  "rowSelectionMode": "only_selected",
  "includedRows": [{ "job_id": "...", "internal_line_key": "3:序时账:2" }]
}
```

`all_except` is the default: every filtered row is kept unless explicitly
excluded. `only_selected` is used by "仅保留当前页"; it is capped and prompts the
user to use filters above the cap.

## API

### Split export

```text
POST /api/journal-entry-splits/preview-rows
```

Request adds:

```text
page, pageSize
rowSelectionMode, excludedRows, includedRows
```

Response:

```text
candidateLineCount / includedLineCount / excludedLineCount
candidateVoucherCount / includedVoucherCount
page / pageSize / totalPages
columns / columnStats / rows
groupSummary / groups
warnings / limits
```

Rows are paginated over **candidate** rows so an excluded row remains visible
and can be restored. Each row carries `job_id`, `internal_line_key`,
`voucher_key`, `included`, and all column values.

`POST /api/journal-entry-splits/preview` and `POST /api/journal-entry-splits`
accept the same selection fields. Generation snapshots store:

```text
row_selection_mode
excluded_rows
included_rows
candidate_line_count
final_line_count
selected_columns
column_order
```

`expectedCandidateLineCount` rejects stale previews with `409`.

### Standard journal (single + batch merge)

```text
GET  /api/journal-entry-standard-exports/meta
POST /api/journal-entry-standard-exports/preview
POST /api/journal-entry-standard-exports/export
```

`scopeType` is `job` or `batch`. Batch scope consumes completed child jobs only
and validates owner isolation. The export endpoint generates
`standard-journal.xlsx` and streams it; no canonical data is modified.

### Body size

The global 16 KB JSON parser is skipped only for the authenticated preview /
export POST routes above. Those routers apply a 2 MB parser so a 5,000-row
exclusion list fits while the rest of the API keeps the small default.

## Python

`services/journal_entry/split_export.py`:

- `resolve_row_selection` validates scope membership and identity.
- `preview_rows` computes paged candidates, final stats, groups and warnings.
- `build_split_output` applies selection before grouping and writing.
- Manifests and 拆分说明 include selection and final counts.

`services/journal_entry/standard_export.py`:

- `preview_standard` for single / batch merge preview.
- `build_standard_output` writes `标准分录` + `导出说明`.

Both reuse the existing canonical result readers; no new accounting logic.

## UI

Split page (`private/tools/journal-entry-analysis/split.html`):

- Step 04 stays column configuration, now a collapsible drawer with instant
  preview refresh.
- Step 05 becomes the export preview workspace:
  - sticky toolbar, retain/exclude counts, voucher count, mode;
  - per-row retain checkbox and faded excluded rows;
  - exclude / restore current page, only current page, restore all;
  - 25/50/100/200 server-side paging;
  - wide preview;
  - final group table recalculated from retained rows only.
- Changing filters clears manual selection and shows a notice. Changing group
  dimensions keeps selection. Presets never store row identities.

Standard preview page (`standard-preview.html`):

- Same table / column / row selection model for single and batch merged
  standard journals.
- Batch mode adds `原始文件` by default so mixed-file rows are identifiable.
- Export downloads the generated workbook.

Entry points:

- Single result: `标准序时账导出预览`.
- Batch workspace: `合并序时账预览/导出`.

## Verification

```text
Journal Entry Python:  271 pass / 0 fail
Excel Review Python:    79 pass / 0 fail
npm test:              475 pass / 0 fail
smoke:                 PASS
browser E2E:           PASS (1440, 1366x768, 1920x1080)
compileall / diff:     PASS
```

E2E coverage added:

- row exclusion + restore on the split preview;
- filter change resets selection with notice;
- exported multi-sheet workbook omits the excluded row;
- standard preview excludes a row and export contains one fewer row;
- console / pageerror / HTTP 404 = 0.

## Performance

Synthetic 100k-line result (62.4 MB JSON), measured server-side:

```text
first page (50 rows):      2.58 s
page 2:                    2.46 s
exclusion + stats/groups:  2.39 s
group count:               100
```

The browser only receives the current page (50 rows) plus grouped summary.
Node does not load the canonical result; Python is the process that reads it.
The 300k case was not re-run end-to-end in this phase.

## Known limitations

- Full analysis report (`导出 Excel 报告`) still exports the standard journal
  sheet with its existing column set; per-report row exclusion is only available
  through the new standard journal export workspace.
- Batch split preview uses the same row-selection API but this phase's browser
  E2E exercises batch navigation rather than batch row exclusion. Python tests
  cover batch composite identity and cross-file exclusion.
- 300k export preview has not been benchmarked; 100k is under 3 s per request.
- No production deploy or migration was performed.

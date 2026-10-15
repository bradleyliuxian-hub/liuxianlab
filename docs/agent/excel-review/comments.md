# excel-review / comments

Comment extraction model.

- Python `services/excel_review/parser.py`: unified items; `commentType` in
  {`legacy`,`threaded`,`threaded_reply`}.
- Threaded comments parsed from OOXML (`ooxml_package.py`,
  `ooxml_threaded_comments.py`) — openpyxl save would delete them, so never
  re-save the source.
- Question = `legacy` | `threaded` root; replies are provenance only.
- Author = comment author; blank -> `未知作者`.

Read when: extraction, comment types, author normalization, Excel Address.

Tests: `services/excel_review/tests/*`.

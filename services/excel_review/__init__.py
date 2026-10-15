"""Excel Review Assistant - workbook comment extraction and review workbook.

V1.2 scope:
- Traditional Excel Comment / Note objects (openpyxl).
- Microsoft 365 threaded comments + replies, parsed directly from OOXML.
- Review workbook generation (新版批注 / 旧版批注 sheets + hidden _Mapping).
- Excel F5 / Ctrl+G address per item.

No reply upload and no automatic write-back to the source workbook.

Public entry point: ``services.excel_review.worker`` (CLI).
"""

__all__ = [
    "parser",
    "statistics",
    "review_workbook",
    "control_log",
    "status",
    "ooxml_package",
    "ooxml_threaded_comments",
]

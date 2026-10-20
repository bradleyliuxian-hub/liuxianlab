"""Structured errors for the Journal Entry core engine.

The core distinguishes caller/input problems from program bugs. Input errors
carry a stable code, a user-safe message, and optional structured details.
Unexpected exceptions are not wrapped here; they should surface to tests and
the future worker as program failures.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class JournalEntryError(Exception):
    """Base class for expected, structured Journal Entry errors."""

    code = "JOURNAL_ENTRY_ERROR"

    def __init__(
        self,
        message: str,
        *,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = str(message)
        self.details = dict(details or {})

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class WorkbookValidationError(JournalEntryError):
    """The workbook cannot be opened, is not .xlsx, or lacks a sheet."""

    code = "WORKBOOK_VALIDATION_ERROR"


class ColumnMappingError(JournalEntryError):
    """Required canonical fields cannot be mapped without guessing."""

    code = "COLUMN_MAPPING_ERROR"


class NormalizationError(JournalEntryError):
    """A cell value or row cannot be normalized safely."""

    code = "NORMALIZATION_ERROR"


class ContraComplexityError(JournalEntryError):
    """The contra search exceeds an explicit complexity guard."""

    code = "CONTRA_COMPLEXITY_ERROR"

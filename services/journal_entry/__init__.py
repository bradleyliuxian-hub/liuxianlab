"""Journal Entry Analysis deterministic Python core.

Includes canonical journal normalization, XLS/XLSX ingestion, contra analysis,
anomaly screening, and deterministic voucher business classification. Core
modules perform no network calls, model downloads, or LLM inference.
"""

from .errors import (
    ColumnMappingError,
    ContraComplexityError,
    JournalEntryError,
    NormalizationError,
    WorkbookValidationError,
)
from .input_layouts import (
    AMOUNT_LAYOUTS,
    LAYOUT_DEBIT_CREDIT,
    LAYOUT_DIRECTION_AMOUNT,
    LAYOUT_SIGNED_AMOUNT,
    AmountLayoutSpec,
    is_excel_error_value,
    normalize_direction,
    normalize_positive_side,
)
from .mapping import ColumnMapping, FieldMapping, suggest_mapping
from .normalize import (
    NormalizationIssue,
    NormalizationResult,
    NormalizationWarning,
    parse_amount,
    parse_date,
    normalize_file,
    normalize_table,
)
from .reader import (
    HeaderCandidate,
    SheetBounds,
    SheetData,
    SheetInfo,
    SheetInspection,
    WorkbookReader,
    detect_header_candidates,
    detect_header_row,
)
from .schema import (
    AMOUNT_TOLERANCE,
    CREDIT,
    CURRENCY_PRECISION,
    DEBIT,
    JournalEntry,
    JournalLine,
    ZERO,
    amount_to_string,
    make_voucher_key,
    quantize_amount,
)

__all__ = [
    "AMOUNT_TOLERANCE",
    "CREDIT",
    "CURRENCY_PRECISION",
    "DEBIT",
    "ZERO",
    "JournalEntry",
    "JournalLine",
    "amount_to_string",
    "make_voucher_key",
    "quantize_amount",
    "ColumnMapping",
    "FieldMapping",
    "suggest_mapping",
    "AMOUNT_LAYOUTS",
    "LAYOUT_DEBIT_CREDIT",
    "LAYOUT_DIRECTION_AMOUNT",
    "LAYOUT_SIGNED_AMOUNT",
    "AmountLayoutSpec",
    "is_excel_error_value",
    "normalize_direction",
    "normalize_positive_side",
    "NormalizationIssue",
    "NormalizationResult",
    "NormalizationWarning",
    "parse_amount",
    "parse_date",
    "normalize_file",
    "normalize_table",
    "HeaderCandidate",
    "SheetBounds",
    "SheetData",
    "SheetInfo",
    "SheetInspection",
    "WorkbookReader",
    "detect_header_candidates",
    "detect_header_row",
    "JournalEntryError",
    "WorkbookValidationError",
    "ColumnMappingError",
    "NormalizationError",
    "ContraComplexityError",
]

# Phase 2.3 deterministic business classification.
from .business import (
    BUSINESS_CODES,
    BUSINESS_LABELS,
    DEFAULT_BUSINESS_CLASSIFICATION_CONFIG,
    BusinessClassificationConfig,
    BusinessClassificationEngine,
    BusinessCandidate,
    BusinessClassification,
    BusinessClassificationResult,
    classify_entry,
    classify_entries,
    extract_business_features,
)

__all__ += [
    "BUSINESS_CODES",
    "BUSINESS_LABELS",
    "DEFAULT_BUSINESS_CLASSIFICATION_CONFIG",
    "BusinessClassificationConfig",
    "BusinessClassificationEngine",
    "BusinessCandidate",
    "BusinessClassification",
    "BusinessClassificationResult",
    "classify_entry",
    "classify_entries",
    "extract_business_features",
]

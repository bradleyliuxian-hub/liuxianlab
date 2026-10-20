"""Voucher-level feature extraction from canonical JournalEntry objects."""

from __future__ import annotations

import json
from collections import Counter
from decimal import Decimal
from typing import Dict, Iterable, Mapping, Optional, Sequence, Tuple

from ..accounting_features import voucher_key_for_entry
from ..schema import ZERO, JournalEntry, quantize_amount
from .constants import CATEGORY_UNKNOWN
from .grouping import classify_account_category, classify_business_group
from .models import VoucherFeatures


def _sorted_unique(values: Iterable[str]) -> Tuple[str, ...]:
    return tuple(sorted(set(value for value in values if value)))


def _signature(values: Sequence[str]) -> str:
    return "|".join(sorted(values))


def _multiset_signature(lines: Sequence) -> str:
    counts = Counter(line.account_key for line in lines if line.account_key)
    parts = [
        "%sx%d" % (account, count)
        for account, count in sorted(counts.items())
    ]
    return "|".join(parts)


def _account_category_pairs(
    entry: JournalEntry,
) -> Tuple[Tuple[str, str], ...]:
    accounts = {}
    for line in entry.lines:
        if line.account_key and line.account_key not in accounts:
            accounts[line.account_key] = (line.account_code, line.account_name)

    matches = []
    for account, (code, name) in sorted(accounts.items()):
        match = classify_account_category(code, name)
        matches.append((account, match.category))
    return tuple(matches)


def extract_features(
    entry: JournalEntry,
    contra_result: Optional[object] = None,
) -> VoucherFeatures:
    """Extract all deterministic V1 features for one voucher."""

    debit_accounts = _sorted_unique(
        line.account_key for line in entry.lines if line.debit != ZERO
    )
    credit_accounts = _sorted_unique(
        line.account_key for line in entry.lines if line.credit != ZERO
    )
    all_accounts = _sorted_unique(debit_accounts + credit_accounts)

    account_categories = _account_category_pairs(entry)
    category_set = tuple(
        sorted({category for _, category in account_categories})
    )
    unknown_count = sum(
        1 for _, category in account_categories if category == CATEGORY_UNKNOWN
    )
    unknown_ratio = (
        Decimal(unknown_count) / Decimal(len(account_categories))
        if account_categories
        else Decimal("0")
    )

    debit_set = set(debit_accounts)
    credit_set = set(credit_accounts)
    debit_categories = tuple(
        sorted(
            {
                category
                for account, category in account_categories
                if account in debit_set
            }
        )
    )
    credit_categories = tuple(
        sorted(
            {
                category
                for account, category in account_categories
                if account in credit_set
            }
        )
    )
    group_result = classify_business_group(
        debit_categories,
        credit_categories,
    )

    gross_amount = quantize_amount(
        max(abs(entry.total_debit), abs(entry.total_credit)),
        "gross_amount",
    )

    contra_ambiguous = None
    contra_unallocated = None
    contra_solution_count = None
    contra_complexity_limited = None
    contra_warnings = ()
    if contra_result is not None:
        contra_ambiguous = bool(getattr(contra_result, "ambiguous", False))
        contra_solution_count = int(
            getattr(contra_result, "solution_count", 0) or 0
        )
        contra_complexity_limited = bool(
            getattr(contra_result, "complexity_limited", False)
        )
        contra_warnings = tuple(
            sorted(getattr(contra_result, "warnings", ()) or ())
        )
        contra_unallocated = quantize_amount(
            sum(
                (
                    item.amount
                    for item in (
                        tuple(getattr(contra_result, "unallocated_debit", ()) or ())
                        + tuple(getattr(contra_result, "unallocated_credit", ()) or ())
                    )
                ),
                ZERO,
            ),
            "contra_unallocated",
        )

    return VoucherFeatures(
        voucher_key=voucher_key_for_entry(entry),
        voucher_id=entry.voucher_id,
        date=entry.date,
        period=entry.period,
        entity=entry.entity,
        total_debit=entry.total_debit,
        total_credit=entry.total_credit,
        gross_amount=gross_amount,
        line_count=len(entry.lines),
        account_count=len(all_accounts),
        debit_accounts=debit_accounts,
        credit_accounts=credit_accounts,
        all_accounts=all_accounts,
        account_signature=_signature(all_accounts),
        directional_signature=(
            "D:%s|C:%s"
            % (
                _signature(debit_accounts),
                _signature(credit_accounts),
            )
        ),
        account_multiset_signature=_multiset_signature(entry.lines),
        description=entry.description,
        preparer=entry.preparer,
        has_negative_lines=any(
            line.debit < ZERO or line.credit < ZERO for line in entry.lines
        ),
        has_mixed_side_lines=any(
            line.debit != ZERO and line.credit != ZERO for line in entry.lines
        ),
        is_balanced=entry.exactly_balanced,
        is_within_tolerance=entry.is_within_tolerance,
        validation_flags=entry.validation_flags,
        business_group=group_result.group,
        account_categories=account_categories,
        category_set=category_set,
        unknown_account_count=unknown_count,
        unknown_account_ratio=unknown_ratio.quantize(Decimal("0.000001")),
        contra_ambiguous=contra_ambiguous,
        contra_unallocated=contra_unallocated,
        contra_solution_count=contra_solution_count,
        contra_complexity_limited=contra_complexity_limited,
        contra_warnings=contra_warnings,
        sheet_names=tuple(sorted({line.sheet_name for line in entry.lines})),
        source_rows=tuple(sorted({line.source_row for line in entry.lines})),
    )


def extract_all_features(
    entries: Sequence[JournalEntry],
    contra_results: Optional[Mapping[str, object]] = None,
) -> Tuple[VoucherFeatures, ...]:
    contra_results = contra_results or {}
    features = []
    for entry in entries:
        key = voucher_key_for_entry(entry)
        features.append(
            extract_features(entry, contra_result=contra_results.get(key))
        )
    return tuple(features)


def features_to_json(features: VoucherFeatures) -> Dict[str, object]:
    """Convenience for tests/debugging; not used by the scoring hot path."""

    return json.loads(json.dumps(features.to_dict(), ensure_ascii=False))

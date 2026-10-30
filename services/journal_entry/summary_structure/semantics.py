"""Column-level semantic scoring for summary parts."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Iterable, Sequence, Tuple

from .models import SemanticType
from .tokenizer import PLACEHOLDERS

DATE_FORMATS = ("%Y.%m.%d", "%Y-%m-%d", "%Y/%m/%d")
DEPARTMENT_MARKERS = ("事业部", "研发部", "业务组", "部门", "总裁办", "本部")
ORG_MARKERS = ("有限公司", "股份有限公司", "集团", "银行", "科技", "传媒", "广告", "网络")
PERSON_CONTEXT_MARKERS = ("员工", "个人", "备用金", "垫付", "报销")
PERSON_PATTERN = re.compile(r"^[\u4e00-\u9fff]{2,4}$")
REFERENCE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/#-]{0,30}$")


def parse_date_candidate(value: str) -> date | None:
    text = str(value or "").strip()
    if not text or text in PLACEHOLDERS:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def score_date(value: str) -> float:
    return 1.0 if parse_date_candidate(value) else 0.0


def score_department(value: str) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    if any(marker in text for marker in DEPARTMENT_MARKERS):
        return 0.96
    if text.endswith(("部", "办", "组")):
        return 0.86
    if re.search(r"[\u4e00-\u9fff]{2,10}(部|办|组|中心|科)", text):
        return 0.86
    return 0.0


def normalize_entity_name(value: str) -> str:
    return str(value or "").strip().replace(" ", "")


def score_organization(value: str, known: set[str]) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    normalized = normalize_entity_name(text)
    if normalized and normalized in known:
        return 1.0
    if any(text.endswith(suffix) for suffix in ("手续费", "费用", "收入", "支出", "利息", "费")):
        return 0.0
    if len(text) >= 4 and any(marker in text for marker in ORG_MARKERS):
        return 0.86
    return 0.0


def score_person(value: str, account_name: str) -> float:
    text = str(value or "").strip()
    if not PERSON_PATTERN.fullmatch(text):
        return 0.0
    bonus = 0.50 if any(marker in account_name for marker in PERSON_CONTEXT_MARKERS) else 0.0
    return min(0.40 + bonus, 0.95)


def score_reference(value: str) -> float:
    text = str(value or "").strip()
    if not text or parse_date_candidate(text):
        return 0.0
    if REFERENCE_PATTERN.fullmatch(text) and any(ch.isdigit() for ch in text):
        return 0.72
    return 0.0


def infer_part_semantic(
    values: Sequence[str],
    *,
    account_name: str,
    known_counterparties: set[str],
    part_index: int,
) -> Tuple[SemanticType, float, dict]:
    explicit = [str(value or "").strip() for value in values]
    non_empty = [value for value in explicit if value not in PLACEHOLDERS]
    if not non_empty:
        return SemanticType.PLACEHOLDER, 1.0, {}

    def average(scores):
        return sum(scores) / len(scores) if scores else 0.0

    date_score = average([score_date(value) for value in non_empty])
    dept_score = average([score_department(value) for value in non_empty])
    org_score = average([score_organization(value, known_counterparties) for value in non_empty])
    person_scores = [score_person(value, account_name) for value in non_empty]
    person_score = average(person_scores)
    reference_score = average([score_reference(value) for value in non_empty])
    unique_ratio = len(set(non_empty)) / len(non_empty)

    if person_score:
        person_score *= 0.4 + min(0.6, unique_ratio)
    if part_index == 0 and person_score >= 0.55 and unique_ratio < 0.85:
        person_score *= 0.25
    if dept_score and unique_ratio < 0.2:
        dept_score *= 0.5

    candidates = {
        SemanticType.DATE: date_score,
        SemanticType.PERSON: person_score,
        SemanticType.DEPARTMENT: dept_score,
        SemanticType.ORGANIZATION: org_score,
        SemanticType.REFERENCE: reference_score,
    }
    best_type, best_score = max(candidates.items(), key=lambda item: item[1])
    if best_score < 0.5:
        if part_index == 0:
            return SemanticType.ITEM, 0.90, candidates
        return SemanticType.REFERENCE, 0.80, candidates
    if best_type in (SemanticType.ORGANIZATION,):
        best_type = SemanticType.COUNTERPARTY
    return best_type, min(0.99, best_score), candidates


DEFAULT_LABELS = {
    SemanticType.ITEM: "事项",
    SemanticType.DATE: "日期",
    SemanticType.PERSON: "人员",
    SemanticType.DEPARTMENT: "部门/机构",
    SemanticType.ORGANIZATION: "往来单位",
    SemanticType.COUNTERPARTY: "往来单位",
    SemanticType.REFERENCE: "业务标识",
    SemanticType.PLACEHOLDER: "占位",
    SemanticType.UNKNOWN: "字段",
}


def contextual_label(semantic_type: SemanticType, account_name: str) -> str:
    name = str(account_name or "")
    if semantic_type == SemanticType.ITEM:
        if any(marker in name for marker in ("员工", "报销", "垫付", "备用金")):
            return "费用项目"
        if "银行" in name:
            return "交易事项"
        return "事项"
    if semantic_type == SemanticType.PERSON:
        return "员工姓名" if any(marker in name for marker in ("员工", "报销", "垫付")) else "人员"
    if semantic_type == SemanticType.DATE:
        return "交易日期" if "银行" in name else "日期"
    if semantic_type in (SemanticType.COUNTERPARTY, SemanticType.ORGANIZATION):
        if "保证金" in name:
            return "保证金对象"
        return "往来单位"
    if semantic_type == SemanticType.DEPARTMENT:
        return "部门/机构"
    return DEFAULT_LABELS.get(semantic_type, "字段")

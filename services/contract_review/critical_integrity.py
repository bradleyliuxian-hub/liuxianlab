"""
Critical Integrity Gate (Contract Digitization v1.1.1).

This is NOT the structural quality gate (quality_gate.py). The
structural gate answers "did parsing break badly?". This gate
answers a different question:

    "Can we trust the parts of the contract that matter, or is
     there a high-confidence reason a human must look?"

It is deterministic. It uses no AI, no OCR confidence, and never
auto-corrects contract text.

Field states:

    absent     label not present / no evidence the field exists
    blank      label present but the field was not filled in
    valid      label present and the value parses
    malformed  label present but the value cannot be parsed
    conflict   two independent sources parse but disagree

`blank` is NOT treated as an OCR error: an unfilled field never
triggers Standard and never becomes a mandatory review issue.

Reason codes (machine readable, no confidence numbers):

    contract_number_malformed
    contract_number_filename_conflict
    labeled_date_malformed
    labeled_date_filename_conflict
    amount_uppercase_mismatch
    amount_numeric_malformed
    amount_text_malformed
    cross_tier_critical_disagreement
    suspicious_ocr_pattern (disabled by default)
"""

import json
import re
import uuid
from pathlib import Path

from . import amount_utils
from .consistency_checker import (
    filename_date,
    parse_date_value,
)
from .issue_detector import (
    filename_identifiers,
    normalize_identifier,
)


PROFILE_VERSION = "v1.1.1"


# The generic mixed-script "suspicious OCR" hint produced false
# positives on real scanned contracts (e.g. address zone letters
# such as "1层A区"). Per v1.1.1 scope it is implemented but
# disabled by default. Critical-field checks are unaffected.
ENABLE_SUSPICIOUS_OCR_PATTERN = False


# ---------------------------------------------------------------------------
# Field states
# ---------------------------------------------------------------------------

STATE_ABSENT = "absent"
STATE_BLANK = "blank"
STATE_VALID = "valid"
STATE_MALFORMED = "malformed"
STATE_CONFLICT = "conflict"


# ---------------------------------------------------------------------------
# Reason codes
# ---------------------------------------------------------------------------

REASON_CONTRACT_MALFORMED = "contract_number_malformed"
REASON_CONTRACT_CONFLICT = "contract_number_filename_conflict"

REASON_DATE_MALFORMED = "labeled_date_malformed"
REASON_DATE_CONFLICT = "labeled_date_filename_conflict"

REASON_AMOUNT_MISMATCH = "amount_uppercase_mismatch"
REASON_AMOUNT_NUMERIC_MALFORMED = "amount_numeric_malformed"
REASON_AMOUNT_MALFORMED = "amount_text_malformed"

REASON_CROSS_TIER = "cross_tier_critical_disagreement"

REASON_SUSPICIOUS = "suspicious_ocr_pattern"


# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------

_CONTRACT_LABEL_RE = re.compile(r"合同编号")

_CONTRACT_TOKEN_RE = re.compile(
    r"^([A-Za-z0-9][A-Za-z0-9\-]{4,40})"
)

_DATE_LABEL_RE = re.compile(
    r"(?:合同签订日期|签订日期|签署日期|合同日期|"
    r"签订时间|签署时间|签订日|签署日)"
)

_DATE_STRICT_RE = re.compile(
    r"(20\d{2})\s*[年\-/.]\s*"
    r"(\d{1,2})\s*[月\-/.]\s*"
    r"(\d{1,2})\s*日?"
)

_UPPER_MARKER_RE = re.compile(
    r"(?:大写|写)\s*[:：]\s*"
    r"([^\n\r（）()]{1,80})"
)

_MIXED_SCRIPT_RE = re.compile(
    r"[\u4e00-\u9fff]([A-Za-z])[\u4e00-\u9fff]"
)

# Legitimate single-letter + CJK tokens (avoid false positives).
_MIXED_SCRIPT_ALLOWED = {
    ("T", "恤"),
    ("A", "股"),
    ("B", "超"),
    ("X", "光"),
    ("O", "型"),
    ("C", "盘"),
    ("K", "线"),
    ("A", "型"),
    ("B", "型"),
}

# Field labels that terminate a same-line value.
_FIELD_LABELS = (
    "统一社会信用代码",
    "合同编号",
    "合同签订日期",
    "签订日期",
    "签署日期",
    "合同日期",
    "签订时间",
    "签署时间",
    "甲方",
    "乙方",
    "丙方",
    "地址",
    "联系人",
    "联系电话",
    "电话",
    "开户行",
    "账号",
    "账号名称",
    "金额",
    "大写",
    "合作金额",
)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _finding(
    *,
    code,
    field,
    title,
    message,
    severity,
    requires_standard,
    requires_review,
    page=None,
    anchor_text=None,
    parsed_value=None,
    reference_value=None,
    locate_text=None,
):

    return {
        "code": code,
        "field": field,
        "severity": severity,
        "requiresStandard": bool(requires_standard),
        "requiresReview": bool(requires_review),
        "title": title,
        "message": message,
        "page": page,
        "anchorText": anchor_text,
        "parsedValue": parsed_value,
        "referenceValue": reference_value,
        "locateText": locate_text,
    }


def _read_text(path):

    if not path:
        return ""

    candidate = Path(path)

    if not candidate.is_file():
        return ""

    return candidate.read_text(
        encoding="utf-8",
        errors="replace",
    )


def _node_text(node):

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        return " ".join(
            part
            for part in (
                _node_text(item)
                for item in node
            )
            if part
        )

    if isinstance(node, dict):

        for key in ("content", "text", "value"):

            if key in node:

                value = _node_text(node[key])

                if value:
                    return value

    return ""


def _page_texts(middle_json_path):
    """
    Return a list of per-page text blobs (0-indexed) for
    best-effort page location of a critical finding.
    """

    if not middle_json_path:
        return []

    path = Path(middle_json_path)

    if not path.is_file():
        return []

    try:

        data = json.loads(
            path.read_text(
                encoding="utf-8"
            )
        )

    except (ValueError, OSError):

        return []

    pages = []

    for page in data.get("pages", []) or []:

        blocks = page.get("blocks", []) or []

        pages.append(
            " ".join(
                _node_text(block)
                for block in blocks
            )
        )

    return pages


def _page_for(page_texts, needles):

    for index, text in enumerate(page_texts):

        for needle in needles:

            if needle and needle in text:
                return index + 1

    return None


def _starts_with_field_label(value):

    return any(
        value.startswith(label)
        for label in _FIELD_LABELS
    )


def _same_line_value(text, match):
    """
    Value that follows a field label, restricted to the SAME line
    (plus leading colons/spaces). Never crosses into the next line
    or the next field label. Returns "" when the field is blank.
    """

    line_end = text.find("\n", match.end())

    if line_end == -1:
        line_end = len(text)

    remainder = text[match.end():line_end]

    remainder = remainder.lstrip(" \t:：").strip()

    if _starts_with_field_label(remainder):
        return ""

    return remainder


def _line_context(line):
    """
    Nearby label before the first colon, e.g. '尾款' for
    '尾款:¥540,000.00元（大写:...）'.
    """

    match = re.match(r"\s*([^:：]{1,24})[:：]", line)

    if match:
        return match.group(1).strip()

    return ""


def _looks_like_amount(value):

    return any(
        char
        in (
            set(amount_utils.DIGITS)
            | set(amount_utils.SMALL_UNITS)
            | set(amount_utils.BIG_UNITS)
            | set(amount_utils.CURRENCY_UNITS)
            | {amount_utils.JIAO, amount_utils.FEN}
        )
        for char in str(value or "")
    )


def _extract_upper_value(capture):
    """
    Trim a 大写 capture down to the amount-looking part.

    Cuts after the currency unit, then absorbs any trailing
    jiao/fen digits so 肆角伍分 is preserved, while trailing prose
    is dropped. An illegal unit char before 元 (e.g. 方) is kept so
    that parsing fails and the amount is reported as malformed.
    """

    capture = str(capture or "").strip()

    yuan_index = None

    for index, char in enumerate(capture):

        if char in amount_utils.CURRENCY_UNITS:
            yuan_index = index
            break

    if yuan_index is not None:

        end = yuan_index + 1

        while (
            end < len(capture)
            and (
                capture[end] in amount_utils.DIGITS
                or capture[end] in (
                    amount_utils.JIAO,
                    amount_utils.FEN,
                )
            )
        ):
            end += 1

        return capture[:end]

    allowed = (
        set(amount_utils.DIGITS)
        | set(amount_utils.SMALL_UNITS)
        | set(amount_utils.BIG_UNITS)
        | {amount_utils.JIAO, amount_utils.FEN}
    )

    end = 0

    for index, char in enumerate(capture):

        if char in allowed:
            end = index + 1
        else:
            break

    return capture[:end] if end else capture


def _empty_observation(reference=None):

    return {
        "status": STATE_ABSENT,
        "labelFound": False,
        "rawValue": None,
        "normalizedValue": None,
        "referenceSource": "filename" if reference else None,
        "referenceValue": reference,
        "reasons": [],
    }


# ---------------------------------------------------------------------------
# Contract number
# ---------------------------------------------------------------------------

def observe_contract_number(text, original_name):

    label_match = _CONTRACT_LABEL_RE.search(text)

    reference_values = filename_identifiers(
        original_name
    )

    reference = (
        normalize_identifier(reference_values[0])
        if reference_values
        else None
    )

    if not label_match:

        return _empty_observation(reference), []

    value = _same_line_value(text, label_match)

    if not value:

        observation = _empty_observation(reference)
        observation["status"] = STATE_BLANK
        observation["labelFound"] = True

        return observation, []

    token_match = _CONTRACT_TOKEN_RE.match(value)

    normalized = (
        normalize_identifier(token_match.group(1))
        if token_match
        else None
    )

    if normalized:

        status = STATE_VALID

        if reference and normalized != reference:

            status = STATE_CONFLICT

    else:

        status = STATE_MALFORMED

    reasons = []

    findings = []

    if status == STATE_MALFORMED:

        reasons.append(REASON_CONTRACT_MALFORMED)

        findings.append(
            _finding(
                code=REASON_CONTRACT_MALFORMED,
                field="contract_number",
                title="合同编号需要核对",
                message=(
                    "已识别到“合同编号”标签，但编号"
                    "无法可靠解析，可能被 OCR 识别损坏。"
                    "系统无法确认该编号是否正确。"
                ),
                severity="error",
                requires_standard=True,
                requires_review=True,
                anchor_text="合同编号",
                parsed_value=value[:40],
                reference_value=reference,
                locate_text=value[:40],
            )
        )

    elif status == STATE_CONFLICT:

        reasons.append(REASON_CONTRACT_CONFLICT)

        findings.append(
            _finding(
                code=REASON_CONTRACT_CONFLICT,
                field="contract_number",
                title="合同编号需要核对",
                message=(
                    "正文合同编号与文件名中的编号不一致。"
                    "两者都不是绝对事实，请对照原合同确认。"
                ),
                severity="error",
                requires_standard=True,
                requires_review=True,
                anchor_text="合同编号",
                parsed_value=normalized,
                reference_value=reference,
                locate_text=normalized,
            )
        )

    observation = {
        "status": status,
        "labelFound": True,
        "rawValue": value[:40],
        "normalizedValue": normalized,
        "referenceSource": "filename" if reference else None,
        "referenceValue": reference,
        "reasons": reasons,
    }

    return observation, findings


# ---------------------------------------------------------------------------
# Labeled date
# ---------------------------------------------------------------------------

def observe_labeled_date(text, original_name):

    label_match = _DATE_LABEL_RE.search(text)

    reference = filename_date(original_name)

    if not label_match:

        return _empty_observation(reference), []

    value = _same_line_value(text, label_match)

    if not value:

        observation = _empty_observation(reference)
        observation["status"] = STATE_BLANK
        observation["labelFound"] = True

        return observation, []

    date_match = _DATE_STRICT_RE.match(value)

    normalized = None

    if date_match:

        normalized = parse_date_value(
            *date_match.groups()
        )

    if normalized:

        status = STATE_VALID

        if reference and normalized != reference:

            status = STATE_CONFLICT

    else:

        status = STATE_MALFORMED

    reasons = []

    findings = []

    if status == STATE_MALFORMED:

        reasons.append(REASON_DATE_MALFORMED)

        findings.append(
            _finding(
                code=REASON_DATE_MALFORMED,
                field="labeled_date",
                title="合同日期需要核对",
                message=(
                    "已识别到合同日期标签，但日期无法"
                    "可靠解析，可能被 OCR 识别损坏。"
                    "系统无法确认该日期是否正确。"
                ),
                severity="error",
                requires_standard=True,
                requires_review=True,
                anchor_text=label_match.group(0),
                parsed_value=value[:20],
                reference_value=reference,
                locate_text=value[:20],
            )
        )

    elif status == STATE_CONFLICT:

        reasons.append(REASON_DATE_CONFLICT)

        findings.append(
            _finding(
                code=REASON_DATE_CONFLICT,
                field="labeled_date",
                title="合同日期需要核对",
                message=(
                    "正文合同日期与文件名中的日期不一致。"
                    "请对照原合同确认。"
                ),
                severity="error",
                requires_standard=True,
                requires_review=True,
                anchor_text=label_match.group(0),
                parsed_value=normalized,
                reference_value=reference,
                locate_text=normalized,
            )
        )

    observation = {
        "status": status,
        "labelFound": True,
        "rawValue": value[:20],
        "normalizedValue": normalized,
        "referenceSource": "filename" if reference else None,
        "referenceValue": reference,
        "reasons": reasons,
    }

    return observation, findings


# ---------------------------------------------------------------------------
# Amount pairs (digit vs Chinese uppercase)
# ---------------------------------------------------------------------------

def _nearest_amount(segment):
    """
    Return (kind, value) for the money token nearest the end of the
    segment, or (None, None). kind is "valid" or "malformed".
    """

    candidates = []

    for start, end, amount in amount_utils.find_money_amounts(
        segment
    ):
        candidates.append((end, "valid", amount))

    for start, end, raw in amount_utils.find_malformed_amounts(
        segment
    ):
        candidates.append((end, "malformed", raw))

    if not candidates:
        return (None, None)

    _, kind, value = max(candidates, key=lambda item: item[0])

    return (kind, value)


def _iter_amount_pairs(text):
    """
    Yield dicts describing each explicit 大写-bound amount pair.

    Only 大写/写 with an explicit colon is used, so the ambiguous
    "人民币（大写）960,000元整" table form is intentionally skipped.
    """

    index = 0

    for line in text.splitlines():

        markers = list(
            _UPPER_MARKER_RE.finditer(line)
        )

        previous_end = 0

        for marker in markers:

            segment = line[
                previous_end:
                marker.start()
            ]

            previous_end = marker.end()

            upper_capture = marker.group(1)

            upper_value_text = _extract_upper_value(
                upper_capture
            )

            if not _looks_like_amount(
                upper_value_text
            ):
                continue

            kind, value = _nearest_amount(segment)

            uppercase = amount_utils.parse_chinese_amount(
                upper_value_text
            )

            yield {
                "index": index,
                "context": _line_context(line),
                "kind": kind,
                "value": value,
                "uppercase": uppercase,
                "uppercaseText": upper_value_text,
                "anchor": marker.group(0).strip(),
            }

            index += 1


def observe_amounts(text, page_texts):

    observations = []

    findings = []

    for pair in _iter_amount_pairs(text):

        kind = pair["kind"]
        value = pair["value"]
        uppercase = pair["uppercase"]

        status = STATE_VALID

        if kind == "malformed":

            status = STATE_MALFORMED

        elif uppercase is None:

            status = STATE_MALFORMED

        elif kind != "valid" or value is None:

            status = STATE_ABSENT

        elif (
            amount_utils.normalize_amount(value)
            != amount_utils.normalize_amount(uppercase)
        ):

            status = STATE_CONFLICT

        arabic_value = (
            value
            if (kind == "valid" and value is not None)
            else None
        )

        observations.append(
            {
                "status": status,
                "context": pair["context"],
                "occurrenceIndex": pair["index"],
                "arabicValue": (
                    str(arabic_value)
                    if arabic_value is not None
                    else None
                ),
                "arabicRaw": (
                    str(value)
                    if kind == "malformed"
                    else None
                ),
                "uppercaseValue": (
                    str(uppercase)
                    if uppercase is not None
                    else None
                ),
                "uppercaseText": pair["uppercaseText"],
                "anchor": pair["anchor"],
            }
        )

        page = _page_for(
            page_texts,
            [pair["uppercaseText"]],
        )

        if kind == "malformed":

            findings.append(
                _finding(
                    code=REASON_AMOUNT_NUMERIC_MALFORMED,
                    field="amount",
                    title="金额需要核对",
                    message=(
                        "数字金额格式异常（可能存在多个"
                        "小数点或被 OCR 识别损坏），"
                        "请对照原合同确认金额。"
                    ),
                    severity="error",
                    requires_standard=True,
                    requires_review=True,
                    page=page,
                    anchor_text=pair["context"] or "金额",
                    parsed_value=None,
                    reference_value=pair["uppercaseText"],
                    locate_text=pair["uppercaseText"],
                )
            )

        elif status == STATE_MALFORMED:

            findings.append(
                _finding(
                    code=REASON_AMOUNT_MALFORMED,
                    field="amount",
                    title="金额需要核对",
                    message=(
                        "金额大写无法可靠解析（可能包含"
                        "非法单位或被 OCR 识别损坏）。"
                        "请对照原合同确认金额。"
                    ),
                    severity="error",
                    requires_standard=False,
                    requires_review=True,
                    page=page,
                    anchor_text=pair["context"] or "金额",
                    parsed_value=None,
                    reference_value=pair["uppercaseText"],
                    locate_text=pair["uppercaseText"],
                )
            )

        elif status == STATE_CONFLICT:

            findings.append(
                _finding(
                    code=REASON_AMOUNT_MISMATCH,
                    field="amount",
                    title="金额需要核对",
                    message=(
                        "数字金额与中文大写金额不一致。"
                        "请对照原合同确认。"
                    ),
                    severity="error",
                    requires_standard=True,
                    requires_review=True,
                    page=page,
                    anchor_text=pair["context"] or "金额",
                    parsed_value=str(arabic_value),
                    reference_value=pair["uppercaseText"],
                    locate_text=pair["uppercaseText"],
                )
            )

    return observations, findings


# ---------------------------------------------------------------------------
# Suspicious OCR pattern (review only, very conservative)
# ---------------------------------------------------------------------------

def detect_suspicious_patterns(text, page_texts):

    findings = []

    seen = set()

    for match in _MIXED_SCRIPT_RE.finditer(text):

        letter = match.group(1)

        following = text[match.end() - 1]

        if (letter, following) in _MIXED_SCRIPT_ALLOWED:
            continue

        fragment = text[
            max(0, match.start() - 1):
            match.end() + 1
        ]

        if fragment in seen:
            continue

        seen.add(fragment)

        page = _page_for(page_texts, [fragment])

        findings.append(
            _finding(
                code=REASON_SUSPICIOUS,
                field="text",
                title="疑似识别异常，建议核对",
                message=(
                    "正文中出现中英文混排的可疑片段，"
                    "可能是 OCR 误识别，建议人工核对。"
                ),
                severity="warning",
                requires_standard=False,
                requires_review=True,
                page=page,
                anchor_text=None,
                parsed_value=fragment,
                reference_value=None,
                locate_text=fragment,
            )
        )

    return findings


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def evaluate_critical_integrity(
    *,
    markdown_path,
    middle_json_path=None,
    original_name="",
    existing_fields=None,
):

    text = _read_text(markdown_path)

    page_texts = _page_texts(middle_json_path)

    contract_observation, contract_findings = (
        observe_contract_number(text, original_name)
    )

    date_observation, date_findings = (
        observe_labeled_date(text, original_name)
    )

    amount_observations, amount_findings = (
        observe_amounts(text, page_texts)
    )

    suspicious_findings = []

    if ENABLE_SUSPICIOUS_OCR_PATTERN:

        suspicious_findings = detect_suspicious_patterns(
            text,
            page_texts,
        )

    findings = (
        contract_findings
        + date_findings
        + amount_findings
        + suspicious_findings
    )

    if contract_findings:

        contract_page = _page_for(
            page_texts,
            [
                contract_observation.get("rawValue"),
                "合同编号",
            ],
        )

        for finding in contract_findings:
            finding["page"] = contract_page

    if date_findings:

        date_page = _page_for(
            page_texts,
            [
                date_observation.get("rawValue"),
                "签订日期",
                "签署日期",
            ],
        )

        for finding in date_findings:
            finding["page"] = date_page

    requires_standard = any(
        finding["requiresStandard"]
        for finding in findings
    )

    critical_count = sum(
        1
        for finding in findings
        if finding["severity"] == "error"
    )

    review_count = sum(
        1
        for finding in findings
        if finding["requiresReview"]
    )

    reason_codes = []

    for finding in findings:

        code = finding["code"]

        if code not in reason_codes:
            reason_codes.append(code)

    return {
        "profileVersion": PROFILE_VERSION,
        "passedForAuto": not requires_standard,
        "requiresStandard": requires_standard,
        "observations": {
            "contractNumber": contract_observation,
            "labeledDate": date_observation,
            "amounts": amount_observations,
        },
        "findings": findings,
        "metrics": {
            "findingCount": len(findings),
            "criticalCount": critical_count,
            "reviewCount": review_count,
            "reasonCodes": reason_codes,
        },
    }


def _valid_amount_map(result):
    """
    {occurrenceIndex: normalizedValue} for VALID amount pairs only.
    Occurrence order is stable for the same document, so Basic and
    Standard pairs are compared by position (occurrence-aware).
    """

    mapping = {}

    for observation in result["observations"].get(
        "amounts",
        [],
    ):

        if observation.get("status") != STATE_VALID:
            continue

        mapping[
            observation.get("occurrenceIndex")
        ] = observation.get("arabicValue")

    return mapping


def compare_critical_observations(
    basic_result,
    standard_result,
):
    """
    Return cross-tier critical disagreement findings.

    Only VALID-vs-VALID observations are compared. A Basic MALFORMED
    field that Standard VALIDates is a successful repair, not a
    disagreement. Full Markdown is never compared.
    """

    findings = []

    basic_obs = basic_result.get("observations", {})
    standard_obs = standard_result.get("observations", {})

    for key, field in (
        ("contractNumber", "contract_number"),
        ("labeledDate", "labeled_date"),
    ):

        b = basic_obs.get(key, {})
        s = standard_obs.get(key, {})

        if (
            b.get("status") != STATE_VALID
            or s.get("status") != STATE_VALID
        ):
            continue

        if b.get("normalizedValue") == s.get("normalizedValue"):
            continue

        findings.append(
            _finding(
                code=REASON_CROSS_TIER,
                field=field,
                title=(
                    "合同编号需要核对（两种解析不一致）"
                    if key == "contractNumber"
                    else "合同日期需要核对（两种解析不一致）"
                ),
                message=(
                    "同一关键字段在快速解析与高精度解析下"
                    "结果不一致，请对照原合同确认。"
                ),
                severity="error",
                requires_standard=False,
                requires_review=True,
                anchor_text=(
                    "合同编号"
                    if key == "contractNumber"
                    else "合同日期"
                ),
                parsed_value=b.get("normalizedValue"),
                reference_value=s.get("normalizedValue"),
                locate_text=b.get("normalizedValue"),
            )
        )

    basic_amounts = _valid_amount_map(basic_result)
    standard_amounts = _valid_amount_map(standard_result)

    for index, basic_value in basic_amounts.items():

        standard_value = standard_amounts.get(index)

        if standard_value is None:
            continue

        if basic_value == standard_value:
            continue

        findings.append(
            _finding(
                code=REASON_CROSS_TIER,
                field="amount",
                title="金额需要核对（两种解析不一致）",
                message=(
                    "同一金额在快速解析与高精度解析下结果"
                    "不一致，请对照原合同确认。"
                ),
                severity="error",
                requires_standard=False,
                requires_review=True,
                anchor_text="金额",
                parsed_value=basic_value,
                reference_value=standard_value,
                locate_text=None,
            )
        )

    return findings


def findings_to_review_issues(findings, *, kind="critical"):
    """
    Convert critical findings into review issues.

    Keeps the existing issue schema; only adds optional fields.
    Issues are never dropped just because they lack a bbox. Only a
    specific locateText is used for locating; a generic anchor is
    never used to guess a bbox.
    """

    issues = []

    for finding in findings:

        if not finding.get("requiresReview"):
            continue

        source_text = (
            finding.get("locateText")
            or ""
        )

        issues.append(
            {
                "id": str(uuid.uuid4()),
                "type": "critical_integrity",
                "category": finding.get("field"),
                "criticalKind": kind,
                "severity": finding.get("severity", "error"),
                "title": finding.get("title")
                or "关键字段需要核对",
                "message": finding.get("message") or "",
                "sourceText": source_text,
                "suggestedText": "",
                "page": finding.get("page"),
                "pageIdx": None,
                "bbox": None,
                "bboxMode": None,
                "locationConfidence": 0.0,
                "status": "open",
                "reasonCode": finding.get("code"),
                "anchorText": finding.get("anchorText"),
                "parsedValue": finding.get("parsedValue"),
                "referenceValue": finding.get("referenceValue"),
            }
        )

    return issues


def build_critical_review_issues(
    final_integrity,
    cross_tier_findings,
):
    """
    Build the review-issue list for the FINAL selected artifact.

    De-duplication rule: if a final critical finding already covers a
    field, a cross-tier disagreement for the same field is attached to
    that issue as supplemental evidence (crossTierDisagreement /
    evidenceCodes) instead of becoming a second card. A cross-tier
    finding with no final counterpart stays a standalone issue.
    """

    final_findings = final_integrity.get(
        "findings",
        [],
    )

    issues = findings_to_review_issues(
        final_findings,
        kind="critical",
    )

    covered_fields = {
        finding.get("field")
        for finding in final_findings
        if finding.get("requiresReview")
    }

    cross_issues = findings_to_review_issues(
        cross_tier_findings,
        kind="cross_tier",
    )

    for cross_issue in cross_issues:

        field = cross_issue.get("category")

        if field in covered_fields:

            for issue in issues:

                if issue.get("category") != field:
                    continue

                issue["crossTierDisagreement"] = True

                codes = issue.setdefault(
                    "evidenceCodes",
                    [],
                )

                for code in (
                    issue.get("reasonCode"),
                    REASON_CROSS_TIER,
                ):

                    if code and code not in codes:
                        codes.append(code)

            continue

        cross_issue["crossTierDisagreement"] = True
        cross_issue.setdefault(
            "evidenceCodes",
            [REASON_CROSS_TIER],
        )
        issues.append(cross_issue)

    return issues

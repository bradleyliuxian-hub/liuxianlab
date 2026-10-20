"""Text and percentage normalization shared by OCR, topology and exports."""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

PERCENT_RE = re.compile(r"(?<!\d)(\d+(?:\.\d+)?)\s*[%％]")
UI_NOISE = (
    "实际控制人", "控股股东", "股东信息", "主要人员", "对外投资",
    "股权穿透图", "企业图谱", "股权结构图", "持股比例", "受益所有人",
    "展开", "收起", "筛选", "查看全部", "查看更多", "搜索",
    "战略融资", "融资轮次", "中国香港", "国有企业",
)
CANCEL_WORDS = ("已注销", "注销", "吊销", "撤销")
STATUS_WORDS = CANCEL_WORDS + ("存续", "在业", "开业", "迁出")


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = (
        text.replace("％", "%")
        .replace("—", "-")
        .replace("－", "-")
        .replace("–", "-")
        .replace("\u3000", " ")
    )
    text = re.sub(r"\s+", "", text)
    return text.strip()


def normalize_display(value: object) -> str:
    """Normalize for on-screen/output text while preserving Latin word spaces."""
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = (
        text.replace("％", "%")
        .replace("—", "-")
        .replace("－", "-")
        .replace("–", "-")
        .replace("\u3000", " ")
    )
    text = re.sub(r"\s+", " ", text).strip()
    # Chinese company names should not keep artificial spaces between CJK
    # characters; spaces between Latin words are preserved.
    text = re.sub(r"([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", r"\1", text)
    return text


def normalize_percentage(value: object, allow_missing_sign: bool = False) -> str:
    """Return a canonical percentage such as ``30.4498%`` or an empty string."""
    text = normalize_text(value)
    if not text:
        return ""
    match = PERCENT_RE.search(text)
    if not match:
        if not allow_missing_sign:
            return ""
        match = re.search(r"\d+(?:\.\d+)?", text)
        if not match:
            return ""
    number = match.group(1) if match.lastindex else match.group(0)
    if not number or not re.fullmatch(r"\d+(?:\.\d+)?", number):
        return ""
    try:
        numeric = float(number)
    except ValueError:
        return ""
    if numeric < 0 or numeric > 100:
        return ""
    return f"{number}%"


def is_percentage(value: object) -> bool:
    return bool(normalize_percentage(value))


def percentage_number(value: object) -> Optional[float]:
    canonical = normalize_percentage(value)
    if not canonical:
        return None
    try:
        return float(canonical.rstrip("%"))
    except ValueError:
        return None


def is_ui_noise(value: object) -> bool:
    text = normalize_text(value)
    if not text:
        return True
    return any(word in text for word in UI_NOISE)


def contains_cancel_word(value: object) -> bool:
    text = normalize_text(value)
    return any(word in text for word in CANCEL_WORDS)


def strip_status_words(value: object) -> str:
    text = normalize_display(value)
    for word in STATUS_WORDS:
        text = text.replace(word, "")
    return text.strip("·-—|/ ")


def clean_name(value: object) -> str:
    """Remove percentages, UI labels and status words from an OCR name."""
    text = normalize_display(value)
    if not text:
        return ""
    text = PERCENT_RE.sub("", text)
    for word in UI_NOISE:
        text = text.replace(word, "")
    text = strip_status_words(text)
    text = re.sub(r"[（(\[【]\s*[）)\]】]", "", text)
    text = re.sub(r"^[·•\-—|/+√✓✔]+|[·•\-—|/+√✓✔]+$", "", text)
    text = normalize_display(text)
    # OCR from overlapping tiles sometimes repeats a suffix or a leading char.
    text = re.sub(r"([\u4e00-\u9fff]{4,14})\1$", r"\1", text)
    text = re.sub(r"([\u4e00-\u9fff])\)\1$", r"\1)", text)
    text = re.sub(r"^([\u4e00-\u9fff])\1", r"\1", text)
    if len(text) >= 2 and text[-1] == text[-2] and text[-1] in "司伙":
        text = text[:-1]
    return text.strip(" 　·•-—|/+√✓✔")


def entity_type_for(name: str, id_value: str = "", core_id: str = "") -> str:
    if id_value and id_value == core_id:
        return "company"
    text = normalize_text(name)
    if re.search(r"(有限公司|股份有限公司|有限责任公司|集团|合伙企业|基金|银行|信托|资管|BANK|PLC|LIMITED|LTD|AG|GMBH|CO\.)", text, re.I):
        return "fund" if re.search(r"(基金|信托|资管|合伙)", text) else "company"
    if 1 < len(text) <= 8 and not re.search(r"\d", text) and not re.search(r"(公司|集团|中心|银行|大学|医院)", text):
        return "person"
    return "other"

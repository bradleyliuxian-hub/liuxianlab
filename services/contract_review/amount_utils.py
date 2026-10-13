"""
Deterministic RMB amount parsing (Contract Digitization v1.1.1).

Used by critical_integrity.py to compare:
    digit amount        e.g. ¥48万元 / 480,000元
    Chinese uppercase   e.g. 肆拾捌万元整

No AI, no float, no OCR confidence. Decimal only.
Produces integer-yuan Decimals whenever the input is yuan-level.
"""

from decimal import Decimal
import re


# ---------------------------------------------------------------------------
# Chinese numeral tables (financial uppercase first, common simplified too)
# ---------------------------------------------------------------------------

DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "壹": 1,
    "二": 2,
    "贰": 2,
    "两": 2,
    "三": 3,
    "叁": 3,
    "四": 4,
    "肆": 4,
    "五": 5,
    "伍": 5,
    "六": 6,
    "陆": 6,
    "七": 7,
    "柒": 7,
    "八": 8,
    "捌": 8,
    "九": 9,
    "玖": 9,
}

SMALL_UNITS = {
    "十": 10,
    "拾": 10,
    "百": 100,
    "佰": 100,
    "千": 1000,
    "仟": 1000,
}

BIG_UNITS = {
    "万": 10000,
    "亿": 100000000,
}

CURRENCY_UNITS = ("元", "圆")

JIAO = "角"
FEN = "分"

NOISE = ("整", "正", "人民币", "大写")

_DIGIT_CHAR_CLASS = "".join(DIGITS)
_MINOR_DIGIT_RE = re.compile(
    r"([" + _DIGIT_CHAR_CLASS + r"])\s*角"
)
_MINOR_FEN_RE = re.compile(
    r"([" + _DIGIT_CHAR_CLASS + r"])\s*分"
)


def _chinese_integer(value):
    """
    Parse a Chinese integer numeral string into an int.

    Returns None if any unknown character is present.
    """

    if not value:
        return 0

    result = 0
    section = 0
    number = 0

    for char in value:

        if char in DIGITS:

            number = DIGITS[char]

        elif char in SMALL_UNITS:

            unit = SMALL_UNITS[char]

            if number == 0:
                number = 1

            section += number * unit
            number = 0

        elif char in BIG_UNITS:

            unit = BIG_UNITS[char]

            section += number

            if unit == 10000:
                result += section * 10000
            else:
                result = (
                    result + section
                ) * 100000000

            section = 0
            number = 0

        else:

            return None

    return result + section + number


def parse_chinese_amount(value):
    """
    Parse a Chinese uppercase amount into a Decimal yuan value.

    Examples:
        肆拾捌万元整   -> Decimal("480000")
        玖拾陆万元整   -> Decimal("960000")
        拾陆万元整     -> Decimal("160000")
        壹佰万元整     -> Decimal("1000000")
        人民币肆拾捌万元整 -> Decimal("480000")

    Returns None when the string is not a parseable amount
    (e.g. it contains a non-numeral such as 方).
    """

    if value is None:
        return None

    text = str(value)

    text = text.replace(" ", "")
    text = text.replace("\u3000", "")

    for noise in NOISE:
        text = text.replace(noise, "")

    if not text:
        return None

    yuan_index = None

    for index, char in enumerate(text):

        if char in CURRENCY_UNITS:

            yuan_index = index
            break

    if yuan_index is None:

        # Fraction-only amounts such as 伍角 / 伍分 have no 元.
        if JIAO in text or FEN in text:

            integer_text = ""
            fraction_text = text

        else:

            integer_text = text
            fraction_text = ""

    else:

        integer_text = text[:yuan_index]
        fraction_text = text[yuan_index + 1:]

    for char in integer_text:

        if (
            char not in DIGITS
            and char not in SMALL_UNITS
            and char not in BIG_UNITS
        ):

            return None

    integer_value = _chinese_integer(integer_text)

    if integer_value is None:
        return None

    jiao_value = 0
    fen_value = 0

    if fraction_text:

        for char in fraction_text:

            if (
                char not in DIGITS
                and char != JIAO
                and char != FEN
            ):

                return None

        jiao_match = _MINOR_DIGIT_RE.search(
            fraction_text
        )

        if jiao_match:
            jiao_value = DIGITS[jiao_match.group(1)]

        fen_match = _MINOR_FEN_RE.search(
            fraction_text
        )

        if fen_match:
            fen_value = DIGITS[fen_match.group(1)]

    amount = Decimal(integer_value)
    amount += Decimal(jiao_value) / Decimal(10)
    amount += Decimal(fen_value) / Decimal(100)

    return amount


# ---------------------------------------------------------------------------
# Arabic (digit) amounts
# ---------------------------------------------------------------------------

_MONEY_CANDIDATE_RE = re.compile(
    r"([¥￥]\s*)?"
    r"(?<![.\d])"
    r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?![.\d])"
    r"\s*(亿元|亿|万元|万|元|圆)?"
)

# Money-looking tokens whose numeric core is structurally invalid
# (e.g. two decimal separators from OCR: ¥626.400.00).
_MALFORMED_TOKEN_RE = re.compile(
    r"[¥￥]\s*(?P<cur>\d[\d.,]*\d)"
    r"|(?P<unit>\d[\d.,]*\d)\s*(?:亿元|亿|万元|万|元|圆)"
)

_SYMBOL_UNITS = ("亿元", "亿")
_TEN_THOUSAND_UNITS = ("万元", "万")
_YUAN_UNITS = ("元", "圆")


def _candidate_is_money(symbol, number, unit):
    """
    Reject bare integers that are almost certainly not money
    (page numbers, counts, years) to avoid accidental binding.
    """

    if symbol or unit:
        return True

    if "," in number:
        return True

    if "." in number:
        return True

    return False


def find_money_amounts(text):
    """
    Yield (start, end, Decimal) for every money-looking amount in text.
    """

    if not text:
        return []

    results = []

    for match in _MONEY_CANDIDATE_RE.finditer(
        str(text)
    ):

        symbol = match.group(1)
        number = match.group(2)
        unit = match.group(3)

        if not _candidate_is_money(
            symbol,
            number,
            unit,
        ):
            continue

        amount = Decimal(
            number.replace(",", "")
        )

        if unit in _SYMBOL_UNITS:
            amount *= Decimal(100000000)
        elif unit in _TEN_THOUSAND_UNITS:
            amount *= Decimal(10000)

        results.append(
            (
                match.start(),
                match.end(),
                amount,
            )
        )

    return results


def parse_arabic_amount(text):
    """
    Return the last money amount in text, or None.
    """

    amounts = find_money_amounts(text)

    if not amounts:
        return None

    return amounts[-1][2]


def find_malformed_amounts(text):
    """
    Return (start, end, raw) for money-looking tokens whose numeric
    core is structurally invalid, e.g. more than one decimal
    separator (¥626.400.00). Used to reject bad OCR numbers instead
    of salvaging a trailing fragment.
    """

    if not text:
        return []

    results = []

    for match in _MALFORMED_TOKEN_RE.finditer(str(text)):

        core = match.group("cur") or match.group("unit")

        if not core:
            continue

        if core.count(".") >= 2:

            results.append(
                (
                    match.start(),
                    match.end(),
                    match.group(0).strip(),
                )
            )

    return results


def last_amount_before(text, position):
    """
    Return the Decimal of the last money amount that ends at or
    before `position`, or None. Used to bind a 大写 value to the
    digit amount that precedes it.
    """

    candidate = None

    for start, end, amount in find_money_amounts(text):

        if end <= position:
            candidate = amount
        else:
            break

    return candidate


def normalize_amount(amount):
    """
    Normalize to an integer-yuan Decimal when the value is whole.
    """

    if amount is None:
        return None

    if amount == amount.to_integral_value():
        return amount.to_integral_value()

    return amount

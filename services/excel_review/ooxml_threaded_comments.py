"""Parse Microsoft 365 threaded comments directly from OOXML.

Threaded comments are NOT exposed by openpyxl. They live in
``xl/threadedComments/threadedCommentN.xml`` and reference a person from
``xl/persons/personN.xml``. The worksheet -> threadedComments link is a
relationship declared in ``xl/worksheets/_rels/sheetN.xml.rels`` with the
type ``.../2017/10/relationships/threadedComment``. We resolve that link
dynamically per the OOXML specification; we never assume file numbering.
"""

from xml.etree import ElementTree as ET

from .ooxml_package import (
    REL_THREADED_COMMENT,
    OoxmlPackage,
    part_for_relationship,
    workbook_sheets,
)

THREADED_NS = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_PERSON = "http://schemas.microsoft.com/office/2017/10/relationships/person"

COMMENT_TYPE_THREADED = "threaded"
COMMENT_TYPE_THREADED_REPLY = "threaded_reply"


def _element_text(element):
    """Concatenate all <t> descendant text (best-effort visible text)."""
    parts = []
    for node in element.iter("{%s}t" % MAIN_NS):
        if node.text:
            parts.append(node.text)
    if parts:
        return "".join(parts)
    # Fallback: the text element may be in the threaded namespace.
    for node in element.iter("{%s}text" % THREADED_NS):
        return node.text or ""
    return ""


_TRUE_TOKENS = frozenset({"1", "true", "yes", "on"})
_FALSE_TOKENS = frozenset({"0", "false", "no", "off", ""})


def parse_done(raw):
    """Parse the OOXML threadedComment ``done`` attribute.

    Excel writes ``done="1"`` for a resolved/closed conversation and omits
    the attribute otherwise. Accept 1/true/yes/on (any case) as True;
    0/false/no/off/missing/unknown as False. Returns (resolved, raw).
    """
    if raw is None:
        return False, ""
    text = str(raw).strip()
    lowered = text.lower()
    if lowered in _TRUE_TOKENS:
        return True, text
    if lowered in _FALSE_TOKENS:
        return False, text
    return False, text


def _parse_persons(package):
    """Return {person_id: display_name} from the workbook person part."""
    person_part = part_for_relationship(package, "xl/workbook.xml", REL_PERSON)
    persons = {}
    if not person_part or not package.exists(person_part):
        return persons
    try:
        root = ET.fromstring(package.read_text(person_part))
    except ET.ParseError:
        return persons
    for person in root.iter("{%s}person" % THREADED_NS):
        person_id = person.get("id")
        if person_id:
            persons[person_id] = person.get("displayName") or ""
    return persons


def _parse_threaded_part(package, part, persons, sheet_name, sheet_index):
    items = []
    try:
        root = ET.fromstring(package.read_text(part))
    except ET.ParseError:
        return items

    for position, node in enumerate(root.iter("{%s}threadedComment" % THREADED_NS)):
        thread_id = node.get("id")
        parent_id = node.get("parentId")
        is_reply = bool(parent_id)
        person_id = node.get("personId")
        author = persons.get(person_id, "") if person_id else ""
        resolved, done_raw = parse_done(node.get("done"))
        items.append(
            {
                "sheetName": sheet_name,
                "sheetIndex": sheet_index,
                "orderInPart": position,
                "cellAddress": node.get("ref") or "",
                "commentText": _element_text(node),
                "author": author,
                "personId": person_id or "",
                "commentDatetime": node.get("dT") or "",
                "threadId": thread_id or "",
                "parentThreadId": parent_id or "",
                "resolved": resolved,
                "doneRaw": done_raw,
                "isReply": is_reply,
                "commentType": COMMENT_TYPE_THREADED_REPLY
                if is_reply
                else COMMENT_TYPE_THREADED,
                "part": part,
            }
        )
    return items


def extract_threaded_comments(source_path):
    """Return every threaded comment node across all worksheets.

    Each element is one row: roots have an empty ``parentThreadId`` and
    replies reference their parent's thread id.
    """
    items = []
    with OoxmlPackage(source_path) as package:
        persons = _parse_persons(package)
        for sheet_index, sheet in enumerate(workbook_sheets(package)):
            threaded_part = part_for_relationship(
                package, sheet["part"], REL_THREADED_COMMENT
            )
            if not threaded_part or not package.exists(threaded_part):
                continue
            items.extend(
                _parse_threaded_part(
                    package, threaded_part, persons, sheet["name"], sheet_index
                )
            )
    return items


def has_threaded_comments(source_path):
    """True if the workbook contains any Microsoft 365 threaded comments."""
    with OoxmlPackage(source_path) as package:
        for sheet in workbook_sheets(package):
            if part_for_relationship(package, sheet["part"], REL_THREADED_COMMENT):
                return True
    return False

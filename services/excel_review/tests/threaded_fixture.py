"""Build synthetic .xlsx fixtures with Microsoft 365 threaded comments.

openpyxl cannot *write* threaded comments, so we build a normal workbook
and then inject the real OOXML parts (threadedComments + persons +
relationships + content types) exactly as Microsoft Excel lays them out.
This lets tests cover reply chains without shipping many binary files.
"""

import re
import uuid
from xml.sax.saxutils import escape

from openpyxl import Workbook

from services.excel_review.ooxml_package import (
    CONTENT_TYPE_PERSON,
    CONTENT_TYPE_THREADED_COMMENT,
    OoxmlPackage,
    rels_part_for,
    workbook_sheets,
    write_patched_package,
)

THREADED_REL = "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment"
PERSON_REL = "http://schemas.microsoft.com/office/2017/10/relationships/person"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

THREADED_PART = "xl/threadedComments/threadedComment1.xml"
PERSON_PART = "xl/persons/person.xml"


def build_base_workbook(sheets, legacy_comments=None):
    """sheets: list of (name, {cell: value}, {"state": "hidden"|...})."""
    workbook = Workbook()
    default = workbook.active
    first = True
    for spec in sheets:
        name = spec[0]
        values = spec[1] if len(spec) > 1 else {}
        options = spec[2] if len(spec) > 2 else {}
        if first:
            sheet = default
            sheet.title = name
            first = False
        else:
            sheet = workbook.create_sheet(name)
        for cell, value in values.items():
            sheet[cell] = value
        if options.get("state"):
            sheet.sheet_state = options["state"]
    return workbook


def _content_types_with_parts(data):
    text = data.decode("utf-8")
    additions = ""
    if "threadedcomments+xml" not in text:
        additions += (
            '<Override PartName="/%s" ContentType="%s"/>'
            % (THREADED_PART, CONTENT_TYPE_THREADED_COMMENT)
        )
    if "ms-excel.person+xml" not in text:
        additions += (
            '<Override PartName="/%s" ContentType="%s"/>' % (PERSON_PART, CONTENT_TYPE_PERSON)
        )
    text = text.replace("</Types>", additions + "</Types>")
    return text.encode("utf-8")


def _next_rid(text):
    used = re.findall(r'Id="rId(\d+)"', text)
    return "rId%d" % (max([int(x) for x in used] or [0]) + 1)


def _workbook_rels_with_person(data):
    text = data.decode("utf-8")
    if PERSON_REL in text:
        return data
    rid = _next_rid(text)
    rel = '<Relationship Id="%s" Type="%s" Target="persons/person.xml"/>' % (rid, PERSON_REL)
    return text.replace("</Relationships>", rel + "</Relationships>").encode("utf-8")


def _sheet_rels_with_threaded(existing_bytes, threaded_part):
    rel = (
        '<Relationship Id="rId9" Type="%s" Target="../threadedComments/%s"/>'
        % (THREADED_REL, threaded_part.split("/")[-1])
    )
    if existing_bytes is None:
        text = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="%s">%s</Relationships>' % (PKG_REL_NS, rel)
        )
    else:
        text = existing_bytes.decode("utf-8")
        if THREADED_REL in text:
            return existing_bytes
        text = text.replace("</Relationships>", rel + "</Relationships>")
    return text.encode("utf-8")


def _threaded_xml(threads):
    nodes = []
    for thread in threads:
        attrs = 'ref="%s" dT="%s" personId="%s" id="%s"' % (
            thread["ref"],
            thread["dT"],
            thread["personId"],
            thread["id"],
        )
        if thread.get("parentId"):
            attrs += ' parentId="%s"' % thread["parentId"]
        if thread.get("done") is not None:
            attrs += ' done="%s"' % thread["done"]
        nodes.append(
            "<threadedComment %s><text>%s</text></threadedComment>"
            % (attrs, escape(thread.get("text", "")))
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"'
        ' xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(nodes)
        + "</ThreadedComments>"
    ).encode("utf-8")


def _persons_xml(persons):
    nodes = []
    for person in persons:
        nodes.append(
            '<person displayName="%s" id="%s" userId="S::%s::00000000-0000-0000-0000-000000000000" providerId="AD"/>'
            % (
                escape(person["displayName"]),
                person["id"],
                escape(person.get("email", "person@example.com")),
            )
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"'
        ' xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "".join(nodes)
        + "</personList>"
    ).encode("utf-8")


def inject_threaded_comments(path, sheet_name, threads, persons):
    """Inject threaded comments into a workbook for a given sheet."""
    with OoxmlPackage(path) as package:
        target_part = None
        for sheet in workbook_sheets(package):
            if sheet["name"] == sheet_name:
                target_part = sheet["part"]
                break
        if target_part is None:
            raise ValueError("sheet not found: %s" % sheet_name)
        sheet_rels_part = rels_part_for(target_part)
        sheet_rels = package.read(sheet_rels_part) if package.exists(sheet_rels_part) else None
        content_types = package.read("[Content_Types].xml")
        workbook_rels = package.read("xl/_rels/workbook.xml.rels")

    replacements = {
        "[Content_Types].xml": _content_types_with_parts(content_types),
        "xl/_rels/workbook.xml.rels": _workbook_rels_with_person(workbook_rels),
        sheet_rels_part: _sheet_rels_with_threaded(sheet_rels, THREADED_PART),
        THREADED_PART: _threaded_xml(threads),
        PERSON_PART: _persons_xml(persons),
    }
    write_patched_package(path, path, replacements)


def new_guid():
    return "{%s}" % str(uuid.uuid4()).upper()

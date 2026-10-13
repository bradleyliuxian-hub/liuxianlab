"""Low-level OPC (.xlsx ZIP) helpers for the Excel Review Assistant.

openpyxl cannot round-trip Microsoft 365 threaded comments: loading and
saving a workbook deletes ``xl/threadedComments/*`` and ``xl/persons/*``.
This module lets the Excel Review worker inspect and patch an ``.xlsx``
package at the ZIP / OOXML part level so threaded comments survive.

Only the parts that must change are rewritten; every other part is copied
through unchanged (content-preserving).
"""

import os
import posixpath
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

# Relationship namespaces / types we care about.
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

REL_WORKSHEET = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
REL_COMMENTS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
REL_THREADED_COMMENT = (
    "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment"
)
REL_PERSON = "http://schemas.microsoft.com/office/2017/10/relationships/person"

CONTENT_TYPE_THREADED_COMMENT = "application/vnd.ms-excel.threadedcomments+xml"
CONTENT_TYPE_PERSON = "application/vnd.ms-excel.person+xml"


def normalize_part(base_part, target):
    """Resolve a relationship Target against the part that declares it.

    Handles both relative targets (``worksheets/sheet1.xml``) and
    package-absolute targets (``/xl/worksheets/sheet1.xml``).
    """
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    base_dir = posixpath.dirname(base_part)
    return posixpath.normpath(posixpath.join(base_dir, target))


def rels_part_for(part_name):
    """`xl/worksheets/sheet2.xml` -> `xl/worksheets/_rels/sheet2.xml.rels`."""
    directory = posixpath.dirname(part_name)
    basename = posixpath.basename(part_name)
    return posixpath.join(directory, "_rels", basename + ".rels")


class OoxmlPackage(object):
    """Read-only view over an .xlsx package."""

    def __init__(self, path):
        self.path = Path(path)
        self._zip = zipfile.ZipFile(str(path))
        self.names = list(self._zip.namelist())

    def exists(self, name):
        return name in self._zip.namelist()

    def read(self, name):
        return self._zip.read(name)

    def read_text(self, name):
        return self._zip.read(name).decode("utf-8")

    def close(self):
        self._zip.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def parse_relationships(data):
    """Return a list of relationship dicts: id, type, target, mode."""
    root = ET.fromstring(data)
    relationships = []
    for element in root.findall("{%s}Relationship" % PKG_REL_NS):
        relationships.append(
            {
                "id": element.get("Id"),
                "type": element.get("Type"),
                "target": element.get("Target"),
                "mode": element.get("TargetMode") or "Internal",
            }
        )
    return relationships


def workbook_sheets(package):
    """Return [(name, state, sheet_part)] in workbook order using rels."""
    workbook = ET.fromstring(package.read_text("xl/workbook.xml"))
    rels = parse_relationships(package.read_text("xl/_rels/workbook.xml.rels"))
    by_id = {rel["id"]: rel for rel in rels}

    sheets = []
    sheets_element = workbook.find("{%s}sheets" % MAIN_NS)
    if sheets_element is None:
        return sheets
    for sheet in sheets_element.findall("{%s}sheet" % MAIN_NS):
        rid = sheet.get("{%s}id" % OFFICE_REL_NS)
        rel = by_id.get(rid)
        if not rel:
            continue
        part = normalize_part("xl/workbook.xml", rel["target"])
        sheets.append(
            {
                "name": sheet.get("name"),
                "state": sheet.get("state") or "visible",
                "part": part,
            }
        )
    return sheets


def rels_of(package, part):
    """Return parsed relationships for a part (empty list if none)."""
    rels_name = rels_part_for(part)
    if not package.exists(rels_name):
        return []
    return parse_relationships(package.read(rels_name))


def part_for_relationship(package, base_part, rel_type):
    """Resolve the first relationship of a type declared by a part."""
    for rel in rels_of(package, base_part):
        if rel["type"] == rel_type and rel["mode"] == "Internal":
            return normalize_part(base_part, rel["target"])
    return None


def has_threaded_comments(package):
    """True if the package advertises or references threaded comments."""
    if any("threadedComments/" in name for name in package.names):
        return True
    for sheet in workbook_sheets(package):
        if part_for_relationship(package, sheet["part"], REL_THREADED_COMMENT):
            return True
    return False


def write_patched_package(src_path, dst_path, replacements):
    """Copy a package, replacing only the given parts.

    ``replacements`` maps part name -> new bytes. Every other part is
    written through unchanged. Supports in-place patching (src == dst) by
    staging to a temporary file first.
    """
    same_file = os.path.abspath(str(src_path)) == os.path.abspath(str(dst_path))
    target = str(dst_path)
    tmp_path = None
    if same_file:
        directory = os.path.dirname(os.path.abspath(str(dst_path))) or "."
        handle, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp.xlsx")
        os.close(handle)
        target = tmp_path

    try:
        written = set()
        with zipfile.ZipFile(str(src_path)) as src, zipfile.ZipFile(
            target, "w"
        ) as dst:
            for info in src.infolist():
                data = replacements.get(info.filename)
                if data is None:
                    data = src.read(info.filename)
                dst.writestr(info, data)
                written.add(info.filename)
            # Add any replacement parts that do not already exist in source.
            for name, data in replacements.items():
                if name not in written:
                    dst.writestr(name, data)
        if same_file:
            os.replace(tmp_path, str(dst_path))
    finally:
        if same_file and tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

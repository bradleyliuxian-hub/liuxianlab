"""Typed result schema for equity-structure recognition.

The HTTP layer stores JSON, but every producer/consumer inside Python uses these
dataclasses so fields cannot drift silently. Manual edits from the browser are
validated through :func:`validate_result` before export or re-render.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Optional


class SchemaError(ValueError):
    """Raised when a result payload is not a valid equity structure."""


ENTITY_TYPES = {"company", "person", "fund", "institution", "other"}
NODE_STATUSES = {"active", "excluded_cancelled", "unknown"}
RELATIONS = {"shareholder_to_core", "investment", "subsidiary"}
PERCENTAGE_SOURCES = {"secondary_crop_ocr", "global_ocr", "manual", "missing", ""}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))


@dataclass
class BBox:
    x1: float
    y1: float
    x2: float
    y2: float

    @classmethod
    def from_value(cls, value: Any) -> Optional["BBox"]:
        if not isinstance(value, (list, tuple)) or len(value) != 4:
            return None
        try:
            return cls(*(float(item) for item in value))
        except (TypeError, ValueError):
            return None

    def to_list(self) -> List[float]:
        return [self.x1, self.y1, self.x2, self.y2]


@dataclass
class Node:
    id: str
    name: str
    entity_type: str = "other"
    level: int = 1
    status: str = "active"
    confidence: float = 0.0
    bbox: Optional[BBox] = None
    ocr_confidence: Optional[float] = None

    @classmethod
    def from_dict(cls, payload: Dict[str, Any], index: int) -> "Node":
        if not isinstance(payload, dict):
            raise SchemaError(f"nodes[{index}] 不是对象。")
        node_id = _text(payload.get("id")) or f"n{index + 1}"
        name = _text(payload.get("name"))
        if not name:
            raise SchemaError(f"nodes[{index}] 缺少 name。")
        entity_type = _text(payload.get("entity_type")) or "other"
        status = _text(payload.get("status")) or "active"
        if entity_type not in ENTITY_TYPES:
            entity_type = "other"
        if status not in NODE_STATUSES:
            status = "unknown"
        try:
            level = max(1, int(payload.get("level") or 1))
        except (TypeError, ValueError):
            level = 1
        return cls(
            id=node_id,
            name=name,
            entity_type=entity_type,
            level=level,
            status=status,
            confidence=_float(payload.get("confidence")),
            bbox=BBox.from_value(payload.get("bbox")),
            ocr_confidence=(
                _float(payload.get("ocr_confidence"))
                if payload.get("ocr_confidence") is not None else None
            ),
        )

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        if self.bbox is None:
            payload["bbox"] = None
        else:
            payload["bbox"] = self.bbox.to_list()
        return payload


@dataclass
class Edge:
    source: str
    target: str
    percentage: str = ""
    relation: str = "investment"
    confidence: float = 0.0
    percentage_source: str = "missing"
    topology_path_depth: Optional[int] = None
    client_id: str = ""

    @classmethod
    def from_dict(cls, payload: Dict[str, Any], index: int) -> "Edge":
        if not isinstance(payload, dict):
            raise SchemaError(f"edges[{index}] 不是对象。")
        source = _text(payload.get("source"))
        target = _text(payload.get("target"))
        if not source or not target:
            raise SchemaError(f"edges[{index}] 缺少 source/target。")
        relation = _text(payload.get("relation")) or "investment"
        if relation not in RELATIONS:
            relation = "investment"
        source_name = _text(payload.get("percentage_source")) or "missing"
        if source_name not in PERCENTAGE_SOURCES:
            source_name = "missing"
        depth = payload.get("topology_path_depth")
        try:
            depth = int(depth) if depth is not None else None
        except (TypeError, ValueError):
            depth = None
        return cls(
            source=source,
            target=target,
            percentage=_text(payload.get("percentage")),
            relation=relation,
            confidence=_float(payload.get("confidence")),
            percentage_source=source_name,
            topology_path_depth=depth,
            client_id=_text(payload.get("__id")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExcludedItem:
    name: str
    reason: str
    node_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DictionaryCorrection:
    original: str
    corrected: str
    similarity: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Quality:
    overall_confidence: float = 0.0
    low_confidence_items: List[str] = field(default_factory=list)
    review_notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Diagnostics:
    image_width: int = 0
    image_height: int = 0
    raw_size_bytes: int = 0
    tile_count: int = 0
    detected_node_boxes: int = 0
    detected_horizontal_lines: int = 0
    detected_vertical_lines: int = 0
    ocr_items_after_dedup: int = 0
    dictionary_size: int = 0
    dictionary_correction_count: int = 0
    engine: str = ""
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class StructureResult:
    title: str
    core_company: str
    all_visible_text: List[str]
    nodes: List[Node]
    edges: List[Edge]
    excluded: List[ExcludedItem]
    dictionary_corrections: List[DictionaryCorrection]
    warnings: List[str]
    quality: Quality
    diagnostics: Diagnostics

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "core_company": self.core_company,
            "all_visible_text": self.all_visible_text,
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "excluded": [item.to_dict() for item in self.excluded],
            "dictionary_corrections": [item.to_dict() for item in self.dictionary_corrections],
            "warnings": self.warnings,
            "quality": self.quality.to_dict(),
            "diagnostics": self.diagnostics.to_dict(),
        }


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def validate_result(payload: Any) -> StructureResult:
    """Validate browser/worker JSON and return the typed model.

    Excluded nodes are kept in ``nodes`` for audit but any edge that references
    one is dropped, because the rendered chart must never show a cancelled
    company.
    """
    if not isinstance(payload, dict):
        raise SchemaError("结果必须是 JSON 对象。")

    raw_nodes = _as_list(payload.get("nodes"))
    nodes = [Node.from_dict(item, index) for index, item in enumerate(raw_nodes)]
    ids = [node.id for node in nodes]
    if len(set(ids)) != len(ids):
        raise SchemaError("节点 id 必须唯一。")
    by_id = {node.id: node for node in nodes}

    edges: List[Edge] = []
    dropped = 0
    for index, item in enumerate(_as_list(payload.get("edges"))):
        edge = Edge.from_dict(item, index)
        if edge.source not in by_id or edge.target not in by_id:
            raise SchemaError(f"edges[{index}] 引用了不存在的节点。")
        if by_id[edge.source].status == "excluded_cancelled" or by_id[edge.target].status == "excluded_cancelled":
            dropped += 1
            continue
        edges.append(edge)

    excluded: List[ExcludedItem] = []
    for item in _as_list(payload.get("excluded")):
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name"))
        if not name:
            continue
        excluded.append(ExcludedItem(
            name=name,
            reason=_text(item.get("reason")) or "已注销",
            node_id=_text(item.get("node_id")) or None,
        ))

    corrections: List[DictionaryCorrection] = []
    for item in _as_list(payload.get("dictionary_corrections")):
        if not isinstance(item, dict):
            continue
        original = _text(item.get("original"))
        corrected = _text(item.get("corrected"))
        if original and corrected:
            corrections.append(DictionaryCorrection(
                original=original,
                corrected=corrected,
                similarity=round(_float(item.get("similarity")), 2),
            ))

    quality_raw = payload.get("quality") if isinstance(payload.get("quality"), dict) else {}
    quality = Quality(
        overall_confidence=_float(quality_raw.get("overall_confidence")),
        low_confidence_items=[_text(x) for x in _as_list(quality_raw.get("low_confidence_items")) if _text(x)],
        review_notes=[_text(x) for x in _as_list(quality_raw.get("review_notes")) if _text(x)],
    )

    diag_raw = payload.get("diagnostics") if isinstance(payload.get("diagnostics"), dict) else {}
    diagnostics = Diagnostics(
        image_width=int(diag_raw.get("image_width") or 0),
        image_height=int(diag_raw.get("image_height") or 0),
        raw_size_bytes=int(diag_raw.get("raw_size_bytes") or 0),
        tile_count=int(diag_raw.get("tile_count") or 0),
        detected_node_boxes=int(diag_raw.get("detected_node_boxes") or 0),
        detected_horizontal_lines=int(diag_raw.get("detected_horizontal_lines") or 0),
        detected_vertical_lines=int(diag_raw.get("detected_vertical_lines") or 0),
        ocr_items_after_dedup=int(diag_raw.get("ocr_items_after_dedup") or 0),
        dictionary_size=int(diag_raw.get("dictionary_size") or 0),
        dictionary_correction_count=int(diag_raw.get("dictionary_correction_count") or 0),
        engine=_text(diag_raw.get("engine")),
        duration_seconds=float(diag_raw.get("duration_seconds") or 0.0),
    )

    warnings = [_text(item) for item in _as_list(payload.get("warnings")) if _text(item)]
    if dropped:
        warnings.append(f"已自动移除 {dropped} 条引用注销节点的关系。")

    core_company = _text(payload.get("core_company"))
    title = _text(payload.get("title")) or (f"{core_company}股权结构图" if core_company else "股权结构图")
    visible_text = [_text(item) for item in _as_list(payload.get("all_visible_text")) if _text(item)]

    return StructureResult(
        title=title,
        core_company=core_company,
        all_visible_text=visible_text,
        nodes=nodes,
        edges=edges,
        excluded=excluded,
        dictionary_corrections=corrections,
        warnings=warnings,
        quality=quality,
        diagnostics=diagnostics,
    )

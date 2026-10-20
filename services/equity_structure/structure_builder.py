"""Assemble OCR, geometry and topology into the final result schema."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Sequence

import numpy as np

from .config import EquityConfig
from .geometry import Segment
from .normalize import clean_name, entity_type_for, is_ui_noise
from .ocr_types import OcrItem
from .schemas import BBox, Diagnostics, DictionaryCorrection, Edge, ExcludedItem, Node, Quality, StructureResult
from .topology import infer_edges


def _center(box: Sequence[float]) -> tuple:
    return ((float(box[0]) + float(box[2])) / 2, (float(box[1]) + float(box[3])) / 2)


def cluster_levels(nodes: List[Dict[str, object]], image_height: int, core_id: str = "") -> int:
    """Assign levels by y clustering and return the chosen core cluster index.

    The core cluster is renumbered to level 2 so the rendered chart always has
    shareholders above and investments below, regardless of title/whitespace.
    """
    if not nodes:
        return 0
    ordered = sorted(nodes, key=lambda node: _center(node["bbox"])[1])  # type: ignore[arg-type]
    heights = [float(node["bbox"][3]) - float(node["bbox"][1]) for node in nodes]  # type: ignore[index]
    tolerance = max(40.0, float(np.median(heights)) * 1.45) if heights else 40.0

    clusters: List[Dict[str, object]] = []
    for node in ordered:
        y = _center(node["bbox"])[1]  # type: ignore[arg-type]
        if not clusters or abs(y - float(clusters[-1]["mean"])) > tolerance:
            clusters.append({"mean": y, "nodes": [node]})
        else:
            clusters[-1]["nodes"].append(node)  # type: ignore[union-attr]
            clusters[-1]["mean"] = float(np.mean([
                _center(item["bbox"])[1] for item in clusters[-1]["nodes"]  # type: ignore[union-attr,arg-type]
            ]))

    core_cluster = 0
    if core_id:
        for index, cluster in enumerate(clusters):
            if any(node.get("id") == core_id for node in cluster["nodes"]):  # type: ignore[union-attr]
                core_cluster = index
                break
    else:
        # Prefer a middle cluster with the widest node.
        image_center = image_height / 2
        scores = []
        for index, cluster in enumerate(clusters):
            widest = max(
                (float(node["bbox"][2]) - float(node["bbox"][0]))  # type: ignore[index]
                for node in cluster["nodes"]  # type: ignore[union-attr]
            )
            distance = abs(float(cluster["mean"]) - image_center)
            scores.append((widest - 0.35 * distance, index))
        core_cluster = max(scores)[1] if scores else 0

    for index, cluster in enumerate(clusters):
        level = max(1, index - core_cluster + 2)
        for node in cluster["nodes"]:  # type: ignore[union-attr]
            node["level"] = level
    return core_cluster


def choose_core(nodes: List[Dict[str, object]], image_width: int, image_height: int) -> Optional[Dict[str, object]]:
    if not nodes:
        return None
    active = [node for node in nodes if node.get("status") == "active"] or nodes
    center_x = image_width / 2
    center_y = image_height / 2

    def score(node: Dict[str, object]) -> float:
        box = node["bbox"]
        width = float(box[2]) - float(box[0])  # type: ignore[index]
        height = float(box[3]) - float(box[1])  # type: ignore[index]
        cx, cy = _center(box)  # type: ignore[arg-type]
        return 1.2 * width + 0.5 * height - 0.38 * abs(cx - center_x) - 0.2 * abs(cy - center_y)

    return max(active, key=score)


def build_structure(
    items: List[OcrItem],
    raw_nodes: List[Dict[str, object]],
    corrections: List[Dict[str, object]],
    segments: List[Segment],
    image_width: int,
    image_height: int,
    percentage_for,
    config: EquityConfig = EquityConfig(),
    diagnostics: Optional[Diagnostics] = None,
) -> StructureResult:
    core = choose_core(raw_nodes, image_width, image_height)
    core_id = str(core["id"]) if core else ""
    cluster_levels(raw_nodes, image_height, core_id=core_id)

    nodes: List[Node] = []
    for raw in raw_nodes:
        name = clean_name(raw.get("name"))
        if not name:
            continue
        node = Node(
            id=str(raw["id"]),
            name=name,
            entity_type=entity_type_for(name, str(raw["id"]), core_id),
            level=int(raw.get("level") or 1),
            status=str(raw.get("status") or "active"),
            confidence=float(raw.get("ocr_confidence") or 0.0),
            bbox=BBox.from_value(raw.get("bbox")),
            ocr_confidence=float(raw.get("ocr_confidence") or 0.0),
        )
        nodes.append(node)

    by_id = {node.id: node for node in nodes}
    if core_id not in by_id:
        core_id = max(nodes, key=lambda node: node.confidence).id if nodes else ""
        core = by_id.get(core_id)
    core_name = core.name if isinstance(core, Node) else (by_id[core_id].name if core_id in by_id else "")

    raw_edges = infer_edges(
        [
            {
                "id": node.id,
                "name": node.name,
                "status": node.status,
                "level": node.level,
                "bbox": node.bbox.to_list() if node.bbox else None,
            }
            for node in nodes
        ],
        segments,
        core_id,
        percentage_for,
    )

    edges: List[Edge] = []
    for raw in raw_edges:
        if raw["source"] not in by_id or raw["target"] not in by_id:
            continue
        edges.append(Edge(
            source=str(raw["source"]),
            target=str(raw["target"]),
            percentage=str(raw.get("percentage") or ""),
            relation=str(raw.get("relation") or "investment"),
            confidence=float(raw.get("confidence") or 0.0),
            percentage_source=str(raw.get("percentage_source") or "missing"),
            topology_path_depth=raw.get("topology_path_depth"),  # type: ignore[arg-type]
        ))

    cancelled = {node.id for node in nodes if node.status == "excluded_cancelled"}
    edges = [edge for edge in edges if edge.source not in cancelled and edge.target not in cancelled]
    edges = [edge for edge in edges if edge.source != edge.target]

    excluded = [
        ExcludedItem(name=node.name, reason="OCR/图像规则识别到注销类状态", node_id=node.id)
        for node in nodes if node.status == "excluded_cancelled"
    ]
    dictionary_corrections = [
        DictionaryCorrection(
            original=str(item.get("original") or ""),
            corrected=str(item.get("corrected") or ""),
            similarity=float(item.get("similarity") or 0.0),
        )
        for item in corrections
        if item.get("original") and item.get("corrected")
    ]

    visible_text: List[str] = []
    seen = set()
    for item in sorted(items, key=lambda entry: (entry.center[1], entry.center[0])):
        text = item.text.strip()
        if not text or is_ui_noise(text) or text in seen:
            continue
        seen.add(text)
        visible_text.append(text)

    low = [node.name for node in nodes if node.confidence < config.low_confidence_threshold]
    missing_percentage = [edge for edge in edges if not edge.percentage]
    warnings: List[str] = []
    if not raw_nodes:
        warnings.append("未检测到典型节点边框；截图样式可能与模板差异较大。")
    if not core_name:
        warnings.append("未能可靠确定核心主体。")
    if low:
        warnings.append(f"存在 {len(low)} 个低置信度节点，建议人工复核。")
    if missing_percentage:
        warnings.append(f"存在 {len(missing_percentage)} 条关系未自动匹配到持股比例。")
    if not segments:
        warnings.append("未检测到连线，关系主要依赖几何距离启发式。")

    overall = float(np.mean([node.confidence for node in nodes])) if nodes else 0.0
    quality = Quality(
        overall_confidence=round(overall, 3),
        low_confidence_items=low,
        review_notes=[
            "识别链路完全基于 Python + PaddleOCR + OpenCV + 字典/拓扑规则，不调用大语言模型。",
            "已启用多尺度 OCR、节点检测、线段拓扑与持股比例二次裁图。",
            "如用于审计/财务底稿，建议在网页中对节点名称与比例做最终人工复核。",
        ],
    )

    diag = diagnostics or Diagnostics()
    diag.image_width = image_width
    diag.image_height = image_height
    diag.detected_node_boxes = len(raw_nodes)
    diag.detected_horizontal_lines = sum(1 for segment in segments if segment.orientation == "h")
    diag.detected_vertical_lines = sum(1 for segment in segments if segment.orientation == "v")
    diag.ocr_items_after_dedup = len(items)
    diag.dictionary_correction_count = len(dictionary_corrections)

    return StructureResult(
        title=f"{core_name}股权结构图" if core_name else "股权结构图",
        core_company=core_name,
        all_visible_text=visible_text,
        nodes=nodes,
        edges=edges,
        excluded=excluded,
        dictionary_corrections=dictionary_corrections,
        warnings=warnings,
        quality=quality,
        diagnostics=diag,
    )

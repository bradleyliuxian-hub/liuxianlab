"""Explicit line-segment graph and path-based parent/child inference."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .geometry import Segment


def _ranges_overlap(a1: float, a2: float, b1: float, b2: float, pad: int = 8) -> bool:
    return max(a1, b1) <= min(a2, b2) + pad


def segments_connected(a: Segment, b: Segment, pad: int = 14) -> bool:
    if a.orientation == b.orientation:
        if a.orientation == "h":
            return abs(a.center[1] - b.center[1]) <= pad and _ranges_overlap(a.x1, a.x2, b.x1, b.x2, pad)
        return abs(a.center[0] - b.center[0]) <= pad and _ranges_overlap(a.y1, a.y2, b.y1, b.y2, pad)

    horizontal = a if a.orientation == "h" else b
    vertical = b if a.orientation == "h" else a
    hx = horizontal.center[0]
    hy = horizontal.center[1]
    vx = vertical.center[0]
    vy = vertical.center[1]
    return (
        horizontal.x1 - pad <= vx <= horizontal.x2 + pad
        and vertical.y1 - pad <= hy <= vertical.y2 + pad
    )


def segment_touches_box(segment: Segment, box: Sequence[float], side: str, pad: int = 22) -> bool:
    if side == "bottom":
        if segment.orientation == "h":
            return abs(segment.center[1] - box[3]) <= pad and _ranges_overlap(segment.x1, segment.x2, box[0], box[2], pad)
        return box[0] - pad <= segment.center[0] <= box[2] + pad and segment.y1 <= box[3] + pad <= segment.y2 + pad
    if segment.orientation == "h":
        return abs(segment.center[1] - box[1]) <= pad and _ranges_overlap(segment.x1, segment.x2, box[0], box[2], pad)
    return box[0] - pad <= segment.center[0] <= box[2] + pad and segment.y1 - pad <= box[1] <= segment.y2 + pad


def build_graph(segments: Sequence[Segment], pad: int = 14) -> Dict[int, set]:
    graph: Dict[int, set] = defaultdict(set)
    for left in range(len(segments)):
        for right in range(left + 1, len(segments)):
            if segments_connected(segments[left], segments[right], pad=pad):
                graph[left].add(right)
                graph[right].add(left)
    return graph


def topology_path_score(
    parent_box: Sequence[float],
    child_box: Sequence[float],
    segments: Sequence[Segment],
    graph: Dict[int, set],
    pad: int = 22,
) -> Tuple[float, Optional[int]]:
    starts = [
        index for index, segment in enumerate(segments)
        if segment_touches_box(segment, parent_box, "bottom", pad=pad)
    ]
    targets = {
        index for index, segment in enumerate(segments)
        if segment_touches_box(segment, child_box, "top", pad=pad)
    }
    if not starts or not targets:
        return 0.0, None

    queue = deque((index, 0) for index in starts)
    seen = set(starts)
    while queue:
        node, depth = queue.popleft()
        if node in targets:
            # Short connector chains are more trustworthy than long detours.
            return max(0.45, 1.0 - depth * 0.08), depth
        if depth >= 12:
            continue
        for neighbour in graph.get(node, ()):  # type: ignore[arg-type]
            if neighbour not in seen:
                seen.add(neighbour)
                queue.append((neighbour, depth + 1))
    return 0.0, None


def infer_edges(
    nodes: List[Dict[str, object]],
    segments: Sequence[Segment],
    core_id: str,
    percentage_for: Optional[Callable[[Sequence[float], Sequence[float]], Tuple[str, str]]] = None,
) -> List[Dict[str, object]]:
    active = [node for node in nodes if node.get("status") == "active"]
    by_level: Dict[int, List[Dict[str, object]]] = defaultdict(list)
    for node in active:
        by_level[int(node.get("level") or 1)].append(node)

    graph = build_graph(segments)
    edges: List[Dict[str, object]] = []

    core = next((node for node in active if node.get("id") == core_id), None)
    if core:
        for node in by_level.get(1, []):
            if node.get("id") == core_id:
                continue
            percentage, source = percentage_for(node["bbox"], core["bbox"]) if percentage_for else ("", "missing")  # type: ignore[arg-type]
            edges.append({
                "source": node["id"],
                "target": core["id"],
                "percentage": percentage,
                "percentage_source": source,
                "relation": "shareholder_to_core",
                "confidence": 0.94 if percentage and source == "secondary_crop_ocr" else (0.88 if percentage else 0.62),
                "topology_path_depth": None,
            })

    levels = sorted(by_level)
    for level in levels:
        if level < 2:
            continue
        parents = by_level.get(level, [])
        children = by_level.get(level + 1, [])
        if not parents or not children:
            continue
        for child in children:
            if child.get("id") == core_id:
                continue
            cx, cy = _center(child["bbox"])  # type: ignore[arg-type]
            best = None
            best_score = -1e12
            best_topo = 0.0
            best_depth = None
            for parent in parents:
                px, py = _center(parent["bbox"])  # type: ignore[arg-type]
                if parent.get("id") == child.get("id") or py >= cy:
                    continue
                topology, depth = topology_path_score(parent["bbox"], child["bbox"], segments, graph)  # type: ignore[arg-type]
                distance = (cy - py) + 0.5 * abs(cx - px)
                width = max(120.0, float(parent["bbox"][2]) - float(parent["bbox"][0]))  # type: ignore[index]
                alignment = max(0.0, 1.0 - abs(cx - px) / (width * 1.25))
                score = 380 * topology + 105 * alignment - distance
                if score > best_score:
                    best_score = score
                    best = parent
                    best_topo = topology
                    best_depth = depth
            if not best:
                continue
            percentage, source = percentage_for(best["bbox"], child["bbox"]) if percentage_for else ("", "missing")  # type: ignore[arg-type]
            confidence = 0.48 + 0.34 * best_topo + (0.08 if percentage else 0)
            edges.append({
                "source": best["id"],
                "target": child["id"],
                "percentage": percentage,
                "percentage_source": source,
                "relation": "investment" if level == 2 else "subsidiary",
                "confidence": round(max(0.35, min(0.98, confidence)), 3),
                "topology_path_depth": best_depth,
            })

    # Keep one edge per pair; the core shareholder edge wins over a heuristic.
    deduped: Dict[Tuple[str, str], Dict[str, object]] = {}
    for edge in edges:
        deduped[(str(edge["source"]), str(edge["target"]))] = edge
    return list(deduped.values())


def _center(box: Sequence[float]) -> Tuple[float, float]:
    return ((float(box[0]) + float(box[2])) / 2, (float(box[1]) + float(box[3])) / 2)

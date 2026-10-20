"""Deterministic top-down layout used by SVG/PDF exports."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Dict, List, Sequence

from .normalize import normalize_display
from .schemas import Edge, Node, StructureResult

NODE_WIDTH = 150
NODE_MAX_WIDTH = 300
CORE_WIDTH = 430
NODE_MIN_HEIGHT = 70
CORE_MIN_HEIGHT = 90
H_GAP = 18
LEVEL_GAP = 160
MARGIN = 80
TITLE_HEIGHT = 86


@dataclass
class PositionedNode:
    node: Node
    x: float
    y: float
    width: float
    height: float
    lines: List[str] = field(default_factory=list)


@dataclass
class Layout:
    width: float
    height: float
    nodes: Dict[str, PositionedNode]
    levels: List[int]


def _wrap_words(text: str, max_chars: int) -> List[str]:
    words = [word for word in text.split(" ") if word]
    lines: List[str] = []
    line = ""
    for word in words:
        if len(word) > max_chars:
            if line:
                lines.append(line)
                line = ""
            for index in range(0, len(word), max_chars):
                piece = word[index:index + max_chars]
                if len(piece) == max_chars:
                    lines.append(piece)
                else:
                    line = piece
            continue
        candidate = f"{line} {word}" if line else word
        if len(candidate) <= max_chars:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines or [""]


def wrap_text(text: str, chars_per_line: int) -> List[str]:
    normalized = normalize_display(text)
    if not normalized:
        return [""]
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", normalized))
    latin_count = len(re.findall(r"[A-Za-z]", normalized))
    if latin_count > 0 and (cjk_count == 0 or " " in normalized):
        return _wrap_words(normalized, chars_per_line)
    return [normalized[index:index + chars_per_line] for index in range(0, len(normalized), chars_per_line)] or [""]


def _sort_key(node: Node):
    if node.bbox is not None:
        return ((node.bbox.x1 + node.bbox.x2) / 2, node.name)
    return (0, node.name)


def layout_structure(result: StructureResult, overrides: dict | None = None) -> Layout:
    nodes = [node for node in result.nodes if node.status != "excluded_cancelled"]
    if not nodes:
        return Layout(width=1200, height=420, nodes={}, levels=[])

    by_level: Dict[int, List[Node]] = {}
    for node in nodes:
        by_level.setdefault(node.level, []).append(node)
    levels = sorted(by_level)
    for level in levels:
        by_level[level].sort(key=_sort_key)

    positioned: Dict[str, PositionedNode] = {}
    row_widths: Dict[int, float] = {}
    for level in levels:
        widths = []
        for node in by_level[level]:
            core = node.name == result.core_company
            base = CORE_WIDTH if core else NODE_WIDTH
            chars = 26 if core else 16
            lines = wrap_text(node.name, chars)
            char_width = 19 if core else 14
            width = max(base, min(NODE_MAX_WIDTH, max(len(line) for line in lines) * char_width + 48))
            widths.append((node, width, lines))
        total = sum(width for _node, width, _lines in widths) + H_GAP * max(0, len(widths) - 1)
        row_widths[level] = total

    max_width = max(row_widths.values()) if row_widths else NODE_WIDTH
    width = max(1000.0, max_width + MARGIN * 2)
    height = TITLE_HEIGHT + (levels[-1] - 1) * LEVEL_GAP + 260 if levels else 420

    for level in levels:
        entries = []
        for node in by_level[level]:
            core = node.name == result.core_company
            chars = 26 if core else 15
            lines = wrap_text(node.name, chars)
            base = CORE_WIDTH if core else NODE_WIDTH
            node_width = max(base, min(NODE_MAX_WIDTH, max(len(line) for line in lines) * (19 if core else 14) + 48))
            node_height = max(CORE_MIN_HEIGHT if core else NODE_MIN_HEIGHT, len(lines) * (28 if core else 22) + 24)
            entries.append((node, node_width, node_height, lines))
        total = sum(entry[1] for entry in entries) + H_GAP * max(0, len(entries) - 1)
        x = (width - total) / 2
        for node, node_width, node_height, lines in entries:
            y = TITLE_HEIGHT + (level - 1) * LEVEL_GAP
            positioned[node.id] = PositionedNode(node, x, y, node_width, node_height, lines)
            x += node_width + H_GAP

    if overrides and isinstance(overrides.get("nodes"), dict):
        for node_id, override in overrides["nodes"].items():
            position = positioned.get(node_id)
            if not position or not isinstance(override, dict):
                continue
            try:
                x = float(override.get("x", position.x))
                y = float(override.get("y", position.y))
                node_width = max(130.0, float(override.get("width", position.width)))
                node_height = max(50.0, float(override.get("height", position.height)))
            except (TypeError, ValueError):
                continue
            core = position.node.name == result.core_company
            chars = max(8, int((node_width - 36) / (19 if core else 14)))
            lines = wrap_text(position.node.name, chars)
            positioned[node_id] = PositionedNode(position.node, x, y, node_width, node_height, lines)

    max_right = max((position.x + position.width for position in positioned.values()), default=0)
    max_bottom = max((position.y + position.height for position in positioned.values()), default=0)
    width = max(width, max_right + MARGIN)
    height = max(height, max_bottom + 50 + 30)
    return Layout(width=width, height=height, nodes=positioned, levels=levels)


def edge_points(parent: PositionedNode, child: PositionedNode):
    x1 = parent.x + parent.width / 2
    y1 = parent.y + parent.height
    x2 = child.x + child.width / 2
    y2 = child.y
    mid = y1 + max(36, (y2 - y1) / 2)
    return x1, y1, x2, y2, mid


def percentage_label(edge: Edge, parent: PositionedNode, child: PositionedNode):
    x1, y1, x2, y2, mid = edge_points(parent, child)
    if abs(x2 - x1) < 12:
        x = x2 + 10
        y = (mid + y2) / 2
    else:
        x = (x1 + x2) / 2 + 6
        y = mid - 7
    return x, y


@dataclass
class RouteLine:
    x1: float
    y1: float
    x2: float
    y2: float
    role: str = "edge"


@dataclass
class RouteLabel:
    text: str
    x: float
    y: float
    width: float
    height: float = 17


@dataclass
class Routes:
    lines: List[RouteLine] = field(default_factory=list)
    arrows: List[tuple] = field(default_factory=list)
    labels: List[RouteLabel] = field(default_factory=list)


def _boxes_overlap(a, b, gap: float = 0.0) -> bool:
    return not (
        a[0] + a[2] + gap <= b[0] or b[0] + b[2] + gap <= a[0]
        or a[1] + a[3] + gap <= b[1] or b[1] + b[3] + gap <= a[1]
    )


def _place_label(raw: dict, placed: List[RouteLabel], nodes: List[tuple], layout: Layout, direction: str) -> RouteLabel:
    attempts = [(0, 0), (10, 0), (-10, 0), (0, -10), (0, 10), (-10, -10), (10, 10), (0, -18), (0, 18), (-18, 0), (18, 0)]
    min_x, max_x = 80, layout.width - 80 - raw["width"]
    min_y, max_y = 50, layout.height - 50 - 17
    for dx, dy in attempts:
        candidate = RouteLabel(
            text=raw["text"],
            x=max(min_x, min(max_x, raw["x"] + dx)),
            y=max(min_y, min(max_y, raw["y"] + dy)),
            width=raw["width"],
        )
        if any(_boxes_overlap((candidate.x, candidate.y, candidate.width, 17), (b.x, b.y, b.width, b.height), 6) for b in placed):
            continue
        if any(_boxes_overlap((candidate.x, candidate.y, candidate.width, 17), (n[0], n[1], n[2], n[3]), 4) for n in nodes):
            continue
        if direction == "up" and candidate.y + 17 > raw["bus_y"] - 4:
            continue
        if direction == "down" and candidate.y < raw["bus_y"] + 4:
            continue
        placed.append(candidate)
        return candidate
    candidate = RouteLabel(
        text=raw["text"],
        x=max(min_x, min(max_x, raw["x"])),
        y=max(min_y, min(max_y, raw["y"])),
        width=raw["width"],
    )
    placed.append(candidate)
    return candidate


def build_routes(result: StructureResult, layout: Layout, overrides: dict | None = None) -> Routes:
    positions = layout.nodes
    edges = [edge for edge in result.edges if edge.source in positions and edge.target in positions]
    edge_ids = {id(edge): f"e{index + 1}" for index, edge in enumerate(result.edges)}
    core_node = next((node for node in result.nodes if node.name == result.core_company), None)
    core = positions.get(core_node.id) if core_node else None
    routes = Routes()
    used = set()
    raw_labels: List[tuple] = []
    node_boxes = [(p.x, p.y, p.width, p.height) for p in positions.values()]

    def add_label(text: str, x: float, y: float, bus_y: float, direction: str, edge_id: str = "") -> None:
        if not text:
            return
        width = max(34, len(text) * 7 + 10)
        raw_labels.append(({
            "text": text,
            "x": x,
            "y": y - 13,
            "width": width,
            "bus_y": bus_y,
            "edge_id": edge_id,
        }, direction))

    if core:
        shareholder_edges = [edge for edge in edges if edge.relation == "shareholder_to_core"]
        shareholder_positions = []
        seen = set()
        for edge in shareholder_edges:
            if edge.source not in seen:
                seen.add(edge.source)
                shareholder_positions.append(positions[edge.source])
        if shareholder_positions:
            used.update(id(edge) for edge in shareholder_edges)
            bottom_max = max(position.y + position.height for position in shareholder_positions)
            gap = max(60.0, core.y - bottom_max)
            bus_y = max(bottom_max + 30, min(core.y - 35, bottom_max + gap * 0.42))
            if bus_y <= bottom_max:
                bus_y = (bottom_max + core.y) / 2
            if overrides and isinstance(overrides.get("buses"), dict):
                bus_override = overrides["buses"].get("shareholder") or {}
                if bus_override.get("manual") and bus_override.get("y") is not None:
                    try:
                        bus_y = float(bus_override["y"])
                    except (TypeError, ValueError):
                        pass
            xs = [position.x + position.width / 2 for position in shareholder_positions]
            core_x = core.x + core.width / 2
            for position in shareholder_positions:
                x = position.x + position.width / 2
                routes.lines.append(RouteLine(x, position.y + position.height, x, bus_y, "shareholder"))
            routes.lines.append(RouteLine(min(xs), bus_y, max(xs), bus_y, "shareholder-bus"))
            routes.lines.append(RouteLine(core_x, bus_y, core_x, core.y, "shareholder-core"))
            routes.arrows.append((core_x, core.y))
            for edge in shareholder_edges:
                position = positions[edge.source]
                x = position.x + position.width / 2
                segment = bus_y - (position.y + position.height)
                y = bus_y - 10 if segment <= 22 else position.y + position.height + segment * 0.55
                add_label(edge.percentage, x + 8, y, bus_y, "up", edge_ids.get(id(edge), ""))

        direct_edges = [
            edge for edge in edges
            if id(edge) not in used and edge.source == core_node.id and edge.relation == "investment"  # type: ignore[union-attr]
        ]
        direct_positions = []
        seen = set()
        for edge in direct_edges:
            if edge.target not in seen:
                seen.add(edge.target)
                direct_positions.append(positions[edge.target])
        if direct_positions:
            used.update(id(edge) for edge in direct_edges)
            core_bottom = core.y + core.height
            child_top_min = min(position.y for position in direct_positions)
            gap = max(60.0, child_top_min - core_bottom)
            child_bus_y = max(core_bottom + 30, min(child_top_min - 30, core_bottom + gap * 0.45))
            if child_bus_y <= core_bottom:
                child_bus_y = (core_bottom + child_top_min) / 2
            if overrides and isinstance(overrides.get("buses"), dict):
                bus_override = overrides["buses"].get("direct") or {}
                if bus_override.get("manual") and bus_override.get("y") is not None:
                    try:
                        child_bus_y = float(bus_override["y"])
                    except (TypeError, ValueError):
                        pass
            xs = [position.x + position.width / 2 for position in direct_positions]
            core_x = core.x + core.width / 2
            routes.lines.append(RouteLine(core_x, core_bottom, core_x, child_bus_y, "direct-core"))
            routes.lines.append(RouteLine(min(xs + [core_x]), child_bus_y, max(xs + [core_x]), child_bus_y, "direct-bus"))
            for position in direct_positions:
                x = position.x + position.width / 2
                routes.lines.append(RouteLine(x, child_bus_y, x, position.y, "direct-child"))
                routes.arrows.append((x, position.y))
            for edge in direct_edges:
                position = positions[edge.target]
                x = position.x + position.width / 2
                segment = position.y - child_bus_y
                y = child_bus_y + max(10, segment * 0.55)
                add_label(edge.percentage, x + 8, y, child_bus_y, "down", edge_ids.get(id(edge), ""))

    for edge in edges:
        if id(edge) in used:
            continue
        parent = positions[edge.source]
        child = positions[edge.target]
        x1 = parent.x + parent.width / 2
        y1 = parent.y + parent.height
        x2 = child.x + child.width / 2
        y2 = child.y
        mid = y1 + max(36, (y2 - y1) / 2)
        routes.lines.append(RouteLine(x1, y1, x1, mid, "edge"))
        routes.lines.append(RouteLine(x1, mid, x2, mid, "edge"))
        routes.lines.append(RouteLine(x2, mid, x2, y2, "edge"))
        routes.arrows.append((x2, y2))
        segment = abs(y2 - mid)
        y = y2 - 10 if segment <= 22 else mid + (y2 - mid) * 0.55
        add_label(edge.percentage, (x2 if abs(x2 - x1) < 12 else (x1 + x2) / 2) + 8, y, mid, "down", edge_ids.get(id(edge), ""))

    placed: List[RouteLabel] = []
    for raw, direction in raw_labels:
        label_id = raw.get("edge_id", "")
        manual = (overrides or {}).get("labels", {}).get(label_id, {}) if isinstance((overrides or {}).get("labels"), dict) else {}
        if manual.get("manual") and manual.get("x") is not None and manual.get("y") is not None:
            try:
                label = RouteLabel(
                    text=raw["text"],
                    x=max(80.0, min(layout.width - 80 - raw["width"], float(manual["x"]))),
                    y=max(50.0, min(layout.height - 50 - 17, float(manual["y"]))),
                    width=raw["width"],
                )
            except (TypeError, ValueError):
                label = _place_label(raw, placed, node_boxes, layout, direction)
        else:
            label = _place_label(raw, placed, node_boxes, layout, direction)
        routes.labels.append(label)
    return routes

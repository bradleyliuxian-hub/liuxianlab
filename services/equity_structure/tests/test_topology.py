from __future__ import annotations

import unittest

from services.equity_structure.geometry import Segment
from services.equity_structure.topology import (
    build_graph,
    infer_edges,
    segments_connected,
    topology_path_score,
)


class TopologyTest(unittest.TestCase):
    def test_segments_connect(self):
        horizontal_a = Segment(0, 100, 100, 104, "h")
        horizontal_b = Segment(90, 100, 200, 104, "h")
        vertical = Segment(50, 100, 54, 220, "v")
        self.assertTrue(segments_connected(horizontal_a, horizontal_b))
        self.assertTrue(segments_connected(horizontal_a, vertical))
        self.assertFalse(segments_connected(horizontal_a, Segment(300, 300, 400, 304, "h")))

    def test_graph_path_from_parent_to_child(self):
        parent = [0, 0, 100, 40]
        child = [120, 200, 220, 240]
        segments = [
            Segment(50, 40, 54, 120, "v"),   # parent bottom down
            Segment(50, 116, 170, 120, "h"), # across
            Segment(166, 120, 170, 200, "v"),# down to child
        ]
        graph = build_graph(segments)
        score, depth = topology_path_score(parent, child, segments, graph)
        self.assertGreater(score, 0)
        self.assertIsNotNone(depth)

    def test_no_path_returns_zero(self):
        parent = [0, 0, 100, 40]
        child = [400, 400, 500, 440]
        segments = [Segment(50, 40, 54, 120, "v")]
        score, depth = topology_path_score(parent, child, segments, build_graph(segments))
        self.assertEqual(score, 0.0)
        self.assertIsNone(depth)

    def test_infer_edges_skips_cancelled_and_duplicates(self):
        nodes = [
            {"id": "n1", "name": "股东", "status": "active", "level": 1, "bbox": [0, 0, 100, 40]},
            {"id": "n2", "name": "核心", "status": "active", "level": 2, "bbox": [0, 200, 200, 250]},
            {"id": "n3", "name": "注销公司", "status": "excluded_cancelled", "level": 3, "bbox": [0, 400, 100, 440]},
            {"id": "n4", "name": "子公司", "status": "active", "level": 3, "bbox": [300, 400, 420, 450]},
        ]
        edges = infer_edges(nodes, [], "n2", lambda _a, _b: ("51%", "global_ocr"))
        pairs = {(edge["source"], edge["target"]) for edge in edges}
        self.assertIn(("n1", "n2"), pairs)
        self.assertIn(("n2", "n4"), pairs)
        self.assertNotIn(("n2", "n3"), pairs)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest

from services.equity_structure.structure_builder import build_structure, cluster_levels
from services.equity_structure.schemas import SchemaError, validate_result


def raw_node(node_id, name, box, status="active", level=1, confidence=0.9):
    return {"id": node_id, "name": name, "bbox": list(box), "status": status, "level": level, "ocr_confidence": confidence}


class StructureTest(unittest.TestCase):
    def test_cluster_levels_makes_core_level_two(self):
        nodes = [
            raw_node("n1", "股东甲", [0, 10, 100, 40]),
            raw_node("n2", "股东乙", [150, 12, 250, 42]),
            raw_node("n3", "核心公司", [80, 200, 380, 250]),
            raw_node("n4", "子公司", [80, 400, 260, 440]),
        ]
        core_id = "n3"
        cluster_levels(nodes, image_height=500, core_id=core_id)
        levels = {node["id"]: node["level"] for node in nodes}
        self.assertEqual(levels["n3"], 2)
        self.assertEqual(levels["n1"], 1)
        self.assertEqual(levels["n4"], 3)

    def test_build_structure_removes_cancelled_edges(self):
        nodes = [
            raw_node("n1", "股东", [0, 0, 100, 40]),
            raw_node("n2", "核心公司", [0, 200, 200, 250]),
            raw_node("n3", "已注销公司", [0, 400, 120, 440], status="excluded_cancelled"),
        ]
        result = build_structure(
            items=[],
            raw_nodes=nodes,
            corrections=[],
            segments=[],
            image_width=1000,
            image_height=600,
            percentage_for=lambda _a, _b: ("10%", "global_ocr"),
        )
        self.assertTrue(result.excluded)
        self.assertFalse(any(edge.source == "n3" or edge.target == "n3" for edge in result.edges))
        self.assertTrue(all(node.status != "excluded_cancelled" for node in result.nodes if node.id not in {"n3"}))

    def test_validate_result_drops_edges_to_excluded(self):
        payload = {
            "nodes": [
                {"id": "n1", "name": "A", "status": "active", "level": 1},
                {"id": "n2", "name": "B", "status": "excluded_cancelled", "level": 2},
            ],
            "edges": [{"source": "n1", "target": "n2", "percentage": "10%"}],
        }
        result = validate_result(payload)
        self.assertEqual(result.edges, [])
        self.assertTrue(any("注销" in warning for warning in result.warnings))


    def test_validate_result_accepts_institution_and_edge_client_id(self):
        result = validate_result({
            "nodes": [
                {"id": "n1", "name": "某机构", "entity_type": "institution"},
                {"id": "n2", "name": "核心公司"},
            ],
            "edges": [
                {"source": "n1", "target": "n2", "percentage": "49.5%", "__id": "e_stable"}
            ],
        })
        self.assertEqual(result.nodes[0].entity_type, "institution")
        self.assertEqual(result.edges[0].client_id, "e_stable")

    def test_validate_result_rejects_duplicate_ids(self):
        with self.assertRaises(SchemaError):
            validate_result({
                "nodes": [
                    {"id": "n1", "name": "A"},
                    {"id": "n1", "name": "B"},
                ],
                "edges": []
            })


if __name__ == "__main__":
    unittest.main()

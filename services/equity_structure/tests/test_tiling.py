from __future__ import annotations

import unittest

import numpy as np

from services.equity_structure.tiling import tile_image


class TilingTest(unittest.TestCase):
    def test_small_image_is_one_tile(self):
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        tiles = tile_image(image, 200, 200, 0.28, 10)
        self.assertEqual(len(tiles), 1)

    def test_overlap_and_edge_coverage(self):
        image = np.zeros((2600, 3800, 3), dtype=np.uint8)
        tiles = tile_image(image, 1000, 800, 0.3, 20)
        self.assertGreater(len(tiles), 1)
        self.assertTrue(any(tile.x == 0 and tile.y == 0 for tile in tiles))
        self.assertTrue(any(tile.x + tile.image.shape[1] == 3800 for tile in tiles))
        self.assertTrue(any(tile.y + tile.image.shape[0] == 2600 for tile in tiles))
        self.assertLessEqual(len(tiles), 20)

    def test_max_tiles_is_enforced(self):
        image = np.zeros((10000, 20000, 3), dtype=np.uint8)
        tiles = tile_image(image, 1000, 800, 0.2, 8)
        self.assertLessEqual(len(tiles), 8)


if __name__ == "__main__":
    unittest.main()

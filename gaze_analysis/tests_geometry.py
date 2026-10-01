"""gaze_analysis.geometry icin birim testleri (Django'suz).

Calistir:
    .venv\\Scripts\\python.exe -m unittest gaze_analysis.tests_geometry
"""
import unittest

from gaze_analysis.geometry import (
    aoi_bbox,
    aoi_contains,
    find_overlaps,
    point_in_polygon,
    point_in_rect,
)


class RectTests(unittest.TestCase):
    def setUp(self):
        self.rect = {"x": 0.2, "y": 0.2, "w": 0.4, "h": 0.4}  # 0.2..0.6

    def test_ic_nokta(self):
        self.assertTrue(point_in_rect(0.4, 0.4, self.rect))

    def test_dis_nokta(self):
        self.assertFalse(point_in_rect(0.1, 0.4, self.rect))
        self.assertFalse(point_in_rect(0.7, 0.4, self.rect))

    def test_tampon_payi(self):
        # 0.65, tampon 0.1 ile icerir (0.6 + 0.1 = 0.7)
        self.assertFalse(point_in_rect(0.65, 0.4, self.rect))
        self.assertTrue(point_in_rect(0.65, 0.4, self.rect, buffer=0.1))


class PolygonTests(unittest.TestCase):
    def setUp(self):
        # Birim kare icinde ucgen
        self.tri = [[0.1, 0.1], [0.5, 0.1], [0.3, 0.5]]

    def test_ic_nokta(self):
        self.assertTrue(point_in_polygon(0.3, 0.2, self.tri))

    def test_dis_nokta(self):
        self.assertFalse(point_in_polygon(0.9, 0.9, self.tri))

    def test_aoi_contains_polygon(self):
        aoi = {"shape": "polygon", "coords": {"points": self.tri}}
        self.assertTrue(aoi_contains(0.3, 0.2, aoi))
        self.assertFalse(aoi_contains(0.9, 0.9, aoi))


class BBoxOverlapTests(unittest.TestCase):
    def test_bbox(self):
        aoi = {"shape": "rect", "coords": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}}
        got = aoi_bbox(aoi)
        for g, e in zip(got, (0.1, 0.2, 0.4, 0.6)):
            self.assertAlmostEqual(g, e, places=6)

    def test_cakisma_var(self):
        a = {"shape": "rect", "coords": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}}
        b = {"shape": "rect", "coords": {"x": 0.3, "y": 0.3, "w": 0.5, "h": 0.5}}
        self.assertEqual(find_overlaps([a, b]), [(0, 1)])

    def test_cakisma_yok(self):
        a = {"shape": "rect", "coords": {"x": 0.0, "y": 0.0, "w": 0.3, "h": 0.3}}
        b = {"shape": "rect", "coords": {"x": 0.5, "y": 0.5, "w": 0.3, "h": 0.3}}
        self.assertEqual(find_overlaps([a, b]), [])


if __name__ == "__main__":
    unittest.main()

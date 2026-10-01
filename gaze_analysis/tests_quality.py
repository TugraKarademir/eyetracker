"""Veri kalitesi / dislama kurallari testleri (spec §7).

    .venv\\Scripts\\python.exe -m unittest gaze_analysis.tests_quality
"""
import unittest

from gaze_analysis.config import AnalysisConfig
from gaze_analysis.quality import material_quality, session_quality


class MaterialQualityTests(unittest.TestCase):
    def setUp(self):
        self.cfg = AnalysisConfig(max_missing_ratio=0.30)

    def test_kabul(self):
        mq = material_quality(total_samples=100, out_of_material=20, config=self.cfg)
        self.assertFalse(mq["excluded"])
        self.assertAlmostEqual(mq["missing_ratio"], 0.2, places=3)

    def test_dislama(self):
        mq = material_quality(total_samples=100, out_of_material=40, config=self.cfg)
        self.assertTrue(mq["excluded"])
        self.assertIn("Kayip veri", mq["reason"])


class SessionQualityTests(unittest.TestCase):
    def setUp(self):
        self.cfg = AnalysisConfig(max_validation_error_ratio=0.10, min_valid_material_ratio=0.50)

    def test_gecerli_oturum(self):
        sq = session_quality(validation_error_px=80, viewport_width=1366,
                             material_flags=[True, True, False], config=self.cfg)
        self.assertFalse(sq["excluded"])  # 2/3 = 0.67 >= 0.5
        self.assertTrue(sq["validation_ok"])

    def test_dusuk_gecerli_materyal_dislar(self):
        sq = session_quality(validation_error_px=50, viewport_width=1366,
                             material_flags=[True, False, False, False], config=self.cfg)
        self.assertTrue(sq["excluded"])  # 1/4 = 0.25 < 0.5
        self.assertTrue(any("Gecerli materyal" in r for r in sq["reasons"]))

    def test_yuksek_dogrulama_hatasi_isaretlenir(self):
        # 200px > %10 * 1366 = 136.6 -> dogrulama_ok False, sebep eklenir
        sq = session_quality(validation_error_px=200, viewport_width=1366,
                             material_flags=[True, True], config=self.cfg)
        self.assertFalse(sq["validation_ok"])
        self.assertTrue(any("Dogrulama" in r for r in sq["reasons"]))


if __name__ == "__main__":
    unittest.main()

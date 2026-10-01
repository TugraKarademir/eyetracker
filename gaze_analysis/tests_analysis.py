"""Sentetik veriyle analiz testleri (spec §13 bitti kriteri, §15).

Calistir:
    .venv\\Scripts\\python.exe -m unittest gaze_analysis.tests_analysis
"""
import unittest

from gaze_analysis.aoi_metrics import group_aoi_metrics, session_aoi_metrics
from gaze_analysis.config import AnalysisConfig
from gaze_analysis.fixation import detect_fixations
from gaze_analysis.preprocessing import clean_samples, moving_median, preprocess


def _samples(seq):
    """seq: [(t, x, y, in_material)] -> ornek sozlukleri."""
    return [{"t": t, "x": x, "y": y, "in_material": im} for (t, x, y, im) in seq]


class PreprocessTests(unittest.TestCase):
    def test_clean_materyal_disi_ve_none_cikar(self):
        s = _samples([
            (0, 0.2, 0.2, True),
            (100, None, 0.3, True),   # x None -> cikar
            (200, 0.5, 0.5, False),   # materyal disi -> cikar
            (300, 0.4, 0.4, True),
        ])
        out = clean_samples(s)
        self.assertEqual(len(out), 2)
        self.assertEqual([o["t"] for o in out], [0, 300])

    def test_clean_siralar(self):
        s = _samples([(300, 0.4, 0.4, True), (0, 0.2, 0.2, True)])
        out = clean_samples(s)
        self.assertEqual([o["t"] for o in out], [0, 300])

    def test_moving_median_gurultu_azaltir(self):
        s = _samples([(0, 0.2, 0.2, True), (100, 0.9, 0.2, True), (200, 0.2, 0.2, True)])
        out = moving_median(s, 3)
        # Ortadaki sicrama komsularinin medyani ile (0.2) degisir
        self.assertAlmostEqual(out[1]["x"], 0.2, places=6)


class FixationTests(unittest.TestCase):
    def setUp(self):
        self.cfg = AnalysisConfig(min_fixation_ms=100, dispersion_threshold=0.05,
                                  median_filter_window=0)

    def test_iki_fiksasyon_tespit(self):
        # 0-300 ms (0.2,0.2) etrafinda; 400-700 ms (0.8,0.8) etrafinda
        seq = [(t, 0.2, 0.2, True) for t in (0, 100, 200, 300)]
        seq += [(t, 0.8, 0.8, True) for t in (400, 500, 600, 700)]
        pts = preprocess(_samples(seq), self.cfg)
        fix = detect_fixations(pts, self.cfg, aspect=1.0)
        self.assertEqual(len(fix), 2)
        self.assertAlmostEqual(fix[0]["x"], 0.2, places=3)
        self.assertAlmostEqual(fix[1]["x"], 0.8, places=3)
        self.assertEqual(fix[0]["duration"], 300)
        self.assertEqual(fix[0]["n_samples"], 4)

    def test_kisa_bakis_fiksasyon_sayilmaz(self):
        # Tek bir ornek min_dur'u karsilamaz
        seq = [(0, 0.3, 0.3, True)]
        pts = preprocess(_samples(seq), self.cfg)
        fix = detect_fixations(pts, self.cfg, aspect=1.0)
        self.assertEqual(fix, [])

    def test_surekli_kayma_fiksasyon_uretmez(self):
        # Her ornek esigi asacak kadar uzak -> fiksasyon yok
        seq = [(0, 0.0, 0.5, True), (100, 0.3, 0.5, True), (200, 0.6, 0.5, True),
               (300, 0.9, 0.5, True)]
        pts = preprocess(_samples(seq), self.cfg)
        fix = detect_fixations(pts, self.cfg, aspect=1.0)
        self.assertEqual(fix, [])


class AOIMetricTests(unittest.TestCase):
    def setUp(self):
        self.aoi = {"id": 1, "name": "Kutu", "shape": "rect",
                    "coords": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}}  # 0.1..0.3

    def test_temel_metrikler(self):
        fixations = [
            {"start_t": 0, "end_t": 300, "duration": 300, "x": 0.2, "y": 0.2},   # icinde
            {"start_t": 400, "end_t": 700, "duration": 300, "x": 0.8, "y": 0.8}, # disinda
        ]
        res, total = session_aoi_metrics(fixations, [self.aoi])
        m = res[1]
        self.assertEqual(total, 600)
        self.assertEqual(m["total_dwell_ms"], 300)
        self.assertEqual(m["fixation_count"], 1)
        self.assertEqual(m["time_to_first_fixation_ms"], 0)
        self.assertEqual(m["dwell_proportion"], 50.0)
        self.assertTrue(m["hit"])

    def test_ziyaret_sayisi(self):
        # icinde - disinda - icinde => 2 ziyaret
        fixations = [
            {"start_t": 0, "end_t": 100, "duration": 100, "x": 0.2, "y": 0.2},
            {"start_t": 200, "end_t": 300, "duration": 100, "x": 0.8, "y": 0.8},
            {"start_t": 400, "end_t": 500, "duration": 100, "x": 0.2, "y": 0.2},
        ]
        res, _ = session_aoi_metrics(fixations, [self.aoi])
        self.assertEqual(res[1]["visit_count"], 2)
        self.assertEqual(res[1]["fixation_count"], 2)

    def test_grup_isabet_orani(self):
        # Iki katilimci: biri bakmis, biri bakmamis -> hit_rate %50
        hit = {1: {"total_dwell_ms": 300, "dwell_proportion": 50.0,
                   "time_to_first_fixation_ms": 0, "fixation_count": 1,
                   "visit_count": 1, "hit": True}}
        miss = {1: {"total_dwell_ms": 0, "dwell_proportion": 0.0,
                    "time_to_first_fixation_ms": None, "fixation_count": 0,
                    "visit_count": 0, "hit": False}}
        g = group_aoi_metrics([hit, miss], [self.aoi])
        self.assertEqual(g[1]["hit_rate"], 50.0)
        self.assertEqual(g[1]["n_participants"], 2)
        self.assertEqual(g[1]["mean_dwell_ms"], 150.0)


class ExcelTests(unittest.TestCase):
    def test_sayfalar_ve_basliklar(self):
        from gaze_analysis.excel import build_workbook
        result = {
            "study": {"name": "T", "code": "abc", "version": "x", "generated_at": "2026-01-01"},
            "config": AnalysisConfig().to_dict(),
            "sessions": [{"id": 1, "participant_code": "k1", "status": "Tamamlandi",
                          "sampling_hz": 5.0, "sample_count": 10, "missing_ratio": 0.1}],
            "raw_samples": [{"session_id": 1, "participant_code": "k1", "material_order": 1,
                             "material_id": 1, "t": 0, "x_px": 1, "y_px": 2,
                             "x_norm": 0.1, "y_norm": 0.2, "in_material": True}],
            "fixations": [{"session_id": 1, "participant_code": "k1", "material_order": 1,
                           "material_id": 1, "start_t": 0, "end_t": 300, "duration": 300,
                           "x": 0.2, "y": 0.2, "n_samples": 4, "aoi_names": ["Kutu"]}],
            "aoi_metrics": [{"session_id": 1, "participant_code": "k1", "material_order": 1,
                             "aoi_name": "Kutu", "total_dwell_ms": 300, "dwell_proportion": 50.0,
                             "time_to_first_fixation_ms": 0, "fixation_count": 1,
                             "visit_count": 1, "hit": True}],
            "aoi_summary": [{"material_order": 1, "aoi_name": "Kutu", "n_participants": 1,
                             "hit_rate": 100.0, "mean_dwell_ms": 300.0,
                             "mean_dwell_proportion": 50.0, "mean_time_to_first_fixation_ms": 0,
                             "mean_fixation_count": 1.0, "mean_visit_count": 1.0}],
        }
        wb = build_workbook(result)
        self.assertEqual(
            wb.sheetnames,
            ["Katilimcilar", "Ham_Veri", "Fiksasyonlar", "AOI_Metrikleri", "AOI_Ozet", "Ayarlar"],
        )
        self.assertEqual(wb["Fiksasyonlar"]["A1"].value, "oturum_id")
        self.assertEqual(wb["AOI_Ozet"]["D2"].value, 100.0)  # isabet_orani


if __name__ == "__main__":
    unittest.main()

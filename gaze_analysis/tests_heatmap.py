"""Isi haritasi, sicak bolge ve rapor siralama testleri (spec §8.3, §8.5).

Calistir:
    .venv\\Scripts\\python.exe -m unittest gaze_analysis.tests_heatmap
"""
import unittest

from gaze_analysis.heatmap import compute_density
from gaze_analysis.hotspots import find_hotspots
from gaze_analysis.report import rank_aois


class HeatmapTests(unittest.TestCase):
    def test_yogunluk_tepe_fiksasyon_konumunda(self):
        fx = [{"x": 0.5, "y": 0.5, "duration": 300, "participant": 1}]
        d = compute_density(fx, grid_size=50, sigma=0.05, aspect=1.0)
        self.assertEqual(d.shape, (50, 50))
        # Maksimum (0.5,0.5) hucresine yakin olmali
        import numpy as np
        iy, ix = np.unravel_index(d.argmax(), d.shape)
        self.assertAlmostEqual((ix + 0.5) / 50, 0.5, delta=0.05)
        self.assertAlmostEqual((iy + 0.5) / 50, 0.5, delta=0.05)

    def test_katilimci_agirlik_esitleme(self):
        # Katilimci A: cok uzun tek fiksasyon sol ustte; B: kisa fiksasyon sag altta.
        # Esitleme ile iki bolge de belirgin olmali (A, haritaya tek basina hakim olmaz).
        import numpy as np
        fx = [
            {"x": 0.2, "y": 0.2, "duration": 5000, "participant": "A"},
            {"x": 0.8, "y": 0.8, "duration": 200, "participant": "B"},
        ]
        d_eq = compute_density(fx, grid_size=60, sigma=0.05, aspect=1.0, equalize=True)
        # B'nin bolgesindeki yogunluk esitleme ile anlamli kalir
        b_val = d_eq[int(0.8 * 60), int(0.8 * 60)]
        self.assertGreater(b_val, 0.5)  # esit agirlikta B tepe degerine yakin

    def test_bos_fiksasyon(self):
        d = compute_density([], grid_size=20)
        self.assertEqual(d.max(), 0)


class HotspotTests(unittest.TestCase):
    def test_aoi_disi_sicak_bolge_bulunur(self):
        # Tek yogun bolge (0.8,0.8), AOI yok -> en az bir sicak bolge
        fx = [{"x": 0.8, "y": 0.8, "duration": 500, "participant": 1} for _ in range(3)]
        d = compute_density(fx, grid_size=80, sigma=0.05, aspect=1.0)
        spots = find_hotspots(d, aois=[], top_percent=10)
        self.assertTrue(len(spots) >= 1)
        s = spots[0]
        self.assertTrue(0.6 < s["x"] + s["w"] / 2 < 1.0)

    def test_aoi_icindeki_bolge_haric(self):
        fx = [{"x": 0.5, "y": 0.5, "duration": 500, "participant": 1} for _ in range(3)]
        d = compute_density(fx, grid_size=80, sigma=0.05, aspect=1.0)
        # Tum yogun bolgeyi kaplayan AOI -> sicak bolge kalmamali
        aoi = [{"shape": "rect", "coords": {"x": 0.2, "y": 0.2, "w": 0.6, "h": 0.6}}]
        spots = find_hotspots(d, aois=aoi, top_percent=10)
        self.assertEqual(spots, [])


class ReportRankTests(unittest.TestCase):
    def test_siralama(self):
        rows = [
            {"aoi_name": "Baslik", "n_participants": 5, "hit_rate": 100,
             "mean_dwell_proportion": 40.0, "mean_time_to_first_fixation_ms": 500},
            {"aoi_name": "Dipnot", "n_participants": 5, "hit_rate": 20,
             "mean_dwell_proportion": 5.0, "mean_time_to_first_fixation_ms": 3000},
        ]
        r = rank_aois(rows)
        self.assertEqual(r["most_attention"][0]["aoi_name"], "Baslik")
        self.assertEqual(r["overlooked"][0]["aoi_name"], "Dipnot")
        self.assertEqual(r["earliest_seen"][0]["aoi_name"], "Baslik")


if __name__ == "__main__":
    unittest.main()

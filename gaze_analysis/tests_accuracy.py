"""Bilinen-hedef dogruluk testi hesaplamasi (spec §12).

    .venv\\Scripts\\python.exe -m unittest gaze_analysis.tests_accuracy
"""
import unittest

from gaze_analysis.accuracy import display_width_px, summarize, target_error

ASPECT = 1080 / 1920


def _screen(tx, ty, ox=0.0, oy=0.0, ms=2000, hz=25):
    """Tek hedef ekrani: ilk 300 ms merkezden geliyor, son 300 ms Devam'a kayiyor."""
    out, step = [], 1000 // hz
    for t in range(0, ms, step):
        if t < 300:
            x, y = 0.5, 0.5
        elif t > ms - 300:
            x, y = 0.5, 1.1
        else:
            x, y = tx + ox, ty + oy
        out.append({"t": t, "x_norm": x, "y_norm": y, "x_px": 100 + x * 1350})
    return out


class TargetErrorTests(unittest.TestCase):
    def test_hatasiz(self):
        r = target_error(_screen(0.1, 0.1), 0.1, 0.1, ASPECT)
        self.assertAlmostEqual(r["error"], 0.0, places=4)
        self.assertAlmostEqual(r["precision"], 0.0, places=4)

    def test_sabit_ofset_ve_yon(self):
        r = target_error(_screen(0.9, 0.5, ox=0.03, oy=0.04), 0.9, 0.5, ASPECT)
        self.assertAlmostEqual(r["dx"], 0.03, places=4)
        self.assertAlmostEqual(r["dy"], 0.04 * ASPECT, places=4)  # genislik birimi
        self.assertAlmostEqual(r["error"], (0.03 ** 2 + (0.04 * ASPECT) ** 2) ** 0.5, places=4)

    def test_bas_ve_son_atilir(self):
        # Gecis ornekleri atilmasa medyan hedeften sapardi
        r = target_error(_screen(0.1, 0.9, ms=1500), 0.1, 0.9, ASPECT)
        self.assertAlmostEqual(r["error"], 0.0, places=4)

    def test_materyal_disi_kullanilir(self):
        r = target_error(_screen(0.1, 0.1, ox=-0.15), 0.1, 0.1, ASPECT)
        self.assertAlmostEqual(r["error"], 0.15, places=4)

    def test_cok_kisa_ekran(self):
        r = target_error(_screen(0.5, 0.1, ms=800), 0.5, 0.1, ASPECT)
        self.assertIsNone(r["error"])

    def test_ozet(self):
        rows = [target_error(_screen(0.1, 0.1, ox=0.02), 0.1, 0.1, ASPECT),
                target_error(_screen(0.5, 0.9, oy=-0.08), 0.5, 0.9, ASPECT),
                target_error(_screen(0.5, 0.1, ms=800), 0.5, 0.1, ASPECT)]
        s = summarize(rows)
        self.assertEqual(s["n_hit"], 2)
        self.assertAlmostEqual(s["mean_abs_dx"], 0.01, places=4)
        self.assertAlmostEqual(s["mean_abs_dy"], 0.04 * ASPECT, places=4)

    def test_ekran_genisligi_tahmini(self):
        self.assertAlmostEqual(display_width_px(_screen(0.1, 0.1)), 1350, places=3)


if __name__ == "__main__":
    unittest.main()

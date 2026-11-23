"""kayit.py testleri."""
import unittest

from kayit import (ac, ders_ekle, ogrenci_ekle, materyal_ekle, materyal_sec,
                   aktif_materyal, ornek_ekle, kurulum_ekle, kalibrasyon_ekle,
                   olay_ekle, katilimci_ekle, katilimci_var, katilimcilar,
                   materyaller, materyal_gorsel, ders_bitir)

ROW = {"attention": 80, "energy": 50, "emotion": "neutral", "face": 1,
       "away": 0, "eyes_closed": 0, "tab_hidden": 0, "gaze_cal": 1,
       "coarse": 0, "share": {"a": 1}, "mat_pts": [], "gaze": [[0, .5, .5]],
       "wg_share": None, "head": {"yaw": 1}}


def kur():
    con = ac(":memory:")
    ders_ekle(con, "D1", "Ders", "Konu", 1)
    ogrenci_ekle(con, "D1", "s1", "Ali", None, 2, False)
    return con


def say(con, tablo):
    return con.execute(f"SELECT COUNT(*) FROM {tablo}").fetchone()[0]


class KayitTest(unittest.TestCase):
    def test_demo_ogrenci_yazilmaz(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "Ders", "Konu", 1)
        self.assertFalse(ogrenci_ekle(con, "D1", "d", "Demo", None, 2, True))
        ornek_ekle(con, "D1", "d", 5, ROW)
        self.assertEqual(say(con, "samples"), 0)

    def test_ornek_aktif_materyalle_etiketlenir(self):
        con = kur()
        m1 = materyal_ekle(con, "D1", "Slayt", "insan")
        materyal_sec(con, "D1", m1, 10)
        ornek_ekle(con, "D1", "s1", 11, ROW)
        materyal_sec(con, "D1", None, 20)
        ornek_ekle(con, "D1", "s1", 21, ROW)
        r = [x[0] for x in con.execute(
            "SELECT material_id FROM samples ORDER BY t")]
        self.assertEqual(r, [m1, None])
        self.assertIsNone(aktif_materyal(con, "D1"))

    def test_materyal_sec_onceki_spani_kapatir(self):
        con = kur()
        m1 = materyal_ekle(con, "D1", "A", "insan")
        m2 = materyal_ekle(con, "D1", "B", "yz")
        materyal_sec(con, "D1", m1, 10)
        materyal_sec(con, "D1", m2, 25)
        sp = {r["material_id"]: r["t_end"] for r in con.execute(
            "SELECT * FROM material_spans")}
        self.assertEqual(sp[m1], 25)
        self.assertIsNone(sp[m2])
        self.assertEqual(aktif_materyal(con, "D1"), m2)

    def test_kayitsiz_ogrenci_olay_kurulum_kal_yazilmaz(self):
        con = ac(":memory:")
        olay_ekle(con, "D1", "demo1", 1, "hand", {"up": True})
        self.assertFalse(kurulum_ekle(con, "D1", "demo1", 1, {"a": 1}))
        self.assertFalse(kalibrasyon_ekle(con, "D1", "demo1", 1, {"at": 1}))
        olay_ekle(con, "D1", None, 1, "end", None)
        n = [con.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
             for t in ("events", "setups", "calibrations")]
        self.assertEqual(n, [1, 0, 0])

    def test_kurulum_anahtar_sirasi_onemsiz(self):
        con = kur()
        self.assertTrue(kurulum_ekle(con, "D1", "s1", 1, {"a": 1, "b": 2}))
        self.assertFalse(kurulum_ekle(con, "D1", "s1", 2, {"b": 2, "a": 1}))

    def test_kurulum_degismezse_yazilmaz(self):
        con = kur()
        self.assertTrue(kurulum_ekle(con, "D1", "s1", 1, {"a": 1}))
        self.assertFalse(kurulum_ekle(con, "D1", "s1", 2, {"a": 1}))
        self.assertEqual(say(con, "setups"), 1)
        self.assertTrue(kurulum_ekle(con, "D1", "s1", 3, {"a": 2}))
        self.assertEqual(say(con, "setups"), 2)

    def test_kalibrasyon_ayni_at_tekrar_yazilmaz(self):
        con = kur()
        self.assertTrue(kalibrasyon_ekle(con, "D1", "s1", 1, {"at": 99}))
        self.assertFalse(kalibrasyon_ekle(con, "D1", "s1", 2, {"at": 99}))
        self.assertTrue(kalibrasyon_ekle(con, "D1", "s1", 3, {"at": 100}))
        self.assertEqual(say(con, "calibrations"), 2)

    def test_katilimci_kodu_buyuk_harf_ve_bicim(self):
        con = ac(":memory:")
        self.assertEqual(katilimci_ekle(con, "p01"), "P01")
        self.assertTrue(katilimci_var(con, "p01"))
        self.assertEqual(len(katilimcilar(con)), 1)
        with self.assertRaises(ValueError):
            katilimci_ekle(con, "a b")

    def test_materyal_turu_ve_diger(self):
        con = kur()
        with self.assertRaises(ValueError):
            materyal_ekle(con, "D1", "X", "baska")
        m = materyal_ekle(con, "D1", "X", "diger")
        materyal_gorsel(con, m, "a.png")
        self.assertEqual(materyaller(con, "D1")[0]["image_path"], "a.png")
        olay_ekle(con, "D1", None, 1, "konu", {"ş": 1})
        ders_bitir(con, "D1", 9)
        self.assertEqual(say(con, "events"), 1)


if __name__ == "__main__":
    unittest.main()

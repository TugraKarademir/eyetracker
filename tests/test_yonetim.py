"""yonetim.py testleri."""
import json
import unittest

from kayit import (ac, ders_ekle, ders_bitir, ogrenci_ekle, materyal_ekle,
                   materyal_sec, ornek_ekle, katilimci_ekle,
                   bakis_testi_yaz, kurulum_ekle)
import yonetim


def satir(**k):
    r = {"attention": 80, "energy": 50, "emotion": "notr", "face": 1, "away": 0,
         "eyes_closed": 0, "tab_hidden": 0, "gaze_cal": 1, "coarse": 0,
         "share": {"materyal": 1.0}, "mat_pts": [[0.1, 0.1]],
         "gaze": [[-1000, .5, .5], [-500, .5, .6]], "wg_share": None, "head": None}
    r.update(k)
    return r


def kur(kalibreli=True):
    con = ac(":memory:")
    ders_ekle(con, "D1", "Ders", "Konu", 100)
    katilimci_ekle(con, "P01")
    ogrenci_ekle(con, "D1", "s1", "Ali", "P01", 101, False)
    ogrenci_ekle(con, "D1", "s2", "Veli", None, 101, False)
    m1 = materyal_ekle(con, "D1", "Insan", "insan")
    m2 = materyal_ekle(con, "D1", "YZ", "yz")
    materyal_sec(con, "D1", m1, 110)
    cal = 1 if kalibreli else 0
    ornek_ekle(con, "D1", "s1", 112, satir(share={"materyal": 1.0}, gaze_cal=cal))
    ornek_ekle(con, "D1", "s1", 114, satir(share={"materyal": 0.5}, gaze_cal=cal,
                                          emotion="mutlu"))
    ornek_ekle(con, "D1", "s2", 114, satir(share={"materyal": 0.2}, gaze_cal=cal))
    materyal_sec(con, "D1", m2, 120)
    ornek_ekle(con, "D1", "s1", 122, satir(share={"materyal": 0.4}, gaze_cal=cal))
    return con, m1, m2


class YonetimTest(unittest.TestCase):
    def test_materyal_bakma_pct(self):
        con, m1, _ = kur()
        ders_bitir(con, "D1", 200)
        mats = yonetim.ders(con, "D1")["materyaller"]
        ins = [m for m in mats if m["id"] == m1][0]
        # yalnız s1'in iki örneği değil, s2 de var: (1+.5+.2)/3 -> 57
        self.assertEqual(ins["bakma_pct"], 57)
        self.assertEqual(ins["n_kalibreli"], 2)
        self.assertEqual(len(ins["isi"]), 18)
        self.assertEqual(len(ins["isi"][0]), 32)
        self.assertEqual(ins["isi"][1][3], 1.0)

    def test_materyal_bakma_pct_iki_ornek(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        ogrenci_ekle(con, "D1", "s1", "A", None, 1, False)
        m = materyal_ekle(con, "D1", "I", "insan")
        materyal_sec(con, "D1", m, 0)
        ornek_ekle(con, "D1", "s1", 3, satir(share={"materyal": 1.0}))
        ornek_ekle(con, "D1", "s1", 5, satir(share={"materyal": 0.5}))
        r = yonetim.ders(con, "D1")["materyaller"][0]
        self.assertEqual(r["bakma_pct"], 75)
        self.assertEqual(r["baskin_duygu"], "notr")

    def test_bos_share_olcum_sayilmaz_dolu_share_materyalsiz_sifir(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        ogrenci_ekle(con, "D1", "s1", "A", None, 1, False)
        m = materyal_ekle(con, "D1", "I", "insan")
        materyal_sec(con, "D1", m, 0)
        ornek_ekle(con, "D1", "s1", 3, satir(share=None))
        ornek_ekle(con, "D1", "s1", 5, satir(share={}))
        r = yonetim.ders(con, "D1")["materyaller"][0]
        self.assertIsNone(r["bakma_pct"])
        ornek_ekle(con, "D1", "s1", 7, satir(share={"materyal": 1.0}))
        ornek_ekle(con, "D1", "s1", 9, satir(share={"konu": 1.0}))
        r = yonetim.ders(con, "D1")["materyaller"][0]
        self.assertEqual(r["bakma_pct"], 50)

    def test_n_bakma_yalniz_katkida_bulunan_ogrenciler(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        ogrenci_ekle(con, "D1", "s1", "A", None, 1, False)
        ogrenci_ekle(con, "D1", "s2", "B", None, 1, False)
        m = materyal_ekle(con, "D1", "I", "insan")
        materyal_sec(con, "D1", m, 0)
        ornek_ekle(con, "D1", "s1", 3, satir(share={"materyal": 1.0}))
        ornek_ekle(con, "D1", "s2", 3, satir(share=None))   # kalibreli ama share yok
        r = yonetim.ders(con, "D1")["materyaller"][0]
        self.assertEqual(r["n_kalibreli"], 2)
        self.assertEqual(r["n_bakma"], 1)
        self.assertEqual(r["bakma_pct"], 100)

    def test_csv_formul_enjeksiyonu(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        ogrenci_ekle(con, "D1", "s1", "=CMD()", None, 1, False)
        m = materyal_ekle(con, "D1", "@x", "insan")
        materyal_sec(con, "D1", m, 0)
        ornek_ekle(con, "D1", "s1", 3, satir(mat_pts=[[float("nan"), 0.5]]))
        s = yonetim.csv_uzun(con).splitlines()[1]
        self.assertIn(",'=CMD(),'@x,", s)
        self.assertEqual(len(yonetim.ders(con, "D1")["materyaller"][0]["isi"]), 18)

    def test_kalibresiz_ogrenci_veri_yok(self):
        con, _, _ = kur(kalibreli=False)
        o = yonetim.ogrenci(con, "D1", "s1")
        self.assertEqual(o["bakis"], [])
        self.assertIn(o["kalite"]["not"], ("veri yok", "düşük"))
        m = yonetim.ders(con, "D1")["materyaller"][0]
        self.assertIsNone(m["bakma_pct"])
        self.assertEqual(m["n_kalibreli"], 0)

    def test_ogrenci_bakis_ve_kalite(self):
        con, _, _ = kur()
        o = yonetim.ogrenci(con, "D1", "s1")
        self.assertEqual(o["bakis"][0], [112000 - 1000, .5, .5])
        self.assertEqual(o["kalite"]["kamerada_pct"], 100)
        self.assertEqual(o["kalite"]["kalibreli_pct"], 100)
        self.assertEqual(o["kalite"]["hz"], 1.0)  # 6 nokta / (3*2 sn)
        self.assertEqual(len(o["ornekler"]), 3)

    def test_bitmemis_ders_listede(self):
        con, _, _ = kur()
        r = yonetim.dersler(con)
        self.assertEqual(len(r), 1)
        self.assertIs(r[0]["bitmedi"], True)
        self.assertEqual(r[0]["sure_dk"], round((122 - 100) / 60, 1))
        self.assertEqual(r[0]["n_ogrenci"], 2)
        self.assertEqual(r[0]["n_insan"], 1)
        self.assertEqual(r[0]["n_yz"], 1)

    def test_dersler_filtre(self):
        con, _, _ = kur()
        self.assertEqual(len(yonetim.dersler(con, ara="konu")), 1)
        self.assertEqual(yonetim.dersler(con, ara="yok"), [])
        self.assertEqual(yonetim.dersler(con, bas=500), [])

    def test_karsilastirma_eslesme_koda_gore(self):
        con, _, _ = kur()
        r = yonetim.karsilastirma(con)
        self.assertEqual(len(r["eslesik"]), 1)
        self.assertEqual(r["eslesik"][0]["katilimci"], "P01")
        self.assertEqual(r["eslesik"][0]["insan"]["bakma_pct"], 75)
        self.assertEqual(r["eslesik"][0]["yz"]["bakma_pct"], 40)
        self.assertEqual(r["kodsuz_n"], 1)
        self.assertEqual(r["tur"]["insan"]["n_ornek"], 3)
        self.assertEqual(r["eslesik"][0]["insan"]["n_bakma"], 1)
        self.assertEqual(r["eslesik"][0]["insan"]["n_ogrenci"], 1)

    def test_karsilastirma_ogrenci_basina_ortalama(self):
        # s1: 4 örnek, s2: 1 örnek, s3: kalibresiz 1 örnek. Havuz (örnek ağırlıklı) ortalama farklı çıkardı.
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        for sid in ("s1", "s2", "s3"):
            ogrenci_ekle(con, "D1", sid, sid, None, 1, False)
        m = materyal_ekle(con, "D1", "I", "insan")
        materyal_sec(con, "D1", m, 0)
        for t in (3, 5, 7, 9):
            ornek_ekle(con, "D1", "s1", t, satir(share={"materyal": 1.0}, attention=80, energy=50))
        ornek_ekle(con, "D1", "s2", 5, satir(share={"materyal": 0.0}, attention=20, energy=10, emotion="mutlu"))
        ornek_ekle(con, "D1", "s3", 5, satir(gaze_cal=0, share=None, attention=50, energy=30, emotion="mutlu"))
        g = yonetim.karsilastirma(con)["tur"]["insan"]
        self.assertEqual(g["bakma_pct"], 50)        # havuz: 80
        self.assertEqual(g["n_bakma"], 2)           # s3 kalibresiz: bakmaya katılmaz
        self.assertEqual(g["n_ogrenci"], 3)
        self.assertEqual(g["ort_dikkat"], 50.0)     # havuz: 65
        self.assertEqual(g["n_dikkat"], 3)
        self.assertEqual(g["ort_enerji"], 30.0)     # havuz: 40
        self.assertEqual(g["baskin_duygu"], "mutlu")  # havuz: notr (4/6)
        self.assertEqual(g["duygu_pct"], {"mutlu": 67, "notr": 33})
        self.assertEqual(g["n_ornek"], 6)

    def test_csv_uzun_basliklar(self):
        con, _, _ = kur()
        s = yonetim.csv_uzun(con)
        self.assertEqual(
            s.splitlines()[0],
            "ders,katilimci,ogrenci,materyal,tur,sure_sn,bakma_pct,n_bakma_ornek,"
            "n_kalibreli_ornek,ort_dikkat,ort_enerji,baskin_duygu,n_ornek")
        self.assertEqual(len(s.splitlines()), 4)  # s1/insan, s2/insan, s1/yz
        self.assertFalse(s.startswith("﻿"))

    def test_csv_uzun_n_ve_bilinmeyen_sure(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "D", "K", 1)
        ogrenci_ekle(con, "D1", "s1", "A", None, 1, False)
        m = materyal_ekle(con, "D1", "I", "insan")
        materyal_sec(con, "D1", m, 0)
        ornek_ekle(con, "D1", "s1", 3, satir(share={"materyal": 1.0}))
        ornek_ekle(con, "D1", "s1", 5, satir(share=None))             # kalibreli, share yok
        ornek_ekle(con, "D1", "s1", 7, satir(gaze_cal=0, share=None))  # kalibresiz
        # span'ı silinmiş (süresi bilinmeyen) materyal: 0 değil boş
        con.execute("DELETE FROM material_spans")
        import csv as _csv
        import io as _io
        rows = list(_csv.DictReader(_io.StringIO(yonetim.csv_uzun(con))))
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["bakma_pct"], r["n_bakma_ornek"], r["n_kalibreli_ornek"], r["n_ornek"]),
                         ("100", "1", "2", "3"))
        self.assertEqual(r["sure_sn"], "")
        self.assertIsNone(yonetim.ders(con, "D1")["materyaller"][0]["sure_sn"])

    def test_csv_ham(self):
        con, _, _ = kur()
        self.assertEqual(len(yonetim.csv_ham(con, "D1").splitlines()), 5)

    def test_csv_ham_ham_sutunlari(self):
        import csv as _csv, io as _io
        con, _, _ = kur()
        ornek_ekle(con, "D1", "s2", 130, satir(ham={"n": 7, "yaw": {"ort": 0.01, "min": -0.02, "max": 0.03},
                                                  "ifade": {"happy": 0.5}, "pose3": None, "kirpma": 1}))
        rows = list(_csv.DictReader(_io.StringIO(yonetim.csv_ham(con, "D1"))))
        self.assertEqual(len(rows), 5)
        self.assertIn("gecis", rows[0])   # eski sütunlar yerinde
        r = next(x for x in rows if x["t"] == "130.0")
        self.assertEqual((r["ham_n"], r["ham_yaw_ort"], r["ham_yaw_min"], r["ham_ifade_happy"], r["ham_kirpma"]),
                         ("7", "0.01", "-0.02", "0.5", "1"))
        self.assertEqual((r["ham_pose3_dist"], r["ham_ear_ort"]), ("", ""))
        self.assertEqual(json.loads(r["ham"])["n"], 7)
        eski = next(x for x in rows if x["t"] != "130.0")
        self.assertEqual((eski["ham_n"], eski["ham"]), ("", ""))

    def test_ders_zaman_kutulari(self):
        con, _, _ = kur()
        z = yonetim.ders(con, "D1")["zaman"]
        self.assertEqual([k["t"] for k in z], [110, 120])
        self.assertEqual(z[0]["n"], 3)
        self.assertEqual(z[0]["duygular"], {"notr": 2, "mutlu": 1})

    def test_gecis_ornegi_materyale_girmez_ders_toplamina_girer(self):
        con, m1, m2 = kur()
        ornek_ekle(con, "D1", "s2", 121, satir(attention=20))   # paket [119, 121]: m1 -> m2
        self.assertEqual(tuple(con.execute(
            "SELECT material_id, gecis FROM samples WHERE t=121").fetchone()), (None, 1))
        d = yonetim.ders(con, "D1")
        mats = {m["id"]: m["n_ornek"] for m in d["materyaller"]}
        self.assertEqual(mats, {m1: 3, m2: 1})
        self.assertEqual(sum(k["n"] for k in d["zaman"]), 5)
        s2 = next(o for o in d["ogrenciler"] if o["sid"] == "s2")
        self.assertEqual(s2["n_ornek"], 2)
        self.assertEqual(yonetim.dersler(con)[0]["ort_dikkat"], 68.0)   # (80*4 + 20) / 5
        self.assertEqual(yonetim.karsilastirma(con)["tur"]["yz"]["n_ornek"], 1)
        self.assertIn("gecis", yonetim.csv_ham(con, "D1").splitlines()[0])

    def test_baskin_duygu_esitlikte_alfabetik(self):
        rs = [{"lesson_code": "D1", "sid": "s1", "gaze_cal": 0, "share": None, "attention": 1,
               "energy": 1, "emotion": e} for e in ("zorlaniyor", "mutlu")]
        rs += [{"lesson_code": "D1", "sid": "s2", "gaze_cal": 0, "share": None, "attention": 1,
                "energy": 1, "emotion": e} for e in ("notr", "mutlu", "notr", "zorlaniyor")]
        # s1: mutlu .5, zorlaniyor .5; s2: notr .5, mutlu .25, zorlaniyor .25 -> mutlu = zorlaniyor = .375
        for sira in (rs, list(reversed(rs))):
            g = yonetim._grup_ozet(sira)
            self.assertEqual(g["baskin_duygu"], "mutlu")
        self.assertEqual(yonetim._baskin(["zorlaniyor", "mutlu"]), "mutlu")
        self.assertEqual(yonetim._baskin(["mutlu", "zorlaniyor"]), "mutlu")

    def test_kalite_esikleri(self):
        self.assertEqual(yonetim.kalite(95, 85, 9, 150), "iyi")
        self.assertEqual(yonetim.kalite(75, 60, 5, 400), "orta")
        self.assertEqual(yonetim.kalite(None, None, None, None), "veri yok")
        self.assertEqual(yonetim.kalite(50, 10, 1, None), "düşük")


class CihazOnayTest(unittest.TestCase):
    def kur(self):
        con = ac(":memory:")
        ders_ekle(con, "D1", "Ders", "Konu", 100)
        ders_ekle(con, "D2", "Ders2", "Konu", 200)
        ogrenci_ekle(con, "D1", "s1", "Ali", None, 101, False, 150.0, "v1")
        ogrenci_ekle(con, "D1", "s2", "Veli", None, 101, False)
        ogrenci_ekle(con, "D2", "s3", "Ayse", None, 201, False)
        return con

    def test_onay(self):
        con = self.kur()
        o = {s["sid"]: s for s in yonetim.ders(con, "D1")["ogrenciler"]}
        self.assertEqual(o["s1"]["onay"], {"var": True, "t": 150.0, "surum": "v1"})
        self.assertFalse(o["s2"]["onay"]["var"])
        self.assertEqual(yonetim.ogrenci(con, "D1", "s1")["onay"]["surum"], "v1")

    def test_bakis_iki_deneme(self):
        con = self.kur()
        bakis_testi_yaz(con, "D1", "s1", 300, "a.json", "ara", None, None)
        bakis_testi_yaz(con, "D1", "s1", 400, "a-2.json", "bitti", 123.4, "E5")
        o = {s["sid"]: s for s in yonetim.ders(con, "D1")["ogrenciler"]}
        self.assertEqual(o["s1"]["bakis"], {"durum": "bitti", "deneme": 2, "gl_acc": 123.4, "model": "E5", "t": 400})
        self.assertEqual(o["s2"]["bakis"]["durum"], "baslamadi")
        self.assertEqual(o["s2"]["bakis"]["deneme"], 0)
        den = yonetim.ogrenci(con, "D1", "s1")["bakis_denemeleri"]
        self.assertEqual([d["dosya"] for d in den], ["a.json", "a-2.json"])

    def test_bakis_bitmedi_ve_suruyor(self):
        con = self.kur()
        bakis_testi_yaz(con, "D1", "s1", 300, "b.json", "bitti", 50.0, None)
        bakis_testi_yaz(con, "D1", "s2", 300, "c.json", "ara", None, None)
        o = {s["sid"]: s for s in yonetim.ders(con, "D1")["ogrenciler"]}
        self.assertEqual(o["s1"]["bakis"]["durum"], "bitmedi")
        self.assertEqual(o["s2"]["bakis"]["durum"], "suruyor")

    def test_cihaz_ozet_cihaz2den(self):
        s = {"tarayici": "Chrome 120.0.1", "kamera": "1280x720", "fps": 30, "islemeFps": 25, "isci": True,
             "cihaz2": {"cekirdek": 8, "bellekGB": 8, "gpu": "RTX", "ua": "Mozilla Windows NT 10.0",
                        "uaVeri": {"platform": "Windows"}}}
        c = yonetim.cihaz_ozet(s)
        self.assertEqual((c["tarayici"], c["tarayiciSurum"], c["isletimSistemi"]), ("Chrome", "120.0.1", "Windows"))
        self.assertEqual((c["cekirdek"], c["bellekGB"], c["gpu"]), (8, 8, "RTX"))
        self.assertEqual((c["kameraCozunurluk"], c["kameraFpsAyar"], c["islemeFps"], c["isci"]), ("1280x720", 30, 25, True))
        self.assertIsNone(c["kameraFpsOlculen"])
        self.assertIsNone(c["delegate"])

    def test_cihaz_ozet_varsa_kullanilir(self):
        s = {"cihaz2": {"cekirdek": 4}, "cihazOzet": {"cekirdek": 12, "kameraFpsOlculen": 27.5}}
        c = yonetim.cihaz_ozet(s)
        self.assertEqual((c["cekirdek"], c["kameraFpsOlculen"]), (12, 27.5))

    def test_cihaz_tam_alanlari(self):
        tam = {"islemci": {"mantiksalCekirdek": 16}, "gpu": {"webglRenderer": "ANGLE X", "webglVendor": "Google"},
               "kamera": {"label": "Cam", "ayar": {"width": 640, "height": 480, "frameRate": 30}},
               "diger": {"mediapipeDelegate": "GPU", "isci": False}}
        c = yonetim.cihaz_ozet({"cihazTam": tam})
        self.assertEqual((c["cekirdek"], c["gpu"], c["kamera"], c["kameraCozunurluk"], c["kameraFpsAyar"]),
                         (16, "ANGLE X", "Cam", "640x480", 30))
        self.assertEqual((c["delegate"], c["isci"]), ("GPU", False))

    def test_kurulum_yoksa_none(self):
        con = self.kur()
        o = {s["sid"]: s for s in yonetim.ders(con, "D1")["ogrenciler"]}
        self.assertIsNone(o["s1"]["cihaz"])
        self.assertIsNone(yonetim.ogrenci(con, "D1", "s1")["cihaz"])
        self.assertIsNone(yonetim.ogrenci(con, "D1", "s1")["cihaz_tam"])
        self.assertIsNone(yonetim.cihaz_ozet(None))

    def test_bozuk_bicim_cokmez(self):
        con = self.kur()
        for kötü in ("x", [1], 5, None, {"cihazTam": {"gpu": "x"}}, {"cihazTam": {"islemci": 3, "kamera": {"ayar": []}}},
                     {"cihaz2": "x", "cihazOzet": [1]}, {"cihaz2": {"uaVeri": "x"}}, {"cihazOzet": {"gpu": {"a": 1}}}):
            c = yonetim.cihaz_ozet(kötü)
            self.assertTrue(c is None or isinstance(c, dict))
            yonetim.cihaz_tam(kötü)
        kurulum_ekle(con, "D1", "s1", 110, {"cihazTam": {"gpu": "x", "kamera": [], "islemci": "y"}, "cihaz2": 7})
        self.assertEqual(len(yonetim.ders(con, "D1")["ogrenciler"]), 2)
        self.assertIsNotNone(yonetim.ogrenci(con, "D1", "s1"))
        self.assertEqual(len(yonetim.cihazlar(con)), 3)

    def test_cihazlar_tum_dersler(self):
        con = self.kur()
        kurulum_ekle(con, "D1", "s1", 110, {"tarayici": "Edge 1.2", "cihaz2": {"cekirdek": 4}})
        kurulum_ekle(con, "D2", "s3", 210, {"tarayici": "Chrome 9", "kamera": "640x480"})
        liste = yonetim.cihazlar(con)
        self.assertEqual({(r["code"], r["sid"]) for r in liste}, {("D1", "s1"), ("D1", "s2"), ("D2", "s3")})
        r = {x["sid"]: x for x in liste}
        self.assertEqual(r["s1"]["cihaz"]["cekirdek"], 4)
        self.assertEqual(r["s3"]["cihaz"]["kameraCozunurluk"], "640x480")
        self.assertIsNone(r["s2"]["cihaz"])
        self.assertEqual(r["s3"]["ders"], "Ders2")


if __name__ == "__main__":
    unittest.main()

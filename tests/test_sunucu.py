import json
import os
import struct
import shutil
import tempfile
import threading
import unittest
import unittest.mock
import urllib.request
import zlib
from http.server import ThreadingHTTPServer

import kayit
import server


def basla():
    """Test sunucusu: bellek içi kayıt, geçici DATA. (base_url, kapat) döner."""
    eski_data = server.DATA
    gecici = tempfile.mkdtemp()
    server.DATA = gecici
    server.KAYIT = kayit.ac(":memory:")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def kapat():
        httpd.shutdown()
        httpd.server_close()
        server.DATA = eski_data
        shutil.rmtree(gecici, ignore_errors=True)
    return "http://127.0.0.1:%d" % httpd.server_address[1], kapat


def post(base, yol, govde):
    r = urllib.request.Request(base + yol, json.dumps(govde).encode(),
                               {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r) as f:
            return f.status, json.loads(f.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class SunucuKayit(unittest.TestCase):
    def setUp(self):
        self.base, self.kapat = basla()
        self.addCleanup(self.kapat)

    def ders(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        return r["code"], r["key"]

    def test_ders_olusunca_kayda_girer(self):
        kod, _ = self.ders()
        self.assertIsNotNone(server.KAYIT.execute(
            "SELECT 1 FROM lessons WHERE code=?", (kod,)).fetchone())

    def test_join_pcode_saklanir(self):
        kayit.katilimci_ekle(server.KAYIT, "P01")
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "p01"})
        self.assertNotIn("kodBilinmiyor", r)
        row = server.KAYIT.execute("SELECT participant_code FROM students WHERE sid=?",
                                   (r["sid"],)).fetchone()
        self.assertEqual(row[0], "P01")

    def test_join_bilinmeyen_kod_uyari(self):
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "X9"})
        self.assertTrue(r["kodBilinmiyor"])
        self.assertEqual(server.KAYIT.execute(
            "SELECT COUNT(*) FROM students").fetchone()[0], 1)

    def test_gecersiz_kod_400(self):
        kod, _ = self.ders()
        st, _ = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "a b!"})
        self.assertEqual(st, 400)

    def test_yeniden_katilim_tek_satir(self):
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "X9"})
        post(self.base, "/api/join", {"code": kod, "name": "Ali", "sid": r["sid"], "pcode": "X9"})
        self.assertEqual(server.KAYIT.execute(
            "SELECT COUNT(*) FROM students").fetchone()[0], 1)

    def test_ders_bitince_ended(self):
        kod, key = self.ders()
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "end"})
        self.assertIsNotNone(server.KAYIT.execute(
            "SELECT ended FROM lessons WHERE code=?", (kod,)).fetchone()[0])


def _png():
    def blok(t, d):
        c = zlib.crc32(t + d) & 0xFFFFFFFF
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", c)
    return (b"\x89PNG\r\n\x1a\n" + blok(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + blok(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + blok(b"IEND", b""))


PNG1 = _png()


def ham(base, yol, govde=b"", metod="POST"):
    r = urllib.request.Request(base + yol, govde, method=metod)
    try:
        with urllib.request.urlopen(r) as f:
            return f.status, f.read(), f.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


class SunucuMateryal(unittest.TestCase):
    setUp = SunucuKayit.setUp
    ders = SunucuKayit.ders

    def test_materyal_yukle_png(self):
        kod, key = self.ders()
        st, b, _ = ham(self.base, "/api/material?code=%s&key=%s&name=Slayt&kind=insan" % (kod, key), PNG1)
        self.assertEqual(st, 200)
        mid = json.loads(b)["id"]
        self.assertTrue(os.path.isfile(os.path.join(server.DATA, "materyaller", kod, "%d.png" % mid)))
        st, b, h = ham(self.base, "/api/material/image?code=%s&id=%d&key=%s" % (kod, mid, key), None, "GET")
        self.assertEqual((st, b, h["Content-Type"]), (200, PNG1, "image/png"))
        st, b, _ = ham(self.base, "/api/materials?code=%s&key=%s" % (kod, key), None, "GET")
        r = json.loads(b)
        self.assertEqual(r["materials"][0]["hasImage"], True)
        self.assertIsNone(r["active"])

    def test_materyal_gorselsiz(self):
        kod, key = self.ders()
        st, b, _ = ham(self.base, "/api/material?code=%s&key=%s&name=X&kind=diger" % (kod, key), b"")
        self.assertEqual(st, 200)
        _, b, _ = ham(self.base, "/api/materials?code=%s&key=%s" % (kod, key), None, "GET")
        self.assertFalse(json.loads(b)["materials"][0]["hasImage"])

    def test_materyal_yukle_reddeder(self):
        kod, key = self.ders()
        q = "/api/material?code=" + kod + "&key=%s&name=S&kind=%s"
        self.assertEqual(ham(self.base, q % ("yanlis", "insan"), PNG1)[0], 403)
        self.assertEqual(ham(self.base, q % (key, "foo"), PNG1)[0], 400)
        self.assertEqual(ham(self.base, q % (key, "insan"), b"merhaba")[0], 415)
        self.assertEqual(ham(self.base, "/api/material?code=ZZZZ&key=a&name=S&kind=yz", PNG1)[0], 404)

    def test_materyal_sec_olayi(self):
        kod, key = self.ders()
        _, b, _ = ham(self.base, "/api/material?code=%s&key=%s&name=S&kind=yz" % (kod, key), b"")
        mid = json.loads(b)["id"]
        st, _ = post(self.base, "/api/event", {"code": kod, "key": key, "type": "material", "id": mid})
        self.assertEqual(st, 200)
        self.assertEqual(kayit.aktif_materyal(server.KAYIT, kod), mid)
        _, b, _ = ham(self.base, "/api/materials?code=%s&key=%s" % (kod, key), None, "GET")
        self.assertEqual(json.loads(b)["active"], mid)
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "material", "id": None})
        self.assertIsNone(kayit.aktif_materyal(server.KAYIT, kod))
        st, _ = post(self.base, "/api/event", {"code": kod, "key": key, "type": "material", "id": 9999})
        self.assertEqual(st, 400)

class SunucuOrnek(unittest.TestCase):
    setUp = SunucuKayit.setUp
    ders = SunucuKayit.ders

    def ogrenci(self):
        kod, key = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali"})
        return kod, key, r["sid"]

    def metrik(self, kod, sid, **ek):
        b = {"code": kod, "sid": sid, "attention": 80, "energy": 70, "emotion": "notr", "face": True}
        b.update(ek)
        return post(self.base, "/api/metrics", b)

    def test_metrics_ornek_yazar(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, gaze={"cal": True, "share": {"materyal": 1}, "pts": [[.5, .5]],
                                    "scr": [[-100, .4, .6]]})
        rows = server.KAYIT.execute("SELECT * FROM samples").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["gaze"]), [[-100, 0.4, 0.6]])
        self.assertEqual(rows[0]["gaze_cal"], 1)
        self.assertEqual(rows[0]["coarse"], 0)

    def test_metrics_coarse_bakis_saklamaz(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, gaze={"cal": False, "coarse": True, "share": {"disari": .2},
                                    "scr": [[-100, .4, .6]], "pts": [[.1, .1]]})
        r = server.KAYIT.execute("SELECT * FROM samples").fetchone()
        self.assertEqual(r["gaze_cal"], 0)
        self.assertEqual(r["coarse"], 1)
        self.assertIsNone(r["gaze"])
        self.assertIsNone(r["mat_pts"])
        self.assertEqual(json.loads(r["share"]), {"disari": 0.2})

    def test_metrics_kalibresiz_bakis_saklamaz(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, gaze={"cal": False})
        r = server.KAYIT.execute("SELECT * FROM samples").fetchone()
        self.assertEqual((r["gaze_cal"], r["coarse"]), (0, 0))
        self.assertIsNone(r["gaze"])

    def test_scr_dogrulanir(self):
        g = server.parse_gaze({"cal": True, "scr": [[-5, 9, -9]] + [[0, .5, .5]] * 60 + ["x", [1]]})
        self.assertEqual(len(g["scr"]), 40)
        self.assertEqual(g["scr"][0], [-5, 1.2, -0.2])

    def test_metrics_kurulum_ve_kal_tekil(self):
        kod, _, sid = self.ogrenci()
        k = {"kamera": "640x480", "fps": 30, "ekran": "1920x1080", "dpr": 1, "fs": False,
             "tarayici": "Chrome 120", "uzaklikCm": 55, "islemeFps": None}
        for _i in range(2):
            self.metrik(kod, sid, kurulum=k, kal={"at": 123.5, "hit3": 90})
        self.assertEqual(server.KAYIT.execute("SELECT COUNT(*) FROM setups").fetchone()[0], 1)
        self.assertEqual(server.KAYIT.execute("SELECT COUNT(*) FROM calibrations").fetchone()[0], 1)

    def test_kurulum_kirpilir(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, kurulum={"kamera": "x" * 100, "dpr": 999, "ayrik": 1})
        s = json.loads(server.KAYIT.execute("SELECT setup FROM setups").fetchone()[0])
        self.assertEqual(len(s["kamera"]), 40)
        self.assertLessEqual(s["dpr"], 8)
        self.assertNotIn("ayrik", s)

    def test_olaylar_kaydedilir(self):
        kod, key, sid = self.ogrenci()
        post(self.base, "/api/event", {"code": kod, "sid": sid, "type": "chat", "text": "merhaba"})
        post(self.base, "/api/event", {"code": kod, "sid": sid, "type": "hand", "up": True})
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "chat", "text": "hoş"})
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "lower_hand", "id": sid})
        post(self.base, "/api/event", {"code": kod, "sid": sid, "type": "reaction", "emoji": "👍"})
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "topic", "topic": "Yeni"})
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "end"})
        rows = server.KAYIT.execute("SELECT kind, sid FROM events ORDER BY rowid").fetchall()
        self.assertEqual([tuple(r) for r in rows], [
            ("chat", sid), ("hand", sid), ("chat", None), ("lower_hand", sid),
            ("reaction", sid), ("topic", None), ("end", None)])

    def test_uyari_gercek_yazilir_demo_yazilmaz(self):
        kod, _, _ = self.ogrenci()
        cls = server.CLASSES[kod]
        server.add_alert(cls, "attention", "A düşük", "k1", 1000, demo=False)
        server.add_alert(cls, "attention", "D düşük", "k2", 1000, demo=True)
        rows = server.KAYIT.execute("SELECT kind, data FROM events").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "alert")
        self.assertEqual(json.loads(rows[0][1]), {"kind": "attention", "text": "A düşük"})

    def test_demo_olaylari_yazilmaz(self):
        kod, key, _ = self.ogrenci()
        cls = server.CLASSES[kod]
        cls["students"]["d1"] = server.make_student("d1", "Demo", demo=True)
        cls["students"]["d1"]["sim"] = server.make_sim()
        cls["students"]["d1"]["hand"] = True
        post(self.base, "/api/event", {"code": kod, "key": key, "type": "lower_hand", "id": "d1"})
        with server.LOCK:
            with unittest.mock.patch.object(server.random, "random", return_value=0.0):
                server.simulate_demo(cls, server.now())
        self.assertEqual(server.KAYIT.execute(
            "SELECT COUNT(*) FROM events WHERE sid='d1'").fetchone()[0], 0)

    def test_restore_ogrenciyi_kayda_yazar(self):
        cls = {"code": "RST1", "name": "R", "topic": "", "created": server.now(), "ended": None,
               "students": {"s_1": server.make_student("s_1", "Ali"),
                            "s_d": server.make_student("s_d", "Demo", demo=True)},
               "timeline": [], "chat": [], "alerts": [], "alert_marks": {}, "announce": None,
               "reaction_counts": {}, "topic_log": []}
        with open(os.path.join(server.DATA, "RST1.json"), "w", encoding="utf-8") as f:
            json.dump(cls, f)
        server.CLASSES.pop("RST1", None)
        server.restore_active()
        self.addCleanup(server.CLASSES.pop, "RST1", None)
        self.assertEqual(server.KAYIT.execute("SELECT COUNT(*) FROM lessons WHERE code='RST1'").fetchone()[0], 1)
        sids = [r[0] for r in server.KAYIT.execute("SELECT sid FROM students WHERE lesson_code='RST1'")]
        self.assertEqual(sids, ["s_1"])



if __name__ == "__main__":
    unittest.main()

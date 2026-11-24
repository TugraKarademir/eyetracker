import contextlib
import io
import json
import subprocess
import sys
import os
import struct
import shutil
import sqlite3
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
    """Test sunucusu: geçici DATA ve içinde dersler.db (yönetim okumaları dosyayı salt okunur açar).
    Gerçek data/ klasörüne dokunmaz. (base_url, kapat) döner."""
    eski_data = server.DATA
    gecici = tempfile.mkdtemp()
    server.DATA = gecici
    server.KAYIT = kayit.ac(os.path.join(gecici, "dersler.db"))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def kapat():
        httpd.shutdown()
        httpd.server_close()
        server.KAYIT.close()
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

    def test_restore_katilimci_kodunu_korur(self):
        kayit.katilimci_ekle(server.KAYIT, "P01")
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "P01"})
        joined = server.KAYIT.execute("SELECT joined FROM students WHERE sid=?", (r["sid"],)).fetchone()[0]
        with server.LOCK:
            server.persist(server.CLASSES[kod])
        server.CLASSES.pop(kod)
        self.addCleanup(server.CLASSES.pop, kod, None)
        server.restore_active()
        row = server.KAYIT.execute("SELECT participant_code, joined FROM students WHERE sid=?",
                                   (r["sid"],)).fetchone()
        self.assertEqual(tuple(row), ("P01", joined))

    def test_restore_eski_json_kodu_silmez(self):
        # pcode alanı olmayan (düzeltmeden önceki) JSON: kayıttaki kod korunur
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali", "pcode": "P02"})
        with server.LOCK:
            del server.CLASSES[kod]["students"][r["sid"]]["pcode"]
            server.persist(server.CLASSES[kod])
        server.CLASSES.pop(kod)
        self.addCleanup(server.CLASSES.pop, kod, None)
        server.restore_active()
        self.assertEqual(server.KAYIT.execute("SELECT participant_code FROM students WHERE sid=?",
                                              (r["sid"],)).fetchone()[0], "P02")

    def test_yeniden_katilim_eksik_kodu_doldurur(self):
        kayit.katilimci_ekle(server.KAYIT, "P05")
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"code": kod, "name": "Ali"})
        joined = server.KAYIT.execute("SELECT joined FROM students WHERE sid=?", (r["sid"],)).fetchone()[0]
        _, r2 = post(self.base, "/api/join", {"code": kod, "name": "Ali", "sid": r["sid"], "pcode": "p05"})
        self.assertEqual(r2["sid"], r["sid"])
        self.assertNotIn("kodBilinmiyor", r2)
        row = server.KAYIT.execute("SELECT participant_code, joined FROM students WHERE sid=?",
                                   (r["sid"],)).fetchone()
        self.assertEqual(tuple(row), ("P05", joined))
        self.assertEqual(server.CLASSES[kod]["students"][r["sid"]]["pcode"], "P05")
        # kodsuz yeniden katılım kodu silmez; bilinmeyen kod uyarı verir
        post(self.base, "/api/join", {"code": kod, "name": "Ali", "sid": r["sid"]})
        self.assertEqual(server.KAYIT.execute("SELECT participant_code FROM students WHERE sid=?",
                                              (r["sid"],)).fetchone()[0], "P05")
        _, r3 = post(self.base, "/api/join", {"code": kod, "name": "Ali", "sid": r["sid"], "pcode": "ZZ9"})
        self.assertTrue(r3["kodBilinmiyor"])

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

    def test_materyal_gorseli_lock_disinda_okunur(self):
        kod, key = self.ders()
        _, b, _ = ham(self.base, "/api/material?code=%s&key=%s&name=S&kind=insan" % (kod, key), PNG1)
        mid = json.loads(b)["id"]
        gercek, kilitli = open, []

        def izle(yol, *a, **k):
            if str(yol).endswith("%d.png" % mid):
                kilitli.append(server.LOCK._is_owned())
            return gercek(yol, *a, **k)
        with unittest.mock.patch("builtins.open", izle):
            st, veri, _ = ham(self.base, "/api/material/image?code=%s&id=%d&key=%s" % (kod, mid, key), None, "GET")
        self.assertEqual((st, veri, kilitli), (200, PNG1, [False]))

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

    def test_kurulum_isci_ve_gecikme(self):
        k = server.temiz_kurulum({"isci": True, "gecikmeMs": 99999, "islemeFps": 27.5})
        self.assertEqual((k["isci"], k["gecikmeMs"], k["islemeFps"]), (True, 60000, 27.5))
        k = server.temiz_kurulum({"isci": "evet", "gecikmeMs": True})
        self.assertEqual((k["isci"], k["gecikmeMs"]), (None, None))   # bool değilse / sayı değilse yok
        k = server.temiz_kurulum({"isci": False, "gecikmeMs": -5})
        self.assertEqual((k["isci"], k["gecikmeMs"]), (False, 0))
        self.assertIsNone(server.temiz_kurulum({})["isci"])
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, kurulum={"isci": True, "gecikmeMs": 40})
        s = json.loads(server.KAYIT.execute("SELECT setup FROM setups").fetchone()[0])
        self.assertEqual((s["isci"], s["gecikmeMs"]), (True, 40))

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


class SunucuYonetim(unittest.TestCase):
    ANAHTAR = "test-anahtar"

    def setUp(self):
        self.base, self.kapat = basla()
        self.addCleanup(self.kapat)
        p = unittest.mock.patch.dict(os.environ, {"DERSNABZI_ADMIN_KEY": self.ANAHTAR})
        p.start()
        self.addCleanup(p.stop)
        server._ADMIN_KEY = None
        self.addCleanup(setattr, server, "_ADMIN_KEY", None)

    def get(self, yol, anahtar=ANAHTAR):
        r = urllib.request.Request(self.base + yol, headers={"X-Admin-Key": anahtar} if anahtar else {})
        try:
            with urllib.request.urlopen(r) as f:
                return f.status, f.read(), f.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def test_admin_anahtarsiz_403(self):
        self.assertEqual(self.get("/api/admin/dersler", None)[0], 403)
        self.assertEqual(self.get("/api/admin/dersler", "yanlis")[0], 403)
        st, b = post(self.base, "/api/admin/katilimci", {"kod": "P01"})
        self.assertEqual((st, b["error"]), (403, "Yetkisiz"))

    def test_admin_yerel_olmayan_403(self):
        h = object.__new__(server.Handler)
        h.headers = {"X-Admin-Key": self.ANAHTAR}
        h.client_address = ("192.168.1.5", 5555)
        self.assertFalse(h.admin_ok({}))
        h.client_address = ("127.0.0.1", 5555)
        self.assertTrue(h.admin_ok({}))
        h.headers = {"X-Admin-Key": self.ANAHTAR, "X-Forwarded-For": "127.0.0.1"}
        h.client_address = ("192.168.1.5", 5555)
        self.assertFalse(h.admin_ok({}))
        h.client_address = ("::ffff:127.0.0.1", 5555)
        self.assertFalse(h.admin_ok({}))
        h.client_address = ("127.0.0.1", 5555)
        h.headers = {}
        self.assertFalse(h.admin_ok({"admin": "x"}))
        self.assertTrue(h.admin_ok({"admin": self.ANAHTAR}))
        self.assertFalse(h.admin_ok({}))

    def test_admin_dersler_200(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        st, b, _ = self.get("/api/admin/dersler")
        self.assertEqual(st, 200)
        self.assertEqual([d["code"] for d in json.loads(b)], [r["code"]])

    def test_admin_404_ve_400(self):
        self.assertEqual(self.get("/api/admin/ders?code=ZZZZ")[0], 404)
        self.assertEqual(self.get("/api/admin/ogrenci?code=ZZZZ&sid=x")[0], 404)
        self.assertEqual(self.get("/api/admin/csv?tur=ham")[0], 400)
        st, b = post(self.base, "/api/admin/katilimci", {"kod": "!!"})
        self.assertEqual(st, 403)

    def test_admin_katilimci_ekle(self):
        r = urllib.request.Request(self.base + "/api/admin/katilimci", json.dumps({"kod": "P07"}).encode(),
                                   {"Content-Type": "application/json", "X-Admin-Key": self.ANAHTAR})
        with urllib.request.urlopen(r) as f:
            self.assertEqual(json.loads(f.read())["kod"], "P07")
        r = urllib.request.Request(self.base + "/api/admin/katilimci", json.dumps({"kod": "!!"}).encode(),
                                   {"Content-Type": "application/json", "X-Admin-Key": self.ANAHTAR})
        with self.assertRaises(urllib.error.HTTPError) as c:
            urllib.request.urlopen(r)
        self.assertEqual(c.exception.code, 400)
        st, b, _ = self.get("/api/admin/katilimcilar")
        self.assertEqual(st, 200)
        self.assertIn("P07", b.decode())

    def test_admin_csv_bom(self):
        st, b, h = self.get("/api/admin/csv?tur=uzun")
        self.assertEqual(st, 200)
        self.assertTrue(b.startswith("﻿".encode("utf-8")))
        self.assertEqual(h["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn('filename="dersnabzi_uzun.csv"', h["Content-Disposition"])

    def test_admin_okuma_lock_beklemez(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        sonuc = {}

        def oku():
            sonuc["st"] = self.get("/api/admin/dersler")[0]
            sonuc["ders"] = self.get("/api/admin/ders?code=" + r["code"])[0]
            sonuc["csv"] = self.get("/api/admin/csv?tur=uzun")[0]
        with server.LOCK:   # canlı ders kilidi başka iş parçacığında tutuluyor
            th = threading.Thread(target=oku)
            th.start()
            th.join(5)
            self.assertFalse(th.is_alive(), "yönetim okuması LOCK'u bekledi")
        self.assertEqual(sonuc, {"st": 200, "ders": 200, "csv": 200})

    def test_admin_okuma_baglantisi_salt_okunur(self):
        con = server.kayit_okuma()
        self.addCleanup(con.close)
        with self.assertRaises(sqlite3.OperationalError):
            con.execute("INSERT INTO participants VALUES('X', 1)")
        self.assertEqual(server.KAYIT.execute("PRAGMA journal_mode").fetchone()[0], "wal")

    def test_admin_kalite_esik(self):
        st, b, _ = self.get("/api/admin/kalite_esik")
        self.assertEqual((st, "iyi" in json.loads(b)), (200, True))

    def test_yonetici_anahtari_uretilir_ve_kalir(self):
        with unittest.mock.patch.dict(os.environ, {"DERSNABZI_ADMIN_KEY": ""}):
            server._ADMIN_KEY = None
            k = server.yonetici_anahtari()
            with open(os.path.join(server.DATA, "yonetici_anahtari.txt"), encoding="utf-8") as f:
                self.assertEqual(f.read().strip(), k)
            server._ADMIN_KEY = None
            self.assertEqual(server.yonetici_anahtari(), k)

    def test_gorsel_yonetici_anahtariyla(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        kod, key = r["code"], r["key"]
        _, b, _ = ham(self.base, "/api/material?code=%s&key=%s&name=S&kind=insan" % (kod, key), PNG1)
        mid = json.loads(b)["id"]
        yol = "/api/material/image?code=%s&id=%d" % (kod, mid)
        self.assertEqual(ham(self.base, yol, None, "GET")[0], 403)
        self.assertEqual(ham(self.base, yol + "&admin=yanlis", None, "GET")[0], 403)
        st, b, _ = ham(self.base, yol + "&admin=" + self.ANAHTAR, None, "GET")
        self.assertEqual((st, b), (200, PNG1))


class SaglikVeVeriKlasoru(unittest.TestCase):
    def test_saglik_200(self):
        base, kapat = basla()
        self.addCleanup(kapat)
        with urllib.request.urlopen(base + "/api/saglik") as f:
            self.assertEqual(f.status, 200)
            self.assertEqual(json.loads(f.read()), {"ok": True, "surum": 1})

    def test_paketli_sunucu_yollari(self):
        """PyInstaller (frozen): static/ paketin içinden (sys._MEIPASS), veri yalnız DERSNABZI_DATA'dan."""
        kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        paket = tempfile.mkdtemp()
        veri = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, paket, True)
        self.addCleanup(shutil.rmtree, veri, True)
        kod = ("import sys; sys.frozen = True; sys._MEIPASS = %r; import server; "
               "print(server.STATIC); print(server.DATA); server.KAYIT.close()") % paket
        ortam = dict(os.environ, DERSNABZI_DATA=veri, DERSNABZI_ADMIN_KEY="")
        r = subprocess.run([sys.executable, "-c", kod], cwd=kok, env=ortam, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        satir = r.stdout.strip().splitlines()[-2:]
        self.assertEqual(satir, [os.path.join(paket, "static"), os.path.abspath(veri)])
        self.assertFalse(os.path.exists(os.path.join(paket, "data")))
        ortam.pop("DERSNABZI_DATA")
        r = subprocess.run([sys.executable, "-c", kod], cwd=kok, env=ortam, capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("DERSNABZI_DATA", r.stderr)
        self.assertEqual(os.listdir(paket), [])

    def test_saglik_oturum_yankisi(self):
        base, kapat = basla()
        self.addCleanup(kapat)
        with unittest.mock.patch.dict(os.environ, {"DERSNABZI_OTURUM": "abc123-oturum"}):
            with urllib.request.urlopen(base + "/api/saglik") as f:
                self.assertEqual(json.loads(f.read()), {"ok": True, "surum": 1, "oturum": "abc123-oturum"})

    def test_data_argumani(self):
        eski = (server.DATA, server.KAYIT, server._ADMIN_KEY)
        gecici = tempfile.mkdtemp()
        yeni = os.path.join(gecici, "alt", "veri")
        def geri():
            server.KAYIT.close()
            server.DATA, server.KAYIT, server._ADMIN_KEY = eski
            shutil.rmtree(gecici, ignore_errors=True)
        self.addCleanup(geri)
        with unittest.mock.patch.dict(os.environ, {"DERSNABZI_ADMIN_KEY": ""}):
            server._ADMIN_KEY = "eski-anahtar"
            eski_td, eski_gl = server.TEST_DIR, server.GL_DB
            self.addCleanup(lambda: (setattr(server, "TEST_DIR", eski_td), setattr(server, "GL_DB", eski_gl)))
            server.veri_klasoru_ayarla(yeni)
            self.assertEqual(server.DATA, os.path.abspath(yeni))
            self.assertTrue(os.path.isdir(yeni))
            kayit.ders_ekle(server.KAYIT, "ABC123", "T", None, 1.0)
            self.assertTrue(os.path.exists(os.path.join(yeni, "dersler.db")))
            with contextlib.redirect_stdout(io.StringIO()) as cikti:
                anahtar = server.yonetici_anahtari()
            self.assertIn(os.path.join(os.path.abspath(yeni), "yonetici_anahtari.txt"), cikti.getvalue())
            self.assertNotEqual(anahtar, "eski-anahtar")
            self.assertEqual(server.TEST_DIR, os.path.join(os.path.abspath(yeni), "test_kayitlari"))
            self.assertEqual(server.GL_DB, os.path.join(server.TEST_DIR, "gazelab.db"))
            with open(os.path.join(yeni, "yonetici_anahtari.txt"), encoding="utf-8") as f:
                self.assertEqual(f.read().strip(), anahtar)


class VeriEnv(unittest.TestCase):
    def test_env_ile_varsayilan_klasor_olusmaz(self):
        kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        veri = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, veri, True)
        yeni = os.path.join(veri, "x")
        env = dict(os.environ, DERSNABZI_DATA=yeni)
        kod = ("import os,server;print(server.DATA);print(server.KAYIT.execute('PRAGMA database_list').fetchone()[2]);"
               "print(server.TEST_DIR);print(server.GL_DB)")
        o = subprocess.run([sys.executable, "-c", kod], cwd=kok, env=env, capture_output=True, text=True, check=True)
        d, db, td, gl = o.stdout.splitlines()[:4]
        self.assertEqual(os.path.normcase(d), os.path.normcase(os.path.abspath(yeni)))
        self.assertEqual(os.path.normcase(db), os.path.normcase(os.path.join(os.path.abspath(yeni), "dersler.db")))
        self.assertEqual(os.path.normcase(td), os.path.normcase(os.path.join(os.path.abspath(yeni), "test_kayitlari")))
        self.assertEqual(os.path.normcase(gl), os.path.normcase(os.path.join(td, "gazelab.db")))
        self.assertTrue(os.path.exists(os.path.join(yeni, "dersler.db")))


class UstSurecIzleme(unittest.TestCase):
    """DERSNABZI_OTURUM varsa stdin kapanınca (Electron öldü) sunucu sonlanır; yoksa etkilenmez."""

    def baslat(self, oturum):
        import socket
        import time
        kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        veri = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, veri, True)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        env = dict(os.environ, DERSNABZI_DATA=veri, PYTHONIOENCODING="utf-8")
        env.pop("DERSNABZI_OTURUM", None)
        if oturum:
            env["DERSNABZI_OTURUM"] = "test-oturum"
        p = subprocess.Popen([sys.executable, os.path.join(kok, "server.py"), "--port", str(port), "--data", veri],
                             cwd=kok, env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        def temizle():
            if p.poll() is None:
                p.kill()
                p.wait(10)
        self.addCleanup(temizle)
        son = time.time() + 20
        while time.time() < son:
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/api/saglik" % port, timeout=1) as f:
                    if f.status == 200:
                        return p
            except Exception:
                time.sleep(0.2)
        self.fail("sunucu başlamadı")

    def test_oturumla_stdin_kapaninca_cikar(self):
        p = self.baslat(oturum=True)
        p.stdin.close()
        self.assertIsNotNone(p.wait(timeout=5))

    def test_oturumsuz_stdin_kapanmasi_etkilemez(self):
        import time
        p = self.baslat(oturum=False)
        p.stdin.close()
        time.sleep(3)
        self.assertIsNone(p.poll())


if __name__ == "__main__":
    unittest.main()

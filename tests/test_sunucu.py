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


ONAY = {"surum": "2026-11-25", "t": 0}   # KVKK onayı: /api/join onaysız 400 döner


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
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "p01"})
        self.assertNotIn("kodBilinmiyor", r)
        row = server.KAYIT.execute("SELECT participant_code FROM students WHERE sid=?",
                                   (r["sid"],)).fetchone()
        self.assertEqual(row[0], "P01")

    def test_join_bilinmeyen_kod_uyari(self):
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "X9"})
        self.assertTrue(r["kodBilinmiyor"])
        self.assertEqual(server.KAYIT.execute(
            "SELECT COUNT(*) FROM students").fetchone()[0], 1)

    def test_gecersiz_kod_400(self):
        kod, _ = self.ders()
        st, _ = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "a b!"})
        self.assertEqual(st, 400)

    def test_yeniden_katilim_tek_satir(self):
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "X9"})
        post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "sid": r["sid"], "pcode": "X9"})
        self.assertEqual(server.KAYIT.execute(
            "SELECT COUNT(*) FROM students").fetchone()[0], 1)

    def test_restore_katilimci_kodunu_korur(self):
        kayit.katilimci_ekle(server.KAYIT, "P01")
        kod, _ = self.ders()
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "P01"})
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
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "P02"})
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
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali"})
        joined = server.KAYIT.execute("SELECT joined FROM students WHERE sid=?", (r["sid"],)).fetchone()[0]
        _, r2 = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "sid": r["sid"], "pcode": "p05"})
        self.assertEqual(r2["sid"], r["sid"])
        self.assertNotIn("kodBilinmiyor", r2)
        row = server.KAYIT.execute("SELECT participant_code, joined FROM students WHERE sid=?",
                                   (r["sid"],)).fetchone()
        self.assertEqual(tuple(row), ("P05", joined))
        self.assertEqual(server.CLASSES[kod]["students"][r["sid"]]["pcode"], "P05")
        # kodsuz yeniden katılım kodu silmez; bilinmeyen kod uyarı verir
        post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "sid": r["sid"]})
        self.assertEqual(server.KAYIT.execute("SELECT participant_code FROM students WHERE sid=?",
                                              (r["sid"],)).fetchone()[0], "P05")
        _, r3 = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "sid": r["sid"], "pcode": "ZZ9"})
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
        _, r = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali"})
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

    def test_metrics_hse_ogretmene_gider(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, hse={"top": "Happiness", "p": 0.62, "valence": 3, "arousal": -0.1})
        s = server.public_student(server.CLASSES[kod]["students"][sid], server.now())
        self.assertEqual(s["hse"], {"top": "Happiness", "p": 0.62, "valence": 1.0, "arousal": -0.1})
        self.metrik(kod, sid, hse={"top": "<script>"})
        self.assertIsNone(server.public_student(server.CLASSES[kod]["students"][sid], server.now())["hse"])

    def test_ogrenci_ayrinti_isi_ve_kalibrasyon(self):
        kod, _, sid = self.ogrenci()
        self.metrik(kod, sid, gaze={"cal": True, "region": "materyal", "share": {"materyal": 1},
                                    "pts": [[.5, .5]], "scr": [[-100, .25, .5], [-50, 1.1, .5]]},
                    kal={"at": 1, "acc": 57.4, "hit3": 100, "aktarim": {"kod": "karmaH", "ad": "karma + baş turu"}})
        d = server.ogrenci_ayrinti(server.CLASSES[kod]["students"][sid], server.now())
        self.assertEqual(d["kal"]["model"], "karma + baş turu")
        self.assertEqual((d["kal"]["acc"], d["kal"]["hit3"]), (57, 100))
        self.assertEqual(d["scrOutPct"], 50)
        self.assertEqual(max(d["scrHeat"]), 100)
        self.assertEqual(d["scrHeat"][9 * server.SX + 8], 100)
        self.assertEqual(len(d["scrSon"]), 2)
        self.assertEqual(max(d["heat"]), 100)

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

    def admin_post(self, yol, govde):
        r = urllib.request.Request(self.base + yol, json.dumps(govde).encode(),
                                   {"Content-Type": "application/json", "X-Admin-Key": self.ANAHTAR})
        try:
            with urllib.request.urlopen(r) as f:
                return f.status, json.loads(f.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_ogretmen_ekle_ders_baglanir_pasif_listede_yok(self):
        self.assertEqual(self.admin_post("/api/admin/ogretmen", {"name": " "})[0], 400)
        self.assertEqual(self.admin_post("/api/admin/ogretmen", {"name": "A", "email": "yok"})[0], 400)
        st, r = self.admin_post("/api/admin/ogretmen", {"name": "Ayşe Öğretmen", "email": "a@okul.tr", "kurum": "Okul"})
        self.assertEqual(st, 200)
        tid = r["id"]
        with urllib.request.urlopen(self.base + "/api/teachers") as f:
            self.assertEqual(json.loads(f.read()), [{"id": tid, "name": "Ayşe Öğretmen"}])
        _, d1 = post(self.base, "/api/class", {"name": "Ders 1", "teacher_id": tid})
        _, d2 = post(self.base, "/api/class", {"name": "Ders 2", "teacher_id": "t_sahte"})
        st, b, _ = self.get("/api/admin/dersler?ogretmen=" + tid)
        self.assertEqual([(d["code"], d["teacher_name"]) for d in json.loads(b)], [(d1["code"], "Ayşe Öğretmen")])
        _, b, _ = self.get("/api/admin/dersler?ogretmen=-")
        self.assertEqual([d["code"] for d in json.loads(b)], [d2["code"]])
        _, b, _ = self.get("/api/admin/ogretmenler")
        t = json.loads(b)[0]
        self.assertEqual((t["n_ders"], t["aktif"], t["kurum"]), (1, 1, "Okul"))
        self.assertEqual(self.admin_post("/api/admin/ogretmen", {"id": tid, "aktif": False})[0], 200)
        self.assertEqual(self.admin_post("/api/admin/ogretmen", {"id": "t_yok", "name": "x"})[0], 404)
        with urllib.request.urlopen(self.base + "/api/teachers") as f:
            self.assertEqual(json.loads(f.read()), [])
        _, d3 = post(self.base, "/api/class", {"name": "Ders 3", "teacher_id": tid})   # pasif öğretmen: bağlanmaz
        _, b, _ = self.get("/api/admin/dersler?ogretmen=-")
        self.assertIn(d3["code"], [d["code"] for d in json.loads(b)])

    def test_kalibrasyonlar_ve_veri_paketi(self):
        _, r = self.admin_post("/api/admin/ogretmen", {"name": "Can"})
        _, d = post(self.base, "/api/class", {"name": "D", "teacher_id": r["id"]})
        _, j = post(self.base, "/api/join", {"onay": ONAY, "code": d["code"], "name": "Öğr"})
        post(self.base, "/api/metrics", {"code": d["code"], "sid": j["sid"], "attention": 50, "energy": 50,
                                         "kal": {"at": 5, "acc": 61, "hit3": 100, "gazelab": {"acc": 48.2},
                                                 "aktarim": {"kod": "karmaH", "ad": "karma + baş turu", "gerekce": "g"}}})
        _, b, _ = self.get("/api/admin/kalibrasyonlar?ogretmen=" + r["id"])
        k = json.loads(b)
        self.assertEqual([(x["ogretmen"], x["ogrenci"], x["model_kod"], x["gl_acc"]) for x in k], [("Can", "Öğr", "karmaH", 48.2)])
        gecici = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, gecici, True)
        with open(os.path.join(gecici, "o.json"), "w", encoding="utf-8") as f:
            json.dump({"log": [{"msg": "AKTARIM", "aktarim": {"kod": "reL", "ad": "RE"}}]}, f)
        with unittest.mock.patch.multiple(server, TEST_DIR=gecici, GL_DB=os.path.join(gecici, "gazelab.db")):
            server.gl_kaydet({"session": {"id": "abcdef12", "status": "completed"},
                              "tablolar": {"yontem": [{"Kod": "karmaH", "Yöntem": "karma", "GL doğruluk px": 48}]}}, "o.json")
            st, b, _ = self.get("/api/admin/bakis_testleri")
            s = json.loads(b)[0]
            self.assertEqual((s["en_iyi"]["kod"], s["aktarim"]["kod"], s["dosya"]), ("karmaH", "reL", "o.json"))
            self.assertEqual(self.get("/api/admin/bakis_dosya?ad=..%2Fserver.py")[0], 404)
            st, b, _ = self.get("/api/admin/bakis_dosya?ad=o.json")
            self.assertEqual((st, json.loads(b)["log"][0]["aktarim"]["kod"]), (200, "reL"))
            st, b, h = self.get("/api/admin/veri_paketi")
            self.assertEqual((st, h["Content-Type"]), (200, "application/zip"))
            import zipfile
            with zipfile.ZipFile(io.BytesIO(b)) as z:
                self.assertTrue({"dersler.db", "gazelab.db", "bakis_testi/o.json", "BENIOKU.txt"} <= set(z.namelist()))
                with tempfile.TemporaryDirectory() as td:
                    z.extract("dersler.db", td)
                    c = sqlite3.connect(os.path.join(td, "dersler.db"))
                    self.assertEqual(c.execute("SELECT name FROM teachers").fetchone()[0], "Can")
                    c.close()
        self.assertEqual(self.get("/api/admin/veri_paketi", None)[0], 403)

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


class IsiTestiKaydi(unittest.TestCase):
    """/api/testlog-isi: ısı testi ham verisi ana test kaydından ayrı dosyaya yazılır."""
    def setUp(self):
        self.base, self.kapat = basla()
        self.addCleanup(self.kapat)
        self.td = tempfile.mkdtemp()
        eski = server.TEST_DIR
        server.TEST_DIR = self.td
        self.addCleanup(lambda: (setattr(server, "TEST_DIR", eski), shutil.rmtree(self.td, ignore_errors=True)))

    def test_gecerli_veri_yazilir(self):
        govde = {"isiKimlik": "20261124_101500_ab12", "veri": {"gorseller": [{"ad": "a", "kareler": [{"t": 1}]}]}}
        kod, r = post(self.base, "/api/testlog-isi", govde)
        self.assertEqual((kod, r["ok"], r["dosya"]), (200, True, "20261124_101500_ab12_isi.json"))
        with open(os.path.join(self.td, r["dosya"]), encoding="utf-8") as f:
            self.assertEqual(json.load(f), govde)

    def test_gecersiz_json_reddedilir(self):
        rq = urllib.request.Request(self.base + "/api/testlog-isi", b"{bozuk", {"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as h:
            urllib.request.urlopen(rq)
        self.assertEqual(h.exception.code, 400)
        kod, _ = post(self.base, "/api/testlog-isi", {"isiKimlik": "abcdefgh12", "veri": []})
        self.assertEqual(kod, 400)
        self.assertEqual(os.listdir(self.td), [])

    def test_fazla_boyut_reddedilir_kirpilmaz(self):
        with unittest.mock.patch.object(server, "ISI_MAX_BYTES", 200):
            kod, r = post(self.base, "/api/testlog-isi", {"isiKimlik": "abcdefgh12", "veri": {"x": "y" * 500}})
        self.assertEqual(kod, 413)
        self.assertIn("çok büyük", r["error"])
        self.assertEqual(os.listdir(self.td), [])
        # ana kaydın 8 MB sınırından büyük ama 64 MB altındaki veri kabul edilir
        kod, _ = post(self.base, "/api/testlog-isi", {"isiKimlik": "abcdefgh12", "veri": {"x": "y" * 9_000_000}})
        self.assertEqual(kod, 200)

    def test_dosya_adi_yol_kacisina_izin_vermez(self):
        for kotu in ("../../evil", "..\evil", "a/b/cccccccc", "abc", "x" * 61, "ab cdefgh1", None, 12345678):
            kod, _ = post(self.base, "/api/testlog-isi", {"isiKimlik": kotu, "veri": {}})
            self.assertEqual(kod, 400, kotu)
        self.assertEqual(os.listdir(self.td), [])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.td), "evil_isi.json")))


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

    def test_ust_surec_oldugunda_borular_da_kapaninca_cikar(self):
        """Electron ölünce stdin/stdout/stderr boruları birlikte kapanır: bekçinin print'i patlasa da süreç çıkmalı."""
        import socket
        import time
        kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        veri = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, veri, True)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        bilgi = os.path.join(veri, "bilgi.txt")
        ust = """
import os, subprocess, sys, time, urllib.request
env = dict(os.environ, DERSNABZI_OTURUM='t', DERSNABZI_DATA=sys.argv[3], PYTHONIOENCODING='utf-8')
p = subprocess.Popen([sys.executable, sys.argv[1], '--port', sys.argv[2], '--data', sys.argv[3]], env=env,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
son = time.time() + 20
while time.time() < son:
    try:
        urllib.request.urlopen('http://127.0.0.1:%s/api/saglik' % sys.argv[2], timeout=1).read()
        break
    except Exception:
        time.sleep(0.2)
else:
    os._exit(3)
open(sys.argv[4], 'w').write(str(p.pid))
os._exit(0)
"""
        r = subprocess.run([sys.executable, "-c", ust, os.path.join(kok, "server.py"), str(port), veri, bilgi],
                           cwd=kok, timeout=40)
        self.assertEqual(r.returncode, 0)
        pid = int(open(bilgi).read())

        def yasiyor():
            if os.name == "nt":
                out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"], capture_output=True, text=True).stdout
                return str(pid) in out
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False

        def temizle():
            if yasiyor():
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
                else:
                    os.kill(pid, 9)
        self.addCleanup(temizle)
        son = time.time() + 10
        while time.time() < son and yasiyor():
            time.sleep(0.2)
        self.assertFalse(yasiyor(), "sunucu yetim kaldı")
        with socket.socket() as s:
            s.bind(("127.0.0.1", port))   # port serbest


class SinifTesti(unittest.TestCase):
    """Sınıf testi (25.11): KVKK onayı, bakış testi kaydının derse bağlanması, ara kaydın üzerine yazılması, cihaz bilgisi."""
    def setUp(self):
        self.base, self.kapat = basla()
        self.addCleanup(self.kapat)
        self.td = tempfile.mkdtemp()
        eski_td, eski_gl = server.TEST_DIR, server.GL_DB
        server.TEST_DIR, server.GL_DB = self.td, os.path.join(self.td, "gazelab.db")
        self.addCleanup(lambda: (setattr(server, "TEST_DIR", eski_td), setattr(server, "GL_DB", eski_gl),
                                 shutil.rmtree(self.td, ignore_errors=True)))

    def ogrenci(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        kod = r["code"]
        _, j = post(self.base, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali"})
        return kod, j["sid"]

    def test_join_onaysiz_400_onayli_200_db(self):
        _, r = post(self.base, "/api/class", {"name": "T"})
        kod = r["code"]
        for onay in (None, {}, {"surum": ""}, "evet", {"t": 5}):
            st, _ = post(self.base, "/api/join", {"code": kod, "name": "Ali", "onay": onay})
            self.assertEqual(st, 400, onay)
        self.assertEqual(server.KAYIT.execute("SELECT COUNT(*) FROM students").fetchone()[0], 0)
        t = server.now() - 5
        st, j = post(self.base, "/api/join", {"code": kod, "name": "Ali", "onay": {"surum": "2026-11-25", "t": t}})
        self.assertEqual(st, 200)
        row = server.KAYIT.execute("SELECT onay_t, onay_surum FROM students WHERE sid=?", (j["sid"],)).fetchone()
        self.assertAlmostEqual(row["onay_t"], t, places=3)
        self.assertEqual(row["onay_surum"], "2026-11-25")
        # saçma istemci saati: sunucu saati yazılır
        st, j2 = post(self.base, "/api/join", {"code": kod, "name": "Veli", "onay": {"surum": "2026-11-25", "t": 12}})
        onay_t = server.KAYIT.execute("SELECT onay_t FROM students WHERE sid=?", (j2["sid"],)).fetchone()[0]
        self.assertLess(abs(onay_t - server.now()), 60)

    def test_testlog_kimlikle_uzerine_yazar(self):
        g = {"kimlik": "20261125_093000_ab12cd", "cihaz": "Windows NT 10.0", "log": [{"msg": "ara"}]}
        _, r1 = post(self.base, "/api/testlog", g)
        _, r2 = post(self.base, "/api/testlog", {**g, "log": [{"msg": "ara"}, {"msg": "son"}], "durum": "bitti"})
        self.assertEqual(r1["dosya"], r2["dosya"])
        self.assertEqual(r1["dosya"], "20261125_093000_Windows-NT-10-0_ab12cd.json")
        dosyalar = [f for f in os.listdir(self.td) if f.endswith(".json")]
        self.assertEqual(dosyalar, [r1["dosya"]])
        with open(os.path.join(self.td, r1["dosya"]), encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["log"]), 2)
        for kotu in ("../../x", "abc", "20261125_093000_a/b", 5):
            st, _ = post(self.base, "/api/testlog", {**g, "kimlik": kotu})
            self.assertEqual(st, 400, kotu)

    def test_testlog_ders_sid_ile_bakis_testleri_satiri(self):
        kod, sid = self.ogrenci()
        g = {"kimlik": "20261125_093000_ab12cd", "cihaz": "Win", "log": [], "ders": kod, "sid": sid, "ad": "Ali"}
        _, r = post(self.base, "/api/testlog", g)
        self.assertEqual(r["dosya"], f"20261125_093000_{kod}_{sid[2:8]}_Win_ab12cd.json")
        rows = server.KAYIT.execute("SELECT * FROM bakis_testleri").fetchall()
        self.assertEqual([(x["lesson_code"], x["sid"], x["dosya"], x["durum"]) for x in rows], [(kod, sid, r["dosya"], "ara")])
        s = server.public_student(server.CLASSES[kod]["students"][sid], server.now())
        self.assertEqual(s["bakisTesti"]["durum"], "suruyor")
        post(self.base, "/api/testlog", {**g, "durum": "bitti", "glAcc": 84.26, "model": "karma + baş turu"})
        rows = server.KAYIT.execute("SELECT * FROM bakis_testleri").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["durum"], rows[0]["gl_acc"], rows[0]["model"]), ("bitti", 84.3, "karma + baş turu"))
        s = server.public_student(server.CLASSES[kod]["students"][sid], server.now())
        self.assertEqual((s["bakisTesti"]["durum"], s["bakisTesti"]["glAcc"]), ("bitti", 84.3))
        # bitti ama model aktarılamadı (yetersiz ölçüm): panelde "bitmedi"
        post(self.base, "/api/testlog", {**g, "kimlik": "20261125_094000_ffff01", "durum": "bitti", "model": None})
        s = server.public_student(server.CLASSES[kod]["students"][sid], server.now())
        self.assertEqual(s["bakisTesti"]["durum"], "bitmedi")

    def test_gec_kalan_ara_kayit_son_kaydi_ezmez(self):
        kod, sid = self.ogrenci()
        g = {"kimlik": "20261125_100000_cd34ef", "cihaz": "Win", "ders": kod, "sid": sid, "ad": "Ali"}
        son = {**g, "log": [{"msg": str(i)} for i in range(5)], "durum": "bitti", "glAcc": 90, "model": "karma"}
        _, r = post(self.base, "/api/testlog", son)
        # geç kalan ara kayıt: daha kısa günlük, durum yok
        st, r2 = post(self.base, "/api/testlog", {**g, "log": [{"msg": "0"}]})
        self.assertEqual((st, r2["dosya"], r2.get("atlandi")), (200, r["dosya"], True))
        # daha uzun ama durumsuz (bitti'den ara'ya dönüş) de yazılmaz
        _, r3 = post(self.base, "/api/testlog", {**g, "log": [{"msg": "x"}] * 9})
        self.assertTrue(r3.get("atlandi"))
        with open(os.path.join(self.td, r["dosya"]), encoding="utf-8") as f:
            d = json.load(f)
        self.assertEqual((len(d["log"]), d["durum"]), (5, "bitti"))
        row = server.KAYIT.execute("SELECT durum, gl_acc, model FROM bakis_testleri").fetchone()
        self.assertEqual(tuple(row), ("bitti", 90.0, "karma"))
        self.assertEqual(server.CLASSES[kod]["students"][sid]["bakis"]["durum"], "bitti")
        self.assertFalse([f for f in os.listdir(self.td) if f.endswith(".tmp")])
        # sunucu yeniden başladı (bellek boş): diskteki dosyadan anlaşılır
        server.TESTLOG_SON.clear()
        _, r4 = post(self.base, "/api/testlog", {**g, "log": [{"msg": "0"}]})
        self.assertTrue(r4.get("atlandi"))
        # bitti'den sonra daha uzun bitti kaydı yazılır
        _, r5 = post(self.base, "/api/testlog", {**son, "log": son["log"] + [{"msg": "ek"}]})
        self.assertNotIn("atlandi", r5)

    def test_bakis_testi_satiri_bittiden_araya_donmez(self):
        con = server.KAYIT
        kayit.bakis_testi_yaz(con, "D", "s_1", 1, "a.json", "bitti", 80.0, "karma")
        kayit.bakis_testi_yaz(con, "D", "s_1", 2, "a.json", "ara", None, None)
        self.assertEqual(tuple(con.execute("SELECT durum, gl_acc, model FROM bakis_testleri").fetchone()), ("bitti", 80.0, "karma"))

    def test_gecersiz_ders_etiketlenmez_ama_kaydedilir(self):
        kod, sid = self.ogrenci()
        for ders, s in (("YOKKOD", sid), (kod, "s_000000000000"), ("../x", sid), (kod, "../../a")):
            st, r = post(self.base, "/api/testlog", {"cihaz": "Win", "log": [], "ders": ders, "sid": s})
            self.assertEqual(st, 200)
            self.assertNotIn(kod, r["dosya"])
            with open(os.path.join(self.td, r["dosya"]), encoding="utf-8") as f:
                self.assertFalse(json.load(f)["dersBagli"])
        self.assertEqual(server.KAYIT.execute("SELECT COUNT(*) FROM bakis_testleri").fetchone()[0], 0)

    def test_test_kaydi_cihaz_tam_ve_ozet(self):
        tam = ornek_cihaz_tam()
        tam["fazla"] = 1
        st, r = post(self.base, "/api/testlog", {"cihaz": "Win", "log": [], "cihazTam": tam, "gazelab": {
            "session": {"id": "kayit123", "device": {"ua": "u", "cihazTam": tam, "cihazOzet": {"sahte": 1}}},
            "tablolar": {"asama": [{"Aşama": "a", "Kamera fps (gerçek)": 30, "İşleme fps": 12}]}}})
        self.assertEqual(st, 200)
        with open(os.path.join(self.td, r["dosya"]), encoding="utf-8") as f:
            j = json.load(f)
        self.assertNotIn("fazla", j["cihazTam"])
        self.assertEqual((j["cihazOzet"]["tarayici"], j["cihazOzet"]["cekirdek"]), ("Chrome", 4))
        self.assertEqual(j["cihazOzet"]["kameraFpsOlculen"], 30)   # ölçülen: aşama tablosundan
        gd = j["gazelab"]["session"]["device"]
        self.assertEqual(gd["ua"], "u")
        self.assertNotIn("fazla", gd["cihazTam"])   # dosyadaki GazeLab kopyası da temiz
        self.assertNotIn("sahte", gd["cihazOzet"])
        self.assertEqual(r["cihazOzet"]["cekirdek"], 4)   # yanıtta özet (yerel yedek CSV'si için)
        # aşama tablosu yoksa ölçülen yok
        st, r = post(self.base, "/api/testlog", {"cihaz": "Win", "log": [], "cihazTam": tam})
        self.assertIsNone(r["cihazOzet"]["kameraFpsOlculen"])

    def test_kurulum_cihaz2_sinirlanir(self):
        k = server.temiz_kurulum({"tarayici": "Chrome 131", "cihaz2": {
            "cekirdek": 99999, "bellekGB": True, "gpu": "G" * 500, "ua": "U" * 900,
            "uaVeri": {"brands": [{"brand": "B" * 99, "version": "1"}] * 20, "platform": "Windows", "mobile": "x"}}})
        c = k["cihaz2"]
        self.assertEqual(c["cekirdek"], 1024)
        self.assertIsNone(c["bellekGB"])
        self.assertEqual((len(c["gpu"]), len(c["ua"])), (120, 300))
        self.assertEqual(len(c["uaVeri"]["brands"]), 6)
        self.assertEqual(len(c["uaVeri"]["brands"][0]["brand"]), 40)
        self.assertIsNone(c["uaVeri"]["mobile"])
        self.assertEqual(server.cihaz_ozet(k), {"tarayici": "Chrome 131", "cekirdek": 1024, "gpu": "G" * 120, "isletimSistemi": None,
                                                "bellekGB": None, "kamera": None, "kameraCozunurluk": None, "kameraFps": None,
                                                "islemeFps": None})
        bos = server.temiz_kurulum({"cihaz2": {"cekirdek": None, "bellekGB": None, "gpu": None, "ua": None, "uaVeri": None}})["cihaz2"]
        self.assertEqual(bos, {"cekirdek": None, "bellekGB": None, "gpu": None, "ua": None, "uaVeri": None})
        self.assertNotIn("cihaz2", server.temiz_kurulum({"tarayici": "x"}))
        # metrics yoluyla da kurulum kaydına girer
        kod, sid = self.ogrenci()
        post(self.base, "/api/metrics", {"code": kod, "sid": sid, "attention": 50, "energy": 50, "face": True,
                                         "kurulum": {"tarayici": "Edge 131", "cihaz2": {"cekirdek": 8, "gpu": "ANGLE (Intel)"}}})
        setup = json.loads(server.KAYIT.execute("SELECT setup FROM setups").fetchone()[0])
        self.assertEqual((setup["cihaz2"]["cekirdek"], setup["cihaz2"]["gpu"]), (8, "ANGLE (Intel)"))



def ornek_cihaz_tam():
    """cihaz.js cihazTamTopla çıktısı biçiminde örnek (Windows 11, Chrome, Intel GPU, USB kamera)."""
    return {
        "surum": 1, "zaman": "2026-11-25T08:00:00.000Z",
        "tarayici": {"ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
                     "uaVeri": {"brands": [{"brand": "Google Chrome", "version": "131"}], "mobile": False, "platform": "Windows"},
                     "uaYuksek": {"platformVersion": "15.0.0", "architecture": "x86", "bitness": "64", "model": "", "wow64": False,
                                  "fullVersionList": [{"brand": "Not_A Brand", "version": "24.0.0.0"},
                                                      {"brand": "Google Chrome", "version": "131.0.6778.86"}]},
                     "uaYuksekNeden": None},
        "islemci": {"mantiksalCekirdek": 4, "cpuModel": None, "cpuModelNeden": "tarayıcı vermez"},
        "bellek": {"deviceMemoryGB": 8, "bellekNot": "tarayıcı ≤8 GB'a yuvarlar", "jsHeapLimitMB": 4096},
        "gpu": {"webglVendor": "Google Inc. (Intel)", "webglRenderer": "ANGLE (Intel, Intel(R) UHD Graphics 620)", "webglNeden": None,
                "webgl2": True, "webgpu": False, "webgpuAdapter": None, "webgpuNeden": "WebGPU yok"},
        "ekran": {"width": 1920, "height": 1080, "dpr": 1, "tamEkran": True, "genisletilmis": None},
        "kamera": {"label": "HD Webcam (0c45:6340)", "ayar": {"width": 1280, "height": 720, "frameRate": 30, "deviceIdOz": "a1b2c3d4e5f6"},
                   "yetenek": {"maxWidth": 1920, "maxHeight": 1080, "maxFrameRate": 30}, "videoGirisSayisi": 1,
                   "videoGirisEtiketleri": ["HD Webcam (0c45:6340)"], "neden": None},
        "ag": None,
        "diger": {"dil": "tr-TR", "saatDilimi": "Europe/Istanbul", "platform": "Win32", "dokunmatikNokta": 0,
                  "crossOriginIsolated": False, "mediapipeDelegate": "GPU", "isci": True},
    }


class CihazTam(unittest.TestCase):
    def test_temizleyici_sinirlar_bilinmeyen_null(self):
        c = ornek_cihaz_tam()
        c["bilinmeyen"] = {"x": 1}
        c["gpu"]["webglRenderer"] = "R" * 900
        c["gpu"]["fazla"] = "atılır"
        c["kamera"]["videoGirisEtiketleri"] = ["k"] * 40
        c["tarayici"]["uaYuksek"]["fullVersionList"] = [{"brand": "B", "version": "1", "ek": "x"}] * 30
        c["islemci"]["mantiksalCekirdek"] = True        # yanlış tür -> None
        c["bellek"]["deviceMemoryGB"] = float("nan")     # sonlu değil -> None
        c["ekran"]["width"] = "1920"                     # yanlış tür -> None
        t = server.temiz_cihaz_tam(c)
        self.assertNotIn("bilinmeyen", t)
        self.assertNotIn("fazla", t["gpu"])
        self.assertEqual(len(t["gpu"]["webglRenderer"]), 300)
        self.assertEqual(len(t["kamera"]["videoGirisEtiketleri"]), 16)
        self.assertEqual(len(t["tarayici"]["uaYuksek"]["fullVersionList"]), 16)
        self.assertEqual(t["tarayici"]["uaYuksek"]["fullVersionList"][0], {"brand": "B", "version": "1"})
        self.assertIsNone(t["islemci"]["mantiksalCekirdek"])
        self.assertIsNone(t["bellek"]["deviceMemoryGB"])
        self.assertIsNone(t["ekran"]["width"])
        # null korunur, alınamayan + neden aynen
        self.assertIn("cpuModel", t["islemci"])
        self.assertIsNone(t["islemci"]["cpuModel"])
        self.assertEqual(t["islemci"]["cpuModelNeden"], "tarayıcı vermez")
        self.assertIsNone(t["gpu"]["webgpuAdapter"])
        self.assertIsNone(t["ag"])
        self.assertIsNone(server.temiz_cihaz_tam("x"))
        self.assertIsNone(server.temiz_cihaz_tam(None))
        # derin iç içe veri şema dışında kalır
        derin = server.temiz_cihaz_tam({"kamera": {"ayar": {"width": {"a": {"b": {"c": 1}}}}}})
        self.assertEqual(derin, {"kamera": {"ayar": {"width": None}}})

    def test_ozet_gercek_degerlerden(self):
        t = server.temiz_cihaz_tam(ornek_cihaz_tam())
        asama = [{"Aşama": "a", "Kamera fps (gerçek)": 29.8, "İşleme fps": 14.0},
                 {"Aşama": "b", "Kamera fps (gerçek)": 30.0, "İşleme fps": 10.0},
                 {"Aşama": "c", "Kamera fps (gerçek)": None, "İşleme fps": 12.0}]
        o = server.cihaz_tam_ozet(t, asama)
        self.assertEqual((o["tarayici"], o["tarayiciSurum"]), ("Chrome", "131.0.6778.86"))
        self.assertEqual(o["isletimSistemi"], "Windows 11 (15.0.0)")
        self.assertEqual((o["cekirdek"], o["bellekGB"], o["gpuVendor"]), (4, 8, "Google Inc. (Intel)"))
        self.assertEqual(o["gpu"], "ANGLE (Intel, Intel(R) UHD Graphics 620)")
        self.assertEqual((o["kamera"], o["kameraCozunurluk"], o["kameraFpsAyar"]), ("HD Webcam (0c45:6340)", "1280x720", 30))
        self.assertEqual((o["kameraFpsOlculen"], o["islemeFps"]), (29.9, 12.0))   # ölçülen: aşama medyanı, ayardan ayrı
        self.assertEqual((o["delegate"], o["isci"]), ("GPU", True))
        # veri yoksa None (uydurma yok): UA-CH yok -> UA metni; Windows 10/11 ayırt edilemez
        b = server.cihaz_tam_ozet(server.temiz_cihaz_tam({"tarayici": {"ua": "Mozilla/5.0 (Windows NT 10.0) Firefox/133.0"}}))
        self.assertEqual((b["tarayici"], b["tarayiciSurum"], b["isletimSistemi"]), ("Firefox", "133.0", "Windows 10/11"))
        for a in ("gpu", "cekirdek", "bellekGB", "kamera", "kameraCozunurluk", "kameraFpsAyar", "kameraFpsOlculen", "islemeFps", "delegate", "isci"):
            self.assertIsNone(b[a], a)
        self.assertIsNone(server.cihaz_tam_ozet(None))

    def test_gazelab_oturumu_cihazi_tasir(self):
        gecici = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, gecici, True)
        tam = ornek_cihaz_tam()
        tam["fazla"] = "atılır"
        with unittest.mock.patch.multiple(server, TEST_DIR=gecici, GL_DB=os.path.join(gecici, "gazelab.db")):
            sid = server.gl_kaydet({"session": {"id": "cihaz123", "status": "completed",
                                                "device": {"ua": "x", "browser": "Chrome 131", "screenW": 1920, "cihazTam": tam, "cihazOzet": {"sahte": 1}}},
                                    "tablolar": {"yontem": [{"Kod": "biz", "Yöntem": "bizim", "GL doğruluk px": 120}],
                                                 "asama": [{"Aşama": "bakarak", "Kamera fps (gerçek)": 30, "İşleme fps": 15}]}}, "o.json")
            con = sqlite3.connect(os.path.join(gecici, "gazelab.db"))
            self.addCleanup(con.close)
            d = json.loads(con.execute("SELECT device FROM sessions WHERE id=?", (sid,)).fetchone()[0])
            self.assertEqual((d["ua"], d["browser"], d["screenW"]), ("x", "Chrome 131", 1920))   # eski alanlar aynen
            self.assertNotIn("fazla", d["cihazTam"])
            self.assertEqual(d["cihazTam"]["kamera"]["label"], "HD Webcam (0c45:6340)")
            self.assertNotIn("sahte", d["cihazOzet"])   # istemcinin özeti değil, sunucunun
            self.assertEqual((d["cihazOzet"]["cekirdek"], d["cihazOzet"]["kameraFpsOlculen"], d["cihazOzet"]["islemeFps"]), (4, 30, 15))
            # yöntem satırı cihazla session_id üzerinden birleşir
            r = con.execute("SELECT m.method, json_extract(s.device, '$.cihazOzet.gpu') FROM method_stats m JOIN sessions s ON s.id=m.session_id").fetchone()
            self.assertEqual(r, ("biz", "ANGLE (Intel, Intel(R) UHD Graphics 620)"))
            # cihazTam yoksa özet de yok, eski davranış
            sid2 = server.gl_kaydet({"session": {"id": "cihaz456", "device": {"ua": "y"}}}, "p.json")
            self.assertEqual(json.loads(con.execute("SELECT device FROM sessions WHERE id=?", (sid2,)).fetchone()[0]), {"ua": "y"})

    def test_kurulum_ve_panel_ozeti(self):
        k = server.temiz_kurulum({"tarayici": "Chrome 131", "kamera": "1280x720", "fps": 30, "islemeFps": 15,
                                  "cihaz2": {"cekirdek": 4}, "cihazTam": ornek_cihaz_tam()})
        self.assertEqual(k["cihazTam"]["gpu"]["webglVendor"], "Google Inc. (Intel)")
        o = server.cihaz_ozet(k)
        self.assertEqual(o, {"tarayici": "Chrome 131.0.6778.86", "cekirdek": 4, "gpu": "ANGLE (Intel, Intel(R) UHD Graphics 620)",
                             "isletimSistemi": "Windows 11 (15.0.0)", "bellekGB": 8, "kamera": "HD Webcam (0c45:6340)",
                             "kameraCozunurluk": "1280x720", "kameraFps": 30, "islemeFps": 15})
        self.assertIsNone(server.temiz_kurulum({"cihazTam": "x"})["cihazTam"])


if __name__ == "__main__":
    unittest.main()

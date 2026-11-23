import json
import os
import struct
import shutil
import tempfile
import threading
import unittest
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


if __name__ == "__main__":
    unittest.main()

import json
import shutil
import tempfile
import threading
import unittest
import urllib.request
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


if __name__ == "__main__":
    unittest.main()

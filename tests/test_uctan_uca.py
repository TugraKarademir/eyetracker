"""Uçtan uca akış: gerçek HTTP ile ders -> materyal -> öğrenci -> yönetim ekranı API'leri.
Geçici DATA (içinde geçici dersler.db) kullanır; gerçek veriye dokunmaz."""
import json
import os
import unittest
import unittest.mock
import urllib.request

import server
from tests.test_sunucu import ONAY, PNG1, basla, ham, post

ANAHTAR = "uctan-uca-anahtar"


def admin_get(base, yol):
    r = urllib.request.Request(base + yol, headers={"X-Admin-Key": ANAHTAR})
    with urllib.request.urlopen(r) as f:
        return f.status, f.read()


class UctanUca(unittest.TestCase):
    def setUp(self):
        self.base, kapat = basla()
        self.addCleanup(kapat)
        p = unittest.mock.patch.dict(os.environ, {"DERSNABZI_ADMIN_KEY": ANAHTAR})
        p.start()
        self.addCleanup(p.stop)
        eski = server._ADMIN_KEY
        server._ADMIN_KEY = None
        self.addCleanup(setattr, server, "_ADMIN_KEY", eski)
        # Denetlenen saat: örnek paketi [t - 2 sn, t] aralığını kapsar; materyal seçiminden hemen
        # sonra gelen paket geçiş sayılır. Akış gerçek öğrenci gibi 2 sn aralıklarla ilerler.
        self.saat = [server.now()]
        p = unittest.mock.patch.object(server, "now", lambda: self.saat[0])
        p.start()
        self.addCleanup(p.stop)

    def ilerle(self, sn):
        self.saat[0] += sn

    def jget(self, yol):
        return json.loads(admin_get(self.base, yol)[1])

    def test_tam_akis(self):
        b = self.base
        _, r = post(b, "/api/class", {"name": "Uçtan uca", "topic": "T"})
        kod, key = r["code"], r["key"]

        _, r = ham(b, "/api/material?code=%s&key=%s&name=Slayt&kind=insan" % (kod, key), PNG1)[:2]
        m1 = json.loads(r)["id"]
        _, r = ham(b, "/api/material?code=%s&key=%s&name=YZ%%20ozeti&kind=yz" % (kod, key), b"")[:2]
        m2 = json.loads(r)["id"]

        self.assertEqual(post(b, "/api/admin/katilimci", {"kod": "P01"})[0], 403)  # anahtarsız
        rq = urllib.request.Request(b + "/api/admin/katilimci", json.dumps({"kod": "P01"}).encode(),
                                    {"Content-Type": "application/json", "X-Admin-Key": ANAHTAR})
        with urllib.request.urlopen(rq) as f:
            self.assertEqual(json.loads(f.read()), {"kod": "P01"})

        _, r = post(b, "/api/join", {"onay": ONAY, "code": kod, "name": "Ali", "pcode": "P01"})
        self.assertNotIn("kodBilinmiyor", r)
        sid = r["sid"]

        def metrik(n, adim=2, **ek):
            for _ in range(n):
                self.ilerle(adim)
                g = {"code": kod, "sid": sid, "attention": 80, "energy": 70, "emotion": "notr",
                     "face": True,
                     "gaze": {"cal": True, "share": {"materyal": 0.7, "disari": 0.3},
                              "pts": [[0.5, 0.5]], "scr": [[-100, 0.4, 0.6]]}}
                g.update(ek)
                self.assertEqual(post(b, "/api/metrics", g)[0], 200)

        kur = {"kamera": "640x480", "fps": 30, "ekran": "1920x1080", "dpr": 1, "fs": False,
               "tarayici": "Chrome 120", "uzaklikCm": 55, "islemeFps": None}
        post(b, "/api/event", {"code": kod, "key": key, "type": "material", "id": m1})
        metrik(3, kurulum=kur, kal={"at": 123.5, "hit3": 90})
        post(b, "/api/event", {"code": kod, "key": key, "type": "material", "id": m2})
        metrik(1, adim=1)   # paket [t - 2, t] m1 -> m2 geçişini kapsar: materyale atanmaz
        metrik(2)

        post(b, "/api/event", {"code": kod, "key": key, "type": "demo", "count": 2})
        cls = server.CLASSES[kod]
        demo_idler = [s["id"] for s in cls["students"].values() if s["demo"]]
        self.assertEqual(len(demo_idler), 2)
        with server.LOCK:
            for _ in range(3):
                server.simulate_demo(cls, server.now())

        self.ilerle(1)
        self.assertEqual(post(b, "/api/event", {"code": kod, "key": key, "type": "end"})[0], 200)

        # --- yönetim API'leri ---
        dl = [d for d in self.jget("/api/admin/dersler") if d["code"] == kod]
        self.assertEqual(len(dl), 1)
        self.assertIsNotNone(dl[0]["ended"])
        self.assertNotIn("bitmedi", dl[0])
        self.assertEqual((dl[0]["n_ogrenci"], dl[0]["n_materyal"], dl[0]["n_insan"], dl[0]["n_yz"]),
                         (1, 2, 1, 1))

        d = self.jget("/api/admin/ders?code=" + kod)
        self.assertEqual(len(d["spans"]), 2)
        self.assertEqual(d["spans"][0]["t_end"], d["spans"][1]["t_start"])   # m1 aralığı m2 seçilince kapanır
        self.assertEqual(d["spans"][1]["t_end"], d["ders"]["ended"])   # son aralık "end" olayında kapanır
        mats = {m["id"]: m for m in d["materyaller"]}
        self.assertEqual((mats[m1]["kind"], mats[m1]["n_ornek"]), ("insan", 3))
        self.assertEqual((mats[m2]["kind"], mats[m2]["n_ornek"]), ("yz", 2))
        self.assertTrue(mats[m1]["hasImage"])
        self.assertFalse(mats[m2]["hasImage"])
        self.assertEqual(len(d["ogrenciler"]), 1)
        self.assertEqual(d["ogrenciler"][0]["participant_code"], "P01")

        o = self.jget("/api/admin/ogrenci?code=%s&sid=%s" % (kod, sid))
        self.assertEqual(o["bilgi"]["participant_code"], "P01")
        self.assertEqual(sorted({x[4] for x in o["ornekler"] if x[4] is not None}), sorted([m1, m2]))
        self.assertEqual(len(o["ornekler"]), 6)
        self.assertEqual(sum(1 for x in o["ornekler"] if x[4] is None), 1)   # geçiş paketi
        self.assertEqual(len(o["kurulumlar"]), 1)
        self.assertEqual(len(o["kalibrasyonlar"]), 1)

        # demo öğrenci için hiçbir yerde satır yok
        for did in demo_idler:
            for tablo in ("samples", "students", "setups", "calibrations", "events"):
                col = "lesson_code"
                n = server.KAYIT.execute(
                    "SELECT COUNT(*) FROM %s WHERE %s=? AND sid=?" % (tablo, col), (kod, did)
                ).fetchone()[0]
                self.assertEqual(n, 0, (tablo, did))
            self.assertNotIn(did, [x["sid"] for x in d["ogrenciler"]])

        k = self.jget("/api/admin/karsilastirma")
        self.assertEqual(k["tur"]["insan"]["n_ogrenci"], 1)
        self.assertEqual(k["tur"]["yz"]["n_ogrenci"], 1)
        self.assertEqual(len(k["eslesik"]), 1)
        self.assertEqual(k["eslesik"][0]["katilimci"], "P01")
        self.assertEqual(k["eslesik"][0]["insan"]["n_ogrenci"], 1)
        self.assertEqual(k["eslesik"][0]["yz"]["n_ogrenci"], 1)
        self.assertEqual(k["kodsuz_n"], 0)

        st, veri = admin_get(self.base, "/api/admin/csv?tur=uzun&code=" + kod)
        self.assertEqual(st, 200)
        self.assertTrue(veri.startswith("﻿".encode("utf-8")))
        satirlar = veri.decode("utf-8-sig").strip().splitlines()
        self.assertEqual(len(satirlar), 3)   # başlık + iki materyal
        self.assertTrue(any("Slayt" in s and "insan" in s and "P01" in s for s in satirlar))
        self.assertTrue(any("yz" in s and "P01" in s for s in satirlar[1:]))


if __name__ == "__main__":
    unittest.main()

"""Yönetim ekranını denemek için örnek ders (TOHUM1) yazar / siler.

  python tests/tohum.py           -> TOHUM1'i (yeniden) yazar
  python tests/tohum.py --sil     -> TOHUM1'in tüm satırlarını ve görsel klasörünü siler
  --db <yol>                      -> başka veritabanı (varsayılan data/dersler.db)

Veri sentetiktir (yalnız arayüz denemesi için); gerçek ders kaydı değildir.
Rastgelelik sabit tohumlu: her çalıştırmada aynı veri.
"""
import argparse
import json
import math
import os
import random
import shutil
import struct
import sys
import time
import zlib

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import kayit  # noqa: E402

KOD = "TOHUM1"
TABLOLAR = ("lessons", "students", "materials", "material_spans", "samples",
            "setups", "calibrations", "events")


def png(yol, w, h, ciz):
    """Yalnız stdlib ile RGB PNG yazar; ciz(x, y) -> (r, g, b)."""
    ham = b"".join(b"\x00" + bytes(c for x in range(w) for c in ciz(x, y))
                   for y in range(h))

    def parca(tur, veri):
        return (struct.pack(">I", len(veri)) + tur + veri
                + struct.pack(">I", zlib.crc32(tur + veri) & 0xFFFFFFFF))
    with open(yol, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"
                + parca(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + parca(b"IDAT", zlib.compress(ham, 9)) + parca(b"IEND", b""))


def slayt(renk, kutular):
    """Başlık şeridi + içerik kutuları olan basit slayt çizimi."""
    def ciz(x, y):
        if y < 26:
            return renk
        for (x0, y0, x1, y1, c) in kutular:
            if x0 <= x < x1 and y0 <= y < y1:
                return c
        return (246, 247, 249)
    return ciz


def sil(con, klasor):
    with con:
        for t in TABLOLAR:
            alan = "code" if t == "lessons" else "lesson_code"
            con.execute(f"DELETE FROM {t} WHERE {alan}=?", (KOD,))
    if os.path.isdir(klasor):
        shutil.rmtree(klasor)


def yaz(con, klasor):
    rnd = random.Random(7)
    sil(con, klasor)
    t0 = round(time.time() - 3600)          # bir saat önce başlamış, bitmiş ders
    kayit.ders_ekle(con, KOD, "Tohum dersi: Fotosentez", "Fotosentez", t0)
    for p in ("P01", "P02"):
        kayit.katilimci_ekle(con, p)
    ogr = [("tohum-s1", "Ayşe Deneme", "P01", "iyi"),
           ("tohum-s2", "Burak Deneme", "P02", "orta"),
           ("tohum-s3", "Cem Kodsuz", None, "kalibresiz")]
    for i, (sid, ad, pc, _) in enumerate(ogr):
        kayit.ogrenci_ekle(con, KOD, sid, ad, pc, t0 + 2 + i, False)

    os.makedirs(klasor, exist_ok=True)
    mats = []
    for i, (ad, tur, renk, sicak) in enumerate([
            ("Slayt 1 — İnsan tasarımı", "insan", (47, 111, 219), (0.30, 0.45)),
            ("Slayt 2 — YZ tasarımı", "yz", (232, 121, 12), (0.65, 0.55))]):
        mid = kayit.materyal_ekle(con, KOD, ad, tur)
        kutu = [(20, 40, 150, 160, (220, 228, 240)), (170, 40, 300, 100, (255, 236, 210)),
                (170, 110, 300, 160, (225, 240, 225))]
        png(os.path.join(klasor, f"{mid}.png"), 320, 180, slayt(renk, kutu))
        kayit.materyal_gorsel(con, mid, f"materyaller/{KOD}/{mid}.png")
        mats.append((mid, sicak))

    # kurulum ve kalibrasyon
    for sid, _, _, durum in ogr:
        kur = {"kamera": "1280x720", "fps": 30, "ekran": "1920x1080",
               "pencere": "1536x730", "dpr": 1.25, "fs": False,
               "tarayici": "Chrome 131", "uzaklikCm": 58, "islemeFps": 15}
        kayit.kurulum_ekle(con, KOD, sid, t0 + 4, kur)
        if durum == "kalibresiz":
            continue
        acc = 95 if durum == "iyi" else 180
        kayit.kalibrasyon_ekle(con, KOD, sid, t0 + 5, {
            "acc": acc, "prec": 30, "hit3": 88 if durum == "iyi" else 66,
            "deg": round(math.degrees(math.atan(acc * 0.0265 / 55)), 1),
            "at": (t0 + 5) * 1000, "kamera": "1280x720", "coarse": False})
    kayit.kurulum_ekle(con, KOD, "tohum-s1", t0 + 160,
                       {"kamera": "1280x720", "fps": 30, "ekran": "1920x1080",
                        "pencere": "1920x970", "dpr": 1.25, "fs": True,
                        "tarayici": "Chrome 131", "uzaklikCm": 61, "islemeFps": 15})

    # olaylar (materyal seçimi, el, sohbet, uyarı, konu, bitiş)
    olay = [(None, 1, "topic", {"topic": "Fotosentez"}),
            ("tohum-s2", 70, "hand", {"up": True}), ("tohum-s2", 95, "hand", {"up": False}),
            ("tohum-s1", 120, "chat", {"text": "Klorofil nerede bulunur?"}),
            (None, 200, "alert", {"kind": "attention", "text": "Sınıf dikkati düştü"}),
            ("tohum-s3", 230, "chat", {"text": "Tekrar anlatır mısınız?"}),
            ("tohum-s1", 260, "reaction", {"emoji": "👍"})]

    emos = ["notr", "mutlu", "kafa_karisik", "zorlaniyor"]
    for sid, tt, kind, data in olay:
        kayit.olay_ekle(con, KOD, sid, t0 + tt, kind, data)
    sec = {6: 0, 150: 1}                     # ders saniyesi -> materyal sırası
    for k in range(3, 151):                  # her 2 sn, ~5 dk
        t = t0 + 2 * k
        if 2 * k in sec:                     # örnekler o anki materyalle etiketlenir
            mid = mats[sec[2 * k]][0]
            kayit.materyal_sec(con, KOD, mid, t - 1)
            kayit.olay_ekle(con, KOD, None, t - 1, "material", {"id": mid})
        hot = mats[0][1] if 2 * k < 150 else mats[1][1]
        for j, (sid, _, _, durum) in enumerate(ogr):
            dal = 12 * math.sin(k / 9 + j) + rnd.gauss(0, 6)
            att = max(0, min(100, (74 if durum == "iyi" else 60) + dal - (15 if 190 < 2 * k < 215 else 0)))
            en = max(0, min(100, 55 + 10 * math.cos(k / 13 + j) + rnd.gauss(0, 5)))
            emo = rnd.choices(emos, [6, 3, 2, 1] if 2 * k < 150 else [5, 2, 3, 2])[0]
            face = 0 if rnd.random() < (0.04 if durum == "iyi" else 0.12) else 1
            row = {"attention": round(att) if face else 0, "energy": round(en), "emotion": emo,
                   "face": face, "away": 0 if face else 1, "eyes_closed": 0, "tab_hidden": 0,
                   "head": None, "wg_share": None}
            if durum == "kalibresiz" or not face:
                row.update(gaze_cal=0, coarse=0, share=None, mat_pts=None, gaze=None)
            else:
                sd = 0.08 if durum == "iyi" else 0.14
                pay = max(0.0, min(1.0, rnd.gauss(0.72 if durum == "iyi" else 0.55, 0.15)))
                share = {"materyal": round(pay, 2), "konu": round((1 - pay) * 0.4, 2),
                         "sohbet": round((1 - pay) * 0.6, 2)}
                pts = []
                for _ in range(rnd.randint(6, 14)):
                    pts.append([round(min(0.999, max(0, rnd.gauss(hot[0], sd))), 3),
                                round(min(0.999, max(0, rnd.gauss(hot[1], sd * 1.2))), 3)])
                # tam ekran: materyal pencerede x 0.05-0.70, y 0.15-0.80; birkaç fiksasyon + sıçrama
                gz, fx, fy = [], None, None
                for q in range(20):
                    if q % rnd.choice([3, 4, 5, 7]) == 0 or fx is None:
                        u, v = rnd.choice(pts)
                        fx, fy = 0.05 + u * 0.65, 0.15 + v * 0.65
                    gz.append([-2000 + q * 100, round(fx + rnd.gauss(0, 0.004), 3),
                               round(fy + rnd.gauss(0, 0.004), 3)])
                row.update(gaze_cal=1, coarse=0, share=share, mat_pts=pts, gaze=gz)
            kayit.ornek_ekle(con, KOD, sid, t, row)
    son = t0 + 2 * 150 + 2
    kayit.materyal_sec(con, KOD, None, son)
    kayit.olay_ekle(con, KOD, None, son, "end", None)
    kayit.ders_bitir(con, KOD, son)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sil", action="store_true")
    ap.add_argument("--db", default=os.path.join(KOK, "data", "dersler.db"))
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(os.path.dirname(os.path.abspath(a.db)), exist_ok=True)
    con = kayit.ac(a.db)
    klasor = os.path.join(os.path.dirname(os.path.abspath(a.db)), "materyaller", KOD)
    if a.sil:
        sil(con, klasor)
        print(f"{KOD} silindi ({a.db})")
    else:
        yaz(con, klasor)
        n = con.execute("SELECT COUNT(*) FROM samples WHERE lesson_code=?", (KOD,)).fetchone()[0]
        print(f"{KOD} yazıldı: {n} örnek ({a.db}); görseller {klasor}")
    con.close()


if __name__ == "__main__":
    main()

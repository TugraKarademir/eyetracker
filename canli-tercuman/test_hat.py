"""Servise bağlanmadan ve hoparlörden ses çıkarmadan çekirdeği test eder:  python test_hat.py"""
import random
import time

import numpy as np

import ses
from cekirdek import Hat, Tercuman
from servisler import uydurma_mi

rng = np.random.default_rng(0)
basarili = 0


def kontrol(ad, kosul, ayrinti=""):
    global basarili
    print(("  OK  " if kosul else " HATA ") + ad + (f"  ({ayrinti})" if ayrinti else ""))
    assert kosul, ad
    basarili += 1


def konusma(sn, genlik=0.12):
    """Konuşmaya benzer: hece ritminde (4 Hz) genliği dalgalanan bant sınırlı gürültü."""
    n = int(sn * 16000)
    t = np.arange(n) / 16000
    zarf = 0.55 + 0.45 * np.sin(2 * np.pi * 4 * t)
    return (rng.normal(0, genlik, n) * zarf).astype(np.float32)


def sessizlik(sn, genlik=0.002):
    return rng.normal(0, genlik, int(sn * 16000)).astype(np.float32)


print("1) Örnekleme hızı dönüştürücü")
for giris, cikis in ((48000, 16000), (44100, 16000), (24000, 48000), (16000, 48000)):
    o = ses.Ornekleyici(giris, cikis)
    t = np.arange(giris * 2) / giris
    x = np.sin(2 * np.pi * 1000 * t).astype(np.float32)
    y = np.concatenate([o(x[i:i + 941]) for i in range(0, len(x), 941)])  # tuhaf blok boyu
    beklenen = len(x) * cikis / giris
    tepe = np.argmax(np.abs(np.fft.rfft(y[cikis // 2:]))) * cikis / len(y[cikis // 2:])
    sicrama = np.abs(np.diff(y[cikis // 2:])).max()
    kontrol(f"{giris}->{cikis}: uzunluk {len(y)}≈{beklenen:.0f}, tepe {tepe:.0f} Hz, en büyük sıçrama {sicrama:.3f}",
            abs(len(y) - beklenen) < 3 and abs(tepe - 1000) < 5 and sicrama < 0.5)

print("2) Cümle bölücü")
parcalar = []
b = ses.CumleBolucu(parcalar.append, sessizlik_ms=600, max_sn=5.0)
akis = np.concatenate([sessizlik(1.5), konusma(1.2), sessizlik(1.0),
                       konusma(0.8), sessizlik(0.2), konusma(0.6), sessizlik(1.0),   # kısa duraksama: tek parça
                       konusma(0.1, 0.3), sessizlik(1.0),                           # tıkırtı: yok sayılmalı
                       konusma(11.0), sessizlik(1.0)])                               # uzun: zorla bölünmeli
for i in range(0, len(akis), 320):
    b.besle(akis[i:i + 320])
sureler = [round(len(p) / 16000, 2) for p in parcalar]
kontrol(f"parça süreleri {sureler}", len(parcalar) == 5 and 1.2 <= sureler[0] <= 1.8
        and 1.6 <= sureler[1] <= 2.3 and all(s <= 5.05 for s in sureler))

print("3) Uydurma metin süzgeci")
kontrol("Whisper uydurmaları elendi", all(uydurma_mi(m) for m in
                                           ["Altyazı M.K.", "İzlediğiniz için teşekkürler.", "Thanks for watching!", "you"]))
kontrol("gerçek cümleler geçti", not any(uydurma_mi(m) for m in
                                         ["Bugün sonuçları anlatacağım.", "Thank you, that was a great question."]))

print("4) Hat: paralel işleme, sıralı teslim, seslendirme")


class YavasSahte:
    klon_ses = False

    def yaziya_dok(self, s, dil, ipucu=""):
        time.sleep(random.uniform(0.05, 0.4))      # sırayı bozmaya çalış
        n = len(s) // 1600 - 1               # sıra numarası uzunlukta saklı (ses yükseltmeden etkilenmez)
        return f"cumle{n}" if n >= 0 else ""  # kısa parça = gürültü

    def cevir(self, m, k, h, baglam, sozluk):
        time.sleep(random.uniform(0.0, 0.2))
        return m.upper()

    def seslendir(self, m, parca_al):
        parca_al(np.ones(2400, dtype=np.float32))


class KayitCalici:
    def __init__(self):
        self.toplam = 0

    def yaz(self, x, sr, kaynak):
        self.toplam += len(x)


olaylar = []
kc = KayitCalici()
h = Hat("giden", YavasSahte(), "tr", "en", olaylar.append, [kc])
for i in [0, 1, -1, 2, 3, 4, 5]:
    h.ekle(np.full(800 if i < 0 else 1600 * (i + 1), 0.1, dtype=np.float32))
time.sleep(3)
h.durdur()
cev = [o["ceviri"] for o in olaylar if o["tur"] == "ceviri"]
kontrol(f"sıra {cev}", cev == ["CUMLE0", "CUMLE1", "CUMLE2", "CUMLE3", "CUMLE4", "CUMLE5"])
kontrol("seslendirme çıkışa yazıldı", kc.toplam == 6 * 2400)

print("5) Gerçek ses cihazları (açılıyor mu, veri geliyor mu)")
mik, lb = ses.varsayilan_mikrofon(), ses.varsayilan_loopback()
kontrol(f"mikrofon: {mik and mik['name']}", mik is not None)
kontrol(f"loopback: {lb and lb['name']}", lb is not None)
for cihaz in (mik, lb):
    gelen = []
    y = ses.Yakalayici(cihaz, gelen.append)
    y.baslat()
    time.sleep(1.0)
    y.durdur()
    n = sum(len(g) for g in gelen)
    # loopback, hiçbir şey çalmıyorsa veri göndermeyebilir (WASAPI davranışı) — bu normal
    kontrol(f"{cihaz['name'][:40]}: 1 sn'de {n} örnek", n > 12000 or cihaz is lb)
cikis = [c for c in ses.cikislar()][0]
c = ses.Calici(cikis)
c.baslat()          # boş tampon = sessizlik çalar
time.sleep(0.3)
c.durdur()
kontrol(f"çıkış akışı açıldı/kapandı: {cikis['name'][:40]}", True)

print("6) Tercüman uçtan uca (sahte servis, kayıt yapan çıkış)")
import ayarlar

a = ayarlar.yukle()
olaylar = []
t = Tercuman(a, olaylar.append, sahte=True)
t.baslat(mik, cikis, None, None)
t.calici.durdur()                    # gerçek hoparlöre ses gitmesin
kayit = KayitCalici()
t.calici = kayit
t.giden.calicilar = [kayit]
t.calici.caliyor = False
t.mik_yakala.durdur()                # gerçek mikrofonu kapat, sentetik konuşma besle
t.giden_bolucu.sifirla()
for parca in (sessizlik(1.0), konusma(1.5), sessizlik(1.0), konusma(1.0), sessizlik(1.0)):
    for i in range(0, len(parca), 320):
        t._mikrofondan(parca[i:i + 320])
time.sleep(2.5)
t.mod_degistir("dogrudan")
t._mikrofondan(konusma(0.5))
t.durdur()
cev = [o for o in olaylar if o["tur"] == "ceviri"]
kontrol(f"{len(cev)} cümle çevrildi: {[o['ceviri'] for o in cev]}", len(cev) == 2)
kontrol(f"sahte seslendirme + doğrudan mod çıkışa gitti ({kayit.toplam} örnek)", kayit.toplam > 0)

print(f"\nTüm testler geçti ({basarili} kontrol).")

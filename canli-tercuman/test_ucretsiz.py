"""Ücretsiz modu gerçek konuşma sesiyle uçtan uca dener (internet gerekir, hoparlörden ses çıkmaz).
Edge'in Türkçe/İngilizce sesleriyle konuşma üretir, mikrofon/hoparlör yerine çekirdeğe besler.
Çalıştır:  python test_ucretsiz.py
"""
import time

import numpy as np

import ayarlar
import ses
from cekirdek import Tercuman
from servisler import edge_seslendir

TR = ["Merhaba.",                 # tek kelime: Whisper burada uyduruyordu
      "Merhaba, bugün sizlere projemizin son durumunu anlatmak istiyorum.",
      "Göz izleme verilerinde ilgi alanlarına bakış süreleri belirgin şekilde arttı."]
EN = ["Thank you. Could you show the results for the second group again?"]


def uret(metin, ses_adi):
    parcalar = []
    edge_seslendir(metin, ses_adi, "+0%", parcalar.append)
    return ses.Ornekleyici(24000, 16000)(np.concatenate(parcalar))


class KayitCalici:
    def __init__(self):
        self.toplam = 0
        self.caliyor = False

    def yaz(self, x, sr, kaynak):
        self.toplam += len(x)

    def bosalt(self):
        pass

    def durdur(self):
        pass


def besle(fonk, x):
    """Gerçek zamanlı gibi: 20 ms'lik bloklar, araya sessizlik."""
    sessiz = np.random.default_rng(1).normal(0, 0.002, 16000).astype(np.float32)
    for parca in (sessiz, x * 0.6, sessiz):
        for i in range(0, len(parca), 320):
            fonk(parca[i:i + 320])
            time.sleep(0.02)


print("Konuşma sesleri üretiliyor...")
tr_ses = [uret(m, "tr-TR-AhmetNeural") for m in TR]
en_ses = [uret(m, "en-US-JennyNeural") for m in EN]

a = ayarlar.yukle()
a["motor"] = "ucretsiz"
olaylar = []
t = Tercuman(a, lambda o: olaylar.append((time.perf_counter(), o)))
t0 = time.perf_counter()
t.baslat(ses.varsayilan_mikrofon(), ses.cikislar()[0], None, None)
print(f"Model yüklendi: {time.perf_counter() - t0:.1f} sn")
t.mik_yakala.durdur()
t.calici.durdur()
k = KayitCalici()
t.calici = k
t.giden.calicilar = [k]

for x in tr_ses:
    besle(t._mikrofondan, x)
for x in en_ses:
    besle(t.gelen_bolucu.besle, x)
time.sleep(8)
t.durdur()

print()
for _, o in olaylar:
    if o["tur"] == "ceviri":
        z = " ".join(f"{k}={v:.1f}" for k, v in o.get("zaman", {}).items())
        print(f"[{o['yon']:5}] {o['gecikme']:.1f} sn ({z}) | {o['kaynak']}\n{'':17}-> {o['ceviri']}")
    elif o["tur"] == "hata":
        print("HATA:", o["mesaj"])
ceviriler = [o for _, o in olaylar if o["tur"] == "ceviri"]
print(f"\nİngilizce ses çıkışı: {k.toplam / 24000:.1f} sn")
giden = [o for o in ceviriler if o["yon"] == "giden"]
assert len(giden) == 3, "giden çeviri eksik"
assert giden[0]["kaynak"].lower().startswith("merhaba"), "tek kelime yanlış tanındı"
assert len([o for o in ceviriler if o["yon"] == "gelen"]) >= 1, "gelen altyazı eksik"
assert max(o["gecikme"] for o in ceviriler) < 7, "gecikme çok yüksek"
assert k.toplam > 24000 * 3, "seslendirme eksik"
print("Ücretsiz mod testi geçti.")

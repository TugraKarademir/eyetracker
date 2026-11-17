"""Gerçek donanımla uçtan uca test: hoparlörden Türkçe cümle çalar, gerçek mikrofon yakalar,
uygulama çevirip VB-Cable'a gönderir, CABLE Output'tan (Teams'in duyacağı yer) dinleyerek doğrular.
Çalıştır:  python test_akustik.py
"""
import time

import numpy as np

import ayarlar
import ses
from cekirdek import Tercuman
from servisler import edge_seslendir

a = ayarlar.yukle()
a["motor"] = "ucretsiz"
olaylar = []
t = Tercuman(a, olaylar.append)
mik = ses.bul(ses.girisler(), "Mikrofon")
kablo = ses.sanal_kablo()
hop = ses.bul(ses.cikislar(), "Hoparlör")
teams_tarafi = ses.bul(ses.girisler(), "CABLE Output")
print("mikrofon:", mik["name"], "| çıkış:", kablo["name"], "| doğrulama:", teams_tarafi["name"])

t.baslat(mik, kablo, None, hop)   # İngilizce: VB-Cable (Teams) + hoparlör (sen duy)

# Teams'in duyacağı sesi kaydet
duyulan = []
dogrula = ses.Yakalayici(teams_tarafi, duyulan.append)
dogrula.baslat()

# Türkçe konuşmayı mikrofon akışına ver (laptop mikrofonu hoparlörü yankı engelleme ile bastırdığı için
# akustik yerine doğrudan); gerçek mikrofon akışı da açık kalır
time.sleep(1.0)
parcalar = []
edge_seslendir("Merhaba, bugün sizlere projemizin sonuçlarını anlatacağım.", "tr-TR-AhmetNeural", "+0%",
               parcalar.append)
konusma = ses.Ornekleyici(24000, 16000)(np.concatenate(parcalar)) * 0.15   # kısık mikrofon seviyesi
t.mik_yakala.durdur()   # gerçek mikrofon karışmasın
tepe_mik = []
sessiz = np.random.default_rng(0).normal(0, 0.0004, 16000).astype(np.float32)
konusma = np.concatenate((sessiz, konusma, sessiz))
for i in range(0, len(konusma), 320):
    t.mik_yakala.geri_cagir(konusma[i:i + 320])
    tepe_mik.append(t.giden_bolucu.seviye)
    time.sleep(0.02)
time.sleep(9)
dogrula.durdur()
t.durdur()

for o in olaylar:
    if o["tur"] in ("parca", "ceviri", "hata", "anlasilamadi"):
        print(" ", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in o.items() if k != "zaman"})
x = np.concatenate(duyulan) if duyulan else np.zeros(1)
aktif = (np.abs(x) > 0.02).mean() * len(x) / 16000
print(f"\nkonuşurken mikrofon seviyesi (RMS) en yüksek: {max(tepe_mik):.4f}, eşik: {t.giden_bolucu.esik:.4f}")
print(f"Teams tarafına (CABLE Output) ulaşan İngilizce ses: ~{aktif:.1f} sn, tepe {np.abs(x).max():.3f}")

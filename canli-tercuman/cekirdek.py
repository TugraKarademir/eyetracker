"""Tercüman çekirdeği: iki yönlü hat.
  GİDEN : mikrofon -> cümle bölme -> yazıya dökme (TR) -> çeviri (EN) -> klon sesle seslendirme -> sanal kablo
  GELEN : hoparlör loopback -> cümle bölme -> yazıya dökme (EN) -> çeviri (TR) -> altyazı
"""
import collections
import datetime
import json

import numpy as np
import itertools
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import ayarlar
import ses
from servisler import Servisler, TTS_SR, UcretsizServisler, servis_olustur


class Hat:
    """Parçaları paralel işler (yazıya dökme + çeviri), ama sonuçları konuşma sırasıyla teslim eder."""

    def __init__(self, ad, servis: Servisler, kaynak, hedef, olay, calicilar=None, isci=3):
        self.ad, self.servis, self.kaynak, self.hedef = ad, servis, kaynak, hedef
        self.olay = olay
        self.calicilar = calicilar or []
        self.havuz = ThreadPoolExecutor(max_workers=isci, thread_name_prefix=f"hat-{ad}")
        self.sayac = itertools.count()
        self.sonuclar = {}
        self.kosul = threading.Condition()
        self.sira = 0
        self.son_kaynak = collections.deque(maxlen=5)
        self.son_ceviri = collections.deque(maxlen=5)
        self.calisiyor = True
        self.siralayici = threading.Thread(target=self._sirala, daemon=True, name=f"sira-{ad}")
        self.siralayici.start()

    def ekle(self, parca):
        if not self.calisiyor:
            return
        no = next(self.sayac)
        self.olay({"tur": "parca", "yon": self.ad, "sure": len(parca) / ses.HEDEF_SR,
                   "tepe": float(np.abs(parca).max())})
        self.olay({"tur": "durum", "yon": self.ad, "durum": "isleniyor"})
        # kısık mikrofon: tanımadan önce sesi yükselt (en fazla 20 kat)
        tepe = float(np.abs(parca).max()) or 1.0
        parca = parca * min(10.0, 0.9 / tepe)
        self.havuz.submit(self._isle, no, parca, time.perf_counter())

    def _ipucu(self):
        terimler = [a if self.kaynak == "tr" else b for a, b in ayarlar.sozluk()]
        parca = []
        if terimler:
            parca.append(", ".join(terimler) + ".")
        parca.extend(self.son_kaynak)
        return " ".join(parca)

    def _isle(self, no, parca, t0):
        sonuc = {"t0": t0, "sure": len(parca) / ses.HEDEF_SR, "zaman": {}}
        z = sonuc["zaman"]
        try:
            ta = time.perf_counter()
            z["kuyruk"] = ta - t0
            metin = self.servis.yaziya_dok(parca, self.kaynak, self._ipucu())
            tb = time.perf_counter()
            z["tanima"] = tb - ta
            sonuc["kaynak"] = metin
            if metin:
                sonuc["ceviri"] = self.servis.cevir(
                    metin, self.kaynak, self.hedef, list(self.son_ceviri), ayarlar.sozluk())
                z["ceviri"] = time.perf_counter() - tb
        except Exception as e:
            sonuc["hata"] = f"{type(e).__name__}: {e}"
        with self.kosul:
            self.sonuclar[no] = sonuc
            self.kosul.notify_all()

    def _sirala(self):
        while self.calisiyor:
            with self.kosul:
                while self.calisiyor and self.sira not in self.sonuclar:
                    self.kosul.wait(0.2)
                if not self.calisiyor:
                    return
                s = self.sonuclar.pop(self.sira)
                self.sira += 1
            self._teslim(s)

    def _teslim(self, s):
        if "hata" in s:
            self.olay({"tur": "hata", "yon": self.ad, "mesaj": s["hata"]})
            return
        if not s.get("kaynak") or not s.get("ceviri"):
            self.olay({"tur": "anlasilamadi", "yon": self.ad, "sure": s["sure"]})
            self.olay({"tur": "durum", "yon": self.ad, "durum": "dinliyor"})
            return
        self.son_kaynak.append(s["kaynak"])
        self.son_ceviri.append(s["ceviri"])
        olay = {"tur": "ceviri", "yon": self.ad, "kaynak": s["kaynak"], "ceviri": s["ceviri"],
                "gecikme": time.perf_counter() - s["t0"], "zaman": s.get("zaman", {})}
        s["zaman"]["teslim_bekleme"] = time.perf_counter() - s["t0"] - sum(s["zaman"].values())
        if not self.calicilar:
            self.olay(olay)
            return
        ilk = []

        def parca_al(p):
            if not ilk:
                ilk.append(time.perf_counter() - s["t0"])
            for c in self.calicilar:
                c.yaz(p, TTS_SR, "tts")

        self.olay({"tur": "durum", "yon": self.ad, "durum": "konusuyor"})
        try:
            self.servis.seslendir(s["ceviri"], parca_al)
        except BaseException as e:
            self.olay({"tur": "hata", "yon": self.ad, "mesaj": f"Seslendirme: {type(e).__name__}: {e}"})
        self.olay({"tur": "iz", "yon": self.ad, "adim": "seslendirme bitti", "ilk": ilk})
        if ilk:
            olay["gecikme"] = ilk[0]   # cümlenin bitişinden İngilizce sesin başlamasına kadar
        self.olay(olay)

    def durdur(self):
        self.calisiyor = False
        with self.kosul:
            self.kosul.notify_all()
        self.havuz.shutdown(wait=False, cancel_futures=True)


class Tercuman:
    MODLAR = ("ceviri", "dogrudan", "sessiz")

    def __init__(self, ayar: dict, olay, sahte=False):
        self.a = ayar
        self.dis_olay = olay
        self.sahte = sahte
        self.mod = "ceviri"
        self.altyazi = True
        self.calisiyor = False
        self.parcalar = []
        self.kayit = None
        self._giden_sifirla = False

    # olaylar hem arayüze hem toplantı kaydına gider
    def _olay(self, o):
        # tanılama günlüğü: sorun olduğunda ne olduğunu görebilmek için her olay
        try:
            with open(ayarlar.KOK / "tanilama.log", "a", encoding="utf-8") as f:
                f.write(datetime.datetime.now().strftime("%H:%M:%S ") + json.dumps(o, ensure_ascii=False) + "\n")
        except Exception:
            pass
        if o["tur"] == "ceviri" and self.kayit:
            zaman = datetime.datetime.now().strftime("%H:%M:%S")
            kim = "BEN" if o["yon"] == "giden" else "ONLAR"
            try:
                self.kayit.write(f"[{zaman}] {kim}: {o['kaynak']}\n           -> {o['ceviri']}\n")
                self.kayit.flush()
            except Exception:
                pass
        self.dis_olay(o)

    def baslat(self, mikrofon: dict, cikis: dict, dinleme: dict | None, kendini_duy: dict | None):
        a = self.a
        self.servis = servis_olustur(a, sahte=self.sahte)
        if hasattr(self.servis, "isit"):
            self.servis.isit()
        self.calici = ses.Calici(cikis)
        self.izleme = ses.Calici(kendini_duy) if kendini_duy else None
        # izleme cihazı, altyazı için dinlenen hoparlörle aynıysa yankı kapısı devreye girer
        self.yanki_kapisi = bool(kendini_duy and dinleme and kendini_duy["name"] in dinleme["name"])
        calicilar = [self.calici] + ([self.izleme] if self.izleme else [])

        # yerel Whisper işlemciyi kullanır: her yönde tek işçi yeterli (fazlası sadece yavaşlatır)
        isci = (1 if a.get("tanima") == "whisper" else 2) if isinstance(self.servis, UcretsizServisler) else 3
        self.giden = Hat("giden", self.servis, a.get("giden_dil", "tr"), a.get("hedef_dil", "en"),
                         self._olay, calicilar, isci=isci)
        self.gelen = Hat("gelen", self.servis, a.get("gelen_dil", "en"), a.get("giden_dil", "tr"),
                         self._olay, isci=isci)
        ortak = dict(esik_carpani=a["esik_carpani"], min_esik=a["min_esik"], min_konusma_sn=a["min_konusma_sn"])
        self.giden_bolucu = ses.CumleBolucu(self.giden.ekle, a["giden_sessizlik_ms"], a["giden_max_sn"], **ortak)
        self.gelen_bolucu = ses.CumleBolucu(self.gelen.ekle, a["gelen_sessizlik_ms"], a["gelen_max_sn"], **ortak)

        self.mik_yakala = ses.Yakalayici(mikrofon, self._mikrofondan)
        self.dinle_yakala = ses.Yakalayici(dinleme, self._hoparlorden) if dinleme else None

        klasor = ayarlar.KOK / "kayitlar"
        klasor.mkdir(exist_ok=True)
        self.kayit = open(klasor / datetime.datetime.now().strftime("%Y-%m-%d_%H%M.txt"), "a", encoding="utf-8")

        self.parcalar = [p for p in (self.calici, self.izleme, self.mik_yakala, self.dinle_yakala) if p]
        for p in self.parcalar:
            p.baslat()
        self.calisiyor = True

    def _mikrofondan(self, x):
        if self._giden_sifirla:
            self.giden_bolucu.sifirla()
            self._giden_sifirla = False
        if self.mod == "ceviri":
            self.giden_bolucu.besle(x)
        else:
            self.giden_bolucu.seviye = float(abs(x).max()) if len(x) else 0.0
            if self.mod == "dogrudan":
                self.calici.yaz(x, ses.HEDEF_SR, "dogrudan")

    def _hoparlorden(self, x):
        # İngilizce sesimizi dinlediğimiz hoparlörden çalıyorsa, o sırada altyazı tarafı dinlemez
        # (yoksa kendi İngilizcemiz Türkçe altyazı olarak geri gelir)
        if self.izleme and self.yanki_kapisi and self.izleme.yakin_zamanda_caldi():
            if self.gelen_bolucu.konusuyor:
                self.gelen_bolucu.sifirla()
            self.gelen_bolucu.seviye = 0.0
            return
        if self.altyazi:
            self.gelen_bolucu.besle(x)
        else:
            self.gelen_bolucu.seviye = 0.0

    def mod_degistir(self, mod):
        if mod != self.mod:
            self.mod = mod
            self._giden_sifirla = True
            if mod == "sessiz":
                self.calici.bosalt()

    def seviyeler(self):
        if not self.calisiyor:
            return 0.0, 0.0, 0.0
        return self.giden_bolucu.seviye, self.gelen_bolucu.seviye, self.giden_bolucu.esik

    @property
    def konusuyor(self):
        return self.calisiyor and self.calici.caliyor

    def durdur(self):
        self.calisiyor = False
        for p in self.parcalar:
            p.durdur()
        for h in ("giden", "gelen"):
            if hasattr(self, h):
                getattr(self, h).durdur()
        if self.kayit:
            self.kayit.close()
            self.kayit = None

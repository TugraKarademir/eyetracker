"""Ses katmanı: cihaz listesi, yakalama (mikrofon / hoparlör loopback), çalma, yeniden örnekleme, cümle bölme."""
import collections
import threading
import time

import numpy as np
import pyaudiowpatch as pa
from scipy.signal import butter, sosfilt, sosfilt_zi

HEDEF_SR = 16000          # yazıya dökme için
CERCEVE = 480             # 30 ms @ 16 kHz

_pa = None
_pa_kilit = threading.Lock()


def pya() -> pa.PyAudio:
    global _pa
    with _pa_kilit:
        if _pa is None:
            _pa = pa.PyAudio()
        return _pa


# ---------------------------------------------------------------- cihazlar
def _wasapi_cihazlari():
    p = pya()
    w = p.get_host_api_info_by_type(pa.paWASAPI)
    for i in range(p.get_device_count()):
        d = p.get_device_info_by_index(i)
        if d["hostApi"] == w["index"]:
            yield d


def girisler():
    return [d for d in _wasapi_cihazlari() if d["maxInputChannels"] > 0 and not d.get("isLoopbackDevice")]


def loopbackler():
    return [d for d in _wasapi_cihazlari() if d.get("isLoopbackDevice")]


def cikislar():
    return [d for d in _wasapi_cihazlari() if d["maxOutputChannels"] > 0]


def bul(liste, ad: str):
    """Tam ad, sonra parça eşleşmesi (büyük/küçük harf duyarsız)."""
    if not ad:
        return None
    for d in liste:
        if d["name"] == ad:
            return d
    for d in liste:
        if ad.lower() in d["name"].lower():
            return d
    return None


def varsayilan_mikrofon():
    p = pya()
    w = p.get_host_api_info_by_type(pa.paWASAPI)
    try:
        return p.get_device_info_by_index(w["defaultInputDevice"])
    except Exception:
        g = girisler()
        return g[0] if g else None


def varsayilan_loopback():
    try:
        return pya().get_default_wasapi_loopback()
    except Exception:
        lb = loopbackler()
        return lb[0] if lb else None


def sanal_kablo():
    return bul(cikislar(), "CABLE Input")


# ------------------------------------------------------- yeniden örnekleme
class Ornekleyici:
    """Akış halinde (blok blok) örnekleme hızı dönüştürücü: alçak geçiren süzgeç + doğrusal ara değer.
    Konuşma için yeterli kalite, blok sınırlarında tıkırtı yapmaz."""

    def __init__(self, sr_giris: int, sr_cikis: int):
        self.esit = sr_giris == sr_cikis
        self.oran = sr_giris / sr_cikis
        kesim = 0.45 * min(sr_giris, sr_cikis)
        self.sos = butter(8, kesim, fs=sr_giris, output="sos")
        self.zi = sosfilt_zi(self.sos) * 0.0
        self.konum = 0.0
        self.son = 0.0

    def __call__(self, x: np.ndarray) -> np.ndarray:
        if self.esit or len(x) == 0:
            return x.astype(np.float32)
        y, self.zi = sosfilt(self.sos, x, zi=self.zi)
        n = len(y)
        uzun = np.concatenate(([self.son], y))
        t = np.arange(self.konum, n - 1 + 1e-9, self.oran)
        if len(t):
            cikti = np.interp(t + 1.0, np.arange(n + 1), uzun)
            self.konum = t[-1] + self.oran - n
        else:
            cikti = np.zeros(0)
            self.konum -= n
        self.son = y[-1]
        return cikti.astype(np.float32)


# ------------------------------------------------------------- yakalama
class Yakalayici:
    """Bir giriş (mikrofon veya loopback) cihazını açar, 16 kHz mono float32 bloklarını geri çağırıma verir."""

    def __init__(self, cihaz: dict, geri_cagir):
        self.cihaz = cihaz
        self.geri_cagir = geri_cagir
        self.kanal = max(1, min(2, int(cihaz["maxInputChannels"])))
        self.sr = int(cihaz["defaultSampleRate"])
        self.ornek = Ornekleyici(self.sr, HEDEF_SR)
        self.akis = None

    def _cb(self, veri, kare, zaman, durum):
        x = np.frombuffer(veri, dtype=np.float32)
        if self.kanal > 1:
            x = x.reshape(-1, self.kanal).mean(axis=1)
        try:
            self.geri_cagir(self.ornek(x))
        except Exception as e:  # geri çağırımdaki hata akışı öldürmesin
            print("yakalama hatası:", e)
        return (None, pa.paContinue)

    def baslat(self):
        self.akis = pya().open(
            format=pa.paFloat32, channels=self.kanal, rate=self.sr, input=True,
            input_device_index=self.cihaz["index"],
            frames_per_buffer=int(self.sr * 0.02), stream_callback=self._cb)
        self.akis.start_stream()

    def durdur(self):
        if self.akis:
            try:
                self.akis.stop_stream()
                self.akis.close()
            except Exception:
                pass
            self.akis = None


# --------------------------------------------------------------- çalma
class Calici:
    """Bir çıkış cihazına sürekli akış açar; yaz() ile verilen sesi sırayla çalar, boşken sessizlik verir."""

    def __init__(self, cihaz: dict):
        self.cihaz = cihaz
        self.kanal = max(1, min(2, int(cihaz["maxOutputChannels"])))
        self.sr = int(cihaz["defaultSampleRate"])
        self.tampon = collections.deque()
        self.bekleyen = 0
        self.kilit = threading.Lock()
        self.ornekleyiciler = {}
        self.akis = None
        self.son_calma = 0.0

    def yakin_zamanda_caldi(self, pay_sn: float = 0.6) -> bool:
        """Şu an çalıyor mu ya da az önce mi bitti (hoparlör yankısının sönmesi için pay)."""
        return self.caliyor or (time.monotonic() - self.son_calma) < pay_sn

    def yaz(self, x: np.ndarray, sr: int, kaynak: str = "tts"):
        """kaynak: her akış (tts / doğrudan) kendi örnekleyicisini kullanır ki süzgeç durumu karışmasın."""
        anahtar = (kaynak, sr)
        if anahtar not in self.ornekleyiciler:
            self.ornekleyiciler[anahtar] = Ornekleyici(sr, self.sr)
        y = self.ornekleyiciler[anahtar](x.astype(np.float32))
        if len(y):
            with self.kilit:
                self.tampon.append(y)
                self.bekleyen += len(y)

    def bosalt(self):
        with self.kilit:
            self.tampon.clear()
            self.bekleyen = 0

    @property
    def caliyor(self) -> bool:
        return self.bekleyen > 0

    def _cb(self, veri, kare, zaman, durum):
        cikti = np.zeros(kare, dtype=np.float32)
        dolu = 0
        with self.kilit:
            while dolu < kare and self.tampon:
                parca = self.tampon[0]
                al = min(kare - dolu, len(parca))
                cikti[dolu:dolu + al] = parca[:al]
                dolu += al
                if al == len(parca):
                    self.tampon.popleft()
                else:
                    self.tampon[0] = parca[al:]
            self.bekleyen -= dolu
        if dolu:
            self.son_calma = time.monotonic()
        if self.kanal > 1:
            cikti = np.repeat(cikti, self.kanal)
        return (cikti.tobytes(), pa.paContinue)

    def baslat(self):
        self.akis = pya().open(
            format=pa.paFloat32, channels=self.kanal, rate=self.sr, output=True,
            output_device_index=self.cihaz["index"],
            frames_per_buffer=int(self.sr * 0.02), stream_callback=self._cb)
        self.akis.start_stream()

    def durdur(self):
        if self.akis:
            try:
                self.akis.stop_stream()
                self.akis.close()
            except Exception:
                pass
            self.akis = None
        self.bosalt()


# ----------------------------------------------------------- cümle bölme
class CumleBolucu:
    """Enerji tabanlı, uyarlanır eşikli konuşma algılayıcı. 16 kHz blokları alır,
    bir konuşma parçası bitince parca_bitti(ses: np.ndarray) çağrılır."""

    def __init__(self, parca_bitti, sessizlik_ms=600, max_sn=12.0,
                 esik_carpani=3.0, min_esik=0.006, min_konusma_sn=0.45):
        self.parca_bitti = parca_bitti
        self.sessizlik_kare = max(1, int(sessizlik_ms / 30))
        self.max_kare = int(max_sn * 1000 / 30)
        self.esik_carpani = esik_carpani
        self.min_esik = min_esik
        self.min_konusma_kare = int(min_konusma_sn * 1000 / 30)
        self.gurultu = 0.002
        self.seviye = 0.0          # arayüzdeki ses çubuğu için
        self.sifirla()

    def sifirla(self):
        self.artik = np.zeros(0, dtype=np.float32)
        self.on_tampon = collections.deque(maxlen=10)   # 300 ms ön kayıt
        self.konusuyor = False
        self.parca = []
        self.sesli = 0
        self.sessiz = 0
        self.aday = 0

    @property
    def esik(self):
        return max(self.min_esik, self.gurultu * self.esik_carpani)

    def besle(self, x: np.ndarray):
        x = np.concatenate((self.artik, x))
        n = len(x) // CERCEVE
        for i in range(n):
            self._kare(x[i * CERCEVE:(i + 1) * CERCEVE])
        self.artik = x[n * CERCEVE:]

    def _kare(self, k: np.ndarray):
        rms = float(np.sqrt(np.mean(k * k)) + 1e-9)
        self.seviye = rms
        esik = self.esik
        if not self.konusuyor:
            # gürültü tabanını yalnızca konuşma yokken, yavaşça izle
            if rms < esik:
                self.gurultu = 0.98 * self.gurultu + 0.02 * rms
            self.on_tampon.append(k)
            if rms > esik:
                self.aday += 1
                if self.aday >= 3:
                    self.konusuyor = True
                    self.parca = list(self.on_tampon)
                    self.sesli = self.aday
                    self.sessiz = 0
            else:
                self.aday = 0
            return
        self.parca.append(k)
        if rms > esik * 0.7:
            self.sesli += 1
            self.sessiz = 0
        else:
            self.sessiz += 1
        if self.sessiz >= self.sessizlik_kare:
            self._bitir(kuyruk=self.sessiz)
        elif len(self.parca) >= self.max_kare:
            self._bitir(kuyruk=0, devam=True)

    def _bitir(self, kuyruk: int, devam: bool = False):
        parca = self.parca
        if kuyruk > 7:                      # sondaki sessizliği ~200 ms'ye indir
            parca = parca[:len(parca) - (kuyruk - 7)]
        if self.sesli >= self.min_konusma_kare and parca:
            self.parca_bitti(np.concatenate(parca))
        self.on_tampon.clear()
        self.parca = []
        self.sesli = 0
        self.sessiz = 0
        self.aday = 0
        self.konusuyor = devam

    def zorla_bitir(self):
        if self.konusuyor and self.parca:
            self._bitir(kuyruk=self.sessiz)

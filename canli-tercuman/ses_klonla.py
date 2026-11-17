"""Kendi sesinin ElevenLabs klonunu oluşturur ve kimliğini .env dosyasına yazar.

Kullanım:
  python ses_klonla.py                 # 90 sn mikrofondan kayıt al, yükle
  python ses_klonla.py --sure 120      # kayıt süresi
  python ses_klonla.py --dosya ornek.wav [ornek2.mp3 ...]   # hazır kayıtları yükle
  python ses_klonla.py --sadece-kayit  # sadece kaydet, yükleme

İpucu: sessiz bir odada, sunum yapar gibi doğal ve canlı konuş. Türkçe konuşman yeterli;
klon ses İngilizceyi de senin ses tınınla okur.
"""
import argparse
import re
import sys
import time
import wave

import numpy as np
import pyaudiowpatch as pa
import requests

import ayarlar
import ses

OKUMA_METNI = """\
Okuyabileceğin örnek metin (istersen kendi sunumundan da konuşabilirsin):

  Merhaba, bugün sizlere projemizin son durumunu anlatmak istiyorum. Geçtiğimiz üç ayda
  ekip olarak önemli adımlar attık. Öncelikle veri toplama sürecini tamamladık ve ilk
  sonuçlar oldukça umut verici görünüyor. Şimdi bu sonuçları birlikte inceleyelim.
  Burada gördüğünüz grafik, katılımcıların zaman içindeki gelişimini gösteriyor.
  Özellikle ikinci aşamada belirgin bir artış var. Peki bunun nedeni ne olabilir?
  Bizce en önemli etken, uygulamanın daha sade ve anlaşılır hale gelmesi oldu.
  Bir sonraki adımda örneklemi genişletmeyi ve sonuçları uluslararası bir dergide
  yayımlamayı planlıyoruz. Sorularınız varsa memnuniyetle yanıtlarım. Teşekkür ederim.
"""


def kaydet(sure: float, cihaz_adi: str) -> str:
    p = ses.pya()
    cihaz = ses.bul(ses.girisler(), cihaz_adi) if cihaz_adi else ses.varsayilan_mikrofon()
    if not cihaz:
        sys.exit("Mikrofon bulunamadı.")
    sr = int(cihaz["defaultSampleRate"])
    kanal = max(1, min(2, int(cihaz["maxInputChannels"])))
    print(OKUMA_METNI)
    print(f"Mikrofon: {cihaz['name']}")
    input(f"Hazır olunca Enter'a bas; {int(sure)} saniye kayıt alınacak...")
    akis = p.open(format=pa.paFloat32, channels=kanal, rate=sr, input=True,
                  input_device_index=cihaz["index"], frames_per_buffer=1024)
    parcalar = []
    bitis = time.time() + sure
    try:
        while time.time() < bitis:
            x = np.frombuffer(akis.read(1024, exception_on_overflow=False), dtype=np.float32)
            if kanal > 1:
                x = x.reshape(-1, kanal).mean(axis=1)
            parcalar.append(x)
            kalan = int(bitis - time.time())
            seviye = min(30, int(np.abs(x).max() * 60))
            print(f"\r  kalan {kalan:3d} sn  |{'#' * seviye:<30}|", end="", flush=True)
    except KeyboardInterrupt:
        print("\n(erken bitirildi)")
    finally:
        akis.stop_stream()
        akis.close()
    print()
    veri = np.concatenate(parcalar)
    tepe = float(np.abs(veri).max()) or 1.0
    veri = veri / tepe * 0.9
    yol = ayarlar.KOK / "kayitlar" / "ses_ornegi.wav"
    yol.parent.mkdir(exist_ok=True)
    with wave.open(str(yol), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((veri * 32767).astype("<i2").tobytes())
    print(f"Kaydedildi: {yol}  ({len(veri) / sr:.0f} sn)")
    if tepe < 0.05:
        print("⚠ Ses seviyesi çok düşük görünüyor; mikrofonu kontrol etmen iyi olur.")
    return str(yol)


def yukle(dosyalar: list[str], ad: str) -> str:
    anahtar = ayarlar.anahtar("ELEVENLABS_API_KEY")
    if not anahtar:
        sys.exit(".env dosyasında ELEVENLABS_API_KEY yok.")
    from pathlib import Path
    acik = [("files", (Path(d).name, Path(d).read_bytes())) for d in dosyalar]
    r = requests.post(
        "https://api.elevenlabs.io/v1/voices/add",
        headers={"xi-api-key": anahtar},
        data={"name": ad, "remove_background_noise": "true",
              "description": "Canli Tercuman icin kisisel ses"},
        files=acik, timeout=120)
    if r.status_code != 200:
        sys.exit(f"Yükleme başarısız ({r.status_code}): {r.text[:400]}\n"
                 "Not: Anlık ses klonlama ElevenLabs'te ücretli plan (Starter ve üstü) gerektirir.")
    return r.json()["voice_id"]


def env_yaz(voice_id: str):
    yol = ayarlar.KOK / ".env"
    metin = yol.read_text(encoding="utf-8") if yol.exists() else ""
    satir = f"ELEVENLABS_VOICE_ID={voice_id}"
    if re.search(r"^ELEVENLABS_VOICE_ID=.*$", metin, flags=re.M):
        metin = re.sub(r"^ELEVENLABS_VOICE_ID=.*$", satir, metin, flags=re.M)
    else:
        metin = metin.rstrip("\n") + ("\n" if metin else "") + satir + "\n"
    yol.write_text(metin, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sure", type=float, default=90)
    ap.add_argument("--cihaz", default="")
    ap.add_argument("--dosya", nargs="*")
    ap.add_argument("--ad", default="Benim sesim (tercuman)")
    ap.add_argument("--sadece-kayit", action="store_true")
    a = ap.parse_args()
    dosyalar = a.dosya or [kaydet(a.sure, a.cihaz)]
    if a.sadece_kayit:
        return
    print("ElevenLabs'e yükleniyor...")
    vid = yukle(dosyalar, a.ad)
    env_yaz(vid)
    print(f"✔ Klon ses hazır. Kimlik .env dosyasına yazıldı: {vid}")


if __name__ == "__main__":
    main()

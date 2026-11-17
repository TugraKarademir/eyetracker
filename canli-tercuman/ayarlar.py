"""Ayarlar: .env (gizli anahtarlar) + ayarlar.json (değiştirilebilir seçenekler)."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

KOK = Path(__file__).resolve().parent
load_dotenv(KOK / ".env")

VARSAYILAN = {
    # "ucretsiz" (anahtarsız) | "ucretli" (OpenAI + ElevenLabs) | "" = anahtar varsa ücretli
    "motor": "",
    # Ücretsiz mod
    "tanima": "google",                 # google (doğru, hızlı, internet) | whisper (internetsiz, zayıf)
    "whisper_modeli": "small",         # base (hızlı, zayıf) | small | large-v3-turbo (doğru, yavaş)
    "whisper_is_parcacigi": 6,
    "whisper_beam": 1,
    "edge_sesi": "en-US-AndrewNeural",
    "edge_hiz": "+5%",
    # Ücretli mod modelleri
    "yaziya_dokme_modeli": "gpt-4o-mini-transcribe",   # daha doğru: gpt-4o-transcribe
    "ceviri_modeli": "gpt-4.1-mini",                    # hızlı, akıl yürütmesiz model
    "elevenlabs_modeli": "eleven_flash_v2_5",           # en düşük gecikme
    "yedek_tts_modeli": "gpt-4o-mini-tts",              # ElevenLabs yoksa
    "yedek_tts_sesi": "alloy",
    # Cümle bölme (VAD)
    "giden_sessizlik_ms": 550,     # bu kadar sessizlik olunca cümle bitti say
    "gelen_sessizlik_ms": 500,
    "giden_max_sn": 14.0,          # çok uzun konuşmayı zorla böl
    "gelen_max_sn": 9.0,
    "esik_carpani": 3.0,           # gürültü tabanının kaç katı ses = konuşma
    "min_esik": 0.0025,            # mutlak alt eşik (RMS) — laptop mikrofonu kısık olduğu için düşük
    "min_konusma_sn": 0.45,
    # Cihaz adları (boşsa otomatik)
    "mikrofon": "",
    "cikis": "",        # boşsa adında "CABLE Input" geçen cihaz
    "dinleme": "",      # boşsa varsayılan hoparlörün loopback'i
    "kendini_duy": "",  # İngilizce sesi ayrıca kulaklıktan duymak için (boş = kapalı)
    # Altyazı penceresi
    "altyazi_font": 22,
    "altyazi_satir": 3,
    "altyazi_saydamlik": 0.88,
}


def yukle() -> dict:
    a = dict(VARSAYILAN)
    yol = KOK / "ayarlar.json"
    if yol.exists():
        a.update(json.loads(yol.read_text(encoding="utf-8-sig")))   # Not Defteri BOM ekleyebilir
    return a


def motor(a: dict) -> str:
    if a.get("motor") in ("ucretsiz", "ucretli"):
        return a["motor"]
    return "ucretli" if anahtar("OPENAI_API_KEY") else "ucretsiz"


def kaydet(a: dict) -> None:
    fark = {k: v for k, v in a.items() if VARSAYILAN.get(k) != v}
    (KOK / "ayarlar.json").write_text(
        json.dumps(fark, ensure_ascii=False, indent=2), encoding="utf-8")


def anahtar(ad: str) -> str:
    return (os.getenv(ad) or "").strip()


def sozluk() -> list[tuple[str, str]]:
    """sozluk.txt: her satır 'Türkçe = English'. # ile başlayan satırlar yorum."""
    yol = KOK / "sozluk.txt"
    if not yol.exists():
        return []
    ciftler = []
    for satir in yol.read_text(encoding="utf-8").splitlines():
        satir = satir.strip()
        if not satir or satir.startswith("#") or "=" not in satir:
            continue
        tr, en = satir.split("=", 1)
        ciftler.append((tr.strip(), en.strip()))
    return ciftler

"""Bulut servisleri: yazıya dökme + çeviri (OpenAI), seslendirme (ElevenLabs klon ses, yoksa OpenAI TTS).
--sahte modunda hiçbir servise bağlanmaz; ses yönlendirmesini ücretsiz denemek içindir."""
import io
import re
import time
import wave

import numpy as np
import requests

import ayarlar

TTS_SR = 24000

DIL_ADI = {"tr": "Turkish", "en": "English", "de": "German", "fr": "French",
           "es": "Spanish", "it": "Italian", "ar": "Arabic", "ru": "Russian"}

# Whisper ailesinin sessizlik/gürültüde uydurduğu bilinen kalıplar
UYDURMA = [
    r"altyaz[ıi]\s*m\.?\s*k\.?", r"izledi[gğ]iniz i[cç]in te[sş]ekk[uü]r", r"abone ol",
    r"thank(s| you) for watching", r"please subscribe", r"^\W*(you|bye)\W*$",
    r"^\W*$", r"amara\.org", r"subtitles by",
]


def uydurma_mi(metin: str) -> bool:
    m = metin.strip().replace("İ", "i").lower()   # Python "İ".lower() -> "i̇" (noktalı) olur
    return any(re.search(k, m) for k in UYDURMA)


def wav_bayt(ses: np.ndarray, sr: int = 16000) -> bytes:
    pcm = (np.clip(ses, -1, 1) * 32767).astype("<i2").tobytes()
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return b.getvalue()


class Servisler:
    def __init__(self, ayar: dict, sahte: bool = False):
        self.a = ayar
        self.sahte = sahte
        self.oturum = requests.Session()
        self.istemci = None
        if not sahte:
            from openai import OpenAI
            anahtar = ayarlar.anahtar("OPENAI_API_KEY")
            if not anahtar:
                raise RuntimeError(".env dosyasında OPENAI_API_KEY yok.")
            self.istemci = OpenAI(api_key=anahtar, timeout=20.0, max_retries=1)
        self.el_anahtar = ayarlar.anahtar("ELEVENLABS_API_KEY")
        self.el_ses = ayarlar.anahtar("ELEVENLABS_VOICE_ID")

    @property
    def klon_ses(self) -> bool:
        return bool(self.el_anahtar and self.el_ses)

    # ------------------------------------------------------ yazıya dökme
    def yaziya_dok(self, ses: np.ndarray, dil: str, ipucu: str = "") -> str:
        if self.sahte:
            time.sleep(0.3)
            return f"(sahte) {len(ses) / 16000:.1f} saniyelik konuşma"
        kw = dict(model=self.a["yaziya_dokme_modeli"],
                  file=("ses.wav", wav_bayt(ses), "audio/wav"),
                  language=dil, response_format="text")
        if ipucu:
            kw["prompt"] = ipucu[-800:]
        sonuc = self.istemci.audio.transcriptions.create(**kw)
        metin = sonuc if isinstance(sonuc, str) else getattr(sonuc, "text", "")
        metin = metin.strip()
        return "" if uydurma_mi(metin) else metin

    # ------------------------------------------------------------ çeviri
    def cevir(self, metin: str, kaynak: str, hedef: str, baglam: list[str], sozluk) -> str:
        if self.sahte:
            time.sleep(0.2)
            return f"[{hedef.upper()}] {metin}"
        k, h = DIL_ADI.get(kaynak, kaynak), DIL_ADI.get(hedef, hedef)
        sistem = (
            f"You are a professional simultaneous interpreter in a live online business meeting. "
            f"Translate the {k} speech-to-text transcript into natural, fluent spoken {h}. "
            f"Rules: output ONLY the translation, nothing else; keep the speaker's meaning, tone and person; "
            f"fix obvious speech-recognition errors using context; drop filler words and false starts; "
            f"if the text is already in {h}, output it cleaned up; "
            f"if the transcript is only noise or filler with no meaning, output nothing.")
        if sozluk:
            if kaynak == "tr":
                cift = [f"{a} -> {b}" for a, b in sozluk]
            else:
                cift = [f"{b} -> {a}" for a, b in sozluk]
            sistem += "\nGlossary (always use these terms):\n" + "\n".join(cift)
        if baglam:
            sistem += "\nPrevious sentences, for context only (do not translate again):\n" + "\n".join(baglam[-3:])
        model = self.a["ceviri_modeli"]
        kw = dict(model=model, max_completion_tokens=400,
                  messages=[{"role": "system", "content": sistem}, {"role": "user", "content": metin}])
        if model.startswith(("gpt-5", "o1", "o3", "o4")):
            kw["reasoning_effort"] = "minimal" if model.startswith("gpt-5") else "low"  # gecikmeyi düşük tut
            kw["max_completion_tokens"] = 1500
        else:
            kw["temperature"] = 0.2
        yanit = self.istemci.chat.completions.create(**kw)
        cikti = (yanit.choices[0].message.content or "").strip()
        return cikti.strip('"“”')

    # ------------------------------------------------------- seslendirme
    def seslendir(self, metin: str, parca_al) -> None:
        """Metni sese çevirir, hazır olan her parçayı (24 kHz float32) hemen parca_al()'a verir."""
        if self.sahte:
            self._sahte_ses(metin, parca_al)
        elif self.klon_ses:
            self._elevenlabs(metin, parca_al)
        else:
            self._openai_tts(metin, parca_al)

    @staticmethod
    def _pcm_akit(bayt_akisi, parca_al):
        artik = b""
        for b in bayt_akisi:
            if not b:
                continue
            b = artik + b
            cift = len(b) - (len(b) % 2)
            artik = b[cift:]
            if cift:
                parca_al(np.frombuffer(b[:cift], dtype="<i2").astype(np.float32) / 32768.0)

    def _elevenlabs(self, metin, parca_al):
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.el_ses}/stream"
        r = self.oturum.post(
            url, params={"output_format": "pcm_24000"},
            headers={"xi-api-key": self.el_anahtar, "Content-Type": "application/json"},
            json={"text": metin, "model_id": self.a["elevenlabs_modeli"],
                  "voice_settings": {"stability": 0.5, "similarity_boost": 0.85, "use_speaker_boost": True}},
            stream=True, timeout=20)
        if r.status_code != 200:
            raise RuntimeError(f"ElevenLabs hata {r.status_code}: {r.text[:200]}")
        self._pcm_akit(r.iter_content(chunk_size=4800), parca_al)

    def _openai_tts(self, metin, parca_al):
        with self.istemci.audio.speech.with_streaming_response.create(
                model=self.a["yedek_tts_modeli"], voice=self.a["yedek_tts_sesi"],
                input=metin, response_format="pcm") as yanit:
            self._pcm_akit(yanit.iter_bytes(4800), parca_al)

    @staticmethod
    def _sahte_ses(metin, parca_al):
        # yalnızca sahte mod; aşağıdaki gövde değişmedi
        # her kelime için kısa bir ton: yönlendirmeyi duyarak test etmek için
        t = np.arange(int(TTS_SR * 0.18)) / TTS_SR
        for i, _ in enumerate(metin.split()[:12]):
            ton = 0.25 * np.sin(2 * np.pi * (440 + 60 * (i % 4)) * t) * np.hanning(len(t))
            parca_al(np.concatenate((ton, np.zeros(int(TTS_SR * 0.06)))).astype(np.float32))
            time.sleep(0.02)


# =====================================================================
#  ÜCRETSİZ MOD: anahtar gerekmez
#   yazıya dökme  : faster-whisper, bu bilgisayarda (internetsiz)
#   çeviri        : Google Çeviri (ücretsiz uç), olmazsa MyMemory
#   seslendirme   : Microsoft Edge sesleri (edge-tts) — standart ses, klon değil
# =====================================================================
_whisper_onbellek = {}


def whisper_yukle(ad: str, is_parcacigi: int):
    """Model bir kez yüklenir; Durdur/Başlat arasında yeniden yüklenmez. İlk seferde internetten indirilir."""
    anahtar = (ad, is_parcacigi)
    if anahtar not in _whisper_onbellek:
        from faster_whisper import WhisperModel
        _whisper_onbellek[anahtar] = WhisperModel(
            ad, device="cpu", compute_type="int8", cpu_threads=is_parcacigi, num_workers=2)
    return _whisper_onbellek[anahtar]


def sozlugu_uygula(metin: str, ciftler) -> str:
    """Çeviri servisine sözlük verilemediği için terimleri çeviriden önce hedef dildeki karşılığıyla değiştirir."""
    for kaynak, hedef in ciftler:
        if kaynak:
            metin = re.sub(r"(?<!\w)" + re.escape(kaynak) + r"(?!\w)", hedef, metin, flags=re.IGNORECASE)
    return metin


class UcretsizServisler:
    klon_ses = False
    sahte = False

    GOOGLE_DIL = {"tr": "tr-TR", "en": "en-US", "de": "de-DE", "fr": "fr-FR", "es": "es-ES",
                  "it": "it-IT", "ar": "ar-SA", "ru": "ru-RU"}

    def __init__(self, ayar: dict):
        import threading
        self.a = ayar
        self._model = None
        self._model_kilit = threading.Lock()
        if ayar.get("tanima", "google") == "whisper":
            self._model_al()
        else:
            # yedek Whisper'ı arka planda hazırla (internet giderse beklemeden devreye girsin)
            threading.Thread(target=self._model_al, daemon=True).start()

    def _model_al(self):
        with self._model_kilit:
            if self._model is None:
                self._model = whisper_yukle(self.a["whisper_modeli"], self.a["whisper_is_parcacigi"])
            return self._model

    def yaziya_dok(self, ses: np.ndarray, dil: str, ipucu: str = "") -> str:
        if self.a.get("tanima", "google") == "google":
            try:
                return self._google_tanima(ses, dil)
            except Exception:
                pass   # internet yok / servis yanıt vermedi -> Whisper yedeği
        return self._whisper(ses, dil, ipucu)

    def _google_tanima(self, ses: np.ndarray, dil: str) -> str:
        import speech_recognition as sr
        tepe = float(np.abs(ses).max()) or 1.0
        pcm = (np.clip(ses / tepe * 0.9, -1, 1) * 32767).astype("<i2").tobytes()
        r = sr.Recognizer()
        # normalde ~0,9 sn; yanıt gelmezse uzun bekleme yerine hemen Whisper yedeğine geç
        r.operation_timeout = 2.5
        try:
            metin = r.recognize_google(sr.AudioData(pcm, 16000, 2), language=self.GOOGLE_DIL.get(dil, dil))
        except sr.UnknownValueError:
            return ""          # konuşma yok / anlaşılamadı (hata değil)
        metin = (metin or "").strip()
        if metin and dil == "tr":
            metin = metin[0].upper() + metin[1:]
        return metin

    def _whisper(self, ses: np.ndarray, dil: str, ipucu: str = "") -> str:
        # önceki cümleleri ipucu vermiyoruz: kısa kelimelerde Whisper onları tekrar ediyordu
        # ("Merhaba" -> "Başlayalım"). Yalnızca sözlük terimleri.
        ipucu = ", ".join(a if dil == "tr" else b for a, b in ayarlar.sozluk())
        sure = len(ses) / 16000
        bolumler, _ = self._model_al().transcribe(
            ses, language=dil, beam_size=self.a["whisper_beam"],
            initial_prompt=(ipucu[-200:] or None),
            condition_on_previous_text=False, without_timestamps=True,
            # gürültüde takılmayı önleyen korumalar:
            temperature=0.0,                       # başarısızlıkta 6 kez yeniden deneme yok
            vad_filter=True,                       # konuşma olmayan kısımları at (Silero VAD)
            vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
            max_new_tokens=int(12 * sure + 20))    # tekrar döngüsüne girerse kes
        parcalar = []
        for b in bolumler:
            if b.no_speech_prob > 0.6 and b.avg_logprob < -0.8:   # büyük olasılıkla gürültü
                continue
            parcalar.append(b.text.strip())
        metin = " ".join(parcalar).strip()
        # Whisper bazen ipucunu aynen tekrar eder
        if ipucu and metin and metin in ipucu:
            return ""
        return "" if uydurma_mi(metin) else metin

    def cevir(self, metin: str, kaynak: str, hedef: str, baglam, sozluk) -> str:
        ciftler = sozluk if kaynak == "tr" else [(b, a) for a, b in sozluk]
        metin = sozlugu_uygula(metin, ciftler)
        # Google'ın ücretsiz uçları ara sıra 429 (çok fazla istek) döner: o ucu bir süre atla, sıradakine geç.
        # Yavaş ve zayıf MyMemory yalnızca en son çare.
        simdi = time.monotonic()
        for ad, f in (("chrome", self._google_chrome), ("gtx", self._google)):
            if self._ceza.get(ad, 0) > simdi:
                continue
            try:
                sonuc = f(metin, kaynak, hedef)
                if sonuc:
                    return sonuc
            except Exception:
                self._ceza[ad] = simdi + 300
        from deep_translator import MyMemoryTranslator
        kod = {"tr": "tr-TR", "en": "en-GB"}
        return (MyMemoryTranslator(source=kod.get(kaynak, kaynak),
                                   target=kod.get(hedef, hedef)).translate(metin) or "").strip()

    _oturum = requests.Session()
    _ceza = {}

    def _google_chrome(self, metin, kaynak, hedef) -> str:
        r = self._oturum.get(
            "https://clients5.google.com/translate_a/t",
            params={"client": "dict-chrome-ex", "sl": kaynak, "tl": hedef, "q": metin}, timeout=3)
        r.raise_for_status()
        v = r.json()
        parca = v[0] if isinstance(v, list) and v else v
        if isinstance(parca, list):      # [metin, algılanan_dil] biçimi
            parca = parca[0]
        return str(parca or "").strip()

    def _google(self, metin, kaynak, hedef) -> str:
        r = self._oturum.get(
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": kaynak, "tl": hedef, "dt": "t", "q": metin}, timeout=3)
        r.raise_for_status()
        return "".join(p[0] for p in r.json()[0] if p and p[0]).strip()

    def seslendir(self, metin: str, parca_al) -> None:
        edge_seslendir(metin, self.a["edge_sesi"], self.a["edge_hiz"], parca_al)

    def isit(self):
        """İlk istekteki bağlantı kurma gecikmesini (6+ sn olabiliyor) toplantı başlamadan öde."""
        import threading

        def calis():
            for f in (lambda: edge_seslendir("Hi.", self.a["edge_sesi"], self.a["edge_hiz"], lambda p: None),
                      lambda: self.cevir("merhaba", "tr", "en", [], [])):
                try:
                    f()
                except Exception:
                    pass

        threading.Thread(target=calis, daemon=True).start()


def edge_seslendir(metin: str, ses_adi: str, hiz: str, parca_al) -> None:
    import asyncio
    import edge_tts
    import miniaudio

    verilen = [0]   # şimdiye kadar çalmaya gönderilen örnek sayısı

    def coz(b: bytes) -> np.ndarray:
        try:
            d = miniaudio.decode(b, output_format=miniaudio.SampleFormat.FLOAT32,
                                 nchannels=1, sample_rate=TTS_SR)
            return np.frombuffer(d.samples, dtype=np.float32)
        except Exception:
            return np.zeros(0, dtype=np.float32)

    def gonder(x: np.ndarray, son: bool):
        # son birkaç MP3 çerçevesini tut (yarım gelmiş olabilir), akış bitince hepsini ver
        sinir = len(x) if son else len(x) - 2400
        if sinir > verilen[0]:
            parca_al(x[verilen[0]:sinir].copy())
            verilen[0] = sinir

    async def al():
        b = bytearray()
        cozulen = 0
        loop = asyncio.get_running_loop()
        # Normalde ilk ses ~0,9 sn'de gelir; bazen bağlantı 6+ sn takılır. 2,5 sn'de ses yoksa
        # bırak ve yeni bağlantıyla dene. İlk ses gelince tamamı için süre tanı.
        async with asyncio.timeout(2.5) as sure:
            iletisim = edge_tts.Communicate(metin, ses_adi, rate=hiz, connect_timeout=3, receive_timeout=4)
            async for p in iletisim.stream():
                if p["type"] == "audio":
                    if not b:
                        sure.reschedule(loop.time() + 6 + len(metin) / 40)
                    b.extend(p["data"])
                    # ~0,5 sn'lik ses birikince çalmaya başla, tamamını bekleme
                    if len(b) - cozulen >= 3000:
                        cozulen = len(b)
                        gonder(coz(bytes(b)), son=False)
        if b:
            gonder(coz(bytes(b)), son=True)
        return len(b)

    zaman_asimli = al

    # Edge servisi ara sıra boş yanıt döner ya da takılır: 2 kez daha dene, olmazsa Windows sesine geç
    for deneme in range(3):
        try:
            if asyncio.run(zaman_asimli()):
                return
        except Exception:
            pass
        if verilen[0]:
            return      # sesin bir kısmı çaldı; tekrar denemek cümleyi iki kez okutur
        time.sleep(0.15 * (deneme + 1))
    windows_seslendir(metin, parca_al)


def windows_seslendir(metin: str, parca_al) -> None:
    """İnternetsiz yedek: Windows'un yerleşik İngilizce sesi (SAPI, ör. Microsoft Zira)."""
    import comtypes
    import comtypes.client
    comtypes.CoInitialize()
    try:
        konusmaci = comtypes.client.CreateObject("SAPI.SpVoice")
        for s in konusmaci.GetVoices():
            if "en-US" in s.GetDescription() or "English" in s.GetDescription():
                konusmaci.Voice = s
                break
        akis = comtypes.client.CreateObject("SAPI.SpMemoryStream")
        akis.Format.Type = 22            # SAFT24kHz16BitMono
        konusmaci.AudioOutputStream = akis
        konusmaci.Speak(metin)
        veri = bytes(akis.GetData())
        parca_al(np.frombuffer(veri[:len(veri) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0)
    finally:
        comtypes.CoUninitialize()


def servis_olustur(ayar: dict, sahte: bool = False):
    if sahte:
        return Servisler(ayar, sahte=True)
    if ayar.get("motor") == "ucretsiz":
        return UcretsizServisler(ayar)
    return Servisler(ayar)

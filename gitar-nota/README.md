# Gitar Nota 🎸

MP3 yükle → yapay zekâ gitarı ayırır → gitarı **aç / kapat / solo** yaparak çal, tab ve akorları takip et.

## Ne yapar
- **Ayrıştırma:** Demucs `htdemucs_6s` ile şarkı → `guitar.mp3` + `backing.mp3` (gitar hariç her şey)
- **Mikser:** Gitar Açık / Kapalı / Solo + ses seviyesi, altyapı seviyesi
- **Tab:** Basic Pitch (Spotify, ONNX) ile gitar notaları → standart akorda tel/perde yerleşimi (Viterbi, el kaydırmasını en aza indirir); kayan tab, sürükleyerek sarma
- **Akorlar:** gitar+piyano+bas chroma → 24 majör/minör akor, şu anki + sıradaki akor diyagramı, ölçü ölçü akor kâğıdı
- **Çalışma araçları:** perde korumalı hız (50–110 %), A-B döngü, klavye kısayolları (Boşluk, G, ←/→)
- **İndir:** MIDI, ASCII tab (.txt), gitarsız MP3, sadece gitar MP3

## Çalıştır
```
.venv\Scripts\python app.py
```
Bilgisayarda http://localhost:8766 · telefonda (aynı Wi-Fi) http://<PC-IP>:8766

## Kurulum (Python 3.12)
```
py -3.12 -m venv .venv
.venv\Scripts\pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\pip install --no-deps basic-pitch
```

## Doğruluk (sentetik test: `python make_test.py && python evaluate.py`)
- Akor zaman-doğruluğu ≈ %90
- Nota F1 ≈ 0.60 (onset ±50 ms) — tab bir başlangıç noktasıdır, birebir değil
- İşleme: CPU'da şarkı süresinin ≈ 0.6–1 katı

## Sınırlar
- Ritim ve solo gitar tek kanalda; iki gitarlı şarkılarda tab karışık olabilir
- Akorlar yalnızca majör/minör (7'li, sus vb. yok); akort standart E kabul edilir
- Distorsiyonlu gitarda nota tanıma zayıflar, akorlar daha güvenilirdir

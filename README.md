# Göz İzleme ve Isı Haritası Uygulaması

Webcam tabanlı göz izleme, ısı haritası ve AOI analizi yapan web uygulaması.
Tüm kapsam, algoritmalar ve kararlar için bkz. [`GOZ_IZLEME_SPEC.md`](GOZ_IZLEME_SPEC.md).

## Durum

- **Faz 0 — Kurulum:** ✓ Tamamlandı (Django + yerel HTTPS çalışıyor)
- Sonraki: Faz 1 — Katılımcı prototipi (jsPsych + WebGazer)

### Netleşen kararlar (spec §14)
- Materyal ilerleme: öğrenci **"Devam"** düğmesiyle geçer
- Katılım: **uzaktan** (öğrencinin kendi bilgisayarı)

## Geliştirme ortamı (Windows)

Gereksinimler: Python 3.12, Git.

```powershell
# Sanal ortamı oluştur ve bağımlılıkları kur
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# Veritabanı migrasyonları
.venv\Scripts\python.exe manage.py migrate

# Yerel sunucuyu HTTPS ile başlat (kamera erişimi HTTPS gerektirir)
.venv\Scripts\python.exe manage.py runserver_plus --cert-file cert.crt 127.0.0.1:8000
```

Ardından tarayıcıda <https://localhost:8000> açılır. Kendinden imzalı
sertifika kullanıldığı için tarayıcı bir güvenlik uyarısı gösterir; geliştirmede
"devam et" denilerek geçilebilir.

## Proje yapısı

| Yol | Amaç |
|---|---|
| `gaze_tracker/` | Django proje ayarları ve URL'ler |
| `core/` | Ortak sayfalar (şu an: sağlık kontrolü) |
| `gaze_analysis/` | Django'dan bağımsız analiz paketi (Faz 4'te dolacak) |
| `GOZ_IZLEME_SPEC.md` | Proje şartnamesi (ana kaynak) |

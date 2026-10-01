# Göz İzleme ve Isı Haritası Uygulaması

Webcam tabanlı göz izleme, ısı haritası ve AOI analizi yapan web uygulaması.
Tüm kapsam, algoritmalar ve kararlar için bkz. [`GOZ_IZLEME_SPEC.md`](GOZ_IZLEME_SPEC.md).

## Durum

- **Faz 0 — Kurulum:** ✓ Tamamlandı (Django + yerel HTTPS çalışıyor)
- **Faz 1 — Katılımcı prototipi:** ✓ Tamamlandı (jsPsych + WebGazer; tek materyal, kalibrasyon, doğrulama; veri JSON olarak iner)
- Sonraki: Faz 2 — Sunucu modelleri ve veri kaydı

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

### Katılımcı deneyini çalıştırma (Faz 1)

Göz izleme prototipi: <https://localhost:8000/dene/>

Gerçek bir **webcam** gerekir. Akış: onam → cihaz kontrolü → tam ekran →
kamera başlatma → 9 noktalı kalibrasyon → 5 noktalı doğrulama → materyal
("Devam" ile geçilir). Bitişte bakış verisi **JSON olarak bilgisayara iner**
(bu fazda sunucuya kayıt yoktur). Kamera görüntüsü hiçbir yere gönderilmez;
yalnızca bakış koordinatları toplanır.

> **Not (geliştirme):** `runserver_plus` varsayılan yeniden-yükleyicisi,
> yeniden başlatıldığında arka planda sürecek bir alt süreç bırakabilir ve
> eski sürümü sunmaya devam edebilir. Tek seferlik test için sunucuyu durdurup
> yeniden başlatırken 8000 portunda dinleyen eski `python.exe` süreçlerinin
> kapandığından emin olun.

## Proje yapısı

| Yol | Amaç |
|---|---|
| `gaze_tracker/` | Django proje ayarları ve URL'ler |
| `core/` | Ortak sayfalar (şu an: sağlık kontrolü) |
| `experiment/` | Katılımcı deneyi (jsPsych + WebGazer); `/dene/` sayfası ve örnek materyal |
| `gaze_analysis/` | Django'dan bağımsız analiz paketi (Faz 4'te dolacak) |
| `GOZ_IZLEME_SPEC.md` | Proje şartnamesi (ana kaynak) |

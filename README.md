# Göz İzleme ve Isı Haritası Uygulaması

Webcam tabanlı göz izleme, ısı haritası ve AOI analizi yapan web uygulaması.
Tüm kapsam, algoritmalar ve kararlar için bkz. [`GOZ_IZLEME_SPEC.md`](GOZ_IZLEME_SPEC.md).

## Durum

- **Faz 0 — Kurulum:** ✓ Tamamlandı (Django + yerel HTTPS çalışıyor)
- **Faz 1 — Katılımcı prototipi:** ✓ Tamamlandı (jsPsych + WebGazer; tek materyal, kalibrasyon, doğrulama; veri JSON olarak iner)
- **Faz 2 — Sunucu ve veri kaydı:** ✓ Tamamlandı (Study/Material/Session/GazeSample modelleri, JSON API, çok materyalli çalışma, Django admin öğretmen paneli)
- **Faz 3 — AOI çizim aracı:** ✓ Tamamlandı (Canvas ile dikdörtgen/çokgen çizimi, 0–1 normalize koordinatlar, çakışma uyarısı). Panel: `/panel/`
- **Faz 4 — Analiz motoru + Excel:** ✓ Tamamlandı (I-DT fiksasyon, AOI metrikleri, 6 sayfalı Excel + uzun-format CSV). Panelden "Excel/CSV indir".
- **Faz 5 — Isı haritaları, sıcak bölge, rapor:** ✓ Tamamlandı (süre-ağırlıklı Gauss ısı haritası, katılımcı ağırlık eşitleme, AOI dışı sıcak bölge önerisi, AOI sıralaması, sınırlılık notu). Panelden "Rapor".
- **Faz 6 — Kalite ve ara kontroller:** ✓ Yazılım tamamlandı (dışlama kuralları: doğrulama hatası / kayıp veri / geçerli materyal oranı; kalite raporu; her 3 materyalde ara kontrol). **Pilot (5–10 kişi) manuel adımdır** — bkz. [`PILOT.md`](PILOT.md).

### Hızlı başlangıç (Faz 2)

```powershell
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py seed_demo      # ogretmen hesabi + aktif demo calisma
.venv\Scripts\python.exe manage.py runserver --noreload localhost:8000
```
- **Öğretmen paneli (admin):** <http://localhost:8000/admin/> — `ogretmen` / `ogretmen1234` (yerel geliştirme; değiştirin). Çalışma oluştur, materyal yükle, katılım linkini ve oturumları gör.
- **Katılım linki:** admin'de çalışmanın "Katilim baglantisi" alanında (`/dene/<kod>/`). Bu sayfa çok materyalli çalışmayı çalıştırır ve veriyi **sunucuya** kaydeder.
- Faz 1 tek-materyal demo (`/dene/`, sunucuya kayıt yok) geriye uyumlu durur.

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

# Yerel sunucuyu başlat (kamera testi için; bkz. aşağıdaki not)
.venv\Scripts\python.exe manage.py runserver --noreload localhost:8000
```

Ardından tarayıcıda <http://localhost:8000> açılır.

### Katılımcı deneyini çalıştırma (Faz 1)

Göz izleme prototipi: **<http://localhost:8000/dene/>**

Gerçek bir **webcam** gerekir ve **Chrome veya Edge** kullanılmalıdır. Akış:
onam → cihaz kontrolü → tam ekran → kamera başlatma → 9 noktalı kalibrasyon →
5 noktalı doğrulama → materyal ("Devam" ile geçilir). Bitişte bakış verisi
**JSON olarak bilgisayara iner** (bu fazda sunucuya kayıt yoktur). Kamera
görüntüsü hiçbir yere gönderilmez; yalnızca bakış koordinatları toplanır.

> **Neden HTTP ve neden `localhost`?** Kamera erişimi (getUserMedia) yalnızca
> "güvenli bağlam"da çalışır. Tarayıcılar **`http://localhost`**'u güvenli bağlam
> sayar (spec §11), bu yüzden yerel testte sertifikaya gerek yoktur. Kendinden
> imzalı HTTPS sertifikası (`runserver_plus`) tam tersine tarayıcıda sertifika
> hatası doğurur ve kamerayı engeller — bu yüzden **yerel testte düz HTTP +
> `localhost` kullanın**. (Not: `127.0.0.1` de güvenli bağlamdır, ama alışkanlık
> olması için `localhost` tercih edilir.)
>
> **Uzaktan katılım (ileride):** İnternet üzerinden gerçek katılımcılar için
> **gerçek, güvenilir bir HTTPS sertifikası** gerekir (ör. Let's Encrypt).
> Bu, Faz 2'de barındırma kararıyla birlikte ele alınacaktır.

#### `runserver` vs `runserver_plus`

Yerel kamera testi için yukarıdaki **düz `runserver`** yeterli ve en sorunsuzudur.
Yalnızca HTTPS'i yerelde denemek isterseniz `runserver_plus --cert-file cert.crt`
kullanılabilir; ancak kendinden imzalı sertifika kamerayı engelleyebilir ve
yeniden-yükleyicisi arka planda sürüp eski sürümü sunan bir alt süreç bırakabilir.
`--noreload` bu sorunu önler.

## Proje yapısı

| Yol | Amaç |
|---|---|
| `gaze_tracker/` | Django proje ayarları ve URL'ler |
| `core/` | Ortak sayfalar (şu an: sağlık kontrolü) |
| `experiment/` | Katılımcı deneyi (jsPsych + WebGazer); `/dene/` demo ve `/dene/<kod>/` çalışma |
| `studies/` | Veri modelleri (Study/Material/Session/GazeSample), kayıt API'si, admin paneli |
| `gaze_analysis/` | Django'dan bağımsız analiz paketi: geometry, preprocessing, fixation (I-DT), aoi_metrics, excel, config |
| `GOZ_IZLEME_SPEC.md` | Proje şartnamesi (ana kaynak) |

# webcam-eye-tracking-jspsych (based on WebGazer)

Web kamerası tabanlı göz izleme ile **ekran dikkat dağılımı** ölçen, açık kaynak
bir araştırma altyapısı. jsPsych + WebGazer.js ile deney akışı; sunucu tarafında
Django ile veri kaydı, ilgi alanı (AOI) analizi, ısı haritaları, fiksasyon tespiti
(I-DT) ve istatistik-hazır CSV çıktıları. Daha yüksek doğruluk için tarayıcı-içi
**MediaPipe iris** motoru alternatif olarak sunulur.

> **Gizlilik:** Kamera görüntüsü **tarayıcıdan hiç çıkmaz** — kaydedilmez ve sunucuya
> gönderilmez. Yalnızca tahmini bakış koordinatları saklanır.

*An open-source research toolkit for webcam-based eye tracking of on-screen attention
(jsPsych + WebGazer.js; Django backend for storage, AOI analysis, heatmaps, I-DT
fixations, and analysis-ready CSVs). An in-browser MediaPipe-iris engine is provided
as a higher-accuracy alternative. The camera image never leaves the browser.*

---

## Araştırma çerçevesi (Research questions)

- **RQ1 — Fizibilite:** jsPsych + WebGazer.js webcam sisteminin üniversite öğrencisi
  örnekleminde 9-nokta kalibrasyon tamamlama, geçerli-veri üretim, **kadran / geniş-AOI
  düzeyinde tespit doğruluğu** ve oturum tamamlama düzeyleri.
- **RQ2 — Materyal türü × kaynak:** Farklı materyallerin (video, zihin haritası,
  infografik; insan vs. yapay zekâ tasarımı) dikkat dağılımı göstergeleri üzerindeki
  etkileri — ilgili/ilgisiz AOI'de toplam **dwell**, **ilk ilgili AOI'ye süre**,
  **ilgili↔ilgisiz geçiş oranı**.
- **RQ3 — Bilişsel yük ilişkisi:** Dikkat göstergeleri ile **Leppink dışsal bilişsel
  yük** (extraneous load) puanları arasındaki ilişki.

Panelden her RQ için istatistik-hazır CSV iner: **RQ1** (fizibilite, motor bazında),
**RQ2** (katılımcı × materyal dikkat DV'leri + faktörler), **RQ3** (dikkat + Leppink
alt ölçekleri; korelasyona hazır).

## Mimari

| Bileşen | Açıklama |
|---|---|
| `experiment/` | Katılımcı tarafı: jsPsych + WebGazer (`study.js`, varsayılan) ve MediaPipe iris (`study_mp.js`) runner'ları; tanı sayfası `/iris-test/` |
| `studies/` | Veri modelleri (Study/Material/AOI/Session/GazeSample/CognitiveLoadResponse), kayıt API'si, öğretmen paneli, analiz adaptörü |
| `gaze_analysis/` | **Django'dan bağımsız** analiz paketi: geometry, preprocessing, fixation (I-DT), aoi_metrics, heatmap, hotspots, report, quality, excel |
| `pupil_bridge/` | (İsteğe bağlı) DIY IR göz izleyici (Pupil Core) köprüsü — aynı API/analiz |

**İki gaze motoru, tek veri formatı:** Her iki runner da aynı kayıt API'sine aynı
normalize bakış örneğini yazar; bu yüzden analiz/AOI/ısı haritası/rapor zinciri motordan
bağımsızdır. `Study.settings`'te `{"gaze_engine": "mediapipe"}` ile motor değiştirilir
(varsayılan `webgazer`).

## Kurulum (Windows; Linux/macOS benzer)

Gereksinim: Python 3.12, Git, güncel Chrome/Edge (masaüstü).

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py seed_demo          # ogretmen hesabi + aktif demo
.venv\Scripts\python.exe manage.py runserver --noreload localhost:8000
```

- **Öğretmen paneli:** <http://localhost:8000/panel/> ve Django admin
  <http://localhost:8000/admin/> (`seed_demo`: `ogretmen` / `ogretmen1234` — **yerel
  geliştirme; üretimde değiştirin**).
- **Katılım linki:** admin'de çalışmanın katılım kodu → `/dene/<kod>/`.

> **Yerel kamera testi neden düz HTTP + `localhost`?** getUserMedia yalnızca güvenli
> bağlamda çalışır; tarayıcılar `http://localhost`'u güvenli bağlam sayar. **Uzaktan
> gerçek katılımcılar için gerçek bir HTTPS sertifikası** (ör. Let's Encrypt) gerekir.

## İnternetsiz (offline) kurulum

Deney tarafı tüm tarayıcı bağımlılıkları (jsPsych, WebGazer, MediaPipe modeli/wasm)
**projeye gömülüdür** (`experiment/static/experiment/vendor/`), CDN gerekmez. Sadece
Python paketleri için offline wheel'ler taşınır.

**İnternetli makinede** (bir kez):
```powershell
.venv\Scripts\python.exe -m pip download -r requirements.txt -d offline_wheels
```
Sonra tüm proje klasörünü (**`.venv` hariç**, `offline_wheels/` dahil) offline makineye kopyala:
```powershell
robocopy <kaynak> <hedef> /E /XD .venv
```

**İnternetsiz makinede** (Python 3.12 kurulu olsun):
```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install --no-index --find-links=offline_wheels -r requirements.txt
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py runserver --noreload localhost:8000
```
> Wheel'ler platforma özgüdür: indirme ve çalıştırma makineleri **aynı OS + Python 3.12**
> olmalı (ör. ikisi de Windows x64). Verilerini/materyallerini taşımak için `db.sqlite3`
> ve `media/` klasörünü de kopyala.

## Kullanım akışı

1. Admin'de **Çalışma** oluştur, **Materyal** yükle (tür: infografik/zihin-haritası/**video**;
   kaynak: insan/YZ), çalışmayı **Aktif** yap.
2. `/panel/` → her materyalde **AOI çiz**; AOI'leri admin'de **ilgili/ilgisiz** işaretle.
3. Katılımcı `/dene/<kod>/` ile girer: onam → kalibrasyon → doğrulama → materyaller
   ("Devam"/video sonu) → her materyalden sonra **Leppink** anketi → veri sunucuya kaydedilir.
4. `/panel/` → **Rapor** (ısı haritası, AOI sıralaması, kalite + RQ1 tablosu) ve
   **RQ1/RQ2/RQ3 CSV** indir.

## Kalite güvencesi

- **Kalite kapısı:** doğrulama eşiği (varsayılan: hata ≤ ekran genişliğinin %10'u)
  geçilmeden veri toplanmaz; eşik `Study.settings.max_validation_error_ratio` ile ayarlanır.
- **Dışlama kuralları (spec §7):** doğrulama hatası / kayıp veri oranı / geçerli materyal
  oranı. Dışlanan veri **silinmez**, yalnızca grup analizine alınmaz.
- **Drift/ofset ölçümü:** materyal öncesi bilinen-hedef görevi; sistematik kayma ölçülüp
  çıkarılır (MediaPipe runner).

## Gizlilik ve etik

- Kamera görüntüsü **tarayıcıdan çıkmaz**; yalnızca bakış koordinatları saklanır.
- Katılımcıdan **bilgilendirilmiş onam** alınır; ad yerine **katılımcı kodu** kullanılır.
- Bakış verisi kişisel veri olarak ele alınır; HTTPS, rol bazlı erişim, saklama/silme
  süreçleri kurumsal etik ve **KVKK** gerekleriyle uyumlu yürütülmelidir.
- Araştırma kullanımı için **etik kurul onayı** alınır.

## Testler

```powershell
.venv\Scripts\python.exe manage.py test          # Django + analiz birim testleri
```

## Sınırlılık (önemli)

Web kamerası tabanlı göz izleme **bölge/geniş-AOI düzeyinde** yorumlanmalıdır; kelime/satır
düzeyi bireysel kesinlik sağlamaz. Bireysel ısı haritaları gürültülüdür; güvenilir sonuç
**çok katılımcılı grup eğilimlerinden** elde edilir. WebGazer.js doğruluğu tüketici
donanımda sınırlı olabilir (bkz. RQ1); daha iyi yatay doğruluk için MediaPipe motoru sunulur.

---

## License

**GPLv3** (GNU General Public License v3.0 or later). Bu yazılım GPLv3 lisanslı
**WebGazer.js** kullandığından, türetilen/dağıtılan tüm çalışma GPLv3'tür. Ayrıntı için
[`LICENSE`](LICENSE). *This project is licensed under the GPLv3 (because it uses WebGazer.js,
GPLv3). See `LICENSE`.*

### Üçüncü taraf / Third-party
- **WebGazer.js** — GPLv3
- **jsPsych** — MIT
- **MediaPipe Tasks (FaceLandmarker)** — Apache-2.0
- **Django, NumPy, SciPy, Matplotlib, openpyxl, Pillow** — kendi (izin veren) lisansları

## Atıf / Citation

Bu depo bir makaleye eşlik eder; yazar bilgileri gizli tutulmaktadır.
*This repository accompanies a manuscript; author details are intentionally omitted.*

```
[AUTHORS]. (2026). webcam-eye-tracking-jspsych (based on WebGazer):
An open-source webcam eye-tracking toolkit for on-screen attention research. [Software].
```

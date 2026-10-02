# DIY IR Göz İzleyici (Pupil Core) Entegrasyonu — Faz 8

Amaç: Ucuz, **başa-takılan DIY IR** göz izleyici (açık kaynak **Pupil Core**) ile
**bireysel doğru** ısı haritası. Webcam'in rastgele drift sınırını aşar (~1–2°).

> Tüm analiz/AOI/ısı haritası/Excel/rapor (Faz 2–6) **aynen** çalışır. Bu entegrasyon
> yalnızca **yakalama katmanını** değiştirir: Pupil'in ekran-yüzeyine eşlenmiş bakışını
> `pupil_bridge.py` okuyup mevcut `/api/session/.../veri/` ucumuza POST eder.

## 1. Donanım — satın al + 3D bas + lehimle

DIY Pupil başlığı: **1 göz kamerası (IR) + 1 sahne kamerası + 3D-baskı tutucu**.
Resmi rehber (parçalar + CAD + montaj): <https://docs.pupil-labs.com/core/diy/>

**Alınacaklar (~€30–100):**
| Parça | Öneri | Not |
|---|---|---|
| Göz kamerası | Küçük **UVC USB kamera modülü** (ör. ELP mini modül) | IR-kesme filtresi **çıkarılır**; 850nm IR LED eklenir (pupil siyah net) |
| Sahne kamerası | Başka bir küçük **UVC USB webcam** | Ekranı görür (surface/işaretçi takibi için) |
| IR LED | 850nm + uygun direnç | Göz kamerasının yanına |
| Tutucu | **3D-baskı** Pupil DIY mount (CAD resmi dokümanda) | Senin yazıcın var |
| Çerçeve | Gözlük çerçevesi / baskı | Kameraları taşır |
| Kablolar | USB uzatma, ince kablo, kablo bağı | |

Alternatif göz/sahne kamerası: de-case edilmiş **Logitech C525/C270** veya **Microsoft HD-6000** (topluluk önerisi). UVC olması şart (Pupil tanısın).

> **Tek göz kamerası yeterli** (monoküler) — doğruluk biraz düşer ama DIY için pratik.

## 2. Yazılım — Pupil Capture (bedava, açık kaynak)

1. Pupil Capture'ı indir/kur: <https://github.com/pupil-labs/pupil/releases>
2. Göz kamerasını seç → pupil tespitini doğrula (göz bebeği kırmızı daire ile işaretlenmeli).
3. **Calibration** yap (ekran işaretçileriyle).
4. **Surface Tracker** eklentisini aç. Ekranda **materyalin gösterildiği alanın**
   köşelerine **AprilTag işaretçileri** (Pupil'den yazdırılır) yapıştır ve bir
   **yüzey tanımla**; adını `materyal` koy.
   - Böylece `gaze_on_surfaces.norm_pos` = **materyale göre 0–1** koordinat olur.

## 3. Köprüyü çalıştır

```bash
pip install -r requirements.txt
python pupil_bridge.py --server http://localhost:8000 --study-code <KOD> \
    --material-id <MATERYAL_ID> --surface materyal --participant pilot1 --screen 1920x1080
```

- Django sunucusu çalışıyor olmalı; `--study-code` aktif çalışmanın katılım kodu.
- `--material-id`: admin'deki materyalin id'si (v1 tek materyale akıtır).
- Katılımcı başlığı takar, ekrandaki materyale bakar; köprü bakışı sunucuya yazar.
- Ctrl+C → oturum "tamamlandı" işaretlenir. Sonra panelden **Rapor/Isı haritası**.

## 4. Akış (bu v1)

Pupil Capture (yüzey bakışı) → ZMQ → `pupil_bridge.py` → `/api/session/.../veri/`
→ DB → mevcut analiz (I-DT, AOI, ısı haritası, Excel).

## 5. Sınırlar / sonraki adım

- **v1 tek materyale** akıtır (uçtan uca doğrulama için). Çoklu materyalde her
  materyalin zaman penceresini tarayıcıdan sunucuya bildirip bakışı zamana göre
  materyale atamak gerekir — hazır olunca eklenir.
- Köprü, CSRF token'ı `/dene/<kod>/` sayfasından alır (sunucu değişikliği gerekmez).
- **Önce donanımı kur**, Pupil Capture gözünü/pupili görüp yüzeyi tanısın; sonra
  köprüyü çalıştır. Takıldığın yerde ekran görüntüsüyle gel, birlikte çözeriz.

## İş bölümü
- **Sen:** 3D baskı + kamera modifiyesi (IR filtre çıkar + LED) + montaj + Pupil
  Capture'da pupil/surface kurulumu.
- **Ben:** köprü yazılımı (hazır), çoklu-materyal senkronu, sunucu tarafı, ve
  tüm analiz/rapor zinciri (zaten hazır).

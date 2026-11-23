# Yönetim ekranı (araştırmacı paneli) — tasarım

Tarih: 2026-11-23 · Proje: DersNabzı (E:\eyetracker) · Dal: bakis-kalibrasyon

## Amaç ve neden

Tez sorusu: insan ve yapay zekâ (YZ) tasarımı öğretim materyallerinin dikkat dağılımına ve dışsal bilişsel yüke etkisi.
Bugün her ders bitince `data/<KOD>.json` yazılıyor ve tek bir ders raporu (`report.html`) var. Dersler arası karşılaştırma,
materyal bazında ayrım, öğrenci başına ısı haritası, ham bakış verisi ve kurulum bilgisi yok.

İstenen: **bizim sistemin yapısına göre** (canlı ders → materyal → öğrenci) kalıcı veri ve bir yönetim ekranı.
RealEye paneli fikir kaynağı (veri grafiği, ısı haritası, dikkat/duygu, kalite, kurulum), kopyası değil.

## Hedefler

1. Her ders kalıcı olarak SQLite'a yazılır (canlı durum bugünkü gibi bellek + JSON'da kalır).
2. Öğretmen ders sırasında **hangi materyalin ekranda olduğunu** işaretler; her örnek o anki materyalle etiketlenir.
   Her materyalin türü vardır: `insan` | `yz` | `diger`.
3. Öğrenci başına saklanan veri:
   - mevcut 2 sn'lik ölçüler: dikkat, enerji, duygu, yüz var/yok, ekrana bakmıyor, göz kapalı, sekme gizli, bölge payları (AOI), materyal içi bakış noktaları;
   - **yeni:** tam ekran bakış örnekleri (pencereye göre 0–1 x,y + zaman, ~10 Hz) → veri grafiği ve fiksasyon için;
   - **yeni:** her kalibrasyonun raporu (hata px, 3×3 isabet, yöntem, zaman, kaba/iyi);
   - **yeni:** kurulum: kamera çözünürlüğü/fps, ekran/pencere/DPR/tam ekran, tarayıcı, MediaPipe uzaklık tahmini, işleme fps;
   - **yeni:** baş sapması ve baş uyarısı sayısı (bakış testindeki uyarının derse taşınması ayrı iş; burada yalnız alan açılır).
4. Yönetim ekranı görünümleri (aşağıda).
5. Materyal türüne göre (insan / YZ) tüm dersleri birleştiren karşılaştırma ve SPSS/R için CSV dışa aktarma.

## Hedef dışı (bu iş değil)

- RealEye'daki video gibi kayıt oynatma, AOI çizimi, K-katsayısı → sonraki aşama (şema buna engel olmamalı).
- Masaüstü uygulaması, işlemeyi Worker'a taşıma, doğruluk iyileştirmeleri → ayrı projeler.
- Bakış testi (`bakis_test.html`, `gazelab.db`) kayıtlarının bu ekrana taşınması → sonra; şimdilik ayrı kalır.

## Kaçınılacaklar (çalışsa bile başarısızlık sayılır)

- **Yalan veri yok:** tahmini/eksik veri ölçülmüş gibi gösterilmez. Her sayının yanında kaynağı ve örnek sayısı (n) olur;
  kalibre olmayan ya da kaba (coarse) kalibrasyonlu öğrencinin bakışı ısı haritasına ve bakış ölçülerine girmez, "veri yok" yazar.
  Derece değerleri "tahmin" etiketiyle gösterilir.
- Demo öğrencilerin verisi kalıcı kayda girmez.
- Ders sırasında öğrenci veya öğretmen arayüzü yavaşlamaz (kayıt sunucuda, toplu ve kısa yazılır).

## Kısıtlar

- Sunucu: Python standart kütüphane (`http.server`, `sqlite3`); yeni çerçeve yok. Sayfalar: düz HTML/JS (mevcut `report.html` gibi).
- Kişisel veri: öğrenci adı + bakış + duygu kalıcı saklanır → etik onay ve onam metninde yazmalı.
  Yönetim ekranı **parola (yönetici anahtarı)** ister; ayrıca "adları gizle" seçeneği (öğrenci kodu gösterilir).
  Sunucu yalnız yerelde çalışıyor (127.0.0.1:8030); bu korunur.
- Veri hacmi: 30 öğrenci × 40 dk × 10 Hz ≈ 720 bin bakış örneği/ders → satır başına değil, **öğrenci × 2 sn paketi** olarak saklanır
  (~36 bin satır/ders).

## Yaklaşımlar

| | Yaklaşım | Artı | Eksi |
|---|---|---|---|
| A | Ders JSON dosyalarını genişletmek | Basit, bugünkü yapı | Dersler arası sorgu her seferinde tüm dosyaları açar; dosya ~10 MB/ders |
| **B** | **SQLite + yönetim ekranı** | İnsan/YZ karşılaştırması tek sorgu; CSV kolay; sunucuda sqlite zaten var | İlk kurulum biraz daha büyük |

**Seçilen: B** (kullanıcı onayladı). Ek karar: ekran RealEye kopyası değil, bizim ders yapısına göre.

## Veri modeli (öneri; kurucu sadeleştirebilir)

Ayrı dosya: `data/dersler.db` (test veritabanı `test_kayitlari/gazelab.db` ayrı kalır).

- `lessons(code PK, name, topic, created, ended, teacher_meta JSON)`
- `materials(id PK, lesson_code, idx, name, kind['insan'|'yz'|'diger'], image_path NULL)`
- `material_spans(lesson_code, material_id, t_start, t_end)` — öğretmen materyal değiştirdikçe
- `students(lesson_code, sid, name, anon_code, joined, demo=0)`
- `setups(lesson_code, sid, t, setup JSON)` — değiştikçe yeni satır
- `calibrations(lesson_code, sid, t, report JSON)` — her kalibrasyonda
- `samples(lesson_code, sid, t, material_id NULL, attention, energy, emotion, face, away, eyes_closed, tab_hidden, gaze_cal, share JSON, mat_pts JSON, gaze JSON, head JSON)`
  - `gaze`: o 2 sn'deki tam ekran örnekleri `[[dt_ms, x, y], ...]` (x,y pencereye göre 0–1)
- `events(lesson_code, sid NULL, t, kind, data JSON)` — el kaldırma, sohbet, tepki, uyarı, konu değişimi, ders başla/bitir
- Ders bitince `lessons.ended` yazılır; canlı JSON aynen kalır (geri uyum).

Materyal etiketi `samples`a yazılırken o anki `material_spans`tan alınır (sunucu bilir).

## Öğretmen tarafı: materyal işaretleme

- Ders oluştururken ya da ders sırasında öğretmen panelinde **Materyaller** listesi: ad + tür (insan / YZ / diğer), isteğe bağlı görsel (ısı haritası arka planı için).
- Listede "Şimdi bu" düğmesi; seçili materyal öğretmen panelinde ve kayıt şeridinde görünür. Hiçbiri seçili değilse örnekler `material_id = NULL`.
- Görsel yoksa ısı haritası boş 16:9 tuval üzerine çizilir (bugünkü 32×18 ızgara).

## Yönetim ekranı görünümleri

Adres: `/admin.html` (yönetici anahtarı ister). Üst çubukta: ders seçici, "adları gizle", CSV.

1. **Dersler** — tablo: tarih, ders adı, konu, süre, öğrenci (gerçek) sayısı, materyal sayısı (insan/YZ), ort. dikkat, kalibreli öğrenci oranı.
   Filtre: tarih aralığı, ad/konu araması, materyal türü.
2. **Ders** — üstte zaman çizelgesi: sınıf ortalaması dikkat/enerji, duygu dağılımı şeridi, arka planda materyal şeritleri (insan/YZ renkli),
   olay işaretleri (uyarı, el kaldırma, sohbet). Altında:
   - **Materyaller** tablosu: tür, ekranda kalma süresi, materyale bakma %, ort. dikkat, baskın duygu, fiksasyon sayısı/ort. süresi, n (kalibreli öğrenci), küçük ısı haritası.
   - **Öğrenciler** tablosu: kalite notu, son kalibrasyon hatası, kamerada görünme %, örnekleme Hz, ort. dikkat, baskın duygu, materyale bakma %, el/sohbet sayısı.
3. **Materyal** — büyük ısı haritası (materyal görseli üzerine). Seçenekler: tüm öğrenciler / tek öğrenci; veri: tüm bakışlar / fiksasyonlar;
   görünüm: ısı haritası / sis; zaman aralığı kaydırıcısı. Yanında özet ölçüler (n ile).
4. **Öğrenci** (dersin içinde) — sekmeler:
   - *Kalite:* kamerada görünme %, bakışın ekranda olma %, örnekleme Hz, kalibrasyon(lar) ve hata, baş uyarıları, kalite notu.
   - *Veri grafiği:* zaman ekseninde X ve Y (ekranın %'si), bakış hızı (°/s, tahmin etiketi), fiksasyon/sakkad şeritleri, materyal şeridi;
     altında dikkat, enerji, duygu çizgileri. Zaman aralığı seçilince fiksasyon sayısı, ort. süre, sakkad sayısı.
   - *Isı haritası:* bu öğrencinin materyal başına ısı haritası.
   - *Kurulum:* cihaz, tarayıcı, ekran/pencere/DPR/tam ekran, kamera çözünürlüğü/fps, işleme fps, uzaklık tahmini (zaman içinde değişimleriyle).
   - *Olaylar:* ham olay kaydı.
5. **Karşılaştırma (insan vs YZ)** — tüm dersler (filtrelenebilir) boyunca materyal türüne göre: materyale bakma %, fiksasyon sayısı/süresi,
   ort. dikkat, enerji, duygu dağılımı; öğrenci başına eşleştirilmiş değerler (aynı öğrenci hem insan hem YZ gördüyse).
   CSV (uzun biçim: ders × öğrenci × materyal × ölçü) ve ham örnek CSV.

Fiksasyon/sakkad: bakış testindeki `GL.ivt` (I-VT, 30°/s, 80–400 ms) yeniden kullanılır; derece dönüşümü tahmin olarak etiketlenir.

## Kalite notu (öğrenci × ders)

Bakış testindeki ölçülere benzer, açık kurallarla: kamerada görünme %, kalibreli zaman %, son kalibrasyon hatası, örnekleme Hz.
Eşikler sayfada yazılı gösterilir (gizli formül yok). Not yalnız filtre ve uyarı içindir; veri silmez.

## Kullanıcının kararları (kurucu kontrolünden sonra)

- **Öğrenci kimliği = katılımcı kodu.** Araştırmacı her öğrenciye kalıcı bir kod verir (ör. P01). Öğrenci derse girerken adının
  yanında bu kodu yazar; kod dersler arasında aynı kalır. Şema: `participants(code PK, created)` + `students.participant_code`.
  Eşleştirilmiş (aynı öğrencide insan/YZ) analiz ve CSV bu koda göre yapılır; "adları gizle" açıkken kod gösterilir.
  Kodsuz giren öğrenci de kaydedilir ama karşılaştırmada "kodsuz" olarak ayrı tutulur (eşleştirmeye girmez).
  Katılımcı kodları yönetim ekranından oluşturulur/listelenir; katılma ekranında kod biçimi doğrulanır (bilinmeyen kod uyarı verir).
- **Materyal = tek slayt/görsel, öğretmen yükler.** Öğretmen ders öncesi (ya da derste) slaytları tek tek görsel olarak yükler
  (PNG/JPG), her birine ad ve tür (insan/YZ/diğer) verir; derste "Şimdi bu" ile değiştirir. Görseller `data/materyaller/<KOD>/`
  altında saklanır. Isı haritası o görselin üstüne çizilir. Yayın alanıyla görselin en-boy oranı farklıysa noktalar görselin
  gösterilen içerik dikdörtgenine göre eşlenir (kurucu, `pts`'nin u,v tanımını öğretmen yayın karesinin içerik alanıyla doğrular).
  Görselsiz materyal de olabilir (ısı haritası boş 16:9 tuvalde, "görsel yok" notuyla).
  Yükleme stdlib ile: tek dosyalık POST (gövde = görsel baytları, ad/tür sorgu parametresi), boyut sınırı (ör. 10 MB), yalnız öğretmen anahtarıyla.

## Tasarımcının kararları (kurucu kontrolünden sonra; kullanıcı itiraz edebilir)

- **Erişim:** yönetim sayfası ve tüm yönetim API'leri yalnız `127.0.0.1`/`::1`'den yanıt verir (bugünkü test CSV dışa aktarımı gibi);
  yerel ağ dinleyicisi açık olsa bile. Üstüne yönetici anahtarı: ilk çalıştırmada üretilir, `data/yonetici_anahtari.txt`'ye yazılır
  (gitignore), konsolda bir kez gösterilir; `DERSNABZI_ADMIN_KEY` ortam değişkeni varsa o kullanılır. Öğretmen anahtarından ayrıdır.
- **Kaba / kalibresiz öğrenci:** bugünkü gibi bakış noktası gönderilmez; örnekte `gaze_cal=0` ve `coarse=1` bayrağı saklanır
  (kaç dakika veri olmadığı raporlanabilsin). Ham bakış yalnız iyi kalibrasyonda kaydedilir.
- **WebGazer ikinci modeli:** `samples` içinde `wg_share JSON` alanı olarak saklanır (bugün sunucu zaten tutuyor; yöntem karşılaştırması için).

## Kurucuya bırakılanlar

- Grafik/ısı haritası çizimi (düz canvas; mevcut `report.html` kodundan yararlanılabilir).
- Şemanın son hali, indeksler, eski `data/*.json` derslerinin içe aktarılıp aktarılmayacağı (öneri: tek seferlik içe aktarma betiği; ham bakış olmadığı için "bakış verisi yok" işaretiyle).
- Öğrenci tarafında `gaze.flush()`'a tam ekran örneklerin eklenmesi (bugün yalnız materyal içi noktalar gidiyor) ve kurulum/kalibrasyon raporunun gönderimi.

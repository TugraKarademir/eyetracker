# Webcam Göz İzleme ve Isı Haritası Uygulaması: Proje Şartnamesi

> Bu belge Claude Code'un projeyi geliştirirken başvuracağı ana kaynaktır.
> Formül, eşik veya kapsam değişikliği gerektiğinde önce kullanıcıya sor.

## 1. Amaç

Öğrenci, öğretmenin hazırladığı materyali bilgisayar ekranında incelerken, bilgisayarın **dahili web kamerasıyla** ekranın nerelerine baktığını tarayıcıda tahmin eden bir web uygulaması. Uygulama:

1. bakış verisini toplar ve sunucuya kaydeder,
2. veriyi **Excel'e** aktarır,
3. tek öğrenci ve sınıf düzeyinde **ısı haritaları** üretir,
4. öğretmenin tanımladığı **ilgi alanları (AOI)** için dikkat metriklerini hesaplar,
5. materyalin **en çok dikkat çeken ve gözden kaçan bölgelerini** otomatik raporlar.

**Kapsam dışı (v1):** kelime düzeyinde okuma analizi, mobil cihaz ve tabletler, kaydırmalı ya da etkileşimli web sayfaları, kamera görüntüsünün kaydedilmesi.

**Temel sınırlılık:** Web kamerası tabanlı göz izleme bölge düzeyinde doğruluk sağlar. WebGazer'ın orijinal çalışmasında en iyi modelin ortalama hatası yaklaşık 130 pikseldir. Tüm tasarım kararları ve raporlardaki yorum dili bu sınırlılığa göre kurulur.

## 2. Kullanıcılar

| Rol | Yapabildikleri |
|---|---|
| Öğretmen / araştırmacı | Çalışma oluşturur, materyal yükler, AOI çizer, katılım bağlantısı üretir, sonuçları ve ısı haritalarını görür, Excel indirir |
| Öğrenci / katılımcı | Bağlantıyla girer, onam verir, kalibrasyon yapar, materyalleri inceler; sisteme hesapla giriş yapmaz |

## 3. Teknoloji yığını

- **Katılımcı tarafı:** jsPsych + WebGazer uzantısı (`@jspsych/extension-webgazer`) ve hazır eklentiler:
  - `plugin-webgazer-init-camera` (kamera başlatma ve yüz konumlandırma)
  - `plugin-webgazer-calibrate` (kalibrasyon)
  - `plugin-webgazer-validate` (doğruluk ve kesinlik ölçümü)
- **Sunucu:** Python 3.12 + Django (yönetim paneli, kimlik doğrulama, ORM)
- **Veritabanı:** PostgreSQL (geliştirmede SQLite)
- **Analiz:** NumPy, pandas, SciPy; ayrı ve Django'dan bağımsız bir Python paketi (`gaze_analysis/`)
- **Görselleştirme:** Matplotlib (ısı haritası PNG), panelde Canvas/Chart.js
- **AOI çizim aracı:** Tarayıcıda HTML Canvas (dikdörtgen ve çokgen)
- **Excel:** openpyxl
- **Geliştirme ortamı:** Windows; kod ve değişken adları İngilizce, arayüz dili Türkçe

> Kullanıcının jsPsych + WebGazer ile yürüyen bir göz izleme çalışması var. Uygun olan kod ve ayarlar yeniden kullanılabilir; başlamadan önce sor.

## 4. Veri modeli (ana tablolar)

- **Study** (çalışma): ad, açıklama, öğretmen, ayarlar (eşikler, gösterim süresi), katılım bağlantısı kodu, durum
- **Material** (materyal): çalışma, sıra, görsel dosyası (PNG/JPG; PDF sayfaları görsele dönüştürülür), özgün genişlik ve yükseklik, gösterim süresi
- **AOI**: materyal, ad (ör. "Başlık", "Grafik", "Metin 1"), şekil türü, koordinatlar (**0–1 arası normalize**), renk
- **Session** (oturum): çalışma, katılımcı kodu, tarayıcı, ekran ve görüntü alanı çözünürlüğü, devicePixelRatio, başlangıç ve bitiş zamanı, durum
- **CalibrationResult**: oturum, deneme no, doğrulama noktası başına ortalama hata (px ve normalize), kesinlik, geçti/kaldı
- **GazeSample** (ham örnek): oturum, materyal, t (materyal başlangıcından itibaren ms), x_px, y_px (görüntü alanına göre), x_norm, y_norm (materyale göre, 0–1), materyal içinde mi
- **Fixation**: oturum, materyal, başlangıç, süre, x_norm, y_norm, isabet ettiği AOI
- **AnalysisRun**: çalışma, tarih, kullanılan ayarlar, uygulama sürümü

## 5. Katılımcı akışı

1. **Giriş ve onam:** Bilgilendirilmiş onam metni; onay verilmezse oturum başlamaz. Ad yerine katılımcı kodu kullanılır.
2. **Cihaz kontrolü:** Masaüstü veya dizüstü bilgisayar, güncel Chrome veya Edge, görüntü alanı en az 1280×720. Uygun değilse nazik bir uyarıyla durdurulur.
3. **Tam ekran** moduna geçiş.
4. **Kamera izni ve yüz konumlandırma** (`webgazer-init-camera`). Işık, mesafe (50–70 cm) ve kameranın ekranın üstünde olması için kısa yönergeler.
5. **Kalibrasyon** (`webgazer-calibrate`): 9 nokta, tıklama ile.
6. **Doğrulama** (`webgazer-validate`): 5 nokta. Ortalama hata eşiği aşarsa yeniden kalibrasyon yapılır (en fazla 2 kez). Hâlâ geçemezse oturum "düşük kalite" olarak işaretlenir ama veri yine toplanır.
7. **Materyaller:** Her materyalden önce ortada 1 saniyelik bir odak artısı gösterilir. Materyal sabit boyutta, ortalanmış ve kaydırmasız gösterilir; en-boy oranı korunur (letterbox).
8. **Ara kontroller:** Her 3 materyalde bir tek noktalı hızlı doğrulama yapılır; hata büyümüşse yeniden kalibrasyon önerilir.
9. **Bitiş:** Veri sunucuya gönderilir. Gönderim başarısız olursa yeniden denenir ve yerel yedek tutulur.

## 6. Veri toplama kuralları

- **Kamera görüntüsü hiçbir zaman kaydedilmez ve sunucuya gönderilmez.** Yalnızca bakış koordinatları gönderilir.
- Örnekleme WebGazer'ın sağladığı en yüksek hızda yapılır; **gerçek örnekleme hızı** her oturum için hesaplanıp kaydedilir.
- Koordinatlar hem görüntü alanına göre (px) hem de **materyale göre normalize** (0–1) kaydedilir. Tüm analizler normalize koordinatlarla yapılır; böylece farklı ekran boyutlarındaki veriler birleştirilebilir.
- Yüzün algılanmadığı ya da tahminin gelmediği anlar "kayıp veri" olarak işaretlenir.

## 7. Veri kalitesi

Tüm eşikler çalışma ayarlarından değiştirilebilir; aşağıdakiler varsayılandır ve pilot veriyle yeniden ayarlanmalıdır.

| Kontrol | Varsayılan |
|---|---|
| Doğrulama ortalama hatası | Görüntü alanı genişliğinin en fazla %10'u |
| Materyal başına kayıp veri oranı | %30'dan fazlaysa o materyal verisi dışlanır |
| Oturum başına geçerli materyal oranı | %50'den azsa oturum dışlanır |

- **Kalite raporu:** Her katılımcı için doğrulama hatası, kayıp veri oranı, örnekleme hızı ve dışlanma nedeni.
- Dışlanan veri silinmez; yalnızca analize alınmaz.

## 8. Analiz

### 8.1 Ön işleme
- Geçersiz ve materyal dışı örnekler ayrılır.
- İsteğe bağlı hareketli medyan filtresi (varsayılan pencere: 3 örnek).

### 8.2 Fiksasyon tespiti: I-DT (dağılım eşiği) algoritması
- Minimum süre: 100 ms
- Dağılım eşiği: materyal genişliğinin %5'i (normalize)
- İki parametre de ayarlanabilir. Web kamerası gürültülü olduğu için pilot veriyle kontrol edilmeli.

### 8.3 Isı haritası
- Fiksasyonlardan, **süreyle ağırlıklandırılmış Gauss çekirdek yoğunluğu** ile üretilir.
- Çekirdek genişliği (σ): varsayılan materyal genişliğinin %4'ü; web kamerası hatasıyla uyumlu olacak şekilde ayarlanabilir.
- **Grup haritasında her katılımcının toplam ağırlığı eşitlenir.** Aksi hâlde uzun bakan ya da çok veri üreten katılımcılar haritaya hâkim olur.
- Harita yarı saydam olarak materyalin üzerine bindirilir.
- Ek görseller: ham bakış noktaları, fiksasyon sırası (scanpath).

### 8.4 AOI metrikleri (katılımcı × AOI ve grup ortalaması)

| Metrik | Tanım |
|---|---|
| Toplam bakma süresi | AOI içindeki fiksasyon sürelerinin toplamı (ms) |
| Bakma oranı | Toplam bakma süresi / materyaldeki toplam fiksasyon süresi (%) |
| İlk fiksasyona kadar geçen süre | Materyal başlangıcından AOI'deki ilk fiksasyona kadar geçen süre (ms) |
| Fiksasyon sayısı | AOI içindeki fiksasyon sayısı |
| Ziyaret sayısı | AOI'ye kaç kez ayrı ayrı girildiği |
| İsabet oranı | AOI'ye en az bir kez bakan katılımcıların oranı (grup düzeyi) |

- AOI kenarlarına isteğe bağlı **tampon payı** eklenebilir (web kamerası hatası nedeniyle; varsayılan 0).
- AOI'ler çakışırsa uyarı verilir.

### 8.5 Otomatik "dikkat çeken bölgeler" raporu
- AOI'ler grup düzeyinde bakma oranına ve ilk fiksasyon süresine göre sıralanır: **en çok dikkat çeken** ve **gözden kaçan** AOI'ler.
- AOI dışında kalan **sıcak bölgeler** ısı haritasından otomatik bulunur (en yüksek yoğunluklu %10'luk alan) ve öğretmene yeni AOI önerisi olarak gösterilir.
- Raporun başında sabit bir sınırlılık notu yer alır: "Web kamerası tabanlı göz izleme bölge düzeyinde yorumlanmalıdır."

## 9. Excel çıktısı

Tek dosya, şu sayfalarla:

| Sayfa | İçerik |
|---|---|
| Katilimcilar | Oturum bilgileri ve kalite göstergeleri |
| Ham_Veri | Tüm bakış örnekleri |
| Fiksasyonlar | Tespit edilen fiksasyonlar ve isabet ettiği AOI |
| AOI_Metrikleri | Katılımcı × AOI metrikleri |
| AOI_Ozet | Grup düzeyi AOI metrikleri ve sıralama |
| Ayarlar | Kullanılan tüm eşikler, algoritma parametreleri, uygulama sürümü (yeniden üretilebilirlik için) |

- Excel'in bir sayfada en fazla 1.048.576 satır sınırı var. Ham veri bunu aşarsa materyal başına ayrı sayfalara bölünür ya da ham veri ayrıca CSV olarak verilir.
- R ve SPSS için uzun formatta CSV dışa aktarımı da sunulur.
- Isı haritaları PNG olarak ayrıca indirilebilir.

## 10. Gizlilik, etik ve lisans
- Kamera görüntüsü tarayıcıdan çıkmaz; yalnızca koordinatlar saklanır.
- Bakış verisi kişisel veri olarak ele alınır: HTTPS, rol bazlı erişim, saklama süresi, silme talebi desteği.
- Katılımcı reşit değilse veli onamı gerekir. Araştırma amaçlı kullanımda etik kurul onayı alınır.
- KVKK uyumu kurumun hukuk birimiyle netleştirilir.
- **WebGazer GPLv3 lisanslıdır.** Uygulama dağıtılacaksa lisans yükümlülükleri (kaynak kodun açılması) dikkate alınır.

## 11. Teknik gereksinimler
- Kamera erişimi için **HTTPS zorunludur** (yerel geliştirmede `localhost` hariç).
- Desteklenen tarayıcılar: güncel Chrome ve Edge (masaüstü).
- Katılımcı için önerilen ortam: iyi ve önden gelen ışık, arkada pencere olmaması, yüzün kamerada ortalanması.

## 12. Doğrulama ve test
- **Birim testleri:** Bilinen fiksasyon dizisi içeren sentetik veriyle I-DT, AOI isabeti ve metrik hesapları test edilir.
- **Koordinat dönüşümü testleri:** Farklı ekran boyutları ve devicePixelRatio değerleriyle normalize koordinatların doğruluğu test edilir.
- **Bilinen hedef görevi:** Pilotta katılımcılardan ekrandaki bilinen noktalara bakmaları istenir; gerçek doğruluk ölçülür.
- **Pilot çalışma:** 5–10 kişiyle doğrulama hatası dağılımı çıkarılır; kalite eşikleri ve fiksasyon parametreleri buna göre ayarlanır.
- **Excel testi:** Büyük veriyle satır sınırı davranışı kontrol edilir.

## 13. Geliştirme aşamaları

Her aşama bitince testler çalıştırılır, kullanıcı onayı alınır ve Git'e commit edilir.

| Faz | Kapsam | Bitti sayılması için |
|---|---|---|
| 0 | Kurulum: Django, Git, sanal ortam, yerel HTTPS | Yerel sunucu HTTPS ile açılıyor |
| 1 | **Katılımcı prototipi:** jsPsych + WebGazer; tek materyal, kalibrasyon, doğrulama; veriyi JSON olarak indirme | Gerçek bakış verisi toplanıp indirilebiliyor |
| 2 | Sunucu: çalışma, materyal ve oturum modelleri; veri kaydı; öğretmen paneli | Çok materyalli çalışma uçtan uca kaydediliyor |
| 3 | AOI çizim aracı | Öğretmen AOI çizip adlandırabiliyor |
| 4 | Analiz motoru (`gaze_analysis/`) + Excel çıktısı | Sentetik veri testleri geçiyor |
| 5 | Isı haritaları, sıcak bölge tespiti, rapor ekranı | Grup ısı haritası ve AOI sıralaması görülebiliyor |
| 6 | Kalite raporları, ara kontroller, iyileştirmeler, pilot | 5–10 kişilik pilot tamamlandı |

## 14. Açık kararlar (başlamadan netleştir)
- [ ] Materyal süresi sabit mi (ör. 20 saniye), yoksa öğrenci "Devam" ile mi geçecek?
- [ ] Katılım nerede olacak: laboratuvar mı, öğrencinin kendi bilgisayarı mı (uzaktan)?
- [ ] Katılımcıların yaş grubu (onam türünü belirler)
- [ ] Barındırma: üniversite sunucusu mu, bulut mu?
- [ ] İleride Moodle bağlantısı (LTI 1.3) gerekecek mi?

## 15. Claude Code için çalışma kuralları
- Her faza başlamadan önce kod yazmadan bir **plan** çıkar ve onay al.
- Bu belgedeki algoritmaların, metrik tanımlarının ve eşiklerin dışına çıkma; gerekirse sor.
- Analiz kodunu arayüz kodundan ayrı tut.
- Her yeni özelliği test yazmadan tamamlanmış sayma.
- Kamera görüntüsünü kaydeden ya da gönderen hiçbir kod yazma.
- Windows'ta çalıştırılabilirliği koru.

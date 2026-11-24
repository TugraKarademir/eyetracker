# Bakış testi: ısı testi ve istatistik görünümleri — tasarım

Tarih: 2026-11-24 · Dosya: `static/bakis_test.html` (+ gerekirse yeni `static/isi_testi.js`)

## Amaç
Kullanıcı, yönetim ekranındaki (RealEye tarzı) görünümleri tek sayfada, kendi kalibrasyonuyla denemek istiyor:
bir görsele bakarken toplanan bakıştan ısı haritası, veri grafiği, dikkat/duygu, AOI raporu ve verinin hangi koşulda
(tarayıcı boyutu, süre, iletim/örnekleme hızı) toplandığı.

## Kullanıcının kararları
- Görsel: teste başlarken dosya seçilir (bir ya da birden çok slayt; her biri tam ekran gösterilir).
- Yer: kontrol noktalarından sonra yeni adım "Isı testi" (adım göstergesine eklenir); sonra sonuç ekranında görünümler.
- Yöntem seçilebilir: varsayılan ana model; listeden ölçülen diğer yöntemler (RealEye Light, WebGazer yöntemi, …) seçilince
  ısı haritası ve grafikler o yöntemin bakışıyla yeniden çizilir.
- Görünümler: (1) ısı haritası / sis, (2) veri grafiği, (3) dikkat ve duygular, (4) AOI raporu,
  (5) **toplama koşulları**: tarayıcı/pencere boyutu, ekran, DPR, tam ekran, görüntülenme süresi, örnekleme Hz, işlenen kare/sn,
  işleme yeri (işçi/ana), işçi gecikmesi, kamera çözünürlüğü/fps, yakınlaştırma, uzaklık.

## Davranış
- Dosya seçimi: kalibrasyon başlamadan (başlangıç kartında) "Isı testi görselleri" alanı; seçilmezse ısı testi adımı atlanır
  (adım listesinde görünmez). Her görsel için süre: **varsayılan 15 sn** (öneri; kartta değiştirilebilir 5–60 sn).
- Gösterim: görsel ekrana sığdırılır (en-boy korunur, ortalanır); gösterilen içerik dikdörtgeni kaydedilir, bakış noktaları
  görsele göre (0–1) çevrilir. Görsel dışı bakışlar "görsel dışı" sayılır, ısı haritasına girmez ama yüzdesi gösterilir.
- Toplama: her karede tüm yöntemlerin tahmini (mevcut `glTahmin` ile aynı) zaman damgasıyla saklanır; ayrıca dikkat/enerji/duygu
  (sayfada var olan analiz ve HSEmotion açıksa) aynı zaman çizgisinde. **Hiçbir model bu adımda öğrenmez**; tahmin noktası gösterilmez.
- Kayıt: ısı testi verisi oturum kaydına (sunucuya giden test kaydı ve gazelab.db) eklenir; görsel dosyaları gönderilmez,
  yalnız adı, boyutu ve gösterim dikdörtgeni.

## Görünümler (sonuç ekranında "🔥 Isı testi" düğmesi)
- Üstte: görsel seçici, yöntem seçici, zaman aralığı kaydırıcısı.
- Isı haritası / sis: tüm bakışlar ya da fiksasyonlar (I-VT, GazeLab ayarları); nokta boyutu, saydamlık.
- Veri grafiği: X/Y (görselin %'si), hız °/s (tahmin etiketi), fiksasyon/sakkad şeritleri; örnekleme ~13 Hz altındaysa
  sakkad "ölçülemez"; yanında numaralı bakış yolu; seçili aralıkta fiksasyon sayısı (I-VT parçası), ort. süre.
- Dikkat ve duygular: zaman çizgileri; veri yoksa "veri yok".
- AOI raporu: görsel üstüne dikdörtgen çizerek bölge ekle/sil; her bölge için ilk bakışa kadar süre (TTFF), kalma süresi,
  bakış payı %, fiksasyon sayısı, ziyaret sayısı — her değerin yanında n; bölgeler oturum kaydına yazılır.
- Toplama koşulları tablosu (yukarıdaki liste) + CSV (ısı testi ham bakışları ve AOI sonuçları).

## Kurallar
- Yalan veri yok: her ölçüde n; eksik → "veri yok"; derece "tahmin"; düşük örneklemede sakkad "ölçülemez".
- Ölçüm sırasında tahmin/ısı gösterilmez; görünümler yalnız adım bittikten sonra.
- Mevcut kalibrasyon/ölçüm akışı ve sonuçları değişmez.

## Hedef dışı
- Yönetim ekranına (ders verisine) bağlama; birden çok katılımcının ısı haritasını birleştirme.

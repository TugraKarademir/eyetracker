# DersNabzı — Geliştirme Önerileri (birleşik rapor)

Tarih: 18.11.2026. Bu dosya altı ajan raporunun özeti ve önceliklendirilmiş yol haritasıdır. Ayrıntı ve kaynaklar:

| Rapor | İçerik |
|---|---|
| [guvenlik_denetimi.md](guvenlik_denetimi.md) | Güvenlik denetimi (bir kısmı çalıştırılarak doğrulandı) |
| [kod_inceleme.md](kod_inceleme.md) | Kod incelemesi (bir kısmı çalıştırılarak doğrulandı) |
| [literatur_1_ilgi_ogrenme_durumlari.md](literatur_1_ilgi_ogrenme_durumlari.md) | İlgi / öğrenme durumu tespiti — 30 makale |
| [literatur_2_bakis_takibi.md](literatur_2_bakis_takibi.md) | Web kamerası bakış takibi — 32 makale |
| [literatur_3_yuz_ifadesi_goz_kapanmasi.md](literatur_3_yuz_ifadesi_goz_kapanmasi.md) | Yüz ifadesi, valence/arousal, göz kapanması — 33 makale |
| [literatur_4_el_kaldirma_etik.md](literatur_4_el_kaldirma_etik.md) | El kaldırma, gizlilik, etik, AB Yapay Zekâ Yasası — 28 makale |

**Okuma düzeyi (dürüst sayım):** 123 makale listelendi; **51'i tam metin**, 72'si yalnızca özet/künye. Bazı kaynaklara erişilemedi (reCAPTCHA, 403, büyük PDF); bunlar raporlarda işaretli. Hiçbir sayı bu birleşik raporda yeniden üretilmedi; sayılar ajan raporlarındaki kaynaklara dayanır. Ajan raporlarını ben (ana oturum) yalnızca kod tarafında doğruladım: `server.py:493` negatif uzunluk, `server.py:533` önek kontrolü, `analyzer.js:35-45` duraklat/devam yarışı, `learnstate.js:28-37` tabanın durumu yutması, `student.js:66` duygu kategorisinin öğretmene gitmesi. Literatür sayıları tarafımdan kaynağa karşı kontrol edilmedi. AI Act'in "Dijital Omnibus" değişikliğine dair tarih bilgisi ajan raporundandır, doğrulanmadı.

---

## Literatürden çıkan beş ana ders

1. **Gerçekçi tavan orta.** Gerçek sınıfta, görülmemiş öğrencide sıkılma / kafa karışıklığı / hayal kırıklığı tespiti AUC ≈ 0,61–0,65 (0,5 = şans). Kural tabanlı sistemlerin performansına dair hiçbir kanıt yok. (Lit. 1, Bosch 2016)
2. **Olumsuz duygu sınıfları gerçek videoda neredeyse çalışmıyor.** Aynı model ailesinde Korku F1 0,016, Öfke 0,15, Şaşkınlık 0,30. Senin nötr yüzünde %20–40 Üzüntü/Korku okunması bununla uyumlu. (Lit. 3, Savchenko 2022)
3. **Ekrana bakmak ≠ dikkat; web kamerası bakışı kaba.** Tarayıcı bakış takibi ≈ 4° hata (60 cm'de ≈ 4 cm), oturumda büyüyor; güvenle ≤ 4 büyük bölge ayrılabiliyor (bizde 7 var). Baş pozu bakışın ≈ %69'unu açıklıyor. (Lit. 2)
4. **Kamera açısı göz ölçümünü bozuyor.** Baş 30° öne eğilince göz açıklığı belirgin düşüyor; MediaPipe eyeBlink için yayınlanmış doğruluk yok. Doğru yaklaşım: belirsizse "bilinmiyor" demek. (Lit. 2–3)
5. **Etik/yasal çerçeve.** AB Yapay Zekâ Yasası Md. 5(1)(f), eğitim kurumlarında yüzden duygu çıkarmayı 2 Şubat 2025'ten beri yasaklıyor (tıbbi/güvenlik istisnası dar). Yalnız Türkiye'de kullanılan sisteme doğrudan uygulanmıyor, ama AB ortaklı ders/yazılım paylaşımında devreye girebilir. KVKK'da biyometrik veri özel nitelikli. Öğretmene canlı analitiğin öğrenmeyi artırdığına dair en güçlü kanıt **kameradan değil, yazılım loglarından** geliyor. (Lit. 4, Holstein 2018)

---

## Yol haritası

### P0 — Hatalar (düşük efor, hemen)

| # | Ne | Nerede | Kaynak |
|---|---|---|---|
| 1 | Demo öğrencileri toplamlardan, ısı haritasından, uyarılardan, rapordan ayır | `server.py` `aggregate`, `gaze_agg`, `add_heat`, uyarılar, `build_report` | Kod (doğrulandı) |
| 2 | Negatif `Content-Length` → sınırsız okuma | `server.py:493` (`n < 0` kontrolü) | Güvenlik Y2 (doğrulandı) |
| 3 | Statik dosya önek kontrolü → `commonpath` | `server.py:533` | Güvenlik D3 |
| 4 | Hatalı JSON girdileri işleyiciyi çökertiyor (liste `sid`, dict olmayan gövde) | `server.py` | Güvenlik D2, Kod |
| 5 | Duraklat/Devam analiz döngüsünü çoğaltıyor → nesil sayacı | `analyzer.js:35-45` | Kod (doğrulandı) |
| 6 | Ders durumu tabanı uzun durumları yutuyor → taban yalnız "nötr ve sakin" karelerden, durum sürerken dondur | `learnstate.js:28-37` | Kod (doğrulandı), Lit. 1/3 (Baltrušaitis 2015) |
| 7 | El yüzü örterken HSEmotion eski değeri "taze" gösteriyor | `hsemotion.js:86,103` | Kod |
| 8 | Duraklatma sonrası "600 sn dikkati düşük" sahte uyarısı → `low_since` boşlukta sıfırlansın | `server.py:270-280` | Kod (doğrulandı) |
| 9 | Öğretmen anahtarı sunucu loguna düz yazılıyor | `server.py:475` | Güvenlik O1 (doğrulandı) |
| 10 | CSV formül enjeksiyonu (`=` ile başlayan isim) | `report.html:102-106` | Güvenlik D4 |

### P1 — Ölçüm dürüstlüğü ("yalan veri yok" kuralı)

1. **Adlandırma:** "Dikkat" → "Ekrana yönelim" (baş pozu ölçüyor); "Enerji" → "Uzun göz kapanma oranı" (PERCLOS). (Lit. 2, 3)
2. **"Ölçülemedi" durumu:** yüz yokken, el yüzü örterken ya da aşağı bakış kalibre aralığını aşınca değer üretme; öğretmene kapsama oranı göster, %50 altı "yetersiz veri". (Lit. 1, 3)
3. **Göz kalibrasyonu iki konumda:** ekrana ve klavyeye bakarken göz açıklığı ölç; arada kalan "bilinmiyor", PERCLOS'a girmesin. PERCLOS'u standart tanıma çek (%80 kapalı, 60 sn, <0,5 sn kapanmalar hariç) ve MediaPipe kare hızında örnekle. (Lit. 3)
4. **Bakış doğrulama turu:** kalibrasyondan sonra ayrı noktalarla hata ölç, öğrenci başına "veri kalitesi" göster; eşiği aşanın ısı haritası verisi düşük kalite diye etiketlensin. AOI'leri 4'e indir, ısı haritası çekirdeğini ölçülen hataya bağla. (Lit. 2)
5. **Bakış kayması:** tıklamaları örtük kalibrasyon örneği yap (PACE filtreleriyle), ofset büyüyünce yeniden kalibrasyon öner; baş pozunu (FaceLandmarker dönüşüm matrisi) özniteliklere ekle. (Lit. 2) — orta efor
6. **Isı haritası kayması:** öğretmen yayını 16:9 değilse koordinat dönüşümü düzelt. (Kod)

### P1 — Etik ve yasal

1. **Duygu kategorisini öğretmene gönderme.** Şu an face-api duygusu `student.js:66` ile sunucuya gidiyor; AI Act Md. 5(1)(f)'nin tarif ettiği uygulama bu. Ya kaldır ya da yalnızca öğrencinin kendi ekranında tut. (Lit. 4, 3)
2. **Panoda sınıf düzeyi:** bireysel dikkat sayıları yerine en az 5 kişilik toplu gösterim; el kaldırma kişiye bağlı kalabilir (öğrencinin kendi eylemi). (Lit. 4)
3. **Onam ve saklama:** her derste açık, geri alınabilir onam; onam metni sekme takibini, saniyelik kaydı ve saklama süresini söylesin; onam sunucuda kaydedilsin; ham saniyelik veri için saklama süresi (ör. ders bitiminden N gün sonra sil). KVKK için kurum hukuk birimine danış. (Güvenlik O2, Lit. 4)
4. **Kamerasız katılım ve el kaldırma düğmesi her zaman açık.** (Lit. 4: öğrencilerin %90'ı en az bir süre kamera kapatıyor)

### P2 — Ders durumu (deneysel modül)

1. **Olumsuz duyguları kurallardan çıkar** (Korku, Üzüntü, Öfke, İğrenme, Küçümseme); yalnız tabandan valence/arousal farkı + Mutluluk/Nötr olasılıkları. (Lit. 3)
2. **Şaşkınlık → "kafası karışık" eşlemesini kaldır** ya da Moodle sinyaliyle (yanlış quiz yanıtı, uzun duraklama) birleştir. (Lit. 1, 3)
3. **Taban:** 60–120 sn, medyan + MAD ile ölçekli fark, olasılıklarda log-odds; hazır olana kadar "kalibre ediliyor". (Lit. 1, 3)
4. **10 sn pencere istatistikleri:** yaw/pitch std, göz kırpma/dk, arousal ortalaması — tek kare değerine karar bağlama. (Lit. 1)
5. **Modül yerel ve kapalı varsayılanla kalsın;** doğrulanmadan öğretmene gitmesin. DAiSEE ile model eğitme (lisans: yalnız araştırma, paylaşım yok) önerilmez. (Lit. 1, 4)

### P2 — El kaldırma

1. **Gerçek ölçüm:** onamlı gönüllülerle doğal ders kaydı; saat başına yanlış tetikleme, duyarlılık, gecikme. Avuç yönü kuralı aynalı/aynasız akışta ayrı test edilsin. (Lit. 4)
2. **Konuşurken algılamayı duraklat** (söz zaten alınmış). (Lit. 4)
3. **Not — senin isteğinle çelişen öneri:** Literatür ajanı "yüze yakın eli reddet" öneriyor (Google Meet kuralı). Sen "yüzün önündeki el de sayılsın" demiştin. Şu anki çözüm (avuç kameraya dönük + düz parmaklar + kıpırtısız) bunu korumaya çalışıyor; yanlış tetikleme ölçülünce karar verilmeli.

### P3 — Canlıya alma (Moodle)

1. **Kimlik: LTI 1.3** ile Moodle'dan öğrenci/öğretmen kimliği; kod bilen herkesin istediği adla girmesi biter. (Güvenlik Y1, O4)
2. **Ters vekil** (nginx): hız sınırı, bağlantı/zaman aşımı, TLS; sunucuda kotalar (sohbet, örnek, katılımcı sayısı). (Güvenlik Y3)
3. **Kütüphane ve modelleri kendi sunucunda barındır** (face-api, MediaPipe, onnxruntime) + CSP `connect-src 'self'`; şimdilik SRI. Öğrenci IP'si jsdelivr/Google'a gitmesin. (Güvenlik O3, O5)
4. **Güvenlik başlıkları:** CSP, `frame-ancestors` (Moodle'a gömülecekse ona göre), `nosniff`, `Referrer-Policy`.
5. **Model dosyaları:** kaynak ve SHA-256 kaydı. (Güvenlik D6)

### P3 — Doğrulama çalışması

Kendi derslerinde küçük, onamlı bir çalışma: tek tıklık öz-bildirim + mümkünse eğitimli gözlemci (κ > 0,6); her gösterge için AUC/F1'i şansa karşı raporla; panoda yalnız ölçülmüş performansı göster. Bu yapılmadan "kafası karışık / sıkılmış" gibi etiketler öğretmene gerçek veri gibi sunulmamalı. (Lit. 1, 3, 4)

---

## Lisans özeti (ajan raporlarından)

| Bileşen | Durum |
|---|---|
| MediaPipe | Apache-2.0 — sorun yok |
| HSEmotion kodu | Apache-2.0; **ağırlıklar AffectNet ile eğitilmiş → ticari olmayan araştırma/eğitim** (üniversite kullanımına uygun, hukuk birimi teyit etmeli) |
| DAiSEE | Yalnız araştırma, üçüncü tarafla paylaşılamaz — dağıtılan model için kullanma |
| EngageNet | Kod MIT, veri lisansı belirsiz — yazılı izin gerekir |
| WebGazer | GPLv3 (küçük şirketlere LGPL seçeneği) |
| ETH-XGaze | CC BY-NC-SA 4.0 + ek koşullar |
| OpenFace | Yalnız araştırma; ticari için CMU lisansı |
| face-api modelleri, LibreFace, GazeCapture, MPIIGaze | Bu taramada doğrulanmadı |

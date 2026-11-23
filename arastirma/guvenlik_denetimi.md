# DersNabzı güvenlik denetimi (2026-11-18)

Kapsam: `server.py` ve `static/` altındaki tüm istemci dosyaları. Gerçek kullanım varsayıldı: Moodle'dan gelen gerçek öğrenci ve öğretmenler, LAN ya da internet, ters vekil (nginx/Caddy) arkasında ya da doğrudan.

Yöntem: kod okundu. Bulguların bir kısmı, sunucunun **scratchpad'e kopyalanmış** bir örneği 127.0.0.1:8031'de çalıştırılarak doğrulandı (DOĞRULANDI ile işaretli). Testler kopyanın kendi `data/` klasörüne yazdı. Projedeki `E:\eyetracker\data\*.json` dosyalarına dokunulmadı (değiştirilme saatleri 16:25'te kaldı). Projede yazılan tek dosya bu rapor.

Mimari doğrulandı: stdlib `ThreadingHTTPServer`, JSON kalıcılığı (`data/<KOD>.json`), SSE (`/api/stream`), WebRTC sinyalleşmesi `/api/event type=signal` üzerinden. Kimlik bilgileri: öğretmen için `teacher_key` (`secrets.token_urlsafe(18)`, 144 bit), öğrenci için `sid` (`s_` + 48 bit hex), ders kodu 6 karakter (32 harfli alfabe, yaklaşık 1,07 milyar olasılık).

---

## Yüksek

### Y1. Ders kodunu bilen herkes istediği isimle, sınırsız sayıda katılabiliyor (kimlik yok)
- **Yer:** `server.py:631-645` (`join`), `static/teacher-live.js:117` (`ready` sinyali gelince `makePeer`)
- **Sorun:** Katılım için tek şart ders kodu. İsim öğrencinin kendi yazdığı serbest metin. Moodle kimliğine bağ yok, aynı isim tekrar kullanılabiliyor, "Öğretmen" bile alınabiliyor. Kişi sayısına sınır yok.
- **Saldırı:**
  1. Kod WhatsApp grubuna sızar. Dışarıdan biri "Ayşe Y." adıyla girer ve sohbete yazar. Raporda Ayşe'nin adına dikkat/duygu verisi oluşur.
  2. Biri "Öğretmen" adıyla girip öğrencilere talimat yazar. Mesaj yalnızca CSS sınıfıyla (`msg student`) farklı görünür.
  3. Yabancı biri öğretmenin kamerasını, ekran paylaşımını ve söz verilen öğrencinin sesini izler.
  4. **Yayını çökertme:** Sahte "öğrenci" başına bir `signal {kind:"ready"}` gönderilir. Öğretmen tarayıcısı her biri için ayrı `RTCPeerConnection` açar ve ayrı video kodlayıp yükler (mesh yapı). Birkaç düzine sahte katılımcı öğretmenin upload'unu ve CPU'sunu tüketir, gerçek öğrencilerin yayını donar. `ready` tekrar tekrar gönderilirse bağlantı sürekli yeniden kurulur.
- **Durum:** "Öğretmen" adıyla katılım ve sohbet DOĞRULANDI. Yayın çökertme kod okumasından.
- **Asgari düzeltme:** Moodle ile LTI 1.3 entegrasyonu kurun. Kimliği ve rolü Moodle belirlesin, isim serbest metin olmasın. Kısa vadede:
  - ders başına katılımcı üst sınırı koyun;
  - aynı isimle ikinci katılımı reddedin;
  - "Öğretmen" gibi ayrılmış isimleri yasaklayın;
  - öğretmen panelinde "öğrenciyi çıkar" eklensin;
  - `ready` sinyalini öğrenci başına hız sınırına bağlayın.

### Y2. Negatif `Content-Length` 200 KB gövde sınırını tamamen aşıyor
- **Yer:** `server.py:493-498`
- **Sorun:** `n = int(Content-Length)`. Değer `-1` olursa `n > 200_000` kontrolü geçilir ve `rfile.read(-1)` bağlantı kapanana kadar **sınırsız** okur.
- **Saldırı:** `Content-Length: -1` başlığıyla gigabaytlarca veri gönderen birkaç bağlantı sunucunun belleğini doldurur. Gövde geçerli JSON ise işlenir de. Örneğin `signal.data` sözlüğü boyut sınırı olmadan öğretmenin SSE kuyruğuna (500 mesaja kadar) kopyalanır.
- **Durum:** DOĞRULANDI. 5 MB gövde `Content-Length: -1` ile kabul edildi (`200 OK`). Aynı gövde normal `Content-Length` ile 400 aldı.
- **Asgari düzeltme:** `if n < 0 or n > 200_000: raise ValueError`. Ek olarak `signal.data` JSON boyutunu ayrıca sınırlayın (ör. 20 KB) ve beklenen alanlar dışındakileri atın.

### Y3. Hiçbir yerde hız sınırı ya da kota yok; tek kişi servisi kilitleyebilir
- **Yer:** `server.py:618-629` (`create_class`, kimlik doğrulamasız), `:641-645` (öğrenci listesi sınırsız), `:657-658` ve `:269` (her `metrics` isteği `samples` listesine ekler), `:680` (sohbet listesi sınırsız), `:304-334` (ticker), `:381-391` (`load_class`), `:747` (thread sayısı sınırsız, soket zaman aşımı yok)
- **Sorun:**
  - Herkes sınırsız ders açabilir. Her ders diske yazılır ve ticker her saniye tüm aktif dersleri dolaşır. Her 5 saniyede tüm aktif dersleri **global kilit (`LOCK`) altında** diske yazar.
  - Öğrenci `/api/metrics` için saniyede binlerce istek atarak kendi `samples` listesini şişirebilir. Bu, 5 saniyede bir yeniden yazılan JSON'u ve kilit süresini büyütür.
  - Sohbet, uyarılar ve `topic_log` sınırsız büyür.
  - `GET /api/class` ve `GET /api/report` biten bir dersin dosyasını **anahtar kontrolünden önce**, global kilit altında her istekte baştan okuyup parse eder. Büyük bir ders dosyası için tekrarlanan anahtarsız istekler tüm sunucuyu bekletir.
  - Her bağlantıya bir thread açılıyor ve soket zaman aşımı (`timeout`) yok. Yarım başlık gönderen binlerce bağlantı (slowloris) ya da çok sayıda SSE bağlantısı thread ve bellek tüketir.
  - POST uç noktaları `Content-Type` bakmıyor. Herhangi bir web sitesindeki görünmez bir `fetch` (text/plain) ziyaretçilerin tarayıcısından ders açtırabilir.
- **Saldırı:** Bir öğrenci basit bir döngüyle sınav haftası canlı dersini dondurur.
- **Durum:** Kimliksiz ders açma (Content-Type olmadan da) DOĞRULANDI. Geri kalanı kod okumasından.
- **Asgari düzeltme:**
  - Ders açmayı öğretmen kimliğine bağlayın (LTI ya da en azından sunucu tarafı bir yönetici parolası/davet anahtarı).
  - IP başına hız sınırı koyun (ters vekilde `limit_req` yeterli).
  - Öğrenci başına `metrics` en fazla ~1/sn olsun, fazlası yok sayılsın.
  - Sınırlar: `samples` (ör. son 4 saat), sohbet (ör. son 1000), ders başına öğrenci (ör. 200), aynı anda açık ders sayısı.
  - `load_class` sonucu önbelleğe alınsın ya da kod biçimi ve anahtar dosya okunmadan önce kontrol edilsin.
  - `Handler.timeout = 30` (SSE için ayrı tutulmalı) ve SSE bağlantılarına sid/ders başına üst sınır.
  - POST'ta `Content-Type: application/json` zorunlu olsun.
  - İnternete açılacaksa mutlaka nginx/Caddy arkasında çalışsın (bağlantı ve gövde sınırları orada da verilir).

---

## Orta

### O1. Öğretmen anahtarı ve öğrenci sid'i URL'de; sunucu loguna düz yazılıyor, anahtar hiç sona ermiyor
- **Yer:** `server.py:475-478` (yalnızca `/api/metrics` loglanmıyor), `static/teacher.js:33`, `static/student.js:80`, `static/report.html:40`
- **Sorun:** `GET /api/stream?...&key=...` ve `GET /api/report?...&key=...` istek satırları stdout'a ve ters vekil erişim loglarına olduğu gibi yazılıyor. Anahtar kalıcı, yani raporu süresiz açar. Ayrıca `data/*.json` içinde düz metin duruyor.
- **Saldırı:** Sunucu loglarını gören biri (BT personeli, log toplama servisi, ekran paylaşımında açık terminal) her dersin raporunu sonsuza dek okuyabilir.
- **Durum:** DOĞRULANDI. Log satırı: `"GET /api/stream?role=teacher&code=RA347X&key=FUZ3y4... HTTP/1.1" 200`.
- **Asgari düzeltme:** `log_message` içinde sorgu dizgesini maskeleyin. Rapor için anahtarı POST gövdesinde gönderin. SSE için kısa ömürlü tek kullanımlık bilet ya da HttpOnly çerez kullanın. Anahtarı diskte hash'li saklayın (ör. SHA-256).

### O2. Kişisel veri: süresiz saklama, eksik aydınlatma, kayıtsız onay
- **Yer:** `server.py:337-344` (`persist`), `:257-287`, `:409-456`; `static/student.html:64-70` (onay metni)
- **Ne saklanıyor:** öğrenci adı, saniyelik dikkat/enerji/duygu etiketi, bakış bölgesi payları, materyale bakma oranı, "X 25 sn'dir başka bir sekmede / yorgun görünüyor" gibi isimli uyarılar, sohbet metinleri, el kaldırma ve tepki sayıları, katılma zamanları. Tamamı `data/<KOD>.json` içinde **süresiz** kalıyor. Silme, anonimleştirme ya da saklama süresi yok.
- **Onay metni eksik:**
  - Sekme değiştirme takibini (`tabHidden`, öğretmene "başka bir sekmede" uyarısı) söylemiyor.
  - Verinin isimle eşleşip saniye saniye kaydedildiğini, raporda ve CSV'de öğrenci bazında listelendiğini söylemiyor.
  - Saklama süresinden hiç söz etmiyor.
  - Onay yalnızca tarayıcıda bir onay kutusu. Sunucuda kayıt yok, öğrenci sonradan geri çekemiyor.
- **Üçüncü taraf:** Her öğrenci tarayıcısı jsdelivr ve Google (storage.googleapis.com, stun.l.google.com) ile konuşuyor. IP adresi yurt dışı sunuculara gidiyor.
- **Neden önemli:** Yüzden çıkarılan duygu verisi KVKK açısından hassas sayılabilir. Öğrenciler reşit olmayabilir. Bunun hukuken nasıl değerlendirileceği okulun/kurumun hukuk birimine sorulmalı. Bu rapor hukuki görüş değildir.
- **Durum:** Kod okumasından.
- **Asgari düzeltme:**
  - Saklama süresi tanımlayın ve süresi geçen dosyaları otomatik silin (ör. 30 gün).
  - Ders bitince saniyelik `samples` silinsin, yalnızca özet kalsın.
  - Onay metnine sekme takibi, isimli kayıt, rapor ve saklama süresi eklensin.
  - Onay zaman damgasıyla sunucuda kaydedilsin.
  - Öğretmen rapor/ders silebilsin.
  - CDN kütüphaneleri ve modeller self-host edilsin.
  - Notlandırmada kullanılmayacağı açıkça yazılsın (bkz. D1).

### O3. CDN betikleri SRI olmadan ve kameraya erişimi olan sayfada çalışıyor
- **Yer:** `static/student.html:180` (face-api `<script>`, `integrity` yok), `static/hsemotion.js:8,26,46-47` (onnxruntime betiği ve wasm'ı jsdelivr'den), `static/gaze.js:15-16,165-166` ve `static/hand.js:60-61` (MediaPipe `import()` + wasm jsdelivr'den, yüz modeli storage.googleapis.com'dan)
- **Sorun:** Sürümler sabitlenmiş, bu iyi. Ama içerik doğrulanmıyor. jsdelivr ya da npm paketi ele geçirilirse kod, kamera izni verilmiş öğrenci sayfasında çalışır. "Görüntü cihazdan çıkmaz" vaadi o anda bozulur, çünkü betik kareleri dışarı gönderebilir. Dinamik `import()` için SRI desteği yok.
- **Durum:** Kod okumasından (düşük olasılık, yüksek etki).
- **Asgari düzeltme:** face-api, onnxruntime-web, tasks-vision ve yüz modeli `static/vendor/` altına indirilip kendi sunucunuzdan servis edilsin. Bu hem SRI'yi hem KVKK'daki üçüncü taraf sorununu çözer. Kısa vadede `<script>` etiketine `integrity` ve `crossorigin` eklenebilir. Ayrıca bir CSP ile `connect-src 'self'` verilirse dışarı veri gönderimi de engellenir (bkz. O5).

### O4. Ders kodu tahmin edilebilir ve tahmin için ücretsiz bir "doğrulama kapısı" var
- **Yer:** `server.py:57-62`, `:517-523`
- **Sorun:** 32⁶ ≈ 1,07 milyar olasılık var ve hız sınırı yok (Y3). `GET /api/class?code=` geçerli kod için ders adı ve konuyu döndürüyor. Biten dersler için de çalışıyor.
- **Saldırı:** Aynı anda 100 aktif ders varken saniyede 1000 istekle ortalama ~3 saatte bir aktif ders bulunur. Sonra Y1'deki gibi katılınır. Pratikte kodun öğrenciler arasında paylaşılması daha olası bir sızıntı yolu.
- **Durum:** Kod okumasından (hesap).
- **Asgari düzeltme:** Hız sınırı (Y3) ve LTI ile katılım (Y1). Gerekirse kodu 8 karaktere çıkarın. `/api/class` biten dersler için bilgi vermesin.

### O5. HTTP güvenlik başlıkları yok
- **Yer:** `server.py:529-547` (statik yanıtlar), `:481-488`
- **Sorun:** `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` yok. HSTS de yok (ters vekilde verilmeli). `Server` başlığı Python sürümünü gösteriyor.
- **Saldırı:** Öğretmen paneli başka bir sitede iframe içine alınıp tıklatma tuzağı kurulabilir. "Dersi bitir"de `confirm()` olduğu için risk sınırlı. Gelecekte bir XSS çıkarsa CSP olmadığı için anahtar `localStorage`'dan doğrudan çalınır.
- **Durum:** Başlıkların olmadığı DOĞRULANDI (`/teacher.html` yanıtı yalnızca `Content-Type`, `Content-Length`, `Cache-Control` içeriyor).
- **Asgari düzeltme:** Tüm yanıtlara şunlar eklensin:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' <self-host sonrası yalnızca 'self'> 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors <moodle-alan-adı>`

  Moodle içinde iframe ile açılacaksa `frame-ancestors` yalnızca Moodle alan adına izin vermeli. `report.html` içindeki satır içi betik dosyaya taşınmalı ya da CSP'ye hash ile eklenmeli.

---

## Düşük

### D1. Metrikler tamamen istemcinin beyanı; kolayca sahtelenir
- **Yer:** `server.py:647-659`
- **Sorun:** Bu, mimarinin doğası. Kendi sid'ini bilen öğrenci konsoldan `attention:100, emotion:"mutlu"` gönderebilir. Başkasının sid'ini bilmediği için başkasını etkileyemez.
- **Durum:** Kod okumasından.
- **Öneri:** Bu veriler not ya da disiplin kararında kullanılmamalı. Arayüzde ve aydınlatma metninde bu açıkça yazılmalı.

### D2. Hatalı girdi işleyiciyi çökertiyor (bağlantı yanıtsız kapanıyor)
- **Yer:** `server.py:604-616`, `:641`, `:668`, `:500-501`, `:726`
- **Tetikleyiciler:**
  - `sid` bir liste olarak gönderilirse `unhashable type` hatası.
  - Gövde nesne değil liste olursa `.get` çağrısı `AttributeError` verir.
  - `key` ASCII dışı karakter içerirse `compare_digest` `TypeError` verir.
  - `demo` için `count:"abc"` gelirse `int()` `ValueError` verir.
  - Çok derin iç içe JSON `RecursionError` verir; bu hata `ValueError` olarak yakalanmıyor.
- **Etki:** Kilit `with` ile bırakıldığı için kalıcı kilitlenme yok. Ama loglar traceback ile dolar ve istek yanıtsız kalır.
- **Durum:** `sid` listesi için DOĞRULANDI ("Remote end closed connection", logda `TypeError: unhashable type: 'list'`).
- **Düzeltme:**
  - `do_POST` içinde `b`'nin `dict` olduğunu kontrol edin.
  - `sid`/`key`/`code` için `isinstance(..., str)` kontrolü yapın.
  - Rota çağrısını `try/except Exception` ile 400 dönecek şekilde sarın.

### D3. Statik dosya kontrolü önek karşılaştırması: `static` ile başlayan kardeş klasörler okunabilir
- **Yer:** `server.py:532-533` (`full.startswith(STATIC)`; ayraç yok)
- **Sorun:** `/../static_yedek/...` gibi bir yol, `E:\eyetracker\static_yedek\` klasörü varsa servis edilir. Şu an böyle bir klasör yok, yani **açık şimdilik istismar edilemez**. Biri ileride `static_old` ya da `static.bak` oluşturursa açılır.
- **Durum:** DOĞRULANDI. Kopyada `static_evil/x.txt` oluşturuldu ve `/../static_evil/x.txt` "SECRET" içeriğini döndürdü. `../`, ters bölü, mutlak yol ve `%2f` denemeleri 404 aldı.
- **Düzeltme:** `if os.path.commonpath([full, STATIC]) != STATIC` ya da `full.startswith(STATIC + os.sep)`.

### D4. Rapor CSV'sinde formül enjeksiyonu
- **Yer:** `static/report.html:102-106`
- **Sorun:** Öğrenci adı `=HYPERLINK("http://...","tıkla")` ya da `=...` ile başlarsa, öğretmen CSV'yi Excel'de açtığında formül olarak çalışır. Tırnak içine almak bunu engellemez.
- **Durum:** Kod okumasından.
- **Düzeltme:** `=`, `+`, `-`, `@`, sekme ya da CR ile başlayan hücrelerin başına `'` ekleyin. Ayrıca sunucuda isimleri harf/rakam/boşluk/nokta ile sınırlayın.

### D5. Demo öğrenciler gerçek dersin istatistiklerine karışıyor
- **Yer:** `server.py:725-726`, `:111-125` (`aggregate` demo/gerçek ayırmıyor)
- **Sorun:** Yalnızca öğretmen (anahtarla) tetikleyebilir. Ama gerçek bir derste yanlışlıkla basılırsa sınıf ortalaması, zaman çizelgesi ve ısı haritası kalıcı olarak sahte veri içerir ve sonradan ayrıştırılamaz. Tabloda "demo" etiketi var ama özet grafiklerde yok.
- **Durum:** Kod okumasından.
- **Düzeltme:** Üretimde demo butonunu bir bayrakla (`--demo`) kapatın ya da `aggregate` ve ısı haritasında demo öğrencileri hariç tutun.

### D6. Model dosyaları her istekte tamamen belleğe okunuyor; 1 yıllık `immutable` önbellek
- **Yer:** `server.py:538-544`
- **Sorun:** 16 MB'lık ONNX dosyasına paralel istekler istek başına 16 MB bellek kullanır (Y3 ile birleşir). `immutable` yüzünden ileride bozuk ya da zararlı bir model düzeltilirse istemciler eski dosyayı bir yıl kullanmaya devam eder. Modellerin kaynağı ve hash'i depoda kayıtlı değil.
- **Düzeltme:**
  - Dosyayı parça parça gönderin (`shutil.copyfileobj`) ya da statik dosyaları ters vekil servis etsin.
  - Model URL'sine sürüm/hash ekleyin (`enet_b0...onnx?v=<sha256>`).
  - README'ye kaynak ve SHA-256 yazın.

### D7. WebRTC: IP adresleri ve ekran paylaşımı
- **Yer:** `static/common.js:173`, `static/teacher-live.js`
- **Sorun:** ICE adayları öğretmenin yerel/genel IP'lerini her öğrenciye gösterir. Google STUN kullanılıyor. Ayrıca öğretmen "tüm ekranı" paylaşırken panel açıksa bütün sınıf herkesin dikkat ve duygu verisini görür. Bu bir yazılım açığı değil, kullanım riski.
- **Düzeltme:** Kurum içi STUN/TURN kullanın. Arayüzde ekran paylaşırken "yalnızca pencere/sekme paylaşın" uyarısı gösterin.

---

## İyi yapılanlar

- Rastgelelik `secrets` modülünden geliyor. Öğretmen anahtarı 144 bit, karşılaştırması `compare_digest` ile yapılıyor.
- Öğretmene özel işlemler (`end`, `live`, `topic`, `announce`, `demo`, `lower_hand`, teacher SSE, rapor) anahtar istiyor. Öğrenci sid'iyle `end` denemesi **403 aldı** ve anahtarsız rapor isteği **403 aldı** (DOĞRULANDI).
- Öğrenciler başka öğrencilerin metriklerini almıyor. Öğrenci SSE'sine yalnızca sohbet, konu, duyuru, yayın durumu ve kendine yönelik sinyal gidiyor. Öğrenci kimlikleri yalnızca öğretmene gidiyor.
- WebRTC sinyalinde `from` alanını sunucu koyuyor. Öğrenci başka bir öğrenciyi taklit edemiyor ya da başka bir öğrenciye sinyal gönderemiyor. Öğretmenden öğrenciye sinyal yalnızca anahtarla mümkün. Sahte SDP yalnızca saldırganın kendi bağlantısını etkiler.
- XSS: kullanıcıdan gelen tüm metinler (isim, sohbet, konu, duyuru, uyarı, ders adı) `esc()` ile ya da `textContent` ile basılıyor. `innerHTML` içine giren diğer değerler sunucuda beyaz listeyle sınırlı (duygu, bakış bölgesi, tepki emojisi). Tutarsız kullanım bulunamadı.
- Girdi temizliği: sayılar `clamp`'leniyor, duygu/bölge/tepki beyaz listede, bakış noktaları en fazla 40, metinler kırpılıyor (isim 40, sohbet 500, duyuru 300).
- Dosya yazımı atomik (`.tmp` + `os.replace`) ve global kilit altında. Dosya adları sunucuda üretiliyor. `load_class` `isalnum()` ile yol enjeksiyonunu engelliyor.
- Klasik yol geçişi denemeleri (`../`, `..\`, mutlak yol, `%2f`) 404 aldı (DOĞRULANDI).
- Varsayılan bağlanma adresi `127.0.0.1`. CORS başlığı yok, yani başka siteler yanıtları okuyamıyor.
- `data/` `.gitignore`'da. Git geçmişinde hiç ders dosyası commit edilmemiş (kontrol edildi).
- Kamera görüntüsü gerçekten sunucuya gitmiyor. İstemci kodundaki ağ çağrıları yalnızca model indirme, metrik gönderme ve sinyalleşme. Öğrencinin görüntüsü WebRTC ile de gönderilmiyor, yalnızca söz verildiğinde ve öğrencinin onayıyla mikrofon gidiyor.
- CDN sürümleri sabitlenmiş (`face-api@1.7.13`, `tasks-vision@0.10.14`, `onnxruntime-web@1.20.1`).

## Önerilen sıra

1. Y2: tek satırlık düzeltme.
2. D2 ve D3: küçük düzeltmeler.
3. Y3: ters vekil ve sınırlar.
4. O1: log maskeleme.
5. Y1 ve O4: LTI / katılım kontrolü.
6. O2: saklama süresi ve onay metni.
7. O3 ve O5: self-host ve CSP.

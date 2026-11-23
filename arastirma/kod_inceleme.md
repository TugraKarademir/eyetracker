# Kod incelemesi: doğruluk hataları (2026-11-18)

Kapsam: `static/student.js`, `analyzer.js`, `gaze.js`, `hand.js`, `hsemotion.js`, `learnstate.js`, ayrıca `server.py`, `teacher.js`, `common.js`, `report.html`, `student-live.js`, `teacher-live.js`. Proje dosyalarında değişiklik yapılmadı. Tüm JS dosyaları `node --check` kontrolünden geçti. Testler scratch klasöründe stub'lı Node/Python betikleriyle çalıştırıldı.

Önem sırasına göre. "Doğrulandı" = çalıştırılarak gösterildi; "olası" = koddan/spec'ten çıkarım, gerçek kamerayla ölçülmedi.

---

## 1. [Yüksek] Demo öğrenciler gerçek sınıf toplamlarına, ısı haritasına, uyarılara ve rapora karışıyor (DOĞRULANDI)

- `server.py:112` `aggregate()` çevrim içi öğrencileri `demo` bayrağına bakmadan alıyor, ortalama dikkat/enerji/duygu ve `gaze_agg` (128-137) buna göre hesaplanıyor.
- `server.py:199` → `record_metrics()` → `268` `add_heat()`: demo bakış noktaları `heat_live` ve `heat_total` içine yazılıyor.
- `server.py:270-286`: demo öğrenciler için kişisel uyarılar üretiliyor ("Ayşe Y. 20 sn'dir dikkati düşük").
- `server.py:289-301` `class_alerts` ve `328-333` timeline aynı karışık `agg` üzerinden çalışıyor.
- `server.py:409-456` `build_report`: `avgAttention`, `emotions` (timeline'dan), `gazeRegions` (432-434, tüm öğrencilerin `gaze_time` değerleri), `heat` (`heat_total`) demo verisini içeriyor. Yalnızca öğrenci tablosunda `demo` etiketi var.
- **Tetikleyen durum:** 1 gerçek öğrenci (dikkat 90, mutlu) varken "+ Demo öğrenciler" düğmesine basmak.
- **Ölçüm:** `aggregate` sonucu `present 1 → 7`, dikkat `90 → 64`, enerji `90 → 74`, `onMaterial` %83 (gerçek öğrenci bakış göndermediği halde), `heat_total` toplamı 906 (hepsi demo). 600 sn simülasyonda yalnızca demo öğrencilerden 37 uyarı çıktı; bunların arasında "Sınıfın %50'si zorlanıyor" gibi sınıf uyarıları da vardı. Rapordaki `avgAttention` değeri 64 oldu.
- **Not:** `data/` altındaki 3 kayıtta demo öğrenci yok (0 demo). Mevcut kayıtlar etkilenmemiş. Hata, demo düğmesi gerçek bir derste kullanıldığında ortaya çıkıyor.
- **Önerilen düzeltme:** `aggregate`/`gaze_agg` içinde `online = [... if not s["demo"]]` filtresi uygulanmalı. `record_metrics` içinde `if not s["demo"]` koşuluyla `add_heat` ve uyarılar atlanmalı. `build_report` içinde `total_gaze` için demo öğrenciler atlanmalı. Demo görünümü gerekiyorsa demo toplamları ayrı bir alanda (`agg_demo`) tutulabilir.

## 2. [Yüksek] FocusAnalyzer: Duraklat→Devam step sürerken yapılırsa ikinci (üçüncü…) analiz döngüsü başlıyor (DOĞRULANDI)

- `analyzer.js:35-45`: `stop()` yalnızca `running=false` yapıp zamanlayıcıyı siliyor. O anda `await this.step()` sürüyorsa, step bitince `loop()` 44. satırda yeni bir `setTimeout` kuruyor. Bu arada `start()` `running=true` yaptığı için eski zincir de devam ediyor. Tetikleyici yer: `student.js:72-77` (Duraklat düğmesi).
- **Ölçüm:** step 150 ms süren bir stub ile 3 sn içinde iki kez hızlı duraklat/devam yapıldı. Sonuç 29 step oldu (tek döngüde beklenen ~10), aynı anda en fazla 3 step çalıştı.
- **Etki:** CPU yükü katlanıyor ve face-api aynı anda birden çok kez çalışıyor. Dikkat EMA'sı ve `emo` daha hızlı değişiyor. `eyeHist` (PERCLOS) örnekleri iki kez sayılıyor. Kalibrasyonun 10 karesi daha kısa sürede doluyor. Her hızlı tıklama bir döngü daha ekliyor.
- **Önerilen düzeltme:** Bir nesil sayacı eklenmeli: `start(){ if(this.running) return; this.running=true; this.loop(++this.gen); }`, `loop(g){ if(!this.running||g!==this.gen) return; … setTimeout(()=>this.loop(g), …) }`, `stop(){ this.running=false; this.gen++; clearTimeout(this.timer); }`.

## 3. [Yüksek] LearningStateEstimator: kişisel taban, sınıflanan durumu birkaç saniyede "yutuyor" (DOĞRULANDI)

- `learnstate.js:28-37`: Taban, son 180 sn içindeki örneklerin ortancası. Örnek alma koşulu yalnızca `attention>=50 && !lookingAway && !eyesClosed`. "Kafası karışık" ve "ilgili" durumları zaten yüksek dikkat gerektirdiğinden (55. ve 51. satırlar), bu durumdaki her örnek tabana giriyor.
- **Tetikleyen durum:** 30 sn nötr (V=0, A=0), ardından sürekli kafası karışık görünüm (V=-0.15, A=+0.35, Surprise 0.3, dikkat 80).
- **Ölçüm:** t=45 sn'de durum `kafa_karisik` (skor 1.00) oldu. t=60 sn'de taban V/A değeri -0.15/0.35'e atladı, çünkü karışık örnekler sayıca nötrü geçti ve ortanca kaydı. t=75 sn'den itibaren girdiler değişmediği halde durum **`ilgili`** oldu (karışık skoru 0.07). Yani ~30 sn'den uzun süren her durum "normal" sayılıp kayboluyor. Pencere 180 sn olsa da ortanca, örneklerin yarısı geçildiği anda kayıyor.
- **Etki:** Uzun süren sıkılma ya da kafa karışıklığı hiçbir zaman gösterilmiyor. `dsOzet` ölçümleri de yanıltıcı hale geliyor.
- **Önerilen düzeltme:** Taban ilk N sn'den (ör. 20-30 sn) sonra dondurulmalı ya da yalnızca `state==="belirsiz"`/düşük skor anlarında, çok yavaş bir EMA ile (ör. τ=10 dk) güncellenmeli. Tabana girme koşulu sınıflanan durumdan bağımsız tutulmalı.

## 4. [Orta] HSEmotion: el yüzü örterken donmuş değerler "taze" sayılıyor ve tabana/kayıtlara giriyor (DOĞRULANDI, koddan)

- `hsemotion.js:86`: Örtülme varken `this.t = now` yapılıyor, ama `probs/valence/arousal` güncellenmiyor. `fresh()` (103. satır) bu yüzden true dönüyor.
- `student.js:262-268` `lsInputs`, `hse.fresh()` üzerinden donmuş değeri her 0.5 sn'de `ls.update`'e veriyor. Bu değer hem durum skorlarına hem de taban ortancasına (`_updateBase`) tekrar tekrar ekleniyor. `hsLog`/`dsLog` (243-249, 280-291) de bu değerleri canlı ölçüm gibi kaydediyor.
- **Tetikleyen durum:** Öğrencinin elini 20 sn çenesine dayaması. Bu sürede ~40 kopya aynı örnek tabana giriyor ve kayıtta 20 satır "ölçülmüş" görünüyor.
- **Önerilen düzeltme:** `this.held = true` gibi ayrı bir bayrak tutulmalı ve `t` güncellenmemeli. Ya da `lsInputs` ve log aralıkları `hse.held` iken atlanmalı. Arayüzde "son değer korunuyor" yazmak için ayrı bir alan kullanılabilir.

## 5. [Orta] HSEmotion kırpması: yüz kenara yakınsa tuvalin bir kısmında önceki karenin pikselleri kalıyor (spec'e göre, çalıştırılmadı)

- `hsemotion.js:76`: `drawImage(video, cx-side/2, cy-side/2, side, side, 0,0,224,224)`. Kaynak dikdörtgen videonun dışına taşınca Canvas spec'i kaynağı kırpıyor ve hedefi de orantılı daraltıyor. Kalan alan temizlenmiyor ve tuval her karede yeniden kullanılıyor. %15 kenar payıyla yüz kenara yaklaştığında ya da kameraya çok yakın oturulduğunda bu kolayca oluyor.
- **Etki:** Modele, bir kısmı eski bir kareden gelen karışık bir görüntü gidiyor. Duygu ve V/A değerleri bozuluyor.
- **Önerilen düzeltme:** `drawImage`'dan önce `this.ctx.fillStyle="#000"; this.ctx.fillRect(0,0,S,S);` çağrılmalı. Daha iyisi, kaynak dikdörtgen video sınırlarına kırpılıp hedef ona göre hesaplanmalı.

## 6. [Orta] Isı haritası öğretmen ekranında yatay ya da dikey kayık çiziliyor (yayın 16:9 değilse) (DOĞRULANDI, koddan)

- Öğrenci tarafında `student.js:130-133` u,v değerlerini öğretmen videosunun **gerçek** en/boy oranındaki içerik alanına göre hesaplıyor.
- Öğretmen tarafında `common.js:159-165` videoyu 16:9 alana sığdırıyor ve kenarlarda boşluk bırakıyor, ama `common.js:178` ısı katmanını **tüm 16:9 alana** gerilmiş olarak çiziyor.
- **Tetikleyen durum:** 16:10 ekran paylaşımı (MacBook 2560×1600). Video her iki yanda alanın %5'i kadar boşlukla çiziliyor, ısı ise kenara kadar uzanıyor. 4:3 bir kamerada kayma %12.5'e çıkıyor. 21:9 ekranda kayma dikey oluyor. Raporda (`report.html:79`) da aynı 16:9 gerilmesi var.
- **Önerilen düzeltme:** `bg` varken ısı katmanı video dikdörtgenine (`ax+(aw-vw)/2, ay+(ah-vh)/2, vw, vh`) çizilmeli. Rapor için içerik en/boy oranı (ya da ders boyunca değişiyorsa her noktayla birlikte) sunucuya kaydedilmeli.

## 7. [Orta] face-api yüklenemezse hiçbir metrik gönderilmiyor (bakış dahil) ve bakış noktası tamponu sınırsız büyüyor

- `student.js:38-47`: `sendTimer` yalnızca `analyzer.load()` başarılı olursa kuruluyor. face-api CDN'den (`student.html:180`) eşzamanlı yükleniyor. Yüklenmezse `faceapi` tanımsız kalıyor, catch bloğu çalışıyor ve `sendMetrics` hiç çağrılmıyor. Öğrenci öğretmene "çevrim dışı" görünüyor, oysa MediaPipe bakış takibi çalışıyor.
- `gaze.js:249`: `win.pts` yalnızca `flush()` ile boşaltılıyor. `flush` hiç çağrılmazsa ~10 nokta/sn birikiyor (saatte ~36 bin dizi). `win.counts` sınırlı, `pts` değil.
- **Önerilen düzeltme:** `sendTimer` kamera açılınca analyzer'dan bağımsız kurulmalı ve `sendMetrics` analyzer yokken yalnızca bakış/yüz verisi göndermeli. `win.pts` örneğin 60 ile sınırlanmalı (`if (pts.length>60) pts.shift()`).

## 8. [Orta] Sunucu: düşük dikkat sayacı çevrim dışı/duraklatma boşluğunda sıfırlanmıyor, sahte süre içeren uyarı üretiyor (DOĞRULANDI)

- `server.py:270-280`: `low_since` yalnızca dikkat ≥40 olan bir örnek gelince sıfırlanıyor. Öğrenci duraklatırsa (`student.js:59`, gönderim durur) ya da çevrim dışı kalırsa sayaç işlemeye devam ediyor.
- **Ölçüm:** Dikkat 30 olan bir örnekten sonra öğrenci 10 dk duraklattı. Dönüşteki ilk örnekte (dikkat 30) hemen "Ali 600 sn'dir dikkati düşük." uyarısı üretildi.
- **Önerilen düzeltme:** `record_metrics` başında `gap = t - s["last_seen"]` hesaplanmalı, sonra `last_seen` güncellenmeli. `gap > OFFLINE_AFTER` ise `low_since = None; low_alerted = False` yapılmalı.

## 9. [Orta, olası] Göz kapalılığı / PERCLOS: el yüzü örtünce ve aşağı bakış katsayısı eşiği kaydırınca

- `analyzer.js:85-98` göz kararını verirken `handDet.occluding()` değerine bakmıyor. El gözü örttüğünde MediaPipe `eyeBlink` yükselebilir ya da face-api EAR değeri bozulabilir. Bu durumda `eyesClosed` ve `eyeHist` (PERCLOS → enerji) kirleniyor, dolaylı olarak LS tabanının `!eyesClosed` koşulu da etkileniyor.
- `analyzer.js:87`: Eşik, `eyeLookDown` ile 0.55'ten 0.80'e kadar yükseltiliyor. MediaPipe'ta gözler kapanınca `eyeLookDown` da sık sık birlikte yükselir. Bu yüzden eşik tam gözler kapalıyken yükselip gerçek kapanmayı kaçırabilir. Kanıt yok; `gozLog` ile bilerek göz kapatılarak ölçülmeli.
- **Önerilen düzeltme:** `FocusAnalyzer` ayarlarına bir `isOccluded` geri çağrısı verilmeli. Örtülme varken `eyeHist`'e ekleme yapılmamalı ve `closedSince` dondurulmalı. Eşik yükseltme `down` değerinin `blink` değerine oranına bağlanmalı ya da yalnızca `blink<0.9` iken uygulanmalı (ölçümle karar verilmeli).

## 10. [Düşük-orta] FocusAnalyzer baş yönü kalibrasyonu doğrulanmamış ilk 10 kareden alınıyor

- `analyzer.js:70-76`: Kalibrasyonda yüz bulunan ilk 10 kare (~3 sn) kullanılıyor ve öğrencinin ekrana baktığı varsayılıyor. Bu sırada aşağıya (deftere) bakılırsa, el yüzü örterse ya da gözler kapalıysa `base.yaw/pitch` kalıcı olarak kayıyor. Sonrasında ekrana bakmak "ekran dışı" sayılıyor ve dikkat düşük gönderiliyor. Elle "Yeniden kalibre et" dışında bir düzeltme yolu yok.
- **Önerilen düzeltme:** Kalibrasyon örnekleri yalnızca `!occluding`, gözler açık ve düşük varyans (baş sabit) koşullarında kabul edilmeli. Bakış kalibre ise yalnızca `gaze.region` "materyal" ya da "sayfa" iken alınmalı.

## 11. [Düşük] Bakış "bilinmiyor" pencereleri sunucuda kalibre sayılıyor, materyale bakma yüzdesi düşük çıkıyor

- `gaze.js:258` örnek yoksa (yüz 2 sn görünmedi ya da göz kırpıldı) `{cal:true, region:null}` dönüyor. `server.py:129-137` bu öğrenciyi `calibrated` paydasına ekliyor ama hiçbir bölgeye koymuyor, bu da `onMaterial` değerini aşağı çekiyor.
- **Önerilen düzeltme:** `gaze_agg` içinde `cal = [... if gazeCal and gazeRegion]` kullanılmalı. Ayrıca bir "bilinmiyor" sayısı tutulabilir.

## 12. [Düşük] Model yükleme hatası önbelleğe alınıyor, tekrar denenemiyor

- `hand.js:58-69` ve `hsemotion.js:43-53`: `this.loading` reddedilmiş bir promise olarak kalıyor. Geçici bir ağ hatasından sonra kutuyu kapatıp açmak aynı hatayı veriyor, sayfa yenilenmeden düzelmiyor.
- **Önerilen düzeltme:** `this.loading = (async()=>{…})().catch(e => { this.loading = null; throw e; })`.

## 13. [Düşük, olası] Ders bitince el algılayıcı ve HSEmotion durdurulmuyor

- `student.js:115-120` `finish()` yalnızca gaze, analyzer, SSE ve kamera izlerini kapatıyor. `handDet` (5 Hz) ve `hse` döngüleri ile LS/log aralıkları çalışmaya devam ediyor. Kamera izleri durduktan sonra `<video>` son kareyi tutup `readyState>=2` kalırsa el algılayıcı donmuş kare üzerinde çalışır. O karede el kalkıksa `onRaise` → `/api/event` → "Ders sona erdi" toast'u çıkabilir.
- **Önerilen düzeltme:** `finish()` içinde `handDet.setEnabled(false); hse.setEnabled(false);` çağrılmalı.

## 14. [Düşük] GazeTracker: bir istisna kare döngüsünü kalıcı olarak durdurur ve diğer modülleri sessizce etkiler

- `gaze.js:179-211`: Yalnızca `detectForVideo` try içinde. `_predict`/`_sample`/`getRegions` içindeki bir hata (ör. DOM öğesi yokken `rectOf(null)`) `next()`'e ulaşılmasını engelliyor. Döngü bitiyor, `gaze.face` bayatlıyor ve şunlar oluyor: el algılayıcı göz hizası için 0.4 varsayımına düşüyor, HSEmotion "yüz yok" diyor, analyzer EAR'a dönüyor. Hiçbiri gerçek nedeni göstermiyor. Bakış modeli hiç yüklenemezse de HSEmotion durumu "yüz yok" olarak görünüyor; doğru mesaj "bakış modeli yok" olmalı.
- **Önerilen düzeltme:** Gövde `try { … } finally { next(); }` içine alınmalı.

## 15. [Düşük] GazeTracker kalibrasyon kenar durumları

- `gaze.js:354-358`: `_waitStart` her çağrıda yeni bir `keydown` dinleyicisi ekliyor (`_fail` ve "Tekrar kalibre et" yolları), `_close` (445) ise yalnızca sonuncusunu kaldırıyor. Sızan dinleyiciler ders boyunca her Esc tuşunda `_close(false)` çağırıyor (öğrenci sinema modundan Esc ile çıkarken de). Şu an zararsız, ama bir sonraki kalibrasyonu beklenmedik şekilde kapatabilir.
- `gaze.js:406`: `_calibDone` yeni modeli doğrulamadan önce `this.model`'e yazıyor. Doğrulamada vazgeçilirse kaydedilmemiş ve doğrulanmamış model kalıyor. İlk kalibrasyonda `tracking` başlamıyor ve `regaze` (`student.js:179`, `!gaze.model` koşulu) kayıtlı kalibrasyonu artık geri yüklemiyor.
- **Önerilen düzeltme:** Dinleyici tek sefer eklenmeli (ya da `_waitStart` başında eskisi kaldırılmalı). Model geçici bir alanda tutulmalı ve `_validDone` içinde atanmalı.

## 16. [Düşük] Sunucu: büyüyen kayıt maliyeti ve gövde doğrulaması

- `server.py:313-320, 337-344`: Her 5 sn'de, global `LOCK` altında tüm `samples` (sınırsız, öğrenci başına 2 sn'de bir) JSON'a yazılıyor. Uzun ve kalabalık derste (30 öğrenci × 2 saat ≈ 108 bin örnek, birkaç MB) bu işlem tüm HTTP isteklerini ve SSE ticker'ını bloklar.
- `server.py:493-498, 604-616`: JSON gövdesi dict değilse (ör. `[]`) `b.get` AttributeError fırlatıyor (500 / bağlantı kopması). `Content-Length > 200000` ise gövde okunmadan hata dönülüyor ve keep-alive bağlantısı bozuluyor.
- **Önerilen düzeltme:** Kayıt kilit dışında, bir kopya üzerinden yapılmalı ya da yalnızca değişen dersler yazılmalı. `if not isinstance(b, dict): return self.err(...)` eklenmeli ve büyük gövdede `close_connection=True` yapılmalı.

---

## Kontrol edildi, sorun bulunmadı

- **Veri gizliliği ("öğretmene gitmez"):** DOĞRU. Sunucuya giden tek metrik çağrısı `student.js:66-67`: attention, energy, emotion (face-api), face, lookingAway, eyesClosed, tabHidden ve bakış özeti. HSEmotion ve ders durumu verisi yalnızca `window.hsLog`/`dsLog`/`gozLog`/`elLog` ile konsolda kalıyor. Diğer `api()` çağrıları katılım (`student.js:15`), olaylar (`110`) ve WebRTC sinyalleri (`student-live.js:8`). Öğrencinin kamera görüntüsü hiçbir yere gönderilmiyor. Söz verildiğinde yalnızca mikrofon gidiyor, o da öğrencinin onayıyla.
- **Zaman tabanları:** Hepsi `performance.now()/1000` (saniye). Tazelik kontrolleri tutarlı (`analyzer.js:86`, `hand.js:170`, `hsemotion.js:85`). MediaPipe zaman damgaları ms ve tekdüze artan.
- **Koordinatlar:** `gaze.face` normalize ve aynalanmamış kare üzerinde. El landmark'ları ve HSEmotion `drawImage` kaynağı da aynı kareyi kullanıyor. Ayna yalnızca CSS'te (`student.html:10`). HSEmotion kare kırpması piksel ölçüsünde doğru (`vw`/`vh` ile). `HandRaiseDetector.check` x'i `asp` ile ölçekleyerek açıları doğru hesaplıyor.
- **`setEnabled` yarışları:** Yükleme sırasında kapatma, `if (this.enabled)` ile korunuyor. HSEmotion'daki çift `loop()` durumu `busy` ve `clearTimeout` sayesinde tek zincire iniyor.
- **`HAND_LABEL_SWAPPED`:** Etiket ve çapraz çarpım işaretinin çarpımı gerçek kamerayla ölçülerek ayarlanmış. Bunu çürüten bir kanıt bulunmadı. Avuç filtresinin gerçekten ayırt edici olduğunu doğrulamak için elin sırtı kameraya dönükken "arkada" çıktığı ayrıca kontrol edilmeli.

## Çalıştırılan testler (scratch, proje dışında)

- `t_analyzer.js`: face-api stub'ı ile duraklat/devam yarışı (bulgu 2).
- `t_ls.js`: LearningStateEstimator taban kayması (bulgu 3).
- `t_server.py` / `t_server2.py`: `server` modülü import edilerek demo karışması (bulgu 1) ve `low_since` boşluğu (bulgu 8) test edildi. Disk yazımı yapılmadı.

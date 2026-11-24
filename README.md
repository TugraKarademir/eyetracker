# DersNabzı

Çevrim içi derslerde öğrencilerin **dikkatini, enerjisini ve duygu durumunu** canlı ölçen,
öğretmene panel + uyarı + ders sonu raporu sunan platform.

## Çalıştırma

Yalnızca Python 3.9+ gerekir, ek paket yok.

```bash
python server.py
```

Tarayıcıda `http://localhost:8000` adresini açın.

- **Öğretmen:** "Ders başlat" → ders adı → 6 haneli kod alınır, panel açılır.
- **Öğrenci:** `http://localhost:8000/student.html?code=KOD` → isim → rıza → kamera.
- Kamerasız denemek için panelde **+ Demo öğrenciler** butonu simüle öğrenciler ekler.
- **Dersi bitir** → rapor sayfası (grafik, öğrenci tablosu, CSV, yazdır/PDF).

Ağdaki başka cihazlardan katılım için: `python server.py --host 0.0.0.0`.
Not: tarayıcılar kamerayı yalnızca **https** ya da **localhost** üzerinde açar; okul ağında
gerçek kullanım için sunucuyu bir HTTPS ters vekil (Caddy/nginx) arkasına koyun.

## Nasıl çalışır

| Katman | Ne yapar |
| --- | --- |
| `static/analyzer.js` | Öğrencinin tarayıcısında face-api ile yüz tespiti, 68 nokta landmark ve ifade analizi |
| Dikkat skoru | Baş yönü (yaw/pitch, ilk 3 sn kalibrasyona göre), 0.6 sn üstü göz kapalılığı, yüzün kadrajda olmaması, sekme değişimi |
| Enerji skoru | Son 60 sn göz kapalılık oranı (PERCLOS) + son 3 dk esneme sayısı |
| Duygu | 7 ifade olasılığı → Mutlu/ilgili, Nötr, Kafası karışık, Zorlanıyor (yumuşatılmış) |
| `server.py` | Sınıf/öğrenci durumu, 5 sn'lik zaman çizelgesi, uyarı kuralları, SSE ile canlı yayın, JSON kayıt |
| Uyarılar | Öğrenci 20 sn+ dikkat dışı · enerji < %35 · sınıfın ≥%35'i zorlanıyor · sınıf dikkati < %50 · sınıf enerjisi < %45 |

Görüntü sunucuya **hiç gönderilmez**; yalnızca sayılar gider. Biten dersler `data/KOD.json` olarak saklanır.

## API

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| POST | `/api/class` | `{name, topic}` → `{code, key}` |
| POST | `/api/join` | `{code, name}` → `{sid}` |
| POST | `/api/metrics` | `{code, sid, attention, energy, emotion, face, lookingAway, eyesClosed, tabHidden}` |
| POST | `/api/event` | `type`: chat, hand, reaction (öğrenci) · topic, announce, lower_hand, demo, end (öğretmen, `key` ile) |
| GET | `/api/stream` | SSE; `role=teacher&key=…` veya `role=student&sid=…` |
| GET | `/api/report` | `code&key` → ders raporu JSON |

## Bakış takibi: öğrenci ekranın neresine bakıyor?

[webgaze](https://github.com/TugraKarademir/webgaze) projesinin göz takibi algoritması tarayıcıya
taşındı (`static/gaze.js`). Öğrenci kurulum yapmaz; analiz yine kendi tarayıcısında çalışır.

- **Kalibrasyon:** Öğrenci ekranında "Kalibre et" → 13 nokta + 9 doğrulama noktası (~40 sn).
  Sonunda hata (px, derece) ve 3×3 bölge isabeti gösterilir. Kalibrasyon aynı pencere boyutunda
  tarayıcıda saklanır; pencere boyutu/konumu değişirse takip duraklar ve "Tam ekrana dön /
  Yeniden kalibre et" çıkar. Ders sırasında yapılan tıklamalar modeli iyileştirir.
- **Bölgeler:** 📺 Materyal (öğretmen yayını / paylaşılan ekran), 📝 Konu, 📢 Duyuru, ✋ Etkileşim,
  💬 Sohbet, 🤳 Kendi kamerası, 📄 Sayfanın boş yeri, 🚫 Ekran dışı (veya başka sekme).
- **Materyal ısı haritası:** Bakış materyalin üzerindeyse görüntü içindeki konumu (u, v) gönderilir.
  Öğretmen panelinde, o an yayınladığı karenin üstünde son ~10 sn'nin ısı haritası; raporda ders boyu harita.
- **Öğretmen paneli:** "Şu an materyale bakan %", bölge dağılımı, her öğrenci kartında anlık bölge ve
  son 1 dakikada materyale bakma oranı; zaman grafiğinde "Materyale bakan" çizgisi.
- **Rapor / CSV:** öğrenci bazında "Materyale bakma %", sınıfın bölge dağılımı, ders boyu ısı haritası.
- Bakış "ekran dışı" diyorsa, dikkat skorundaki "ekrana bakmıyor" kararı da buna göre verilir.

webgaze ile birebir aynı tutulanlar: MediaPipe Face Mesh landmark indeksleri, `eye_features`,
`model_features`/`expand`, ridge regresyon (λ=10), 3 karelik yumuşatma, MAD aykırı eleme, One Euro filtresi,
kalibrasyon zamanlaması, bölgeye oturtma (snap) + 4 kare tutma, tıklamayla öğrenme. JS taşıması aynı
girdilerle webgaze'in Python fonksiyonlarıyla karşılaştırıldı (tahmin farkı < 1e-10 px).

**Doğruluk:** web kamerasıyla tipik hata 2–3°'dir (webgaze ölçümü: 21.5" ekranda ~63 px). Bu, slaydın
"sol üst / orta / sağ alt" gibi bölgelerini ayırt etmeye yeter; tek tek kelime düzeyinde değildir.
Baş sabit, yüz önden aydınlık olmalı. Materyal ne kadar büyük gösterilirse (⛶ sinema modu) ayrım o kadar iyi olur.

## Canlı yayın

Öğretmen panelindeki **Yayını başlat** ile kamera + mikrofon tüm öğrencilere WebRTC üzerinden iletilir.
**Ekran paylaş** ile görüntü anında ekran paylaşımına geçer; mikrofon/kamera ayrı ayrı kapatılabilir.
Yayın tek yönlüdür: öğrencilerin görüntüsü öğretmene gönderilmez.

- Sinyalleşme mevcut SSE kanalından (`/api/event` `type: "signal"`) geçer; medya doğrudan tarayıcılar arasında akar.
- Mesh yapı: öğretmen her öğrenciye ayrı akış yollar. 720p'de yaklaşık **20-25 öğrenciye** kadar uygundur
  (öğretmenin yükleme hızına bağlı). Daha kalabalık sınıflar için bir SFU (LiveKit, mediasoup, Janus) gerekir.
- Aynı ağda ek ayar gerekmez. Farklı ağlar/okul güvenlik duvarları için `static/common.js` içindeki
  `RTC_CONFIG`'e bir TURN sunucusu (ör. coturn) eklenmelidir.

### Söz verme (öğrencinin sesli konuşması)

1. Öğrenci ✋ ile söz ister; öğretmenin panelinde o öğrencinin kartında **🎙️ Söz ver** çıkar.
2. Öğrencide "Söz sizde" kartı açılır. Mikrofon izni **yalnızca öğrenci "Mikrofonu aç" dediğinde** istenir.
3. Öğrencinin sesi öğretmene gider, öğretmen tarayıcısı bu sesi diğer tüm öğrencilere aktarır;
   diğer öğrencilerin ekranında "Ali konuşuyor" göstergesi çıkar. Konuşan öğrenci kendi sesini geri duymaz.
4. Öğretmen **Sözü al** ile, öğrenci **Sözü bitir** ile kapatır. Aynı anda tek öğrenci konuşur.

Teknik: her öğretmen–öğrenci bağlantısında ayrı bir çift yönlü "söz" ses kanalı vardır; söz verilince
yeniden pazarlık (renegotiation) gerekmeden `replaceTrack` ile mikrofon bağlanır ve aktarılır.
Söz yalnızca öğretmen yayındayken ve öğrenci yayına bağlıyken verilebilir.

## Yönetim ekranı

Araştırma/ders kaydını incelemek için: `http://localhost:8000/admin.html`

- **Yönetici anahtarı:** `DERSNABZI_ADMIN_KEY` ortam değişkeni, yoksa `data/yonetici_anahtari.txt`.
  Dosya yoksa ilk çalıştırmada rastgele üretilir ve sunucu başlarken konsola yazılır. Sayfa anahtarı ister.
- **Yalnız yerel erişim:** Yönetim API'leri (`/api/admin/*`) sadece sunucu makinesinden (`127.0.0.1`/`::1`)
  ve doğru anahtarla çalışır; `--host 0.0.0.0` ile açılsa bile ağdaki başka cihazlar erişemez.
- **Katılımcı kodları:** Yönetim ekranından `P01` gibi kodlar tanımlanır; öğrenci katılırken kodunu girer.
  Aynı kişinin farklı derslerdeki kayıtları bu kodla eşleşir (insan/YZ karşılaştırması bunu kullanır).
- **Materyal:** Öğretmen panelinde ders içinde görsel (PNG/JPEG) ya da görselsiz materyal yüklenir, türü
  `insan` / `yz` / `diger` seçilir; ders sırasında hangi materyalin gösterildiği panelden seçilir.
  Her 2 sn'lik örnek paketi, paketin başında ve sonunda aynı materyal gösteriliyorsa o materyale yazılır;
  paket bir materyal geçişini kapsıyorsa hiçbir materyale atanmaz (`gecis=1`), yalnız ders geneli özetlere girer.
- **CSV:** `uzun` (ders × öğrenci × materyal özeti, tüm dersler ya da tek ders) ve `ham` (tek dersin tüm
  örnekleri). Dosyalar Excel için BOM'lu UTF-8'dir. Uzun CSV'de `bakma_pct` kendi n'iyle gelir
  (`n_bakma_ornek`: katkı veren örnek, `n_kalibreli_ornek`); süresi bilinmeyen materyalde `sure_sn` boştur.
- **"Yalan veri yok" kuralları:** Her ölçünün yanında n (kaç öğrenci/ders) gösterilir; veri yoksa uydurma değer
  yerine "veri yok" yazılır; demo öğrenciler hiçbir kayda ve istatistiğe girmez; örnekleme sıklığı düşükse
  sakkad "ölçülemez" olarak işaretlenir. Düşük n'li sonuçlar istatistiksel kanıt değil, betimleyici özettir.

### Etik ve onam notu

İsimler, katılımcı kodları, bakış, duygu ve cihaz/kamera bilgileri **yalnızca yerel olarak** veri
klasöründeki `dersler.db` içinde saklanır: tarayıcı sürümünde `data/dersler.db`, masaüstü uygulamasında
uygulamada seçilen veri klasörü (varsayılan `Belgeler\DersNabzı\veri\dersler.db`). Sunucu dışına
gönderilmez, kamera görüntüsü hiç kaydedilmez. Veri klasörünü OneDrive gibi bulutla eşitlenen bir yere
koymayın (masaüstü uygulaması bu durumda başlangıç ekranında uyarır).
Katılımcılardan açık rıza ve aydınlatma (amaç, saklanan veriler, silme hakkı) alınmalıdır; kurumun etik
kurul/KVKK gereklilikleri uygulanmalıdır. Veriler öğrenci hakkında not/disiplin kararı için kullanılmamalıdır.

## Masaüstü uygulaması

`masaustu/` klasörü DersNabzı'yı Windows'ta tek uygulama olarak açar (Electron). Ayrı bir sürüm değildir:
aynı `server.py` sunucusunu arka planda başlatır, aynı sayfaları (öğretmen, öğrenci, bakış testi, yönetim)
pencerelerde açar ve aynı veri biçimini kullanır. Uygulama kapanınca (ya da çökerse) sunucu da kapanır.

- **Yalnız bu bilgisayar:** uygulamanın açtığı sunucu yalnız `127.0.0.1` üzerinde dinler. Uygulamada açılan
  dersler yalnız **aynı bilgisayardan** (uygulamanın Öğrenci penceresinden) katılıma açıktır; ağdaki başka
  cihazlar (öğrenci bilgisayarları, telefonlar) bu derslere katılamaz. Çok cihazlı sınıf için tarayıcı
  sürümünü (`python server.py --host 0.0.0.0`, HTTPS ile) kullanın.

- **Geliştirme:** `cd masaustu && npm install && npm start` (Python 3.9+ gerekir; sunucu `python server.py` ile başlar).
  Otomatik deneme: `npx electron . --smoke` (geçici veri ve profil klasörüyle çalışır, gerçek `data/`'ya dokunmaz).
- **Paketleme:** `powershell -ExecutionPolicy Bypass -File masaustu/build/paketle.ps1`. Önce PyInstaller ile
  sunucu tek klasör `dersnabzi-sunucu` olarak derlenir (`masaustu/build-py/`, PyInstaller 6 veya üstü gerekir),
  sonra electron-builder'ın NSIS kurulum dosyasını `masaustu/dist/` altına üretmesi amaçlanır (ilk çalıştırmada
  NSIS araçlarını indirir). Hedef: kurulumda sunucu `resources/sunucu/dersnabzi-sunucu.exe` olarak durur ve
  Python kurulu olması gerekmez. Paketli uygulama (`win-unpacked`) 2026-11-24'te geliştiricinin bilgisayarında
  `--smoke` ile doğrulandı; NSIS kurulum dosyasının üretimi henüz doğrulanmadı (aşağıdaki Sınırlar'a bakın).
  Üretilen dosyalar (`build-py/`, `dist/`) depoya girmez.
- **Veri klasörü:** tek ve seçilebilir; ders kayıtları, yönetici anahtarı ve bakış testi kayıtları
  (`<veri>/test_kayitlari/`) hep oradadır. Varsayılan: geliştirmede depodaki `data/` (tarayıcı sürümüyle aynı),
  kurulu uygulamada `Belgeler/DersNabzı/veri`. Başlangıç ekranında görünür, **Ayarlar**'dan değiştirilir
  (değişince sunucu yeniden başlar; var olan veriler yeni klasöre **taşınmaz**, eski klasörde kalır).
  Kurulum klasörüne hiçbir veri yazılmaz. Geliştirmede (`npm start`) varsayılan klasör tarayıcı sürümüyle
  **aynı** `data/` olduğundan `python server.py` ile uygulamayı aynı anda çalıştırmayın (iki sunucu aynı
  `dersler.db`'ye yazar). Veri klasörü OneDrive ile eşitlenen bir yerdeyse (Belgeler klasörü OneDrive'a
  yedekleniyorsa olur) başlangıç ekranı belirgin bir uyarı gösterir: öğrenci verileri buluta yüklenebilir;
  Ayarlar'dan yerel bir klasör seçin.
- **Kamera seçimi:** Ayarlar'da kamera (Varsayılan ya da takılı kameralardan biri) ve çözünürlük (Otomatik /
  1280×720 / 1920×1080) seçilir; bundan sonra açılan sayfa pencerelerinde geçerlidir. Uygulama, sayfa
  betiklerinden önce çalışan küçük bir sarmalayıcıyla (`masaustu/kamera.js`) sayfanın kamera isteğine yalnız
  seçili kamerayı ve çözünürlüğü ekler; sayfa kendisi bir kamera belirtiyorsa dokunmaz. Kamera adıyla bulunur;
  seçili kamera takılı değilse sayfa varsayılan kamerayla açılır ve başlangıç ekranında uyarı görünür.
  Kamera adlarının listelenmesi için başlangıç ekranına da kamera izni verilir (gerekirse kamera bir an açılıp
  hemen kapatılır).
- **Sayfa tercihleri ve port:** sayfaların tarayıcıda sakladığı tercihler (yüz profili, kamera yeri/zoom,
  kalibrasyon) adres kökenine, yani porta bağlıdır ve veri klasöründe değil **uygulama profilinde**
  (`%APPDATA%`) durur. Uygulama bu yüzden son başarılı portu hatırlar ve önce onu dener; port doluysa başka
  porta geçer ve bu tercihler o açılışta görünmez.
- **Kiosk:** öğrenci ve bakış testi pencereleri tam ekran kiosk olarak açılır (Ayarlar'dan kapatılabilir);
  öğretmen ve yönetim normal penceredir. Kiosk penceresinden çıkış **Ctrl+Shift+Q** (onay sorar).
  Esc sayfa tam ekranından çıkarsa pencere hemen tam ekrana döner; bu yüzden tam ekranda kalibrasyon Esc ile
  iptal edilemez, ekrandaki **Vazgeç** düğmesi kullanılır.
- **Kamera izni:** yalnız uygulamanın kendi başlattığı sunucunun adresine (ve kamera listesi için başlangıç
  ekranına) otomatik verilir; başka adreslere verilmez. Aynı adrese tam ekran ve panoya yazma (ders bağlantısını
  kopyala) izni de verilir; panodan okuma verilmez.
- **Yönetim ekranı:** uygulamadan açılınca yönetici anahtarını uygulama verir (adrese ya da ekrana yazılmaz).
- **Sınırlar:** yüz/bakış modelleri (MediaPipe, face-api, WebGazer) CDN'den yüklendiği için internet gerekir;
  yalnız Windows (x64) paketi var; kurulum dosyası imzasız olduğundan Windows SmartScreen uyarı verebilir.
  Elle sınanmadı: gerçek kamerayla kullanım (kamera seçimi dahil; sarmalayıcı yalnız birim testleri ve smoke'ta
  sahte ayarla sınandı), Ctrl+Shift+Q onay penceresi, Alt+F4 davranışı, klasör seçme penceresi.
  Doğrulandı (2026-11-24, `win-unpacked\DersNabzı.exe --smoke`, geliştiricinin bilgisayarı): paketli sunucu
  (`dersnabzi-sunucu.exe`) başlıyor, başlangıç ekranı, yönetim anahtarı, kamera izni, menüsüz pencere, kiosk
  tam ekrana dönüş, sunucu çökmesi uyarısı ve yeniden başlatma. Doğrulanmadı: NSIS kurulum dosyası henüz
  başarıyla üretilmedi (geliştirme ortamında NSIS adımı durdu; `paketle.ps1` yerel olarak yeniden çalıştırılmalı).

## Sınırlar / sonraki adımlar

- Söz alan öğrenci yalnızca sesle katılır; öğrenci kamerasının yayınlanması yok (gizlilik tercihi).
- Kullanıcı hesabı, okul/kurum (çok kiracılı) yapısı, kayıtlı video ders analitiği ve ödev modülü yok.
- Durum bellekte tutulur, tek süreç içindir; ölçek için Redis + veritabanı gerekir.
- Duygu tahmini ifade tabanlıdır ve kültüre, ışığa, kameraya göre hata yapar. Öğrenci hakkında
  not/disiplin kararı için kullanılmamalıdır; KVKK kapsamında açık rıza ve aydınlatma metni gereklidir.
- Yönetim ekranının arayüzü (admin.html) otomatik testlerle sınanmaz: testler yalnız sunucu ve
  sorgu katmanını kapsar; arayüzün elle kontrolü yapılmadı.
- Yönetim ekranı materyal görsellerini `<img>` ile yüklerken yönetici anahtarı URL'de (`?admin=`)
  taşınır; tarayıcı geçmişinde görünebilir. Yönetim API'leri yalnız yerelden çalışır ve anahtar
  sunucu loglarında `***` ile gizlenir.

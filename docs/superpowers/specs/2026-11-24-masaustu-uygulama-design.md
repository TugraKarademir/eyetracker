# Masaüstü uygulaması — tasarım

Tarih: 2026-11-24 · Proje: DersNabzı (E:\eyetracker) · Dal: bakis-kalibrasyon

## Amaç ve neden

Kullanıcı tarayıcıdan bağımsız bir uygulama istedi; tarayıcı sürümüyle **entegre** (aynı sunucu, aynı veri, aynı sayfalar).
Seçilen yol **A**: uygulama sunucuyu kendi içinde taşır — laboratuvar bilgisayarına bir kez kurulur, tek tıkla açılır,
Python kurmak gerekmez. Çevrim içi öğrenciler tarayıcıyı kullanmaya devam eder; veri aynı yere (aynı `data/` klasörü) gider.

Laboratuvarda kazandırdıkları (tarayıcıda olmayan): tam ekran kilidi (Esc ile çıkılmaz), kamera izni sorulmaz,
sekme arka plana düşüp yavaşlamaz, pencere/çözünürlük sabit, kamera seçimi kalıcı.
Hız beklentisi dürüst olmalı: aynı Chromium motoru, aynı kamera (30 fps tavan); hız kazancı Web Worker işinden gelir, uygulamadan değil.

## Hedefler

1. Electron kabuğu: açılışta gömülü sunucuyu (server.py) çocuk süreç olarak `127.0.0.1` üzerinde boş bir portta başlatır,
   hazır olana kadar bekler (sağlık isteği), sonra uygulama içi **başlangıç ekranını** açar.
2. Başlangıç ekranı (uygulamaya ait yerel sayfa): **Öğretmen paneli**, **Öğrenci — derse katıl**, **Bakış testi**, **Yönetim ekranı**,
   **Ayarlar** (veri klasörü, kamera, kiosk). Her seçim aynı sunucunun sayfasını uygulama penceresinde açar.
3. Kiosk modu (öğrenci ve bakış testi için varsayılan açık): tam ekran, Esc / F11 / Alt+F4 ile çıkış yok; çıkış yalnız
   **Ctrl+Shift+Q** + onay. Öğretmen ve yönetim pencereleri normal pencere.
4. Kamera izni: yalnız gömülü sunucunun kökeninden (`http://127.0.0.1:<port>`) gelen `media` istekleri kendiliğinden onaylanır;
   başka köken reddedilir. Seçilen kamera (deviceId) ve tercih edilen çözünürlük uygulama ayarında saklanır ve sayfalara
   mevcut `localStorage` tercihleri üzerinden geçer (sayfalar değişmeden; gerekirse küçük bir okuma eklentisi).
5. Yönetim ekranı uygulamada açılınca yönetici anahtarı **uygulama tarafından** o pencerenin oturumuna verilir (yerel dosyadan okunur);
   anahtar ekrana/URL'ye yazılmaz. Tarayıcıdan açılan yönetim ekranı bugünkü gibi anahtar sorar.
6. Veri: varsayılan veri klasörü uygulamanın yanındaki `data/` (depodan çalıştırınca `E:\eyetracker\data` — tarayıcı sürümüyle aynı).
   Kurulu uygulamada Ayarlar'dan seçilebilir. Sunucuya `--data <klasör>` ile verilir (sunucuya bu argüman eklenir).
7. Paketleme (Windows): sunucu PyInstaller ile tek klasör (Python kurmadan çalışır; yalnız standart kütüphane),
   Electron uygulaması electron-builder ile NSIS kurulum dosyası. `static/` sayfaları sunucu paketinin içinde.

## Hedef dışı

- B seçeneği (öğrenci uygulamasının ağdaki başka bir sunucuya bağlanması) — sonra; şimdi sunucu yalnız `127.0.0.1`.
- macOS/Linux paketleri (kod taşınabilir kalır ama yalnız Windows paketi yapılır).
- Kamera pozlama/odak gibi donanım ayarlarını kilitleme (MediaStreamTrack constraints ile mümkünse sonraki iş).
- Otomatik güncelleme, kod imzalama.

## Kaçınılacaklar

- Sahte/deneme verisi üretmek ya da paketlemek yok; uygulama boş veri klasörüyle başlar.
- Uygulama, sayfaların davranışını (ölçüm, kalibrasyon, kayıt) değiştirmez — aynı kod, aynı sonuçlar; fark yalnız kabukta.
- Uzak içerik yükleme yok: pencereler yalnız gömülü sunucunun kökeni + uygulamanın kendi sayfası (CDN'den gelen MediaPipe dosyaları hariç;
  bunlar bugün de CDN'den geliyor — internet yoksa bakış çalışmaz, başlangıç ekranında bu açıkça yazılır).
- `nodeIntegration` kapalı, `contextIsolation` açık, yalnız dar bir `preload` köprüsü.

## Yaklaşımlar

| | Yaklaşım | Artı | Eksi |
|---|---|---|---|
| **1** | **Electron + gömülü PyInstaller sunucusu** | Testlerle aynı Chromium; izin, kiosk, oturum denetimi tam; olgun paketleme | Kurulum ~150 MB |
| 2 | Tauri (WebView2) + gömülü sunucu | Küçük | Kamera/GPU/izin davranışı Chrome testlerinden farklı olabilir; Rust araç zinciri |
| 3 | Chrome "uygulama olarak yükle" (PWA) | Neredeyse sıfır iş | Sunucuyu taşımaz (A'yı karşılamaz), kiosk/izin denetimi yok |

**Seçilen: 1 — kullanıcı onayladı (2026-11-24).** Gerekçe: bakış ölçümleri Chrome'da doğrulandı; aynı motor sonuçların karşılaştırılabilirliğini korur.

## Yapı

```
masaustu/
  package.json          electron, electron-builder (devDependencies)
  main.js               uygulama yaşam döngüsü, pencereler, kiosk, izinler, menü yok
  sunucu.js             sunucu çocuk sürecini bul/başlat/izle/durdur (saf Node, test edilebilir)
  ayarlar.js            ayar dosyası (veri klasörü, kamera, kiosk) — userData içinde JSON
  preload.js            dar köprü: başlangıç ekranı için {ac(hedef), ayarlar(), ayarKaydet()}
  baslangic.html/.js    başlangıç ekranı (Türkçe)
  test/                 node:test ile sunucu.js ve ayarlar.js testleri
  build/                PyInstaller spec + paketleme betiği
```

Sunucu tarafında küçük değişiklik: `server.py` → `--data <klasör>` argümanı (DATA, STATIC değişmez) ve `GET /api/saglik` (`{"ok":true}`)
— hazır olma denetimi için; mevcut davranış değişmez.

Sunucu başlatma: geliştirmede `python server.py --port <p> --data <d>`; pakette `dersnabzi-sunucu.exe --port <p> --data <d>`.
Port: 8030'dan başlayıp boş olanı bul. Sağlık 15 sn içinde gelmezse hata ekranı (sunucu çıktısının son satırlarıyla).
Uygulama kapanınca çocuk süreç sonlandırılır; sunucu çökerse pencerede uyarı ve "yeniden başlat".

## Kullanıcının onayladığı kararlar (2026-11-24)

- Altyapı: Electron.
- Kiosk: yalnız öğrenci ve bakış testi pencereleri; öğretmen ve yönetim normal pencere.
- Veri: tek, seçilebilir veri klasörü; ders kayıtları **ve bakış testi kayıtları** (bugünkü `test_kayitlari/` + `gazelab.db`) bu klasöre gider
  (`<veri>/test_kayitlari/`). Kurulum klasörüne hiçbir şey yazılmaz. Varsayılan: tarayıcı sürümüyle aynı `data/` klasörü.
- Yönetim ekranı uygulamadan açılınca anahtarı uygulama verir (ekrana/adrese yazılmaz).
- Sorulmadan kalan öneriler (başlangıç ekranı düzeni, yalnız Windows paketi, hedef dışı maddeler) bu belgede öneri olarak durur; kullanıcı itiraz ederse değişir.

## Kurucuya bırakılanlar

- Başlangıç ekranının görünümü (mevcut `style.css` ile uyumlu).
- Kamera tercihinin sayfalara nasıl geçeceği (en az değişiklik: sayfaların zaten kullandığı localStorage anahtarı varsa onu doldurmak).
- PyInstaller ve electron-builder ayrıntıları; paketleme yalnız betik olarak hazırlanır, kurulum dosyası üretimi ağ/indirme gerektirdiğinden
  kullanıcı onayıyla çalıştırılır (npm install ve PyInstaller kurulumu dahil).

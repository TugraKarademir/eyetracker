# DersNabzı — komutlar ve bağlantılar

Tüm komutlar PowerShell içindir. Her satırı ayrı çalıştırın.

## 1. Sistemi tarayıcıda açmak (geliştirme)

Sunucuyu başlat (pencere açık kaldığı sürece çalışır; durdurmak için Ctrl+C):

```powershell
cd E:\eyetracker; python server.py --port 8030
```

Sunucu yalnız bu bilgisayardan erişilebilir (`127.0.0.1`). Veriler `E:\eyetracker\data\` klasörüne yazılır.

| Sayfa | Bağlantı |
|---|---|
| Ana sayfa | http://localhost:8030/ |
| Öğretmen paneli | http://localhost:8030/teacher.html |
| Öğrenci — derse katıl | http://localhost:8030/student.html |
| Bakış testi | http://localhost:8030/bakis_test.html |
| Yönetim ekranı | http://localhost:8030/admin.html |
| Ders raporu | ders bitince öğretmen paneli kendiliğinden açar; ya da öğretmen panelindeki "Son dersleriniz" listesinde "rapor" (`/report.html?code=<DERS KODU>`) |

Yönetim ekranının anahtarı sunucu ilk açıldığında konsola yazılır ve şu dosyadadır:

```powershell
Get-Content E:\eyetracker\data\yonetici_anahtari.txt
```

## 2. Masaüstü uygulaması

Geliştirme sürümünü aç (depodaki `data\` klasörünü kullanır; aynı anda tarayıcı sunucusunu çalıştırmayın):

```powershell
cd E:\eyetracker\masaustu; npm start
```

Paketlenmiş uygulamayı kurmadan aç:

```powershell
& "E:\eyetracker\masaustu\dist\win-unpacked\DersNabzı.exe"
```

Kurulum dosyası (başka bilgisayara kurmak için): `E:\eyetracker\masaustu\dist\DersNabzi-Kurulum-0.1.0.exe`
Kurulu uygulamanın varsayılan veri klasörü: `Belgeler\DersNabzı\veri` (uygulamanın Ayarlar bölümünden değiştirilir).
Kiosk penceresinden (öğrenci, bakış testi) çıkış: **Ctrl+Shift+Q**, sonra onay.

## 3. Paketlemek (kurulum dosyası üretmek)

İlk kez (bir kere yeterli):

```powershell
python -m pip install "pyinstaller>=6"
```

```powershell
cd E:\eyetracker\masaustu; npm install
```

Eski çıktıları silip baştan paketle:

```powershell
cd E:\eyetracker\masaustu; Remove-Item -Recurse -Force .\dist, .\build-py -ErrorAction SilentlyContinue; powershell -ExecutionPolicy Bypass -File .\build\paketle.ps1
```

Paketi denetle (geçici klasörle açılıp kapanır, sonunda `SMOKE: tamam` yazmalı):

```powershell
& "E:\eyetracker\masaustu\dist\win-unpacked\DersNabzı.exe" --smoke
```

## 4. Testler

```powershell
cd E:\eyetracker; python -m unittest discover tests
```

```powershell
cd E:\eyetracker\masaustu; npm test
```

```powershell
cd E:\eyetracker; node tests\re_ridge.test.mjs
```

```powershell
cd E:\eyetracker\masaustu; npx electron . --smoke
```

## 5. Sınıf testi (öğretmen bilgisayarı + lab)

**Uyarı:** sınıf testi için sunucuyu `python server.py` ile başlat; paketlenmiş masaüstü `.exe` kullanma, içinde hâlâ eski kod var.

**Ders öncesi kontrol listesi**

- [ ] Yalnız bir sunucu çalışıyor. Aynı portta iki sunucu varsa eski kod sessizce sunulur; kontrol (listede tek `server.py` olmalı):

```powershell
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like '*server.py*' } | Select-Object ProcessId, CommandLine
```

- [ ] Sunucu son `git pull`'dan sonra ve `labtest` dalında başlatıldı.
- [ ] Sertifika her lab bilgisayarına kuruldu (f).
- [ ] Her lab bilgisayarında `https://<IP>:8443` için site ayarı "Otomatik indirmeler: İzin ver" açık (f). Açık değilse Chrome ders sonundaki ikinci dosyayı engeller; çünkü o indirme bir tıklamadan değil, sunucunun ders sonu sinyalinden gelir.
- [ ] Lab bilgisayarlarının saatleri doğru.

**a. Öğretmen bilgisayarının IP adresini öğren** (öğrencilerle aynı ağdaki adresi seç):

```powershell
cd E:\eyetracker; powershell -ExecutionPolicy Bypass -File sinif\ip.ps1
```

Sertifikayı sınavdan bir gün önce üret ya da lab bilgisayarlarının saatlerinin doğru olduğunu kontrol et: saati geride kalan bilgisayar yeni üretilmiş sertifikayı "henüz geçerli değil" diye reddeder.

**b. Sertifikayı üret** (`<IP>` yerine a'daki adres; yerel CA + o IP için sunucu sertifikası, 1 yıl). Çıktılar `sinif\` içinde, depoya girmez:

```powershell
cd E:\eyetracker; powershell -ExecutionPolicy Bypass -File sinif\sertifika.ps1 -IP <IP>
```

**c. Güvenlik duvarı** (yönetici PowerShell; bir kez). Önce ağ profilini kontrol et:

```powershell
Get-NetConnectionProfile
```

"Public" görünüyorsa kural işlemez: yönetici olarak `Set-NetConnectionProfile -InterfaceAlias "<ad>" -NetworkCategory Private` çalıştır (`<ad>` = yukarıdaki InterfaceAlias) ya da aşağıdaki kuralda `-Profile Private,Domain,Public` yaz. Sunucu ilk kez başlayınca Windows "python'a izin verilsin mi?" diye sorabilir: Özel ağlar için İzin ver'e tıkla.

```powershell
New-NetFirewallRule -DisplayName "DersNabzi 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private,Domain
```

**d. Sunucuyu başlat** (ders boyunca açık kalsın):

```powershell
cd E:\eyetracker; python server.py --port 8030 --https-port 8443 --cert sinif\sertifika.pem --key sinif\anahtar.pem
```

**e. Öğretmen paneli** (öğretmen bilgisayarında tarayıcıya yaz): `https://localhost:8443/teacher.html` (ya da `http://localhost:8030/teacher.html`).

**f. Lab bilgisayarına sertifikayı kur** (her lab bilgisayarında bir kez). `sinif\DersNabzi-sertifika.crt` dosyasını USB ya da ağ paylaşımıyla kopyala, dosyanın olduğu klasörde çalıştır (yönetici hakkı gerekmez; Chrome/Edge kapatılıp yeniden açılır). Komut çalışınca Windows "Bu kök sertifikayı yüklemek istiyor musunuz?" penceresi açılır; her lab bilgisayarında biri **Evet**'e tıklamalıdır:

```powershell
certutil -user -addstore Root DersNabzi-sertifika.crt
```

Windows "güvenilir kök" uyarısı sorarsa Evet de. Firefox Windows deposunu kullanmaz: Ayarlar > Gizlilik ve Güvenlik > Sertifikalar > Sertifikaları Görüntüle > Yetkililer > İçe Aktar ile aynı dosyayı ekle ("Bu CA web sitelerini tanımlamak için güvenilsin" kutusu işaretli). Mümkünse lab'da Chrome/Edge kullan.

Sertifikadan sonra, otomatik yedek indirmeleri hiç engellenmesin diye her lab bilgisayarında Chrome/Edge'i ayarla:

- `https://<IP>:8443` adresini aç, kilit simgesi > Site ayarları > "Otomatik indirmeler" > İzin ver.
- Chrome: Ayarlar > İndirilenler > "Her dosyanın nereye kaydedileceğini sor" kapalı olsun. Edge'de aynı seçenek Ayarlar > İndirmeler altındadır.
- Ders sırasında "birden fazla dosya indirilsin mi?" çubuğu çıkarsa her zaman **İzin ver** seç. Engelle seçilirse o bilgisayarda sitenin otomatik indirmeleri engellenir.

**g. Öğrenci adresi** (öğrenciler tarayıcıya yazar; `<IP>` = a'daki adres):

```powershell
Write-Output "https://<IP>:8443/student.html"
```

**h. Veri nerede.** Tüm ders verisi yalnız öğretmen bilgisayarında: `E:\eyetracker\data` (ders/öğrenci kayıtları) ve `E:\eyetracker\test_kayitlari` (bakış testi kayıtları; `<kimlik>_kare.json` = kare başına öznitelikler, ortak model eğitimi için). Ders bitince yedekle:

```powershell
Compress-Archive -Path E:\eyetracker\data, E:\eyetracker\test_kayitlari -DestinationPath "E:\ders_yedek_$(Get-Date -Format yyyyMMdd_HHmm).zip"
```

**Ders sırasında bakış hatası ölçümü** (kalibrasyonla karşılaştırmak için; modeli değiştirmez):
- Kalibrasyondan 1 dk sonra, sonra her dakika (varsayılan; adrese bir şey yazmak gerekmez) ekranda 2,4 sn bir sarı nokta çıkar ("Kısa bakış kontrolü"); öğrenci yalnız bakar. Nokta önce hatayı ölçer, sonra gösterilen bakış noktasının sabit kaymasını düzeltir. Aralığı değiştirmek için öğrenci adresine `&kontrol=5` (dakika), kapatmak için `&kontrol=0`.
- Ders bitince öğrenciye 5 noktalı son kontrol sorulur (Başla / Atla, ~12 sn). Bitirdikten sonra yedek dosyalar iner. Atlanırsa `ders_sonu_atlandi` (neden: atla / zaman_asimi, 60 sn yanıt yok), gösterilemezse `ders_sonu_yapilmadi` (neden: model_yok, kamera_yok, duraklatildi, takip_kapali, pencere_degisti, kalibrasyon_suruyor) yazılır.
- Kontrol noktaları sürerken (ders içi ve ders sonu) `ders_kare` satırlarında `h` = [hedef x, hedef y (pencere px), sıra, tür, aşama (yerlesme/toplama)]: hedefi bilinen kareler. Ders sonu kontrolünün kareleri de kaydedilir.
- Ders boyunca her tıklamada tahmin ile tıklanan yer arasındaki fark ve kalibrasyondaki baş pozuna göre fark (ör. mesafe -15 cm) kaydedilir.
- Sonuçlar: `E:\eyetracker\test_kayitlari\ders_olcum\<DERS>_<sid>.jsonl` (her satır bir ölçüm) ve öğrencinin `..._ders.json` / `..._ders.csv` yedeğinde ("Bakış kontrolleri ve tıklama hataları" tablosu).

**Kare kare veri ve olay günlüğü** (ortak model eğitimi için; 25.11.2026):
- Ders sırasında her kamera karesinin öznitelikleri (göz, baş pozu, 52 yüz ifadesi değeri, iris, WebGazer göz yaması, görüntü kalitesi, kare zamanı, o karenin bakış tahmini) ~10 sn'de bir sunucuya gider: `test_kayitlari\ders_kare\<DERS>_<sid>.jsonl` (her satır bir parti). Satır biçimi `static\kare_kayit.js` başında. Boyut: örnek satırla hesaplandı (gerçek derste ölçülmedi), kare başına ~1,4 KB; 40 dakikada öğrenci başına saniyede 15 karede ~50 MB, 30 karede ~100 MB.
- Olay günlüğü (sekme/pencere değişimi, tam ekran, pencere boyutu ve konumu, fare hareketi ve tıklama, kaydırma, tuşa basma zamanı (hangi tuş olduğu alınmaz), kamera ayarı değişimi, işlemci yükü, pil, ağ, sunucu isteği süreleri): `test_kayitlari\ders_olay\<DERS>_<sid>.jsonl`. Tür listesi `static\olay_gunlugu.js` başında.
- Bakış testinde aynı satırlar `<kimlik>_kare.json` içinde (ara adımlar da: kamera ayarı, yüz profili nötr/kapalı/kameraya bakış, ısı testi); olay günlüğü aynı dosyada `olaylar` alanında.
- Olay günlüğünde ayrıca: ekran yerleşimi (bakış bölgelerinin kutuları, öğretmen görüntüsü çözünürlüğü; değişince), ekrana gelen içerik türü (sohbet mesajı, duyuru, konu, canlı yayın; metin alınmaz), tıklanan öğe (etiket/id/sınıf ve kutusu), sürükleme, yazı alanına odak, dakikada bir kare akışı kalitesi (yüzsüz kare %, kareler arası süre, işlenmeden geçen kamera karesi). Bakış testinde kalite özeti kare dosyasının başlığında (`kalite.tum` ve aşama başına).
- Beden verisi `test_kayitlari\ders_beden\<DERS>_<sid>.jsonl`: el noktaları (el algılayıcısının her ölçümü, ~5/sn; 21 nokta, yön, hareket adı, elin yüzü örtmesi) ve gövde duruşu (MediaPipe Pose lite, 3/sn; 33 nokta, dünya koordinatları, omuz açısı/genişliği, başın omuzlara göre yeri). Gövde modeli çalışma anında Google'dan yüklenir (internet gerekir); ölçüm başına medyan 60 ms'yi aşan yavaş bilgisayarda kendini kapatır ve olay günlüğüne `govde {kapandi}` yazar (ilk 5 ölçüm ısınma sayılmaz; karar medyana göre). `&govde=0` kapatır.
- Öğrenci adresine `&kare=0` kare kaydını kapatır (olaylar yine gider); `&kare=tam` göz kesitlerini de ekler (kare başına ~1600 sayı, birkaç kat büyük).
- Her kayıt dosyasında `sunucuSurum`: kayıt alınırken sunucunun çalıştırdığı kodun git özeti (`+degisik` = kaydedilmemiş kod değişikliği vardı).

**i. Sorun giderme.**
- Sayfa açılmıyor: öğrenci ve öğretmen bilgisayarı aynı ağda mı (öğretmen bilgisayarında c adımındaki kural var mı, ağ "Genel" mi)? Sunucu penceresi hâlâ açık mı?
- Sertifika uyarısı çıkıyor: f adımı o bilgisayarda yapıldı mı, tarayıcı kapatılıp açıldı mı? Adres `https://<IP>:8443` biçiminde ve b'de verilen IP ile aynı mı?
- Öğretmen bilgisayarının IP'si değişti (başka ağ, yeniden bağlanma): a ve b'yi yeni IP ile tekrarla, sunucuyu yeniden başlat, yeni `DersNabzi-sertifika.crt` dosyasını lab'a yeniden kur.
- Bağlantı testi (öğrenci bilgisayarında):

```powershell
Test-NetConnection <IP> -Port 8443
```

**j. Ders sonunda lab bilgisayarlarını elle temizleme.** Hiçbir şey otomatik silinmez; her lab bilgisayarında elle yapılır.

- Chrome/Edge: adres çubuğundaki kilit simgesi > Site ayarları > "Verileri sil" (adres `https://<IP>:8443`). Sitenin sakladığı her şeyi siler.
- Alternatif: DevTools konsolunda (F12 > Console):

```javascript
Object.keys(localStorage).filter(k=>k.startsWith("dn_")).forEach(k=>localStorage.removeItem(k))
```

- Sitenin yazdığı anahtarlar: `dn_student`, `dn_bakis_tamam_<DERSKODU>`, `dn_gaze_v2_<…>`, `dn_yuz_profili`, `dn_kamera_yeri`, `dn_kamera_zoom`, `dn_ls_base`, `dn_auto_hand`, `dn_hse`.
- İndirilen yedek dosyalar: lab bilgisayarı Downloads klasörüne otomatik indirir: kalibrasyon sonunda `dersnabzi_<DERS>_<ad>_<tarih>_bakis.json`, `..._bakis_ozet.csv` ve `..._bakis_kare.json` (kare başına öznitelikler, ortak eğitim için; birkaç MB), ders sonunda `..._ders.csv` ve `..._ders.json` (öğrenci sayfasındaki "Ders verimi indir" düğmesi de aynısını indirir). Chrome ilk indirmede bir kez "birden fazla dosya indirilsin mi?" diye sorabilir: **İzin ver**. Silmeden önce isterseniz bu dosyaları USB belleğe ya da öğretmen bilgisayarına kopyalayın; sonra elle silin (önce listele, sonra sil):

```powershell
Get-ChildItem "$env:USERPROFILE\Downloads\dersnabzi_*"
```

```powershell
Remove-Item "$env:USERPROFILE\Downloads\dersnabzi_*"
```

- Cache Storage'daki `dn-models-v1` yalnız model dosyalarını tutar, kişisel veri içermez.
- İsteğe bağlı: sertifikayı kaldır (CA'nın CN'i `DersNabzi sinif testi CA`):

```powershell
certutil -user -delstore Root "DersNabzi sinif testi CA"
```

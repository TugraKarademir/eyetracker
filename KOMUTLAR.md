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

**a. Öğretmen bilgisayarının IP adresini öğren** (öğrencilerle aynı ağdaki adresi seç):

```powershell
cd E:\eyetracker; powershell -ExecutionPolicy Bypass -File sinif\ip.ps1
```

**b. Sertifikayı üret** (`<IP>` yerine a'daki adres; yerel CA + o IP için sunucu sertifikası, 1 yıl). Çıktılar `sinif\` içinde, depoya girmez:

```powershell
cd E:\eyetracker; powershell -ExecutionPolicy Bypass -File sinif\sertifika.ps1 -IP <IP>
```

**c. Güvenlik duvarı** (yönetici PowerShell; bir kez). Ağ "Genel" (Public) profildeyse kural işlemez: ya ağı "Özel" yap ya da `-Profile Private,Domain,Public` yaz.

```powershell
New-NetFirewallRule -DisplayName "DersNabzi 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private,Domain
```

**d. Sunucuyu başlat** (ders boyunca açık kalsın):

```powershell
cd E:\eyetracker; python server.py --port 8030 --https-port 8443 --cert sinif\sertifika.pem --key sinif\anahtar.pem
```

**e. Öğretmen paneli** (öğretmen bilgisayarında tarayıcıya yaz): `https://localhost:8443/teacher.html` (ya da `http://localhost:8030/teacher.html`).

**f. Lab bilgisayarına sertifikayı kur** (her lab bilgisayarında bir kez). `sinif\DersNabzi-sertifika.crt` dosyasını USB ya da ağ paylaşımıyla kopyala, dosyanın olduğu klasörde çalıştır (yönetici gerekmez; Chrome/Edge kapatılıp yeniden açılır):

```powershell
certutil -user -addstore Root DersNabzi-sertifika.crt
```

Windows "güvenilir kök" uyarısı sorarsa Evet de. Firefox Windows deposunu kullanmaz: Ayarlar > Gizlilik ve Güvenlik > Sertifikalar > Sertifikaları Görüntüle > Yetkililer > İçe Aktar ile aynı dosyayı ekle ("Bu CA web sitelerini tanımlamak için güvenilsin" kutusu işaretli). Mümkünse lab'da Chrome/Edge kullan.

**g. Öğrenci adresi** (öğrenciler tarayıcıya yazar; `<IP>` = a'daki adres):

```powershell
Write-Output "https://<IP>:8443/student.html"
```

**h. Veri nerede.** Tüm ders verisi yalnız öğretmen bilgisayarında: `E:\eyetracker\data` (ders/öğrenci kayıtları) ve `E:\eyetracker\test_kayitlari` (bakış testi kayıtları). Ders bitince yedekle:

```powershell
Compress-Archive -Path E:\eyetracker\data, E:\eyetracker\test_kayitlari -DestinationPath "E:\ders_yedek_$(Get-Date -Format yyyyMMdd_HHmm).zip"
```

**i. Sorun giderme.**
- Sayfa açılmıyor: öğrenci ve öğretmen bilgisayarı aynı ağda mı (öğretmen bilgisayarında c adımındaki kural var mı, ağ "Genel" mi)? Sunucu penceresi hâlâ açık mı?
- Sertifika uyarısı çıkıyor: f adımı o bilgisayarda yapıldı mı, tarayıcı kapatılıp açıldı mı? Adres `https://<IP>:8443` biçiminde ve b'de verilen IP ile aynı mı?
- Öğretmen bilgisayarının IP'si değişti (başka ağ, yeniden bağlanma): a ve b'yi yeni IP ile tekrarla, sunucuyu yeniden başlat, yeni `DersNabzi-sertifika.crt` dosyasını lab'a yeniden kur.
- Bağlantı testi (öğrenci bilgisayarında):

```powershell
Test-NetConnection <IP> -Port 8443
```

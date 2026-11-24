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

# Masaüstü Uygulaması Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gömülü DersNabzı sunucusunu başlatan, aynı sayfaları kiosk/izin denetimiyle açan Electron uygulaması (Windows).

**Architecture:** `masaustu/` altında Electron kabuğu; sunucu yönetimi ve ayarlar saf Node modülleri (node:test ile test edilir);
sunucuya yalnız `--data` argümanı ve `/api/saglik` eklenir. Paketleme betikleri hazırlanır; indirme gerektiren kurulumlar (npm install, PyInstaller) kullanıcı onayıyla.

**Tech Stack:** Electron, electron-builder, Node 24 `node:test`, Python 3.12 stdlib, PyInstaller.

**Spec:** `docs/superpowers/specs/2026-11-24-masaustu-uygulama-design.md`

## Global Constraints

- Sayfaların (static/*) ölçüm/kalibrasyon/kayıt davranışı değişmez; yalnız kabuk eklenir.
- Sunucu yalnız `127.0.0.1`; kamera izni yalnız o kökene; `nodeIntegration:false`, `contextIsolation:true`, dar preload.
- Sahte/deneme verisi yok; uygulama verilen veri klasörünü olduğu gibi kullanır.
- Kiosk: öğrenci ve bakış testi pencereleri tam ekran, çıkış yalnız Ctrl+Shift+Q + onay.
- Arayüz metinleri Türkçe. Commit sonu: boş satır + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- İnternetten paket indiren komutlar (npm install, pip install, electron-builder) kullanıcı onayı olmadan çalıştırılmaz; testler indirme gerektirmeyen saf Node/Python testleridir.

## Review Focus

- Sunucu portu doluysa → sıradaki boş port; sunucu 15 sn'de hazır olmazsa → hata ekranı (çıktının son satırları), uygulama asılı kalmaz (Task 2 testi).
- Uygulama kapanınca sunucu süreci kalmaz (Task 2 testi: durdur() sonrası süreç ölü).
- Başka kökenden kamera isteği → reddedilir (Task 3: izin işleyici saf fonksiyon olarak test edilir).
- `--data` verilmezse eski davranış (`ROOT/data`) aynen (Task 1 testi).
- Ayar dosyası bozuksa → varsayılanlarla açılır, dosya yedeklenir (Task 2 testi).

---

### Task 1: Sunucu — `--data` argümanı ve `/api/saglik`
**Files:** Modify `server.py` (main, DATA kullanımı); Test `tests/test_sunucu.py`
- `--data <klasör>` verilirse modül düzeyindeki `DATA` o klasöre ayarlanır (ve `os.makedirs`); KAYIT o klasördeki `dersler.db` ile yeniden açılır; yönetici anahtarı dosyası da oradadır. Verilmezse bugünkü davranış.
- `GET /api/saglik` → `{"ok": true, "surum": 1}` (kimlik gerektirmez, veri içermez).
- [ ] Testler: `test_saglik_200`; `test_data_argumani` (main'in ayrıştırma/uygulama yardımcısını ayrı bir fonksiyon `veri_klasoru_ayarla(yol)` yap ve onu test et: DATA ve KAYIT yeni klasöre döner).
- [ ] `python -m unittest discover tests` yeşil → commit "Sunucu: --data klasörü ve /api/saglik".

### Task 2: `masaustu/` iskeleti, sunucu yönetimi ve ayarlar (saf Node)
**Files:** Create `masaustu/package.json`, `masaustu/sunucu.js`, `masaustu/ayarlar.js`, `masaustu/test/sunucu.test.mjs`, `masaustu/test/ayarlar.test.mjs`, `masaustu/.gitignore` (node_modules, dist)
- `sunucu.js`: `bosPortBul(baslangic=8030) -> Promise<number>`; `baslat({komut, argumanlar, port, veri, zamanAsimiMs=15000}) -> Promise<{port, surec, durdur()}>` (sağlık `/api/saglik` yoklaması; zaman aşımında süreç öldürülür ve son 40 satır çıktıyla hata); `durdur()` süreci sonlandırır ve çıkışını bekler.
  Geliştirmede komut: `python` + `[repo/server.py, --port, p, --data, veri]`; pakette `resources/sunucu/dersnabzi-sunucu.exe`.
- `ayarlar.js`: `yukle(dosya) -> {veriKlasoru, kameraId, cozunurluk, kiosk:{ogrenci:true, test:true}}`, `kaydet(dosya, ayar)`; bozuk JSON → varsayılan + `dosya.bozuk-<zaman>` yedeği.
- `package.json`: scripts `test: node --test test/`, `start: electron .`; devDependencies electron, electron-builder (sürümler sabit); **npm install çalıştırma**.
- [ ] Testler (node:test, gerçek `python server.py` çocuk süreciyle, geçici veri klasörü): sağlıklı başlatma; port doluyken sıradaki port; zaman aşımı (sağlık vermeyen sahte komut, ör. `python -c "import time; time.sleep(60)"`) → hata + süreç ölü; `durdur()` sonrası süreç yok; ayar bozuk dosya.
- [ ] `cd masaustu && node --test test/` yeşil → commit "Masaüstü: sunucu yönetimi ve ayarlar".

### Task 3: Electron ana süreç, başlangıç ekranı, kiosk ve izinler
**Files:** Create `masaustu/main.js`, `masaustu/preload.js`, `masaustu/baslangic.html`, `masaustu/baslangic.js`, `masaustu/izin.js` (saf: `izinVerilsinMi(kokenUrl, izin, sunucuKoken) -> boolean`), `masaustu/test/izin.test.mjs`
- Başlangıç ekranı: dört düğme (Öğretmen paneli → `/teacher.html`, Öğrenci → `/student.html`, Bakış testi → `/bakis_test.html`, Yönetim → `/admin.html`), Ayarlar (veri klasörü seç, kiosk anahtarları), sunucu durumu, "MediaPipe dosyaları internetten gelir; internet yoksa bakış çalışmaz" notu.
- Kiosk pencereleri: `kiosk:true`, `before-input-event` ile Esc/F11/Alt+F4 engeli, Ctrl+Shift+Q → onay → kapat.
- İzin: `session.setPermissionRequestHandler` + `setPermissionCheckHandler` → `izin.js`; yalnız sunucu kökeni + `media`.
- Yönetim penceresi: anahtar dosyasını (veri klasöründeki `yonetici_anahtari.txt`) okuyup `webContents.executeJavaScript` ile o pencerenin `sessionStorage['dn_admin_key']`'ine yazar (URL'ye koymaz); dosya yoksa sayfa anahtar sorar.
- Pencere dış bağlantıları (`setWindowOpenHandler`) → yalnız sunucu kökeni, diğerleri varsayılan tarayıcıda (`shell.openExternal`) yalnız http/https.
- [ ] Testler: `izin.test.mjs` (aynı köken+media true; başka köken false; aynı köken başka izin false). Electron gerektiren kısım için `npm start` ile elle doğrulama **kullanıcı onayıyla npm install yapıldıktan sonra**; onay yoksa rapora "elle doğrulanmadı" yaz.
- [ ] commit "Masaüstü: Electron kabuğu, başlangıç ekranı, kiosk ve kamera izni".

### Task 4: Paketleme betikleri ve README
**Files:** Create `masaustu/build/sunucu.spec` (PyInstaller, `server.py` + `kayit.py` + `yonetim.py` + `static/`), `masaustu/build/paketle.ps1` (1: PyInstaller ile `dersnabzi-sunucu` klasörü, 2: electron-builder NSIS; `extraResources` ile sunucu klasörü), `masaustu/electron-builder.yml`; Modify `README.md` ("Masaüstü uygulaması" bölümü: geliştirme `npm start`, paketleme adımları, veri klasörü, kiosk çıkışı, sınırlar).
- `main.js`'te paket/geliştirme komut seçimi (`app.isPackaged`).
- [ ] Doğrulama: `node --check` tüm js; `python -m unittest discover tests`; `cd masaustu && node --test test/`. Paket üretimi kullanıcı onayıyla (indirme).
- [ ] commit "Masaüstü: paketleme betikleri ve README".

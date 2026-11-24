# Eğitim Sayfası Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3 kişinin bakış testi verisini birleştiren, yöntem karşılaştırma / aktarım kuralı denemesi / hız-aşama / ortak eğitim hazırlığı bölümleri olan yerel eğitim sayfası.

**Architecture:** Birleştirme sunucuda (`egitim.py`, SQLite `data/egitim/birlesik.db`); giriş = yönetim ekranının mevcut "Veri paketi" ZIP biçimi (sayfadan yükleme + depodaki `egitim_verisi/*.zip` taraması). Sayfa (`static/egitim.html` + `static/egitim.js`) birleşik veriyi okur; hesaplar saf fonksiyonlar olarak `static/egitim_hesap.js` (node ile test). Kare başına öznitelik kaydı bakış testinden ayrı dosyaya gönderilir (ısı testi deseni).

**Tech Stack:** Python stdlib (http.server, sqlite3, zipfile, json), vanilla JS, node test betikleri (tests/*.test.mjs deseni), unittest.

**Spec:** docs/superpowers/specs/2026-11-24-egitim-sayfasi-design.md

## Global Constraints
- Yalan veri yok: her sayıda n; eksik → "veri yok"; 1–2 oturumla çıkan farklara "kanıt değil" uyarısı.
- Eksik veri de tutulur: yarıda kalan/ara kayıt/kontrolsüz/GL'siz/ısı dosyası eksik oturumlar atılmaz; her oturumda `durum` ("tam"|"eksik") ve `eksik` listesi; tablolarda varsayılan hepsi, "yalnız tam oturumlar" süzgeci.
- Öğrenci adları birleşik veriye girmez (dersler.db'den yalnız kalibrasyon raporları, ad/katılımcı kodu alanları alınmaz); kişi = kaynak etiketi.
- Erişim yönetim ekranı gibi: yalnız yerel istemci + yönetim anahtarı (`Handler.admin_ok`).
- Birleşik veri `data/egitim/` (DATA altında; git'e girmez). Yüklenen ZIP'ler `data/egitim/yuklenen/`.
- Depo klasörü: `<ROOT>/egitim_verisi/*.zip`, dosya adı (uzantısız) = kişi etiketi.
- Bakış testi kayıtlarının yeri: geliştirme sunucusunda `TEST_DIR = <ROOT>/test_kayitlari` (DERSNABZI_DATA verilirse `<DATA>/test_kayitlari`); `veri_paketi()` bunu `bakis_testi/` olarak paketler.
- Kontrolün adım adım öğrenmeyle (ADIM_OGRET) mi bağımsız mı ölçüldüğü ayrı gösterilir, karıştırılmaz (günlükteki `adimOgret` / KONTROL başladı satırından).
- Ajanlar tarayıcı/preview/Electron --smoke AÇMAZ; yalnız `node --check`, node birim testleri, `python -m unittest discover tests`.

## Review Focus
1. Aynı ZIP iki kez yüklenince ya da aynı oturum iki kaynakta varsa → yinelenmez, sayılar iki katına çıkmaz (Task 1 testi).
2. Bozuk/yarım ZIP, beklenen dosyası olmayan ZIP, bozuk JSON günlük → kaynak "hatalı" olarak listelenir, sunucu çökmez, diğer kaynaklar etkilenmez (Task 1 testi).
3. ZIP içinde yol kaçışı (`../`), çok büyük ZIP (sınır 400 MB, aşılırsa 413, kırpma yok) (Task 2 testi).
4. Eksik oturum (kontrol yok / GL yok / bitmemiş) → tablolarda "veri yok" hücre, oturum diğer ölçüleriyle sayılır, "yalnız tam" süzgeci onu çıkarır (Task 1 + Task 3 testi).
5. Aktarım kuralı denemesi mevcut `aktarimSec` ile aynı varsayılanlarla aynı seçimi yapar (Task 3 testi: aynı tablo girdisi → aynı kod).

---

### Task 1: Birleştirme çekirdeği (`egitim.py`)

**Files:** Create `egitim.py`, `tests/test_egitim.py`

**Interfaces — Produces:**
- `ac(yol) -> sqlite3.Connection` — birlesik.db şemasını kurar (WAL). Tablolar: `kaynaklar(id TEXT PK, etiket TEXT, tur TEXT /*'yuklenen'|'depo'*/, dosya TEXT, sha256 TEXT, eklendi REAL, aktif INTEGER, durum TEXT /*'tamam'|'hatali'*/, hata TEXT)`, `oturumlar(kaynak TEXT, id TEXT, created REAL, completed REAL, status TEXT, durum TEXT, eksik TEXT /*json liste*/, adim_ogret INTEGER NULL, cihaz TEXT /*json*/, meta TEXT /*json*/, log_file TEXT, PRIMARY KEY(kaynak,id))`, `yontemler(kaynak, oturum, method, label, gl_accuracy_px, gl_precision_px, gl_median_px, gl_corrected_px, control_median_px, control_hit150_pct, control_cell_pct, sample_hz, row TEXT, PRIMARY KEY(kaynak,oturum,method))`, `asamalar(kaynak, oturum, idx, phase, row TEXT, PK(kaynak,oturum,idx))`, `oturum_olculeri(kaynak, oturum, idx, section, name, value, PK(...))`, `gunlukler(kaynak, dosya, oturum NULL, ara INTEGER, n_tiklama INTEGER, ozet TEXT /*json: tiklamaOz, aktarim, adim adim satırı*/, PK(kaynak,dosya))`, `kalibrasyonlar(kaynak, t, code, sid_hash, report TEXT)` (sid yerine sha256(sid)[:12]; ad yok).
- `paket_ekle(con, zip_bayt: bytes, etiket: str, tur: str, dosya: str) -> dict` — `{"kaynak": id, "durum": "tamam"|"hatali", "oturum": n, "eksik": n, "gunluk": n, "hata": str|None}`. Kaynak kimliği = sha256(zip)[:16]; aynı sha zaten varsa yeni kaynak açmaz, mevcut kaynağı döndürür (`"yinelenen": True`). Aynı oturum kimliği başka kaynakta varsa ikinci kopya `oturumlar`a girer ama `durum` alanına değil, ayrı alana `yinelenen_kaynak` yazılır ve sorgularda (Task 1 `birlesik`) bir kez sayılır.
- `oturum_durumu(status, yontem_satirlari, gunluk_ozeti) -> (durum, eksik_listesi)` — eksik nedenleri sabit metinler: "bitmedi", "kontrol yok", "GazeLab yok", "ısı dosyası yok" (yalnız ısı testi yapıldıysa ve `isiTestiDosya` dosyası pakette yoksa), "ara kayıt".
- `kaynaklar(con) -> list[dict]`, `kaynak_ayarla(con, id, aktif: bool)`, `kaynak_sil(con, id)` (bütün tablolardan).
- `depo_tara(con, klasor) -> list[dict]` — `klasor/*.zip` her biri `paket_ekle(..., tur="depo")`.
- `birlesik(con, yalniz_tam=False, yalniz_aktif=True) -> dict` — `{"kaynaklar":[...], "oturumlar":[...], "yontemler":[...], "asamalar":[...], "olculer":[...], "gunlukler":[...], "kalibrasyonlar":[...]}` (yinelenen oturumlar bir kez).

- [ ] Step 1: `tests/test_egitim.py` — testlerde ZIP, `server.veri_paketi()` biçiminde bellekte üretilir (tests/tohum.py tarzı yardımcı; gazelab.db şeması server.py `gl_db` ile aynı). Testler: `test_paket_ekle_oturum_yontem_asama`, `test_ayni_zip_iki_kez_yinelenmez`, `test_ayni_oturum_iki_kaynakta_bir_kez_sayilir`, `test_eksik_oturum_tutulur_ve_nedeni_yazilir` (status≠completed, kontrol satırı yok → durum "eksik", eksik ⊇ {"bitmedi","kontrol yok"}; `birlesik(yalniz_tam=True)` onu çıkarır, varsayılan içerir), `test_bozuk_zip_hatali_kaynak` (rastgele bayt → durum "hatali", istisna yok; sonra geçerli ZIP eklenebilir), `test_bozuk_json_gunluk_atlanir_kaynak_tamam`, `test_ogrenci_adi_girmez` (dersler.db'deki öğrenci adı birlesik.db'nin hiçbir hücresinde geçmez), `test_kaynak_pasif_ve_sil`, `test_depo_tara_etiket_dosya_adi`.
- [ ] Step 2: `python -m unittest tests.test_egitim -v` → FAIL (modül yok).
- [ ] Step 3: `egitim.py`'yi yaz. ZIP üyeleri yalnız `dersler.db`, `gazelab.db`, `bakis_testi/*.json` okunur; db'ler geçici klasöre çıkarılıp salt-okunur açılır; üye adları normalleştirilir, `..`/mutlak yol içerenler yok sayılır. Günlük özeti: `tiklamaOz`, `log` içindeki `aktarim`, `adimAdim`, `adimOgret`, `tablo`, `asamaTablosu` nesneleri (varsa) + ara kayıt mı (`gazelab` alanı yok ya da günlükte "kalibrasyon durdu"/ara gönderim) — bulunamayan alan yazılmaz (uydurma yok).
- [ ] Step 4: testler PASS.
- [ ] Step 5: Commit `Eğitim: veri paketlerini birleştiren çekirdek (egitim.py)`.

### Task 2: Sunucu uçları

**Files:** Modify `server.py` (admin_get / do_POST yönlendirmeleri, `DATA` altında `EGITIM_DB = data/egitim/birlesik.db`, `EGITIM_MAX = 400_000_000`), `tests/test_sunucu.py`

**Interfaces — Consumes:** Task 1. **Produces (hepsi `admin_ok` ister, yoksa 403):**
- `GET /api/admin/egitim/veri?tam=1` → `egitim.birlesik(...)`
- `GET /api/admin/egitim/kaynaklar` → `egitim.kaynaklar`
- `POST /api/admin/egitim/yukle?etiket=<ad>` gövde = ZIP baytları (Content-Type application/zip); > EGITIM_MAX → 413 "çok büyük, yazılmadı"; ZIP `data/egitim/yuklenen/<sha16>.zip` olarak saklanır; döner `paket_ekle` sonucu.
- `POST /api/admin/egitim/kaynak` JSON `{id, aktif?|sil?}`.
- `POST /api/admin/egitim/tara` → `depo_tara(con, ROOT/egitim_verisi)`.
- `GET /egitim.html` statik (mevcut statik sunum).
- Masaüstü uyumu: `masaustu/build/sunucu.spec` `hiddenimports`'a `"egitim"`; `masaustu/main.js` yönetim anahtarını yalnız `/admin.html`'e enjekte ediyor (satır ~186) → `/egitim.html` da eklenir; `masaustu/test/*.test.mjs` içinde bunu sınayan birim testi (mevcut desen). Electron'da indirme (`will-download`) işleyicisi yok: veri paketi ZIP / CSV indirmesi için kayıt yeri sorulan bir işleyici ekle (varsayılan Belgeler\DersNabzı), birim testi mümkünse.
- [ ] Step 1: testler: `test_egitim_yetkisiz_403`, `test_egitim_yukle_ve_veri`, `test_egitim_cok_buyuk_413_yazilmaz`, `test_egitim_etiket_temizlenir` (etiket `../x<>` → güvenli ad), `test_egitim_tara_depo`.
- [ ] Step 2: FAIL → Step 3: uygula (birlesik.db bağlantısı istek başına; yazmalar tek kilitle) → Step 4: `python -m unittest discover tests` PASS → Step 5: Commit.

### Task 3: Sayfa ve hesaplar (bölüm 1–3)

**Files:** Create `static/egitim.html`, `static/egitim.js`, `static/egitim_hesap.js`, `tests/egitim_hesap.test.mjs`; Modify `static/admin.html` (nav'a "Eğitim" bağlantısı → `/egitim.html`, anahtar sessionStorage `dn_admin_key` ile aynı).

**Interfaces — Consumes:** Task 2 uçları. **Produces (`egitim_hesap.js`, saf):**
- `suz(veri, {yalnizTam, kisiler, ekran, kamera, adimOgret}) -> veri`
- `yontemTablosu(veri) -> [{kisi, method, label, n_oturum, gl_acc:{ort,n}, gl_prec:{ort,n}, k_med:{ort,n}, k150:{ort,n}}]` (eksik → null, n=0)
- `aktarimDene(oturumYontemleri, {esik=250, oncelik="karmaH", sira=["k150","kOrt","gl"]}) -> {kod, gerekce}` — bakis_test.html `aktarimSec` ile aynı mantık (o fonksiyonu kaynak olarak oku; aday kümesi gaze.js `GZ_SECIM_KOD` + "biz").
- `aktarimOzet(veri, kural) -> [{oturum, kisi, secilen, secilenKontrolMed, mevcutKural, mevcutKontrolMed}]` + toplam fark {ort, n}.
- `hizTablosu(veri) -> [{kisi, cihaz, tarayici, asama, islemeFps:{ort,n}, mpMs, isciMs, uzunGorevMs, betikler}]`
- Sayfa: üstte kaynak listesi (etiket, tür, oturum sayısı, eksik sayısı, aktif kutusu, sil), "ZIP yükle" (dosya + etiket), "Depoyu tara"; süzgeçler (yalnız tam, kişi, ekran, kamera, kontrol türü ADIM_OGRET/bağımsız); üç bölüm tablosu; oturum sayısı < 3 olan karşılaştırmalarda "kanıt değil (n=…)" uyarısı; her hücre `değer (n)` ya da "veri yok".
- [ ] Step 1: `tests/egitim_hesap.test.mjs`: yontemTablosu n ve null; suz yalnizTam; aktarimDene varsayılanla bakis_test'teki örnek (karmaH eşiği geçmiş → karmaH; hiçbiri geçmemiş → "biz"); aktarimOzet fark hesabı; hizTablosu eksik aşama "veri yok".
- [ ] Step 2: FAIL → Step 3: uygula → Step 4: `node tests/egitim_hesap.test.mjs`, `node --check static/egitim.js static/egitim_hesap.js` PASS → Step 5: Commit.

### Task 4: Kare başına öznitelik kaydı (bölüm 4a)

**Files:** Modify `static/bakis_test.html`, `server.py`, `tests/test_sunucu.py`

**Interfaces — Produces:** bakış testi, ölçüm sonunda (guideFinish, ısı gönderiminden önce) `POST /api/testlog-oz` ile `{ozKimlik, ana, kareler:[{asama, hedef:[x,y]|null, t, raw, wgp, re, pose3, blink}]}` gönderir → `TEST_DIR/<ozKimlik>_oz.json` (ısı ucu deseni: kimlik `[A-Za-z0-9_-]{8,60}`, sınır `OZ_MAX_BYTES = 200_000_000`, aşılırsa 413, kırpma yok). Yalnız kalibrasyon/ölçüm aşamalarında hedefi bilinen kareler (bakarak, baş turu, düzeltme, GazeLab, kontrol tıklama pencereleri). Ana kayıtta özet: `ozDosya`, `ozGonderildi`, kare sayısı, bayt. Başarısızlık ekranda (mevcut `kayitHataGoster` deseni) + "tekrar gönder". `veri_paketi()` zaten `TEST_DIR/*.json`'u alır; Task 1 `_oz.json` dosyalarını `gunlukler`e değil yeni `ozler(kaynak, dosya, oturum, n, bayt)` tablosuna kaydeder (kareler birlesik.db'ye kopyalanmaz, ZIP'te/yüklenen dosyada kalır; yol saklanır).
- [ ] Step 1: sunucu testleri (`test_testlog_oz_yazilir`, `_413`, `_yol_kacisi`) + Task 1'e `test_oz_dosyasi_kaydedilir`.
- [ ] Step 2: FAIL → Step 3: uygula (kare tamponu `buf` 8 sn tutuyor: öznitelikleri aşama sırasında topla, `re` Float32 → yuvarlanmış dizi 3 basamak) → Step 4: testler + `node --check` → Step 5: Commit. Raporda: 1 oturum için tahmini bayt (kare sayısı × kare başına bayt, hesapla, ölçülmemişse öyle yaz).

### Task 5: Bir kişiyi dışarıda bırak denemesi (bölüm 4b)

**Files:** Modify `static/egitim_hesap.js`, `static/egitim.js`, `tests/egitim_hesap.test.mjs`; server: `GET /api/admin/egitim/oz?kaynak=&dosya=` (admin_ok; kaynağın ZIP'inden ya da TEST_DIR'den `_oz.json` döner).

**Interfaces — Produces:** `lopo(kisiKareleri: {kisi: [kare]}, {yontem:"biz", oz: gzModelFeatures}) -> [{kisi, yalnizKendi:{med,n}, onEgitimli:{med,n}}]` — ölçüm: kişinin kontrol kareleri; "yalnız kendi" = kişinin kalibrasyon kareleriyle ridge (gaze.js `GazeModel`); "ön eğitimli" = diğer kişilerin kareleri + kişinin kalibrasyon kareleri (kişinin kendi satırları diğerlerinin toplamıyla eşit ağırlıkta). İlk sürüm yalnız `biz` öznitelikleri (gzModelFeatures); kişi < 2 ya da kontrol karesi yok → `"veri yetersiz"`.
- [ ] Step 1: test: sentetik 3 kişi (aynı doğrusal ilişki + kişiye özgü kayma) → onEgitimli ve yalnizKendi sayı döner, n doğru; 1 kişi → "veri yetersiz".
- [ ] Step 2: FAIL → Step 3: uygula (gaze.js ve sınıfları node'da `vm` ile yükle, re_ridge.test.mjs deseni) → Step 4: PASS → Step 5: Commit.

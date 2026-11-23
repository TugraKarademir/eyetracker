# Yönetim Ekranı Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her dersi materyal (slayt) ve katılımcı koduyla kalıcı olarak SQLite'a yazan ve bunu ders → materyal → öğrenci → insan/YZ karşılaştırması olarak gösteren yerel bir yönetim ekranı.

**Architecture:** Kalıcı kayıt yeni bir `kayit.py` modülünde (yalnız yazma), sorgular/özetler `yonetim.py`'de (yalnız okuma); `server.py` bu ikisini mevcut uç noktalara bağlar ve `/api/admin/*` ekler. Canlı ders bugünkü gibi bellek + `data/<KOD>.json` ile çalışmaya devam eder. Arayüz: `static/admin.html` + `static/admin.js` (düz JS, canvas), öğretmen paneline materyal bölümü, öğrenci girişine katılımcı kodu.

**Tech Stack:** Python 3.12 standart kütüphane (`http.server`, `sqlite3`, `unittest`), düz HTML/JS/canvas. Yeni bağımlılık yok.

**Spec:** `docs/superpowers/specs/2026-11-23-yonetim-ekrani-design.md` (önce onu okuyun).

## Global Constraints

- Yalnız Python standart kütüphanesi; yeni pip/npm bağımlılığı, CDN kütüphanesi yok.
- Veritabanı dosyası: `data/dersler.db` (`data/` zaten gitignore'da). Test veritabanı `test_kayitlari/gazelab.db` ayrı kalır, dokunulmaz.
- Yönetim uç noktaları ve `/admin.html` verisi yalnız `127.0.0.1`/`::1`'den **ve** geçerli yönetici anahtarıyla yanıt verir; aksi 403.
- Yönetici anahtarı: `DERSNABZI_ADMIN_KEY` ortam değişkeni, yoksa `data/yonetici_anahtari.txt` (yoksa ilk çalıştırmada `secrets.token_urlsafe(18)` ile üretilir, konsola bir kez yazılır). Öğretmen anahtarından ayrı.
- Demo öğrenciler (`demo=True`) kalıcı kayda hiç yazılmaz.
- Kaba (coarse) ya da kalibresiz örnekte bakış noktası saklanmaz; `gaze_cal=0`, `coarse` bayrağı saklanır.
- "Yalan veri yok": her gösterilen ölçünün yanında n; veri yoksa "veri yok"; derece değerleri "tahmin" etiketli.
- Materyal türü yalnız `insan` | `yz` | `diger`. Görsel yükleme yalnız PNG/JPEG (sihirli bayt kontrolü), en çok 10 MB, yalnız öğretmen anahtarıyla; dosyalar `data/materyaller/<KOD>/<id>.<png|jpg>`.
- Katılımcı kodu biçimi `^[A-Z0-9_-]{1,20}$` (büyük harfe çevrilerek); bilinmeyen kod kabul edilir ama yanıtta `kodBilinmiyor: true` döner ve öğrenciye uyarı gösterilir.
- Mevcut davranış bozulmaz: ders JSON'u, rapor sayfası, bakış testi aynen çalışır. Arayüz metinleri Türkçe.
- Her görev kendi commit'iyle biter (dal: `bakis-kalibrasyon`; push yok — en sonda toplu).

## Review Focus

- Aynı öğrencinin bağlantı kopup aynı ad+sid ile yeniden katılması → yeni öğrenci satırı açılmaz, eski satır sürer (Görev 2 testi).
- Materyal değişimi 2 sn'lik gönderim paketinin ortasına düşerse → paket, sunucuya ulaştığı andaki aktif materyale yazılır; önceki materyalin süresi değişim anında kapanır (Görev 3 testi).
- Hiç kalibre olmamış / tüm ders kaba kalibrasyonlu öğrenci → öğrenci sayfası çökmez, bakış alanları "veri yok", kalite notu "veri yok" ya da düşük (Görev 5 testi).
- Ders bitmeden sunucu yeniden başlarsa → `lessons.ended` boş kalır, ders listesinde "bitmedi" görünür; ölçüler o ana kadarki veriyle hesaplanır (Görev 5 testi).
- Yönetim API'sine yerel ağdan (127.0.0.1 dışından) ya da anahtarsız istek → 403, veri sızmaz (Görev 6 testi).

---

### Task 1: Kalıcı kayıt modülü (`kayit.py`)

**Files:**
- Create: `kayit.py`
- Test: `tests/test_kayit.py`

**Interfaces:**
- Produces (hepsi `con: sqlite3.Connection` alır, kendi işlemini commit eder):
  - `ac(yol: str) -> sqlite3.Connection` — şemayı kurar (WAL, `row_factory=sqlite3.Row`, `check_same_thread=False`). `":memory:"` desteklenir.
  - `ders_ekle(con, code, name, topic, created)`, `ders_bitir(con, code, ended)`
  - `ogrenci_ekle(con, lesson, sid, name, pcode: str|None, joined, demo: bool) -> bool` (demo → yazmaz, False)
  - `materyal_ekle(con, lesson, name, kind, image_path=None) -> int`, `materyal_gorsel(con, material_id, image_path)`, `materyaller(con, lesson) -> list[dict]`
  - `materyal_sec(con, lesson, material_id: int|None, t)` — açık span'i `t`'de kapatır, `material_id` doluysa yenisini açar
  - `aktif_materyal(con, lesson) -> int|None`
  - `ornek_ekle(con, lesson, sid, t, row: dict)` — `row` anahtarları: `attention, energy, emotion, face, away, eyes_closed, tab_hidden, gaze_cal, coarse, share, mat_pts, gaze, wg_share, head`; `material_id` içeride `aktif_materyal`dan yazılır; öğrenci kayıtlı değilse (demo) hiçbir şey yazmaz.
  - `kurulum_ekle(con, lesson, sid, t, setup: dict) -> bool` — son kurulumla aynıysa yazmaz (False)
  - `kalibrasyon_ekle(con, lesson, sid, t, report: dict) -> bool` — aynı `report["at"]` ikinci kez gelirse yazmaz
  - `olay_ekle(con, lesson, sid: str|None, t, kind: str, data: dict)`
  - `katilimci_ekle(con, code) -> str` (büyük harfli kodu döner; biçim hatalıysa `ValueError`), `katilimci_var(con, code) -> bool`, `katilimcilar(con) -> list[dict]`
- Tablolar (spec "Veri modeli"): `lessons, participants, students(lesson_code, sid, name, participant_code, joined), materials, material_spans, samples, setups, calibrations, events`. JSON alanları metin olarak (`json.dumps(..., ensure_ascii=False)`).

- [ ] **Step 1: Write the failing tests** (`unittest`, her testte `ac(":memory:")`)
  - `test_demo_ogrenci_yazilmaz`: `ogrenci_ekle(..., demo=True)` False döner; ardından `ornek_ekle` aynı sid için çağrılınca `samples` satır sayısı 0.
  - `test_ornek_aktif_materyalle_etiketlenir`: m1 seçili iken örnek → `material_id == m1`; `materyal_sec(None)` sonrası örnek → `material_id IS NULL`.
  - `test_materyal_sec_onceki_spani_kapatir`: m1 t=10'da, m2 t=25'te seçilince m1 span'i `t_end == 25`, m2 span'i `t_end IS NULL`.
  - `test_kurulum_degismezse_yazilmaz`: aynı dict iki kez → ikinci False, 1 satır; farklı → 2 satır.
  - `test_kalibrasyon_ayni_at_tekrar_yazilmaz`.
  - `test_katilimci_kodu_buyuk_harf_ve_bicim`: `katilimci_ekle(con, "p01") == "P01"`; `katilimci_ekle(con, "a b")` → `ValueError`.
- [ ] **Step 2: Run** `python -m unittest tests.test_kayit -v` → FAIL (modül yok)
- [ ] **Step 3: Implement `kayit.py`** (yukarıdaki imzalarla)
- [ ] **Step 4: Run** `python -m unittest tests.test_kayit -v` → hepsi PASS
- [ ] **Step 5: Commit** `git add kayit.py tests/ && git commit -m "Kalıcı ders kaydı modülü (SQLite)"`

### Task 2: Sunucuya bağlama — ders, katılım, katılımcı kodu

**Files:**
- Modify: `server.py` (`create_class`, `join`, olay `end`, `main`; modül başında `KAYIT`)
- Modify: `static/student.html`, `static/student.js` (katılım formuna "Katılımcı kodu" alanı; `kodBilinmiyor` uyarısı)
- Test: `tests/test_sunucu.py`

**Interfaces:**
- Consumes: Task 1 fonksiyonları.
- Produces:
  - `server.KAYIT: sqlite3.Connection` (modül yüklenince `kayit.ac(os.path.join(DATA, "dersler.db"))`; testler `server.KAYIT = kayit.ac(":memory:")` ile değiştirir). Tüm yazmalar mevcut `LOCK` altında.
  - `POST /api/join` gövdesi ek alan `pcode` (isteğe bağlı) → yanıt `{sid, name, kodBilinmiyor?: true}`; aynı sid+ad ile yeniden katılımda `ogrenci_ekle` tekrar çağrılmaz.
  - Test yardımcısı (tests içinde): `basla() -> (base_url, kapat)` — `ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)` iş parçacığında.

- [ ] **Step 1: Failing tests**
  - `test_ders_olusunca_kayda_girer`: `POST /api/class` → `lessons`'da kod var.
  - `test_join_pcode_saklanir`: önce `katilimci_ekle("P01")`; `join` `pcode:"p01"` → `students.participant_code == "P01"`, yanıtta `kodBilinmiyor` yok.
  - `test_join_bilinmeyen_kod_uyari`: `pcode:"X9"` → yanıtta `kodBilinmiyor: true`, öğrenci yine kaydedilir.
  - `test_yeniden_katilim_tek_satir` (Review Focus 1): aynı ad + dönen sid ile ikinci `join` → `students`'ta 1 satır.
  - `test_ders_bitince_ended`: `event type:"end"` (öğretmen anahtarıyla) → `lessons.ended` dolu.
- [ ] **Step 2: Run** `python -m unittest tests.test_sunucu -v` → FAIL
- [ ] **Step 3: Implement** server değişiklikleri + öğrenci formu (alan: `#jPcode`, `localStorage`'da hatırlanır; uyarı metni: "Bu katılımcı kodu tanımlı değil — araştırmacıya danışın. Ders kaydı yine alınacak.")
- [ ] **Step 4: Run** testler → PASS; ayrıca `python -m unittest discover tests` → hepsi PASS
- [ ] **Step 5: Commit** `"Ders ve katılımcı kodu kalıcı kayda bağlandı"`

### Task 3: Materyaller — yükleme, seçme, öğretmen paneli

**Files:**
- Modify: `server.py` (yeni uç noktalar; `event` içinde `type:"material"`)
- Modify: `static/teacher.html`, `static/teacher.js` (Materyaller bölümü)
- Test: `tests/test_sunucu.py`

**Interfaces:**
- Consumes: `materyal_ekle`, `materyal_gorsel`, `materyaller`, `materyal_sec`, `aktif_materyal`.
- Produces:
  - `POST /api/material?code=&key=&name=&kind=` gövde = görsel baytları (boş gövde = görselsiz materyal) → `{id}`; hatalar: anahtar yanlış 403, tür geçersiz 400, PNG/JPEG değil 415, >10 MB 413.
  - `GET /api/materials?code=&key=` → `[{id, idx, name, kind, hasImage}]` + `active: id|null`
  - `GET /api/material/image?code=&id=&key=` (öğretmen anahtarı **ya da** yönetici anahtarı+yerel) → görsel baytları.
  - `POST /api/event {type:"material", id: int|null}` (öğretmen) → `materyal_sec`; SSE ile öğretmene `{"type":"material","active":id}`; `events`'e `kind="material"`.
- Öğretmen arayüzü: liste (ad, tür rozeti İnsan/YZ/Diğer, küçük resim), "Ekle" formu (ad, tür seçimi, dosya), satırda "Şimdi bu" düğmesi, etkin satır vurgulu, "Hiçbiri" düğmesi.

- [ ] **Step 1: Failing tests**
  - `test_materyal_yukle_png`: 1×1 PNG baytları → 200, dosya `data/materyaller/<KOD>/<id>.png` (test için `server.DATA` geçici dizine yönlendirilir).
  - `test_materyal_yukle_reddeder`: yanlış anahtar 403; `kind=foo` 400; metin gövde 415.
  - `test_materyal_sec_olayi`: `event material id=m1` → `aktif_materyal == m1`; `id:null` → None.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** uç noktalar + öğretmen paneli
- [ ] **Step 4: Run** tüm testler → PASS. Tarayıcıda: `preview_start dersnabzi` → öğretmen paneli → ders aç → PNG yükle → "Şimdi bu" → panelde vurgu görünüyor (ekran görüntüsü).
- [ ] **Step 5: Commit** `"Öğretmen paneline materyal yükleme ve seçme"`

### Task 4: Örnek kaydı — bakış, kurulum, kalibrasyon, olaylar

**Files:**
- Modify: `static/gaze.js` (`_sample` → tam ekran örnek tamponu; `flush()` → `scr`)
- Modify: `static/student.js` (`sendMetrics` → `kurulum`, `kal`)
- Modify: `server.py` (`metrics`, `parse_gaze`, olaylar `chat/hand/reaction/topic/lower_hand`, `add_alert` gerçek öğrenci uyarıları)
- Test: `tests/test_sunucu.py`

**Interfaces:**
- Produces:
  - `gaze.flush()` ek alan `scr: [[dt_ms, x, y], ...]` — `x = clientX / innerWidth`, `y = clientY / innerHeight` (0–1, 3 ondalık; ekran dışı tahminler kırpılmadan −0.2…1.2 aralığında tutulur), `dt_ms` flush anına göre negatif ms; her 3. örnek (~10 Hz), en çok 30. Kaba/engelli/kalibresiz durumda alan yok.
  - Öğrenci `/api/metrics` gövdesine `kurulum: {kamera:"WxH", fps, ekran:"WxH", pencere:"WxH", dpr, fs, tarayici, uzaklikCm, islemeFps}` ve yalnız yeni kalibrasyonda `kal: gaze.report` (gaze.report.at değişince bir kez).
  - Sunucu: `parse_gaze` `scr`'yi doğrular (en çok 40 nokta, sayılar kırpılır); `metrics` → `ornek_ekle` (gaze_cal, coarse, share, mat_pts=pts, gaze=scr, wg_share), `kurulum_ekle`, `kalibrasyon_ekle`. Olaylar `olay_ekle` ile (`kind`: `chat`, `hand`, `lower_hand`, `reaction`, `topic`, `alert`, `material`, `end`). Demo öğrenci/uyarı yazılmaz.

- [ ] **Step 1: Failing tests**
  - `test_metrics_ornek_yazar`: gerçek öğrenci + `gaze{cal:true, share:{materyal:1}, pts:[[.5,.5]], scr:[[-100,.4,.6]]}` → `samples` 1 satır, `gaze` JSON'u `[[-100,0.4,0.6]]`, `gaze_cal=1`.
  - `test_metrics_coarse_bakis_saklamaz`: `gaze{cal:false, coarse:true, share:{disari:.2}}` → `gaze_cal=0, coarse=1, gaze IS NULL`.
  - `test_metrics_kurulum_ve_kal_tekil`: aynı `kurulum` ve aynı `kal.at` iki gönderimde → `setups` 1, `calibrations` 1 satır.
  - `test_olaylar_kaydedilir`: `chat` ve `hand` → `events`'te 2 satır, doğru `kind`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** tüm testler → PASS. Tarayıcıda öğrenci sayfası konsol hatasız açılıyor (`read_console_messages onlyErrors`).
- [ ] **Step 5: Commit** `"Ders örnekleri, kurulum, kalibrasyon ve olaylar kalıcı kayda yazılıyor"`

### Task 5: Sorgular ve özetler (`yonetim.py`)

**Files:**
- Create: `yonetim.py`
- Test: `tests/test_yonetim.py`

**Interfaces:**
- Consumes: Task 1 şeması.
- Produces (hepsi yalnız okur, JSON'a çevrilebilir dict/list döner):
  - `dersler(con, ara: str|None=None, bas: float|None=None, bit: float|None=None) -> list[dict]` — alanlar: `code, name, topic, created, ended, sure_dk, n_ogrenci, n_materyal, n_insan, n_yz, ort_dikkat, kalibreli_pct`. `ended` boşsa `sure_dk` son örneğe göre, `bitmedi: True`.
  - `ders(con, code) -> dict` — `{ders, zaman: [{t, dikkat, enerji, duygular:{...}, n}] (10 sn kutular), spans, materyaller: [materyal_ozet], ogrenciler: [ogrenci_ozet], olaylar}`
  - `materyal_ozet` alanları: `id, name, kind, hasImage, sure_sn, n_kalibreli, bakma_pct, ort_dikkat, ort_enerji, baskin_duygu, isi: 18×32 normalize liste (mat_pts'ten), n_ornek`.
  - `ogrenci(con, code, sid) -> dict` — `{bilgi, kalite, ornekler:[[t, dikkat, enerji, duygu, material_id]], bakis:[[t_ms, x, y]], kurulumlar, kalibrasyonlar, olaylar, isi:{material_id: grid}}`
  - `kalite(kamerada_pct, kalibreli_pct, hz, kal_hata) -> str` — `"veri yok"` (hepsi None), `"iyi"` (kamerada≥90, kalibreli≥80, hz≥8, hata≤200), `"orta"` (kamerada≥70, kalibreli≥50), aksi `"düşük"`. Eşikler `KALITE_ESIK` sabitinde (arayüz gösterir).
  - `karsilastirma(con, dersler: list[str]|None=None) -> dict` — `{tur: {insan:{...}, yz:{...}, diger:{...}}, eslesik: [{katilimci, insan:{bakma_pct, ort_dikkat, n}, yz:{...}}]}`; eşleşme yalnız katılımcı koduyla, kodsuzlar `kodsuz_n`.
  - `csv_uzun(con, dersler=None) -> str` (UTF-8 BOM'suz metin; sütunlar: `ders,katilimci,ogrenci,materyal,tur,sure_sn,bakma_pct,ort_dikkat,ort_enerji,baskin_duygu,n_ornek`), `csv_ham(con, code) -> str` (örnek başına bir satır).

- [ ] **Step 1: Failing tests** (fikstür: 1 ders, 2 materyal insan+yz, 2 öğrenci biri P01 kodlu biri kodsuz, örnekler)
  - `test_materyal_bakma_pct`: insan materyalinde 2 örnek share materyal 1.0 ve 0.5 → `bakma_pct == 75`.
  - `test_kalibresiz_ogrenci_veri_yok` (Review Focus 3): tüm örnekleri `gaze_cal=0` → `ogrenci(...)["bakis"] == []`, `kalite["not"] == "veri yok"` ya da `"düşük"`, istisna yok.
  - `test_bitmemis_ders_listede` (Review Focus 4): `ended=None` → `bitmedi is True`, `sure_dk` son örneğe göre.
  - `test_karsilastirma_eslesme_koda_gore`: P01 hem insan hem yz gördü → `eslesik` 1 satır; kodsuz → `kodsuz_n == 1`.
  - `test_csv_uzun_basliklar`: ilk satır tam olarak yukarıdaki sütunlar.
  - `test_kalite_esikleri`: `kalite(95, 85, 9, 150) == "iyi"`, `kalite(75, 60, 5, 400) == "orta"`, `kalite(None, None, None, None) == "veri yok"`.
- [ ] **Step 2: Run** `python -m unittest tests.test_yonetim -v` → FAIL
- [ ] **Step 3: Implement `yonetim.py`**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `"Yönetim sorguları ve CSV"`

### Task 6: Yönetim API'si ve erişim

**Files:**
- Modify: `server.py`
- Test: `tests/test_sunucu.py`

**Interfaces:**
- Consumes: `yonetim.*`, `kayit.katilimci_*`.
- Produces:
  - `server.yonetici_anahtari() -> str` (Global Constraints'teki sıra).
  - `Handler.admin_ok(q: dict) -> bool` — istemci `127.0.0.1`/`::1` **ve** (`X-Admin-Key` başlığı ya da `?admin=`) `compare_digest` ile eşit.
  - `GET /api/admin/dersler?ara=&bas=&bit=`, `GET /api/admin/ders?code=`, `GET /api/admin/ogrenci?code=&sid=`, `GET /api/admin/karsilastirma?dersler=K1,K2`, `GET /api/admin/katilimcilar`, `POST /api/admin/katilimci {kod}`, `GET /api/admin/csv?tur=uzun|ham&code=` (CSV `text/csv; charset=utf-8`, başına `﻿`), `GET /api/admin/kalite_esik`.
- [ ] **Step 1: Failing tests**
  - `test_admin_anahtarsiz_403` ve `test_admin_yerel_olmayan_403` (Review Focus 5; ikincisi için `Handler.client_address` yerel olmayan bir adresle taklit edilen birim test).
  - `test_admin_dersler_200`: doğru anahtarla liste döner.
  - `test_admin_csv_bom`: yanıt `﻿` ile başlar, `Content-Type` csv.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** tüm testler → PASS
- [ ] **Step 5: Commit** `"Yönetim API'si (yalnız yerel + yönetici anahtarı)"`

### Task 7: Yönetim arayüzü — dersler, ders, materyal

**Files:**
- Create: `static/admin.html`, `static/admin.js`
- Reuse: `static/gazelab_stats.js` (`GL.ivt`), `static/style.css`

**Interfaces:**
- Consumes: Task 6 uç noktaları, `GET /api/material/image`.
- Produces: tek sayfa, adres karmasıyla gezinme: `#dersler`, `#ders/<KOD>`, `#materyal/<KOD>/<id>`, `#ogrenci/<KOD>/<sid>`, `#karsilastirma`, `#katilimcilar`. Anahtar ilk açılışta sorulur, `sessionStorage`'da tutulur. Üst çubuk: "Adları gizle" (açıkken ad yerine katılımcı kodu ya da "kodsuz-N").
- Görünümler (spec "Yönetim ekranı görünümleri" 1–3): ders listesi + filtreler; ders sayfası (zaman çizelgesi canvas: dikkat/enerji çizgileri, arka planda materyal şeritleri — İnsan mavi, YZ turuncu, Diğer gri —, olay işaretleri; materyal tablosu; öğrenci tablosu); materyal sayfası (görsel + ısı haritası, "tüm öğrenciler / tek öğrenci", "ısı / sis", zaman aralığı).

- [ ] **Step 1:** Görünümleri yaz.
- [ ] **Step 2: Doğrula (tarayıcı):** `preview_start dersnabzi`; tohum verisi için `tests/tohum.py` (Task 5 fikstürüyle aynı şekilde `data/dersler.db`'ye örnek ders yazar, `--sil` ile siler) → `/admin.html` → anahtar → 3 görünüm konsol hatasız; materyal ısı haritası görselin üstünde. Ekran görüntüsü.
- [ ] **Step 3: Commit** `"Yönetim arayüzü: dersler, ders ve materyal görünümleri"`

### Task 8: Yönetim arayüzü — öğrenci, karşılaştırma, katılımcılar, CSV

**Files:**
- Modify: `static/admin.js`, `static/admin.html`

**Interfaces:**
- Öğrenci sayfası sekmeleri (spec görünüm 4): Kalite (eşikler `/api/admin/kalite_esik`'ten yazılı), Veri grafiği (X ve Y ekranın %'si, hız °/s "tahmin" etiketiyle, `GL.ivt` fiksasyon/sakkad şeritleri, materyal şeridi, altında dikkat/enerji/duygu; zaman aralığı seçilince fiksasyon sayısı, ort. süre, sakkad sayısı), Isı haritası (materyal seçici), Kurulum (zaman içindeki değişimlerle), Olaylar.
- Karşılaştırma (görünüm 5): ders çoklu seçimi, insan/YZ/diğer tablosu (n'lerle), eşleşmiş katılımcı tablosu, "CSV (uzun)" ve ders sayfasında "CSV (ham)".
- Katılımcılar: kod listesi + yeni kod ekleme.

- [ ] **Step 1:** Yaz.
- [ ] **Step 2: Doğrula (tarayıcı):** tohum verisiyle her sekme konsol hatasız; kalibresiz öğrencide "veri yok" görünüyor; CSV indirme yanıtı 200 (`read_network_requests`). Ekran görüntüleri.
- [ ] **Step 3: Commit** `"Yönetim arayüzü: öğrenci, karşılaştırma, katılımcılar, CSV"`

### Task 9: Uçtan uca doğrulama

- [ ] **Step 1:** `python -m unittest discover tests -v` → hepsi PASS.
- [ ] **Step 2:** Sunucu açık; tarayıcıda gerçek akış: öğretmen dersi açar, 2 materyal yükler (insan, yz), öğrenci sayfası katılımcı koduyla girer (kamerasız da örnek gönderir), öğretmen materyali değiştirir, dersi bitirir → `/admin.html`'de ders, iki materyal, öğrenci görünür; karşılaştırmada iki tür ayrı. Demo öğrenci eklenip kaydın değişmediği doğrulanır.
- [ ] **Step 3:** `tests/tohum.py --sil` ile tohum verisi temizlenir; README'ye "Yönetim ekranı" bölümü (adres, anahtar dosyası, yerel erişim, onam notu).
- [ ] **Step 4: Commit** `"Yönetim ekranı: uçtan uca doğrulama ve README"`

# Eğitim sayfası — tasarım (taslak, onay bekliyor)

Tarih: 2026-11-24 · Yeni sayfa: `static/egitim.html` (+ `static/egitim.js`), sunucu: `server.py` + yeni `egitim.py`

## Amaç
3 kişilik ekip, bakış testi verilerini tek yerde birleştirip (1) yöntemleri kişi/ekran/kamera koşuluna göre karşılaştırmak,
(2) ders sayfasına aktarılacak modeli seçen kuralı ortak veriye göre ayarlamak, (3) hız/aşama ölçümlerini birlikte incelemek,
(4) ileride ortak (kişiler arası) eğitim yapabilmek istiyor.

## Kullanıcının kararları (24.11)
- Veri girişi: **ikisi de** — depodaki `egitim_verisi/` klasörü (git pull ile gelir) VE sayfadan ZIP yükleme.
- Birleşik veri **sunucuda kalıcı**: `data/egitim/` (git'e girmez).
- İlk sürüm bölümleri: yöntem karşılaştırma, aktarım kuralı denemesi, hız ve aşamalar, ortak eğitim hazırlığı.

## Önerilen davranış (benim önerim — onayına sunuluyor)
- **Biçim:** yönetim ekranındaki mevcut "Veri paketi" ZIP'i (dersler.db, gazelab.db, bakis_testi/*.json). Depoda her kişi bir ZIP:
  `egitim_verisi/<kişi>.zip` (dosya adı = kişi etiketi). Sayfadan yüklenen ZIP'e de bir kişi etiketi verilir; yüklenen ZIP
  `data/egitim/yuklenen/` altına saklanır.
- **Birleştirme:** her kaynak (kişi) ayrı satır; bakış testi oturumları, yöntem ölçüleri (method_stats), aşama/oturum özetleri ve
  günlüklerdeki tıklama özetleri `data/egitim/birlesik.db`'ye kaynak etiketiyle kopyalanır. Aynı oturum (oturum kimliği) ikinci kez
  gelirse yinelenmez. Kaynak listede açılıp kapatılabilir ve silinebilir. Ders verisinden yalnız kalibrasyon raporları alınır;
  öğrenci adları birleşik veriye **girmez** (kişi etiketi yeterli).
- **Erişim:** yönetim ekranı gibi — yalnız bu bilgisayardan ve yönetim anahtarıyla.
- **Bölümler:**
  1. Yöntem karşılaştırma: kişi × yöntem tablosu (GazeLab doğruluk/kesinlik, kontrol medyan/ort/≤150 %), ekran, pencere, kamera,
     yakınlaştırma, uzaklık filtresi; her hücrede n; oturum sayısı az ise uyarı. Kontrolün adım adım öğrenmeyle mi (ADIM_OGRET)
     yoksa bağımsız mı ölçüldüğü ayrı gösterilir (karıştırılmaz).
  2. Aktarım kuralı denemesi: GazeLab eşiği, öncelikli yöntem ve sıralama ölçütü değiştirilir; her oturum için seçilecek model ve
     o modelin kontrol hatası, mevcut kuralla yan yana. Ortalama kazanç/kayıp n ile.
  3. Hız ve aşamalar: aşama başına işlenen kare/sn, MediaPipe ms, işçi gecikmesi, uzun görev toplamı, en çok süren betikler —
     kişi/cihaz/tarayıcıya göre.
  4. Ortak eğitim hazırlığı (iki adım):
     a. Bakış testi, kalibrasyon ve ölçüm karelerinin öznitelikleri (bizim ham vektör, WebGazer yaması, RealEye özniteliği, 3B baş
        pozu, hedef, aşama) **kare başına** ayrı bir dosyaya yazar (ısı testi gibi ayrı gönderim; ana kayıt küçük kalır).
        Boyut ölçülüp sayfada gösterilir.
     b. "Bir kişiyi dışarıda bırak" denemesi: diğer kişilerin kareleriyle önceden eğitilmiş model + kişinin kendi kalibrasyonu,
        yalnız kendi kalibrasyonuyla karşılaştırılır (kişinin kontrol noktalarında). Yeterli kişi/oturum yoksa "veri yetersiz".
- **Eksik veri de tutulur (kullanıcı kararı 24.11):** yarıda kalan oturumlar, ara kayıtlar (yüz kaybolunca gönderilen),
  kontrolü ya da GazeLab'i olmayan oturumlar, ısı testi dosyası eksik olanlar atılmaz. Her oturuma "tam / eksik" durumu ve neyin
  eksik olduğu (ör. "kontrol yok", "GazeLab yok", "ısı dosyası yok", "bitmedi: düzeltme aşamasında kaldı") yazılır. Tablolar
  varsayılan olarak hepsini gösterir; "yalnız tam oturumlar" süzgeci vardır. Bir ölçü yoksa o hücre "veri yok" olur, oturum
  diğer ölçüleriyle yine sayılır.
- **Yalan veri yok:** her sayıda n; eksik "veri yok"; 1–2 oturumla çıkan farklar "kanıt değil" uyarısıyla.

## Hedef dışı (bu sürüm)
- Ortak modeli ders sayfasına otomatik aktarmak; buluta yükleme; kişiler arası ad/kimlik eşleştirme.

## Açık konular (onayında netleşir)
- Erişim: yönetim anahtarı yeterli mi?
- 4a kayıt boyutu büyükse (onlarca MB) sınır ya da sıkıştırma.

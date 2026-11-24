# Sınıf testi (7 öğrenci, KVKK onaylı) — tasarım

Tarih: 2026-11-24 (test 25.11) · Kullanıcı kararları 24.11

## Amaç
Bir öğretmen bilgisayarı dersi açar; laboratuvardaki 7 öğrenci bilgisayarı (farklı tarayıcı, işlemci, kamera) derse katılır.
Bütün veriler sonradan incelenmek üzere YALNIZ öğretmen bilgisayarında toplanır; öğrenci bilgisayarında veri kalmaz.

## Kullanıcının kararları
- Bağlantı: öğretmen bilgisayarı https sunar (kendi ürettiğimiz sertifika, öğretmen bilgisayarının IP'si için); sertifika her lab
  bilgisayarına **güvenilir olarak kurulur** (uyarı çıkmaz).
- Kimlik: öğrenciler **gerçek adlarını** yazar; ad yalnız öğretmen bilgisayarındaki veride kalır.
- Akış: öğrenci derse katılınca **tam bakış testi zorunlu** (yaklaşık 2–3 dk), sonra derse geçer. Isı testi yok.
- Yerel veri: öğrenci dersten çıkınca ya da ders bitince tarayıcı deposundaki her şey **silinir**.

## Önerilen yapı (benim önerim)
1. **Öğretmen bilgisayarı kurulumu** (`sinif/` klasörü + KOMUTLAR.md "Sınıf testi" bölümü):
   - `sinif/sertifika.ps1 -IP <öğretmen IP>`: Git'in openssl'i ile o IP (+localhost) için 1 yıllık sertifika üretir
     (`sinif/sertifika.pem`, `sinif/anahtar.pem`, lab'a kurulacak `sinif/DersNabzi-sertifika.crt`). Üniversite sertifikası kullanılmaz.
   - Güvenlik duvarı: 8443 için gelen bağlantı kuralı (tek komut, yönetici PowerShell).
   - Sunucu: `python server.py --port 8030 --https-port 8443 --cert sinif/sertifika.pem --key sinif/anahtar.pem`.
   - Lab bilgisayarına sertifika kurulumu: `certutil -user -addstore Root DersNabzi-sertifika.crt` (kullanıcı deposu, yönetici gerekmez;
     Chrome/Edge Windows deposunu kullanır; Firefox ayrı — not düşülür).
   - Öğrenci adresi: `https://<IP>:8443/student.html`.
2. **Zorunlu bakış testi**: katılımdan hemen sonra gömülü bakış testi (`?gomulu=1`) açılır; "Derse dön" yalnız test bitince
   görünür (vazgeç düğmesi yok; sorun olursa öğretmen panelinde görünür). Test sonucu ve aktarılan model ders sayfasına yüklenir.
3. **Kayıt bağlantısı**: bakış testi kaydı (ana kayıt, ara kayıtlar, ısı/öznitelik dosyaları) ders kodu + öğrenci kimliği (sid) +
   ad ile etiketlenir; sunucu dosya adına ders kodunu ekler ve `dersler.db`'ye (öğrenci satırına) test dosyasının adını yazar.
4. **Cihaz bilgisi** (her öğrenci için bir kez, kurulum kaydına): tarayıcı adı/sürümü, işletim sistemi, mantıksal çekirdek sayısı
   (`navigator.hardwareConcurrency`), bellek (`navigator.deviceMemory`, varsa), GPU adı (WebGL `UNMASKED_RENDERER`, varsa),
   ekran/pencere/DPR, kamera çözünürlüğü/fps, MediaPipe işleme yeri ve hızı. Tarayıcı vermezse "veri yok".
5. **Yerelde veri kalmaz**: öğrenci "Dersten ayrıl" deyince ya da sunucu dersin bittiğini bildirince öğrenci sayfası ve bakış testi
   tarayıcı deposundaki DersNabzı anahtarlarını (dn_*, bakış modeli, yüz profili) siler; sayfada "Bu bilgisayardaki ders verisi
   silindi" yazar. Sayfa yenilenirse (ders sürerken) kalibrasyon depoda olduğu için korunur.
6. **Ara kayıt şişmesi düzeltmesi**: yüz kaybolunca gönderilen ara kayıt yeni dosya açmaz, aynı oturumun dosyasının üzerine yazar;
   "[tanı] son 5 sn" satırı yüz yokken 30 sn'de bire seyrekleşir (bilgi kaybolmaz: sayaçlar toplanır).
7. **Öğretmen paneli**: her öğrencinin bakış testi durumu (başlamadı / sürüyor / bitti, GazeLab doğruluğu, aktarılan model) ve
   cihaz özeti (tarayıcı, çekirdek, GPU) listede görünür.
8. **KVKK onayı**: katılım formundaki onay kutusu işaretlenmeden katılım olmaz; onay zamanı ve onay metninin sürümü sunucuda
   öğrenci kaydına yazılır.

## Hedef dışı
- Öğrenci bilgisayarında sunucu/masaüstü uygulaması; internete veri gönderme.

## Kurallar
- Yalan veri yok (eksik → "veri yok"); kamera görüntüsü hiçbir yere gitmez; ajanlar tarayıcı/smoke testi yapmaz, kullanıcı dener.

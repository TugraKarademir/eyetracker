# Harf Avcısı — Osmo donanımıyla Türkçe kelime oyunu

Osmo iPad tabanı + kırmızı ayna + Osmo harf taşlarıyla çalışan, tamamen Türkçe bir web oyunu.
Kurulum gerektirmez, internet gerektirmez (sayfa açıldıktan sonra), tarayıcıda çalışır.

## Modlar
- **Kelime Avı**: Ekranda bir resim ve boş kutular çıkar. Çocuklar taşları masaya koyar; doğru harfler
  kutulara yerleşir, yanlış harf bir balon patlatır. Mavi taşlar mavi takıma, kırmızı taşlar kırmızı takıma puan yazar.
  Kelimeyi tamamlayan takım +2 bonus alır.
- **İlk Harf**: Resim ve kelimenin sonu görünür, ilk harf bulunur (okuma öncesi çocuklar için).
- **Harf Avı**: Oyun bir harfi gösterir ve sesli söyler, çocuk o taşı bulur.
- Zorluk: Kolay (≤4 harf, ilk harf ipucu), Orta (4–6), Zor (6+). Konular: hayvanlar, yiyecekler, eşyalar,
  doğa, taşıtlar, beden/aile ve **kendi kelimeleriniz** (Ayarlar).

## Türkçe harfler (Ç Ğ İ Ö Ş Ü)
Osmo kutusunda bu harfler yok. `harf-taslari.html` sayfasından basıp kartona yapıştırın
(Osmo taşınızı ölçüp aynı boyu seçin). Taşlar Osmo'daki gibi beyaz zemin üstünde mavi/kırmızı harf olarak basılır. Bunu yapmak istemezseniz **Ayarlar → Yalnızca orijinal Osmo
taşlarıyla yazılabilen kelimeler** seçeneğini açın. Osmo'daki "I" taşı Türkçe "I" olarak okunur.

## iPad'de çalıştırma
iPad Safari kamerayı yalnızca **https** sayfalarda açar. En kolayı:

1. Bilgisayarda `baslat.bat` dosyasına çift tıklayın (ya da `py sunucu.py`).
   Windows güvenlik duvarı sorarsa "Özel ağlar"a izin verin.
2. Ekranda yazan `https://192.168.x.x:8443` adresini iPad Safari'de açın (aynı Wi-Fi).
3. "Bu bağlantı gizli değil" uyarısında **Ayrıntıları Göster → bu web sitesini ziyaret et**.
4. Paylaş → **Ana Ekrana Ekle** ile uygulama gibi tam ekran açabilirsiniz.

Kalıcı çözüm isterseniz klasörü herhangi bir https statik barındırmaya (GitHub Pages, Netlify vb.)
yükleyebilirsiniz; o zaman bilgisayar açık olmadan da çalışır.

Bilgisayarın kendi kamerasıyla denemek için `https://localhost:8443` yeterli.

## İlk kurulum (bir kez, 5 dakika)
1. iPad'i Osmo tabanına koyun, kırmızı aynayı takın, oyunu açın.
2. **Kamera ayarı**: Görüntü yönü **Otomatik** kalabilir — oyun masadaki harflere bakıp görüntünün
   Osmo aynasıyla mı, düz web kamerasıyla mı geldiğini kendisi bulur (bir-iki saniye). Önizlemede harfler
   okunur görünmeli; görünmüyorsa yönü elle seçin. "Taş tipi" **Beyaz taş, renkli harf (Osmo)** olmalı (varsayılan). Harfler çerçeveyle
   işaretlenmiyorsa **Renk öğret → Mavi taş** deyip görüntüde mavi bir harfe dokunun; kırmızı için de aynısını yapın. "Renk maskesini göster" ile kontrol edin.
3. **Taşları öğret**: Ekranda istenen harfi tek başına, dik olarak koyun; "Öğrendim" deyince kaldırın,
   sıradaki harfe geçer. Bütün alfabe yaklaşık 3–4 dakika sürer. Bu adım tanımayı belirgin biçimde
   iyileştirir (testlerde farklı yazı tipinde %84 → %100). Öğrenilenler o cihazda saklanır;
   **Dışa aktar / İçe aktar** ile başka iPad'e taşıyabilirsiniz.

## Taşlar okunmuyorsa
- **Kamera ayarı** ekranında okunan her harf çerçeveyle işaretlenir; okunmayan renkli lekeler **kesik turuncu
  çerçeve** ve sebebiyle gösterilir ("çok küçük", "etrafı beyaz değil", "renk soluk" …).
- "çok küçük" yazıyorsa **Yakınlaştırma** kaydırıcısını artırın (uzaktaki/çok sayıda taş için); taşların olduğu
  bölgeyi **Yakınlaştırılan bölge** ile seçin.
- Taşlar her yöne (ters, yan) konabilir. Yalnızca yan (90°) konunca birbirine benzeyen U/C ve N/Z dik okunur.

## Müzik ve kutlama
Oyunda kısık sesli, tarayıcıda üretilen özgün bir arka plan müziği çalar (🎵 düğmesi ya da Ayarlar'dan kapatılır;
sesli okuma sırasında kısılır). Kelime bitince ve oyun sonunda "Kutlarım!" denir, konfeti atılır.

## Kamerasız oynama
Oyun ekranındaki ⌨️ düğmesi ekran klavyesini açar (Tab ile takım değişir); fiziksel klavye de çalışır.

## Dosyalar
| Dosya | Görev |
|---|---|
| `index.html`, `style.css` | Oyun arayüzü |
| `js/vision.js` | Taş tanıma motoru (renk bölütleme, harf çıkarma, döndürmeye dayanıklı şablon eşleme, takip) |
| `js/oyun.js` | Oyun modları, kamera döngüsü, öğretme, ayarlar |
| `js/kelimeler.js` | Kelime + emoji listesi (yeni kelime eklenebilir) |
| `harf-taslari.html` | Yazdırılabilir Türkçe harf taşları |
| `test.html` | Sentetik görüntülerle tanıma doğruluk testi |
| `sunucu.py`, `baslat.bat` | iPad için yerel HTTPS sunucusu |

## Bilinen sınırlar
- Gerçek Osmo taşlarının iki web kamerası fotoğrafında (Z, G) doğru tanındı; yandaki ten, dudak, kazak gibi
  renkli şeyler elendi. iPad + Osmo aynası ile canlı deneme henüz yapılmadı.
- Sentetik testte Osmo tipi taşlarda doğruluk %95–100; çok farklı (tırnaklı) yazı tipinde öğretmeden sonra %94.
- Taşlar birbirine yapışık konursa tek taş gibi görünebilir; aralarında küçük boşluk bırakın.
- Masaya konmuş bir taş tekrar sayılmaz; aynı harfi yeniden denemek için taşı kaldırıp tekrar koyun.

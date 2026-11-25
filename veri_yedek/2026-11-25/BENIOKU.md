# 25.11.2026 tarayıcı yedekleri

Lab/deneme oturumlarında öğrenci tarayıcısının indirdiği yerel yedekler (kullanıcı isteğiyle depoya alındı, 25.11.2026).
Sunucudaki kopyalar `test_kayitlari/` altında (depoya girmez). Biçimler:

- `*_bakis.json`: bakış testi kaydı (sunucuya giden gövdenin aynısı), `*_bakis_ozet.csv`: yöntem/aşama/oturum/cihaz tabloları
- `*_bakis_kare.json`: kare başına öznitelikler (16:19'dan sonrakiler kare biçimi 2: static/kare_kayit.js, olaylar static/olay_gunlugu.js)
- `*_ders.json` / `*_ders.csv`: ders sırasında gönderilen ölçümler ve bakış kontrolleri
- TVBTEC tugra-deneme dosya adlarındaki pccamera / intelkamera / logitech eki kameranın adı (elle eklendi)

Uyarılar:
- Aynı bilgisayarda önceki oturumun kalibrasyonu taşınmış olabilir (DJUP5T dfg3r 09:15-09:22, TVBTEC Tugra_deneme2 tamamı,
  tugra_deneme3 10:11-10:13): docs/arastirma/2026-11-25-tasinan-kalibrasyonlar.md. Bakış testi sonuçları bundan etkilenmez.
- Kişisel veri içerir (ad, yüz öznitelikleri). Depo paylaşılmadan önce KVKK kapsamı gözden geçirilmeli.
- İndirilenler klasöründeki "(1)" ekli iki dosya diğerleriyle bayt bayt aynı olduğu için alınmadı.

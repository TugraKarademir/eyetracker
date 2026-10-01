# Pilot Çalışma Kılavuzu (Faz 6)

Bu belge, 5–10 kişilik pilot çalışmanın (spec §12, §13 Faz 6) nasıl yürütüleceğini
anlatır. Pilot **gerçek katılımcılarla** yapılır; yazılım tarafı hazırdır, bu adım
insan katılımı gerektirir.

## Amaç

1. Gerçek doğruluk hatası dağılımını ölçmek (spec §12 "bilinen hedef görevi").
2. Kalite eşiklerini ve fiksasyon parametrelerini bu veriye göre ayarlamak (spec §7, §8).
3. Uçtan uca akışı (toplama → kayıt → analiz → Excel/rapor) doğrulamak.

## Hazırlık

```powershell
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py runserver --noreload localhost:8000
```

1. Admin'de (`/admin/`, `ogretmen` / `ogretmen1234`) bir **çalışma** oluşturun,
   birkaç **materyal** yükleyin ve çalışmayı **Aktif** yapın.
2. İsteğe bağlı: `/panel/` → her materyalde **AOI** çizin.
3. Katılım linkini alın: `/dene/<kod>/`.

> **Uzaktan katılım:** İnternet üzerinden gerçek katılımcılar için **gerçek HTTPS
> sertifikası** (ör. Let's Encrypt) ve kurumsal barındırma gerekir. Yerel/laboratuvar
> testinde `http://localhost` yeterlidir (kamera güvenli bağlam, spec §11).

## Bilinen hedef görevi (doğruluk ölçümü, spec §12)

Pilotun başına, ekranda **bilinen konumlarda** noktalar gösteren bir materyal
koyun (ör. köşelerde ve merkezde işaretli bir görsel) ve katılımcıdan sırayla o
noktalara bakmasını isteyin. Analizde bu materyaldeki fiksasyonların gerçek
hedeflere uzaklığı = **gerçek doğruluk hatası**. Bu, WebGazer'ın ~130 px'lik
tipik hatasıyla karşılaştırılır (spec §1).

## Protokol (her katılımcı)

1. İyi, önden ışık; arkada pencere yok. Ekrana 50–70 cm, baş sabit.
2. `/dene/<kod>/` → onam → kamera → **9 nokta kalibrasyon** (her noktaya bakarak tıkla)
   → **5 nokta doğrulama**.
3. Materyalleri incele ("Devam" ile geç). Her 3 materyalde bir **ara kontrol** olur;
   doğruluk düşerse ekranda hatırlatma çıkar.
4. Bitişte veri **sunucuya** kaydedilir (bağlantı koparsa yerel JSON yedeği iner).

## Pilot sonrası: eşik ayarı

1. `/panel/` → çalışmanın **Rapor** ekranında **Veri Kalitesi** tablosuna bakın:
   doğrulama hatası, kayıp veri oranı, örnekleme hızı, dışlanma nedenleri.
2. **Excel indir** → `Katilimcilar` ve `Ayarlar` sayfalarını inceleyin.
3. Dağılıma göre eşikleri güncelleyin. Eşikler çalışma bazında **Study.settings**
   JSON alanından değiştirilir (admin'de "Ayarlar"). Örnek:

   ```json
   {
     "min_fixation_ms": 120,
     "dispersion_threshold": 0.06,
     "median_filter_window": 3,
     "aoi_buffer": 0.02,
     "heatmap_sigma": 0.05,
     "max_validation_error_ratio": 0.12,
     "max_missing_ratio": 0.30,
     "min_valid_material_ratio": 0.50
   }
   ```

   Bilinmeyen anahtarlar yok sayılır; verilmeyen alanlar varsayılanda kalır
   (bkz. `gaze_analysis/config.py`).

4. Ayarları değiştirip **Rapor / Excel**'i yeniden alın; analiz güncel eşiklerle çalışır.

## Kontrol listesi

- [ ] 5–10 katılımcı tamamlandı
- [ ] Bilinen hedef görevinden gerçek hata dağılımı çıkarıldı
- [ ] Kalite eşikleri ve I-DT parametreleri pilota göre ayarlandı
- [ ] Büyük veriyle Excel satır sınırı davranışı kontrol edildi (spec §12)
- [ ] Grup ısı haritası ve AOI sıralaması anlamlı görünüyor

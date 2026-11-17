# Canlı Tercüman (Teams / Zoom)

Toplantıda **Türkçe konuşursun → karşı taraf senin sesinle İngilizce duyar.**
Karşı taraf **İngilizce konuşur → ekranda Türkçe altyazı** görürsün.

```
Mikrofonun ─► Türkçe yazıya dökme ─► İngilizceye çeviri ─► senin klon sesin ─► VB-Cable ─► Teams/Zoom mikrofonu
Teams sesi (hoparlör) ─► İngilizce yazıya dökme ─► Türkçeye çeviri ─► her zaman üstte altyazı penceresi
```

İki motor var, uygulamadan seçilir:

| | **Ücretsiz** (anahtar gerekmez) | **Ücretli** (API anahtarı) |
|---|---|---|
| Yazıya dökme | Google konuşma tanıma (internet yoksa Whisper, bu bilgisayarda) | OpenAI |
| Çeviri | Google Çeviri (ücretsiz) | OpenAI (bağlamı ve sözlüğü anlar) |
| İngilizce ses | Microsoft Edge sesleri (standart); yanıt vermezse Windows sesi | **Senin klon sesin** (ElevenLabs) |
| Gecikme (ölçülen, cümle bitişinden) | ~1,6–2 sn | ~1,5–3 sn |
| Maliyet | 0 | Saatte ~1 $ + ElevenLabs planı |

**Bu bilgisayarda ölçülen Türkçe tanıma karşılaştırması** (6 cümle):
- **Google** (varsayılan): 6 cümlede 1 küçük hata, ortalama 0,9 sn.
- **Whisper small** (internetsiz yedek): 6 cümlede 4 hata, ortalama 1,9 sn. Tek kelimelik konuşmalarda uydurabiliyor.
- Daha büyük Whisper modelleri bu bilgisayarda 8–14 sn sürüyor; canlı kullanıma uygun değil.

---

## 1. Bir kerelik kurulum

### a) VB-Cable (sanal mikrofon) — sen kuracaksın
1. https://vb-audio.com/Cable/ adresinden **VBCABLE_Driver_Pack** indir (ücretsiz).
2. Zip'i aç, `VBCABLE_Setup_x64.exe` dosyasına **sağ tık → Yönetici olarak çalıştır** → *Install Driver*.
3. Bilgisayarı yeniden başlat.
4. Windows ses ayarlarında **varsayılan cihazların değişmediğinden emin ol** (hoparlör yine Realtek, mikrofon yine Realtek kalsın).

### b) API anahtarları (yalnızca ücretli mod için — ücretsiz modda bu adımı ve (c)'yi atla)
1. Klasördeki `.env` dosyasını Not Defteri ile aç (yoksa `baslat.bat` bir kez çalıştırınca oluşur).
2. `OPENAI_API_KEY=` satırına OpenAI anahtarını yaz (platform.openai.com → API keys; hesaba birkaç dolar bakiye yüklemek gerekir).
3. Kendi sesin için `ELEVENLABS_API_KEY=` satırına ElevenLabs anahtarını yaz. Ses klonlama **Starter (ücretli) plan** ister.
4. Kaydet, kapat.

### c) Sesini klonla (ElevenLabs kullanacaksan)
Klasörde bir terminal aç ve şunu çalıştır:
```
.venv\Scripts\python.exe ses_klonla.py
```
Ekrandaki metni ya da kendi sunumunu ~90 saniye, sessiz bir odada, doğal bir şekilde oku. Araç kaydı yükler ve
`ELEVENLABS_VOICE_ID`'yi `.env`'ye kendisi yazar. Türkçe konuşman yeterli; klon ses İngilizceyi senin tınınla okur.

> Alternatif: ElevenLabs sitesinde *Voices → Add voice → Instant Voice Clone* ile ses oluşturup Voice ID'yi `.env`'ye elle yazabilirsin.

---

## 2. Teams / Zoom ayarı (bir kere)

**Teams:** Ayarlar → Cihazlar
- **Mikrofon:** `CABLE Output (VB-Audio Virtual Cable)`
- **Hoparlör:** her zamanki hoparlörün/kulaklığın
- **Gürültü engelleme:** *Düşük* veya *Kapalı* (yoksa yapay sesi kırpabilir)

**Zoom:** Ayarlar → Ses
- **Mikrofon:** `CABLE Output (VB-Audio Virtual Cable)`
- *Mikrofon sesini otomatik ayarla* kapalı, *Arka plan gürültüsünü bastır*: Düşük

> Teams'te mikrofonunu **kapatmana gerek yok**; Teams artık senin gerçek sesini değil, uygulamanın ürettiği İngilizce sesi duyar.
> Kendini sessize almak istersen Teams'in kendi sessize alma düğmesini kullanabilirsin.

---

## 3. Toplantıda kullanım

1. `baslat.bat` → **Çeviri motoru** seç (Ücretsiz / Ücretli). Ücretsizde İngilizce sesi listeden seçip **▶ Dinle** ile deneyebilirsin → **Başlat**.
2. Cihazlar kendiliğinden seçilir:
   - Mikrofonum → Realtek mikrofon dizisi
   - Teams/Zoom'a giden ses → **CABLE Input**
   - Karşı tarafı duyduğum hoparlör → Teams sesinin çıktığı cihaz (kulaklık kullanıyorsan onu seç)
3. **Mikrofon modu:**
   - **Çevir (TR→EN):** normal kullanım.
   - **Doğrudan (kendi sesim):** kendi İngilizcenle konuşmak istediğin anlarda; sesin olduğu gibi gider.
   - **Sessiz:** hiçbir şey gitmez (bekleyen İngilizce konuşma da kesilir).
4. Altyazı penceresini sürükleyerek taşı, fare tekerleğiyle yazıyı büyüt/küçült, sağ alt köşeden boyutlandır.
5. Konuşulan her şey ve çevirisi `kayitlar\` klasörüne tarihli bir metin dosyası olarak kaydedilir (toplantı notu olarak da işe yarar).

### İyi sonuç için
- **Kısa ve net cümleler kur, cümle sonunda yarım saniye dur.** Sistem cümlenin bittiğini bu duraksamadan anlar.
- Sunumdan önce `sozluk.txt`'ye alan terimlerini ekle (`Türkçe = English`).
- Kulaklık kullan: hem karşı tarafın sesi temiz yakalanır hem de yankı olmaz.
- "İngilizce sesimi ben de duyayım" seçeneğinde **kulaklık** seç; karşı tarafı dinlediğin hoparlörle aynı olursa kendi İngilizcen altyazıya geri döner (uygulama bunu engeller).
- İlk kullanımda **arkadaşınla deneme toplantısı** yap (ya da Teams'in *Test araması*nı kullan).

---

## 4. Ücretsiz deneme (servise bağlanmadan)

```
.venv\Scripts\python.exe uygulama.py --sahte
```
Hiçbir servise bağlanmaz. Konuştuğunda her cümle için kısa bip sesleri üretilir ve altyazıya "(sahte)" yazılır.
Çıkışı geçici olarak hoparlör seçersen, cümle bölmenin ve ses yönlendirmesinin çalıştığını kulağınla duyarsın.

---

## 5. Ayarlar (`ayarlar.json`)

Uygulama ilk kapanışta seçtiğin cihazları buraya yazar. Elle ekleyebileceğin bazı seçenekler:

| Anahtar | Varsayılan | Ne işe yarar |
|---|---|---|
| `giden_sessizlik_ms` | 650 | Cümle bitti saymak için gereken sessizlik. Yavaş konuşuyorsan 800–900 yap. |
| `esik_carpani` | 3.0 | Gürültülü ortamda büyüt (4–5), kısık mikrofonda küçült (2). |
| `yaziya_dokme_modeli` | gpt-4o-mini-transcribe | Daha doğru ama biraz pahalı: `gpt-4o-transcribe` |
| `ceviri_modeli` | gpt-4.1-mini | Hızlı model. Daha kaliteli: `gpt-4.1` |
| `elevenlabs_modeli` | eleven_flash_v2_5 | Daha doğal ama daha yavaş: `eleven_multilingual_v2` |
| `gelen_dil` | en | Karşı tarafın dili (de, fr, es ...) |
| `altyazi_font`, `altyazi_satir` | 22, 3 | Altyazı boyutu ve satır sayısı |

## 6. Maliyet (yaklaşık)
- OpenAI yazıya dökme + çeviri: 1 saatlik toplantı genelde **1 doların altında**.
- ElevenLabs: konuştuğun İngilizce karakter kadar kredi düşer; Starter plan ayda birkaç sunumu genelde karşılar.

## 7. Sorun giderme
| Belirti | Çözüm |
|---|---|
| "VB-Cable bulunamadı" | Sürücüyü kurup bilgisayarı yeniden başlat, uygulamada **Yenile**'ye bas. |
| Karşı taraf hiçbir şey duymuyor | Teams mikrofonu **CABLE Output** olmalı; uygulamada çıkış **CABLE Input** olmalı. |
| Cümlelerim ortadan bölünüyor | `giden_sessizlik_ms` değerini artır. |
| Ortam gürültüsü çevriliyor | `esik_carpani` değerini artır, kulaklık mikrofonu kullan. |
| Altyazı gelmiyor | "Karşı tarafı duyduğum hoparlör" Teams'in ses verdiği cihaz olmalı (kulaklık ise kulaklığın *[Loopback]* kaydını seç). |
| Ses robotik / yabancı | ElevenLabs anahtarı ve Voice ID `.env`'de mi? Durum satırında "senin klon sesin" yazmalı. |

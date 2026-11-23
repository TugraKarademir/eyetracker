# Literatür taraması 2/4: Web kamerası ve tarayıcı tabanlı bakış takibi, ekran bölgesi (AOI) dikkat analizi

Hazırlanma tarihi: 2026-11-18. Kaynaklar arXiv, CVF, ACM/ETRA açık kopyaları, bioRxiv, Europe PMC ve yazarların kendi sayfalarından alındı.

**Okuma düzeyi notu.** "Tam metin" olarak işaretlenen kaynakların PDF ya da HTML metni indirildi ve ilgili bölümleri (yöntem, sonuç, sınırlılık) okundu. "Özet" olarak işaretlenenlerde yalnızca özet, künye ya da yayıncı veya proje sayfası okundu. Bu kaynaklardaki sayılar o özetten alındı ve tam metinle doğrulanmadı. Bir sayı ikincil kaynaktan geliyorsa bu ayrıca belirtildi. Kaynakta açıkça yazmayan hiçbir sayı tabloya konmadı.

**Kendi hesabım.** Derece ile santimetre arasındaki dönüşümler bana ait. 60 cm bakış mesafesinde 1° yaklaşık 1,05 cm eder (60 × tan 1°). Bu dönüşümler kaynaklardan alınmadı.

---

## 1. Makale tablosu

### 1a. Tarayıcı ve web kamerası takipçileri, örtük kalibrasyon

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 1 | WebGazer: Scalable Webcam Eye Tracking Using User Interactions | Papoutsaki, Sangkloy, Laskey, Daskalova, Huang, Hays | 2016 | IJCAI 2016, s. 3839–3845 | https://jeffhuang.com/papers/WebGazer_IJCAI16.pdf | tam metin | Göz yaması 120 boyutlu vektöre çevrilir (TurkerGaze'den alınan 6×10 gri, iki göz) ve ridge regresyonla ekrana eşlenir. Kalibrasyon tıklamalarla yapılır: tıklamadan önceki 500 ms içinde, en çok 72 px uzaktaki tahminler de eğitim örneği olur. İmleç hareketleri ağırlıkla eklenir; ağırlık her 20 ms'de 0,05 azalır. | Uzaktan çalışmada (N=76) en iyi iki model 175 ve 210 px hata verdi. Laboratuvarda (N=4) Tobii EyeX ile karşılaştırmada ortalama görsel açı 4,17° çıktı. Tıklama anında bakış ile imleç arasındaki mesafe ortalama 74 px. |
| 2 | TurkerGaze: Crowdsourcing Saliency with Webcam based Eye Tracking | Xu, Ehinger, Zhang, Finkelstein, Kulkarni, Xiao | 2015 | arXiv 1504.06755 | https://arxiv.org/abs/1504.06755 | tam metin (ar5iv) | clmtrackr ve Kalman filtresiyle göz yaması hizalanır, 6×10 histogram eşitlemesi yapılır, ridge regresyon (çevrimdışı SVR) kullanılır. Her kalibrasyon noktasında yalnızca son kareler alınır. Göz kırpma, ortalama göz görüntüsüne ZNCC eşiğiyle elenir. Baş sabit tutulur; büyük hareket görülürse kalibrasyon yeniden başlatılır. Fiksasyonlar uzay-zamanda mean-shift ile bulunur. | Laboratuvarda (3 kişi, EyeLink 1000 karşılaştırması) 9 noktalı kalibrasyondan sonra doğrulama hatası 0,33° (9,1 px). Serbest bakışta ortalama 1,32°. Tek denekte 33 noktada medyan 1,06°. Bunlar sıkı denetimli koşullarda elde edildi. |
| 3 | Building a Personalized, Auto-Calibrating Eye Tracker from User Interactions (PACE) | Huang, Kwok, Ngai, Chan, Leong | 2016 | CHI 2016, s. 5169–5179, doi:10.1145/2858036.2858404 | https://ira.lib.polyu.edu.hk/handle/10397/64378 | tam metin (ön baskı; özet ve yöntemin bir kısmı okundu) | Tıklama ve klavye imleci gibi etkileşim ipuçlarından örtük eğitim verisi toplanır. "Kişi tıkladığı yere bakar" varsayımı göz kırpma, dalgınlık ve tepki gecikmesi yüzünden her zaman geçerli değildir; bu yüzden iki katmanlı veri doğrulaması yapılır. Geometrik göz özniteliklerine (göz yaw/pitch, açıklık) dayanır. | 31 denekle yapılan doğal kullanım çalışmasında açık kalibrasyon olmadan ortalama 2,56° hata. |
| 4 | Appearance-Based Gaze Estimation Using Visual Saliency | Sugano, Matsushita, Sato | 2013 | IEEE TPAMI 35(2):329–341, doi:10.1109/TPAMI.2012.101 | https://dblp.org/rec/journals/pami/SuganoMS13 | özet | Video karelerinin dikkat çekicilik (saliency) haritaları olası bakış dağılımı gibi kullanılır. Göz görüntüsü benzerliğine göre birleştirilir ve Gauss süreç regresyonu uygulanır. Kalibrasyon gerektirmez. | Yaklaşık 3,5° doğruluk (özetteki ifade). |
| 5 | WebEyeTrack: Scalable Eye-Tracking for the Browser via On-Device Few-Shot Personalization | Davalos, Zhang, Srivastava ve ark. (Biswas) | 2025 | arXiv 2508.19544 (hakemli yayın bilgisi bulunamadı) | https://arxiv.org/abs/2508.19544 | tam metin (HTML) | MediaPipe yüz ağından metrik baş pozu hesaplanır: iris çapı 1,2 cm kabul edilir ve "radial Procrustes" uygulanır. BlazeGaze adlı küçük CNN (670 KB) göz yaması ile baş pozunu girdi alır. 9 veya daha az noktayla, birinci dereceden MAML kullanılarak tarayıcıda (TF.js) kişiselleştirilir. | GazeCapture'da 2,32 cm, MPIIFaceGaze'de 4,56 cm, EyeDiap'ta 7,53 cm. Eye of the Typer'da oturum boyunca WebGazer'ın hatası 7,79 cm'den 11,62 cm'ye çıktı (yaklaşık %49). WebEyeTrack'inki 7,24 cm'den 8,72 cm'ye çıktı (yaklaşık %20). Kod lisansı makalede belirtilmemiş. |
| 6 | Real-time Pupil Tracking from Monocular Video for Digital Puppetry (MediaPipe Iris) | Ablavatski, Vakunov, Grishchenko, Raveendran, Zhdanovich | 2020 | arXiv 2006.11341 | https://arxiv.org/abs/2006.11341 | özet | Yüz ağı dedektörü göz ve iris landmark ağlarıyla genişletilir, tek RGB kamera kullanılır. Bu, sistemin kullandığı FaceLandmarker iris noktalarının kökenidir. | Modern telefonlarda 50 FPS'nin üzerinde. Bakış doğruluğu raporlanmıyor; amaç animasyon. |

### 1b. Görünüm tabanlı derin bakış tahmini, veri setleri, az örnekli kişiselleştirme

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 7 | MPIIGaze: Real-World Dataset and Deep Appearance-Based Gaze Estimation | Zhang, Sugano, Fritz, Bulling | 2017/2019 | arXiv 1711.09017 (TPAMI sürümü; ilk hali CVPR 2015, arXiv 1504.02863) | https://arxiv.org/abs/1711.09017 | özet | 15 kişiden aylar boyunca dizüstü kullanımında toplanan 213.659 görüntü ve GazeNet CNN. | En zor çapraz veri seti değerlendirmesinde hata 13,9°'den 10,8°'ye indi. Çözünürlük ve iki gözün birlikte kullanılması önemli; baş pozu ve göz bebeği merkezi daha az bilgi taşıyor. |
| 8 | Eye Tracking for Everyone (GazeCapture / iTracker) | Krafka, Khosla, Kellnhofer, Kannan, Bhandarkar, Matusik, Torralba | 2016 | CVPR 2016 | https://arxiv.org/abs/1606.05814 | özet | 1450'den fazla kişi ve yaklaşık 2,5 milyon kare; yüz, iki göz ve yüz ızgarası girdili CNN. | Kalibrasyonsuz hata telefonda 1,71 cm, tablette 2,53 cm. Kalibrasyonla telefonda 1,34 cm, tablette 2,12 cm. Mobil cihazda 10–15 fps. |
| 9 | ETH-XGaze: A Large Scale Dataset for Gaze Estimation under Extreme Head Pose and Gaze Variation | Zhang, Park, Beeler, Bradley, Tang, Hilliges | 2020 | ECCV 2020 | https://arxiv.org/abs/2007.15837 | özet | 110 kişiden 18 DSLR kamerayla çekilmiş 1 milyonun üzerinde yüksek çözünürlüklü görüntü; aşırı baş pozu ve aydınlatma çeşitliliği. | Özette sayısal temel sonuç yok. Lisans: CC BY-NC-SA 4.0 ve ek koşullar; erişim başvuruyla. |
| 10 | L2CS-Net: Fine-Grained Gaze Estimation in Unconstrained Environments | Abdelrahman, Hempel, Khalifa, Al-Hamadi | 2022 | arXiv 2203.03339 (ICIP 2022'ye gönderildi) | https://arxiv.org/abs/2203.03339 | özet | Yaw ve pitch ayrı ayrı, sınıflandırma ile regresyon birleşik kayıpla öğrenilir. | MPIIGaze'de 3,92°, Gaze360'ta 10,41° açısal hata. Kod MIT lisanslı; hazır ağırlık dosyasının adı Gaze360 ile eğitildiğine işaret ediyor ve Gaze360'ın kendi kullanım koşulları geçerli. |
| 11 | Few-Shot Adaptive Gaze Estimation (FAZE) | Park, De Mello, Molchanov, Iqbal, Hilliges, Kautz | 2019 | ICCV 2019 (oral) | https://arxiv.org/abs/1905.01941 | tam metin | Dönmeye eşdeğişken (rotation-equivariant) gizli bakış temsili (DT-ED) ve meta-öğrenme (MAML); kişiye özel ağ 9 veya daha az örnekle uyarlanır. | GazeCapture'da 3,18°. MPIIGaze'de k=9 ile 3,14°. 3 örnekle bile önceki yönteme göre belirgin iyileşme. |
| 12 | On-Device Few-Shot Personalization for Real-Time Gaze Estimation | He, Pham, Valliappan, Xu, Roberts, Lagun, Navalpakkam | 2019 | ICCV Workshops (GAZE 2019), doi:10.1109/ICCVW.2019.00146 | https://openaccess.thecvf.com/content_ICCVW_2019/html/GAZE/He_On-Device_Few-Shot_Personalization_for_Real-Time_Gaze_Estimation_ICCVW_2019_paper.html | özet | Cihaz üzerinde 2–5 kalibrasyon noktasıyla kişiselleştirme; etiketsiz yüz görüntüleriyle çalışan denetimsiz bir varyantı da var. | 5 veya daha az noktayla telefonda önceki en iyi yönteme göre %24–26 daha düşük ortalama hata; yaklaşık 20 kat daha az FLOP. |
| 13 | Accelerating eye movement research via accurate and affordable smartphone eye tracking | Valliappan ve ark. (Navalpakkam) | 2020 | Nature Communications 11:4553, doi:10.1038/s41467-020-18360-5 | https://www.nature.com/articles/s41467-020-18360-5 | özet (ve Google blog yazısı) | Telefon ön kamerası, CNN ve kişiye özel ince ayar. | Temel modelde 1,92 cm, kişiselleştirmeyle yaklaşık 0,46 cm. Blog yazısına göre 25–40 cm mesafede bu 0,6–1° demek. Koşullar: yüze yakın önden poz ve kısa mesafe; dizüstü bilgisayara doğrudan aktarılamaz. |
| 14 | Appearance-based Gaze Estimation With Deep Learning: A Review and Benchmark | Cheng, Wang, Bao, Lu | 2021/2024 | IEEE TPAMI (kabul), arXiv 2104.12668 | https://arxiv.org/abs/2104.12668 | özet | Derleme ve kıyas: veri düzeltme/normalizasyon, 2B ve 3B bakış dönüşümü, kişisel kalibrasyon. | Sayısal tek sonuç yok. 2B nokta hatası ile 3B açı hatasının karşılaştırılmasının adil olmadığını vurguluyor. |
| 15 | Revisiting Data Normalization for Appearance-Based Gaze Estimation | Zhang, Sugano, Bulling | 2018 | ETRA 2018, doi:10.1145/3204493.3204548 | https://perceptualui.org/publications/zhang18_etra/ | özet | Göz/yüz görüntüsü sanal bir kameraya döndürülerek baş pozu ve mesafe etkisi azaltılır. Ölçek faktörü kaldırılarak formül değiştirilir. | Değiştirilmiş normalizasyon farklı ayarlarda %9,5–32,7 daha iyi. |
| 16 | Efficiency in Real-time Webcam Gaze Tracking | Gudi, Li, van Gemert | 2020 | ECCV 2020 Workshops (OpenEyes; en iyi makale), doi:10.1007/978-3-030-66415-2_34 | https://arxiv.org/abs/2009.01270 | tam metin (ar5iv) | Tam yüz, iki göz ve tek göz girdili CNN'ler karşılaştırılır. Ekran kalibrasyonu için saf geometrik, saf makine öğrenmesi ve hibrit geometrik regresyon karşılaştırılır. | Tek ya da iki göz girdisi tam yüze yakın doğruluğu yaklaşık 20 kat daha az hesapla veriyor. Yaklaşık 9 veya daha az noktada geometrik kalibrasyon makine öğrenmesinden iyi. Geometrik kalibrasyon hareketli başta çok bozuluyor. Hibrit yöntem geniş aralıkta en iyi. Kesin derece değerleri yalnızca grafiklerde. |

### 1c. Web kamerasıyla bakış takibinin doğrulanması (laboratuvar ve çevrimiçi)

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 17 | Online webcam-based eye tracking in cognitive science: A first look | Semmelmann, Weigelt | 2018 | Behavior Research Methods 50(2):451–465, doi:10.3758/s13428-017-0913-7 | https://doi.org/10.3758/s13428-017-0913-7 | özet (yalnızca künye ve ikincil özetler) | WebGazer ile fiksasyon, takip ve serbest bakış görevleri, çevrimiçi ve laboratuvar karşılaştırması. | Kendi sayıları okunamadı. İkincil kaynaklara göre çevrimiçi veri laboratuvar verisinden "biraz" daha az doğru, kişiler arası varyans yüksek. |
| 18 | Webcam eye tracking close to laboratory standards: Comparing a new webcam-based system and the EyeLink 1000 | Kaduk, Goeke, Finger, König | 2023 (çevrimiçi) / 2024 | Behavior Research Methods 56, doi:10.3758/s13428-023-02237-8 | https://doi.org/10.3758/s13428-023-02237-8 | özet (PMC tam metne erişim tarayıcı doğrulamasına takıldı) | Labvanced web kamerası sistemi ile EyeLink 1000 aynı anda, 5 görevde kayıt yaptı. | Genel doğruluk 1,4°, kesinlik 1,1°; EyeLink'ten yaklaşık 0,5° daha kötü (TeaP 2023 bildiri özeti). Ham örnek korelasyonu görev türüne göre yaklaşık %80–90. |
| 19 | Deep learning models for webcam eye tracking in online experiments | Saxena, Fink, Lange | 2023/2024 | Behavior Research Methods 56(4), PubMed 37608235 | https://pubmed.ncbi.nlm.nih.gov/37608235/ | özet (PDF 403 verdi) | 65 kişi kendi dizüstü bilgisayarıyla evde kayıt yaptı. Görevler: fiksasyon, bölge sınıflandırma, serbest bakış, takip, göz kırpma. Görünüm tabanlı modeller videoya çevrimdışı uygulandı. | En iyi doğruluk yaklaşık 2,4°, kesinlik 0,47°. Aynı grubun ETRA 2022 makalesi cihaz ve bakış kalibrasyonu ile en iyi modelle 2,58° bildiriyor (arama özetinden). |
| 20 | The validation of online webcam-based eye-tracking: The replication of the cascade effect, the novelty preference, and the visual world paradigm | Van der Cruyssen ve ark. | 2023 (çevrimiçi) / 2024 | Behavior Research Methods 56(5):4836–4849, doi:10.3758/s13428-023-02221-2 | https://doi.org/10.3758/s13428-023-02221-2 | özet | WebGazer ile üç klasik etki çevrimiçi tekrarlandı (n=134, 45 ve 32). | Üç etki de tekrarlandı ama etki büyüklükleri %20–27 küçüldü. Öneri: dört veya daha az büyük ilgi alanı içeren tasarımlar çevrimiçi yapılabilir. |
| 21 | Webcams as Windows to the Mind? A Direct Comparison Between In-Lab and Web-Based Eye-Tracking Methods | Slim, Kandel, Yacovone, Snedeker | 2024 | Open Mind 8:1369–1424, doi:10.1162/opmi_a_00171 | https://europepmc.org/article/PMC/PMC11627531 | özet | Kızılötesi takipçi, web kamerası videosunun elle kodlanması ve WebGazer; laboratuvar ve web ortamında 5 görev. | WebGazer kısa ve ince etkileri kaçırıyor. Ortamın (laboratuvar ya da web) belirgin etkisi yok. |
| 22 | Comparison of Webcam and Remote Eye Tracking | Wisiecka ve ark. | 2022 | ETRA 2022, doi:10.1145/3517031.3529615 | https://doi.org/10.1145/3517031.3529615 | özet | Ticari bir web kamerası çözümü (RealEye) ile uzaktan takipçi (GP3) ve ikisinin birleşimi. | Web kamerasında ölçüm hatası daha yüksek ama sonuçlar kuramsal beklentilerle uyumlu. Piksel değerleri (45,1 / 34,2 / 27,7 px) yalnızca satıcı sayfasından alındı ve doğrulanmadı. |

### 1d. Çevrimiçi öğrenme, MOOC, dikkat ve zihin gezinmesi

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 23 | Webcam-based Attention Tracking in Online Learning: A Feasibility Study | Robal, Zhao, Lofi, Hauff | 2018 | IUI 2018, s. 189–197, doi:10.1145/3172944.3172987 | https://chauff.github.io/documents/publications/iui2018-robal.pdf | tam metin | Yüzün görünüp görünmemesi dikkatin vekili olarak kullanıldı. Tipik MOOC davranışlarından oluşan 50 görevlik bir kıyas seti hazırlandı (telefona bakma, kahve içme, ele yaslanma gibi). 20 katılımcı, örnekleme 4 Hz. Kamera ekranın üst çerçevesinde. | Ortalama doğruluk: Tobii X2-30 %68,2, tracking.js %58,6, WebGazer/clmtrackr %35,4. clmtrackr yüz olmayan yerde de yüz uyduruyor; yüzün kaybolduğu görevlerde doğruluğu %9,6. tracking.js'nin gecikmesi 2 saniyenin altında. Kalibrasyon sonucu değiştirmedi. Örnekleme aralığının standart sapması 48 ms, en kötü durumda 1157 ms. |
| 24 | Scalable Mind-Wandering Detection for MOOCs: A Webcam-Based Approach | Zhao, Lofi, Hauff | 2017 | EC-TEL 2017, LNCS 10474:330–344, doi:10.1007/978-3-319-66610-5_24 | https://chauff.github.io/documents/publications/ectel2017-zhao.pdf | tam metin | 13 katılımcı iki MOOC videosu izledi; zil sesiyle düşünce yoklaması yapıldı. Global ve yerel (AOI) bakış öznitelikleriyle sınıflandırıcı kuruldu; Tobii X2-30 ile WebGazer karşılaştırıldı. | WebGazer öznitelikleriyle elde edilen recall ve F1, Tobii'ninkinden biraz yüksekti. Örneklem çok küçük olduğu için yazarlar istatistiksel anlamlı sonuç çıkarılamayacağını açıkça yazıyor. Kişiler arası fark çok büyük (en düşük F1 0). |
| 25 | Webcam-based eye tracking to detect mind wandering and comprehension errors | Hutt, Wong, Papoutsaki, Baker, Gold, Mills | 2023 (çevrimiçi) / 2024 | Behavior Research Methods 56(1):1–17, doi:10.3758/s13428-022-02040-x | https://doi.org/10.3758/s13428-022-02040-x | tam metin (yazar kopyası) | Çevrimiçi okuma görevinde WebGazer kullanıldı (N=105 üniversite öğrencisi ve Prolific'ten N=173). Global öznitelikler (nokta sayısı, dağılım) ve yerel öznitelikler (seçenek AOI'lerinde geçen süre). Çalışma 2'de kayma için 4 noktalı bir "sözde kalibrasyon" ofseti eklendi. | Anlama tahmininde yerel özniteliklerle kappa 0,57. Görevden bağımsız düşünce tahmininde kappa mütevazı, yaklaşık 0,1–0,2 aralığında; tek gruplar için örnek değerler 0,17 ve 0,04. Bu, araştırma düzeyi takipçilerle bildirilen yaklaşık 0,20 ile uyumlu. Kayma gözle görülür biçimde mevcuttu. Gözlük ve aydınlatma farklarına karşı görece dayanıklı; bazı etnik gruplarda performans düşüyor. |
| 26 | Synchronized eye movements predict test scores in online video education | Madsen, Júlio, Gucik, Steinberg, Parra | 2021 | PNAS 118(5), doi:10.1073/pnas.2016980118 (bioRxiv 809558 ön baskısı okundu) | https://www.biorxiv.org/content/10.1101/809558 | tam metin (ön baskı) | Öğrenciler arası bakış korelasyonu (ISC). Laboratuvar, sınıf (N=82) ve evde WebGazer (1012 kişi) koşulları. Veri cihazdan çıkmadan işlendi. | Dikkatli izlemede ISC belirgin biçimde daha yüksek ve test puanını öngörüyor. Web kamerası örnekleme hızı yaklaşık 15–100 Hz arasında değişiyordu. Sol-sağ ters kayıt nedeniyle 1159 kişiden 135'i dışlandı. |
| 27 | Can Eye Movement Synchronicity Predict Test Performance With Unreliably-Sampled Data in an Online Learning Context? | Sauter, Hirzle, Wagner, Hummel, Rukzio, Huckauf | 2022 | ETRA 2022 (kısa makale) | https://www.uni-ulm.de/fileadmin/website_uni_ulm/iui.inst.100/1-hci/hci-paper/2022/sauter_CanEyeMovement_2022.pdf | tam metin (kısmi) | Labvanced web kamerası takibi, 27 katılımcı, 3 video. Kalibrasyonda 8–15 nokta, 10 tur; baş kaydırma ve eğme turları da dahil. | Madsen ve arkadaşlarının sonucu düzensiz örneklenmiş web kamerası verisiyle tekrarlanamadı. |
| 28 | On Task and in Sync: Examining the Relationship between Gaze Synchrony and Self-Reported Attention During Video Lecture Learning | Bühler, Bozkir, Deininger, Gerjets, Trautwein, Kasneci | 2024 | arXiv 2404.00333 | https://arxiv.org/abs/2404.00333 | tam metin (HTML) | SMI RED 250 Hz (web kamerası değil). 84 kişi, yaklaşık 60 dakikalık kayıtlı ders, 15 düşünce yoklaması. Senkroni KLD ve MultiMatch ile ölçüldü. | Katılımcılar yoklamaların yalnızca %36'sında görev üzerindeydi. Dikkatliyken senkroni anlamlı biçimde yüksek ama etki küçük (marjinal R² yaklaşık 0,01–0,03). Senkroni öğrenmeyi öngörmedi; öz-bildirilen dikkat öngördü. |
| 29 | Eye movements during mindless reading | Reichle, Reineberg, Schooler | 2010 | Psychological Science 21(9):1300–1310, doi:10.1177/0956797610378686 | https://doi.org/10.1177/0956797610378686 | özet | Okurken kendiliğinden fark edilen "dalma" anları işaretlendi ve göz izlendi. | Dalgın okumada fiksasyonlar daha uzun ve metne daha az duyarlı. Göz metnin üzerindeyken zihin başka yerde olabiliyor. |
| 30 | Head Orientation and Gaze Direction in Meetings | Stiefelhagen, Zhu | 2002 | CHI 2002 Extended Abstracts, s. 858–859 | https://ri.cmu.edu/publications/head-orientation-and-gaze-direction-in-meetings | özet | Toplantıda baş yönü ile göz yönünün katkısı ayrıştırıldı. | Baş yönü toplam bakış yönüne ortalama %68,9 katkı yapıyor. Yalnız baş yönünden dikkat odağı tahmini 4 kişilik toplantıda %88,7 doğru. |
| 31 | Cleaning up systematic error in eye-tracking data by using required fixation locations | Hornof, Halverson | 2002 | Behavior Research Methods 34:592–604, doi:10.3758/BF03195487 | https://doi.org/10.3758/BF03195487 | özet (ikincil özetler) | Bakılması zorunlu ya da çok olası konumlar (RFL) kullanılarak kişiye ve bölgeye özgü sistematik hata ölçülür ve düzeltilir. | Sistematik ofset ortalama alarak giderilemez; kişiye özgü hata imzasıyla azaltılabilir. Okunan kaynakta sayı yok. |
| 32 | Real-Time Eye Blink Detection using Facial Landmarks | Soukupová, Čech | 2016 | 21st Computer Vision Winter Workshop (CVWW 2016) | https://vision.fe.uni-lj.si/cvww2016/proceedings/papers/05.pdf | özet | Landmark'lardan göz en-boy oranı (EAR) hesaplanır ve SVM ile göz kırpma sınıflandırılır. | Üç veri setinde dönemin en iyi yöntemleriyle karşılaştırılabilir sonuç. |

**Sayım.** Listelenen 32 makalenin 12'sinin tam metni okundu (1, 2, 3, 5, 11, 16, 23, 24, 25, 26, 27, 28). 20'sinin yalnızca özeti ya da künyesi okundu.

**Kamera konumu.** Kamera ekranın altında ya da üstündeyken bakışın nasıl etkilendiğini doğrudan ve kontrollü karşılaştıran hakemli bir web kamerası çalışması bulamadım. Bulduğum tek dolaylı kanıt şu iki kaynaktan geliyor:
- Bir ABD patent metni: kameranın altındaki bir şeye bakan kişinin gözleri "kapalı ya da kırpıyor gibi" görünür.
- Bir BRM derlemesinin ikincil özeti: Skodras ve ark. (2015) üst konumda benzer ya da daha iyi doğruluk bildirmiş. Bu kaynağı ben okumadım.

Bu yüzden bu konudaki öneriler kanıta değil mekanizmaya dayanıyor.

---

## 2. Sentez

### 2.1 Gerçekçi doğruluk
- **Klasik tarayıcı ve regresyon hattı.** Bu, DersNabzı'nın da kullandığı göz özniteliği ve ridge regresyon yaklaşımı (WebGazer türü). Gerçek kullanımda hata yaklaşık **4° civarında**. Kaynaklar: WebGazer 4,17°; Hutt ve ark. "4°'ye varan" diyor. 60 cm'de bu yaklaşık **4 cm** eder (benim hesabım). Uzaktan, denetimsiz koşulda piksel hatası 170–210 px düzeyinde.
- **Aynı oturum içinde hata büyüyor.** WebEyeTrack, WebGazer'ın hatasının bir oturumda yaklaşık %49 arttığını ölçtü. Hutt ve ark. kaymayı açıkça gördü.
- **İyi kurgulanmış web kamerası sistemleri.** Labvanced (Kaduk) 1,4° ve Saxena'nın derin modelleri yaklaşık 2,4° veriyor. Ama bunlar ya özenli kurulum ve kalibrasyon ister (baş pozu turları), ya da çevrimdışı işleme ile ağır modeller kullanır.
- **Az örnekli derin modeller.** Kişiselleştirilmiş modeller kendi kıyas veri setlerinde yaklaşık 3° veriyor (FAZE). Telefonda 0,5 cm'ye kadar iniyor (Valliappan), ama bu çok yakın mesafe ve önden poz koşulunda. Dizüstü bilgisayarda 50–70 cm mesafede bu sayılar beklenmemeli.
- **Kalibrasyonsuz modeller.** Veri setleri arasında 10° ve üzeri hata görülüyor (MPIIGaze çapraz değerlendirmesi). Kişisel kalibrasyon şart.
- **Sonuç.** Bu doğrulukla **dört ya da daha az büyük AOI** güvenilir biçimde ayrılabilir (Van der Cruyssen). Kısa ve ince bakış etkileri kaçar (Slim). Paylaşılan materyalin üzerinde satır ya da kelime düzeyinde ısı haritası bilimsel olarak savunulamaz. Ancak kaba bölgeler (örneğin 3×3 ızgara ya da materyalin çeyrekleri) savunulabilir.

### 2.2 Doğruluğu artıran etkenler
1. **Kişisel kalibrasyon ve yeterli nokta.** Geometrik kalibrasyon 9 veya daha az noktada iyi çalışıyor, ama hibrit yöntem en iyisi (Gudi). Derin modellerde 3–9 örnekle meta-öğrenme işe yarıyor (FAZE, He, WebEyeTrack).
2. **Baş pozunun hesaba katılması.** Göz yamasının sanal kameraya göre normalize edilmesi %9,5–32,7 iyileştirme sağlıyor (Zhang 2018). Metrik baş pozunun modele girdi olarak verilmesi de bir yol (WebEyeTrack). Kalibrasyon sırasında baş kaydırma ve eğme turlarının yapılması da önerilmiş (Sauter/Labvanced). Saf geometrik kalibrasyon hareketli başta çöküyor (Gudi).
3. **Örtük ve sürekli yeniden kalibrasyon.** Tıklamalardan ve imleçten yararlanılabilir (WebGazer, PACE). Ancak "tıklanan yere bakılır" varsayımı her zaman geçerli değil; doğrulama filtresi gerekir (PACE). Video içeriğinin dikkat çekicilik haritasından kalibrasyon yapmak da mümkün (Sugano, yaklaşık 3,5°).
4. **Kayma düzeltme.** Bakılması zorunlu konumlarla sistematik ofset ölçülüp çıkarılabilir (Hornof & Halverson). Hutt'un 4 noktalı sözde kalibrasyonu da aynı işi görüyor.
5. **Örnek kalitesi.** Kalibrasyonda son kareler kullanılmalı ve kırpma örnekleri elenmeli (TurkerGaze). Çok yakın veya uzak duruş ve karanlık ortam için kalite kapıları konmalı.
6. **Hesap verimliliği.** Tek ya da iki göz girdisi, tam yüze göre yaklaşık 20 kat daha ucuz ve neredeyse aynı doğrulukta (Gudi). Sıradan dizüstü bilgisayarlar için önemli.

### 2.3 Tuzaklar
- **"Ekrana bakıyor" dikkat demek değil.** Göz metnin üzerindeyken zihin başka yerde olabilir (Reichle). Kayıtlı derste öğrenciler yoklamaların yalnızca %36'sında görev üzerindeydi (Bühler). Web kamerasıyla zihin gezinmesi tespiti şans düzeyinin üstünde ama mütevazı: kappa yaklaşık 0,1–0,2 (Hutt; Zhao'da çok küçük örneklem). Bireysel öğrenciye "dikkatsiz" etiketi koymak bu kanıtla desteklenmiyor.
- **Yüz var veya yok bile zor.** Gerçekçi MOOC davranışlarında en iyi tarayıcı kütüphanesi %58,6, Tobii %68,2 doğrulukta kaldı (Robal). Agresif yüz uydurma yüz olmayan yerde de yüz buluyor. MediaPipe'ın güven skoru bu yüzden kontrol edilmeli.
- **Baş yönü bakışın yalnızca bir kısmını açıklıyor.** Katkısı yaklaşık %69 (Stiefelhagen). Baş sabitken gözle ekranın kenarına bakmak "uzağa bakma" sayılmamalı. Tersi de mümkün: baş dönükken göz ekranda olabilir.
- **Düzensiz örnekleme.** Tarayıcıda örnekleme aralığı sapıyor (Robal: standart sapma 48 ms, en kötü 1157 ms). Web kamerası hızları 15–100 Hz arasında (Madsen). Bu yüzden grup senkronisi gibi zamana duyarlı ölçüler tekrarlanamadı (Sauter). Senkroni öğrenmeyi öngörmeyebiliyor (Bühler).
- **Kayma.** Oturum boyunca hata büyüyor (WebEyeTrack, Hutt). Tek seferlik kalibrasyonun doğruluğu ders sonuna kadar geçerli sayılamaz.
- **Adalet ve genellenebilirlik.** Bazı demografik gruplarda tespit performansı düştü (Hutt). Veri setlerinin çeşitliliği sınırlı.
- **Kamera konumu ve göz kapağı.** Göz aşağı baktıkça üst kapak irisi örter ve görüntüde göz "kapalı" görünebilir. Kamera yükseldikçe bu etki artar (mekanizma; doğrudan web kamerası çalışması bulunamadı). Sabit bir EAR eşiği kamera ekranın üstündeyken aşağı bakışı göz kırpma ya da uyku gibi okur.
- **Lisanslar.**
  - WebGazer GPLv3; değeri 1 milyon doların altındaki şirketler için LGPLv3 seçeneği var.
  - ETH-XGaze CC BY-NC-SA 4.0 ve ek koşullar; ticari kullanım yasak, türev için "aynı lisansla paylaş" yükümlülüğü değerlendirilmeli.
  - GazeCapture kayıt gerektiriyor ve araştırma amaçlı (lisans sayfası bu oturumda açılamadı, doğrulanmadı).
  - MPIIGaze ve MPIIFaceGaze bildiğim kadarıyla ticari olmayan CC lisanslı; bu oturumda doğrulamadım.
  - L2CS-Net kodu MIT, ama ağırlıklar Gaze360 ile eğitilmiş görünüyor ve onun koşulları geçerli.
  - WebEyeTrack makalesi lisans belirtmiyor; repo kontrol edilmeli.
  - MediaPipe (Apache 2.0) sorunsuz.

---

## 3. DersNabzı için öncelikli iyileştirme önerileri

Her öneri ölçülerek doğrulanmalı. Kullanıcının kuralı gereği ekranda yalnızca gerçekten ölçülen değerler gösterilmeli.

**1. Kalibrasyon sonrası doğrulama turu ve ölçülen hatayı dürüstçe gösterme (öncelik: en yüksek; efor: düşük).**
- Kalibrasyondan sonra kalibrasyonda kullanılmayan 4–5 noktalık ayrı bir doğrulama yapılsın.
- Öğrenci bazında ortalama hata piksel ve tahmini santimetre olarak ölçülsün. Santimetre ekran boyutu bilinmiyorsa kartla ölçeklenerek, aksi halde yalnızca piksel olarak verilsin.
- Öğretmene "veri kalitesi" olarak bu ölçülen değer gösterilsin. Eşiği aşan öğrencinin AOI ve ısı haritası verisi gösterilmesin ya da "düşük kalite" diye etiketlensin.
- Dayanak: Kaduk, Saxena, Van der Cruyssen, Hutt (dışlama ve kalite), Hornof.

**2. Isı haritası ve AOI çözünürlüğünü ölçülen hataya bağlama (öncelik: yüksek; efor: düşük).**
- Materyal üzerindeki ısı haritası kaba bir ızgarada toplansın. Izgara hücresi en az ölçülen hatanın yaklaşık 2 katı olsun, ya da en fazla 4–9 bölge kullanılsın.
- Isı haritası çekirdeği (Gauss sigma) o öğrencinin ölçülen hatasından türetilsin.
- Küçük AOI'ler birleştirilsin. Örneğin "duyurular" ve "konu" birbirine bitişik ve küçükse aralarına güvenli bir sınır şeridi konsun ya da bunlar "belirsiz" sayılsın.
- Dayanak: Van der Cruyssen (dört veya daha az büyük bölge), Slim, WebGazer ve Hutt (yaklaşık 4°).

**3. Kayma izleme ve düzeltme (öncelik: yüksek; efor: orta).**
- WebGazer'daki gibi tıklamaları örtük kalibrasyon örneği olarak kullanın (tıklamadan önceki yaklaşık 500 ms, mesafe kapısı). Bu örneklere PACE'teki gibi bir doğrulama filtresi uygulayın. Bakış hızı düşük olmalı (fiksasyon olmalı), göz açık olmalı, baş pozu kalibrasyon tabanına yakın olmalı.
- Ders içinde doğal "zorunlu fiksasyon" anları kullanılsın. Örneğin bir anket butonu ya da sohbet giriş kutusu odaklandığında ofset ölçülüp güncellensin (Hornof'un RFL fikri, Hutt'un sözde kalibrasyonu).
- Ofset büyüklüğü zaman içinde kaydedilsin. Belirli bir eşiği aşınca öğrenciye kısa bir yeniden kalibrasyon önerilsin.
- Ridge modelinde eski örnekler zamanla ağırlık kaybetsin (WebGazer'daki imleç ağırlığı azalmasına benzer biçimde).
- Dayanak: WebGazer, PACE, Hornof & Halverson, Hutt, WebEyeTrack (oturum içinde %49 hata artışı).

**4. Baş pozu kompanzasyonu (öncelik: yüksek; efor: orta).**
- FaceLandmarker'ın yüz dönüşüm matrisinden yaw, pitch, roll ve mesafe (iris çapı yaklaşık 1,2 cm kabulüyle ölçek) elde edilsin.
- (a) Bunlar ridge öznitelik vektörüne eklensin.
- (b) Daha iyisi: göz bölgesi landmark'ları baş dönüşü geri alınarak kanonik bir yüz çerçevesine normalize edilsin (Zhang 2018'deki normalizasyonun landmark düzeyindeki karşılığı).
- Kalibrasyon sırasında 1–2 tur hafif baş kaydırma ve eğme yaptırılsın.
- Baş pozu kalibrasyon aralığının dışına çıkınca bakış tahmini "güvenilmez" diye işaretlensin; AOI'ye yazılmasın.
- Dayanak: Zhang 2018, WebEyeTrack, Sauter/Labvanced, Gudi (geometrik yöntem hareketli başta çöküyor).

**5. "Dikkat" yerine "ekrana yönelim" diye adlandırma ve sınıf düzeyinde raporlama (öncelik: yüksek; efor: düşük).**
- Baş yaw/pitch'ten türetilen skor dikkat ölçmüyor, yönelimi ölçüyor. Arayüzde ve raporda adı buna göre değişsin, örneğin "ekrana yönelim" ya da "ekrandan ayrılma süresi".
- "Uzağa bakıyor" bayrağı yalnızca baş pozuna değil, bakış noktasının ekran dışına düşmesine de dayansın. İkisi birleştirilsin: baş yaklaşık %69 katkı yapıyor, gözle kenara bakış normaldir.
- Bireysel öğrenciye dikkatsizlik etiketi yerine sınıf düzeyinde toplu eğilimler gösterilsin.
- Zihin gezinmesi tespiti eklenecekse etiket yoklamalarla toplanıp doğrulanmadan arayüze konmasın. Literatürde kappa yaklaşık 0,1–0,2 ve kişiler arası fark büyük.
- Dayanak: Stiefelhagen & Zhu, Reichle, Bühler, Hutt, Zhao, Robal.

**6. Kamera konumuna duyarlı göz açıklığı ve kırpma tespiti (öncelik: orta-yüksek; efor: düşük-orta).**
- Kurulumda kamera konumu sorulsun (üst/alt) ya da baş pitch'i ile iris konumundan tahmin edilsin.
- EAR eşiği sabit olmasın. Kalibrasyon sırasında her dikey bakış satırında (üst, orta ve alt noktalar) ölçülen kişisel EAR tabanına göre göreli bir eşik kullanılsın.
- Kalibrasyonda özellikle ekranın alt bölgesine noktalar konsun.
- Kısa kapanmalar (yaklaşık 100–400 ms) kırpma olarak veri boşluğu sayılsın, AOI'ye yazılmasın. Kırpma sırasındaki örnekler regresyon eğitiminden elensin (TurkerGaze'deki ZNCC yaklaşımı veya EAR).
- "Gözler kapalı" uyarısı yalnızca uzun ve göreli eşiğin altındaki kapanmalarda verilsin.
- Dayanak: Soukupová & Čech (EAR), TurkerGaze. Kamera konumu etkisi için doğrudan çalışma yok; bu öneri mekanizmaya dayanıyor ve sistemde ölçülerek doğrulanmalı.

**7. Örnekleme hızı ve zaman damgası kalitesi (öncelik: orta; efor: düşük).**
- Her örnek `performance.now()` ile damgalansın. Öğrenci başına gerçekleşen fps ve örnekler arası aralığın dağılımı kaydedilsin.
- Belirli bir fps eşiğinin altındaki oturumlar zamana duyarlı analizlerden (geçiş, senkroni) dışlansın ve öğretmene bu belirtilsin.
- OneEuro filtresi düzensiz örneklemede gerçek zaman farkıyla (dt) çalıştırılsın.
- Dayanak: Robal (4 Hz hedefte standart sapma 48 ms, en kötü 1157 ms), Madsen (15–100 Hz arasında değişken), Sauter (düzensiz örneklemeyle tekrarlanamadı).

**8. Kalibrasyon protokolünü sıkılaştırma (öncelik: orta; efor: düşük).**
- En az 9 nokta kullanılsın, alt kenar ve köşeler de dahil.
- Her noktada ilk yaklaşık 300–500 ms atılsın; yalnızca son, kararlı kareler kullanılsın.
- Kırpma kareleri elensin. Aykırı noktalar çapraz doğrulamayla atılsın.
- Ridge'in regularizasyon katsayısı doğrulama hatasıyla seçilsin.
- Dayanak: TurkerGaze, Gudi (9 veya daha az noktada geometrik ya da hibrit yöntem avantajlı), WebGazer.

**9. İsteğe bağlı: hafif CNN ve az örnekli kişiselleştirme (öncelik: düşük-orta, araştırma niteliğinde; efor: yüksek).**
- Ridge hattının yanına BlazeGaze/WebEyeTrack türü küçük bir model (TF.js, göz yaması ve baş pozu, 9 noktalı MAML) A/B olarak denensin.
- Öneri 1'deki doğrulama hatası ve oturum içi kayma ölçülerek karşılaştırılsın. Yalnızca ölçülen bir iyileşme varsa geçilsin.
- Lisans uyarısı: WebEyeTrack repo lisansı ve ağırlıkların eğitim verisi kontrol edilmeli. GazeCapture yalnızca araştırma amaçlı ve kayıtlı erişimli; ETH-XGaze CC BY-NC-SA. Bunlarla eğitilmiş ağırlıkların üniversitede ticari olmayan amaçla kullanımı muhtemelen uygun, ama türev model dağıtımında "aynı lisansla paylaş" ve ek koşullar hukukçuyla birlikte değerlendirilmeli.
- Mevcut hattın değiştirilmesi proje sahibinin onayına bağlı.
- Dayanak: WebEyeTrack, FAZE, He 2019, Gudi, Saxena.

**10. İsteğe bağlı: sınıf düzeyinde senkroni göstergesi (öncelik: düşük; efor: orta).**
- Aynı materyale bakan öğrencilerin bakış dağılımlarının benzerliği (KLD ya da ISC) sınıf düzeyinde, yalnızca bir eğilim olarak gösterilebilir.
- Bireysel öğrenme tahmini olarak sunulmamalı. Bühler senkroninin öğrenmeyi öngörmediğini buldu; Sauter web kamerasıyla Madsen'in sonucunu tekrarlayamadı.
- Dayanak: Madsen, Sauter, Bühler.

---

### İkincil ve doğrulanmamış notlar
- Skodras ve ark. (2015), kamera üstte ve altta: yalnızca ikincil özet. Okunmadı, tabloda yok.
- Wisiecka ve ark. piksel değerleri satıcı (RealEye) sayfasından alındı. Makaleden doğrulanmadı.
- Kaduk ve ark. için 1,4° ve 1,1° değerleri TeaP 2023 bildiri özetinden ve arama sonuçlarından geldi. PMC tam metni bu oturumda açılamadı.

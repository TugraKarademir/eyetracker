# Literatür taraması 3/4: Yüz ifadesi (valence/arousal) ve göz kapanması / yorgunluk

Hazırlanma tarihi: 2026-11-18. Kapsam: DersNabzı'nın (E:\eyetracker) iki sinyal hattı:
(a) HSEmotion `enet_b0_8_va_mtl` ile yüz ifadesi, valence/arousal ve DAiSEE benzeri durum kestirimi;
(b) MediaPipe `eyeBlink` / EAR ile göz kapanması, PERCLOS ve esneme tabanlı "enerji".

**Okuma düzeyi notu (dürüstlük):**
- "Tam metin": makalenin metnini (PDF'ten çıkarılmış ya da HTML/XML olarak) okudum ve sayıları oradan aldım.
- "Tam metin (kısmi)": uzun metnin büyük bölümünü okudum ama tamamını değil.
- "Özet": yalnızca özeti, yayın kaydını ve/veya arama motoru özetini gördüm. Bu satırlardaki sayılar özetten ya da kayıttan gelir. Özette sayı yoksa "belirtilmemiş" yazdım.
- Hiçbir DOI, sayı ya da yayın yeri tahminle yazılmadı. Emin olmadığım yayın yeri bilgilerini öyle işaretledim.

---

## 1. Makale tablosu

### 1A. Yüz ifadesi, valence/arousal, AU, kişiselleştirme, eleştiri ve adalet

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 1 | AffectNet: A Database for Facial Expression, Valence, and Arousal Computing in the Wild | Mollahosseini, Hasani, Mahoor | 2017 | IEEE Trans. Affective Computing 10(1) | arXiv:1708.03985 | Özet | Web'den toplanan yüzler (1.250 anahtar kelime, 6 dil); yaklaşık yarısı 7/8 ifade ve V/A ile elle etiketlendi; 2 temel CNN | >1.000.000 görüntü, yaklaşık yarısı etiketli. Özette temel model metrikleri yok. |
| 2 | Frame-level Prediction of Facial Expressions, Valence, Arousal and Action Units for Mobile Devices | Savchenko | 2022 | CVPR Workshops (ABAW3) | arXiv:2203.13436 | **Tam metin** | VGGFace2 ön eğitimi, ardından AffectNet'te 8 sınıf ince ayar (V/A etiketleri **kullanılmadı**). 224×224 EfficientNet-B0 öznitelikleri üzerine MLP/lojistik regresyon. k=5/15 kare ortalama/medyan yumuşatma | Aff-Wild2 doğrulama, B0: ifade makro-F1 0,38; V/A CCC_V 0,429 / CCC_A 0,496 (ortalama 0,46); AU F1 0,54. **Sınıf bazında F1: Korku 0,016, Öfke 0,151, Şaşkınlık 0,303, Üzüntü 0,461, Nötr 0,609.** En iyi yumuşatma k=15 karelik pencere (ortalama filtresi çoğu görevde medyandan iyi). |
| 3 | EmotiEffNet Facial Features in Uni-task Emotion Recognition in Video at ABAW-5 | Savchenko | 2023 | CVPRW (ABAW5) | arXiv:2303.09162 | Özet | EmotiEffNet kare öznitelikleri, MLP + LightAutoML topluluğu, ardışık karelerde yumuşatma | Özette sayı yok; temel modelden "çok daha yüksek" F1/CCC. |
| 4 | Classifying emotions and engagement in online learning based on a single facial expression recognition neural network | Savchenko, Savchenko, Makarov | 2022 | IEEE Trans. Affective Computing 13(4):2132–2143 | Yayın kaydı (HSE); arXiv sürümü bulunamadı | Özet | Yüz tespiti, izleme ve öğrenci başına kümeleme. Tek ağdan bireysel duygu, katılım (engagement) ve grup duygusu | EmotiW verisinde tek modellerden belirgin üstün. Sayılar özette yok. |
| 5 | Expression, Affect, Action Unit Recognition: Aff-Wild2, Multi-Task Learning and ArcFace | Kollias, Zafeiriou | 2019 | BMVC 2019 (sözlü) | arXiv:1910.04855 | Özet | Aff-Wild2 (V/A + ifade + AU), CNN/CNN-RNN, ArcFace kaybı | Özette sayı yok ("10 veri tabanında SOTA"). |
| 6 | ABAW: Valence-Arousal Estimation, Expression Recognition, Action Unit Detection & Multi-Task Learning Challenges | Kollias | 2022 | ABAW3 @ CVPR 2022 | arXiv:2202.10659 | Özet | Yarışma tanımı ve temel modeller | Özette sayı yok. Savchenko (#2) bu temeli şöyle aktarır: VGGFACE/ResNet temel modeli CCC_V 0,31 / CCC_A 0,17, ifade F1 0,23. |
| 7 | Estimation of continuous valence and arousal levels from faces in naturalistic conditions (EmoNet) | Toisoul, Kossaifi, Bulat, Tzimiropoulos, Pantic | 2021 | Nature Machine Intelligence 3:42–50 | doi:10.1038/s42256-020-00280-0 | Özet | Hizalama ile ifade ve V/A'yı tek geçişte kestiren ağ | Makale sayıları okunmadı. Kod deposu (makale değil) AffectNet/SEWA için CCC_V 0,82–0,90, CCC_A 0,75–0,80 bildiriyor; doğrulanmadı. |
| 8 | Cross-dataset learning and person-specific normalisation for automatic Action Unit detection | Baltrušaitis, Mahmoud, Robinson | 2015 | IEEE FG 2015 | doi:10.1109/FG.2015.7284869 | **Tam metin** | HOG + geometri, SVM/SVR. **Kişiye özgü medyan normalizasyonu:** videodaki öznitelik medyanı "nötr yüz" sayılır ve çıkarılır (çevrimiçi, histogramla) | Medyan normalizasyonu SEMAINE/DISFA'da bazı AU'larda (2, 4, 9, 15, 17, 20) büyük kazanç sağlıyor. Nötrün çoğunlukta olmadığı BP4D'de **performansı düşürebiliyor**. Yazarlara göre yöntem seçici uygulanmalı. 20–30 fps gerçek zamanlı. |
| 9 | OpenFace 2.0: Facial Behavior Analysis Toolkit | Baltrušaitis, Zadeh, Lim, Morency | 2018 | IEEE FG 2018, s. 59–66 | doi:10.1109/FG.2018.00019 | Özet / kayıt | Landmark, baş pozu, AU, bakış | Değerlendirme sayıları okunmadı. **Lisans: yalnızca araştırma için ücretsiz; ticari kullanım CMU lisansı ister.** |
| 10 | LibreFace: An Open-Source Toolkit for Deep Facial Expression Analysis | Chang, Yin, Li, Tran, Soleymani | 2024 | WACV 2024 (Application track) | arXiv:2308.10713 | Özet | Büyük ön eğitimli ağ, öznitelik düzeyinde damıtma, görev özelinde ince ayar | DISFA'da AU yoğunluğu PCC 0,63 (OpenFace 2.0'dan yaklaşık %7 iyi); yaklaşık 2 kat hızlı. |
| 11 | Emotional Expressions Reconsidered: Challenges to Inferring Emotion From Human Facial Movements | Barrett, Adolphs, Marsella, Martinez, Pollak | 2019 | Psychological Science in the Public Interest 20(1) | doi:10.1177/1529100619832930 (PMC6640856) | Özet (PMC ve yayıncı erişimi engellendi) | Altı temel duygu için yüz hareketi ile duygu ilişkisine dair kapsamlı inceleme | Yüz hareketleri duygularla şanstan sık örtüşüyor, ancak kültüre, bağlama ve kişiye göre büyük değişkenlik var. Aynı yüz düzeni farklı duygular ya da duygu dışı anlamlar taşıyabiliyor. Tam metindeki yüzdeleri okuyamadığım için aktarmadım. |
| 12 | A performance comparison of eight commercially available automatic classifiers for facial affect recognition | Dupré, Krumhuber, Küster, McKeown | 2020 | PLOS ONE 15(4):e0231968 | doi:10.1371/journal.pone.0231968 | **Tam metin (kısmi, yaklaşık %73)** | 8 ticari sınıflandırıcı ile 14 insan gözlemcinin karşılaştırılması; 937 video (poz verilmiş BU-4DFE ve kendiliğinden UT-Dallas) | İnsan doğruluğu yaklaşık %72, sınıflandırıcılar %48–62. Kendiliğinden ifadelerde çoğu sınıflandırıcı daha kötü. Fleiss κ: insan 0,58, sınıflandırıcı 0,47. |
| 13 | Investigating Bias and Fairness in Facial Expression Recognition | Xu, White, Kalkan, Gunes | 2020 | arXiv:2007.10075 (arXiv sayfasında yayın yeri yok; bildiğim kadarıyla ECCV 2020 Workshops, doğrulanmadı) | arXiv:2007.10075 | **Tam metin** | Temel, özniteliğe duyarlı ve ayrıştırılmış (disentangled) modeller; RAF-DB ve CelebA; "equal opportunity" adalet ölçüsü | RAF-DB test kümesi %77,4 Beyaz, %15,5 Asyalı, %7,1 Afro-Amerikan. Veri artırma doğruluğu yaklaşık %7 artırıyor ama yanlılığı gidermiyor. Korku ve İğrenme en düşük doğruluklu sınıflar. Alıntıladığı Rhue (2018): Face++ ve Microsoft API'si, NBA oyuncularından Afro-Amerikan olanlara gülümseme düzeyinden bağımsız olarak daha olumsuz duygu puanı veriyor (ikincil kaynak). |
| 14 | Assessing Demographic Bias Transfer from Dataset to Model: A Case Study in FER | Dominguez-Catena, Paternain, Galar | 2022 | AISafety 2022 Workshop | arXiv:2205.10049 | Özet | Temsil, stereotip ve artık model yanlılığı için üç metrik; AffectNet ve FER+ üzerinde | AffectNet'te "önemli ırksal yanlılık ve cinsiyet stereotipleri" var; modeller artık yanlılık taşıyor. Özette sayı yok. |
| 15 | Metrics for Dataset Demographic Bias: A Case Study on Facial Expression Recognition | Dominguez-Catena, Paternain, Galar | 2024 | IEEE TPAMI (arama kaydına göre) | arXiv:2303.15889 | Özet | Yanlılık metrikleri taksonomisi; 20 FER veri kümesi | Birçok metrik birbirinin tekrarı; az sayıda metrik yetiyor. |
| 16 | On Calibration of Modern Neural Networks | Guo, Pleiss, Sun, Weinberger | 2017 | ICML 2017 | arXiv:1706.04599 | Özet | Derin ağların güven kalibrasyonunun incelenmesi; sıcaklık ölçekleme (temperature scaling) | Modern ağlar kötü kalibre; tek parametreli sıcaklık ölçekleme çoğu veri kümesinde etkili. ECE sayıları özette yok. |
| 17 | The Faces of Engagement: Automatic Recognition of Student Engagement from Facial Expressions | Whitehill, Serpell, Lin, Foster, Movellan | 2014 | IEEE Trans. Affective Computing 5(1):86–98 | doi:10.1109/TAFFC.2014.2316163 | Özet | iPad'de bilişsel eğitim sırasında webcam; kare bazında ifade ile katılım kestirimi | 10 sn'lik klip etiketi, kare etiketlerinin ortalamasından Pearson r=0,85 ile kestirilebiliyor. Son test, katılım etiketlerinden (r=0,47) ön test puanı kadar (r=0,44) iyi kestirilebiliyor. |
| 18 | DAiSEE: Towards User Engagement Recognition in the Wild | Gupta, D'Cunha, Awasthi, Balasubramanian | 2016 (v7: 2022) | arXiv:1609.01885 | arXiv:1609.01885 | Özet | 112 kullanıcıdan 9.068 video parçası; can sıkıntısı, kafa karışıklığı, katılım ve hayal kırıklığı için 4'er düzey; kitle etiketlemesi | Özette temel model sayıları yok. |
| 19 | Detecting Student Emotions in Computer-Enabled Classrooms | Bosch, D'Mello, Baker, Ocumpaugh, Shute, Ventura, Wang, Zhao | 2016 | IJCAI 2016, s. 4125–4129 | ijcai.org/Abstract/16/615 | **Tam metin** | Gerçek sınıf, monitör üstü 30 $'lık webcam, FACET AU'ları; BROMP gözlemci etiketleri; log ile çok kipli füzyon | Yüz tabanlı AUC: can sıkıntısı 0,610, kafa karışıklığı 0,649, keyif 0,867, katılım 0,679, hayal kırıklığı 0,631. **Örneklerin %34–35'inde yüz kaydedilemedi** (ışık, poz, el-yüz örtmesi). Log füzyonuyla kullanılabilirlik %65'ten %98'e çıktı. Yazarlar müdahalelerin "fail-soft" olmasını öneriyor. |
| 20 | Personalized machine learning for robot perception of affect and engagement in autism therapy | Rudovic, Lee, Dai, Schuller, Picard | 2018 | Science Robotics 3(19) | arXiv:1802.01186 | Özet | Kişiselleştirilmiş derin öğrenme; 35 çocuk, 2 kültür | Uzman kodlayıcılarla uyum ICC yaklaşık %60; kişiselleştirilmemiş modellerden iyi (basın metnine göre insanlar arası uyum %50–55). |

### 1B. Göz kapanması, kırpma, PERCLOS, esneme

| # | Başlık | Yazarlar | Yıl | Yayın yeri | Bağlantı / DOI | Okuma | Yöntem | Temel nicel sonuç |
|---|---|---|---|---|---|---|---|---|
| 21 | Real-Time Eye Blink Detection using Facial Landmarks | Soukupová, Čech | 2016 | 21st Computer Vision Winter Workshop (CVWW) | vision.fe.uni-lj.si/cvww2016/proceedings/papers/05.pdf | **Tam metin** | EAR = (‖p2−p6‖+‖p3−p5‖)/(2‖p1−p4‖); 13 karelik EAR penceresi üzerinde doğrusal SVM, eşikleme ile karşılaştırma | Eyeblink8'de sabit eşik (0,2) gülümseme, yandan görünüm ve uzun kapanmada başarısız; SVM belirgin üstün. IOD < 20 px'te dedektör çöküyor. Yazarlar sınırlılık olarak sabit kırpma süresini ve **2D EAR'ın düzlem dışı rotasyonda ayırt ediciliğini yitirmesini** belirtiyor; 3D EAR öneriyorlar. "Düşük EAR her zaman kırpma demek değildir" (ifade, esneme, aşağı bakış). |
| 22 | Adjusting eye aspect ratio for strong eye blink detection based on facial landmarks | Dewi, Chen, Jiang, Yu | 2022 | PeerJ Computer Science 8:e943 | doi:10.7717/peerj-cs.943 | **Tam metin** | Videonun kendi açık/kapalı EAR uç değerlerinin ortalaması eşik olarak kullanılıyor | Video başına eşikler 0,21 ile 0,29 arasında değişiyor; sabit 0,2 bir videoda doğruluğu 0,211'e düşürüyor. Ancak kırpma sınıfı kesinliği çok düşük (0,02–0,33) ve kendi verisinde AUC < 0,5. **Kişiye özgü eşik gerekçesi güçlü, kanıt zayıf.** |
| 23 | Blinking Beyond EAR: A Stable Eyelid Angle Metric for Driver Drowsiness Detection and Data Augmentation | Wolter, Berrio Perez, Shan | 2025 | arXiv önbaskısı (hakemsiz) | arXiv:2511.19519 | **Tam metin** (HTML) | MediaPipe Face Mesh 3D noktalarından göz kapağı düzlemleri arası açı (ELA), yaw ağırlıklı | 2D EAR baş dönüşünde bozuluyor (nitel). ELA sentetik MAE 2,8–3,3°. DMD'de kırpma tespiti %89,4. Kare hızı uyumsuzluğunda doğruluk %92–98'den %46–69'a düşüyor; kapanma süresi 30 ile 50 Hz arasında %32 değişiyor. |
| 24 | Blendshapes GHUM: Real-time Monocular Facial Blendshape Prediction | Grishchenko, Yan, Bazavan, Zanfir, Chinaev, Raveendran, Grundmann, Sminchisescu | 2023 | arXiv önbaskısı | arXiv:2309.05782 | **Tam metin** | MediaPipe'ın 52 blendshape modeli: 478 landmark'tan blendshape regresyonu; 6.000 tarama ve 2M sentetik çift | Genel MNE %3,88, göz bölgesi MNE yaklaşık %2,15–4,31 (tabloya göre). **Göz kırpma veya göz kapanması için ayrı doğruluk raporu yok.** Yazarlara göre blendshape tabanı ortogonal değil ve eşleme çoktan bire, bu yüzden katsayıların doğrudan karşılaştırılması "gürültülü". |
| 25 | PERCLOS-based technologies for detecting drowsiness: current evidence and future directions | Abe | 2023 | Sleep Advances 4(1):zpad006 | doi:10.1093/sleepadvances/zpad006 | **Tam metin (kısmi, yaklaşık %55)** | Anlatı derlemesi | PERCLOS = gözün %80'den fazla kapalı olduğu sürenin yüzdesi. Çalışmalar arasında eşik (%70/%75/%80), kırpma dışlama süresi (250/400/500 ms) ve örnekleme (2–120 Hz) tutarsız. Orta düzey uykululukta, yaşlılarda ve **dikkat dağınıklığında** duyarsız kalabiliyor. Gözlük, yansıma, baş hareketi ve düşük örnekleme hızı teknik sınırlar. |
| 26 | PERCLOS: A Valid Psychophysiological Measure of Alertness As Assessed by Psychomotor Vigilance (Tech Brief) | FMCSA/FHWA (Dinges ve ark.'nın NHTSA raporuna dayanır) | 1998 | FHWA-MCRT-98-006 | doi:10.21949/1502740 | Özet / kayıt | Laboratuvar karşılaştırması, ölçüt PVT kayıpları | Test edilen ölçüler arasında PERCLOS "en güvenilir ve geçerli" bulundu. Wierwille (1994) tanımı: dakika içinde gözün en az %80 kapalı olduğu süre oranı. Yavaş kapanmaları ölçer, kırpmaları değil. |
| 27 | Experimental evaluation of eye-blink parameters as a drowsiness measure | Caffier, Erdmann, Ullsperger | 2003 | Eur. J. Appl. Physiol. 89(3):319–325 | doi:10.1007/s00421-003-0807-5 | Özet | Gözlük çerçevesine takılı IR sensör; 60 yetişkin | Uykululukla kırpma süresi ve yeniden açılma süresi güvenilir biçimde artıyor; uzun kapanmalı kırpma oranı bilgi veriyor. |
| 28 | Blinks and saccades as indicators of fatigue in sleepiness warnings: looking tired? | Schleicher, Galley, Briest, Galley | 2008 | Ergonomics 51(7):982–1010 | doi:10.1080/00140130701817062 | Özet | 129 katılımcı, okülomotor değişkenler | En iyi göstergeler: kırpma süresi, kapağın yeniden açılma gecikmesi, kırpma aralığı, standartlaştırılmış kapanma hızı. **Tüm değişkenlerde büyük bireyler arası fark var.** |
| 29 | Blink Rate Patterns Provide a Reliable Measure of Individual Engagement with Scene Content | Ranti, Jones, Klin, Shultz | 2020 | Scientific Reports 10:8267 | PMC7237680 | **Tam metin** | 21 yetişkin, göreve ilgili ve ilgisiz sahneler; göz izleyiciden kırpma | Herkes göreve ilgili sahnede daha az kırptı (etkileşim F(1,19)=33,9). Bireysel taban kırpma hızı **2–26/dk** (ort. 12,6). 1 sn ölçeğinde düşük kırpanlarda ölçüm zayıf. Kırpma hızı sıfırın altına inemediği için tavan etkisi var. |
| 30 | Spontaneous eye blink rate: An index of dopaminergic component of sustained attention and fatigue | Maffei, Angrilli | 2018 | Int. J. Psychophysiology 123:58–63 | (dergi kaydı) | Özet | Mackworth saat görevi, 3 zorluk; 33 kadın öğrenci | Zor görevde kırpma hızı en düşük; zorluktan bağımsız olarak 4. dakikadan itibaren kırpma artışı (yorgunluk). Örneklem küçük ve tek cinsiyetli. |
| 31 | A Realistic Dataset and Baseline Temporal Model for Early Drowsiness Detection (UTA-RLDD) | Ghoddoosian, Galib, Athitsos | 2019 | CVPR Workshops 2019 | arXiv:1904.07312 | Özet | 60 kişi, yaklaşık 30 saat video (uyanık / düşük uyanıklık / uykulu); kırpma dizisi öznitelikleriyle HM-LSTM | Özette doğruluk sayısı yok; "insan yargısından yüksek". Wolter (#23) aynı veri için 3 sınıfta %52,5–65,2 ve 2 sınıfta %80,4 aktarıyor: **3 sınıflı uykululuk webcam'den zor.** |
| 32 | YawDD: A Yawning Detection Dataset | Abtahi, Omidyeganeh, Shirmohammadi, Hariri | 2014 | ACM MMSys 2014 | doi:10.1145/2557642.2563678 | Özet | Ayna altı (322 video) ve gösterge paneli (29 video) kamerası; normal, konuşma/şarkı, esneme | Kendi yöntemleri kamera gösterge panelindeyken "çok daha yüksek" doğruluk veriyor. **Kamera konumu esneme tespitini belirgin etkiliyor**; konuşma ve şarkı karıştırıcı sınıf olarak ayrıca var. |
| 33 | Differences in palpebral fissure height depending on patient's intraoperative head position | Nishioka, Kondoh, Yuzuriha | 2019 | JPRAS Open 20:81–86 | doi:10.1016/j.jpra.2019.03.001 | **Tam metin** | 60 kişi, baş nötr ve 30° öne eğik, kalibre fotoğraf | Toplam göz aralığı yüksekliği 0,82 cm'den 0,66 cm'ye, üst kısım 0,58 cm'den 0,36 cm'ye düştü (p<0,01). Bu, göz bakışının değil baş eğiminin etkisi. Ayrıca arama sonuçlarındaki nöro-oftalmoloji kaynağına göre aşağı bakışta göz aralığı yaklaşık 2 mm daralıyor (klinik referans, kontrollü ölçüm değil; okunmadı). |

**Makale dışı ama doğrulanmış kaynak:** HSEmotion/EmotiEffLib GitHub README (av-savchenko/face-emotion-recognition). `enet_b0_8_va_mtl` için AffectNet 8 sınıf %61,93, 7 sınıf %64,94. Kod **Apache-2.0** lisanslı. Ağırlıklar AffectNet ile eğitilmiş ve README AffectNet kullanım şartlarını belirtmiyor.

**Sayım:** 33 makale listelendi. Tam metin veya kısmi tam metin: 12 (#2, 8, 12, 13, 19, 21, 22, 23, 24, 25, 29, 33). Yalnızca özet veya kayıt: 21.

---

## 2. Sentez

### 2.1 Model gerçekte ne kadar iyi? (sistemin çekirdeği)
- DersNabzı'nın kullandığı ağ ailesi Aff-Wild2 doğrulamasında (gerçek dünya videosu) **CCC_V yaklaşık 0,43, CCC_A yaklaşık 0,50** ve ifade makro-F1 yaklaşık 0,38 veriyor (#2). Bu sonuçlar Aff-Wild2 üzerine eğitilmiş bir MLP ile alındı. Doğrudan AffectNet başlığının (`va_mtl`) çıktısı bundan daha iyi olmak zorunda değil.
- Kritik bulgu: aynı çalışmada **Korku F1 = 0,016**, Öfke 0,15, Şaşkınlık 0,30. Sahibinin nötr yüzünde gördüğü "%20–40 Üzüntü/Korku" bu bilinen zayıflıkla uyumlu. Model bu sınıflarda zaten neredeyse bilgi taşımıyor, dolayısıyla bu bir arıza değil, beklenen bir hata.
- Ticari sistemler de kendiliğinden ifadelerde %48–62 doğrulukta kalıyor; insanlar yaklaşık %72 (#12). Ders ortamındaki ifadeler büyük ölçüde kendiliğinden ve düşük yoğunluklu.
- Barrett ve ark. (#11): yüz hareketinden duygu çıkarımı güvenilirlik, özgüllük ve genellenebilirlik bakımından zayıf. Aynı yüz düzeni farklı anlamlara gelebiliyor ve bağlam şart. Teknoloji tarafına çıkan sonuç: tek bir öğrenci için "korkuyor" ya da "üzgün" gibi duygu etiketi göstermek bilimsel olarak savunulamaz.

### 2.2 Kişisel taban (baseline) yaklaşımı doğru yönde
- Baltrušaitis ve ark. (#8), "kişinin videodaki medyan özniteliği nötr yüzdür" varsayımıyla medyan çıkarmanın bazı AU'larda büyük kazanç sağladığını gösterdi. Aynı çalışma, nötrün çoğunlukta olmadığı veride bu yöntemin **zarar verebileceğini** de gösterdi. Gerekçeleri: bazı insanlar dinlenik yüzde bile "gülümser" ya da "kaşlarını çatar" görünür. Sahibinin dinlenik yüzünde valence'ın yaklaşık −0,2 okunması bunun tipik bir örneği.
- Kişiselleştirme, genel modelden daha iyi uyum veriyor (#20, ICC yaklaşık %60).
- Sonuç: mutlak valence yerine **kişisel tabana göre fark** kullanmak literatürle uyumlu. Ancak taban yalnızca öğrenci gerçekten nötr ve ekrana bakarken toplanmalı ve geçerliliği denetlenmeli.

### 2.3 Zamansal yumuşatma ve pencere
- Savchenko (#2): kare çıktılarını k=15 karelik (30 fps'de yaklaşık 0,5 sn) ortalama filtresiyle yumuşatmak tüm görevlerde metriği artırdı.
- Whitehill (#17): 10 sn'lik klibin katılım etiketi, karelerin ortalamasından r=0,85 ile kestirilebiliyor.
- 2 Hz örneklemde EMA tek başına kısa ölçekli gürültüyü bastırır. Öğretmene gidecek karar ise **10–30 sn'lik pencere özetleri** üzerinden verilmeli.

### 2.4 Sınıf ortamında kullanılabilirlik ve doğruluk tavanı
- Gerçek sınıfta, monitör üstü webcam ile örneklerin **%34–35'inde yüz kaydedilemedi** (#19). Yüz tabanlı AUC'ler kafa karışıklığı için 0,649, can sıkıntısı için 0,610 düzeyinde.
- Yazarlar müdahalelerin "fail-soft" olmasını, yani yanlış tespit zarar vermeyecek biçimde kurulmasını öneriyor. Log verisiyle füzyon kullanılabilirliği %98'e çıkarıyor. DersNabzı için bunun karşılığı Moodle etkinlik logları.
- DAiSEE durumları (#18) kitle etiketlemesine dayanıyor. "Kafa karışıklığı"nı yüzden ayırt etmek literatürde en zor görevlerden biri.

### 2.5 Kalibrasyon ve belirsizlik
- Derin ağların softmax olasılıkları kalibre değildir (#16). Sıcaklık ölçekleme etiketli doğrulama verisi gerektirir; DersNabzı'da bu veri yok.
- Bu yüzden model olasılıkları öğretmene "olasılık" ya da "%" olarak gösterilmemeli. Görüntülenecek şey, kişisel tabana göre sıra/yön bilgisi ve **veri kapsamı** (kaç örnek, yüzün yüzde kaç zaman görüldüğü) olmalı.

### 2.6 Adalet ve alan kayması
- RAF-DB yaklaşık %77 Beyaz yüz içeriyor (#13). AffectNet'te ırksal yanlılık ve cinsiyet stereotipleri var ve bunlar modele aktarılıyor (#14).
- Ticari API'ler Afro-Amerikan yüzlere daha olumsuz duygu puanı vermiş (#13'teki Rhue alıntısı).
- Kişisel taban, kayma (offset) türü yanlılığı büyük ölçüde giderir ama ölçek farkını (bazı yüzlerde sinyalin daha küçük oynaması) gidermez.
- Pozla ilgili doğrudan, kontrollü bir "kamera yüksekliği ve FER doğruluğu" çalışması bulamadım; bu bir kanıt boşluğu. Soukupová ve Čech (#21) ile Wolter (#23) 2D ölçümlerin düzlem dışı rotasyonda bozulduğunu gösteriyor.

### 2.7 Göz kapanması: kamera yukarıdayken neden yanlış "gözler kapalı" çıkıyor?
- Baş öne eğildiğinde göz aralığı yüksekliği yaklaşık %20, üst kısım yaklaşık %38 azalıyor (#33). Aşağı bakışta göz kapağı da iner (klinik referans).
- Ekranın üstündeki kamera, öğrencinin ekrana veya klavyeye bakışını "aşağı" olarak görür. 2D EAR bu durumda kapanma gibi düşer (#21, #23).
- MediaPipe blendshape modeli göz kırpmaya özel doğrulanmamış. Yazarlar katsayıların çoktan bire ve gürültülü olduğunu söylüyor (#24). eyeBlink ile eyeLookDown'ın birbirine karışması bu yüzden beklenen bir durum.
- Sabit EAR eşikleri kişiye ve videoya göre 0,21 ile 0,29 arasında değişiyor (#22). Kişiye özgü kalibrasyon gerekli ama tek noktalı kalibrasyon yetersiz.

### 2.8 PERCLOS, kırpma hızı, esneme: ne ölçüyorlar?
- PERCLOS uykululuğu (uyku başlangıcına yakın yavaş kapanmayı) ölçer; laboratuvarda en geçerli ölçü (#26, #25). Ancak orta düzey yorgunlukta ve **dikkat dağınıklığında duyarsız** kalabilir (#25).
- Standart tanım "%80'den fazla kapalı" ve 1 dakikalık penceredir. Kısa kırpmalar (yaklaşık 250–500 ms altı) çoğu çalışmada hariç tutulur (#25). Örnekleme hızı da önemli: 3 Hz'lik bir cihaz derlemede sınırlılık olarak anılıyor (#25), kare hızı uyumsuzluğu kapanma süresini %32 kaydırıyor (#23).
- Kırpma hızı katılımla düşer (#29) ve yorgunlukla artar (#30). İki yön birbirine zıt, bireysel taban 2–26/dk arasında değişiyor ve bireyler arası fark büyük (#28). Bu yüzden ham kırpma hızı tek başına "dikkat" ya da "yorgunluk" demek değildir.
- Esneme tespiti kamera konumuna duyarlı ve konuşmayla karışıyor (#32).

---

## 3. DersNabzı için somut, öncelikli iyileştirme önerileri

Efor ölçeği: **D** = düşük (saatler), **O** = orta (1–3 gün), **Y** = yüksek (veri toplama veya doğrulama gerekir).

### Öneri 1: Korku, Üzüntü, Öfke, İğrenme ve Küçümseme olasılıklarını durum kuralından ve öğretmen ekranından çıkarın (öncelik: çok yüksek, efor D)
- **Gerekçe:** Aynı model ailesinde Aff-Wild2 sınıf F1 değerleri Korku 0,016 ve Öfke 0,15 (#2). Korku ve iğrenme RAF-DB'de de en zayıf sınıflar (#13). Barrett ve ark. (#11) tek kişide duygu etiketinin savunulamayacağını gösteriyor. Sahibinin nötr yüzündeki "%20–40 Üzüntü/Korku" doğrudan bu hatanın görünür hali.
- **Uygulama:** Durum kestiriminde yalnızca şunları kullanın: kişisel tabana göre Δvalence ve Δarousal, Mutluluk ve Nötr olasılıkları. "Frustrated" durumunu ancak Δvalence belirgin negatif ve uzun süreli olduğunda üretin. Duygu adlarını öğretmene hiç göstermeyin.
- **"Yalan veri yok" ilkesi:** Bu adım gösterilen bilgiyi azaltır ama gösterileni daha dürüst yapar.

### Öneri 2: Şaşkınlık → "confused" eşlemesini kaldırın; kafa karışıklığını "düşük güvenli" ve davranış destekli yapın (öncelik: çok yüksek, efor D–O)
- **Gerekçe:** Şaşkınlık F1 0,30 (#2). Yüz tabanlı kafa karışıklığı AUC'si gerçek sınıfta 0,649 (#19). Şaşkınlık ifadesi kafa karışıklığına özgül değil (#11).
- **Uygulama:** "Confused" etiketini ya tamamen kaldırın ya da yalnızca Moodle sinyaliyle birlikte üretin, örneğin aynı anda quiz'de yanlış cevap veya uzun duraklama varsa. Bosch ve ark.'nın log füzyonu kullanılabilirliği %65'ten %98'e çıkardı (#19).
- **Teknik not:** AU4 (kaş indirme) gibi AU tabanlı bir kafa karışıklığı ipucu literatürde geçiyor ama bu taramada birincil kaynağından doğrulamadım; doğrulanmadan kurala eklemeyin.

### Öneri 3: Kişisel tabanı sağlamlaştırın: daha uzun, denetimli, ölçeği de kapsayan bir taban (öncelik: yüksek, efor O)
- **Gerekçe:** Medyan normalizasyonu ancak nötr yüz çoğunluktaysa işe yarıyor, aksi halde zarar veriyor (#8). Bireyler arası fark büyük (#20, #28).
- **Uygulama:**
  - **Taban penceresi:** Tabanı en az 60–120 sn'lik "ekrana bakıyor, yüz bulundu" örneklerinden toplayın. Ders boyunca yavaş güncellenen bir hareketli medyanla destekleyin (Baltrušaitis'in histogram yöntemi çevrimiçi çalışır).
  - **Taban geçerliliği:** Taban örneklerinin varyansı yüksekse ya da Mutluluk veya Şaşkınlık olasılığı tabanda baskınsa, tabanı "geçersiz, yeniden kalibre et" olarak işaretleyin.
  - **Ölçek:** Δ değerlerini kişisel yayılıma (MAD) bölün, yani z-benzeri bir değer kullanın. Bu, bazı yüzlerde sinyalin dar bir aralıkta oynaması sorununu (#13, #14) kısmen telafi eder.
  - **Logit uzayı:** Olasılık farkı yerine logit (log-odds) farkı kullanın. Böylece %2 ile %4 arasındaki değişim, %40 ile %42 arasındaki değişimle aynı ağırlıkta sayılmaz.
- **Etkisi:** Sahibinin valence ≈ −0,2'lik negatif kayması doğrudan sıfırlanır.

### Öneri 4: Öğretmene pencere özeti ve veri kapsamı gösterin; olasılık göstermeyin (öncelik: yüksek, efor D–O)
- **Gerekçe:** Softmax kalibre değil (#16). Yüzün görülme oranı gerçek sınıfta yaklaşık %65 (#19). 10 sn'lik ortalamalar güvenilir bir özet sunuyor (#17). Pencere yumuşatması metrikleri artırıyor (#2).
- **Uygulama:**
  - Her öğrenci ve sınıf için 30 sn'lik pencere özeti verin. 2 Hz'de bu yaklaşık 60 örnek demektir. Özeti üç düzeyli gösterin: "tabana göre belirgin düşük / tipik / belirgin yüksek".
  - Yanında her zaman **kapsam** bilgisi bulunsun, örneğin "yüz bu pencerede %X görüldü, N örnek".
  - Kapsam %50'nin altındaysa "yeterli veri yok" gösterin; değeri tahminle doldurmayın.
  - Tek bir öğrencide tek bir pencereden alarm üretmeyin. En az 2–3 ardışık pencerede tutarlı sinyal arayın; bu, "fail-soft" yaklaşımının (#19) karşılığıdır.

### Öneri 5: Aşağı bakış ile göz kapanmasını ayırın; belirsiz durumda "göz durumu bilinmiyor" deyin (öncelik: çok yüksek, efor O)
- **Gerekçe:** Baş öne eğilince göz aralığı yaklaşık %20 küçülüyor (#33). 2D ölçümler düzlem dışı rotasyonda bozuluyor (#21, #23). eyeBlink katsayısı göz kapanmasına özel doğrulanmamış ve gürültülü (#24).
- **Mevcut yaklaşımın sorunu:** Eşiği eyeLookDown arttıkça 0,55'ten 0,80'e kaldırmak mantıklı bir ara çözüm. Ancak bu, aşağı bakarken gerçekten kapanan gözü de kaçırır ve hangi durumda olduğunuzu bilmezsiniz.
- **Uygulama:**
  - **İki noktalı kalibrasyon:** (a) ekrana bakarken ve (b) klavyeye veya not kağıdına bakarken eyeBlink, eyeLookDown ve baş pitch'ini kaydedin. Kişiye özgü "aşağı bakış altında eyeBlink tabanı" çıkarın; bu, Dewi (#22) yaklaşımının kişiye ve poza uyarlanmış halidir.
  - **Belirsizlik bölgesi:** Baş pitch'i veya eyeLookDown kalibre edilen aşağı bakış düzeyinin ötesindeyse göz durumunu "bilinmiyor" olarak işaretleyin ve PERCLOS hesabına dahil etmeyin; kapanma saymayın. Kapsam bilgisini öğretmene gösterin.
  - **3D ölçü (orta vadede):** MediaPipe 3D noktalarından göz kapağı açısı (ELA, #23) hesaplanıp eyeBlink ile karşılaştırılabilir. #23 hakemsiz bir önbaskı olduğu için önce kendi kayıtlarınızla doğrulayın.

### Öneri 6: PERCLOS'u literatür tanımına hizalayın ve "enerji" adını yeniden düşünün (öncelik: yüksek, efor D)
- **Gerekçe:** Tanım "%80'den fazla kapalı" ve 1 dk penceredir (#25, #26). Çalışmaların çoğu kısa kırpmaları dışlar (#25). PERCLOS dikkat dağınıklığını ve orta düzey yorgunluğu kaçırabilir (#25).
- **Uygulama:**
  - "Kapalı" kararı kişisel taban ile tam kapanma arasının %80'i olsun.
  - 500 ms'den kısa kapanmaları PERCLOS'a saymayın; mevcut 0,6 sn kuralı bununla uyumlu.
  - Pencereyi 60 sn tutun.
  - Göz sinyalini 2 Hz'de değil, MediaPipe'ın kendi kare hızında (en az 15 Hz) örnekleyin; düşük örnekleme süreyi bozar (#23, #25).
  - Göstergeyi "enerji" yerine dürüst bir adla verin, örneğin "uzun göz kapanması oranı (son 60 sn)". "Enerji = 100 − f(PERCLOS)" biçimi ölçülmemiş bir kavramı ölçülmüş gibi sunar; ilk kural ("sahte/tahmini veri yok") ile çelişir.

### Öneri 7: Esnemeyi ayrı ve doğrulanmamış sinyal olarak tutun ya da kaldırın; kırpma hızını yalnızca deneysel trend olarak kullanın (öncelik: orta, efor D)
- **Gerekçe:** Esneme tespiti kamera konumuna duyarlı ve konuşma/şarkıyla karışıyor (#32); ders sırasında konuşma yaygın.
- **Kırpma hızı:** Katılımla düşer (#29), yorgunlukla artar (#30). Bireysel taban 2–26/dk ve bireyler arası fark büyük (#28, #29), yani tek yönlü bir yorum yanlış olur.
- **Uygulama:**
  - Esneme sayısını enerjiden düşmek yerine ayrı bir sayaç olarak, yalnızca ağız açıklığı ≥ 2–3 sn sürdüğünde ve konuşma yokken sayın. Mikrofon kullanılmıyorsa "doğrulanmamış" etiketi koyun.
  - Kırpma hızını öğretmene ancak "kişinin kendi tabanına göre 5 dk'lık trend" olarak, "deneysel" etiketiyle gösterin; ya da hiç göstermeyin.

### Öneri 8: Kendi küçük doğrulama setinizi oluşturun ve alt grup raporu çıkarın (öncelik: orta, efor Y)
- **Gerekçe:** Yanlılık veri kümesinden modele aktarılıyor (#13, #14, #15). Kamera yüksekliği ile FER doğruluğu arasındaki ilişki hakkında kontrollü bir çalışma bulamadım; bu bir kanıt boşluğu.
- **Uygulama:**
  - Gönüllü, açık rızalı 10–20 kişiyle 3 kamera konumunda (ekran üstü, ekran altı, laptop) ve gözlüklü/gözlüksüz kısa kayıtlar alın: nötr, gülümseme, ekrana ve klavyeye bakış, gerçek kapanma.
  - Kayıtlar KVKK kapsamında; yerel tutun ve amaç sınırlı kullanın.
  - Göz kapanması için yanlış alarm ve kaçırma oranlarını, valence tabanı için kayma değerlerini alt gruplara göre raporlayın.
  - Eşikleri (0,55/0,80, %80, 500 ms) bu veriyle ayarlayın. O zamana kadar arayüzde "eşikler henüz doğrulanmadı" notu yer alsın.

### Öneri 9: Öğretmen ekranını sınıf düzeyine çekin ve bireysel duygu raporunu kapatın (öncelik: yüksek, efor D)
- **Gerekçe:** Tek kişide duygu çıkarımı zayıf (#11, #12). Tespit doğruluğu orta düzeyde, bu yüzden yanlış tespit zarar vermemeli (#19). Bireyler arası fark büyük (#28, #29).
- **Uygulama:**
  - Varsayılan görünüm sınıf düzeyinde dağılım olsun, örneğin "son 2 dk'da tabanına göre belirgin düşük valence gösteren öğrenci oranı" ve bunun kaç öğrencinin verisine dayandığı.
  - Bireysel görünüm yalnızca öğrencinin kendi panelinde ve kendi tabanına göre olsun.

### Lisans notları
- **HSEmotion/EmotiEffLib kodu:** Apache-2.0. **Ağırlıklar** AffectNet ile eğitildi. AffectNet kullanım şartları araştırma ve eğitim amaçlı, ticari olmayan kullanımla sınırlı (görev tanımındaki bilgi; README bu şartları ayrıca belirtmiyor). Ticari olmayan üniversite kullanımı bu çerçeveye uyar. Ticarileştirme veya üçüncü tarafa lisanslama planı varsa AffectNet şartları yeniden incelenmeli.
- **OpenFace 2.0:** Yalnızca araştırma amaçlı ücretsiz, ticari kullanım CMU lisansı ister (#9). AU sinyali eklenecekse bunu dikkate alın.
- **LibreFace (#10):** Lisansını bu taramada doğrulamadım; kullanmadan önce depodaki lisansı kontrol edin.
- **DAiSEE, YawDD, UTA-RLDD:** Veri kümelerini eğitim veya doğrulama için indirmeden önce her birinin kendi kullanım şartlarını kontrol edin (YawDD IEEE DataPort'ta ücretsiz girişle sunuluyor; diğerlerinin şartlarını doğrulamadım).
- **MediaPipe:** Bu taramada lisans metnini açıp doğrulamadım; kullanılan sürümün lisansını depodan teyit edin.

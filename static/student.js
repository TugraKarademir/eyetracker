// Öğrenci tarafı
let gaze = null;
let CODE = null, SID = null, AD = null, analyzerHazir = false, analyzer = null, stream = null, es = null, paused = false, handUp = false, sendTimer = null;
const params = new URLSearchParams(location.search);
// Öğrenci yalnız bakışı kalibre eder ve etkileşir; ekran alanı, bakış noktası, duygu paneli ve el hareketi ayarları
// yalnız ?gelismis=1 ile görünür. Gizliyken el hareketi ve HSEmotion her zaman açık çalışır (onay metni kapsar).
const GELISMIS = params.get("gelismis") === "1";
// Test dönemi (kullanıcı kararı 25.11): bakış noktası, bakış testindeki gibi kırmızı halka olarak herkeste açık gelir; "Bakış noktamı göster"
// kutusu görünür, öğrenci kapatabilir. ?nokta=0 ile kapalı başlar ve kutu gizlenir.
const NOKTA = params.get("nokta") !== "0";
document.head.insertAdjacentHTML("beforeend", `<style>${GELISMIS ? ".basit" : ".gelismis"}{display:none!important}</style>`);
$("#jCode").value = (params.get("code") || "").toUpperCase();
// Önceki katılımlar: { [DERS]: { sid, ad } }. Ad önceden doldurulmaz (lab'da aynı bilgisayarı farklı kişiler kullanır);
// eski kimlik yalnız aynı ders ve AYNI ad girilirse yeniden kullanılır, yoksa sunucu yeni öğrenci açar.
const prev = store.get("dn_student") || {};
const adAyni = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLocaleLowerCase("tr") === b.trim().toLocaleLowerCase("tr");
function oncekiSid(code, name) {
  const k = prev[code];
  if (k && typeof k === "object") return adAyni(k.ad, name) ? k.sid : undefined;
  if (typeof k === "string") return adAyni(prev.name, name) ? k : undefined;   // eski biçim: { name, [DERS]: sid } (son girilen ad)
  return undefined;
}

const show = (id) => ["joinView", "consentView", "classView", "endView"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id));

$("#joinForm").onsubmit = async (e) => {
  e.preventDefault(); $("#jErr").textContent = "";
  const code = $("#jCode").value.trim().toUpperCase(), name = $("#jName").value.trim();
  try {
    // KVKK onayı (sınıf testi 25.11): onay kutusu işaretlenmeden form gönderilmez; sunucu onaysız katılımı reddeder
    const r = await api("/api/join", { code, name, sid: oncekiSid(code, name), onay: { surum: ONAY_SURUM, t: Date.now() / 1000 } });
    CODE = code; SID = r.sid; AD = name;
    const yeni = { ...prev, [code]: { sid: r.sid, ad: name } }; delete yeni.name;
    store.set("dn_student", yeni);
    ls.sahipAyarla?.({ ders: CODE, sid: SID });
    show("consentView");
  } catch (err) { $("#jErr").textContent = err.message; }
};

const ONAY_SURUM = "2026-11-25";   // katılım formundaki bilgilendirme metninin sürümü (metin değişirse artırın)
$("#agree").onchange = (e) => ($("#joinBtn").disabled = !e.target.checked);
$("#joinBtn").disabled = !$("#agree").checked;   // tarayıcı geri gelince kutuyu işaretli bırakmış olabilir

$("#camBtn").onclick = async () => {
  $("#cErr").textContent = "";
  $("#camBtn").disabled = true;
  try {
    // Bakış takibi için yüksek çözünürlük: 640x480'de iris birkaç piksel kalıyor, göz hareketi gürültüde kayboluyordu.
    // "ideal" olduğu için kamera desteklemezse en yakın çözünürlükle açılır.
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
    { const st = stream.getVideoTracks()[0]?.getSettings?.() || {}; console.log(`[KAMERA] açıldı: ${st.width}x${st.height} @ ${Math.round(st.frameRate || 0)} fps (istenen 1280x720)`, st); }
  } catch (err) {
    $("#cErr").textContent = "Kameraya erişilemedi: " + (err.name === "NotAllowedError" ? "izin reddedildi." : err.message) +
      (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1" ? " (Kamera yalnızca https veya localhost üzerinde çalışır.)" : "");
    $("#camBtn").disabled = false; return;
  }
  show("classView");
  $("#video").srcObject = stream;
  window.OlayGunlugu?.baslat({ yazilim: DERS_YAZILIM, track: stream.getVideoTracks()[0] });
  connect();
  startGaze();
  try {
    analyzer = new FocusAnalyzer($("#video"), { onUpdate: renderMe, getEyes: () => gaze?.face || null, getPose3: gazePose3, getProfile: () => (gaze?.report ? { ...(gaze.report.profil || {}), yuz: gaze.report.yuz || null } : null) });
    await analyzer.load((t) => ($("#vbadge").textContent = t));
    $("#vbadge").textContent = "Hazırlanıyor: ekrana bakın…";
    analyzerHazir = true;
    if (!kalCerceve) analyzer.start();   // bakış testi açıksa kapanınca başlar (iki MediaPipe aynı anda çalışmasın)
    sendTimer = setInterval(sendMetrics, 2000);
  } catch (err) {
    console.error(err);
    $("#vbadge").textContent = "Model yüklenemedi (internet bağlantısını kontrol edin)";
  }
};

$("#mAttBar").style.width = "0%"; $("#mEnBar").style.width = "0%";   // ilk değer gelene dek çubuklar boş
function renderMe(s) {
  $("#vbadge").textContent = s.calibrating ? (s.face ? "Hazırlanıyor: ekrana bakın…" : "Yüzünüz görünmüyor") :
    !s.face ? "Yüzünüz görünmüyor" : s.eyesClosed ? "Gözler kapalı" : s.lookingAway ? "Ekran dışına bakıyorsunuz" : "Analiz ediliyor ✓";
  const sayi = (v) => typeof v === "number" && Number.isFinite(v);   // değer yoksa "–" ve boş çubuk
  $("#mAtt").textContent = sayi(s.attention) ? s.attention : "–"; $("#mAttBar").style.width = sayi(s.attention) ? s.attention + "%" : "0%"; if (sayi(s.attention)) $("#mAttBar").style.background = levelColor(s.attention);
  $("#mEn").textContent = sayi(s.energy) ? s.energy : "–"; $("#mEnBar").style.width = sayi(s.energy) ? s.energy + "%" : "0%";
  meDuygu(s);
}
// Duygu satırı: HSEmotion ölçümü tazeyse onun en olası sınıfı, değilse yüz ifadesi kuralının sonucu
const HSE_IKON = { Anger: "😠", Contempt: "😒", Disgust: "🤢", Fear: "😨", Happiness: "😊", Neutral: "😐", Sadness: "😢", Surprise: "😮" };
function meDuygu(s = analyzer?.state) {
  const h = $("#hseChk").checked ? hse.top() : null;
  if (h) $("#mEmo").textContent = `${HSE_IKON[h.name] || "🧠"} ${h.tr} %${Math.round(100 * h.p)}`;
  else if (s) $("#mEmo").textContent = `${EMO[s.emotion].icon} ${EMO[s.emotion].label}`;
  // Sekiz HSEmotion duygusu (büyükten küçüğe); taze ölçüm yoksa son çubuklar soluk kalır
  const box = $("#meHse");
  if (!$("#hseChk").checked || !hse.probs) { box.innerHTML = ""; return; }
  box.style.opacity = h ? "" : "0.35";
  if (!h) return;
  box.innerHTML = hse.probs.map((p, i) => [p, HSE_CLASSES[i]]).sort((a, b) => b[0] - a[0]).map(([p, k]) =>
    `<div class="row" style="gap:6px;margin:2px 0;align-items:center"><span style="width:96px;white-space:nowrap">${HSE_IKON[k]} ${HSE_TR[k]}</span>` +
    `<div class="bar" style="flex:1;height:5px"><i style="width:${Math.round(100 * p)}%;transition:none"></i></div><b style="width:34px;text-align:right">%${Math.round(100 * p)}</b></div>`).join("");
}
setInterval(() => { if (analyzer && !paused) meDuygu(); }, 500);

async function sendMetrics() {
  if (paused) kareOnceki = null;   // duraklatma süresi işlenen kare/sn'yi düşürmesin
  // Bakış testi açıkken ya da analizör çalışmıyorken (model yükleniyor) ölçüm yok: kurucunun varsayılanları (dikkat 70, enerji 85) gönderilmez
  if (paused || !analyzer || kalCerceve || !analyzer.running) return;
  const s = analyzer.state;
  // Analizör yüzü görüp tabanını kurana dek (ilk 10 yüz karesi) dikkat/enerji kurucu varsayılanıdır (70/85): yüz olsa da olmasa da gönderilmez
  // (25.11: yavaş bilgisayarda yüz bulunmadan 70/85 gönderiliyordu). O karelerin ham ölçüsü de atılır.
  if (s.calibrating) { analyzer.hamAl?.(); return; }
  const g = gaze ? gaze.flush() : null;
  // Bakış kalibre ise "ekran dışı" kararı baş yönünden daha güvenilirdir
  const away = s.lookingAway || !!(g && (g.cal || g.coarse) && (g.share?.disari || 0) >= 0.6);
  const kal = kalYeni();
  const ht = $("#hseChk").checked ? hse.top() : null;   // HSEmotion: yalnız sınıf, oran ve valence/arousal (görüntü değil)
  let yedek = null;
  try {
    const kurulum = kurulumBilgi();
    // Ham ölçüler (yaw/pitch/EAR/MAR/kırpma/ifade/3B baş, ≈2 sn penceresi): analizör kare işlemediyse gönderilmez
    const ham = analyzer.hamAl ? analyzer.hamAl() : null;
    if (ham) { ham.islemeFps = sonIsleme.fps != null ? +sonIsleme.fps.toFixed(1) : null; ham.isciGecikmeMs = sonIsleme.gecikmeMs;
      const k = gaze?.kaymaBilgi?.(); if (k) ham.bakisKayma = k;   // seçilen modele uygulanan ders tıklaması kayma düzeltmesi (ekran px)
      const bf = window.BakisOlcum?.basFark(gaze?.report?.basRef, ham.pose3); if (bf) ham.basFark = bf; }   // kalibrasyondaki baş pozuna göre fark
    tiklamaHatalariGonder(ham?.pose3 || null);
    const govde = { code: CODE, sid: SID, attention: s.attention, energy: s.energy, emotion: s.emotion,
      face: s.face, lookingAway: away, eyesClosed: s.eyesClosed, tabHidden: document.hidden, gaze: g, ekran: ekranBilgi(), kurulum, ...kal,
      hse: ht ? { top: ht.name, p: ht.p, valence: hse.valence, arousal: hse.arousal } : null, ...(ham ? { ham } : {}) };
    const t = Date.now();
    // Yerel yedek (bellekte): gönderilen gövdenin aynısı + gönderim zamanı + sunucu yanıtı (başarısız gönderim de kalır)
    yedek = { t, govde, sunucu: null };
    if (window.DNYedek) DERS_YEDEK.push(yedek);
    await api("/api/metrics", govde);
    yedek.sunucu = "ok";
    if (kal.kal) sonKalAt = kal.kal.at;   // yalnız başarılı gönderimden sonra: başarısızsa rapor bir sonrakinde yeniden gider
  } catch (err) {
    if (yedek) yedek.sunucu = "hata: " + String(err?.message || err).slice(0, 200);
    if (/aktif değil/.test(err.message)) finish();
  }
}
// Bakış modülünün son karesindeki 3B baş pozu (ham ölçü toplayıcısı için; aynı kare iki kez sayılmaz)
function gazePose3() {
  const L = gaze?.latest, p = L?.pose3;
  return p ? { t: L.t, yaw: p.yaw, pitch: p.pitch, roll: p.roll, dist: p.dist } : null;
}
// Kalıcı kayıt için kurulum özeti (sunucu doğrular/kırpar) ve yalnız yeni kalibrasyon raporu
let sonKalAt = null;
function kalYeni() {
  const r = gaze?.report;
  if (!r || r.at == null || r.at === sonKalAt) return {};
  // Yedek gönderilen hali tutsun: raporun kendisi sonradan değişebilir, bu yüzden kopya
  let kopya;
  try { kopya = structuredClone(r); } catch { try { kopya = JSON.parse(JSON.stringify(r)); } catch { kopya = r; } }
  return { kal: kopya };
}
// Gerçek işlenen kare/sn: iki gönderim arasında işlenen kare (diag.kare) / geçen duvar saati.
// İşçi gecikmesi: aynı aralıkta kare yakalama → işçi sonucu ortalaması (yalnız işçi yolunda).
let kareOnceki = null, sonIsleme = { fps: null, gecikmeMs: null };   // sonIsleme: son ölçümün yuvarlanmamış hâli (ham ölçüler)
function islemeOlcu(d) {
  const t = performance.now(), o = kareOnceki;
  kareOnceki = d ? { t, kare: d.kare, gMs: d.gecikmeMs, gN: d.gecikmeN } : null;
  if (!d || !o || t - o.t < 500) return { fps: null, gecikmeMs: null };
  const dN = d.gecikmeN - o.gN;
  return { fps: (1000 * (d.kare - o.kare)) / (t - o.t),
           gecikmeMs: d.isci && dN > 0 ? Math.round((d.gecikmeMs - o.gMs) / dN / 10) * 10 : null };
}
function kurulumBilgi() {
  const st = $("#video").srcObject?.getVideoTracks?.()[0]?.getSettings?.() || {};
  const m = (navigator.userAgent.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/) || []);
  const ad = { Edg: "Edge", OPR: "Opera", Version: "Safari" }[m[1]] || m[1];
  const d = gaze?.diag, { fps, gecikmeMs } = (sonIsleme = islemeOlcu(d));
  const dist = gaze?.latest?.pose3?.dist;
  return { kamera: st.width ? `${st.width}x${st.height}` : null, fps: st.frameRate ? Math.round(st.frameRate) : null,
    ekran: `${screen.width}x${screen.height}`, pencere: `${innerWidth}x${innerHeight}`, dpr: +(devicePixelRatio || 1).toFixed(2),
    fs: !!document.fullscreenElement, tarayici: ad ? `${ad} ${m[2]}` : "", uzaklikCm: Number.isFinite(dist) ? Math.round(dist) : null, islemeFps: fps != null ? Math.round(fps / 5) * 5 : null,
    isci: d ? !!d.isci : null, gecikmeMs, cihaz2: cihaz2(), ...(CIHAZ_TAM ? { cihazTam: CIHAZ_TAM } : {}) };
}
// Tam cihaz bilgisi (cihaz.js): bakış modeli yüklenince bir kez toplanır, sonra kurulum kaydına eklenir (sunucu temizler ve özetler).
let CIHAZ_TAM = null;
function cihazTamBaslat() {
  if (CIHAZ_TAM || typeof cihazTamTopla !== "function") return;
  try {
    cihazTamTopla({ track: $("#video").srcObject?.getVideoTracks?.()[0] || null, delegate: gaze?.diag?.delegate, isci: gaze?.diag?.isci })
      .then((c) => { CIHAZ_TAM = c; }, (e) => console.warn("cihaz bilgisi", e));
  } catch (e) { console.warn("cihaz bilgisi", e); }
}
// Cihaz bilgisi (sınıf testi): tarayıcının verdiği kadarı, vermediği null (uydurma yok). GPU adı WebGL'den bir kez okunur.
let _gpuAdi;
function gpuAdi() {
  if (_gpuAdi !== undefined) return _gpuAdi;
  _gpuAdi = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl"), x = gl?.getExtension("WEBGL_debug_renderer_info");
    if (x) _gpuAdi = gl.getParameter(x.UNMASKED_RENDERER_WEBGL) ?? null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  return _gpuAdi;
}
function cihaz2() {
  const u = navigator.userAgentData;
  return { cekirdek: navigator.hardwareConcurrency ?? null, bellekGB: navigator.deviceMemory ?? null, gpu: gpuAdi(), ua: navigator.userAgent,
           uaVeri: u ? { brands: (u.brands || []).map((b) => ({ brand: b.brand, version: b.version })), platform: u.platform ?? null, mobile: u.mobile ?? null } : null };
}
// Tarayıcı / ekran boyutu: öğretmene gider ve değiştikçe konsola yazılır ([PENCERE ...], window.pencereLog)
function ekranBilgi() {
  return { sw: screen.width, sh: screen.height, vw: innerWidth, vh: innerHeight, dpr: +(devicePixelRatio || 1).toFixed(2),
           fs: !!document.fullscreenElement, mobil: matchMedia("(pointer: coarse)").matches };
}
let sonEkran = "";
function ekranKaydet() {
  const e = ekranBilgi(), k = JSON.stringify(e);
  if (k === sonEkran) return; sonEkran = k;
  const row = { t: new Date().toLocaleTimeString("tr-TR"), ...e };
  (window.pencereLog ||= []).push(row);
  console.log(`[PENCERE ${row.t}] tarayıcı ${e.vw}x${e.vh} | ekran ${e.sw}x${e.sh} | ölçek ${e.dpr}${e.fs ? " | tam ekran" : ""}${e.mobil ? " | dokunmatik/mobil" : ""}`, row);
}
addEventListener("resize", ekranKaydet); document.addEventListener("fullscreenchange", ekranKaydet); ekranKaydet();
document.addEventListener("visibilitychange", () => { if (analyzer) { analyzer.state.tabHidden = document.hidden; if (document.hidden) { analyzer.att = 0; analyzer.state.attention = 0; } sendMetrics(); } });

$("#pauseBtn").onclick = () => {
  paused = !paused;
  $("#pauseBtn").textContent = paused ? "Devam et" : "Duraklat";
  gaze?.pause(paused);
  if (paused) { govdeDet?.setEnabled(false); analyzer?.stop(); stream?.getVideoTracks().forEach((t) => (t.enabled = false)); $("#vbadge").textContent = "Duraklatıldı"; }
  else { stream?.getVideoTracks().forEach((t) => (t.enabled = true)); analyzer?.start(); govdeAc(); }
};
// Ekran alanı kalibrasyonu: ortaya ve kenarlara bakılarak baş yönü aralığı ölçülür (büyük ekranlar için)
$("#recalBtn").onclick = () => { if (typeof ls !== "undefined") ls.resetBase(); if (analyzer) analyzer.calibrateScreen(); };

function connect() {
  es = new EventSource(`/api/stream?role=student&code=${CODE}&sid=${SID}`);
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    // Ekrana gelen içerik türü (bakışı çeken olaylar): yalnız tür (ve sohbette yazanın rolü); metin ALINMAZ
    if (m.type !== "signal") window.OlayGunlugu?.ekle("icerik", m.type === "chat" ? ["chat", m.msg?.role ?? null] : m.type === "live" ? ["live", m.on ? 1 : 0] : [m.type]);
    if (m.type === "welcome") {
      $("#clsTitle").textContent = m.cls.name; document.title = m.cls.name + " — DersNabzı";
      setTopic(m.cls.topic); $("#msgs").innerHTML = ""; m.chat.forEach(addChat);
      if (m.announce) setAnnounce(m.announce); setHand(m.hand);
      if (m.cls.ended) return finish();
      window.LIVE?.setLive(m.cls.live);
    } else if (m.type === "live") { window.LIVE?.setLive(m.on); if (m.on) toast("🎥 Öğretmen canlı yayını başlattı");
    } else if (m.type === "signal") { window.LIVE?.onSignal(m.data);
    } else if (m.type === "topic") { setTopic(m.topic); toast("Yeni konu: " + (m.topic || "—")); }
    else if (m.type === "announce") { setAnnounce(m.announce); toast("📢 " + m.announce.text, 6000); }
    else if (m.type === "chat") addChat(m.msg);
    else if (m.type === "hand_lowered") { setHand(false); toast("Öğretmen elinizi indirdi"); }
    else if (m.type === "ended") finish();
  };
}

const setTopic = (t) => ($("#topic").textContent = t || "—");
function setAnnounce(a) { $("#annCard").classList.toggle("hidden", !a?.text); $("#annText").textContent = a?.text || ""; }
function setHand(up) { handUp = up; $("#handBtn").classList.toggle("hand-on", up); $("#handBtn").querySelector("span").textContent = up ? "Eli indir" : "Söz iste"; }
function addChat(m) {
  const d = document.createElement("div"); d.className = "msg " + m.role;
  d.innerHTML = `<b>${esc(m.name)} · ${fmtTime(m.t)}</b>${esc(m.text)}`;
  const box = $("#msgs"); box.append(d); box.scrollTop = box.scrollHeight;
}

const ev = (body) => api("/api/event", { code: CODE, sid: SID, ...body }).catch((err) => toast(err.message));
$("#handBtn").onclick = () => { setHand(!handUp); ev({ type: "hand", up: handUp }); };
document.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { ev({ type: "reaction", emoji: b.dataset.r }); floatEmoji(b.dataset.r); }));
$("#chatForm").onsubmit = (e) => { e.preventDefault(); const v = $("#chatIn").value.trim(); if (v) { ev({ type: "chat", text: v }); $("#chatIn").value = ""; } };

// Yerel yedek: bu öğrencinin gönderilen ders ölçümleri ({t, govde, sunucu}; bellekte, localStorage yok). Ders bitince bir kez
// iki dosya iner: düzleştirilmiş CSV ve gövdelerin kayıpsız JSON'u; "Ders verimi indir" düğmesi ikisini yeniden indirir.
const DERS_YEDEK = [];

// ================================================================ ders sırasında kare kare veri ve olay günlüğü (kullanıcı kararı 25.11.2026)
// Her MediaPipe karesi (kare_kayit.js biçimi) + o karenin bakış tahmini; olaylar (olay_gunlugu.js). ~10 sn'de bir /api/ders-veri ile
// gönderilir; sunucu test_kayitlari/ders_kare/ ve ders_olay/ altına yazar. Göz kesiti (re, kare başına ~1600 sayı) yalnız ?kare=tam ile.
// ?kare=0 kare kaydını kapatır (olaylar yine gider). Yerel yedeğe girmez (bellek). Gönderilemeyen kare en çok DERS_KARE.EN_COK tutulur.
const DERS_YAZILIM = { sayfa: "student", mediapipe: typeof MP_BASE !== "undefined" ? MP_BASE : null, model: typeof MP_MODEL !== "undefined" ? MP_MODEL : null, kareSurum: 2 };
// Beden verisi (el noktaları ve gövde duruşu, ~3-5/sn): ayrı tampon, aynı gönderim turunda /api/ders-veri "beden" alanıyla → ders_beden/
const DERS_BEDEN = { satirlar: [], EN_COK: 20000, tasma: 0 };
function bedenEkle(r) { if (paused || kalCerceve || bitiyor) return; if (DERS_BEDEN.satirlar.length >= DERS_BEDEN.EN_COK) { DERS_BEDEN.satirlar.shift(); DERS_BEDEN.tasma++; } DERS_BEDEN.satirlar.push(r); }
const DERS_KARE = { acik: params.get("kare") !== "0", tam: params.get("kare") === "tam", kareler: [], bsAd: null, tasma: 0, gonderilen: 0, hata: 0, suruyor: null };
// Bellekte bekleyen en çok kare (gönderilemezse en eskisi atılır, tasma sayılır) ve tek istekteki en çok kare (sunucu sınırı 8 MB):
// hafif satır ~1,4 KB, göz kesitli (tam) ~10 KB
DERS_KARE.EN_COK = DERS_KARE.tam ? 3000 : 12000; DERS_KARE.PARTI = DERS_KARE.tam ? 300 : 1500;
function dersKareBagla() {
  if (!gaze || !DERS_KARE.acik || !window.KareKayit) return;
  gaze.onKare = (l, tah) => {
    if (paused || kalCerceve || bitiyor) return;
    if (l.bs && !DERS_KARE.bsAd) DERS_KARE.bsAd = Object.keys(l.bs);
    const o = gaze._off?.();
    const r = KareKayit.satir(l, DERS_KARE.bsAd, { off: o ? [Math.round(o.x), Math.round(o.y)] : null,
      g: tah ? [Math.round(tah.p[0]), Math.round(tah.p[1])] : null, gs: tah ? (tah.s ? 1 : 0) : null }, { re: DERS_KARE.tam });
    if (DERS_KARE.kareler.length >= DERS_KARE.EN_COK) { DERS_KARE.kareler.shift(); DERS_KARE.tasma++; }   // gönderim sürerken tampon ayrı dizidir
    DERS_KARE.kareler.push(r); DERS_KALITE?.ekle(r);
  };
}
// Tek gönderim turu: önce olaylar (ayrı istek: kare partisi sorun çıkarsa olaylar takılmasın), sonra kareler PARTI'lik istekler hâlinde.
// Gönderilecek kareler tampondan ALINIR (yeni kareler boş tampona düşer); gönderilemeyenler tamponun başına geri konur.
// Aynı anda tek tur (DERS_KARE.suruyor = sürmekte olan tur); ders sonu bunu bekleyip son turu yapar. Döner: hepsi gitti mi.
function dersVeriGonder() {
  if (DERS_KARE.suruyor) return DERS_KARE.suruyor;
  if (!CODE || !SID) return Promise.resolve(true);
  DERS_KARE.suruyor = (async () => {
    let tamam = true;
    const O = window.OlayGunlugu?.bekleyen(5000) || [];
    if (O.length) {
      try { await api("/api/ders-veri", { code: CODE, sid: SID, olaylar: O }); window.OlayGunlugu.onayla(O.length); }
      catch { tamam = false; }
    }
    let Bd = DERS_BEDEN.satirlar; DERS_BEDEN.satirlar = [];
    if (Bd.length) {
      try { while (Bd.length) { const P = Bd.slice(0, 3000); await api("/api/ders-veri", { code: CODE, sid: SID, beden: P }); Bd = Bd.slice(P.length); } }
      catch { tamam = false; }
      if (Bd.length) { const T = Bd.concat(DERS_BEDEN.satirlar), f = Math.max(0, T.length - DERS_BEDEN.EN_COK); DERS_BEDEN.tasma += f; DERS_BEDEN.satirlar = f ? T.slice(f) : T; }
    }
    let K = DERS_KARE.kareler; DERS_KARE.kareler = [];
    const baslik = { bsAd: DERS_KARE.bsAd, timeOrigin: Math.round(performance.timeOrigin), ekran: [screen.width, screen.height], pencere: [innerWidth, innerHeight],
      dpr: devicePixelRatio, yazilim: DERS_YAZILIM, tasma: DERS_KARE.tasma, gozluk: gaze?.report?.gozluk ?? null,
      model: gaze?.secim?.kod || (gaze?.model ? "biz" : null), kayma: gaze?.kaymaBilgi?.() || null };
    try {
      while (K.length) {
        const P = K.slice(0, DERS_KARE.PARTI);
        await api("/api/ders-veri", { code: CODE, sid: SID, baslik, kareler: P });
        K = K.slice(P.length); DERS_KARE.gonderilen += P.length;
      }
    } catch { tamam = false; DERS_KARE.hata++; }
    if (K.length) {   // gönderilemeyenler geri (eski önce); sınır aşılırsa en eskiler atılır
      const B = K.concat(DERS_KARE.kareler), fazla = Math.max(0, B.length - DERS_KARE.EN_COK);
      DERS_KARE.tasma += fazla; DERS_KARE.kareler = fazla ? B.slice(fazla) : B;
    }
    return tamam;
  })().finally(() => { DERS_KARE.suruyor = null; });
  return DERS_KARE.suruyor;
}
setInterval(dersVeriGonder, 10000);
// Kare akışı kalitesi: dakikada bir olay ("kalite": kare, yüzsüz %, kareler arası süre ort/sapma/en çok, işlenmeden geçen kamera karesi)
const DERS_KALITE = window.KareKayit?.kaliteSayaci?.() || null;
setInterval(() => { if (DERS_KALITE && !paused) { const q = DERS_KALITE.al(true); if (q.kare) window.OlayGunlugu?.ekle("kalite", q); } }, 60000);
// Ekran yerleşimi: bölge kutuları (bakışın düştüğü materyal/konu/duyuru/etkileşim/sohbet/kamera alanları), öğretmen görüntüsünün
// çözünürlüğü ve tiyatro modu. Saniyede bir bakılır, değişince olay ("yerlesim") yazılır.
let sonYerlesim = "";
setInterval(() => {
  if (!window.OlayGunlugu || !CODE) return;
  try {
    const v = $("#teacherVideo"), y = { bolge: gazeRegions().map((r) => [r.name, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h),
      ...(r.content ? [Math.round(r.content.x), Math.round(r.content.y), Math.round(r.content.w), Math.round(r.content.h)] : [])]),
      ogretmenVideo: v?.videoWidth ? [v.videoWidth, v.videoHeight] : null, tiyatro: document.body.classList.contains("theater") ? 1 : 0 };
    const k = JSON.stringify(y); if (k !== sonYerlesim) { sonYerlesim = k; OlayGunlugu.ekle("yerlesim", y); }
  } catch {}
}, 1000);
let dersYedekIndi = false;
function dersYedekIndir() {
  if (!window.DNYedek) return false;
  const tarih = new Date();
  let ok = true;
  try {
    const olcumSatir = BO ? DERS_YEDEK.filter((k) => k.olcum).flatMap((k) => k.olcum.map((o) => ({ sunucu: k.sunucu ?? "bekliyor", ...BO.duzlestir(o) }))) : [];
    DNYedek.indir(DNYedek.csvMetni([{ baslik: `Ders ölçümleri (${CODE || "-"})`, rows: DNYedek.dersCsvSatirlari(DERS_YEDEK) },
      ...(olcumSatir.length ? [{ baslik: "Bakış kontrolleri ve tıklama hataları", rows: olcumSatir }] : [])]),
      DNYedek.dosyaAdi(CODE, AD, tarih, "ders.csv"), "text/csv;charset=utf-8");
  } catch (e) { console.warn("ders yedeği (csv)", e); ok = false; }
  try {
    DNYedek.indir(DNYedek.dersJson(DERS_YEDEK), DNYedek.dosyaAdi(CODE, AD, tarih, "ders.json"), "application/json;charset=utf-8");
  } catch (e) { console.warn("ders yedeği (json)", e); ok = false; }
  return ok;
}
$("#dersYedekBtn").onclick = () => dersYedekIndir();
let bitiyor = false;
async function finish() {
  if (bitiyor) return; bitiyor = true;
  clearInterval(sendTimer); es?.close(); window.LIVE?.setLive(false); analyzer?.stop();
  try { tiklamaHatalariGonder(null); await dersSonuKontrolu(); } catch (e) { console.warn("ders sonu kontrolü", e); }
  // son kare/olay partisi: sürmekte olan tur bitsin, sonra kalan gönderilsin (başarısız turda en çok 2 yeniden deneme)
  try { if (DERS_KARE.suruyor) await DERS_KARE.suruyor; for (let i = 0; i < 3; i++) if (await dersVeriGonder()) break; }
  catch (e) { console.warn("ders verisi son gönderim", e); }
  if (!dersYedekIndi && DERS_YEDEK.length) { dersYedekIndi = true; dersYedekIndir(); }
  gaze?.pause(true); gaze?.setShowDot(false);
  stream?.getTracks().forEach((t) => t.stop());
  show("endView");
}

// ================================================================ ders sırasında bakış hatası ölçümü (static/bakis_olcum.js)
// Kalibrasyondaki sonuçla karşılaştırmak için: ders içi kontrol noktası (her OLCUM_DK dakikada bir), ders sonu 5 nokta, tıklama hataları.
// ?kontrol=<dakika> aralığı değiştirir, ?kontrol=0 ders içi noktayı kapatır. Sonuçlar sunucuda test_kayitlari/ders_olcum/ altında
// ve yerel ders yedeğinde. Ölçüm modeli değiştirmez.
const BO = window.BakisOlcum || null;   // eski önbellekte betik yoksa ölçüm kapalı, ders sayfası yine çalışır
const OLCUM_DK = (() => { if (!BO) return 0; const v = params.get("kontrol"); return v == null ? BO.O.ARALIK_DK : Math.max(0, +v || 0); })();
let olcumSuruyor = false, olcumSonraki = null, olcumSira = 0;
const bakisHazir = () => !!(BO && gaze?.model && gaze.tracking && !gaze.stale && !gaze.calibrating);
function olcumGonder(L) {
  if (!L?.length) return;
  const y = { t: Date.now(), olcum: L, sunucu: null };
  DERS_YEDEK.push(y);
  api("/api/olcum", { code: CODE, sid: SID, olcum: L }).then(() => { y.sunucu = "ok"; }, (e) => { y.sunucu = "hata: " + String(e?.message || e).slice(0, 200); });
}
function tiklamaHatalariGonder(poz) {
  const L = gaze?.tikAl?.() || [];
  if (!BO || !L.length) return;
  const ref = gaze?.report?.basRef;
  olcumGonder(L.map((o) => ({ tur: "tiklama", ...o, basFark: BO.basFark(ref, poz) })));
}
setInterval(async () => {
  if (!OLCUM_DK || olcumSuruyor || bitiyor || !bakisHazir() || kalCerceve || paused || document.hidden) { if (!bakisHazir()) olcumSonraki = null; return; }
  const now = Date.now();
  if (olcumSonraki == null) { olcumSonraki = now + Math.min(1, OLCUM_DK) * 60000; return; }   // ilk nokta kalibrasyondan 1 dk sonra (kayma erken düzelsin), sonra her OLCUM_DK dk
  if (now < olcumSonraki) return;
  olcumSuruyor = true;
  try {
    const N = BO.O.NOKTA, q = N[olcumSira++ % N.length];
    const L = await BO.kontrol(gaze, [q], "ders_ici", () => "👀 Kısa bakış kontrolü: bu noktaya bakın");
    // Kullanıcı kararı 25.11: ölçüm (düzeltmeden ÖNCE alındı) aynı zamanda kaymayı düzeltir: hedef − seçilen modelin düzeltmesiz ortalaması
    for (const m of L) {
      const sec = m.secim;
      if (sec?.ort && sec.n >= 5) m.kaymaSonra = gaze.kaymaNoktadan(m.hedef[0] - sec.ort[0], m.hedef[1] - sec.ort[1]);
    }
    olcumGonder(L);
  } catch (e) { console.warn("ders içi kontrol", e); }
  finally { olcumSuruyor = false; olcumSonraki = Date.now() + OLCUM_DK * 60000; }
}, 5000);
async function dersSonuKontrolu() {
  while (olcumSuruyor) await new Promise((r) => setTimeout(r, 200));   // süren ders içi nokta bitsin
  if (!bakisHazir() || !stream || paused) return;
  const N = BO.O.SON;
  const basla = await BO.sonKart(`<b>Ders sona erdi.</b><br>Son olarak kısa bir bakış kontrolü: ekranda ${N.length} sarı nokta sırayla çıkacak.
    Her birine <b>küçülene kadar bakın</b>. Tıklamayın. (yaklaşık ${Math.round(N.length * (BO.O.SETTLE + BO.O.COLLECT) / 1000)} sn)`);
  if (!basla) { olcumGonder([{ tur: "ders_sonu_atlandi", t: Date.now() }]); return; }
  const L = await BO.kontrol(gaze, N, "ders_sonu", (i, n) => `Sadece bakın, tıklamayın<br><span style="font-size:12px;opacity:.8">nokta ${i + 1}/${n}</span>`);
  olcumGonder(L);
  await new Promise((r) => setTimeout(r, 800));   // son gönderim yedeğe "ok" yazabilsin
}

// ================================================================ bakış takibi
function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }

// Öğrenci ekranındaki ilgi alanları (viewport CSS px). Materyal: öğretmen yayınının
// gerçek görüntü alanı (object-fit: contain kenar boşlukları hariç) -> u,v ısı haritası.
function gazeRegions() {
  const out = [];
  const tv = rectOf($("#tv")), v = $("#teacherVideo");
  const ar = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
  let cw = tv.w, ch = cw / ar;
  if (ch > tv.h) { ch = tv.h; cw = ch * ar; }
  out.push({ name: "materyal", ...tv, content: { x: tv.x + (tv.w - cw) / 2, y: tv.y + (tv.h - ch) / 2, w: cw, h: ch } });
  if (document.body.classList.contains("theater")) return out;
  const add = (name, el) => { if (!el) return; const r = rectOf(el); if (r.w > 0 && r.h > 0) out.push({ name, ...r }); };
  add("konu", $(".card.topic"));
  add("duyuru", $("#annCard"));
  add("etkilesim", $("#handBtn").closest(".card"));
  add("etkilesim", $("#floorCard"));
  add("sohbet", $("#classView .chat"));
  add("kamera", $(".self-col"));
  return out;
}

function gazeStatus(s) {
  const st = $("#gazeStatus");
  $("#gazeBanner").classList.toggle("hidden", s !== "stale");
  if (s === "ok" && gaze?.report) {
    const r = gaze.report;
    st.innerHTML = !GELISMIS ? `<span style="color:var(--good)">● Aktif</span>`
      : gaze.coarse
      ? `<span style="color:var(--warn)">● Kaba mod</span> · isabet %${r.hit3} düşük: yalnız "ekrana bakıyor mu" kullanılıyor, bölge gönderilmiyor`
      : `<span style="color:var(--good)">● Aktif</span> · hata ~${r.acc} px · 3×3 isabet %${r.hit3}<br><span class="small">model: ${esc(gaze.secim?.ad || "bizim (ana model)")}</span>`;
    $("#gazeCalBtn").textContent = "👁️ Bakışı yeniden kalibre et";
  } else if (s === "stale") {
    st.innerHTML = '<span style="color:var(--warn)">● Duraklatıldı</span> · ekran değişti, yeniden kalibre edin';
  } else if (s === "blocked") {
    st.innerHTML = `<span style="color:var(--warn)">● Durduruldu</span> · ${esc(gaze?.blocked || "")}`;
  } else st.textContent = s;
}

async function startGaze() {
  gaze = new GazeTracker($("#video"), { getRegions: gazeRegions, onStatus: gazeStatus });
  gaze.sahip = { ders: CODE, sid: SID };   // kayıtlı kalibrasyon yalnız bu ders + bu öğrenciye aitse yüklenir
  if (NOKTA) {
    gaze.setShowDot(true); gaze.dot.classList.add("test-nokta"); gaze.dot.style.transform = "translate(-100px, -100px)";   // kalibrasyondan önce ekran dışında
    const k = $("#gazeDotChk"); k.checked = true; k.closest("label")?.classList.remove("gelismis");
  }
  try {
    await gaze.load();
    dersKareBagla();
    cihazTamBaslat();
    // Sınıf testi: katılınca bakış testi zorunlu; bu derste bu tarayıcıda tamamlanmışsa (sayfa yenilendi) yeniden açılmaz
    if (!store.get(BAKIS_TAMAM())) bakisTestiAc();
    else if (!gaze.model) toast("👁️ Bakış takibi için bakış testini tamamlayın (≈2 dk); soldaki “Bakışı kalibre et” düğmesiyle yeniden başlatabilirsiniz.", 7000);
  } catch (e) {
    console.error(e);
    gazeStatus("Bakış modeli yüklenemedi (internet bağlantısını kontrol edin)");
  }
}

setInterval(() => {
  if (!gaze || !gaze.tracking || gaze.stale) { $("#gazeRegion").textContent = ""; return; }
  const r = gaze.region;
  // Kaba modda (isabet düşük) bölge yok; yalnızca "ekranda / ekran dışı"
  const a = AOI[r] || (r === "ekranda" ? { icon: "🖥️", label: "Ekranda (kaba mod: bölge ayırt edilemiyor)" } : null);
  $("#gazeRegion").textContent = gaze.blocked ? "" : a ? `${a.icon} Şu an: ${a.label}` : "Yüzünüz görünmüyor";
}, 500);

// Bakış kalibrasyonu = bakış testi (bakis_test.html, ?gomulu=1) tam ekran çerçevede. O sürede bu sayfanın yüz, el ve duygu işlemesi
// durur (iki MediaPipe aynı anda çalışıp kare hızını düşürmesin). Test, aktarım kuralıyla seçtiği modeli aynı tarayıcı deposuna
// yazar (gaze.save); "Derse dön" (postMessage) ile çerçeve kapanınca model buraya yüklenir.
let kalCerceve = null;
const BAKIS_TAMAM = () => `dn_bakis_tamam_${CODE}_${SID}`;   // bu derste BU öğrenci bakış testini tamamladı (kalibrasyon kaydedildi)
// Bakış testi kaydı derse bağlansın: ders kodu ve sid adreste, ad yalnız aynı kökenli çerçevenin okuduğu bu nesnede (adreste ad yok)
window.dnBaglam = () => ({ ders: CODE, sid: SID, ad: AD });
function bakisTestiAc() {
  if (kalCerceve || !gaze?.ready) return;
  gaze.pause(true); analyzer?.stop(); handDet.setEnabled(false); hse.setEnabled(false); govdeDet?.setEnabled(false);
  const f = kalCerceve = document.createElement("iframe");
  f.src = `/bakis_test.html?gomulu=1&ders=${encodeURIComponent(CODE || "")}&sid=${encodeURIComponent(SID || "")}`; f.allow = "camera; fullscreen; autoplay"; f.allowFullscreen = true; f.title = "Bakış kalibrasyonu";
  Object.assign(f.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", border: "0", zIndex: "9999", background: "#0f141b" });
  document.body.append(f);
}
function bakisTestiKapat() {
  if (!kalCerceve) return;
  kalCerceve.remove(); kalCerceve = null;
  if (!paused) { gaze.pause(false); if (analyzerHazir) analyzer?.start(); }
  // El ve duygu kutuları açıksa yeniden başlar (test açıkken kamera hazır olunca başlatılmamış olabilirler)
  if ($("#autoHandChk").checked && stream) handDet.setEnabled(true).catch(() => {});
  govdeAc();
  if ($("#hseChk").checked && stream) hse.setEnabled(true).catch(() => {});
  if (gaze.restore()) { store.set(BAKIS_TAMAM(), true); gazeStatus("ok"); toast(GELISMIS ? `👁️ Kalibrasyon yüklendi: ${gaze.secim?.ad || "ana model"}` : "👁️ Bakış kalibrasyonu tamam", 5000); }
  else toast("Kalibrasyon kaydedilmedi; tekrar deneyebilirsiniz.", 5000);
}
addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.tip === "bakis-testi-kapat") bakisTestiKapat(); });
$("#gazeCalBtn").onclick = bakisTestiAc;
$("#gazeRecalBtn").onclick = bakisTestiAc;
$("#gazeFsBtn").onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});
$("#gazeDotChk").onchange = (e) => gaze?.setShowDot(e.target.checked);
// Tam ekrana dönüldüğünde / pencere eski boyutuna gelince kayıtlı kalibrasyonu tekrar kullan
const regaze = () => { if (gaze && gaze.ready && !gaze.model && gaze.restore()) gazeStatus("ok"); };
addEventListener("resize", regaze);
// Bakış test sayfasında (bakis_test.html) tıklayarak yapılan kalibrasyon kaydedilince bu sekme onu hemen kullanır
addEventListener("storage", (e) => {
  if (!e.key || !e.key.startsWith("dn_gaze_v2_") || !gaze || !gaze.ready || kalCerceve) return;   // çerçevedeki test: kapanınca yüklenir
  if (gaze.restore()) { gazeStatus("ok"); toast("👁️ Test sayfasındaki tıklamalı kalibrasyon yüklendi.", 4000); }
});
document.addEventListener("fullscreenchange", regaze);

// ================================================================ el kaldırınca söz iste
const handDet = new HandRaiseDetector($("#video"), {
  onSonuc: (o) => bedenEkle({ tur: "el", ...o }),
  getFace: () => gaze?.face || null,
  onRaise: () => {
    if (handUp || !SID) return;
    setHand(true); ev({ type: "hand", up: true });
    toast("✋ Elinizi 3 sn kaldırdınız: söz istendi. Geri almak için “Eli indir”e basın.", 5000);
  },
  onThumb: () => {
    if (!SID) return;
    ev({ type: "reaction", emoji: "👍" }); floatEmoji("👍");
    toast("👍 Başparmak işaretiniz “Anladım” olarak gönderildi.", 3000);
  },
});
(() => {
  const chk = $("#autoHandChk"), key = "dn_auto_hand";
  chk.checked = GELISMIS ? store.get(key) ?? true : true;
  const apply = async () => {
    store.set(key, chk.checked);
    if (!chk.checked) { $("#handStatus").textContent = ""; return handDet.setEnabled(false); }
    if (!stream || kalCerceve) return;                     // kamera açılınca tekrar çağrılır; bakış testi açıksa kapanınca başlar
    $("#handStatus").textContent = "El modeli yükleniyor…";
    try { await handDet.setEnabled(true); }
    catch (e) { console.error(e); $("#handStatus").textContent = "El modeli yüklenemedi"; }
  };
  chk.onchange = apply;
  // Kamera açıldıktan sonra başlat
  const wait = setInterval(() => { if (stream && $("#video").readyState >= 2) { clearInterval(wait); apply(); govdeAc(); } }, 500);
  setInterval(() => {
    if (!chk.checked || !handDet.ready || !handDet.enabled) return;
    const i = handDet.info;
    const bas = i.thumbHold > 0 && !handDet.thumbLatched ? `👍 Anladım ${Math.min(i.thumbHold, HAND_CFG.THUMB_HOLD).toFixed(1)} / ${HAND_CFG.THUMB_HOLD} sn` : "";
    if (!GELISMIS) { $("#handStatus").textContent = i.up ? `✋ El kaldırıldı ${Math.min(i.hold, HAND_CFG.HOLD).toFixed(1)} / ${HAND_CFG.HOLD} sn` : bas; return; }
    if (bas) { $("#handStatus").textContent = bas; return; }
    $("#handStatus").textContent = !i.hand ? "El görünmüyor" :
      i.up ? `El kaldırıldı ${Math.min(i.hold, HAND_CFG.HOLD).toFixed(1)} / ${HAND_CFG.HOLD} sn` :
      `El görüldü (${i.gesture || "?"} %${Math.round(100 * i.score)}) · avucunuzu açıp parmaklarınız göz hizasının üstünde kalacak şekilde tutun`;
  }, 200);
})();

// ================================================================ gövde duruşu (beden.js; yalnız kayıt). ?govde=0 kapatır.
const govdeDet = typeof GovdeDurusu === "function" && params.get("govde") !== "0" ? new GovdeDurusu($("#video"), {
  onSonuc: (o) => bedenEkle({ tur: "govde", ...o }),
  onKapandi: (k) => { window.OlayGunlugu?.ekle("govde", { kapandi: k }); console.warn("[GÖVDE] yavaş cihaz, kapatıldı", k); },
}) : null;
async function govdeAc() {
  if (!govdeDet || !stream || kalCerceve || paused) return;
  try { await govdeDet.setEnabled(true); if (govdeDet.enabled) window.OlayGunlugu?.ekle("govde", { acildi: govdeDet.delegate || null }); }
  catch (e) { console.warn("gövde modeli yüklenemedi", e); window.OlayGunlugu?.ekle("govde", { hata: String(e?.message || e).slice(0, 160) }); }
}

// ================================================================ HSEmotion (8 duygu + valence/arousal)
// Bu sayfada gösterilir, konsola [HS …] satırı yazar; öğretmene en olası sınıf, oranı ve valence/arousal gider (sendMetrics).
const hse = new HSEmotionProbe($("#video"), { getFace: () => gaze?.face || null, isOccluded: () => handDet.occluding(),
  getBaseline: () => gaze?.report?.yuz?.notr?.duygu?.hse || null });
(() => {
  const chk = $("#hseChk"), key = "dn_hse";
  chk.checked = GELISMIS ? store.get(key) ?? true : true;
  const apply = async () => {
    store.set(key, chk.checked);
    if (!chk.checked) { hse.setEnabled(false); $("#hseBars").innerHTML = ""; return; }
    if (!stream || kalCerceve) return;   // bakış testi açıksa kapanınca başlar
    try { await hse.setEnabled(true); } catch (e) { console.error(e); hse.status = "yüklenemedi: " + e.message; }
  };
  chk.onchange = apply;
  const wait = setInterval(() => { if (stream && $("#video").readyState >= 2) { clearInterval(wait); apply(); } }, 500);
  const bar = (label, v, txt, color) => `<div style="margin:4px 0"><div class="row" style="justify-content:space-between"><span>${label}</span><b>${txt}</b></div>
    <div class="bar"><i style="width:${Math.round(100 * Math.max(0, Math.min(1, v)))}%;transition:none${color ? ";background:" + color : ""}"></i></div></div>`;
  setInterval(() => {
    $("#hseStatus").textContent = `Durum: ${hse.status}${hse.ms != null ? ` · ${hse.ms} ms/kare` : ""}${HSEmotionProbe.fromCache === false ? " · model ilk kez indirildi" : ""}`;
    // Taze ölçüm yoksa (el yüzü örtüyor / yüz yok) son çubuklar soluk gösterilir: canlı değer gibi görünmesin
    $("#hseBars").style.opacity = hse.fresh() ? "" : "0.35";
    if (!chk.checked || !hse.fresh()) return;
    const order = hse.probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
    $("#hseBars").innerHTML =
      bar("Valence (olumsuz → olumlu)", (hse.valence + 1) / 2, hse.valence.toFixed(2), "var(--c-en)") +
      bar("Arousal (sakin → uyarılmış)", (hse.arousal + 1) / 2, hse.arousal.toFixed(2), "var(--warn)") +
      order.map(([p, i]) => bar(HSE_TR[HSE_CLASSES[i]], p, "%" + Math.round(100 * p))).join("");
  }, 300);
  // Konsol: saniyede bir satır, eski yöntemle (face-api) yan yana
  window.hsLog = [];
  setInterval(() => {
    if (!chk.checked || !hse.fresh() || paused) return;
    const s = analyzer?.state, top = hse.top();
    const ilk3 = hse.probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([p, i]) => `${HSE_TR[HSE_CLASSES[i]]} %${Math.round(100 * p)}`).join(", ");
    const row = { t: new Date().toLocaleTimeString("tr-TR"), hs: top.name, valence: +hse.valence.toFixed(2), arousal: +hse.arousal.toFixed(2),
      olasiliklar: Object.fromEntries(HSE_CLASSES.map((c, i) => [c, +hse.probs[i].toFixed(2)])), eskiFaceapi: s?.face ? s.emotion : null, ms: hse.ms, notrTabanli: hse.tabanli };
    hsLog.push(row); if (hsLog.length > 3600) hsLog.shift();
    console.log(`[HS ${row.t}] ${ilk3}${hse.tabanli ? " (nötr tabana göre)" : " (nötr taban yok)"} | valence ${row.valence} arousal ${row.arousal} | eski face-api=${row.eskiFaceapi} | ${hse.ms} ms`, row);
  }, 1000);
})();

// ================================================================ DENEYSEL: ders durumu (DAiSEE benzeri)
// HSEmotion (valence, arousal, 8 duygu) + dikkat, enerji, ekran dışı bakış -> ilgili / sıkılmış / kafası karışık / hayal kırıklığı.
// Kural tabanlıdır, eğitilmiş bir model değildir. Yalnızca bu sayfada gösterilir; öğretmene gitmez.
// Konsol:  dsIsaret("sıkılmış") -> o andan itibaren satırlar bu "gerçek durum" etiketiyle kaydedilir; dsIsaret() kaldırır
//          dsOzet()  -> etiket bazında tahmin dağılımı ve ortalama skorlar;  copy(dsCsv()) -> CSV panoya
const ls = new LearningStateEstimator();
window.dsLog = [];
let dsAktif = null;
window.dsIsaret = (ad) => { dsAktif = ad || null; console.log(`%c[DS] etiket: ${dsAktif ?? "(yok)"}`, "font-weight:bold;color:#0a7"); };
const lsInputs = () => {
  const s = analyzer?.state;
  if (!s || !hse.fresh()) return null;
  return { valence: hse.valence, arousal: hse.arousal, probs: Object.fromEntries(HSE_CLASSES.map((c, i) => [c, hse.probs[i]])),
           attention: s.attention, energy: s.energy, lookingAway: !!s.lookingAway, eyesClosed: !!s.eyesClosed };
};
// x null ise (el yüzü örtüyor / yüz yok) tahminci durumu korur, tabanı güncellemez
setInterval(() => { if (!paused) ls.update(lsInputs(), performance.now() / 1000); }, 500);
setInterval(() => {
  if (!$("#hseChk").checked || (!hse.fresh() && !ls.stale)) { $("#lsState").textContent = "–"; $("#lsBars").innerHTML = ""; return; }
  const st = LS_STATES[ls.state];
  const durum = st ? `${st.icon} <b>${st.label}</b>` :
    `<span class="muted">Belirsiz (${ls.baseReady ? "hiçbir durum yeterince güçlü değil" : "kalibre ediliyor"})</span>`;
  const alt = ls.baseReady
    ? `Kişisel dinlenme seviyesi: valence ${ls.base.valence.toFixed(2)} ±${ls.base.madV.toFixed(2)}, arousal ${ls.base.arousal.toFixed(2)} ±${ls.base.madA.toFixed(2)} (${ls.base.n} örnek)`
    : `Kalibre ediliyor: ${ls.base.n}/${LS_CFG.BASE_MIN} dinlenme örneği (~60 sn ekrana normal, nötr yüzle bakın)`;
  $("#lsState").innerHTML = durum + `<div class="small muted">${alt}</div>` +
    `<div class="small muted">Deneysel, doğrulanmamış tahmin · ${ls.reason}</div>`;
  $("#lsBars").innerHTML = Object.entries(LS_STATES).map(([k, d]) => {
    const v = Math.round(100 * ls.slow[k]);
    return `<div style="margin:4px 0"><div class="row" style="justify-content:space-between"><span>${d.icon} ${d.label}</span><b>${v}</b></div>
      <div class="bar"><i style="width:${v}%;transition:none;background:${d.color}"></i></div></div>`;
  }).join("");
}, 300);
setInterval(() => {
  const x = lsInputs();
  if (!x || paused || !$("#hseChk").checked) return;
  const r2 = (v) => +v.toFixed(2);
  const row = { t: new Date().toLocaleTimeString("tr-TR"), isaret: dsAktif, durum: ls.state,
    skor: Object.fromEntries(Object.entries(ls.slow).map(([k, v]) => [k, r2(v)])),
    valence: r2(x.valence), arousal: r2(x.arousal), tabanV: r2(ls.base.valence), tabanA: r2(ls.base.arousal), tabanHazir: ls.baseReady,
    tabanMadV: ls.base.madV == null ? null : r2(ls.base.madV), tabanMadA: ls.base.madA == null ? null : r2(ls.base.madA), tabanN: ls.base.n,
    zV: ls.z.v == null ? null : r2(ls.z.v), zA: ls.z.a == null ? null : r2(ls.z.a), neden: ls.reason, dikkat: x.attention, enerji: x.energy, ekranDisi: x.lookingAway, gozKapali: x.eyesClosed,
    hsIlk: hse.top()?.name, eskiFaceapi: analyzer?.state?.face ? analyzer.state.emotion : null };
  dsLog.push(row); if (dsLog.length > 3600) dsLog.shift();
  const sk = row.skor;
  console.log(`[DS ${row.t}]${row.isaret ? ` <${row.isaret}>` : ""} durum=${row.durum} | ilgili ${sk.ilgili} sıkılmış ${sk.sikilmis} karışık ${sk.kafa_karisik} hayalKır ${sk.hayal_kirikligi} | V ${row.valence} (taban ${row.tabanHazir ? `${row.tabanV}±${row.tabanMadV}` : "kalibre"}) A ${row.arousal} (taban ${row.tabanHazir ? `${row.tabanA}±${row.tabanMadA}` : "…"}) n=${row.tabanN}/${LS_CFG.BASE_MIN}${row.tabanHazir ? ` z10sn V ${row.zV} A ${row.zA}` : ""} | dikkat ${row.dikkat} enerji ${row.enerji}${row.ekranDisi ? " ekranDışı" : ""}${row.gozKapali ? " gözKapalı" : ""} | HS=${row.hsIlk}`, row);
}, 1000);
window.dsOzet = () => {
  const pct = (n, m) => (m ? Math.round((100 * n) / m) + "%" : "-");
  const ort = (rows, f) => +(rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(2);
  const g = {}; dsLog.forEach((r) => (g[r.isaret || "(etiketsiz)"] ||= []).push(r));
  const tablo = {};
  for (const [k, rows] of Object.entries(g)) {
    const say = {}; rows.forEach((r) => (say[r.durum] = (say[r.durum] || 0) + 1));
    tablo[k] = { sn: rows.length, "tahmin dağılımı": Object.entries(say).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${pct(n, rows.length)}`).join(", "),
      "ort ilgili": ort(rows, (r) => r.skor.ilgili), "ort sıkılmış": ort(rows, (r) => r.skor.sikilmis), "ort karışık": ort(rows, (r) => r.skor.kafa_karisik),
      "ort hayalKır": ort(rows, (r) => r.skor.hayal_kirikligi), "ort V": ort(rows, (r) => r.valence), "ort A": ort(rows, (r) => r.arousal), "taban V/A (son)": `${rows.at(-1).tabanV}/${rows.at(-1).tabanA}`, "ort dikkat": ort(rows, (r) => r.dikkat) };
  }
  console.table(tablo);
};
window.dsCsv = () => {
  const cols = ["t", "isaret", "durum", "valence", "arousal", "tabanV", "tabanA", "tabanMadV", "tabanMadA", "tabanN", "zV", "zA", "dikkat", "enerji", "ekranDisi", "gozKapali", "hsIlk", "eskiFaceapi"], sk = Object.keys(LS_STATES);
  return [[...cols, ...sk.map((k) => "skor_" + k)].join(","), ...dsLog.map((r) => [...cols.map((k) => r[k] ?? ""), ...sk.map((k) => r.skor[k])].join(","))].join("\n");
};

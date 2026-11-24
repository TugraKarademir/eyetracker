// Öğrenci tarafı
let gaze = null;
let CODE = null, SID = null, analyzer = null, stream = null, es = null, paused = false, handUp = false, sendTimer = null;
const params = new URLSearchParams(location.search);
$("#jCode").value = (params.get("code") || "").toUpperCase();
const prev = store.get("dn_student") || {};
if (prev.name) $("#jName").value = prev.name;
if (prev.pcode) $("#jPcode").value = prev.pcode;

const show = (id) => ["joinView", "consentView", "classView", "endView"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id));

$("#joinForm").onsubmit = async (e) => {
  e.preventDefault(); $("#jErr").textContent = "";
  const code = $("#jCode").value.trim().toUpperCase(), name = $("#jName").value.trim(), pcode = $("#jPcode").value.trim().toUpperCase();
  try {
    const r = await api("/api/join", { code, name, pcode, sid: prev[code] });
    CODE = code; SID = r.sid;
    store.set("dn_student", { ...prev, name, pcode, [code]: r.sid });
    $("#jWarn").textContent = r.kodBilinmiyor ? "Bu katılımcı kodu tanımlı değil — araştırmacıya danışın. Ders kaydı yine alınacak." : "";
    show("consentView");
  } catch (err) { $("#jErr").textContent = err.message; }
};

$("#agree").onchange = (e) => ($("#camBtn").disabled = !e.target.checked);

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
  connect();
  startGaze();
  try {
    analyzer = new FocusAnalyzer($("#video"), { onUpdate: renderMe, getEyes: () => gaze?.face || null, getProfile: () => (gaze?.report ? { ...(gaze.report.profil || {}), yuz: gaze.report.yuz || null } : null) });
    await analyzer.load((t) => ($("#vbadge").textContent = t));
    $("#vbadge").textContent = "Kalibrasyon: ekrana bakın…";
    analyzer.start();
    sendTimer = setInterval(sendMetrics, 2000);
  } catch (err) {
    console.error(err);
    $("#vbadge").textContent = "Model yüklenemedi (internet bağlantısını kontrol edin)";
  }
};

function renderMe(s) {
  $("#vbadge").textContent = s.calibrating ? (s.face ? "Kalibrasyon: ekrana bakın…" : "Yüzünüz görünmüyor") :
    !s.face ? "Yüzünüz görünmüyor" : s.eyesClosed ? "Gözler kapalı" : s.lookingAway ? "Ekran dışına bakıyorsunuz" : "Analiz ediliyor ✓";
  $("#mAtt").textContent = s.attention; $("#mAttBar").style.width = s.attention + "%"; $("#mAttBar").style.background = levelColor(s.attention);
  $("#mEn").textContent = s.energy; $("#mEnBar").style.width = s.energy + "%";
  $("#mEmo").textContent = `${EMO[s.emotion].icon} ${EMO[s.emotion].label}`;
}

async function sendMetrics() {
  if (paused) kareOnceki = null;   // duraklatma süresi işlenen kare/sn'yi düşürmesin
  if (paused || !analyzer) return;
  const s = analyzer.state;
  if (s.calibrating && s.face) return;   // kalibrasyon bitmeden gönderme
  const g = gaze ? gaze.flush() : null;
  // Bakış kalibre ise "ekran dışı" kararı baş yönünden daha güvenilirdir
  const away = s.lookingAway || !!(g && (g.cal || g.coarse) && (g.share?.disari || 0) >= 0.6);
  const kal = kalYeni();
  try {
    await api("/api/metrics", { code: CODE, sid: SID, attention: s.attention, energy: s.energy, emotion: s.emotion,
      face: s.face, lookingAway: away, eyesClosed: s.eyesClosed, tabHidden: document.hidden, gaze: g, ekran: ekranBilgi(), kurulum: kurulumBilgi(), ...kal });
    if (kal.kal) sonKalAt = kal.kal.at;   // yalnız başarılı gönderimden sonra: başarısızsa rapor bir sonrakinde yeniden gider
  } catch (err) { if (/aktif değil/.test(err.message)) finish(); }
}
// Kalıcı kayıt için kurulum özeti (sunucu doğrular/kırpar) ve yalnız yeni kalibrasyon raporu
let sonKalAt = null;
function kalYeni() {
  const r = gaze?.report;
  if (!r || r.at == null || r.at === sonKalAt) return {};
  return { kal: r };
}
// Gerçek işlenen kare/sn: iki gönderim arasında işlenen kare (diag.kare) / geçen duvar saati.
// İşçi gecikmesi: aynı aralıkta kare yakalama → işçi sonucu ortalaması (yalnız işçi yolunda).
let kareOnceki = null;
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
  const d = gaze?.diag, { fps, gecikmeMs } = islemeOlcu(d);
  const dist = gaze?.latest?.pose3?.dist;
  return { kamera: st.width ? `${st.width}x${st.height}` : null, fps: st.frameRate ? Math.round(st.frameRate) : null,
    ekran: `${screen.width}x${screen.height}`, pencere: `${innerWidth}x${innerHeight}`, dpr: +(devicePixelRatio || 1).toFixed(2),
    fs: !!document.fullscreenElement, tarayici: ad ? `${ad} ${m[2]}` : "", uzaklikCm: Number.isFinite(dist) ? Math.round(dist) : null, islemeFps: fps != null ? Math.round(fps / 5) * 5 : null,
    isci: d ? !!d.isci : null, gecikmeMs };
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
  if (paused) { analyzer?.stop(); stream?.getVideoTracks().forEach((t) => (t.enabled = false)); $("#vbadge").textContent = "Duraklatıldı"; }
  else { stream?.getVideoTracks().forEach((t) => (t.enabled = true)); analyzer?.start(); }
};
// Ekran alanı kalibrasyonu: ortaya ve kenarlara bakılarak baş yönü aralığı ölçülür (büyük ekranlar için)
$("#recalBtn").onclick = () => { if (typeof ls !== "undefined") ls.resetBase(); if (analyzer) analyzer.calibrateScreen(); };

function connect() {
  es = new EventSource(`/api/stream?role=student&code=${CODE}&sid=${SID}`);
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
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

function finish() {
  gaze?.pause(true); gaze?.setShowDot(false);
  analyzer?.stop(); clearInterval(sendTimer); es?.close(); window.LIVE?.setLive(false);
  stream?.getTracks().forEach((t) => t.stop());
  show("endView");
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
    st.innerHTML = gaze.coarse
      ? `<span style="color:var(--warn)">● Kaba mod</span> · isabet %${r.hit3} düşük: yalnız "ekrana bakıyor mu" kullanılıyor, bölge gönderilmiyor`
      : `<span style="color:var(--good)">● Aktif</span> · hata ~${r.acc} px · 3×3 isabet %${r.hit3}`;
    $("#gazeCalBtn").textContent = "👁️ Bakışı yeniden kalibre et";
  } else if (s === "stale") {
    st.innerHTML = '<span style="color:var(--warn)">● Duraklatıldı</span> · ekran değişti, yeniden kalibre edin';
  } else if (s === "blocked") {
    st.innerHTML = `<span style="color:var(--warn)">● Durduruldu</span> · ${esc(gaze?.blocked || "")}`;
  } else st.textContent = s;
}

async function startGaze() {
  gaze = new GazeTracker($("#video"), { getRegions: gazeRegions, onStatus: gazeStatus });
  try {
    await gaze.load();
    if (!gaze.model) toast("👁️ Bakış takibini açmak için soldaki “Kalibre et” düğmesine basın (≈40 sn).", 7000);
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
  $("#gazeRegion").textContent = gaze.blocked ? "" : a ? `${a.icon} Şu an: ${a.label}` : "Yüz algılanmıyor";
}, 500);

$("#gazeCalBtn").onclick = () => gaze?.calibrate();
$("#gazeCalYeniBtn").onclick = () => gaze?.calibrateYeni();
$("#gazeRecalBtn").onclick = () => gaze?.calibrate();
$("#gazeFsBtn").onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});
$("#gazeDotChk").onchange = (e) => gaze?.setShowDot(e.target.checked);
// Tam ekrana dönüldüğünde / pencere eski boyutuna gelince kayıtlı kalibrasyonu tekrar kullan
const regaze = () => { if (gaze && gaze.ready && !gaze.model && gaze.restore()) gazeStatus("ok"); };
addEventListener("resize", regaze);
// Bakış test sayfasında (bakis_test.html) tıklayarak yapılan kalibrasyon kaydedilince bu sekme onu hemen kullanır
addEventListener("storage", (e) => {
  if (!e.key || !e.key.startsWith("dn_gaze_v2_") || !gaze || !gaze.ready) return;
  if (gaze.restore()) { gazeStatus("ok"); toast("👁️ Test sayfasındaki tıklamalı kalibrasyon yüklendi.", 4000); }
});
document.addEventListener("fullscreenchange", regaze);

// ================================================================ el kaldırınca söz iste
const handDet = new HandRaiseDetector($("#video"), {
  getFace: () => gaze?.face || null,
  onRaise: () => {
    if (handUp || !SID) return;
    setHand(true); ev({ type: "hand", up: true });
    toast("✋ Elinizi 3 sn kaldırdınız: söz istendi. Geri almak için “Eli indir”e basın.", 5000);
  },
});
(() => {
  const chk = $("#autoHandChk"), key = "dn_auto_hand";
  chk.checked = store.get(key) ?? true;
  const apply = async () => {
    store.set(key, chk.checked);
    if (!chk.checked) { $("#handStatus").textContent = ""; return handDet.setEnabled(false); }
    if (!stream) return;                                   // kamera açılınca tekrar çağrılır
    $("#handStatus").textContent = "El modeli yükleniyor…";
    try { await handDet.setEnabled(true); }
    catch (e) { console.error(e); $("#handStatus").textContent = "El modeli yüklenemedi"; }
  };
  chk.onchange = apply;
  // Kamera açıldıktan sonra başlat
  const wait = setInterval(() => { if (stream && $("#video").readyState >= 2) { clearInterval(wait); apply(); } }, 500);
  setInterval(() => {
    if (!chk.checked || !handDet.ready || !handDet.enabled) return;
    const i = handDet.info;
    $("#handStatus").textContent = !i.hand ? "El görünmüyor" :
      i.up ? `El kaldırıldı ${Math.min(i.hold, HAND_CFG.HOLD).toFixed(1)} / ${HAND_CFG.HOLD} sn` :
      `El görüldü (${i.gesture || "?"} %${Math.round(100 * i.score)}) · avucunuzu açıp parmaklarınız göz hizasının üstünde kalacak şekilde tutun`;
  }, 200);
})();

// ================================================================ TEST: HSEmotion (8 duygu + valence/arousal)
// Yalnızca bu sayfada gösterilir ve konsola [HS …] satırı yazar; sunucuya/öğretmene gönderilmez.
const hse = new HSEmotionProbe($("#video"), { getFace: () => gaze?.face || null, isOccluded: () => handDet.occluding(),
  getBaseline: () => gaze?.report?.yuz?.notr?.duygu?.hse || null });
(() => {
  const chk = $("#hseChk"), key = "dn_hse";
  chk.checked = store.get(key) ?? true;
  const apply = async () => {
    store.set(key, chk.checked);
    if (!chk.checked) { hse.setEnabled(false); $("#hseBars").innerHTML = ""; return; }
    if (!stream) return;
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

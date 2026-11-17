// Öğrenci tarafı
let CODE = null, SID = null, analyzer = null, stream = null, es = null, paused = false, handUp = false, sendTimer = null;
const params = new URLSearchParams(location.search);
$("#jCode").value = (params.get("code") || "").toUpperCase();
const prev = store.get("dn_student") || {};
if (prev.name) $("#jName").value = prev.name;

const show = (id) => ["joinView", "consentView", "classView", "endView"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id));

$("#joinForm").onsubmit = async (e) => {
  e.preventDefault(); $("#jErr").textContent = "";
  const code = $("#jCode").value.trim().toUpperCase(), name = $("#jName").value.trim();
  try {
    const r = await api("/api/join", { code, name, sid: prev[code] });
    CODE = code; SID = r.sid;
    store.set("dn_student", { ...prev, name, [code]: r.sid });
    show("consentView");
  } catch (err) { $("#jErr").textContent = err.message; }
};

$("#agree").onchange = (e) => ($("#camBtn").disabled = !e.target.checked);

$("#camBtn").onclick = async () => {
  $("#cErr").textContent = "";
  $("#camBtn").disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
  } catch (err) {
    $("#cErr").textContent = "Kameraya erişilemedi: " + (err.name === "NotAllowedError" ? "izin reddedildi." : err.message) +
      (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1" ? " (Kamera yalnızca https veya localhost üzerinde çalışır.)" : "");
    $("#camBtn").disabled = false; return;
  }
  show("classView");
  $("#video").srcObject = stream;
  connect();
  try {
    analyzer = new FocusAnalyzer($("#video"), { onUpdate: renderMe });
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
  if (paused || !analyzer) return;
  const s = analyzer.state;
  if (s.calibrating && s.face) return;   // kalibrasyon bitmeden gönderme
  try {
    await api("/api/metrics", { code: CODE, sid: SID, attention: s.attention, energy: s.energy, emotion: s.emotion,
      face: s.face, lookingAway: s.lookingAway, eyesClosed: s.eyesClosed, tabHidden: document.hidden });
  } catch (err) { if (/aktif değil/.test(err.message)) finish(); }
}
document.addEventListener("visibilitychange", () => { if (analyzer) { analyzer.state.tabHidden = document.hidden; if (document.hidden) { analyzer.att = 0; analyzer.state.attention = 0; } sendMetrics(); } });

$("#pauseBtn").onclick = () => {
  paused = !paused;
  $("#pauseBtn").textContent = paused ? "Devam et" : "Duraklat";
  if (paused) { analyzer?.stop(); stream?.getVideoTracks().forEach((t) => (t.enabled = false)); $("#vbadge").textContent = "Duraklatıldı"; }
  else { stream?.getVideoTracks().forEach((t) => (t.enabled = true)); analyzer?.start(); }
};
$("#recalBtn").onclick = () => { analyzer?.recalibrate(); toast("Ekrana düz bakın, kalibrasyon yapılıyor…", 2500); };

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
  analyzer?.stop(); clearInterval(sendTimer); es?.close(); window.LIVE?.setLive(false);
  stream?.getTracks().forEach((t) => t.stop());
  show("endView");
}

// Öğretmen paneli
let CODE = null, KEY = null, es = null, lastState = null;

const params = new URLSearchParams(location.search);
const saved = store.get("dn_teacher") || {};

function showRecent() {
  const items = Object.entries(saved).sort((a, b) => b[1].t - a[1].t).slice(0, 4);
  if (!items.length) return;
  $("#recent").innerHTML = "Son dersleriniz: " + items.map(([c, v]) =>
    `<a href="/teacher.html?code=${c}">${esc(v.name)} (${c})</a> · <a href="/report.html?code=${c}">rapor</a>`).join("<br>");
}

$("#createForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#cErr").textContent = "";
  try {
    const r = await api("/api/class", { name: $("#cName").value, topic: $("#cTopic").value });
    saved[r.code] = { key: r.key, name: $("#cName").value, t: Date.now() };
    store.set("dn_teacher", saved);
    history.replaceState(null, "", "?code=" + r.code);
    start(r.code, r.key);
  } catch (err) { $("#cErr").textContent = err.message; }
};

function start(code, key) {
  CODE = code; KEY = key;
  $("#createView").classList.add("hidden");
  $("#dash").classList.remove("hidden");
  $("#hdr").classList.remove("hidden");
  $("#codeBox").textContent = code;
  connect();
}

function connect() {
  es = new EventSource(`/api/stream?role=teacher&code=${CODE}&key=${encodeURIComponent(KEY)}`);
  es.onmessage = (ev) => handle(JSON.parse(ev.data));
  es.onerror = () => { $("#livePill").textContent = "BAĞLANIYOR…"; checkAlive(); };
  es.onopen = () => { $("#livePill").textContent = "CANLI"; };
}

// Bağlantı koptuğunda dersin sunucuda hâlâ var olup olmadığını kontrol et
let checking = false;
async function checkAlive() {
  if (checking) return; checking = true;
  try {
    const r = await fetch(`/api/class?code=${CODE}`);
    if (r.status === 404) {
      es.close(); window.LIVE?.stop(true);
      delete saved[CODE]; store.set("dn_teacher", saved);
      $("#dash").classList.add("hidden"); $("#hdr").classList.add("hidden");
      $("#createView").classList.remove("hidden");
      $("#cErr").textContent = `${CODE} kodlu ders sunucuda bulunamadı (sunucu verisi silinmiş olabilir). Öğrencilerin katılabilmesi için yeni bir ders başlatın.`;
      history.replaceState(null, "", location.pathname);
      showRecent();
    }
  } catch { /* sunucu kapalı: EventSource yeniden denemeye devam eder */ }
  finally { setTimeout(() => (checking = false), 3000); }
}

function handle(m) {
  switch (m.type) {
    case "state": return renderState(m);
    case "history":
      m.alerts.forEach(addAlert); m.chat.forEach(addChat); return;
    case "alert": addAlert(m.alert); toast("⚠️ " + m.alert.text); return;
    case "chat": addChat(m.msg); return;
    case "hand": if (m.up) toast(`✋ ${m.name} söz istiyor`); return;
    case "reaction": floatEmoji(m.emoji); return;
    case "signal": window.LIVE?.onSignal(m); return;
    case "ended": window.LIVE?.stop(true); es.close(); location.href = "/report.html?code=" + CODE; return;
  }
}

function renderState(s) {
  lastState = s;
  if (s.cls.ended) { location.href = "/report.html?code=" + CODE; return; }
  window.LIVE?.onServerState(s.cls.live);
  $("#clsName").textContent = s.cls.name;
  document.title = s.cls.name + " — DersNabzı";
  if (document.activeElement !== $("#topicIn")) $("#topicIn").value = s.cls.topic || "";
  const a = s.agg;
  const kAtt = $("#kAtt"); kAtt.textContent = a.attention == null ? "–" : "%" + a.attention; kAtt.style.color = levelColor(a.attention);
  const kEn = $("#kEn"); kEn.textContent = a.energy == null ? "–" : "%" + a.energy; kEn.style.color = levelColor(a.energy);
  $("#kPres").textContent = a.present;
  $("#kPresS").textContent = `/ ${a.total} öğrenci çevrim içi` + (a.hands ? ` · ✋ ${a.hands}` : "");
  const domKey = a.present ? Object.entries(a.emotions).sort((x, y) => y[1] - x[1])[0][0] : null;
  $("#kEmo").textContent = domKey ? `${EMO[domKey].icon} ${EMO[domKey].label}` : "–";
  $("#kEmoS").textContent = domKey ? `${a.emotions[domKey]} / ${a.present} öğrenci` : " ";
  emotionBars($("#emoBars"), a.emotions);
  const rc = Object.entries(s.reactions || {});
  $("#reacts").innerHTML = rc.length ? rc.map(([e, n]) => `<span>${e} <b>${n}</b></span>`).join("") : '<span class="muted small">Henüz tepki yok</span>';
  drawLineChart($("#chart"), s.timeline, CHART_SERIES);
  renderGaze(s);
  renderStudents(s.students);
}

function statusText(st) {
  if (!st.online) return "Çevrim dışı";
  if (st.tabHidden) return "Başka sekmede";
  if (!st.face) return "Kamerada görünmüyor";
  if (st.eyesClosed) return "Gözleri kapalı";
  if (st.lookingAway) return "Ekrana bakmıyor";
  return EMO[st.emotion]?.label || "";
}

function renderStudents(list) {
  const el = $("#students");
  if (!list.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">Henüz katılan yok.<br>Öğrenciler <b>${location.origin}/student.html</b> adresinden <b>${CODE}</b> koduyla katılabilir.<br><br>Kamerasız denemek için üstteki <b>+ Demo öğrenciler</b> butonunu kullanın.</div>`;
    return;
  }
  el.innerHTML = list.map((st) => {
    const low = st.online && st.attention < 40 && st.lowFor >= 10;
    const speaking = window.LIVE?.floorSid === st.id;
    const floorBtn = speaking
      ? `<button class="btn sm danger floor-btn" data-take="1"><span class="eq"><i></i><i></i><i></i></span> Konuşuyor · Sözü al</button>`
      : st.hand && !st.demo ? `<button class="btn sm primary floor-btn" data-floor="${st.id}">🎙️ Söz ver</button>` : "";
    return `<div class="stu ${st.online ? "" : "off"} ${low ? "low" : ""} ${speaking ? "speaking" : ""}">
      ${st.hand ? `<span class="hand" data-lower="${st.id}" title="Eli indir">✋</span>` : ""}
      <div class="top"><div class="av">${st.online ? EMO[st.emotion]?.icon || "😐" : "💤"}</div>
        <div style="min-width:0"><div class="nm">${esc(st.name)}${st.demo ? ' <span class="pill" style="font-size:10px;padding:1px 6px">demo</span>' : ""}</div>
        <div class="st">${statusText(st)}${low ? ` · ${st.lowFor} sn` : ""}</div></div></div>
      <div class="metric"><span>Dikkat</span><div class="bar"><i style="width:${st.attention}%;background:${levelColor(st.attention)}"></i></div><b>${st.attention}</b></div>
      <div class="metric"><span>Enerji</span><div class="bar"><i style="width:${st.energy}%;background:var(--c-en)"></i></div><b>${st.energy}</b></div>
      ${gazeLine(st)}
      ${floorBtn}
    </div>`;
  }).join("");
}

$("#students").onclick = (e) => {
  const fb = e.target.closest("[data-floor]"), tk = e.target.closest("[data-take]");
  if (fb) return window.LIVE?.giveFloor(fb.dataset.floor);
  if (tk) return window.LIVE?.takeFloor();
  const id = e.target.dataset?.lower;
  if (id) api("/api/event", { code: CODE, key: KEY, type: "lower_hand", id }).catch((err) => toast(err.message));
};

const seenAlerts = new Set();
function addAlert(a) {
  const k = a.t + a.text; if (seenAlerts.has(k)) return; seenAlerts.add(k);
  $("#noAlerts")?.remove();
  const d = document.createElement("div");
  d.className = "alert " + (a.kind === "class" ? "class" : "");
  d.innerHTML = `<div class="tm">${fmtTime(a.t)}</div>${esc(a.text)}`;
  $("#alerts").prepend(d);
}

function addChat(m) {
  const d = document.createElement("div");
  d.className = "msg " + m.role;
  d.innerHTML = `<b>${esc(m.name)} · ${fmtTime(m.t)}</b>${esc(m.text)}`;
  const box = $("#msgs"); box.append(d); box.scrollTop = box.scrollHeight;
}

const send = (body) => api("/api/event", { code: CODE, key: KEY, ...body }).catch((err) => toast(err.message));
$("#chatForm").onsubmit = (e) => { e.preventDefault(); const v = $("#chatIn").value.trim(); if (v) { send({ type: "chat", text: v }); $("#chatIn").value = ""; } };
$("#topicForm").onsubmit = (e) => { e.preventDefault(); send({ type: "topic", topic: $("#topicIn").value }); $("#topicIn").blur(); toast("Konu güncellendi"); };
$("#annForm").onsubmit = (e) => { e.preventDefault(); const v = $("#annIn").value.trim(); if (v) { send({ type: "announce", text: v }); $("#annIn").value = ""; toast("Duyuru gönderildi"); } };
$("#demoBtn").onclick = () => send({ type: "demo", count: 6 });
$("#endBtn").onclick = () => { if (confirm("Ders bitirilsin mi? Öğrencilerin bağlantısı kapanır ve rapor oluşturulur.")) send({ type: "end" }); };
$("#codeBox").onclick = () => {
  const link = `${location.origin}/student.html?code=${CODE}`;
  navigator.clipboard?.writeText(link).then(() => toast("Katılım bağlantısı kopyalandı: " + link), () => toast(link));
};
addEventListener("resize", () => lastState && drawLineChart($("#chart"), lastState.timeline, CHART_SERIES));

// Açılış
const qc = (params.get("code") || "").toUpperCase();
if (qc && saved[qc]) start(qc, saved[qc].key);
else showRecent();

// ================================================================ bakış (göz takibi)
const CHART_SERIES = [
  { key: "attention", color: "var(--c-att)", fill: true },
  { key: "energy", color: "var(--c-en)" },
  { key: "material", color: "#f0b429", dash: [5, 4] },
];
let lastHeat = null;

function gazeLine(st) {
  if (!st.online) return "";
  if (!st.gazeCal) return `<div class="gz">👁️ bakış takibi kapalı</div>`;
  const r = AOI[st.gazeRegion];
  const mp = st.materialPct == null ? "" : ` · son 1 dk materyalde <b style="color:${levelColor(st.materialPct)}">%${st.materialPct}</b>`;
  return `<div class="gz">👁️ ${r ? r.icon + " " + r.label : "belirsiz"}${mp}</div>`;
}

function renderGaze(s) {
  const g = s.agg.gaze || { calibrated: 0, regions: {} };
  lastHeat = s.heat;
  $("#gazeCal").textContent = g.calibrated
    ? `${g.calibrated} / ${s.agg.present} çevrim içi öğrencide bakış takibi açık`
    : "Bakış takibi açık öğrenci yok (öğrenciler kendi ekranlarında kalibre etmeli)";
  const k = $("#kMat");
  k.textContent = g.onMaterial == null ? "–" : "%" + g.onMaterial;
  k.style.color = levelColor(g.onMaterial);
  aoiBars($("#aoiBars"), g.regions);
}

// Isı haritası arka planı: öğretmenin şu an yayınladığı kare (kamera ya da paylaşılan ekran)
setInterval(() => {
  if ($("#dash").classList.contains("hidden")) return;
  const live = window.LIVE?.on;
  drawHeat($("#heat"), lastHeat, {
    bg: live ? $("#myVideo") : null,
    empty: live ? "Henüz materyale bakış verisi yok" : "Yayın kapalı — ısı haritası yine de toplanır",
  });
}, 150);

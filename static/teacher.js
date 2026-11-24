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
    if ($("#cTeacher").value) store.set("dn_teacher_id", $("#cTeacher").value);
    const r = await api("/api/class", { name: $("#cName").value, topic: $("#cTopic").value, teacher_id: $("#cTeacher").value || null });
    saved[r.code] = { key: r.key, name: $("#cName").value, t: Date.now() };
    store.set("dn_teacher", saved);
    history.replaceState(null, "", "?code=" + r.code);
    start(r.code, r.key);
  } catch (err) { $("#cErr").textContent = err.message; }
};

// Öğretmen girişi henüz yok: yönetim panelinde eklenen öğretmenler listeden seçilir (ders verisi o öğretmene bağlanır)
fetch("/api/teachers").then((r) => r.json()).then((list) => {
  if (!Array.isArray(list) || !list.length) return;
  const sel = $("#cTeacher");
  list.forEach((t) => sel.add(new Option(t.name, t.id)));
  sel.value = list.some((t) => t.id === store.get("dn_teacher_id")) ? store.get("dn_teacher_id") : "";
  $("#cTeacherBox").classList.remove("hidden");
}).catch(() => {});

// Öğrencilerin açacağı adres: sunucunun ağ IP'leri (öğretmen localhost ile açsa da öğrenciye işe yarar)
let ADRES = null;
fetch("/api/adres").then((r) => (r.ok ? r.json() : null)).then((a) => { if (a && Array.isArray(a.ipler)) { ADRES = a; renderAdres(); } }).catch(() => {});
function ogrAdresleri() {
  const kod = typeof CODE === "string" && CODE ? `?code=${CODE}` : "";
  if (ADRES && ADRES.ipler.length && ADRES.https_port)
    return { https: true, liste: ADRES.ipler.map((ip) => `https://${ip}:${ADRES.https_port}/student.html${kod}`) };
  const ip = ADRES && ADRES.ipler.length ? ADRES.ipler[0] : null;
  const port = ADRES && ADRES.http_port ? ADRES.http_port : location.port;
  return { https: false, liste: [ip ? `http://${ip}${port ? ":" + port : ""}/student.html${kod}` : `${location.origin}/student.html${kod}`] };
}
function adresHtml() {
  if (!ADRES) return `<b>${location.origin}/student.html</b>`;
  const a = ogrAdresleri();
  const uyari = a.https ? (a.liste.length > 1 ? "<br>Öğrencilerle aynı ağdaki adresi kullanın." : "")
    : "<br><b>Lab bilgisayarları için sunucu https ile başlatılmalı (KOMUTLAR.md 5. bölüm).</b>";
  return a.liste.map((u) => `<b>${u}</b>`).join("<br>") + uyari;
}
function renderAdres() {
  const kutu = document.querySelector("#adresKutu");
  if (kutu) kutu.innerHTML = adresHtml();
}

function start(code, key) {
  CODE = code; KEY = key;
  $("#createView").classList.add("hidden");
  $("#dash").classList.remove("hidden");
  $("#hdr").classList.remove("hidden");
  $("#codeBox").textContent = code;
  connect();
  loadMaterials();
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
    case "material": MAT.active = m.active; renderMaterials(); return;
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
  // Sınıfta gerçek öğrenci yokken özetler yalnızca demo öğrencilerden gelir; bunu açıkça göster
  $("#kPresS").textContent = `/ ${a.total} ${a.demo ? "DEMO öğrenci (gerçek veri değil)" : "öğrenci"} çevrim içi` + (a.hands ? ` · ✋ ${a.hands}` : "");
  const domKey = a.present ? Object.entries(a.emotions).sort((x, y) => y[1] - x[1])[0][0] : null;
  $("#kEmo").textContent = domKey ? `${EMO[domKey].icon} ${EMO[domKey].label}` : "–";
  $("#kEmoS").textContent = domKey ? `${a.emotions[domKey]} / ${a.present} öğrenci` : " ";
  if (a.present) emotionBars($("#emoBars"), a.emotions); else $("#emoBars").innerHTML = '<span class="muted small">veri yok (çevrim içi öğrenci yok)</span>';
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

// HSEmotion (öğrenci cihazında çalışır; yalnız sınıf, oran ve valence/arousal gelir)
const HSE_AD = { Anger: "😠 Öfke", Contempt: "😒 Küçümseme", Disgust: "🤢 İğrenme", Fear: "😨 Korku", Happiness: "😊 Mutluluk", Neutral: "😐 Nötr", Sadness: "😢 Üzüntü", Surprise: "😮 Şaşkınlık" };
function hseLine(st) {
  const h = st.online && st.face ? st.hse : null;
  if (!h) return "";
  return `<div class="muted" style="font-size:12px" title="HSEmotion: valence olumsuz (-1) → olumlu (+1), arousal sakin (-1) → uyarılmış (+1)">🧠 ${HSE_AD[h.top] || esc(h.top)} %${Math.round(100 * h.p)} · V ${h.valence.toFixed(2)} · A ${h.arousal.toFixed(2)}</div>`;
}
// Sınıf testi: bakış testi durumu (sunucu: bakis_testleri) ve cihaz özeti (kurulum). Bilinmeyen "veri yok".
const BT_DURUM = { suruyor: ["sürüyor", "var(--warn)"], bitti: ["bitti", "var(--good)"], bitmedi: ["bitmedi", "var(--bad)"] };
function btMetin(bt) {
  const [ad, renk] = BT_DURUM[bt?.durum] || ["başlamadı", "var(--muted)"];
  const ek = bt?.durum === "bitti" ? ` · GazeLab ${bt.glAcc != null ? `${Math.round(bt.glAcc)} px` : "veri yok"} · ${esc(bt.model || "veri yok")}` : "";
  return `<b style="color:${renk}">${ad}</b>${ek}`;
}
function cihazMetin(c) {
  if (!c) return "veri yok";
  const kam = (c.kamera || c.kameraCozunurluk ? `📷 ${esc(c.kamera || "kamera")}${c.kameraCozunurluk ? ` ${esc(c.kameraCozunurluk)}` : ""}` : "kamera veri yok")
    + (c.kameraFps != null ? ` · ayar ${Math.round(c.kameraFps)} fps` : "") + (c.islemeFps != null ? ` · işlenen ${Math.round(c.islemeFps)} fps (ölçülen)` : "");
  return [esc(c.tarayici || "tarayıcı veri yok"), esc(c.isletimSistemi || "işletim sistemi veri yok"),
    c.cekirdek != null ? `${c.cekirdek} çekirdek` : "çekirdek veri yok", c.bellekGB != null ? `≈${c.bellekGB} GB RAM` : "RAM veri yok",
    esc(c.gpu || "GPU veri yok"), kam].join(" · ");
}
function btSatiri(st) {
  if (st.demo) return "";
  return `<div class="muted" style="font-size:11px">🎯 Bakış testi: ${btMetin(st.bakisTesti)}</div>` +
    `<div class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(st.cihazOz?.gpu || "")}">💻 ${st.cihazOz ? cihazMetin(st.cihazOz) : "Cihaz: veri yok"}</div>`;
}
function renderStudents(list) {
  const el = $("#students");
  if (!list.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">Henüz katılan yok.<br>Öğrenciler şu adresten katılır (ders kodu <b>${CODE}</b>):<br><span id="adresKutu">${adresHtml()}</span><br><br>Kamerasız denemek için üstteki <b>+ Demo öğrenciler</b> butonunu kullanın.</div>`;
    return;
  }
  el.innerHTML = list.map((st) => {
    const low = st.online && st.attention < 40 && st.lowFor >= 10;
    const speaking = window.LIVE?.floorSid === st.id;
    const floorBtn = speaking
      ? `<button class="btn sm danger floor-btn" data-take="1"><span class="eq"><i></i><i></i><i></i></span> Konuşuyor · Sözü al</button>`
      : st.hand && !st.demo ? `<button class="btn sm primary floor-btn" data-floor="${st.id}">🎙️ Söz ver</button>` : "";
    return `<div class="stu ${st.online ? "" : "off"} ${low ? "low" : ""} ${speaking ? "speaking" : ""}" data-sid="${st.id}" style="cursor:pointer" title="Ayrıntılar için tıklayın">
      ${st.hand ? `<span class="hand" data-lower="${st.id}" title="Eli indir">✋</span>` : ""}
      <div class="top"><div class="av">${st.online ? EMO[st.emotion]?.icon || "😐" : "💤"}</div>
        <div style="min-width:0"><div class="nm">${esc(st.name)}${st.demo ? ' <span class="pill" style="font-size:10px;padding:1px 6px">demo</span>' : ""}</div>
        <div class="st">${statusText(st)}${low ? ` · ${st.lowFor} sn` : ""}</div></div></div>
      <div class="metric"><span>Dikkat</span><div class="bar"><i style="width:${st.online && st.attention != null ? st.attention : 0}%;background:${levelColor(st.attention)}"></i></div><b>${st.online && st.attention != null ? st.attention : "–"}</b></div>
      <div class="metric"><span>Enerji</span><div class="bar"><i style="width:${st.online && st.energy != null ? st.energy : 0}%;background:var(--c-en)"></i></div><b>${st.online && st.energy != null ? st.energy : "–"}</b></div>
      ${gazeLine(st)}
      ${hseLine(st)}
      ${btSatiri(st)}
      ${st.ekran ? `<div class="muted" style="font-size:11px" title="Ekran ${st.ekran.sw}x${st.ekran.sh}, ölçek ${st.ekran.dpr}">🖥️ Tarayıcı ${st.ekran.vw}×${st.ekran.vh}${st.ekran.fs ? " · tam ekran" : ""}${st.ekran.mobil ? " · 📱 mobil" : ""}</div>` : ""}
      ${floorBtn}
    </div>`;
  }).join("");
}

$("#students").onclick = (e) => {
  const fb = e.target.closest("[data-floor]"), tk = e.target.closest("[data-take]");
  if (fb) return window.LIVE?.giveFloor(fb.dataset.floor);
  if (tk) return window.LIVE?.takeFloor();
  const id = e.target.dataset?.lower;
  if (id) return api("/api/event", { code: CODE, key: KEY, type: "lower_hand", id }).catch((err) => toast(err.message));
  const kart = e.target.closest("[data-sid]");
  if (kart && !e.target.closest("button")) ayrintiAc(kart.dataset.sid);
};

// ---------------------------------------------------------------- öğrenci ayrıntısı
// Yalnız öğrencinin gönderdiği sayılar: kamera görüntüsü tasarım gereği sunucuya hiç gelmez.
let ayrintiSid = null, ayrintiZaman = null;
const ayrintiDlg = document.createElement("dialog");
ayrintiDlg.id = "ayrinti";
Object.assign(ayrintiDlg.style, { width: "min(980px, 94vw)", maxHeight: "92vh", padding: "0", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--surface)", color: "var(--text)" });
document.body.append(ayrintiDlg);
ayrintiDlg.addEventListener("close", () => { ayrintiSid = null; clearInterval(ayrintiZaman); });
ayrintiDlg.addEventListener("click", (e) => { if (e.target === ayrintiDlg || e.target.closest("[data-kapat]")) ayrintiDlg.close(); });

function ayrintiAc(sid) {
  ayrintiSid = sid;
  ayrintiDlg.innerHTML = `<div style="padding:18px" class="muted">Yükleniyor…</div>`;
  if (!ayrintiDlg.open) ayrintiDlg.showModal();
  clearInterval(ayrintiZaman);
  ayrintiYenile();
  ayrintiZaman = setInterval(ayrintiYenile, 3000);
}

async function ayrintiYenile() {
  const sid = ayrintiSid;
  if (!sid) return;
  let d;
  try {
    const r = await fetch(`/api/student?code=${CODE}&key=${encodeURIComponent(KEY)}&id=${encodeURIComponent(sid)}`);
    d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
  } catch (err) { ayrintiDlg.innerHTML = `<div style="padding:18px">Ayrıntı alınamadı: ${esc(err.message)} <button class="btn sm" data-kapat>Kapat</button></div>`; return; }
  if (sid !== ayrintiSid) return;
  ayrintiCiz(d);
}

const yuzde = (v) => v == null ? "–" : `%${v}`;
function ayrintiCiz(d) {
  const m = d.metrics || {}, k = d.kurulum || {}, kal = d.kal, e = d.ekran;
  const smp = d.samples || [];
  const son = smp.slice(-30);
  const ort = (i) => son.length ? Math.round(son.reduce((a, x) => a + x[i], 0) / son.length) : null;
  const durum = [statusText(d), m.eyesClosed ? "gözler kapalı" : "", m.lookingAway ? "ekrana bakmıyor" : ""].filter(Boolean);
  const h = d.online && d.face ? m.hse : null;
  const kutu = (baslik, icerik) => `<div style="background:var(--surface-2);border-radius:10px;padding:10px 12px"><div class="muted" style="font-size:12px;margin-bottom:4px">${baslik}</div>${icerik}</div>`;
  const satir = (a, b) => `<div class="row" style="justify-content:space-between;font-size:13px;gap:10px"><span class="muted">${a}</span><b style="text-align:right">${b}</b></div>`;
  ayrintiDlg.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)">
      <div style="font-size:30px">${d.online ? EMO[d.emotion]?.icon || "😐" : "💤"}</div>
      <div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:700">${esc(d.name)}${d.demo ? ' <span class="pill" style="font-size:10px">demo</span>' : ""}</div>
        <div class="muted small">${esc(durum.join(" · "))} · katıldı ${fmtTime(d.joined)}${d.pcode ? ` · kod ${esc(d.pcode)}` : ""}</div></div>
      <button class="btn sm" data-kapat>✕ Kapat</button>
    </div>
    <div style="padding:14px 18px;display:grid;gap:12px;overflow:auto;max-height:calc(92vh - 70px)">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${kutu("Dikkat (şimdi · son ~1 dk)", `<b style="font-size:22px;color:${levelColor(d.attention)}">${d.online && d.attention != null ? d.attention : "–"}</b> <span class="muted">· ${ort(1) ?? "–"}</span>`)}
        ${kutu("Enerji (şimdi · son ~1 dk)", `<b style="font-size:22px">${d.online && d.energy != null ? d.energy : "–"}</b> <span class="muted">· ${ort(2) ?? "–"}</span>`)}
        ${kutu("Materyale bakış (son ~1 dk)", `<b style="font-size:22px;color:${levelColor(d.materialPct)}">${yuzde(d.materialPct)}</b>`)}
        ${kutu("Etkileşim", `✋ ${d.hands} · 💬 ${d.messages} · 👍 ${d.reactions}`)}
      </div>
      ${kutu("Dikkat · enerji · materyal (son 10 dk)", `<canvas id="ayChart" style="width:100%;height:170px;display:block"></canvas>`)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">
        ${kutu(`Öğrencinin sayfasında bakış ısısı <span title="Öğrenci tarayıcısındaki tüm ders sayfası; son noktalar beyaz">ⓘ</span>${d.scrOutPct != null ? ` · sayfa dışı ${yuzde(d.scrOutPct)}` : ""}`, `<canvas id="aySayfa" style="width:100%;height:220px;display:block"></canvas>`)}
        ${kutu("Materyal üzerinde bakış ısısı", `<canvas id="ayMat" style="width:100%;height:220px;display:block"></canvas>`)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
        ${kutu("Bakış bölgeleri (ders boyunca)", `<div id="ayAoi"></div>`)}
        ${kutu("Duygu (HSEmotion)", h
          ? `${satir("En olası", `${HSE_AD[h.top] || esc(h.top)} %${Math.round(100 * h.p)}`)}${satir("Valence (olumsuz → olumlu)", h.valence.toFixed(2))}${satir("Arousal (sakin → uyarılmış)", h.arousal.toFixed(2))}`
          : `<span class="muted small">${d.online ? "Öğrenci HSEmotion paylaşımını açmamış ya da yüzü görünmüyor" : "Çevrim dışı"}</span>`)}
        ${kutu("Bakış kalibrasyonu", kal
          ? `${satir("Model", esc(kal.model || "ana model"))}${satir("Hata", kal.acc != null ? `~${kal.acc} px` : "–")}${satir("3×3 isabet", yuzde(kal.hit3))}${satir("Zaman", fmtTime(kal.t))}`
          : `<span class="muted small">${d.gazeCal ? "Kalibre (bu derste rapor gelmedi)" : "Bakış takibi kapalı"}</span>`)}
        ${d.demo ? "" : kutu("Bakış testi (ders başı)", `${satir("Durum", btMetin(d.bakisTesti))}${d.bakisTesti?.t ? satir("Son kayıt", fmtTime(d.bakisTesti.t)) : ""}${d.bakisTesti?.dosya ? `<div class="muted" style="font-size:11px;word-break:break-all">${esc(d.bakisTesti.dosya)}</div>` : ""}`)}
        ${kutu("Cihaz ve kurulum", `${d.cihazOz ? `<div class="muted" style="font-size:12px;margin-bottom:4px">${cihazMetin(d.cihazOz)}</div>` : ""}${k.cihaz2 ? satir("İşlemci çekirdeği", k.cihaz2.cekirdek ?? "veri yok") + satir("Bellek", k.cihaz2.bellekGB != null ? `${k.cihaz2.bellekGB} GB` : "veri yok") + satir("GPU", esc(k.cihaz2.gpu || "veri yok")) : ""}${e ? satir("Tarayıcı", `${e.vw}×${e.vh}${e.fs ? " · tam ekran" : ""}${e.mobil ? " · mobil" : ""}`) + satir("Ekran", `${e.sw}×${e.sh} @${e.dpr}`) : ""}${k.kamera ? satir("Kamera", esc(k.kamera)) : ""}${k.fps != null ? satir("Kamera kare/sn (ayar)", k.fps) : ""}${k.islemeFps != null ? satir("İşlenen kare/sn (ölçülen)", k.islemeFps) : ""}${k.uzaklikCm != null ? satir("Uzaklık", `${Math.round(k.uzaklikCm)} cm`) : ""}${k.tarayici ? satir("Tarayıcı türü", esc(k.tarayici)) : ""}` || '<span class="muted small">veri yok</span>')}
      </div>
      <div class="muted" style="font-size:11px">Kamera görüntüsü gönderilmez; tüm ölçümler öğrencinin cihazında yapılır, buraya yalnız sayılar gelir.</div>
    </div>`;
  drawLineChart($("#ayChart"), smp.map((x) => ({ t: x[0], attention: x[1], energy: x[2], material: x[4] == null ? null : Math.round(100 * x[4]) })), CHART_SERIES);
  if (Object.values(d.gazeRegions || {}).some((v) => v > 0)) aoiBars($("#ayAoi"), d.gazeRegions, true);
  else $("#ayAoi").innerHTML = '<span class="muted small">veri yok</span>';
  sayfaIsiCiz($("#aySayfa"), d);
  drawHeat($("#ayMat"), d.heat, { bg: window.LIVE?.on ? $("#myVideo") : null, empty: d.gazeCal ? "Materyale düşen bakış yok" : "Bakış takibi kapalı" });
}

// Öğrencinin tarayıcı penceresi oranında kutu; ısı + son noktalar (sayfa dışı noktalar kenara yapışık gösterilir)
function sayfaIsiCiz(cv, d) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0d10"; ctx.fillRect(0, 0, w, h);
  const r = d.ekran?.vw && d.ekran?.vh ? d.ekran.vw / d.ekran.vh : 16 / 9;
  let bw = w - 16, bh = bw / r; if (bh > h - 16) { bh = h - 16; bw = bh * r; }
  const bx = (w - bw) / 2, by = (h - bh) / 2;
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
  if (d.scrHeat) { ctx.imageSmoothingEnabled = true; ctx.drawImage(heatLayer(d.scrHeat, d.scrSize[0], d.scrSize[1]), bx, by, bw, bh); }
  const son = d.scrSon || [];
  son.forEach(([x, y], i) => {
    const px = bx + Math.min(1, Math.max(0, x)) * bw, py = by + Math.min(1, Math.max(0, y)) * bh;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.85 * (i + 1) / son.length})`;
    ctx.beginPath(); ctx.arc(px, py, i === son.length - 1 ? 5 : 2.5, 0, 7); ctx.fill();
  });
  if (!d.scrHeat && !son.length) {
    ctx.fillStyle = "#8a94a3"; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(d.gazeCal ? "Sayfada bakış noktası yok (sekme gizli ya da ekran dışı)" : "Bakış takibi kapalı", w / 2, h / 2);
  }
}

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
  const link = ogrAdresleri().liste.join("\n");
  navigator.clipboard?.writeText(link).then(() => toast("Katılım bağlantısı kopyalandı: " + link.replace(/\n/g, "  ")), () => toast(link));
};
// ---------------------------------------------------------------- materyaller
const MAT = { list: [], active: null };
const MAT_KIND = { insan: "İnsan", yz: "YZ", diger: "Diğer" };
const matQ = () => `code=${CODE}&key=${encodeURIComponent(KEY)}`;

async function loadMaterials() {
  try {
    const r = await api(`/api/materials?${matQ()}`);
    MAT.list = r.materials; MAT.active = r.active;
    renderMaterials();
  } catch (err) { toast(err.message); }
}

function renderMaterials() {
  const el = $("#matList");
  if (!MAT.list.length) { el.innerHTML = '<div class="small muted">Henüz materyal yok.</div>'; return; }
  el.innerHTML = MAT.list.map((m) => `<div class="mat ${m.id === MAT.active ? "active" : ""}">
    ${m.hasImage ? `<img alt="" src="/api/material/image?${matQ()}&id=${m.id}">` : '<span class="noimg"></span>'}
    <span class="mn" title="${esc(m.name)}">${esc(m.name)}</span>
    <span class="badge">${MAT_KIND[m.kind] || esc(m.kind)}</span>
    <button class="btn sm" data-mat="${m.id}" ${m.id === MAT.active ? "disabled" : ""}>Şimdi bu</button></div>`).join("");
}

const selectMaterial = (id) => api("/api/event", { code: CODE, key: KEY, type: "material", id })
  .then(() => { MAT.active = id; renderMaterials(); }).catch((err) => toast(err.message));
$("#matList").onclick = (e) => { const b = e.target.closest("[data-mat]"); if (b) selectMaterial(Number(b.dataset.mat)); };
$("#matNone").onclick = () => selectMaterial(null);
$("#matForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = $("#matFile").files[0];
  try {
    const r = await fetch(`/api/material?${matQ()}&name=${encodeURIComponent($("#matName").value.trim())}&kind=${$("#matKind").value}`,
      { method: "POST", body: f || new Blob([]) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Yükleme başarısız");
    $("#matForm").reset();
    await loadMaterials();
  } catch (err) { toast(err.message); }
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
    : "Bakış takibi açık öğrenci yok (bakış kalibrasyonu öğrenci derse girince kendiliğinden başlar)";
  const k = $("#kMat");
  k.textContent = g.onMaterial == null ? "–" : "%" + g.onMaterial;
  k.style.color = levelColor(g.onMaterial);
  if (g.calibrated) aoiBars($("#aoiBars"), g.regions); else $("#aoiBars").innerHTML = '<span class="muted small">veri yok</span>';
}

// Isı haritası arka planı: öğretmenin şu an yayınladığı kare (kamera ya da paylaşılan ekran)
setInterval(() => {
  if ($("#dash").classList.contains("hidden")) return;
  const live = window.LIVE?.on, g = lastState?.agg?.gaze;
  drawHeat($("#heat"), lastHeat, {
    bg: live ? $("#myVideo") : null,
    empty: !g?.calibrated ? "Bakış takibi açık öğrenci yok"
      : `Materyale düşen bakış noktası yok${g.regions?.materyal ? "" : " (öğrenciler materyale bakmıyor)"}${live ? "" : " · yayın kapalı"}`,
  });
}, 150);

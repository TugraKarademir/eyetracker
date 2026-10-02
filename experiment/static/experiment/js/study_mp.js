/*
 * Faz 7 — MediaPipe Iris tabanli calisma runner'i.
 *
 * WebGazer yerine tarayici-ici iris kestirimi kullanir (study.js'in muadili).
 * AYNI sunucu API'si ve AYNI veri formatiyla yazar; boylece Faz 2-6 analiz/
 * sunucu/AOI/rapor zinciri HIC DEGISMEDEN calisir.
 *
 * KURAL (spec §6/§15): kamera goruntusu tarayicidan cikmaz; yalniz bakis
 * koordinatlari sunucuya gider.
 */
import { start as startEngine, latestFeatures, faceOk, fit, predict } from "./gaze/mediapipe_engine.js";

const APP_VERSION = "0.7.0-faz7-mediapipe";
const MIN_W = 1280, MIN_H = 720;

const study = JSON.parse(document.getElementById("study-data").textContent);
const materials = JSON.parse(document.getElementById("materials-data").textContent);
const api = JSON.parse(document.getElementById("api-data").textContent);

const app = document.getElementById("app");
const video = document.getElementById("cam-mp");

const CALIB_POINTS = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.3, 0.3], [0.7, 0.3],
  [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
  [0.3, 0.7], [0.7, 0.7],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];
const VALID_POINTS = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];

let W = null;
let validationResult = null;
const midChecks = [];
const allSamples = [];
let sessionPromise = null;

console.log("MediaPipe runner surumu:", APP_VERSION, "| materyal:", materials.length);
badge();

// ---------- yardimcilar ----------
function badge() {
  const b = document.createElement("div");
  b.textContent = "v" + APP_VERSION;
  b.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:99999;font:11px system-ui,sans-serif;color:#999;background:rgba(255,255,255,.7);padding:2px 6px;border-radius:4px;pointer-events:none";
  document.body.appendChild(b);
}
function getCookie(n) { const m = document.cookie.match("(^|;)\\s*" + n + "\\s*=\\s*([^;]+)"); return m ? decodeURIComponent(m.pop()) : ""; }
function postJSON(url, body) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("csrftoken") }, body: JSON.stringify(body) })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
}
function postWithRetry(url, body, n) {
  return postJSON(url, body).catch((e) => { if (n > 0) return new Promise((r) => setTimeout(r, 1000)).then(() => postWithRetry(url, body, n - 1)); throw e; });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function screen(html) { app.innerHTML = '<div class="kart">' + html + "</div>"; }
function deviceIssue() {
  const ua = navigator.userAgent;
  if (!((/Chrome\//.test(ua) && !/OPR\//.test(ua)) || /Edg\//.test(ua))) return "Bu calisma yalnizca masaustu Chrome veya Edge'de desteklenir.";
  if (/Mobi|Android|iPhone|iPad|iPod/.test(ua)) return "Bu calisma mobil cihaz/tablette yapilamaz.";
  if (window.innerWidth < MIN_W || window.innerHeight < MIN_H) return "Ekran/pencere cok kucuk (" + window.innerWidth + "x" + window.innerHeight + "). En az " + MIN_W + "x" + MIN_H + " gereklidir.";
  return null;
}
function showTarget(cx, cy, label) {
  return new Promise((resolve) => {
    app.innerHTML = "";
    const t = document.createElement("div");
    t.className = "target";
    t.style.left = (cx * 100) + "vw"; t.style.top = (cy * 100) + "vh";
    t.textContent = label;
    t.addEventListener("click", resolve);
    app.appendChild(t);
  });
}
async function collectAt(cx, cy, label, ms) {
  await showTarget(cx, cy, label);
  const t0 = performance.now(); const buf = [];
  while (performance.now() - t0 < ms) { const f = latestFeatures(); if (f) buf.push(f); await sleep(25); }
  return buf;
}

// ---------- akis ----------
function consent() {
  screen(
    "<h2>Bilgilendirilmis Onam</h2>" +
    "<p><strong>" + esc(study.name) + "</strong> calismasina hos geldiniz. Ekrandaki materyalleri " +
    "incelerken bilgisayarinizin <strong>web kamerasiyla</strong> ekranin nerelerine baktiginiz tahmin edilecektir.</p>" +
    "<p><strong>Kamera goruntunuz kaydedilmez ve hicbir yere gonderilmez.</strong> Yalnizca bakis koordinatlari toplanir.</p>" +
    '<button id="ok">Onayliyorum</button> <button id="no" class="sec">Onaylamiyorum</button>'
  );
  document.getElementById("ok").onclick = instructions;
  document.getElementById("no").onclick = () => screen("<h2>Tesekkurler</h2><p>Onam verilmedigi icin calisma sonlandirildi.</p>");
}

function instructions() {
  const issue = deviceIssue();
  if (issue) { screen("<h2>Devam edilemiyor</h2><p>" + issue + "</p>"); return; }
  screen(
    "<h2>Baslamadan once</h2><ul style='text-align:left;line-height:1.6'>" +
    "<li>Yuzunuze <strong>onden</strong> iyi isik; arkada pencere olmasin.</li>" +
    "<li>Ekrana <strong>50 cm</strong> civari yaklasin (iris icin onemli), dik oturun.</li>" +
    "<li>Kamera ekranin <strong>ustunde</strong>, size duz baksin.</li>" +
    "<li>Calisma boyunca basinizi sabit tutun.</li></ul>" +
    '<button id="go">Tam ekrana gec ve basla</button>'
  );
  document.getElementById("go").onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) { /* kullanici izin vermezse devam */ }
    loadEngine();
  };
}

async function loadEngine() {
  screen("<h2>Kamera hazirlaniyor…</h2><p>Model yukleniyor, kamera izni verin.</p>");
  try {
    await startEngine(video);
  } catch (e) {
    screen("<h2>Kamera/model hatasi</h2><p>" + esc(e.message) + "</p>");
    return;
  }
  // Oturumu baslat (asenkron)
  sessionPromise = postWithRetry(api.start, {
    study_code: study.code,
    device: {
      user_agent: navigator.userAgent, screen_width: screen_w(), screen_height: screen_h(),
      viewport_width: window.innerWidth, viewport_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio || 1,
    },
  }, 2).then((r) => r.session_id).catch((e) => { console.error("baslat:", e); return null; });
  facePositioning();
}

function facePositioning() {
  screen("<h2>Yuz konumlandirma</h2><p>Yuzunuzu kamerada ortalayin. Hazir olunca buton etkinlesir.</p>" +
    '<button id="cal" disabled>Kalibrasyona gec</button>');
  const btn = document.getElementById("cal");
  const iv = setInterval(() => {
    if (faceOk()) { btn.disabled = false; btn.textContent = "Yuz bulundu — Kalibrasyona gec"; }
    else { btn.disabled = true; btn.textContent = "Yuz araniyor…"; }
  }, 200);
  btn.onclick = () => { clearInterval(iv); calibrate(); };
}

async function calibrate() {
  const rows = [];
  for (let i = 0; i < CALIB_POINTS.length; i++) {
    const [cx, cy] = CALIB_POINTS[i];
    const buf = await collectAt(cx, cy, String(i + 1), 500);
    if (buf.length) { const D = buf[0].length; rows.push({ f: Array.from({ length: D }, (_, k) => median(buf.map((v) => v[k]))), x: cx, y: cy }); }
  }
  if (rows.length < 6) { screen("<h2>Kalibrasyon yetersiz</h2><p>Lutfen sayfayi yenileyip tekrar deneyin.</p>"); return; }
  W = fit(rows);
  validate();
}

async function validate() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let sx = 0, sy = 0, n = 0;
  for (const [cx, cy] of VALID_POINTS) {
    const buf = await collectAt(cx, cy, "●", 800);
    const preds = buf.map((f) => predict(W, f));
    if (preds.length) {
      sx += Math.abs(median(preds.map((p) => p[0])) - cx) * vw;
      sy += Math.abs(median(preds.map((p) => p[1])) - cy) * vh; n++;
    }
  }
  const avgPx = n ? +(((sx + sy) / 2) / n).toFixed(1) : null;
  validationResult = {
    attempt_no: 1, avg_error_px: avgPx,
    avg_error_norm: avgPx != null ? +(avgPx / vw).toFixed(4) : null,
    precision: null, passed: avgPx != null ? avgPx <= 0.10 * vw : false,
  };
  console.log("MediaPipe dogrulama:", validationResult);
  runMaterials(0);
}

async function runMaterials(idx) {
  if (idx >= materials.length) { finishAndUpload(); return; }
  const mat = materials[idx];
  // odak artisi
  app.innerHTML = '<div class="fix">+</div>';
  await sleep(1000);
  // materyal
  await showMaterial(mat);
  // ara kontrol (her 3 materyalde bir)
  if ((idx + 1) % 3 === 0 && idx + 1 < materials.length) {
    const buf = await collectAt(0.5, 0.5, "●", 1200);
    const preds = buf.map((f) => predict(W, f));
    if (preds.length) {
      const vw = window.innerWidth;
      const err = Math.abs(median(preds.map((p) => p[0])) - 0.5) * vw + Math.abs(median(preds.map((p) => p[1])) - 0.5) * window.innerHeight;
      const passed = err <= 0.10 * vw * 2;
      midChecks.push({ attempt_no: 2 + midChecks.length, avg_error_px: +(err / 2).toFixed(1), avg_error_norm: null, precision: null, passed });
      if (!passed) { screen("<h2>Kisa hatirlatma</h2><p>Takip dogrulugu dustu. Basinizi ekrana gore ortalayin, sabit tutun.</p><button id='c'>Devam</button>"); await new Promise((r) => { document.getElementById("c").onclick = r; }); }
    }
  }
  runMaterials(idx + 1);
}

function showMaterial(mat) {
  return new Promise((resolve) => {
    app.innerHTML =
      '<div class="matwrap"><img id="mat" src="' + mat.src + '" alt="materyal">' +
      '<div class="alt"><button id="devam">Devam</button></div></div>';
    const img = document.getElementById("mat");
    let box = null, samples = [];
    const start = performance.now();
    const measure = () => { const r = img.getBoundingClientRect(); if (r.width > 0 && r.height > 0) box = r; };

    const capture = setInterval(() => {
      const f = latestFeatures();
      if (!f || !W) return;
      if (!box) measure();
      const [gx, gy] = predict(W, f);
      const xpx = gx * window.innerWidth, ypx = gy * window.innerHeight;
      let xn = null, yn = null, inm = false;
      if (box && box.width > 0) {
        xn = +((xpx - box.left) / box.width).toFixed(4);
        yn = +((ypx - box.top) / box.height).toFixed(4);
        inm = xn >= 0 && xn <= 1 && yn >= 0 && yn <= 1;
      }
      samples.push({ material_id: mat.id, t: Math.round(performance.now() - start), x_px: Math.round(xpx), y_px: Math.round(ypx), x_norm: xn, y_norm: yn, in_material: inm });
    }, 40);

    if (img.complete && img.naturalWidth) measure();
    else img.addEventListener("load", measure, { once: true });

    document.getElementById("devam").onclick = () => {
      clearInterval(capture);
      for (const s of samples) allSamples.push(s);
      resolve();
    };
  });
}

function finishAndUpload() {
  screen("<h2>Veriler kaydediliyor…</h2><p>Lutfen pencereyi kapatmayin.</p>");
  const payload = { calibrations: (validationResult ? [validationResult] : []).concat(midChecks), samples: allSamples };
  sessionPromise.then((sid) => {
    if (!sid) throw new Error("Oturum yok");
    return postWithRetry(api.data_tmpl.replace("__ID__", sid), payload, 3)
      .then((res) => postWithRetry(api.finish_tmpl.replace("__ID__", sid), { status: "completed" }, 3).then(() => res));
  }).then((res) => {
    screen("<h2>Tesekkurler!</h2><p>Veriniz kaydedildi (" + (res.saved_samples || allSamples.length) + " bakis ornegi).</p>");
  }).catch((e) => {
    console.error("gonderim:", e);
    try { localStorage.setItem("goz_izleme_yedek_" + Date.now(), JSON.stringify(payload)); } catch (x) {}
    downloadJson({ meta: { app_version: APP_VERSION, study: study.code }, data: payload }, "goz_izleme_yedek_" + Date.now() + ".json");
    screen("<h2>Baglanti sorunu</h2><p>Veri sunucuya gonderilemedi ama bilgisayariniza yedeklendi (JSON indi). Lutfen arastirmaciya iletin.</p>");
  });
}

function downloadJson(obj, fn) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { /* yok say */ }
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function screen_w() { return window.screen ? window.screen.width : null; }
function screen_h() { return window.screen ? window.screen.height : null; }

// baslat
if (!materials.length) screen("<h2>Materyal yok</h2><p>Bu calismada henuz materyal yok.</p>");
else consent();

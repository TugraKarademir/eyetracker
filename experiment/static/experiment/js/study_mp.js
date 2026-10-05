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
import * as singleEngine from "./gaze/mediapipe_engine.js";   // tek iris gorunumu (bu donanimda en iyi: ~107px)
import * as ensembleEngine from "./gaze/ensemble_engine.js";  // cok gorunum + fuzyon (opsiyonel)

const APP_VERSION = "0.9.3-faz11-random";
const MIN_W = 1280, MIN_H = 720;

const study = JSON.parse(document.getElementById("study-data").textContent);
const materials = JSON.parse(document.getElementById("materials-data").textContent);
const api = JSON.parse(document.getElementById("api-data").textContent);
const leppinkEl = document.getElementById("leppink-data");
const leppinkItems = leppinkEl ? JSON.parse(leppinkEl.textContent) : [];
const cogLoad = [];  // {material_id, scores:[10]} — RQ3 Leppink

// Materyal sirasi her katilimcida RASTGELE (sira etkisini azaltmak icin).
function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const ordered = (study.randomize !== false) ? shuffleArr(materials.slice()) : materials.slice();
const presentationOrder = {};
ordered.forEach((m, i) => { presentationOrder[m.id] = i + 1; });

// Motor secimi: varsayilan TEK iris (kanitlanmis en iyi); calisma ayarlarindan
// ensemble acilabilir (cok kisi/donanimda robustluk denemek icin).
const USE_ENSEMBLE = !!study.ensemble;
const ENGINE = USE_ENSEMBLE ? ensembleEngine : singleEngine;
const { start: startEngine, latestFeatures, faceOk, fit, predict, lastWeights } = ENGINE;

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
let gazeOffset = [0, 0];   // sistematik kayma (viewport orani); drift olcumunden
let driftInfo = null;      // {raw_px, corr_px, offset}

// Kalite kapisi (spec §5.6, §7): dogrulama esigini gecmeden veri toplanmaz
const MAX_VAL_RATIO = study.max_validation_error_ratio || 0.10;
const MAX_ATTEMPTS = study.max_calibration_attempts || 3;
let calibAttempt = 0;

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
  // NOT: Oturum, veri toplamaya hak kazanilinca (dogrulama gecince) baslatilir;
  // boylece basarisiz kalibrasyonlardan bos oturum olusmaz.
  facePositioning();
}

function startSession() {
  return postWithRetry(api.start, {
    study_code: study.code,
    device: {
      user_agent: navigator.userAgent, screen_width: screen_w(), screen_height: screen_h(),
      viewport_width: window.innerWidth, viewport_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio || 1,
    },
  }, 2).then((r) => r.session_id).catch((e) => { console.error("baslat:", e); return null; });
}

function facePositioning() {
  screen("<h2>Yuz konumlandirma</h2><p>Yuzunuzu kamerada ortalayin. Hazir olunca buton etkinlesir.</p>" +
    '<button id="cal" disabled>Kalibrasyona gec</button>');
  const btn = document.getElementById("cal");
  const iv = setInterval(() => {
    if (faceOk()) { btn.disabled = false; btn.textContent = "Yuz bulundu — Kalibrasyona gec"; }
    else { btn.disabled = true; btn.textContent = "Yuz araniyor…"; }
  }, 200);
  btn.onclick = () => { clearInterval(iv); calibrationCycle(); };
}

// Kalite kapisi: kalibre -> dogrula -> gecerse veri topla, gecmezse tekrar/dur
async function calibrationCycle() {
  calibAttempt++;
  const ok = await doCalibrate();
  if (!ok) { screen("<h2>Kalibrasyon yetersiz</h2><p>Yuz bulunamadi. Sayfayi yenileyip tekrar deneyin.</p>"); return; }

  const avgPx = await doValidate();
  const vw = window.innerWidth;
  const thrPx = MAX_VAL_RATIO * vw;
  const pct = avgPx != null ? (avgPx / vw * 100).toFixed(1) : "?";
  const thrPct = (MAX_VAL_RATIO * 100).toFixed(0);

  const acc = avgPx != null ? (100 - avgPx / vw * 100).toFixed(0) : "?";
  const accThr = (100 - MAX_VAL_RATIO * 100).toFixed(0);
  if (avgPx != null && avgPx <= thrPx) {
    screen("<h2>Doğruluk yeterli ✓</h2>" +
      "<p style='font-size:1.4rem'>Kalibrasyon doğruluğu: <b>~%" + acc + "</b></p>" +
      "<p>Şimdi kısa bir <strong>gerçek doğruluk ölçümü</strong> yapacağız.</p>");
    sessionPromise = startSession();   // yalniz GECINCE oturum olusur
    await sleep(1600);
    driftInfo = await driftCheck();    // serbest-izleme hatasi + ofset duzeltmesi
    if (driftInfo && driftInfo.raw_px != null) {
      const rawA = (100 - driftInfo.raw_px / vw * 100).toFixed(0);
      const corrA = (100 - driftInfo.corr_px / vw * 100).toFixed(0);
      screen("<h2>Gerçek doğruluk ölçüldü</h2>" +
        "<p>Serbest-izleme hatası: <b>" + driftInfo.raw_px + "px</b> (~%" + rawA + ")</p>" +
        "<p>Sistematik kayma düzeltmesi sonrası: <b>" + driftInfo.corr_px + "px</b> (~%" + corrA + ")</p>" +
        "<p style='color:#9fb'>Bu düzeltme tüm bakış verisine uygulanacak. Materyaller başlıyor…</p>");
      await sleep(3000);
    }
    runMaterials(0);
  } else if (calibAttempt < MAX_ATTEMPTS) {
    screen("<h2>Doğruluk yetersiz</h2>" +
      "<p style='font-size:1.4rem'>Doğruluk: <b>~%" + acc + "</b> — hedef ≥ %" + accThr + "</p>" +
      "<p>Ortalama hata " + avgPx + "px (%" + pct + ").</p>" +
      "<p>Kameraya <strong>yaklaşın (~50cm)</strong>, yüzünüze önden ışık olsun, başınızı sabit tutun; " +
      "her noktaya bakarak tıklayın.</p>" +
      "<p>Deneme " + calibAttempt + "/" + MAX_ATTEMPTS + "</p><button id='rk'>Tekrar kalibre et</button>");
    document.getElementById("rk").onclick = calibrationCycle;
  } else {
    screen("<h2>Yeterli doğruluğa ulaşılamadı</h2>" +
      "<p>" + MAX_ATTEMPTS + " denemede doğrulama hedefin (%" + thrPct + ") altına inmedi (son: %" + pct + ").</p>" +
      "<p><strong>Veri kaydedilmedi.</strong> Kötü/uzak kamera ya da ışık kaynaklı olabilir. " +
      "Kameraya yaklaşıp ışığı düzeltip sayfayı yenileyerek tekrar deneyebilirsiniz.</p>");
  }
}

async function doCalibrate() {
  const rows = [];
  for (let i = 0; i < CALIB_POINTS.length; i++) {
    const [cx, cy] = CALIB_POINTS[i];
    const buf = await collectAt(cx, cy, String(i + 1), 500);
    if (buf.length) { const D = buf[0].length; rows.push({ f: Array.from({ length: D }, (_, k) => median(buf.map((v) => v[k]))), x: cx, y: cy }); }
  }
  if (rows.length < 6) return false;
  W = fit(rows);
  console.log("Ensemble gorunum agirliklari (A/B/C):", lastWeights(W));
  return true;
}

async function doValidate() {
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
    attempt_no: calibAttempt, avg_error_px: avgPx,
    avg_error_norm: avgPx != null ? +(avgPx / vw).toFixed(4) : null,
    precision: null, passed: avgPx != null ? avgPx <= MAX_VAL_RATIO * vw : false,
  };
  console.log("Dogrulama (deneme " + calibAttempt + "):", validationResult);
  return avgPx;
}

// Pasif hedef: noktaya BAK (tiklama yok), sure boyunca tahmin topla
function passiveTarget(cx, cy, ms) {
  return new Promise((resolve) => {
    app.innerHTML = "";
    const t = document.createElement("div");
    t.className = "target"; t.style.cursor = "default";
    t.style.left = (cx * 100) + "vw"; t.style.top = (cy * 100) + "vh";
    t.textContent = "●";
    app.appendChild(t);
    const preds = [];
    const iv = setInterval(() => { const f = latestFeatures(); if (f && W) preds.push(predict(W, f)); }, 40);
    setTimeout(() => { clearInterval(iv); resolve(preds); }, ms);
  });
}

// Drift/ofset olcumu (spec §12 bilinen hedef): gercek serbest-izleme hatasi +
// sistematik kayma. Kayma sabitse tum ornekten cikarilir.
async function driftCheck() {
  screen("<h2>Hızlı doğruluk ölçümü</h2>" +
    "<p>Birazdan beliren noktalara sırayla <strong>bakın</strong> (tıklamaya gerek yok).</p>");
  await sleep(1600);
  const grid = [0.2, 0.5, 0.8];
  const pts = [];
  for (const y of grid) for (const x of grid) pts.push([x, y]);

  const vw = window.innerWidth, vh = window.innerHeight;
  const diffs = [];
  let quadOK = 0, quadN = 0;   // RQ1 kadran dogrulugu (kose hedeflerinde)
  for (const [cx, cy] of pts) {
    const preds = await passiveTarget(cx, cy, 1300);
    if (preds.length >= 3) {
      const tail = preds.slice(Math.floor(preds.length * 0.4));
      const px = median(tail.map((p) => p[0])), py = median(tail.map((p) => p[1]));
      diffs.push([px - cx, py - cy]);
      // Kadran dogrulugu: yalniz kose hedefleri (cx,cy != 0.5)
      if (cx !== 0.5 && cy !== 0.5) {
        quadN++;
        if ((px < 0.5) === (cx < 0.5) && (py < 0.5) === (cy < 0.5)) quadOK++;
      }
    }
  }
  app.innerHTML = "";
  if (!diffs.length) { gazeOffset = [0, 0]; return null; }

  const ox = diffs.reduce((a, d) => a + d[0], 0) / diffs.length;
  const oy = diffs.reduce((a, d) => a + d[1], 0) / diffs.length;
  gazeOffset = [ox, oy];
  const rawPx = Math.sqrt(diffs.reduce((a, d) => a + (d[0] * vw) ** 2 + (d[1] * vh) ** 2, 0) / diffs.length);
  const corrPx = Math.sqrt(diffs.reduce((a, d) => a + ((d[0] - ox) * vw) ** 2 + ((d[1] - oy) * vh) ** 2, 0) / diffs.length);
  const info = {
    raw_px: +rawPx.toFixed(1), corr_px: +corrPx.toFixed(1),
    offset: [+ox.toFixed(4), +oy.toFixed(4)],
    quadrant_accuracy: quadN ? +(quadOK / quadN).toFixed(3) : null,
  };
  console.log("Drift/ofset/kadran:", info);
  return info;
}

async function runMaterials(idx) {
  if (idx >= ordered.length) { finishAndUpload(); return; }
  const mat = ordered[idx];
  // odak artisi
  app.innerHTML = '<div class="fix">+</div>';
  await sleep(1000);
  // materyal
  await showMaterial(mat);
  // RQ3: materyalden sonra Leppink anketi
  if (leppinkItems && leppinkItems.length) await leppinkSurvey(mat);
  // ara kontrol (her 3 materyalde bir)
  if ((idx + 1) % 3 === 0 && idx + 1 < ordered.length) {
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
    const isVideo = mat.kind === "video" && mat.video;
    if (isVideo) {
      app.innerHTML =
        '<div class="matwrap"><video id="mat" src="' + mat.video + '" autoplay playsinline ' +
        'style="max-width:100vw;max-height:88vh"></video>' +
        '<div class="alt"><button id="devam" disabled>Videoyu izleyin…</button></div></div>';
    } else {
      app.innerHTML =
        '<div class="matwrap"><img id="mat" src="' + mat.src + '" alt="materyal">' +
        '<div class="alt"><button id="devam">Devam</button></div></div>';
    }
    const el = document.getElementById("mat");
    const devamBtn = document.getElementById("devam");
    let box = null, samples = [];
    const start = performance.now();
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) box = r; };

    if (isVideo) {
      // Video bitince "Devam" etkinlesir
      el.addEventListener("ended", () => { devamBtn.disabled = false; devamBtn.textContent = "Devam"; }, { once: true });
      el.addEventListener("loadedmetadata", measure, { once: true });
    }

    const capture = setInterval(() => {
      const f = latestFeatures();
      if (!f || !W) return;
      if (!box) measure();
      const [gx0, gy0] = predict(W, f);
      // Sistematik kaymayi cikar (drift olcumunden)
      const gx = gx0 - gazeOffset[0], gy = gy0 - gazeOffset[1];
      const xpx = gx * window.innerWidth, ypx = gy * window.innerHeight;
      let xn = null, yn = null, inm = false;
      if (box && box.width > 0) {
        xn = +((xpx - box.left) / box.width).toFixed(4);
        yn = +((ypx - box.top) / box.height).toFixed(4);
        inm = xn >= 0 && xn <= 1 && yn >= 0 && yn <= 1;
      }
      samples.push({ material_id: mat.id, t: Math.round(performance.now() - start), x_px: Math.round(xpx), y_px: Math.round(ypx), x_norm: xn, y_norm: yn, in_material: inm });
    }, 40);

    if (!isVideo) {
      if (el.complete && el.naturalWidth) measure();
      else el.addEventListener("load", measure, { once: true });
    }

    devamBtn.onclick = () => {
      if (devamBtn.disabled) return;   // video bitmeden gecilmez
      clearInterval(capture);
      for (const s of samples) allSamples.push(s);
      resolve();
    };
  });
}

// RQ3: Leppink bilissel yuk anketi (plain DOM, 10 madde 0-10)
function leppinkSurvey(mat) {
  return new Promise((resolve) => {
    let html = '<div class="kart" style="max-width:780px;text-align:left;max-height:90vh;overflow:auto">' +
      '<h2>Kısa anket</h2><p style="color:#bcd">Az önceki materyali düşünerek her ifadeye ' +
      '<strong>0 (hiç) – 10 (tamamen)</strong> arası puan verin.</p><form id="lep">';
    leppinkItems.forEach((text, i) => {
      html += '<div style="margin:.7rem 0"><div style="margin-bottom:.2rem">' + (i + 1) + '. ' + escEl(text) + '</div>' +
        '<input type="range" name="q' + i + '" min="0" max="10" step="1" value="5" ' +
        'oninput="this.nextElementSibling.textContent=this.value" style="width:70%"> ' +
        '<span>5</span></div>';
    });
    html += '<div style="margin-top:1rem"><button type="submit">Devam</button></div></form></div>';
    app.innerHTML = html;
    document.getElementById("lep").addEventListener("submit", (e) => {
      e.preventDefault();
      const scores = leppinkItems.map((_, i) => {
        const v = e.target["q" + i]; return v ? parseInt(v.value, 10) : null;
      });
      cogLoad.push({ material_id: mat.id, scores: scores });
      resolve();
    });
  });
}

function escEl(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function uploadCogLoad(sid) {
  if (!api.load_tmpl || !cogLoad.length) return Promise.resolve();
  const url = api.load_tmpl.replace("__ID__", sid);
  return Promise.all(cogLoad.map((c) =>
    postWithRetry(url, { material_id: c.material_id, scores: c.scores }, 2)
      .catch((e) => console.error("Leppink gonderimi:", e))));
}

function finishAndUpload() {
  screen("<h2>Veriler kaydediliyor…</h2><p>Lutfen pencereyi kapatmayin.</p>");
  const payload = {
    calibrations: (validationResult ? [validationResult] : []).concat(midChecks),
    samples: allSamples,
    meta: {
      app_version: APP_VERSION,
      gaze_engine: USE_ENSEMBLE ? "ensemble" : "mediapipe",
      view_weights: W ? lastWeights(W) : null,   // ensemble'da [A,B,C], tekte null
      validation_px: validationResult ? validationResult.avg_error_px : null,
      calib_attempts: calibAttempt,
      // Gercek serbest-izleme hatasi (drift olcumu) + uygulanan ofset
      drift_raw_px: driftInfo ? driftInfo.raw_px : null,
      drift_corr_px: driftInfo ? driftInfo.corr_px : null,
      drift_offset: driftInfo ? driftInfo.offset : null,
      quadrant_accuracy: driftInfo ? driftInfo.quadrant_accuracy : null,
      presentation_order: presentationOrder,  // {material_id: gosterim sirasi}
    },
  };
  sessionPromise.then((sid) => {
    if (!sid) throw new Error("Oturum yok");
    return postWithRetry(api.data_tmpl.replace("__ID__", sid), payload, 3)
      .then((res) => uploadCogLoad(sid).then(() =>
        postWithRetry(api.finish_tmpl.replace("__ID__", sid), { status: "completed" }, 3).then(() => res)));
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

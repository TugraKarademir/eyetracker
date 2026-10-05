/*
 * Makine kalifikasyonu (Faz 11) — her yeni PC'de BİR KEZ, kurulumu yapan kişi.
 *
 * Bu bilgisayarın kamerası/ekranı/ışığıyla gerekli doğruluk yakalanıyor mu diye
 * ölçer. GEÇERSE localStorage'a "uygun" yazar -> katılımcı oturumları ancak uygun
 * makinelerde çalışır (study.js / study_mp.js bu bayrağı kontrol eder).
 * KALIRSA bu bilgisayarda çalışılmaması gerektiğini bildirir.
 *
 * KURAL (spec §6/§15): kamera görüntüsü tarayıcıdan çıkmaz.
 */
import { start as startEngine, latestFeatures, faceOk, fit, predict } from "./gaze/mediapipe_engine.js";

export const QUAL_KEY = "machine_qualified_v1";

// Eşikler (bu makinenin "yeterli" sayılması için)
const MIN_CAM_W = 640;        // kamera genişliği en az
const REC_CAM_W = 1280;       // önerilen
const MIN_QUADRANT = 0.75;    // kadran doğruluğu (4 köşeden en az 3)
const MAX_ERR_RATIO = 0.10;   // doğrulama hatası ≤ ekran genişliğinin %10'u

const CALIB = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08], [0.3, 0.3], [0.7, 0.3],
  [0.08, 0.5], [0.5, 0.5], [0.92, 0.5], [0.3, 0.7], [0.7, 0.7],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];
const TARGETS = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.5, 0.5]];

const app = document.getElementById("app");
const video = document.getElementById("cam");
let W = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
function screenEl(html) { app.innerHTML = '<div class="kart">' + html + "</div>"; }

function showTarget(cx, cy, label, clickable) {
  return new Promise((resolve) => {
    app.innerHTML = "";
    const t = document.createElement("div");
    t.className = "target"; t.textContent = label;
    t.style.left = (cx * 100) + "vw"; t.style.top = (cy * 100) + "vh";
    if (!clickable) t.style.cursor = "default";
    if (clickable) t.addEventListener("click", resolve);
    app.appendChild(t);
    if (!clickable) resolve.__el = t;  // pasif: cagiran kapatir
  });
}
async function collect(cx, cy, ms) {
  app.innerHTML = "";
  const t = document.createElement("div");
  t.className = "target"; t.textContent = "●"; t.style.cursor = "default";
  t.style.left = (cx * 100) + "vw"; t.style.top = (cy * 100) + "vh";
  app.appendChild(t);
  const buf = []; const t0 = performance.now();
  while (performance.now() - t0 < ms) { const f = latestFeatures(); if (f) buf.push(f); await sleep(25); }
  return buf;
}

function cameraRes() {
  try {
    const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
    const s = tr ? tr.getSettings() : {};
    return { w: s.width || 0, h: s.height || 0, label: tr ? tr.label : "" };
  } catch (e) { return { w: 0, h: 0, label: "" }; }
}

async function calibrate() {
  const rows = [];
  for (let i = 0; i < CALIB.length; i++) {
    const [cx, cy] = CALIB[i];
    await showTarget(cx, cy, String(i + 1), true);
    const buf = await collect(cx, cy, 450);
    if (buf.length) { const D = buf[0].length; rows.push({ f: Array.from({ length: D }, (_, k) => median(buf.map((v) => v[k]))), x: cx, y: cy }); }
  }
  if (rows.length < 6) return false;
  W = fit(rows); return true;
}

async function accuracyTest() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let sx = 0, sy = 0, n = 0, quadOK = 0, quadN = 0;
  for (const [cx, cy] of TARGETS) {
    const buf = await collect(cx, cy, 1000);
    const preds = buf.map((f) => predict(W, f));
    if (preds.length) {
      const px = median(preds.map((p) => p[0])), py = median(preds.map((p) => p[1]));
      sx += Math.abs(px - cx) * vw; sy += Math.abs(py - cy) * vh; n++;
      if (cx !== 0.5 && cy !== 0.5) { quadN++; if ((px < 0.5) === (cx < 0.5) && (py < 0.5) === (cy < 0.5)) quadOK++; }
    }
  }
  return { err_px: n ? +(((sx + sy) / 2) / n).toFixed(1) : null, quadrant: quadN ? +(quadOK / quadN).toFixed(3) : null };
}

function evaluate(cam, acc) {
  const vw = window.innerWidth;
  const reasons = [];
  if (cam.w < MIN_CAM_W) reasons.push("Kamera çözünürlüğü düşük (" + cam.w + "px < " + MIN_CAM_W + ")");
  if (acc.quadrant == null || acc.quadrant < MIN_QUADRANT) reasons.push("Kadran doğruluğu düşük (" + (acc.quadrant != null ? Math.round(acc.quadrant * 100) : "?") + "% < " + MIN_QUADRANT * 100 + "%)");
  if (acc.err_px == null || acc.err_px > MAX_ERR_RATIO * vw) reasons.push("Doğrulama hatası yüksek (" + acc.err_px + "px > %" + MAX_ERR_RATIO * 100 + ")");
  return { qualified: reasons.length === 0, reasons };
}

function storeResult(obj) {
  try { localStorage.setItem(QUAL_KEY, JSON.stringify(obj)); } catch (e) {}
}

async function run() {
  screenEl("<h2>Makine kurulumu</h2><p>Bu bilgisayarın kamerası, ekranı ve ışığıyla gerekli doğruluk sağlanıyor mu kontrol edilecek. Model/kamera yükleniyor…</p>");
  try { await startEngine(video); } catch (e) { screenEl("<h2>Kamera/model hatası</h2><p>" + e.message + "</p>"); return; }

  const cam = cameraRes();
  const scr = { w: screen.width, h: screen.height, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1 };

  screenEl("<h2>Hazır</h2>" +
    "<p>Kamera: <b>" + cam.w + "×" + cam.h + "</b>" + (cam.w < REC_CAM_W ? " (önerilen ≥ " + REC_CAM_W + ")" : " ✓") + "</p>" +
    "<p>Ekran: " + scr.w + "×" + scr.h + " · görüntü alanı " + scr.vw + "×" + scr.vh + "</p>" +
    "<p><strong>En iyi ışık</strong> (önden), kameraya ~50cm, baş sabit olacak şekilde ayarlayın.</p>" +
    '<button id="go">Kalibrasyona başla</button>');
  await new Promise((r) => { document.getElementById("go").onclick = r; });

  // Yüz bekle
  screenEl("<h2>Yüz konumlandırma</h2><p>Yüzünüzü kamerada ortalayın…</p>");
  for (let i = 0; i < 100 && !faceOk(); i++) await sleep(100);

  if (!(await calibrate())) { finalFail(cam, scr, { err_px: null, quadrant: null }, ["Kalibrasyon tamamlanamadı (yüz bulunamadı)"]); return; }
  const acc = await accuracyTest();
  const verdict = evaluate(cam, acc);

  const record = {
    qualified: verdict.qualified, date: new Date().toISOString(),
    camera: cam, screen: scr, accuracy: acc, reasons: verdict.reasons,
  };
  storeResult(record);

  if (verdict.qualified) {
    screenEl("<h2 style='color:#7fe3a0'>✓ Bu bilgisayar UYGUN</h2>" +
      "<p>Doğruluk: ~%" + Math.round((1 - acc.err_px / scr.vw) * 100) + " · kadran %" + Math.round(acc.quadrant * 100) +
      " · hata " + acc.err_px + "px · kamera " + cam.w + "×" + cam.h + "</p>" +
      "<p>Kurulum kaydedildi. Artık katılımcı oturumlarını bu bilgisayarda çalıştırabilirsiniz.</p>");
  } else {
    finalFail(cam, scr, acc, verdict.reasons);
  }
}

function finalFail(cam, scr, acc, reasons) {
  storeResult({ qualified: false, date: new Date().toISOString(), camera: cam, screen: scr, accuracy: acc, reasons });
  screenEl("<h2 style='color:#ff9a9a'>✗ Bu bilgisayar UYGUN DEĞİL</h2>" +
    "<p>Gerekli doğruluk sağlanamadı:</p><ul style='text-align:left'>" +
    reasons.map((r) => "<li>" + r + "</li>").join("") + "</ul>" +
    "<p>Işığı/kamera konumunu/mesafeyi iyileştirip <strong>tekrar deneyin</strong>, " +
    "ya da <strong>başka bir bilgisayar</strong> kullanın. Düzelmezse bu bilgisayarda katılımcı oturumu alınmamalıdır.</p>" +
    '<button onclick="location.reload()">Tekrar dene</button>');
}

run().catch((e) => { screenEl("<h2>Hata</h2><p>" + e.message + "</p>"); console.error(e); });

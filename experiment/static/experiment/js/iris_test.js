/*
 * MediaPipe Iris gaze PROTOTIPI (tani sayfasi) — Faz 7.
 * Ortak motoru (gaze/mediapipe_engine.js) kullanir; kalibrasyon kalitesini
 * ve YATAY dogrulugu bu donanimda olcmek icin.
 * KURAL (spec §6/§15): kamera goruntusu tarayicidan cikmaz.
 */
import { start, latestFeatures, faceOk, fit, predict } from "./gaze/mediapipe_engine.js";

const CALIB_POINTS = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.3, 0.3], [0.7, 0.3],
  [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
  [0.3, 0.7], [0.7, 0.7],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];

const video = document.getElementById("cam");
const dot = document.getElementById("gaze");
const statusEl = document.getElementById("durum");
const calibLayer = document.getElementById("calib");
const metricsEl = document.getElementById("metrik");

let W = null, predEMA = null, running = true;

function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function liveLoop() {
  if (!running) return;
  const f = latestFeatures();
  if (W && f) {
    const [px, py] = predict(W, f);
    predEMA = predEMA ? [predEMA[0] * 0.7 + px * 0.3, predEMA[1] * 0.7 + py * 0.3] : [px, py];
    dot.style.left = (predEMA[0] * 100) + "vw";
    dot.style.top = (predEMA[1] * 100) + "vh";
    dot.style.display = "block";
  }
  requestAnimationFrame(liveLoop);
}

function showTarget(cx, cy, n) {
  return new Promise((resolve) => {
    calibLayer.innerHTML = "";
    const t = document.createElement("div");
    t.className = "target";
    t.style.left = (cx * 100) + "vw";
    t.style.top = (cy * 100) + "vh";
    t.textContent = n;
    t.addEventListener("click", resolve);
    calibLayer.appendChild(t);
  });
}

async function calibrate() {
  if (!faceOk()) { statusEl.textContent = "Yuz bulunamadi — isiga/mesafeye bakin."; return; }
  W = null; dot.style.display = "none";
  const rows = [];
  for (let i = 0; i < CALIB_POINTS.length; i++) {
    const [cx, cy] = CALIB_POINTS[i];
    await showTarget(cx, cy, i + 1);
    const t0 = performance.now(); const buf = [];
    while (performance.now() - t0 < 500) { const f = latestFeatures(); if (f) buf.push(f); await sleep(30); }
    if (buf.length) {
      const D = buf[0].length;
      rows.push({ f: Array.from({ length: D }, (_, k) => median(buf.map((v) => v[k]))), x: cx, y: cy });
    }
  }
  calibLayer.innerHTML = "";
  if (rows.length < 6) { statusEl.textContent = "Yeterli veri yok, tekrar deneyin."; return; }
  W = fit(rows);
  statusEl.textContent = "Kalibre edildi. Kirmizi nokta bakisini izlemeli. Sonra DOGRULUK TESTI.";
}

async function accuracyTest() {
  if (!W) { statusEl.textContent = "Once kalibre edin."; return; }
  const pts = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]];
  const vw = window.innerWidth, vh = window.innerHeight;
  let sx = 0, sy = 0, n = 0;
  for (const [cx, cy] of pts) {
    await showTarget(cx, cy, "●");
    const t0 = performance.now(); const preds = [];
    while (performance.now() - t0 < 900) { const f = latestFeatures(); if (f) preds.push(predict(W, f)); await sleep(30); }
    if (preds.length) {
      sx += Math.abs(median(preds.map((p) => p[0])) - cx) * vw;
      sy += Math.abs(median(preds.map((p) => p[1])) - cy) * vh; n++;
    }
  }
  calibLayer.innerHTML = "";
  if (n) {
    metricsEl.innerHTML = `Ortalama hata — yatay: <b>${(sx / n).toFixed(0)}px</b> · dikey: <b>${(sy / n).toFixed(0)}px</b> ` +
      `(dusuk daha iyi; WebGazer tipik ~130px).`;
    statusEl.textContent = "Dogruluk testi bitti.";
  }
}

document.getElementById("btn-calib").addEventListener("click", calibrate);
document.getElementById("btn-acc").addEventListener("click", accuracyTest);

statusEl.textContent = "Model/kamera yukleniyor…";
start(video).then(() => {
  statusEl.textContent = "Hazir. Once KALIBRE ET.";
  requestAnimationFrame(liveLoop);
}).catch((e) => { statusEl.textContent = "Hata: " + e.message; console.error(e); });

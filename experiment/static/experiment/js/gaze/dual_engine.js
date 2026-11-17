/*
 * Iki kamerali gaze motoru — Faz 12.
 *
 * Ekranin USTUNDE (A) ve ALTINDA (B) birer web kamerasi; her biri icin ayri
 * MediaPipe FaceLandmarker ve ayni bas-pozu normalize iris ozellikleri
 * (mediapipe_engine.features). Ayni kalibrasyon verisinden DORT tahminci:
 *
 *   a     : yalniz ust kamera ozellikleri (ridge)
 *   b     : yalniz alt kamera ozellikleri (ridge)
 *   late  : a ve b tahminlerinin agirlikli ortalamasi (agirlik = 1/CV-hata^2)
 *   early : iki kameranin ozellikleri BIRLESTIRILIP tek ridge (birincil)
 *
 * Ridge lambda'si her tahminci icin "bir kalibrasyon noktasini disarida birak"
 * (LOPO) capraz dogrulamayla secilir; ozellikler z-skorlanir. Calisma aninda
 * bir kamera yuzu kaybederse birincil tahmin digerine duser (fallback).
 * predictAll() dort tahmini birden dondurur -> runner hepsini kaydeder, boylece
 * dogruluk testi ayni oturumda ESLESTIRILMIS karsilastirma yapabilir.
 *
 * Arayuz mediapipe_engine ile ayni (start/faceOk/latestFeatures/fit/predict/
 * lastWeights); ozellik nesnesi dizi yerine {a, b} (biri null olabilir).
 *
 * KURAL (spec §6/§15): kamera goruntusu tarayicidan CIKMAZ.
 */
import { FaceLandmarker, FilesetResolver } from "/static/experiment/vendor/mediapipe/vision_bundle.mjs";
import { features, ridgeFit } from "./mediapipe_engine.js?v=12";

const WASM = "/static/experiment/vendor/mediapipe/wasm";
const MODEL = "/static/experiment/vendor/mediapipe/face_landmarker.task";
const LAMBDAS = [1e-3, 1e-2, 1e-1, 1, 10];
const STALE_MS = 150;   // bu sureden eski kamera ozelligi "yok" sayilir

const cams = { a: null, b: null };   // {video, landmarker, feat, ts}
let running = false;

// ---- kamera + model ----
async function openCam(fileset, deviceId, videoEl) {
  let landmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1,
    });
  } catch (e) {  // ikinci GPU baglami acilamazsa CPU
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" }, runningMode: "VIDEO", numFaces: 1,
    });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId }, width: 640, height: 480 },
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return { video: videoEl, landmarker, feat: null, ts: 0, label: stream.getVideoTracks()[0].label };
}

// opts: { deviceA, deviceB }  (A = ust, B = alt). videoEl A'nin onizlemesi.
export async function start(videoEl, opts) {
  if (!opts || !opts.deviceA || !opts.deviceB) throw new Error("Iki kamera secilmedi");
  if (opts.deviceA === opts.deviceB) throw new Error("Ust ve alt kamera ayni olamaz");
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const videoB = document.createElement("video");
  videoB.muted = true; videoB.playsInline = true;
  videoB.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(videoB);
  cams.a = await openCam(fileset, opts.deviceA, videoEl);
  cams.b = await openCam(fileset, opts.deviceB, videoB);
  running = true;
  requestAnimationFrame(loop);
}

function step(c) {
  if (!c || c.video.readyState < 2) return;
  const now = performance.now();
  const res = c.landmarker.detectForVideo(c.video, now);
  if (res && res.faceLandmarks && res.faceLandmarks.length) { c.feat = features(res.faceLandmarks[0]); c.ts = now; }
  else c.feat = null;
}
function loop() {
  if (!running) return;
  step(cams.a); step(cams.b);
  requestAnimationFrame(loop);
}

function fresh(c) { return c && c.feat && performance.now() - c.ts < STALE_MS ? c.feat : null; }

export function stop() { running = false; }
export function cameraLabels() { return { a: cams.a && cams.a.label, b: cams.b && cams.b.label }; }
export function faceStatus() { return { a: !!fresh(cams.a), b: !!fresh(cams.b) }; }
export function faceOk() { const s = faceStatus(); return s.a && s.b; }
export function latestFeatures() {
  const a = fresh(cams.a), b = fresh(cams.b);
  return a || b ? { a, b } : null;
}

// ---- ozellik vektorleri (bias haric) ----
const noBias = (f) => f.slice(0, -1);
const VIEWS = {
  a: (f) => (f.a ? noBias(f.a) : null),
  b: (f) => (f.b ? noBias(f.b) : null),
  early: (f) => (f.a && f.b ? noBias(f.a).concat(noBias(f.b)) : null),
};

function zscore(X) {
  const D = X[0].length, N = X.length;
  const mu = Array(D).fill(0), sd = Array(D).fill(0);
  for (const r of X) for (let i = 0; i < D; i++) mu[i] += r[i] / N;
  for (const r of X) for (let i = 0; i < D; i++) sd[i] += (r[i] - mu[i]) ** 2 / N;
  for (let i = 0; i < D; i++) sd[i] = Math.sqrt(sd[i]) || 1;
  return { mu, sd };
}
const applyZ = (v, z) => v.map((x, i) => (x - z.mu[i]) / z.sd[i]).concat([1]);
const dot = (w, v) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * v[i]; return s; };

function fitModel(rows, lambda) {
  const z = zscore(rows.map((r) => r.v));
  const X = rows.map((r) => applyZ(r.v, z));
  return { z, Wx: ridgeFit(X, rows.map((r) => r.x), lambda), Wy: ridgeFit(X, rows.map((r) => r.y), lambda) };
}
function predModel(m, v) { const u = applyZ(v, m.z); return [dot(m.Wx, u), dot(m.Wy, u)]; }

// Bir kalibrasyon noktasini disarida birak: ortalama hata (viewport genisligi birimi)
function lopoError(rows, lambda, aspect) {
  const pids = [...new Set(rows.map((r) => r.pid))];
  let sum = 0, n = 0;
  for (const p of pids) {
    const tr = rows.filter((r) => r.pid !== p), te = rows.filter((r) => r.pid === p);
    if (tr.length < 10 || !te.length) continue;
    const m = fitModel(tr, lambda);
    for (const r of te) { const [px, py] = predModel(m, r.v); sum += Math.hypot(px - r.x, (py - r.y) * aspect); n++; }
  }
  return n ? sum / n : Infinity;
}

// rows: [{ f:{a,b}, x, y, pid }]  (pid = kalibrasyon noktasi; kare-bazli satirlar)
export function fit(rows) {
  const aspect = window.innerHeight / window.innerWidth;
  const W = { models: {}, cv: {}, lambda: {}, late: null };
  for (const [name, view] of Object.entries(VIEWS)) {
    const r = rows.map((q) => ({ v: view(q.f), x: q.x, y: q.y, pid: q.pid })).filter((q) => q.v);
    if (r.length < 20) continue;
    let best = null;
    for (const lam of LAMBDAS) {
      const e = lopoError(r, lam, aspect);
      if (!best || e < best.e) best = { lam, e };
    }
    W.models[name] = fitModel(r, best.lam);
    W.cv[name] = +best.e.toFixed(4);
    W.lambda[name] = best.lam;
  }
  if (W.cv.a && W.cv.b) {
    const wa = 1 / W.cv.a ** 2, wb = 1 / W.cv.b ** 2;
    W.late = { wa: wa / (wa + wb), wb: wb / (wa + wb) };
  }
  console.log("Iki kamera kalibrasyonu (LOPO hata, genislik orani):", W.cv, "lambda:", W.lambda, "gec fuzyon:", W.late);
  return W;
}

const clamp = (p) => (p ? [Math.max(0, Math.min(1, p[0])), Math.max(0, Math.min(1, p[1]))] : null);

export function predictAll(W, f) {
  const out = { a: null, b: null, late: null, early: null };
  for (const name of ["a", "b", "early"]) {
    const v = VIEWS[name](f);
    if (v && W.models[name]) out[name] = clamp(predModel(W.models[name], v));
  }
  if (out.a && out.b && W.late) {
    out.late = [W.late.wa * out.a[0] + W.late.wb * out.b[0], W.late.wa * out.a[1] + W.late.wb * out.b[1]];
  }
  return out;
}

// Birincil tahmin: erken fuzyon; bir kamera yuzu kaybederse digeri.
export function predict(W, f) {
  const p = predictAll(W, f);
  return p.early || p.late || p.a || p.b || [0.5, 0.5];
}

export function lastWeights(W) {
  return W ? { cv: W.cv, lambda: W.lambda, late: W.late } : null;
}

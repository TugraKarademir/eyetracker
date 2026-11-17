/*
 * MediaPipe Iris gaze motoru (ortak modul) — Faz 7.
 *
 * Tarayici-ici FaceLandmarker (478 landmark + iris) ile bas-pozu normalize
 * ozellikler + ridge regresyon kalibrasyonu. Hem /iris-test/ tani sayfasi hem
 * de calisma runner'i (study_mp.js) bu TEK kaynagi kullanir.
 *
 * KURAL (spec §6/§15): Kamera goruntusu tarayicidan CIKMAZ; her sey yereldir.
 */
// Yerel (vendor) MediaPipe — internet gerektirmez (offline). Django static altinda.
import { FaceLandmarker, FilesetResolver } from "/static/experiment/vendor/mediapipe/vision_bundle.mjs";

const WASM = "/static/experiment/vendor/mediapipe/wasm";
const MODEL = "/static/experiment/vendor/mediapipe/face_landmarker.task";

// MediaPipe FaceLandmarker (478) landmark indexleri
const R = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const L = { inner: 362, outer: 263, top: 386, bottom: 374, iris: 473 };
const NOSE = 1, FACE_L = 234, FACE_R = 454, FORE = 10, CHIN = 152, BROW = 168;
const RIDGE_LAMBDA = 1e-3;

let landmarker = null;
let video = null;
let latestFeat = null;
let latestLM = null;   // ham landmark dizisi (ensemble icin)
let running = false;
const featBuf = [];

// ---- ozellik cikarimi (bas-pozu normalize) ----
export function features(lm) {
  const p = (i) => lm[i];
  const faceW = Math.hypot(p(FACE_R).x - p(FACE_L).x, p(FACE_R).y - p(FACE_L).y) || 1e-6;
  const faceH = Math.hypot(p(CHIN).x - p(FORE).x, p(CHIN).y - p(FORE).y) || 1e-6;
  const eye = (E) => {
    const w = (p(E.outer).x - p(E.inner).x) || 1e-6;
    const h = (p(E.bottom).y - p(E.top).y) || 1e-6;
    return [(p(E.iris).x - p(E.inner).x) / w, (p(E.iris).y - p(E.top).y) / h];
  };
  const [rxR, ryR] = eye(R);
  const [rxL, ryL] = eye(L);
  const midEyeX = (p(FACE_L).x + p(FACE_R).x) / 2;
  const yaw = (p(NOSE).x - midEyeX) / faceW;
  const pitch = (p(NOSE).y - p(BROW).y) / faceH;
  return [rxR, ryR, rxL, ryL, yaw, pitch, 1]; // son eleman bias
}

// ---- ridge regresyon (kucuk matris) ----
function matMulT(A) {
  const N = A.length, D = A[0].length;
  const M = Array.from({ length: D }, () => new Float64Array(D));
  for (let n = 0; n < N; n++) {
    const row = A[n];
    for (let i = 0; i < D; i++) { const ri = row[i]; for (let j = 0; j < D; j++) M[i][j] += ri * row[j]; }
  }
  return M;
}
function matTvec(A, y) {
  const N = A.length, D = A[0].length;
  const v = new Float64Array(D);
  for (let n = 0; n < N; n++) for (let i = 0; i < D; i++) v[i] += A[n][i] * y[n];
  return v;
}
function solve(M, b) {
  const D = b.length;
  const A = M.map((r, i) => Float64Array.from([...r, b[i]]));
  for (let c = 0; c < D; c++) {
    let pr = c;
    for (let r = c + 1; r < D; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
    [A[c], A[pr]] = [A[pr], A[c]];
    const piv = A[c][c] || 1e-9;
    for (let k = c; k <= D; k++) A[c][k] /= piv;
    for (let r = 0; r < D; r++) { if (r === c) continue; const f = A[r][c]; for (let k = c; k <= D; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r) => r[D]);
}
export function ridgeFit(X, y, lambda = RIDGE_LAMBDA) {
  const D = X[0].length;
  const M = matMulT(X);
  for (let i = 0; i < D - 1; i++) M[i][i] += lambda;
  return solve(M, matTvec(X, y));
}
function median(arr) { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

// ---- kamera + model ----
export async function start(videoEl) {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  video = videoEl;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await video.play();
  running = true;
  requestAnimationFrame(loop);
}

function loop() {
  if (!running) return;
  if (video && video.readyState >= 2) {
    const res = landmarker.detectForVideo(video, performance.now());
    if (res && res.faceLandmarks && res.faceLandmarks.length) {
      latestLM = res.faceLandmarks[0];
      latestFeat = features(latestLM);
      featBuf.push(latestFeat);
      if (featBuf.length > 10) featBuf.shift();
    } else {
      latestFeat = null;
      latestLM = null;
    }
  }
  requestAnimationFrame(loop);
}

export function stop() { running = false; }
export function faceOk() { return latestFeat != null; }
export function latestFeatures() { return latestFeat; }
export function latestLandmarks() { return latestLM; }
export function lastWeights() { return null; } // arayuz paritesi (ensemble ile)
export function stableFeatures() {
  if (!featBuf.length) return latestFeat;
  const D = featBuf[0].length;
  return Array.from({ length: D }, (_, i) => median(featBuf.map((f) => f[i])));
}

// rows: [{ f:[...], x:0-1, y:0-1 }]  -> { Wx, Wy }
export function fit(rows) {
  const X = rows.map((r) => r.f);
  return { Wx: ridgeFit(X, rows.map((r) => r.x)), Wy: ridgeFit(X, rows.map((r) => r.y)) };
}
export function predict(W, f) {
  const d = (w) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * f[i]; return s; };
  return [Math.max(0, Math.min(1, d(W.Wx))), Math.max(0, Math.min(1, d(W.Wy)))];
}

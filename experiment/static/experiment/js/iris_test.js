/*
 * MediaPipe Iris tabanli gaze PROTOTIPI (tani sayfasi) — Faz 7 arastirmasi.
 *
 * Amac: WebGazer yerine tarayici-ici iris landmark'lariyla gaze kestiriminin
 * (ozellikle YATAY) bu donanimda daha iyi olup olmadigini CANLI olcmek.
 *
 * KURAL (spec §6/§15): Kamera goruntusu tarayicidan CIKMAZ. Tum isleme yereldir;
 * hicbir goruntu/kare sunucuya gonderilmez veya kaydedilmez. Yalnizca ekranda
 * canli geri bildirim gosterilir.
 *
 * Yontem: FaceLandmarker (478 landmark + iris) -> bas-pozu normalize iris
 * ozellikleri -> 9 nokta tiklamali kalibrasyon -> ridge regresyon (ozellik ->
 * ekran x,y). Bu, WebGazer'in yaptiginin iris landmark'lariyla guclendirilmis hali.
 */
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Landmark indexleri (MediaPipe FaceLandmarker 478)
const R = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const L = { inner: 362, outer: 263, top: 386, bottom: 374, iris: 473 };
const NOSE = 1, FACE_L = 234, FACE_R = 454, FORE = 10, CHIN = 152, BROW = 168;

const RIDGE_LAMBDA = 1e-3;
const CALIB_POINTS = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];

const video = document.getElementById("cam");
const dot = document.getElementById("gaze");
const statusEl = document.getElementById("durum");
const calibLayer = document.getElementById("calib");
const metricsEl = document.getElementById("metrik");

let landmarker = null;
let latestFeat = null;     // en guncel ozellik vektoru
const featBuf = [];        // son N ozellik (medyan icin)
let Wx = null, Wy = null;  // regresyon agirliklari
let predEMA = null;        // yumusatilmis tahmin
let running = false;

// ---- küçük matris yardimcilari (ridge regresyon icin) ----
function matMulT(A) { // A^T A  (A: N x D) -> D x D
  const N = A.length, D = A[0].length;
  const M = Array.from({ length: D }, () => new Float64Array(D));
  for (let n = 0; n < N; n++) {
    const row = A[n];
    for (let i = 0; i < D; i++) {
      const ri = row[i];
      for (let j = 0; j < D; j++) M[i][j] += ri * row[j];
    }
  }
  return M;
}
function matTvec(A, y) { // A^T y (A: N x D, y: N) -> D
  const N = A.length, D = A[0].length;
  const v = new Float64Array(D);
  for (let n = 0; n < N; n++) for (let i = 0; i < D; i++) v[i] += A[n][i] * y[n];
  return v;
}
function solve(M, b) { // Gauss-Jordan: M x = b
  const D = b.length;
  const A = M.map((r, i) => Float64Array.from([...r, b[i]]));
  for (let c = 0; c < D; c++) {
    let p = c;
    for (let r = c + 1; r < D; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c] || 1e-9;
    for (let k = c; k <= D; k++) A[c][k] /= piv;
    for (let r = 0; r < D; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = c; k <= D; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r) => r[D]);
}
function ridgeFit(X, y) {
  const D = X[0].length;
  const M = matMulT(X);
  for (let i = 0; i < D - 1; i++) M[i][i] += RIDGE_LAMBDA; // bias'a ceza yok
  return solve(M, matTvec(X, y));
}
function dot1(w, f) { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * f[i]; return s; }
function median(arr) { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

// ---- ozellik cikarimi (bas-pozu normalize) ----
function features(lm) {
  const p = (i) => lm[i];
  const faceW = Math.hypot(p(FACE_R).x - p(FACE_L).x, p(FACE_R).y - p(FACE_L).y) || 1e-6;
  const faceH = Math.hypot(p(CHIN).x - p(FORE).x, p(CHIN).y - p(FORE).y) || 1e-6;

  const eyeRatio = (E) => {
    const w = (p(E.outer).x - p(E.inner).x) || 1e-6;
    const h = (p(E.bottom).y - p(E.top).y) || 1e-6;
    const rx = (p(E.iris).x - p(E.inner).x) / w;  // yatay iris orani
    const ry = (p(E.iris).y - p(E.top).y) / h;    // dikey iris orani
    return [rx, ry];
  };
  const [rxR, ryR] = eyeRatio(R);
  const [rxL, ryL] = eyeRatio(L);

  const midEyeX = (p(FACE_L).x + p(FACE_R).x) / 2;
  const yaw = (p(NOSE).x - midEyeX) / faceW;         // bas sag/sol
  const pitch = (p(NOSE).y - p(BROW).y) / faceH;     // bas yukari/asagi

  // ozellik vektoru (son eleman bias)
  return [rxR, ryR, rxL, ryL, yaw, pitch, 1];
}

// ---- kamera + model ----
async function init() {
  statusEl.textContent = "Model yukleniyor…";
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });

  statusEl.textContent = "Kamera aciliyor…";
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await video.play();

  running = true;
  statusEl.textContent = "Hazir. Once KALIBRE ET.";
  requestAnimationFrame(loop);
}

function loop() {
  if (!running) return;
  if (video.readyState >= 2) {
    const res = landmarker.detectForVideo(video, performance.now());
    if (res && res.faceLandmarks && res.faceLandmarks.length) {
      const f = features(res.faceLandmarks[0]);
      latestFeat = f;
      featBuf.push(f);
      if (featBuf.length > 10) featBuf.shift();

      if (Wx && Wy) {
        const px = Math.max(0, Math.min(1, dot1(Wx, f)));
        const py = Math.max(0, Math.min(1, dot1(Wy, f)));
        predEMA = predEMA
          ? [predEMA[0] * 0.7 + px * 0.3, predEMA[1] * 0.7 + py * 0.3]
          : [px, py];
        dot.style.left = (predEMA[0] * 100) + "vw";
        dot.style.top = (predEMA[1] * 100) + "vh";
        dot.style.display = "block";
      }
    }
  }
  requestAnimationFrame(loop);
}

// medyan ozellik (son ~10 kare) — tiklama aninda gurultuyu azalt
function stableFeat() {
  if (!featBuf.length) return latestFeat;
  const D = featBuf[0].length;
  return Array.from({ length: D }, (_, i) => median(featBuf.map((f) => f[i])));
}

// ---- kalibrasyon ----
async function calibrate() {
  if (!latestFeat) { statusEl.textContent = "Yuz bulunamadi — isiga/mesafeye bakin."; return; }
  Wx = Wy = null; dot.style.display = "none";
  const X = [], ox = [], oy = [];

  for (let i = 0; i < CALIB_POINTS.length; i++) {
    const [cx, cy] = CALIB_POINTS[i];
    await showTarget(cx, cy, i + 1);
    // hedefe bakarken ~500ms ozellik topla
    const t0 = performance.now();
    const collected = [];
    while (performance.now() - t0 < 500) {
      if (latestFeat) collected.push(latestFeat);
      await sleep(30);
    }
    if (collected.length) {
      const D = collected[0].length;
      const med = Array.from({ length: D }, (_, k) => median(collected.map((f) => f[k])));
      X.push(med); ox.push(cx); oy.push(cy);
    }
  }
  calibLayer.innerHTML = "";
  if (X.length < 6) { statusEl.textContent = "Yeterli veri toplanamadi, tekrar deneyin."; return; }

  Wx = ridgeFit(X, ox);
  Wy = ridgeFit(X, oy);
  statusEl.textContent = "Kalibre edildi. Ekranda gezdir — kirmizi nokta bakisini izlemeli. Sonra DOGRULUK TESTI.";
}

function showTarget(cx, cy, n) {
  return new Promise((resolve) => {
    calibLayer.innerHTML = "";
    const t = document.createElement("div");
    t.className = "target";
    t.style.left = (cx * 100) + "vw";
    t.style.top = (cy * 100) + "vh";
    t.textContent = n;
    t.addEventListener("click", () => resolve());
    calibLayer.appendChild(t);
  });
}

// ---- dogruluk testi: bilinen noktalara bak, ortalama hatayi olc ----
async function accuracyTest() {
  if (!Wx) { statusEl.textContent = "Once kalibre edin."; return; }
  const pts = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]];
  let sx = 0, sy = 0, n = 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const [cx, cy] of pts) {
    await showTarget(cx, cy, "●");
    const t0 = performance.now(); const preds = [];
    while (performance.now() - t0 < 900) {
      if (latestFeat) preds.push([dot1(Wx, latestFeat), dot1(Wy, latestFeat)]);
      await sleep(30);
    }
    if (preds.length) {
      const mx = median(preds.map((p) => p[0])), my = median(preds.map((p) => p[1]));
      sx += Math.abs(mx - cx) * vw; sy += Math.abs(my - cy) * vh; n++;
    }
  }
  calibLayer.innerHTML = "";
  if (n) {
    const ex = (sx / n).toFixed(0), ey = (sy / n).toFixed(0);
    metricsEl.innerHTML = `Ortalama hata — yatay: <b>${ex}px</b> · dikey: <b>${ey}px</b> ` +
      `(dusuk daha iyi; WebGazer tipik ~130px). Yataydaki iyilesme kritik.`;
    statusEl.textContent = "Dogruluk testi bitti.";
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

document.getElementById("btn-calib").addEventListener("click", calibrate);
document.getElementById("btn-acc").addEventListener("click", accuracyTest);
init().catch((e) => {
  statusEl.textContent = "Hata: " + e.message;
  console.error(e);
});

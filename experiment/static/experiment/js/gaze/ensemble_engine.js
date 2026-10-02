/*
 * Ensemble gaze motoru — Faz 7+.
 *
 * Tek MediaPipe modelinden COK tahminci: ayni iris landmark'larindan farkli
 * ozellik gorunumleri (A: iris oranlari, B: iris+bas-pozu+etkilesimler, C: ham
 * normalize konumlar) -> her biri ayri ridge regresyon. Farkli hata desenleri
 * leave-one-out agirlikli fuzyonla birlestirilir (iyi genelleyen baskin).
 *
 * "Ortak tahmin modeli": birden cok kestiriciyi tek tahmine birlestirir.
 * Genisletilebilir: ileride bir ONNX/HF gaze CNN'i 4. gorunum olarak eklenebilir.
 *
 * KURAL (spec §6/§15): kamera goruntusu tarayicidan cikmaz.
 */
import { start as mpStart, faceOk, latestLandmarks } from "./mediapipe_engine.js";

export { faceOk };
export async function start(video) { return mpStart(video); }

// Landmark indexleri
const R = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const L = { inner: 362, outer: 263, top: 386, bottom: 374, iris: 473 };
const NOSE = 1, FACE_L = 234, FACE_R = 454, FORE = 10, CHIN = 152, BROW = 168;
const RIDGE_LAMBDA = 1e-3;

// ---- gorunum ozellik fonksiyonlari (landmark -> vektor) ----
function geom(lm) {
  const p = (i) => lm[i];
  const faceW = Math.hypot(p(FACE_R).x - p(FACE_L).x, p(FACE_R).y - p(FACE_L).y) || 1e-6;
  const faceH = Math.hypot(p(CHIN).x - p(FORE).x, p(CHIN).y - p(FORE).y) || 1e-6;
  const midEyeX = (p(FACE_L).x + p(FACE_R).x) / 2;
  const eye = (E) => {
    const w = (p(E.outer).x - p(E.inner).x) || 1e-6;
    const h = (p(E.bottom).y - p(E.top).y) || 1e-6;
    return [(p(E.iris).x - p(E.inner).x) / w, (p(E.iris).y - p(E.top).y) / h];
  };
  const [rxR, ryR] = eye(R);
  const [rxL, ryL] = eye(L);
  const yaw = (p(NOSE).x - midEyeX) / faceW;
  const pitch = (p(NOSE).y - p(BROW).y) / faceH;
  const roll = Math.atan2(p(L.outer).y - p(R.outer).y, p(L.outer).x - p(R.outer).x);
  return { p, faceW, faceH, rxR, ryR, rxL, ryL, yaw, pitch, roll };
}

function viewA(g) { // iris oranlari (5)
  return [g.rxR, g.ryR, g.rxL, g.ryL, 1];
}
function viewB(g) { // iris + bas-pozu + etkilesim (11)
  return [g.rxR, g.ryR, g.rxL, g.ryL, g.yaw, g.pitch, g.roll,
    g.rxR * g.yaw, g.rxL * g.yaw, (g.ryR + g.ryL) * g.pitch, 1];
}
function viewC(g) { // ham normalize konumlar (yuz kutusuna gore) (9)
  const p = g.p;
  const flx = p(FACE_L).x, fw = (p(FACE_R).x - p(FACE_L).x) || 1e-6;
  const fty = p(FORE).y, fh = (p(CHIN).y - p(FORE).y) || 1e-6;
  const nx = (i) => (p(i).x - flx) / fw, ny = (i) => (p(i).y - fty) / fh;
  return [nx(R.iris), ny(R.iris), nx(L.iris), ny(L.iris),
    nx(R.inner), nx(R.outer), nx(L.inner), nx(L.outer), 1];
}

const VIEW_FNS = [viewA, viewB, viewC];
const VIEW_LENS = [5, 11, 9];
const BOUNDS = (() => { const b = [0]; VIEW_LENS.forEach((l) => b.push(b[b.length - 1] + l)); return b; })();

// latestFeatures: tum gorunumlerin DUZ birlestirilmisi (study_mp median'i bununla calisir)
export function latestFeatures() {
  const lm = latestLandmarks();
  if (!lm) return null;
  const g = geom(lm);
  return VIEW_FNS.flatMap((fn) => fn(g));
}

function splitViews(f) {
  return VIEW_FNS.map((_, i) => f.slice(BOUNDS[i], BOUNDS[i + 1]));
}

// ---- ridge math ----
function matMulT(A) {
  const N = A.length, D = A[0].length;
  const M = Array.from({ length: D }, () => new Float64Array(D));
  for (let n = 0; n < N; n++) { const row = A[n]; for (let i = 0; i < D; i++) { const ri = row[i]; for (let j = 0; j < D; j++) M[i][j] += ri * row[j]; } }
  return M;
}
function matTvec(A, y) {
  const N = A.length, D = A[0].length; const v = new Float64Array(D);
  for (let n = 0; n < N; n++) for (let i = 0; i < D; i++) v[i] += A[n][i] * y[n];
  return v;
}
function solve(M, b) {
  const D = b.length; const A = M.map((r, i) => Float64Array.from([...r, b[i]]));
  for (let c = 0; c < D; c++) {
    let pr = c; for (let r = c + 1; r < D; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
    [A[c], A[pr]] = [A[pr], A[c]];
    const piv = A[c][c] || 1e-9;
    for (let k = c; k <= D; k++) A[c][k] /= piv;
    for (let r = 0; r < D; r++) { if (r === c) continue; const fct = A[r][c]; for (let k = c; k <= D; k++) A[r][k] -= fct * A[c][k]; }
  }
  return A.map((r) => r[D]);
}
function ridgeFit(X, y) {
  const D = X[0].length; const M = matMulT(X);
  for (let i = 0; i < D - 1; i++) M[i][i] += RIDGE_LAMBDA;
  return solve(M, matTvec(X, y));
}
function dotv(w, f) { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * f[i]; return s; }

// leave-one-out RMSE (normalize hedef biriminde) — durust agirlik icin
function looRMSE(X, ox, oy) {
  const N = X.length; let se = 0;
  for (let i = 0; i < N; i++) {
    const Xi = X.filter((_, k) => k !== i);
    const oxi = ox.filter((_, k) => k !== i), oyi = oy.filter((_, k) => k !== i);
    const wx = ridgeFit(Xi, oxi), wy = ridgeFit(Xi, oyi);
    const dx = dotv(wx, X[i]) - ox[i], dy = dotv(wy, X[i]) - oy[i];
    se += dx * dx + dy * dy;
  }
  return Math.sqrt(se / N);
}

// rows: [{ f:[duz cok-gorunum], x, y }] -> W (gorunum agirliklari + fuzyon)
export function fit(rows) {
  const views = [];
  const weights = [];
  for (let v = 0; v < VIEW_FNS.length; v++) {
    const X = rows.map((r) => r.f.slice(BOUNDS[v], BOUNDS[v + 1]));
    const ox = rows.map((r) => r.x), oy = rows.map((r) => r.y);
    const Wx = ridgeFit(X, ox), Wy = ridgeFit(X, oy);
    const rmse = looRMSE(X, ox, oy);
    views.push({ Wx, Wy });
    weights.push(1 / (rmse * rmse + 1e-6)); // ters-varyans
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const norm = weights.map((w) => w / sum);
  return { views, weights: norm };
}

export function predict(W, f) {
  const vs = splitViews(f);
  let px = 0, py = 0;
  for (let v = 0; v < W.views.length; v++) {
    px += W.weights[v] * dotv(W.views[v].Wx, vs[v]);
    py += W.weights[v] * dotv(W.views[v].Wy, vs[v]);
  }
  return [Math.max(0, Math.min(1, px)), Math.max(0, Math.min(1, py))];
}

// Tani: her gorunumun LOO agirligini dondurur (konsola yazmak icin)
export function lastWeights(W) { return W ? W.weights : null; }

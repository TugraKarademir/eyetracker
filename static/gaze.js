// Web kamerasıyla bakış takibi — webgaze (github.com/TugraKarademir/webgaze) algoritmasının
// tarayıcıya taşınmış hali. Görüntü cihazdan çıkmaz; dışarı yalnızca bölge adı ve
// materyal üzerindeki kaba bakış noktaları verilir.
//
// webgaze ile birebir aynı olanlar:
//   * MediaPipe Face Mesh (478 nokta, iris dahil) ve aynı landmark indeksleri
//   * eye_features: iris merkezinin göz köşeleri eksenine göre konumu + göz açıklığı
//   * model_features: iki göz ayrı, baş açısı yok; expand: gx², gy², gx·gy
//   * GazeModel: standartlaştırılmış ridge regresyon (λ=10, sabit terim cezasız)
//   * 3 karelik nedensel yumuşatma, MAD ile aykırı örnek atma, One Euro filtresi
//   * 13 noktalı kalibrasyon (0.7 sn yerleşme + 1.0 sn toplama), 9 noktalı doğrulama
//   * Bölgeye oturtma (snap) + 4 kare tutma ile bölge titremesini bastırma
//   * Tıklamayla sürekli kalibrasyon (tıklamadan 350–50 ms önceki örnekler, ağırlık 3)

const MP_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const GZ = {
  EYE_R: { a: 33, b: 133, top: 159, bot: 145, iris: [468, 469, 470, 471, 472] },
  EYE_L: { a: 362, b: 263, top: 386, bot: 374, iris: [473, 474, 475, 476, 477] },
  SETTLE: 0.7, COLLECT: 1.0, SMOOTH: 3, BLINK: 0.15, BLINK_BS: 0.5, BLINK_DOWN: 0.3,
  CLICK_WINDOW: [0.35, 0.05], CLICK_WEIGHT: 3, CLICK_MAX: 600, CLICK_RADIUS: 300,
  SNAP: 60, HOLD: 4,
  // Pencere ekranın en az bu oranını kaplamalı (genişlik ve yükseklik ayrı). Bakış hatası ~250 px iken
  // dar bir pencerede bölgeler hatadan küçük kalır; ölçüm anlamsızlaşır, bu yüzden bakış hiç gönderilmez.
  WIN_MIN: 0.6,
  // Doğrulamada 3x3 bölge isabeti bunun altındaysa model bölge ayıramıyor demektir: bölge/ısı haritası
  // gönderilmez, yalnızca kaba "ekranda / ekran dışı" bilgisi kullanılır (yalan veri yok).
  MIN_HIT: 60,
};

// ---------------------------------------------------------------- özellikler
function gzEyeFeatures(p, e) {
  const a = p[e.a], b = p[e.b];
  let cx = 0, cy = 0;
  for (const i of e.iris) { cx += p[i][0]; cy += p[i][1]; }
  cx /= e.iris.length; cy /= e.iris.length;
  const w = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = [(b[0] - a[0]) / w, (b[1] - a[1]) / w], uy = [-ux[1], ux[0]];
  const d = [cx - (a[0] + b[0]) / 2, cy - (a[1] + b[1]) / 2];
  const open = Math.hypot(p[e.top][0] - p[e.bot][0], p[e.top][1] - p[e.bot][1]) / w;
  return [(d[0] * ux[0] + d[1] * ux[1]) / w, (d[0] * uy[0] + d[1] * uy[1]) / w, open];
}
// İris merkezinin göz köşeleri ortasına göre kayması, milimetre (görüntü ekseninde, [x, y]).
// Ölçek: insan irisi çapı kişiden kişiye çok az değişir (~11,7 mm); görüntüdeki iris çapı piksel → mm çevirir.
function gzIrisMm(p, e) {
  const c = p[e.iris[0]], d = (q, r) => Math.hypot(q[0] - r[0], q[1] - r[1]);
  const rPx = (d(p[e.iris[1]], p[e.iris[3]]) + d(p[e.iris[2]], p[e.iris[4]])) / 4;
  if (!(rPx > 0.5)) return null;
  const a = p[e.a], b = p[e.b], mm = 5.85 / rPx;
  return [(c[0] - (a[0] + b[0]) / 2) * mm, (c[1] - (a[1] + b[1]) / 2) * mm];
}
// ham: [rx, ry, lx, ly, ro, lo, hy, hp]  ->  model: [rx, ry, lx, ly, ortalama açıklık, baş yaw, baş pitch]
// webgaze'den farkı: baş açısı da modele girer. Büyük ekranda kenarlara bakarken baş dönüyor; açı modelde
// yokken bu dönüş göz bebeği kayması sanılıyordu (kayıtta 2560 px ekranda hata ~7-10°).
const gzModelFeatures = (r) => r.length > 6 ? [r[0], r[1], r[2], r[3], (r[4] + r[5]) / 2, r[6], r[7]] : [r[0], r[1], r[2], r[3], (r[4] + r[5]) / 2];
// Baş yönü (landmark oranlarından, birimsiz): burun ucunun yüz kenarlarına / alın-çene eksenine göre konumu
function gzHeadPose(lm) {
  const L = lm[234], R = lm[454], top = lm[10], chin = lm[152], nose = lm[1];
  return [(nose.x - (L.x + R.x) / 2) / ((R.x - L.x) || 1e-3), (nose.y - (top.y + chin.y) / 2) / ((chin.y - top.y) || 1e-3)];
}
// MediaPipe yüz dönüşüm matrisi (4x4, cm cinsinden metrik uzay) -> 3B baş açısı ve kameraya uzaklık.
// Dizilim (satır/sütun öncelikli) sürüme göre değişebildiği için öteleme sütununun yeri büyüklüğünden bulunur
// (yüz kameradan 25-120 cm uzakta; dönme elemanları |x|<=1).
function gzPose3(m) {
  if (!m || m.length < 16) return null;
  const colMajor = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]) > Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
  const at = (r, c) => (colMajor ? m[c * 4 + r] : m[r * 4 + c]);
  const f = [at(0, 2), at(1, 2), at(2, 2)];               // yüzün baktığı yön (kanonik yüzün +z ekseni)
  const t = [at(0, 3), at(1, 3), at(2, 3)];               // yüzün kameraya göre konumu (cm)
  const deg = 180 / Math.PI, tn = Math.hypot(t[0], t[1], t[2]) || 1, c = [-t[0] / tn, -t[1] / tn, -t[2] / tn];
  // rel*: yüzün baktığı yön ile yüzden kameraya giden doğru arasındaki açı. Yüz kameraya dönükken 0;
  // ekranın ortasına bakarken bu açı, kameranın baş yönüne göre nerede olduğunu verir (yüz görüntünün kenarındaysa da doğru).
  const relYaw = (Math.atan2(f[0], f[2]) - Math.atan2(c[0], c[2])) * deg;
  const relPitch = (Math.asin(Math.max(-1, Math.min(1, f[1]))) - Math.asin(Math.max(-1, Math.min(1, c[1])))) * deg;
  return { relYaw, relPitch, yaw: Math.atan2(f[0], f[2]) * deg, pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))) * deg,
           roll: Math.atan2(at(1, 0), at(0, 0)) * deg, dist: Math.hypot(t[0], t[1], t[2]), tx: t[0], ty: t[1], tz: t[2], colMajor };
}
function gzExpand(f) {
  const gx = (f[0] + f[2]) / 2, gy = (f[1] + f[3]) / 2;
  return [...f, gx * gx, gy * gy, gx * gy];
}
function gzSmoothRows(R, k = GZ.SMOOTH) {
  return R.map((_, i) => {
    const lo = Math.max(0, i - k + 1), n = i - lo + 1;
    return R[0].map((__, j) => { let s = 0; for (let q = lo; q <= i; q++) s += R[q][j]; return s / n; });
  });
}
function gzMedian(a) { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function gzDropOutliers(F, k = 3) {
  const stats = [0, 1].map((j) => {
    const col = F.map((r) => r[j]), med = gzMedian(col);
    return [med, gzMedian(col.map((v) => Math.abs(v - med))) * 1.4826 + 1e-6];
  });
  return F.filter((r) => stats.every(([med, mad], j) => Math.abs(r[j] - med) / mad <= k));
}

// Gauss eliminasyonu (kısmi pivotlama), A·X = B, B çok sütunlu
function gzSolve(A, B) {
  const n = A.length, m = B[0].length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row.slice(n).map((v) => v / M[i][i]));
}

// WebGazer yöntemi (wg_yama.js): 120 göz yaması değeri. İlk 4 sabit sıfır: gzExpand'in göz terimleri boş kalır,
// yani model yalnız WebGazer'ın öznitelikleriyle (bizim ridge çözücüsüyle) çalışır.
const gzWgOz = (w) => [0, 0, 0, 0, ...w];
// 3B göz küresi (JEOresearch/EyeTracker Webcam3DTracker fikri): bakış yönü = iris − göz küresi merkezi, kamera ekseninde açı.
// Oradaki gibi tek anlık "c" kalibrasyonu yok: küre merkezi göz köşelerinin ortasından yüzün arka yönünde göz genişliğinin
// 0,25'i kadar geride varsayılır (göz ~30 mm, köşe düzlemi küre merkezinin ~7-8 mm önünde). Baş ekseni yüz noktalarından
// (yanak 234→454 sağa, alın 10→çene 152 aşağı). Ekrana çevirmeyi sabit açı aralığı değil, kalibrasyon noktalarından ridge öğrenir.
// Çıktı (ilk 4'ü gzExpand'de karesel terim alır): [sağ yaw, sağ pitch, sol yaw, sol pitch (derece/30), göz x, göz y (0-1), ölçek]
function gzKure(lm, w, h) {
  const P = (i) => [lm[i].x * w, lm[i].y * h, lm[i].z * w];
  const fark = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const birim = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const capraz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sag = birim(fark(P(454), P(234)));
  let ileri = birim(capraz(sag, fark(P(152), P(10))));
  if (ileri[2] > 0) ileri = ileri.map((v) => -v);   // kameraya doğru: z küçülür
  const goz = (a, b, iris) => {
    const A = P(a), B = P(b), I = P(iris), r = 0.25 * Math.hypot(...fark(A, B));
    const m = [0, 1, 2].map((k) => (A[k] + B[k]) / 2 - ileri[k] * r), g = fark(I, m);
    return [Math.atan2(g[0], -g[2]) * 180 / Math.PI / 30, Math.atan2(g[1], -g[2]) * 180 / Math.PI / 30];
  };
  const R = goz(GZ.EYE_R.a, GZ.EYE_R.b, 468), L = goz(GZ.EYE_L.a, GZ.EYE_L.b, 473);
  const ex = (lm[33].x + lm[133].x + lm[362].x + lm[263].x) / 4, ey = (lm[33].y + lm[133].y + lm[362].y + lm[263].y) / 4;
  const olcek = Math.hypot((lm[468].x - lm[473].x) * w, (lm[468].y - lm[473].y) * h) / w * 10;
  const v = [...R, ...L, ex, ey, olcek];
  return v.every(Number.isFinite) ? v : null;
}
class GazeModel {
  fit(F, Y, lam = 10) {
    this.F = F; this.Y = Y;
    const X = F.map(gzExpand), d = X[0].length, n = X.length;
    this.mu = Array(d).fill(0); this.sd = Array(d).fill(0);
    for (const x of X) x.forEach((v, j) => (this.mu[j] += v / n));
    for (const x of X) x.forEach((v, j) => (this.sd[j] += (v - this.mu[j]) ** 2 / n));
    this.sd = this.sd.map((v) => Math.sqrt(v) + 1e-6);
    const Xs = X.map((x) => this._row(x)), p = d + 1;
    const A = Array.from({ length: p }, () => Array(p).fill(0));
    const B = Array.from({ length: p }, () => [0, 0]);
    Xs.forEach((r, i) => {
      for (let a = 0; a < p; a++) {
        B[a][0] += r[a] * Y[i][0]; B[a][1] += r[a] * Y[i][1];
        for (let b = 0; b < p; b++) A[a][b] += r[a] * r[b];
      }
    });
    for (let a = 1; a < p; a++) A[a][a] += lam;          // sabit terim cezalandırılmaz
    this.W = gzSolve(A, B);
  }
  _row(x) { return [1, ...x.map((v, j) => (v - this.mu[j]) / this.sd[j])]; }
  predict(f) {
    const r = this._row(gzExpand(f));
    return [0, 1].map((k) => r.reduce((s, v, i) => s + v * this.W[i][k], 0));
  }
  toJSON() { return { mu: this.mu, sd: this.sd, W: this.W, F: this.F, Y: this.Y }; }
  static from(o) { const m = new GazeModel(); Object.assign(m, o); return m; }
}

class OneEuro {
  constructor(mincutoff = 0.6, beta = 0.004, dcutoff = 1.0) { Object.assign(this, { mincutoff, beta, dcutoff, x: null, t: null, dx: 0 }); }
  static a(cut, dt) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  f(x, t) {
    if (this.t == null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(t - this.t, 1e-3); this.t = t;
    this.dx += OneEuro.a(this.dcutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += OneEuro.a(this.mincutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

// ---------------------------------------------------------------- bölgeler
function gzDist(r, x, y) {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}
function gzNearest(regions, x, y, snap) {
  const inside = regions.filter((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  if (inside.length) return inside.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b));
  let best = null, bd = Infinity;
  for (const r of regions) { const d = gzDist(r, x, y); if (d < bd) { bd = d; best = r; } }
  return best && bd <= snap ? best : null;
}
class RegionAssigner {
  constructor(snap = GZ.SNAP, hold = GZ.HOLD) { Object.assign(this, { snap, hold, current: null, pendingName: undefined, count: 0 }); }
  assign(regions, x, y) {
    const r = gzNearest(regions, x, y, this.snap), name = r ? r.name : null;
    if (name === (this.current ? this.current.name : null)) { this.current = r || this.current; this.count = 0; }
    else if (this.count && name === this.pendingName) this.count++;
    else { this.pending = r; this.pendingName = name; this.count = 1; }
    if (this.count >= this.hold) { this.current = this.pending; this.count = 0; }
    return this.current;
  }
}

// ---------------------------------------------------------------- takipçi
class GazeTracker {
  /**
   * @param video  öğrencinin kamera <video> öğesi
   * @param opts.getRegions () => [{name, x, y, w, h, content?}]  (viewport CSS px)
   *        content: {x,y,w,h} — materyalin gerçek görüntü alanı (u,v hesabı için)
   * @param opts.onStatus  (durum metni) => void
   */
  constructor(video, { getRegions, onStatus = () => {} } = {}) {
    Object.assign(this, { video, getRegions, onStatus });
    this.model = null; this.geom = null; this.tracking = false; this.ready = false;
    this.latest = null; this.rec = null; this.recent = []; this.hist = [];
    this.clickF = []; this.clickY = [];
    this.fx = new OneEuro(); this.fy = new OneEuro();
    this.assigner = new RegionAssigner();
    // WebGazer yöntemi: aynı karelerden, aynı kalibrasyon noktalarıyla eğitilen ikinci model (ayrı kütüphane çalışmaz)
    this.wgModel = null; this.wgClickF = []; this.wgClickY = []; this.wgPoint = null;
    this.wfx = new OneEuro(); this.wfy = new OneEuro(); this.wgAssigner = new RegionAssigner();
    this.point = null; this.region = null; this.stale = false;
    this.win = { n: 0, counts: {}, pts: [], wgN: 0, wgCounts: {} };
    this.dot = null; this.showDot = false;
    this._onClick = (e) => this.learnClick(e);
    // Model EKRAN koordinatında çalışır: kalibrasyon tam ekranda yapılsa da ders normal pencerede
    // sürebilir (tam ekrandan çıkmak, DevTools açmak, pencereyi taşımak modeli bozmaz).
    // Sayfanın ekrandaki yeri fare olaylarından ölçülür: e.screenX - e.clientX (pencere kenarı + araç çubuğu).
    this.inner = null;
    addEventListener("pointermove", (e) => this._learnOffset(e), { passive: true });
  }

  async load() {
    this.onStatus("Bakış modeli yükleniyor…");
    const v = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await v.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const mk = (delegate) => v.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: "VIDEO", numFaces: 1,
      outputFaceBlendshapes: true,   // göz kırpma / aşağı bakma katsayıları (göz kapalı kararı için)
      outputFacialTransformationMatrixes: true,   // 3B baş açısı + uzaklık (yüz profili, kamera konumu)
    });
    // Tanı sayaçları: işlenen kare, yüz bulunan kare, hata (telefonda yüz bulunamıyordu; hata sessizce yutuluyordu)
    this.diag = { kare: 0, yuz: 0, hata: 0, sonHata: null, delegate: null, video: null };
    try { this.mesh = await mk("GPU"); this.diag.delegate = "GPU"; }
    catch (e) { this.diag.gpuHata = String(e?.message || e).slice(0, 160); this.mesh = await mk("CPU"); this.diag.delegate = "CPU"; }
    this.ready = true;
    this._frame();
    if (this.restore()) this.onStatus("ok");
    else this.onStatus("Kalibre edilmedi");
  }

  // Modele verilecek kare: zoom 1 ise video; değilse zoomC (tam karede 0-1 merkez) çevresinden kırpılmış tuval
  _kaynak() {
    const v = this.video, z = this.zoom || 1;
    if (z <= 1.01) { this.kirp = null; return v; }
    const vw = v.videoWidth, vh = v.videoHeight, cw = Math.round(vw / z), ch = Math.round(vh / z), c = this.zoomC || [0.5, 0.5];
    const x0 = Math.round(Math.min(vw - cw, Math.max(0, c[0] * vw - cw / 2))), y0 = Math.round(Math.min(vh - ch, Math.max(0, c[1] * vh - ch / 2)));
    if (!this._kirpCv) { this._kirpCv = document.createElement("canvas"); this._kirpCtx = this._kirpCv.getContext("2d", { willReadFrequently: true }); }
    const cv = this._kirpCv;
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    this._kirpCtx.drawImage(v, x0, y0, cw, ch, 0, 0, cw, ch);
    this.kirp = { x0, y0, cw, ch, vw, vh };
    return cv;
  }
  setZoom(z, merkez) {
    this.zoom = Math.max(1, Math.min(3, +z || 1));
    if (merkez) this.zoomC = merkez;
  }

  // Her kamera karesinde: özellik vektörü (webgaze Tracker.run)
  _frame() {
    if (!this.ready) return;
    // rVFC üst verisi: presentedFrames = kameranın gerçekten gönderip gösterilen kare sayısı (biz işleyemesek de artar).
    // İşlenen kare ile karşılaştırınca yavaşlığın kameradan mı (ışık/pozlama) işlemeden mi geldiği ayrılır.
    const next = () => (this.video.requestVideoFrameCallback
      ? this.video.requestVideoFrameCallback((_, meta) => { this._meta = meta; this._frame(); })
      : requestAnimationFrame(() => this._frame()));
    if (this.paused || this.video.readyState < 2) { setTimeout(next, 200); return; }
    const t = performance.now() / 1000;
    let res;
    // Dijital yakınlaştırma (gazelab'deki gibi kamera ayarı adımında seçilir): yüz küçük görünüyorsa karenin yüz çevresindeki
    // bölümü kırpılıp modele o verilir. Kırpma merkezi ayar adımında sabitlenir (kare kare kaymaz; öznitelikler tutarlı kalır).
    const src = this._kaynak(), t0 = performance.now();
    try { res = this.mesh.detectForVideo(src, performance.now()); }
    catch (e) { if (this.diag) { this.diag.hata++; this.diag.sonHata = String(e?.message || e).slice(0, 160); } next(); return; }
    if (this.diag) {
      this.diag.islemeMs = (this.diag.islemeMs || 0) + (performance.now() - t0); this.diag.islemeN = (this.diag.islemeN || 0) + 1;
      if (this._meta?.presentedFrames != null) this.diag.kameraKare = this._meta.presentedFrames;
    }
    const lm = res.faceLandmarks && res.faceLandmarks[0];
    if (this.diag) { this.diag.kare++; if (lm) this.diag.yuz++; this.diag.video = `${this.video.videoWidth}x${this.video.videoHeight}`; this.diag.islenen = `${src.width || src.videoWidth}x${src.height || src.videoHeight}`; this.diag.zoom = this.zoom; }
    if (lm && lm.length >= 478) {
      const w = src.width || this.video.videoWidth, h = src.height || this.video.videoHeight;
      const p = lm.map((q) => [q.x * w, q.y * h]);
      const [rx, ry, ro] = gzEyeFeatures(p, GZ.EYE_R), [lx, ly, lo] = gzEyeFeatures(p, GZ.EYE_L);
      const raw = [rx, ry, lx, ly, ro, lo, ...gzHeadPose(lm)];
      const bs = res.faceBlendshapes?.[0]?.categories;
      const g = (n) => bs?.find((c) => c.categoryName === n)?.score ?? 0;
      const eyes = bs ? { blink: (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2, down: (g("eyeLookDownLeft") + g("eyeLookDownRight")) / 2 } : null;
      // Kırpma: sabit açıklık eşiği (0.15) kamera üstteyken ekranın altına bakan gözü "kırpıyor" sayıp
      // kalibrasyon örneklerini atıyordu. MediaPipe kırpma katsayısı varsa o kullanılır, aşağı bakışta eşik yükselir.
      // Kişisel yüz profili varsa (bakış testinde gerçekten kapalı gözde ölçülen kırpma katsayısı) eşik ona yakın konur:
      // kamera üstteyken ekranın altına bakınca kapak iniyor, genel eşik bu kareleri "kırpma" sayıp atıyordu
      // (20.11: alt köşelerde tıklamaya hiç kare kalmadı, bakış alt sırada en kötü bölgeydi).
      // kişisel kapalı-göz değeri yalnız profilde gözler gerçekten kapandıysa (nötrden en az 0,3 yüksek) kullanılır
      const kp = this.report?.yuz, kapaliK = kp?.kapali?.kirpma != null && kp.kapali.kirpma - (kp.notr?.kirpma ?? 0) >= 0.3 ? kp.kapali.kirpma : this.yuzKapali;
      const blink = eyes ? (kapaliK != null ? eyes.blink > kapaliK - 0.08 : eyes.blink > GZ.BLINK_BS + GZ.BLINK_DOWN * Math.min(1, eyes.down / 0.5)) : (ro + lo) / 2 < GZ.BLINK;
      const pose3 = gzPose3(res.facialTransformationMatrixes?.[0]?.data);
      // Kırpılmış karede yüz zoom kat büyük görünür; MediaPipe uzaklığı zoom kat yakın sanır → gerçek ölçeğe geri çevrilir
      if (pose3 && this.zoom > 1.01) for (const k of ["dist", "tx", "ty", "tz"]) pose3[k] *= this.zoom;
      const bsAll = bs ? Object.fromEntries(bs.map((c) => [c.categoryName, c.score])) : null;
      // yuz2d: GazeLab baş pozu sınırları için burun ucu (1) ve dış göz köşeleri arası (33-263) uzaklık, video pikseli
      const yuz2d = { nx: p[1][0], ny: p[1][1], size: Math.hypot(p[263][0] - p[33][0], p[263][1] - p[33][1]) };
      this.latest = { t, raw, blink, open: (ro + lo) / 2, eyes, pose3, bs: bsAll, yuz2d, irisMm: { sag: gzIrisMm(p, GZ.EYE_R), sol: gzIrisMm(p, GZ.EYE_L) } };
      // WebGazer göz yaması: aynı karenin aynı yüz noktalarından (wg_yama.js yüklüyse; kare başına ~2-3 ms)
      let wgp = null;
      if (typeof wgYama === "function") { try { wgp = wgYama(src, p); } catch { wgp = null; } }
      this.latest.wgp = wgp;
      try { this.latest.kure = gzKure(lm, w, h); } catch { this.latest.kure = null; }
      // İsteğe bağlı kanca (bakış testi: yakın göz). Aynı karenin landmark pikselleriyle çağrılır.
      if (this.onLandmarks) { try { this.latest.yakin = this.onLandmarks(p, lm); } catch (e) { this.latest.yakinHata = String(e?.message || e); } }
      // Yüz konumu (normalize 0-1): el kaldırma algılayıcısı başa göre karar verir
      // Kırpma varsa tam kareye çevrilir: el kaldırma ve HSEmotion tam video karesinde çalışır
      const K = this.kirp, FX = (x) => (K ? (K.x0 + x * K.cw) / K.vw : x), FY = (y) => (K ? (K.y0 + y * K.ch) / K.vh : y);
      this.face = { t, eyeY: FY((lm[159].y + lm[386].y) / 2), top: FY(lm[10].y), chin: FY(lm[152].y), left: FX(Math.min(lm[234].x, lm[454].x)), right: FX(Math.max(lm[234].x, lm[454].x)),
        box: lm.reduce((b, q) => ({ x0: Math.min(b.x0, FX(q.x)), y0: Math.min(b.y0, FY(q.y)), x1: Math.max(b.x1, FX(q.x)), y1: Math.max(b.y1, FY(q.y)) }), { x0: 1, y0: 1, x1: 0, y1: 0 }) };
      // Göz kapağı: MediaPipe katsayıları (0-1). Aşağı bakış kapağı kısar; bu yüzden ayrıca 'aşağı bakma' da tutulur.
      if (eyes) this.face.eyes = eyes;
      if (this.rec) { this.recStat.frames++; if (blink) { this.recStat.blink++; this.recStat.open.push((ro + lo) / 2); } }
      if (this.rec && !blink) { this.rec.push([t, ...raw]); this.recW?.push(wgp); }
      if (this.tracking && !blink) this._predict(t, raw, wgp);
    } else {
      this.latest = null;
      if (this.rec) { this.recStat.frames++; this.recStat.noFace++; }
      if (this.tracking) this._sample(null);
    }
    if (this.diag) this.diag.toplamMs = (this.diag.toplamMs || 0) + (performance.now() - t0);   // MediaPipe + göz yaması + küre + kancalar
    next();
  }

  _predict(t, raw, wgp = null) {
    if (!this._geomOk()) { this._sample(null); return; }
    const w = this._windowCheck();
    this._block(w.why);
    if (!w.ok) { this._sample(null); return; }
    this.recent.push(raw); if (this.recent.length > GZ.SMOOTH) this.recent.shift();
    const avg = raw.map((_, j) => this.recent.reduce((s, r) => s + r[j], 0) / this.recent.length);
    const f = gzModelFeatures(avg);
    const [px, py] = this.model.predict(f);                       // ekran koordinatı
    this.hist.push({ t, f, p: [px, py], w: wgp }); if (this.hist.length > 60) this.hist.shift();
    const o = this._off();
    const x = this.fx.f(px, t) - o.x, y = this.fy.f(py, t) - o.y;   // pencere (CSS px) koordinatı
    this.point = [x, y];
    this._sample(x, y);
    // WebGazer yöntemi: ikinci tahmin, ayrı bölge sayımı (ders kaydında karşılaştırma için)
    if (this.wgModel && wgp && !this.coarse) {
      const [qx, qy] = this.wgModel.predict(gzWgOz(wgp));
      const wx = this.wfx.f(qx, t) - o.x, wy = this.wfy.f(qy, t) - o.y;
      this.wgPoint = [wx, wy];
      const mx = innerWidth * 0.06, my = innerHeight * 0.06;
      let ad = "disari";
      if (!(wx < -mx || wy < -my || wx > innerWidth + mx || wy > innerHeight + my)) {
        const r = this.wgAssigner.assign(this.getRegions ? this.getRegions() : [], wx, wy); ad = r ? r.name : "sayfa"; }
      this.win.wgN++; this.win.wgCounts[ad] = (this.win.wgCounts[ad] || 0) + 1;
    }
    if (this.dot && this.showDot) {
      this.dot.style.transform = `translate(${Math.min(Math.max(x, 0), innerWidth) - 18}px, ${Math.min(Math.max(y, 0), innerHeight) - 18}px)`;
    }
  }

  /** Bakış ölçümüne izin var mı? Sayfanın ekrandaki yeri ölçülmüş ve pencere yeterince büyük olmalı. */
  _windowCheck() {
    const fw = innerWidth / screen.width, fh = innerHeight / screen.height;
    if (fw < GZ.WIN_MIN || fh < GZ.WIN_MIN)
      return { ok: false, why: `Tarayıcı penceresi çok küçük (${innerWidth}×${innerHeight}; ekranın %${Math.round(100 * fw)} × %${Math.round(100 * fh)}). Bakış ölçümü için pencereyi büyütün ya da tam ekran yapın (en az %${Math.round(100 * GZ.WIN_MIN)}).` };
    if (!this.inner && !document.fullscreenElement)
      return { ok: false, why: "Sayfanın ekrandaki yeri henüz ölçülmedi: fareyi sayfanın üzerinde bir kez gezdirin." };
    return { ok: true, why: null };
  }
  _block(why) {
    if (why === (this.blocked || null)) return;
    this.blocked = why;
    this._klog(why ? `bakış DURDURULDU: ${why}` : "bakış yeniden açıldı (pencere uygun)", { pencere: `${innerWidth}x${innerHeight}`, ekran: `${screen.width}x${screen.height}` });
    this.onStatus(why ? "blocked" : "ok");
  }

  _learnOffset(e) {
    if (e.screenX == null) return;
    this.inner = { x: e.screenX - e.clientX - screenX, y: e.screenY - e.clientY - screenY };
  }
  /** Sayfanın sol üst köşesinin ekran koordinatı. Fare henüz hareket etmediyse tahmin (araç çubuğu üstte). */
  _off() {
    const i = this.inner || { x: Math.max(0, (outerWidth - innerWidth) / 2), y: Math.max(0, outerHeight - innerHeight) };
    return { x: screenX + i.x, y: screenY + i.y, olculdu: !!this.inner };
  }

  // Bir örneği bölgeye ata ve gönderim penceresine ekle
  _sample(x, y) {
    let name = null, uv = null;
    if (document.hidden) name = "disari";
    else if (x != null) {
      const mx = innerWidth * 0.06, my = innerHeight * 0.06;
      if (x < -mx || y < -my || x > innerWidth + mx || y > innerHeight + my) name = "disari";
      else {
        const regions = this.coarse ? [] : (this.getRegions ? this.getRegions() : []);
        const r = this.coarse ? null : this.assigner.assign(regions, x, y);
        name = this.coarse ? "ekranda" : (r ? r.name : "sayfa");
        if (r && r.content) {
          const c = r.content, u = (x - c.x) / c.w, v = (y - c.y) / c.h;
          if (u >= 0 && u < 1 && v >= 0 && v < 1) uv = [u, v];
        }
      }
    }
    this.region = name;
    if (!name) return;                                    // yüz yok: bilinmiyor, sayılmaz
    this.win.n++;
    this.win.counts[name] = (this.win.counts[name] || 0) + 1;
    if (uv && this.win.n % 3 === 0) this.win.pts.push(uv);  // ~10 nokta/sn
  }

  /** Son gönderimden bu yana özet: {cal, region, share, pts} ya da kalibre değilse {cal:false} */
  flush() {
    const w = this.win;
    this.win = { n: 0, counts: {}, pts: [], wgN: 0, wgCounts: {} };
    if (!this.model || this.stale || !this.tracking) return { cal: false };
    if (this.coarse) {   // zayıf kalibrasyon: öğretmene bölge gitmez; yalnız ekran dışı oranı (öğrencinin kendi "ekrana bakmıyor" kararı için)
      const tot = w.n || 0;
      return { cal: false, coarse: true, share: tot ? { disari: +((w.counts.disari || 0) / tot).toFixed(3) } : {} };
    }
    if (this.blocked) return { cal: false, why: "pencere" };       // dar pencere / yer bilinmiyor: veri yok, tahmin de yok
    if (document.hidden) return { cal: true, region: "disari", share: { disari: 1 }, pts: [] };
    if (!w.n) return { cal: true, region: null, share: {}, pts: [] };
    const share = {};
    for (const k in w.counts) share[k] = +(w.counts[k] / w.n).toFixed(3);
    const region = Object.entries(w.counts).sort((a, b) => b[1] - a[1])[0][0];
    const pts = w.pts.slice(-30).map(([u, v]) => [+u.toFixed(3), +v.toFixed(3)]);
    const wgShare = {};   // WebGazer yöntemiyle aynı pencerede bölge payları (yalnız kayıt; öğretmen paneli bizim modeli gösterir)
    for (const k in w.wgCounts) wgShare[k] = +(w.wgCounts[k] / w.wgN).toFixed(3);
    return { cal: true, region, share, pts, ...(w.wgN ? { wgShare } : {}) };
  }

  // Kalibrasyon sırasındaki pencere/ekran geometrisi değişirse model geçersizdir
  _curGeom() { return { sw: screen.width, sh: screen.height, dpr: devicePixelRatio || 1 }; }
  _geomOk() {
    const g = this.geom, c = this._curGeom();
    const ok = g && g.sw === c.sw && g.sh === c.sh && Math.abs((g.dpr || 1) - c.dpr) < 0.01;
    if (!ok !== this.stale) {
      this.stale = !ok; this.onStatus(this.stale ? "stale" : "ok");
      this._klog(this.stale ? "kalibrasyon geçersiz: ekran değişti (başka monitör, çözünürlük ya da tarayıcı yakınlaştırması) → yeniden kalibre edin"
        : "kalibrasyon yeniden geçerli (aynı ekrana dönüldü)", { kalibrasyonda: g, simdi: c });
    }
    return ok;
  }

  startTracking() {
    this.tracking = true; this.recent = []; this.fx = new OneEuro(); this.fy = new OneEuro();
    this.assigner = new RegionAssigner(); this.wfx = new OneEuro(); this.wfy = new OneEuro(); this.wgAssigner = new RegionAssigner();
    document.removeEventListener("pointerdown", this._onClick, true);   // iki kez eklenmesin
    document.addEventListener("pointerdown", this._onClick, true);
  }
  pause(p) { this.paused = p; }

  setShowDot(on) {
    this.showDot = on;
    if (!this.dot) {
      this.dot = document.createElement("div");
      this.dot.className = "gaze-dot";
      document.body.append(this.dot);
    }
    this.dot.style.display = on ? "block" : "none";
  }

  // ---- kalıcılık: aynı pencere geometrisinde önceki kalibrasyon yeniden kullanılır
  _key() { const c = this._curGeom(); return `dn_gaze_v2_${c.sw}x${c.sh}@${c.dpr}`; }
  save() { store.set(this._key(), { geom: this.geom, model: this.model.toJSON(), wgModel: this.wgModel ? this.wgModel.toJSON() : null, report: this.report }); }
  restore() {
    const d = store.get(this._key());
    if (!d || !d.model) return false;
    // Kalibrasyon başka kamera çözünürlüğünde yapıldıysa (ör. eski 640x480) kullanılmaz: göz öznitelikleri farklı gürültüde
    const cam = `${this.video.videoWidth}x${this.video.videoHeight}`;
    if (!d.report || d.report.kamera !== cam) {
      this._klog(`kayıtlı kalibrasyon kullanılmadı: ${d.report?.kamera || "eski sürüm (kamera bilgisi yok)"} ile yapılmış, şimdiki kamera ${cam} → yeniden kalibre edin`);
      return false;
    }
    this._klog(`kayıtlı kalibrasyon yüklendi: isabet %${d.report.hit3}, hata ${d.report.acc} px, kamera ${cam}${d.report.hit3 < GZ.MIN_HIT ? " → KABA MOD" : ""}`);
    this.model = GazeModel.from(d.model); this.geom = d.geom; this.report = d.report;
    if (d.report.zoom > 1.01) this.setZoom(d.report.zoom, d.report.zoomC);   // bakış testinin kamera ayarındaki yakınlaştırma
    this.wgModel = d.wgModel ? GazeModel.from(d.wgModel) : null; this.wgClickF = []; this.wgClickY = [];
    this.coarse = !!(d.report && d.report.hit3 < GZ.MIN_HIT);
    this.startTracking(); this._geomOk();
    return true;
  }

  // ---- tıklamayla öğrenme (webgaze learn_click)
  learnClick(e) {
    this._learnOffset(e);
    if (!this.model || !this.model.F || this.calibrating || this.stale) return;
    const now = performance.now() / 1000;
    const recent = this.hist.filter((h) => h.t >= now - GZ.CLICK_WINDOW[0] && h.t <= now - GZ.CLICK_WINDOW[1]);
    if (recent.length < 2) return;
    const pred = [0, 1].map((k) => recent.reduce((s, h) => s + h.p[k], 0) / recent.length);
    if (Math.hypot(pred[0] - e.screenX, pred[1] - e.screenY) > GZ.CLICK_RADIUS) return;
    for (const h of recent) { this.clickF.push(h.f); this.clickY.push([e.screenX, e.screenY]); }
    while (this.clickF.length > GZ.CLICK_MAX) { this.clickF.shift(); this.clickY.shift(); }
    const cF = this.clickF.flatMap((f) => Array(GZ.CLICK_WEIGHT).fill(f));
    const cY = this.clickY.flatMap((y) => Array(GZ.CLICK_WEIGHT).fill(y));
    const { F, Y } = this.model;
    this.model.fit([...F, ...cF], [...Y, ...cY]);
    this.model.F = F; this.model.Y = Y;                     // kalibrasyon kümesi şişmesin
    if (this.wgModel?.F) {
      for (const h of recent) if (h.w) { this.wgClickF.push(gzWgOz(h.w)); this.wgClickY.push([e.screenX, e.screenY]); }
      while (this.wgClickF.length > GZ.CLICK_MAX) { this.wgClickF.shift(); this.wgClickY.shift(); }
      const wF = this.wgModel.F, wY = this.wgModel.Y;
      this.wgModel.fit([...wF, ...this.wgClickF.flatMap((f) => Array(GZ.CLICK_WEIGHT).fill(f))], [...wY, ...this.wgClickY.flatMap((y) => Array(GZ.CLICK_WEIGHT).fill(y))]);
      this.wgModel.F = wF; this.wgModel.Y = wY;
    }
  }

  // ================================================================ kalibrasyon
  calibrateYeni() { return this.calibrate(true); }
  async calibrate(yeni = false) {
    if (!this.ready) { toast("Bakış modeli henüz yüklenmedi."); return; }
    this.yeniAkis = yeni; this.yuzOnce = this.report?.yuz || null;
    this.calibrating = true;
    const ov = document.createElement("div");
    ov.className = "gaze-ov";
    ov.innerHTML = `<canvas></canvas><div class="gaze-msg"></div>`;
    document.body.append(ov);
    document.documentElement.style.overflow = "hidden";        // arkadaki sayfa kaymasın
    this.ov = ov; this.cv = ov.querySelector("canvas"); this.msg = ov.querySelector(".gaze-msg");
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {}
    await new Promise((r) => setTimeout(r, 400));               // tam ekran yeniden boyutlandırması
    this._resizeCv();
    const fw = innerWidth / screen.width, fh = innerHeight / screen.height;
    if (fw < GZ.WIN_MIN || fh < GZ.WIN_MIN) {
      this._klog("kalibrasyon BAŞLATILMADI: tam ekran açılamadı ve pencere çok küçük", this._screenInfo());
      toast(`Kalibrasyon için tarayıcı penceresi ekranın en az %${Math.round(100 * GZ.WIN_MIN)}'ini kaplamalı (şu an ${innerWidth}×${innerHeight}). Pencereyi büyütüp tekrar deneyin.`, 7000);
      this.cancelled = false; this.waiting = false;
      this.ov?.remove(); this.ov = null; document.documentElement.style.overflow = ""; this.calibrating = false;
      return;
    }
    this._klog("kalibrasyon ekranı açıldı (tarayıcı ekranın fiziksel boyutunu/inçini bilemez; yalnızca piksel)", this._screenInfo());
    this._waitStart();
  }

  // Kalibrasyon konsol kaydı ([KAL ...]); window.kalLog içinde de tutulur
  _klog(msg, obj = {}) {
    const row = { t: new Date().toLocaleTimeString("tr-TR"), msg, ...obj };
    (window.kalLog ||= []).push(row);
    console.log(`[KAL ${row.t}] ${msg}`, obj);
  }
  _screenInfo() {
    const d = devicePixelRatio || 1;
    return { ekran: `${screen.width}x${screen.height} CSS px`, fizikselPiksel: `${Math.round(screen.width * d)}x${Math.round(screen.height * d)}`, dpr: d,
      pencere: `${innerWidth}x${innerHeight}`, tamEkran: !!document.fullscreenElement, kamera: `${this.video.videoWidth}x${this.video.videoHeight}`,
      sayfaEkranda: (({ x, y, olculdu }) => `${Math.round(x)},${Math.round(y)}${olculdu ? "" : " (tahmin)"}`)(this._off()) };
  }

  _resizeCv() { const d = devicePixelRatio || 1; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; }

  _waitStart(extra = "") {
    const tick = () => {
      if (!this.waiting) return;
      const ok = this.latest && performance.now() / 1000 - this.latest.t < 0.5;
      this.msg.innerHTML = this.yeniAkis ? `<h2>🧪 Yeni bakış kalibrasyonu (demo)</h2>
        ${extra ? `<p class="warn">${extra}</p>` : ""}
        <p><b>1. bölüm:</b> 9 sarı nokta sırayla çıkar. Her birine <b>bakın, küçülene kadar gözünüzü üzerinde tutun</b>. Tıklamayın. (~20 sn)<br>
        <b>2. bölüm:</b> 5 sarı noktaya <b>bakın ve birer kez tıklayın</b>.<br>
        Başınızı sabit tutun, yalnız gözlerinizle takip edin.</p>` : `<h2>👁️ Bakış kalibrasyonu</h2>
        ${extra ? `<p class="warn">${extra}</p>` : ""}
        <p>Başınızı sabit tutun, <b>yalnızca gözlerinizle</b> kırmızı noktaları takip edin.<br>
        13 nokta + 9 doğrulama noktası, yaklaşık 40 saniye sürer.</p>
        <p class="${ok ? "ok" : "warn"}">${ok ? "Yüz ve gözler algılandı ✓" : "Yüz bulunamadı — kameraya bakın, yüzünüzü aydınlatın"}</p>
        <p class="muted">İpucu: Kalibrasyondan sonra pencereyi küçültmeyin / taşımayın. Ders boyunca tam ekranda kalın.</p>
        <div class="row" style="justify-content:center;gap:10px"><button class="btn primary" data-go>Başla (Boşluk)</button><button class="btn" data-cancel>Vazgeç (Esc)</button></div>`;
      this.msg.querySelector("[data-go]").onclick = (e) => { this._learnOffset(e); this._start(); };
      this.msg.querySelector("[data-cancel]").onclick = () => this._close(false);
      setTimeout(tick, 300);
    };
    this.waiting = true;
    this._keys = (e) => {
      if (e.code === "Space" && this.waiting) { e.preventDefault(); this._start(); }
      if (e.code === "Escape") this._close(false);
    };
    addEventListener("keydown", this._keys);
    tick();
  }

  _start() {
    if (!this.waiting) return;
    if (this.yeniAkis) return this._startYeni();
    this.waiting = false;
    this._klog("13 nokta başladı", this._screenInfo());
    this.msg.innerHTML = "";
    this._resizeCv();
    const m = 0.06;
    const pts = [];
    for (const y of [m, 0.5, 1 - m]) for (const x of [m, 0.5, 1 - m]) pts.push([x, y]);
    pts.push([0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]);
    this._runPoints(gzShuffle(pts), (d) => this._calibDone(d));
  }

  _runPoints(points, done, op = {}) {
    const SET = op.settle ?? GZ.SETTLE, COL = op.collect ?? GZ.COLLECT, RENK = op.renk ?? "#ff3b3b", R0 = op.r ?? 28;
    const data = [], ctx = this.cv.getContext("2d"), dpr = devicePixelRatio || 1;
    const step = (i) => {
      if (this.cancelled) return;
      if (i === points.length) { ctx.clearRect(0, 0, this.cv.width, this.cv.height); done(data); return; }
      const x = points[i][0] * innerWidth, y = points[i][1] * innerHeight, t0 = performance.now() / 1000;
      let recording = false;
      const anim = () => {
        if (this.cancelled) return;
        const el = performance.now() / 1000 - t0, r = Math.max(R0 * 0.25, R0 - 0.75 * R0 * el / (SET + COL));
        ctx.clearRect(0, 0, this.cv.width, this.cv.height);
        ctx.fillStyle = RENK; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, r * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, 2 * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "#8a94a3"; ctx.font = `${13 * dpr}px system-ui`;
        ctx.fillText(`${i + 1} / ${points.length}`, 16 * dpr, (innerHeight - 16) * dpr);
        if (el >= SET && !recording) { recording = true; this.rec = []; this.recW = []; this.recStat = { frames: 0, blink: 0, noFace: 0, open: [] }; }
        if (el >= SET + COL) {
          const st = this.recStat, n = this.rec.length;
          const ac = st.open.length ? (st.open.reduce((a, b) => a + b, 0) / st.open.length).toFixed(3) : "-";
          this._klog(`nokta ${i + 1}/${points.length} (x %${Math.round(points[i][0] * 100)}, y %${Math.round(points[i][1] * 100)}) → geçerli örnek ${n} / kare ${st.frames} | kırpma sayılan ${st.blink} (ort. göz açıklığı ${ac}) | yüz yok ${st.noFace}${n < 5 ? "  ✗ YETERSİZ (en az 5)" : ""}`,
            { nokta: i + 1, x: Math.round(x), y: Math.round(y), gecerli: n, kare: st.frames, kirpma: st.blink, yuzYok: st.noFace });
          const o = this._off(); this.calOff = o;
          data.push([[x + o.x, y + o.y], this.rec, this.recW]); this.rec = null; this.recW = null; step(i + 1);
        }
        else requestAnimationFrame(anim);
      };
      anim();
    };
    step(0);
  }

  // ================================================================ yeni akış (demo)
  // bakis_test.html'de denenen akış: 9 nokta yalnız bakarak (1 sn yerleşme + 1,2 sn toplama) + 5 noktaya birer tıklama.
  // Tıklamalar önce ölçülür (o anki modelin hatası), sonra modele eklenir. Bizim model ve WebGazer yöntemi aynı karelerden,
  // aynı noktalarla birlikte eğitilir; ayrı bir WebGazer kalibrasyonu ya da kütüphanesi yoktur.
  _startYeni() {
    this.waiting = false;
    this._klog("YENİ akış: 9 nokta bakarak başladı", this._screenInfo());
    this.msg.innerHTML = ""; this._resizeCv();
    const m = 0.06, pts = [];
    for (const y of [m, 0.5, 1 - m]) for (const x of [m, 0.5, 1 - m]) pts.push([x, y]);
    this._runPoints(pts, (d) => this._yeniBakisBitti(d), { settle: 1.0, collect: 1.2, renk: "#facc15", r: 40 });
  }
  _yeniBakisBitti(data) {
    const bad = data.map(([, r], i) => [i + 1, r.length]).filter(([, n]) => n < 5);
    if (bad.length) { this._klog(`BAŞARISIZ: ${bad.length} noktada yeterli örnek yok`, { noktalar: bad }); return this._fail("Bazı noktalarda yüz/göz algılanamadı."); }
    this.geom = this._curGeom();
    const F = [], Y = [], FW = [], YW = [];
    for (const [pt, r, rw] of data) {
      const feats = gzSmoothRows(r.map((row) => row.slice(1))).map(gzModelFeatures), clean = new Set(gzDropOutliers(feats));
      feats.forEach((f, k) => { if (!clean.has(f)) return; F.push(f); Y.push(pt); if (rw?.[k]) { FW.push(gzWgOz(rw[k])); YW.push(pt); } });
    }
    this.model = new GazeModel(); this.model.fit(F, Y);
    this.wgModel = null;
    if (FW.length >= 30) { this.wgModel = new GazeModel(); this.wgModel.fit(FW, YW); }
    this.clickF = []; this.clickY = []; this.wgClickF = []; this.wgClickY = [];
    this._klog(`bakarak modeller kuruldu: bizim ${F.length} örnek, WebGazer yöntemi ${FW.length} örnek${this.wgModel ? "" : " (yama yok/az: WebGazer yöntemi kurulamadı)"}; 5 tıklamalı düzeltme başlıyor`);
    this._duzeltme([[0.3, 0.3], [0.7, 0.3], [0.5, 0.55], [0.3, 0.8], [0.7, 0.8]], F, Y, FW, YW);
  }
  _duzeltme(pts, F, Y, FW, YW) {
    const ctx = this.cv.getContext("2d"), dpr = devicePixelRatio || 1, sonuc = [];
    let i = 0;
    this.ov.style.cursor = "default";
    this.rec = []; this.recW = []; this.recStat = { frames: 0, blink: 0, noFace: 0, open: [] };   // tıklama penceresi için sürekli kayıt
    const ciz = () => {
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      if (i >= pts.length) return;
      const x = pts[i][0] * innerWidth, y = pts[i][1] * innerHeight;
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, 22 * dpr, 0, 7); ctx.fill();
      ctx.fillStyle = "#15181e"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, 3 * dpr, 0, 7); ctx.fill();
      ctx.fillStyle = "#c9d0d9"; ctx.font = `${16 * dpr}px system-ui`;
      ctx.fillText(`Sarı noktaya bakın ve bir kez tıklayın · ${i + 1} / ${pts.length}`, 16 * dpr, (innerHeight - 16) * dpr);
    };
    ciz();
    const ort = (P) => [0, 1].map((j) => P.reduce((s, p) => s + p[j], 0) / P.length);
    this._yeniTik = (e) => {
      if (this.cancelled || i >= pts.length) return;
      const x = pts[i][0] * innerWidth, y = pts[i][1] * innerHeight;
      if (Math.hypot(e.clientX - x, e.clientY - y) > 60) return;
      this._learnOffset(e);
      const now = performance.now() / 1000, R = this.rec, RW = this.recW;
      let idx = R.map((_, k) => k).filter((k) => R[k][0] >= now - GZ.CLICK_WINDOW[0] && R[k][0] <= now - GZ.CLICK_WINDOW[1]);
      if (idx.length < 2) idx = R.map((_, k) => k).filter((k) => R[k][0] >= now - 0.6);   // kare hızı düşükse pencere 0,6 sn
      if (!idx.length) { toast("Yüz/göz algılanmadı, noktaya bakıp tekrar tıklayın.", 2500); return; }
      const o = this._off(), pt = [x + o.x, y + o.y];
      const feats = idx.map((k) => gzModelFeatures(R[k].slice(1))), ws = idx.map((k) => RW[k]).filter(Boolean);
      const pm = ort(feats.map((f) => this.model.predict(f)));
      const pw = this.wgModel && ws.length ? ort(ws.map((w) => this.wgModel.predict(gzWgOz(w)))) : null;
      const W = innerWidth, H = innerHeight, cell = (q) => Math.min(2, Math.max(0, Math.floor(3 * (q[0] - o.x) / W))) + 3 * Math.min(2, Math.max(0, Math.floor(3 * (q[1] - o.y) / H)));
      const s = { hata: Math.round(Math.hypot(pm[0] - pt[0], pm[1] - pt[1])), hataW: pw ? Math.round(Math.hypot(pw[0] - pt[0], pw[1] - pt[1])) : null, hucre: cell(pm) === cell(pt), kare: idx.length };
      sonuc.push(s);
      this._klog(`düzeltme ${i + 1}/${pts.length} → öğretmeden önce hata: bizim ${s.hata} px${pw ? `, WebGazer yöntemi ${s.hataW} px` : ""} (${s.kare} kare)`, s);
      const kat = Math.max(1, Math.round(8 / feats.length));   // tıklama bir bakarak noktası kadar ağırlık alır
      for (let r = 0; r < kat; r++) { for (const f of feats) { F.push(f); Y.push(pt); } for (const w of ws) { FW.push(gzWgOz(w)); YW.push(pt); } }
      this.model.fit(F, Y);
      if (FW.length >= 30) { this.wgModel ||= new GazeModel(); this.wgModel.fit(FW, YW); }
      i++;
      if (i < pts.length) { ciz(); return; }
      this.ov.removeEventListener("pointerdown", this._yeniTik); this._yeniTik = null;
      this.rec = null; this.recW = null; ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      this._yeniBitti(sonuc);
    };
    this.ov.addEventListener("pointerdown", this._yeniTik);
  }
  _yeniBitti(sonuc) {
    const md = (a) => { const v = a.filter((z) => z != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const acc = md(sonuc.map((s) => s.hata)), accW = md(sonuc.map((s) => s.hataW));
    const hit = Math.round(100 * sonuc.filter((s) => s.hucre).length / sonuc.length);
    const deg = Math.atan((acc * 0.0265) / 55) * 180 / Math.PI;
    this.report = { acc, prec: null, hit3: hit, deg: +deg.toFixed(1), at: Date.now(), kamera: `${this.video.videoWidth}x${this.video.videoHeight}`,
                    yontem: "yeni: 9 bakarak + 5 tıklama (demo)", olcum: "5 düzeltme tıklaması, her biri öğretilmeden önce ölçüldü", wgAcc: accW,
                    ...(this.yuzOnce ? { yuz: this.yuzOnce } : {}) };
    this.coarse = hit < GZ.MIN_HIT; this.report.coarse = this.coarse;
    this.save();
    const good = !this.coarse;
    this._klog(`YENİ akış sonucu: ${good ? "TAMAM" : "ZAYIF → KABA MOD"} | 5 tıklamada (öğretmeden önce) medyan hata: bizim ${acc} px, WebGazer yöntemi ${accW ?? "-"} px | 3x3 isabet %${hit}`, this.report);
    this.msg.innerHTML = `<h2>${good ? "✓ Kalibrasyon tamam" : "⚠️ Kalibrasyon zayıf"}</h2>
      <p>5 düzeltme tıklamasında (her biri öğretilmeden önce ölçüldü) medyan hata:<br>
      bizim model <b>${acc} px</b> (~${this.report.deg}°) · WebGazer yöntemi <b>${accW ?? "-"} px</b><br>
      3×3 ekran bölgesi isabeti: <b>%${hit}</b> (5 nokta)</p>
      ${good ? "" : '<p class="warn">Başınızı sabit tutup yüzünüzü önden aydınlatarak tekrar deneyin.</p>'}
      ${this.coarse ? `<p class="warn">İsabet %${GZ.MIN_HIT}'in altında: öğretmene bölge / ısı haritası <b>gönderilmeyecek</b>.</p>` : ""}
      <p class="muted">Ders sırasında ekrana tıkladıkça iki model de kendini o noktaya göre iyileştirir.</p>
      <div class="row" style="justify-content:center;gap:10px"><button class="btn primary" data-ok>Derse dön</button><button class="btn" data-re>Tekrar kalibre et</button></div>`;
    this.msg.querySelector("[data-ok]").onclick = () => this._close(true);
    this.msg.querySelector("[data-re]").onclick = () => { this.msg.innerHTML = ""; this.ov.style.cursor = ""; this._waitStart(); };
  }

  _calibDone(data) {
    const bad = data.map(([, r], i) => [i + 1, r.length]).filter(([, n]) => n < 5);
    if (bad.length) { this._klog(`BAŞARISIZ: ${bad.length} noktada yeterli örnek yok`, { noktalar: bad }); return this._fail("Bazı noktalarda yüz/göz algılanamadı."); }
    this.geom = this._curGeom();
    const F = [], Y = [];
    for (const [pt, r] of data) {
      const clean = gzDropOutliers(gzSmoothRows(r.map((row) => row.slice(1))).map(gzModelFeatures));
      for (const f of clean) { F.push(f); Y.push(pt); }
    }
    this.model = new GazeModel(); this.model.fit(F, Y);
    const hy = F.map((f) => f[5]), hp = F.map((f) => f[6]), rng = (a) => (Math.max(...a) - Math.min(...a)).toFixed(2);
    this._klog(`model kuruldu: ${F.length} örnek (aykırılar atıldıktan sonra); kalibrasyonda baş yaw aralığı ${rng(hy)}, pitch aralığı ${rng(hp)}; doğrulama başlıyor`);
    this.clickF = []; this.clickY = [];
    // 3x3 hücrenin her birinde rastgele bir doğrulama noktası (iyimser olmayan isabet ölçümü)
    const v = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) v.push([(c + 0.15 + Math.random() * 0.7) / 3, (r + 0.15 + Math.random() * 0.7) / 3]);
    this._runPoints(gzShuffle(v), (d) => this._validDone(d));
  }

  _validDone(data) {
    const bad = data.map(([, r], i) => [i + 1, r.length]).filter(([, n]) => n < 5);
    if (bad.length) { this._klog(`DOĞRULAMA BAŞARISIZ: ${bad.length} noktada yeterli örnek yok`, { noktalar: bad }); return this._fail("Doğrulama sırasında göz algılanamadı."); }
    let acc = 0, prec = 0, hit = 0, tot = 0;
    const o = this.calOff || { x: 0, y: 0 };
    const W = innerWidth, H = innerHeight, cell = (x, y) => Math.min(2, Math.max(0, Math.floor(3 * (x - o.x) / W))) + 3 * Math.min(2, Math.max(0, Math.floor(3 * (y - o.y) / H)));
    for (const [pt, r] of data) {
      const P = gzSmoothRows(r.map((row) => row.slice(1))).map((raw) => this.model.predict(gzModelFeatures(raw)));
      const mx = P.reduce((s, p) => s + p[0], 0) / P.length, my = P.reduce((s, p) => s + p[1], 0) / P.length;
      acc += Math.hypot(mx - pt[0], my - pt[1]);
      prec += P.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) / P.length;
      for (const p of P) { tot++; hit += cell(p[0], p[1]) === cell(pt[0], pt[1]); }
    }
    acc /= data.length; prec /= data.length;
    // yaklaşık açı: 96 dpi CSS pikseli ≈ 0.0265 cm, 55 cm uzaklık varsayımı
    const deg = Math.atan((acc * 0.0265) / 55) * 180 / Math.PI;
    this.report = { acc: Math.round(acc), prec: Math.round(prec), hit3: Math.round(100 * hit / tot), deg: +deg.toFixed(1), at: Date.now(),
                    kamera: `${this.video.videoWidth}x${this.video.videoHeight}` };
    this.coarse = this.report.hit3 < GZ.MIN_HIT; this.report.coarse = this.coarse;
    this.save();
    const good = this.report.hit3 >= 70;
    this._klog(`sonuç: ${good ? "TAMAM" : "ZAYIF"}${this.coarse ? " → KABA MOD (bölge gönderilmez)" : ""} | hata ${this.report.acc} px (~${this.report.deg}°, 55 cm varsayımı) | titreme ${this.report.prec} px | 3x3 isabet %${this.report.hit3}`, this.report);
    this.msg.innerHTML = `<h2>${good ? "✓ Kalibrasyon tamam" : "⚠️ Kalibrasyon zayıf"}</h2>
      <p>Ortalama hata <b>${this.report.acc} px</b> (~${this.report.deg}°) · titreme ${this.report.prec} px<br>
      3×3 ekran bölgesi isabeti: <b>%${this.report.hit3}</b></p>
      ${good ? "" : '<p class="warn">Başınızı sabit tutup yüzünüzü önden aydınlatarak tekrar deneyin.</p>'}
      ${this.coarse ? `<p class="warn">İsabet %${GZ.MIN_HIT}'in altında: ekran bölgeleri ayırt edilemiyor. Öğretmene bölge / ısı haritası <b>gönderilmeyecek</b>; yalnızca "ekrana bakıyor mu" kullanılacak.</p>` : ""}
      <p class="muted">Ders sırasında ekranda bir yere tıkladığınızda model kendini o noktaya göre iyileştirir.</p>
      <div class="row" style="justify-content:center;gap:10px"><button class="btn primary" data-ok>Derse dön</button><button class="btn" data-re>Tekrar kalibre et</button></div>`;
    this.msg.querySelector("[data-ok]").onclick = () => this._close(true);
    this.msg.querySelector("[data-re]").onclick = () => { this.msg.innerHTML = ""; this._waitStart(); };
  }

  _fail(why) { this._waitStart(why + " Tekrar deneyin."); }

  _close(ok) {
    this._klog(ok ? "kapatıldı: model kullanılacak" : "kapatıldı: vazgeçildi", { modelVar: !!this.model });
    this.cancelled = true; this.waiting = false; this.rec = null; this.recW = null;
    if (this._yeniTik && this.ov) { this.ov.removeEventListener("pointerdown", this._yeniTik); this._yeniTik = null; }
    removeEventListener("keydown", this._keys);
    this.ov?.remove(); this.ov = null;
    document.documentElement.style.overflow = "";
    setTimeout(() => (this.cancelled = false), 50);
    this.calibrating = false;
    if (ok) { this.startTracking(); this.stale = false; this.onStatus("ok"); }
    else if (!this.model) this.onStatus("Kalibre edilmedi");
  }
}

function gzShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

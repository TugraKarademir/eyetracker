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
  SETTLE: 0.7, COLLECT: 1.0, SMOOTH: 3, BLINK: 0.15,
  CLICK_WINDOW: [0.35, 0.05], CLICK_WEIGHT: 3, CLICK_MAX: 600, CLICK_RADIUS: 300,
  SNAP: 60, HOLD: 4,
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
// ham: [rx, ry, lx, ly, ro, lo]  ->  model: [rx, ry, lx, ly, ortalama açıklık]
const gzModelFeatures = (r) => [r[0], r[1], r[2], r[3], (r[4] + r[5]) / 2];
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
    this.point = null; this.region = null; this.stale = false;
    this.win = { n: 0, counts: {}, pts: [] };
    this.dot = null; this.showDot = false;
    this._onClick = (e) => this.learnClick(e);
  }

  async load() {
    this.onStatus("Bakış modeli yükleniyor…");
    const v = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await v.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const mk = (delegate) => v.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: "VIDEO", numFaces: 1,
    });
    try { this.mesh = await mk("GPU"); } catch { this.mesh = await mk("CPU"); }
    this.ready = true;
    this._frame();
    if (this.restore()) this.onStatus("ok");
    else this.onStatus("Kalibre edilmedi");
  }

  // Her kamera karesinde: özellik vektörü (webgaze Tracker.run)
  _frame() {
    if (!this.ready) return;
    const next = () => (this.video.requestVideoFrameCallback
      ? this.video.requestVideoFrameCallback(() => this._frame())
      : requestAnimationFrame(() => this._frame()));
    if (this.paused || this.video.readyState < 2) { setTimeout(next, 200); return; }
    const t = performance.now() / 1000;
    let res;
    try { res = this.mesh.detectForVideo(this.video, performance.now()); } catch { next(); return; }
    const lm = res.faceLandmarks && res.faceLandmarks[0];
    if (lm && lm.length >= 478) {
      const w = this.video.videoWidth, h = this.video.videoHeight;
      const p = lm.map((q) => [q.x * w, q.y * h]);
      const [rx, ry, ro] = gzEyeFeatures(p, GZ.EYE_R), [lx, ly, lo] = gzEyeFeatures(p, GZ.EYE_L);
      const raw = [rx, ry, lx, ly, ro, lo], blink = (ro + lo) / 2 < GZ.BLINK;
      this.latest = { t, raw, blink };
      if (this.rec && !blink) this.rec.push([t, ...raw]);
      if (this.tracking && !blink) this._predict(t, raw);
    } else {
      this.latest = null;
      if (this.tracking) this._sample(null);
    }
    next();
  }

  _predict(t, raw) {
    if (!this._geomOk()) { this._sample(null); return; }
    this.recent.push(raw); if (this.recent.length > GZ.SMOOTH) this.recent.shift();
    const avg = raw.map((_, j) => this.recent.reduce((s, r) => s + r[j], 0) / this.recent.length);
    const f = gzModelFeatures(avg);
    const [px, py] = this.model.predict(f);
    this.hist.push({ t, f, p: [px, py] }); if (this.hist.length > 60) this.hist.shift();
    const x = this.fx.f(px, t), y = this.fy.f(py, t);
    this.point = [x, y];
    this._sample(x, y);
    if (this.dot && this.showDot) {
      this.dot.style.transform = `translate(${Math.min(Math.max(x, 0), innerWidth) - 18}px, ${Math.min(Math.max(y, 0), innerHeight) - 18}px)`;
    }
  }

  // Bir örneği bölgeye ata ve gönderim penceresine ekle
  _sample(x, y) {
    let name = null, uv = null;
    if (document.hidden) name = "disari";
    else if (x != null) {
      const mx = innerWidth * 0.06, my = innerHeight * 0.06;
      if (x < -mx || y < -my || x > innerWidth + mx || y > innerHeight + my) name = "disari";
      else {
        const regions = this.getRegions ? this.getRegions() : [];
        const r = this.assigner.assign(regions, x, y);
        name = r ? r.name : "sayfa";
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
    this.win = { n: 0, counts: {}, pts: [] };
    if (!this.model || this.stale || !this.tracking) return { cal: false };
    if (document.hidden) return { cal: true, region: "disari", share: { disari: 1 }, pts: [] };
    if (!w.n) return { cal: true, region: null, share: {}, pts: [] };
    const share = {};
    for (const k in w.counts) share[k] = +(w.counts[k] / w.n).toFixed(3);
    const region = Object.entries(w.counts).sort((a, b) => b[1] - a[1])[0][0];
    const pts = w.pts.slice(-30).map(([u, v]) => [+u.toFixed(3), +v.toFixed(3)]);
    return { cal: true, region, share, pts };
  }

  // Kalibrasyon sırasındaki pencere/ekran geometrisi değişirse model geçersizdir
  _curGeom() { return { w: innerWidth, h: innerHeight, sx: screenX, sy: screenY }; }
  _geomOk() {
    const g = this.geom, c = this._curGeom();
    const ok = g && Math.abs(g.w - c.w) <= 2 && Math.abs(g.h - c.h) <= 2 && Math.abs(g.sx - c.sx) <= 2 && Math.abs(g.sy - c.sy) <= 2;
    if (!ok !== this.stale) { this.stale = !ok; this.onStatus(this.stale ? "stale" : "ok"); }
    return ok;
  }

  startTracking() {
    this.tracking = true; this.recent = []; this.fx = new OneEuro(); this.fy = new OneEuro();
    this.assigner = new RegionAssigner();
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
  _key() { const c = this._curGeom(); return `dn_gaze_${c.w}x${c.h}`; }
  save() { store.set(this._key(), { geom: this.geom, model: this.model.toJSON(), report: this.report }); }
  restore() {
    const d = store.get(this._key());
    if (!d || !d.model) return false;
    this.model = GazeModel.from(d.model); this.geom = d.geom; this.report = d.report;
    this.startTracking(); this._geomOk();
    return true;
  }

  // ---- tıklamayla öğrenme (webgaze learn_click)
  learnClick(e) {
    if (!this.model || !this.model.F || this.calibrating || this.stale) return;
    const now = performance.now() / 1000;
    const recent = this.hist.filter((h) => h.t >= now - GZ.CLICK_WINDOW[0] && h.t <= now - GZ.CLICK_WINDOW[1]);
    if (recent.length < 2) return;
    const pred = [0, 1].map((k) => recent.reduce((s, h) => s + h.p[k], 0) / recent.length);
    if (Math.hypot(pred[0] - e.clientX, pred[1] - e.clientY) > GZ.CLICK_RADIUS) return;
    for (const h of recent) { this.clickF.push(h.f); this.clickY.push([e.clientX, e.clientY]); }
    while (this.clickF.length > GZ.CLICK_MAX) { this.clickF.shift(); this.clickY.shift(); }
    const cF = this.clickF.flatMap((f) => Array(GZ.CLICK_WEIGHT).fill(f));
    const cY = this.clickY.flatMap((y) => Array(GZ.CLICK_WEIGHT).fill(y));
    const { F, Y } = this.model;
    this.model.fit([...F, ...cF], [...Y, ...cY]);
    this.model.F = F; this.model.Y = Y;                     // kalibrasyon kümesi şişmesin
  }

  // ================================================================ kalibrasyon
  async calibrate() {
    if (!this.ready) { toast("Bakış modeli henüz yüklenmedi."); return; }
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
    this._waitStart();
  }

  _resizeCv() { const d = devicePixelRatio || 1; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; }

  _waitStart(extra = "") {
    const tick = () => {
      if (!this.waiting) return;
      const ok = this.latest && performance.now() / 1000 - this.latest.t < 0.5;
      this.msg.innerHTML = `<h2>👁️ Bakış kalibrasyonu</h2>
        ${extra ? `<p class="warn">${extra}</p>` : ""}
        <p>Başınızı sabit tutun, <b>yalnızca gözlerinizle</b> kırmızı noktaları takip edin.<br>
        13 nokta + 9 doğrulama noktası, yaklaşık 40 saniye sürer.</p>
        <p class="${ok ? "ok" : "warn"}">${ok ? "Yüz ve gözler algılandı ✓" : "Yüz bulunamadı — kameraya bakın, yüzünüzü aydınlatın"}</p>
        <p class="muted">İpucu: Kalibrasyondan sonra pencereyi küçültmeyin / taşımayın. Ders boyunca tam ekranda kalın.</p>
        <div class="row" style="justify-content:center;gap:10px"><button class="btn primary" data-go>Başla (Boşluk)</button><button class="btn" data-cancel>Vazgeç (Esc)</button></div>`;
      this.msg.querySelector("[data-go]").onclick = () => this._start();
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
    this.waiting = false;
    this.msg.innerHTML = "";
    this._resizeCv();
    const m = 0.06;
    const pts = [];
    for (const y of [m, 0.5, 1 - m]) for (const x of [m, 0.5, 1 - m]) pts.push([x, y]);
    pts.push([0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]);
    this._runPoints(gzShuffle(pts), (d) => this._calibDone(d));
  }

  _runPoints(points, done) {
    const data = [], ctx = this.cv.getContext("2d"), dpr = devicePixelRatio || 1;
    const step = (i) => {
      if (this.cancelled) return;
      if (i === points.length) { ctx.clearRect(0, 0, this.cv.width, this.cv.height); done(data); return; }
      const x = points[i][0] * innerWidth, y = points[i][1] * innerHeight, t0 = performance.now() / 1000;
      let recording = false;
      const anim = () => {
        if (this.cancelled) return;
        const el = performance.now() / 1000 - t0, r = Math.max(5, 28 - 23 * el / GZ.SETTLE);
        ctx.clearRect(0, 0, this.cv.width, this.cv.height);
        ctx.fillStyle = "#ff3b3b"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, r * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, 2 * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "#8a94a3"; ctx.font = `${13 * dpr}px system-ui`;
        ctx.fillText(`${i + 1} / ${points.length}`, 16 * dpr, (innerHeight - 16) * dpr);
        if (el >= GZ.SETTLE && !recording) { recording = true; this.rec = []; }
        if (el >= GZ.SETTLE + GZ.COLLECT) { data.push([[x, y], this.rec]); this.rec = null; step(i + 1); }
        else requestAnimationFrame(anim);
      };
      anim();
    };
    step(0);
  }

  _calibDone(data) {
    if (data.some(([, r]) => r.length < 5)) return this._fail("Bazı noktalarda yüz/göz algılanamadı.");
    this.geom = this._curGeom();
    const F = [], Y = [];
    for (const [pt, r] of data) {
      const clean = gzDropOutliers(gzSmoothRows(r.map((row) => row.slice(1))).map(gzModelFeatures));
      for (const f of clean) { F.push(f); Y.push(pt); }
    }
    this.model = new GazeModel(); this.model.fit(F, Y);
    this.clickF = []; this.clickY = [];
    // 3x3 hücrenin her birinde rastgele bir doğrulama noktası (iyimser olmayan isabet ölçümü)
    const v = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) v.push([(c + 0.15 + Math.random() * 0.7) / 3, (r + 0.15 + Math.random() * 0.7) / 3]);
    this._runPoints(gzShuffle(v), (d) => this._validDone(d));
  }

  _validDone(data) {
    if (data.some(([, r]) => r.length < 5)) return this._fail("Doğrulama sırasında göz algılanamadı.");
    let acc = 0, prec = 0, hit = 0, tot = 0;
    const W = innerWidth, H = innerHeight, cell = (x, y) => Math.min(2, Math.max(0, Math.floor(3 * x / W))) + 3 * Math.min(2, Math.max(0, Math.floor(3 * y / H)));
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
    this.report = { acc: Math.round(acc), prec: Math.round(prec), hit3: Math.round(100 * hit / tot), deg: +deg.toFixed(1), at: Date.now() };
    this.save();
    const good = this.report.hit3 >= 70;
    this.msg.innerHTML = `<h2>${good ? "✓ Kalibrasyon tamam" : "⚠️ Kalibrasyon zayıf"}</h2>
      <p>Ortalama hata <b>${this.report.acc} px</b> (~${this.report.deg}°) · titreme ${this.report.prec} px<br>
      3×3 ekran bölgesi isabeti: <b>%${this.report.hit3}</b></p>
      ${good ? "" : '<p class="warn">Başınızı sabit tutup yüzünüzü önden aydınlatarak tekrar deneyin.</p>'}
      <p class="muted">Ders sırasında ekranda bir yere tıkladığınızda model kendini o noktaya göre iyileştirir.</p>
      <div class="row" style="justify-content:center;gap:10px"><button class="btn primary" data-ok>Derse dön</button><button class="btn" data-re>Tekrar kalibre et</button></div>`;
    this.msg.querySelector("[data-ok]").onclick = () => this._close(true);
    this.msg.querySelector("[data-re]").onclick = () => { this.msg.innerHTML = ""; this._waitStart(); };
  }

  _fail(why) { this._waitStart(why + " Tekrar deneyin."); }

  _close(ok) {
    this.cancelled = true; this.waiting = false; this.rec = null;
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

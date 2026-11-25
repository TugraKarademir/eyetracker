// Gövde duruşu (kullanıcı kararı 25.11.2026): MediaPipe PoseLandmarker (lite), saniyede DUR_CFG.HZ kez, yalnız kayıt
// (hiçbir hesaba/öğretmen paneline girmez). Görüntü saklanmaz; 33 nokta (normalize x, y, z, görünürlük) ve dünya koordinatları (m).
// Model yüz modeli gibi çalışma anında Google'ın adresinden yüklenir (internet gerekir). Yavaş cihazda kendini kapatır:
// ısınma sonrası son DUR_CFG.OLCU_N ölçümün MEDYAN süresi DUR_CFG.YAVAS_MS'yi aşarsa durur ve nedenini bildirir (onKapandi).
// Noktalar: 0 burun, 1-10 yüz, 11/12 sol/sağ omuz, 13/14 dirsek, 15/16 bilek, 17-22 el, 23/24 kalça, 25-32 bacak (genelde görünmez).
const DUR_CFG = {
  HZ: 3, YAVAS_MS: 60, OLCU_N: 20, ISINMA: 5, MIN_GORUNUR: 0.5,   // ISINMA: ilk ölçümler (model/GPU ısınması, saniyeler sürebilir) sayılmaz
  MODEL: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
};

// Saf: noktalardan duruş ölçüleri (görünürlüğü MIN_GORUNUR altındaki nokta yok sayılır). n: [[x, y, z, g], ...] normalize; asp: en/boy.
// omuzAci: omuz çizgisinin yataydan sapması (derece, + sağ omuz aşağı), omuzGen: omuz genişliği (görüntü genişliği oranı),
// omuzOrta: [x, y], basOmuz: burnun omuz ortasının ne kadar üstünde olduğu / omuz genişliği (çökme/öne eğilmede azalır),
// basYana: burnun omuz ortasından yatay sapması / omuz genişliği. Omuzlar görünmüyorsa null.
function durusOlcu(n, asp = 16 / 9, minG = DUR_CFG.MIN_GORUNUR) {
  const g = (i) => (n && n[i] && n[i][3] >= minG ? n[i] : null);
  const sol = g(11), sag = g(12), burun = g(0);
  if (!sol || !sag) return null;
  const dx = (sol[0] - sag[0]) * asp, dy = sol[1] - sag[1], gen = Math.hypot(dx, dy);
  if (!(gen > 1e-6)) return null;
  const ox = (sol[0] + sag[0]) / 2, oy = (sol[1] + sag[1]) / 2, r = (v, d = 3) => +v.toFixed(d);
  return { omuzAci: r(Math.atan2(dy, dx) * 180 / Math.PI, 1), omuzGen: r(gen / asp), omuzOrta: [r(ox), r(oy)],
           basOmuz: burun ? r((oy - burun[1]) / gen) : null, basYana: burun ? r(((burun[0] - ox) * asp) / gen) : null };
}

class GovdeDurusu {
  constructor(video, { onSonuc = () => {}, onKapandi = () => {} } = {}) {
    Object.assign(this, { video, onSonuc, onKapandi });
    this.enabled = false; this.ready = false; this.kapali = null; this.sureler = [];
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const v = await import(`${MP_BASE}/vision_bundle.mjs`);
      const files = await v.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const mk = (delegate) => v.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: DUR_CFG.MODEL, delegate }, runningMode: "VIDEO", numPoses: 1 });
      try { this.lm = await mk("GPU"); this.delegate = "GPU"; } catch { this.lm = await mk("CPU"); this.delegate = "CPU"; }
      this.ready = true;
    })();
    return this.loading;
  }
  async setEnabled(on) {
    this.enabled = on && !this.kapali;
    clearTimeout(this.timer);
    if (!this.enabled) return;
    await this.load();
    if (this.enabled) this.loop();
  }
  loop() {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    try { this.step(); } catch (e) { console.warn("gövde duruşu hatası", e); }
    if (this.enabled) this.timer = setTimeout(() => this.loop(), 1000 / DUR_CFG.HZ);
  }
  step() {
    if (document.hidden || this.video.readyState < 2) return;
    const t0 = performance.now();
    const r = this.lm.detectForVideo(this.video, t0);
    const ms = performance.now() - t0;
    this.olcumN = (this.olcumN || 0) + 1;
    if (this.olcumN > DUR_CFG.ISINMA) { this.sureler.push(ms); if (this.sureler.length > DUR_CFG.OLCU_N) this.sureler.shift(); }
    const yuv = (v, d) => (Number.isFinite(v) ? +v.toFixed(d) : null);
    const L = r.landmarks?.[0], W = r.worldLandmarks?.[0];
    const n = L ? L.map((p) => [yuv(p.x, 4), yuv(p.y, 4), yuv(p.z, 4), yuv(p.visibility, 2)]) : null;
    const asp = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
    this.onSonuc({ ep: Math.round(performance.timeOrigin + t0), ms: Math.round(ms), n, w: W ? W.map((p) => [yuv(p.x, 3), yuv(p.y, 3), yuv(p.z, 3)]) : null,
                   olcu: n ? durusOlcu(n, asp) : null });
    if (this.sureler.length >= DUR_CFG.OLCU_N) {
      const s = [...this.sureler].sort((a, b) => a - b), med = s[s.length >> 1];
      if (med > DUR_CFG.YAVAS_MS) {
        this.kapali = { neden: "yavas", medyanMs: Math.round(med), sinirMs: DUR_CFG.YAVAS_MS, delegate: this.delegate };
        this.enabled = false; clearTimeout(this.timer); this.onKapandi(this.kapali);
      }
    }
  }
}

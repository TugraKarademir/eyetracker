// TEST: HSEmotion (EfficientNet-B0, AffectNet, enet_b0_8_va_mtl) ile tarayıcıda duygu tahmini.
// Model kodu ve ağırlıkları Apache-2.0 (github.com/HSE-asavchenko/hsemotion-onnx); AffectNet veri setinin
// kendi koşulları "ticari olmayan araştırma ve eğitim" amaçlıdır.
// Çıktı: 8 duygu olasılığı + valence (olumsuz -1 … olumlu +1) + arousal (sakin -1 … uyarılmış +1).
// Ön işleme hsemotion_onnx/facial_emotions.py ile aynı: 224x224 RGB, /255, ImageNet ortalama/sapma, NCHW.

const HSE_MODEL = "/models/enet_b0_8_va_mtl.onnx";
const HSE_ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const HSE_CLASSES = ["Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"];
const HSE_TR = { Anger: "Öfke", Contempt: "Küçümseme", Disgust: "İğrenme", Fear: "Korku", Happiness: "Mutluluk", Neutral: "Nötr", Sadness: "Üzüntü", Surprise: "Şaşkınlık" };
const HSE_CFG = { HZ: 2, SIZE: 224, MARGIN: 0.15, EMA: 0.5, MEAN: [0.485, 0.456, 0.406], STD: [0.229, 0.224, 0.225] };

class HSEmotionProbe {
  /** @param video kamera <video>, @param getFace () => {t, box:{x0,y0,x1,y1}} (normalize) */
  constructor(video, { getFace = () => null, isOccluded = () => false, getBaseline = () => null } = {}) {
    Object.assign(this, { video, getFace, isOccluded, getBaseline });
    this.ready = false; this.enabled = false; this.busy = false;
    this.cv = document.createElement("canvas"); this.cv.width = this.cv.height = HSE_CFG.SIZE;
    this.ctx = this.cv.getContext("2d", { willReadFrequently: true });
    this.reset();
  }
  reset() { this.probs = null; this.valence = null; this.arousal = null; this.t = -Infinity; this.ms = null; this.occluded = false; this.status = "kapalı"; }

  static async loadScript(src) {
    if (window.ort) return;
    await new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("onnxruntime yüklenemedi")); document.head.append(s); });
  }
  // Modeli tarayıcının kalıcı deposundan al; yoksa bir kez indirip kaydet (el modeliyle aynı yöntem)
  static async modelBytes() {
    let cache = null;
    try { cache = await caches.open("dn-models-v1"); } catch {}
    let res = cache && (await cache.match(HSE_MODEL));
    HSEmotionProbe.fromCache = !!res;
    if (!res) {
      res = await fetch(HSE_MODEL);
      if (!res.ok) throw new Error("HSEmotion modeli indirilemedi: " + res.status);
      if (cache) { try { await cache.put(HSE_MODEL, res.clone()); } catch {} }
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.status = "model yükleniyor…";
      await HSEmotionProbe.loadScript(HSE_ORT + "ort.min.js");
      ort.env.wasm.wasmPaths = HSE_ORT;
      const bytes = await HSEmotionProbe.modelBytes();
      this.session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
      this.inputName = this.session.inputNames[0];
      this.ready = true; this.status = "hazır";
    })();
    return this.loading;
  }

  async setEnabled(on) {
    this.enabled = on; clearTimeout(this.timer);
    if (!on) { this.reset(); return; }
    await this.load();
    if (this.enabled) this.loop();
  }

  loop() {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    this.step().catch((e) => { console.warn("HSEmotion hatası", e); this.status = "hata: " + e.message; })
      .finally(() => { this.timer = setTimeout(() => this.loop(), 1000 / HSE_CFG.HZ); });
  }

  /** Yüzü kare olarak kırp (kenar payıyla), 224x224'e ölçekle, NCHW float32 tensöre çevir. */
  tensorFromFace(box) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const cx = (box.x0 + box.x1) / 2 * vw, cy = (box.y0 + box.y1) / 2 * vh;
    const side = Math.max((box.x1 - box.x0) * vw, (box.y1 - box.y0) * vh) * (1 + 2 * HSE_CFG.MARGIN);
    const S = HSE_CFG.SIZE;
    this.ctx.drawImage(this.video, cx - side / 2, cy - side / 2, side, side, 0, 0, S, S);
    const px = this.ctx.getImageData(0, 0, S, S).data, n = S * S, f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) f[c * n + i] = (px[i * 4 + c] / 255 - HSE_CFG.MEAN[c]) / HSE_CFG.STD[c];
    return new ort.Tensor("float32", f, [1, 3, S, S]);
  }

  async step() {
    if (this.busy || document.hidden || this.video.readyState < 2) return;
    const face = this.getFace(), now = performance.now() / 1000;
    if (!face || now - face.t > 1 || !face.box) { this.status = "yüz yok"; this.occluded = false; return; }
    // El yüzü örterken ölçüm YOK: this.t yenilenmez, occluded işaretlenir -> fresh() false döner.
    // (Eskiden this.t = now yapılıyordu; donmuş değer "taze" sayılıp tabana/kayıtlara tekrar tekrar giriyordu.)
    if (this.isOccluded()) { this.occluded = true; this.status = "el yüzü örtüyor (ölçüm yok)"; return; }
    this.occluded = false;
    this.busy = true;
    try {
      const t0 = performance.now();
      const out = await this.session.run({ [this.inputName]: this.tensorFromFace(face.box) });
      const y = out[this.session.outputNames[0]].data;               // 8 logit + valence + arousal
      const lg = Array.from(y.slice(0, 8)), mx = Math.max(...lg);
      const ex = lg.map((v) => Math.exp(v - mx)), sum = ex.reduce((a, b) => a + b, 0), pHam = ex.map((v) => v / sum);
      // Kişisel nötr taban (bakış testi yüz profili) varsa dinlenik yüzdeki duygu payı nötre eklenir
      const tb = this.getBaseline?.() || null; this.tabanli = !!tb;
      const pd = notrTabanDuzelt(Object.fromEntries(HSE_CLASSES.map((c, i) => [c, pHam[i]])), tb, "Neutral");
      const p = HSE_CLASSES.map((c) => pd[c]);
      // Son gerçek ölçüm 2 sn'den eskiyse (örtülme/yüz yok sonrası) EMA eski değerle karıştırılmaz, sıfırdan başlar
      const a = now - this.t < 2 ? HSE_CFG.EMA : 1;
      this.probs = this.probs ? this.probs.map((v, i) => v + (p[i] - v) * a) : p;
      this.valence = this.valence == null ? y[8] : this.valence + (y[8] - this.valence) * a;
      this.arousal = this.arousal == null ? y[9] : this.arousal + (y[9] - this.arousal) * a;
      this.raw = { probs: p, probsHam: pHam, valence: y[8], arousal: y[9] };
      this.ms = Math.round(performance.now() - t0); this.t = now; this.status = "çalışıyor";
    } finally { this.busy = false; }
  }

  // Taze = son 2 sn içinde gerçekten ölçülmüş VE şu an el yüzü örtmüyor
  fresh() { return !this.occluded && performance.now() / 1000 - this.t < 2 && !!this.probs; }
  top() {
    if (!this.fresh()) return null;
    const i = this.probs.indexOf(Math.max(...this.probs));
    return { name: HSE_CLASSES[i], tr: HSE_TR[HSE_CLASSES[i]], p: this.probs[i] };
  }
}

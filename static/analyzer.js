// Tarayıcı içi yüz analizi: dikkat, enerji (yorgunluk), duygu.
// face-api (TinyFaceDetector + 68 nokta landmark + ifade modeli) kullanır.
// Görüntü hiçbir yere gönderilmez; yalnızca hesaplanan sayılar dışarı verilir.

const FACEAPI_MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/";

class FocusAnalyzer {
  constructor(video, { interval = 300, onUpdate } = {}) {
    this.video = video; this.interval = interval; this.onUpdate = onUpdate || (() => {});
    this.running = false;
    this.calib = { yaw: [], pitch: [], ear: [] };
    this.base = null;              // { yaw, pitch, ear }
    this.att = 70; this.energy = 85;
    this.emo = { mutlu: 0, notr: 1, kafa_karisik: 0, zorlaniyor: 0 };
    this.eyeHist = [];             // [t, closed]
    this.closedSince = null; this.mouthOpenSince = null; this.yawns = [];
    this.state = { attention: 70, energy: 85, emotion: "notr", face: false, lookingAway: false, eyesClosed: false, tabHidden: false, calibrating: true };
  }

  async load(onProgress = () => {}) {
    onProgress("Yapay zekâ modelleri yükleniyor…");
    await faceapi.tf.setBackend("webgl").catch(() => faceapi.tf.setBackend("cpu"));
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODELS),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODELS),
      faceapi.nets.faceExpressionNet.loadFromUri(FACEAPI_MODELS),
    ]);
    this.opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
  }

  start() { if (!this.running) { this.running = true; this.loop(); } }
  stop() { this.running = false; clearTimeout(this.timer); }
  recalibrate() { this.base = null; this.calib = { yaw: [], pitch: [], ear: [] }; this.state.calibrating = true; }

  async loop() {
    if (!this.running) return;
    const t0 = performance.now();
    try { await this.step(); } catch (e) { console.warn("analiz hatası", e); }
    const spent = performance.now() - t0;
    this.timer = setTimeout(() => this.loop(), Math.max(60, this.interval - spent));
  }

  async step() {
    const now = performance.now() / 1000;
    const hidden = document.hidden;
    let det = null;
    if (!hidden && this.video.readyState >= 2) {
      det = await faceapi.detectSingleFace(this.video, this.opts).withFaceLandmarks().withFaceExpressions();
    }
    const s = this.state;
    s.tabHidden = hidden; s.face = !!det;
    let raw = 0, closed = false, away = false;

    if (det) {
      const p = det.landmarks.positions;
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const ear = (i) => (d(p[i + 1], p[i + 5]) + d(p[i + 2], p[i + 4])) / (2 * d(p[i], p[i + 3]));
      const EAR = (ear(36) + ear(42)) / 2;
      const L = p[36], R = p[45], nose = p[30], chin = p[8];
      const mid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
      const yaw = (nose.x - L.x) / (R.x - L.x || 1) - 0.5;          // ~0 karşıya bakarken
      const pitch = (nose.y - mid.y) / (chin.y - mid.y || 1);        // kalibrasyona göre sapma
      const MAR = d(p[62], p[66]) / (d(p[60], p[64]) || 1);

      // Kalibrasyon: ilk ~3 sn kullanıcı ekrana bakıyor kabul edilir
      if (!this.base) {
        this.calib.yaw.push(yaw); this.calib.pitch.push(pitch); this.calib.ear.push(EAR);
        if (this.calib.yaw.length >= 10) {
          const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
          this.base = { yaw: med(this.calib.yaw), pitch: med(this.calib.pitch), ear: med(this.calib.ear) };
          s.calibrating = false;
        }
      } else if (EAR > this.base.ear * 0.85) {
        this.base.ear += (EAR - this.base.ear) * 0.02;              // açık göz tabanını yavaşça takip et
      }
      const b = this.base || { yaw: 0, pitch: pitch, ear: EAR };

      // Göz kapalılığı (kırpma ≠ uyuklama: 0.6 sn üstü sayılır)
      const eyeShut = EAR < b.ear * 0.62;
      if (eyeShut) { this.closedSince ??= now; } else this.closedSince = null;
      closed = this.closedSince != null && now - this.closedSince > 0.6;
      this.eyeHist.push([now, eyeShut ? 1 : 0]);

      // Esneme
      if (MAR > 0.6) { this.mouthOpenSince ??= now; if (now - this.mouthOpenSince > 1.5 && !this.yawnMarked) { this.yawns.push(now); this.yawnMarked = true; } }
      else { this.mouthOpenSince = null; this.yawnMarked = false; }

      // Baş yönü
      const dy = Math.abs(yaw - b.yaw), dp = Math.abs(pitch - b.pitch);
      away = dy > 0.17 || dp > 0.14;
      raw = 100 - Math.max(0, dy - 0.07) * 380 - Math.max(0, dp - 0.06) * 380;
      if (closed) raw *= 0.25;
      raw = Math.max(0, Math.min(100, raw));

      // Duygu (ifade olasılıklarını kategorilere indirger, yumuşatır)
      const e = det.expressions;
      const cat = {
        mutlu: e.happy,
        notr: e.neutral * 0.8,
        kafa_karisik: e.surprised + e.fearful * 0.6,
        zorlaniyor: e.sad + e.angry + e.disgusted + e.fearful * 0.4,
      };
      for (const k in this.emo) this.emo[k] += (cat[k] - this.emo[k]) * 0.2;
    }

    // Dikkat: üstel yumuşatma (düşüşler biraz daha hızlı yansır)
    const k = raw < this.att ? 0.3 : 0.2;
    this.att += (raw - this.att) * k;

    // Enerji: son 60 sn göz kapalılık oranı (PERCLOS) + son 3 dk esneme
    this.eyeHist = this.eyeHist.filter(([t]) => now - t < 60);
    this.yawns = this.yawns.filter((t) => now - t < 180);
    const perclos = this.eyeHist.length ? this.eyeHist.reduce((a, [, c]) => a + c, 0) / this.eyeHist.length : 0;
    let en = 100 - Math.max(0, perclos - 0.08) * 260 - this.yawns.length * 12 - (closed ? 25 : 0);
    if (!det) en = this.energy;                                       // yüz yokken enerjiyi dondur
    this.energy += (Math.max(5, Math.min(100, en)) - this.energy) * 0.1;

    s.attention = Math.round(this.att);
    s.energy = Math.round(this.energy);
    s.eyesClosed = closed; s.lookingAway = away;
    s.emotion = Object.entries(this.emo).sort((a, b) => b[1] - a[1])[0][0];
    s.perclos = Math.round(perclos * 100); s.yawns = this.yawns.length;
    this.onUpdate(s, det);
  }
}

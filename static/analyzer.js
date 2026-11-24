// Tarayıcı içi yüz analizi: dikkat, enerji (yorgunluk), duygu.
// face-api (TinyFaceDetector + 68 nokta landmark + ifade modeli) kullanır.
// Görüntü hiçbir yere gönderilmez; yalnızca hesaplanan sayılar dışarı verilir.

// Göz kapalı eşiği (MediaPipe eyeBlink 0-1). Başlangıç değerleri; [GÖZ] konsol kaydıyla ayarlanmalı.
const EYE_CFG = { BLINK: 0.55, DOWN_EXTRA: 0.25 };   // tam aşağı bakışta eşik 0.55 → 0.80
// Baş yönü: büyük ekranda kenarlara bakarken baş dönüyor ve sabit sınır (±0.17) "ekrana bakmıyor" diyordu.
// Kişinin son 5 dk'daki baş yönü dağılımından (yüzde 10-90 aralığı) "ekran alanı" öğrenilir; sınır yalnızca
// genişleyebilir (MIN = eski sabit davranış) ve en fazla MAX kadar (telefona/yana bakış yine yakalansın).
const POSE_CFG = { WIN: 300, EVERY: 0.5, MIN_N: 30, P_LO: 0.1, P_HI: 0.9,
  YAW_MIN: 0.07, YAW_MAX: 0.30, PITCH_MIN: 0.06, PITCH_MAX: 0.22, AWAY_YAW: 0.10, AWAY_PITCH: 0.08 };

const FACEAPI_MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/";

// Ham ölçü toplayıcı (sınıf testi, 24.11): analizörün her karede ZATEN hesapladığı değerleri (yaw, pitch, EAR, MAR, kapalı göz
// kararı, face-api ifade olasılıkları) ve bakış modülünün 3B baş pozunu gönderim penceresi (≈2 sn) boyunca biriktirir.
// Salt okunur: hiçbir hesabı değiştirmez. al() özeti verir; hiç kare yoksa null (uydurma yok). Ölçülemeyen alan null.
class HamToplayici {
  constructor() {
    this.n = 0; this.yuzN = 0; this.t0 = null; this.t1 = null;
    this.yaw = []; this.pitch = []; this.ear = []; this.mar = []; this.kapali = 0;
    this.ifade = {}; this.ifadeN = 0; this.p3 = { yaw: [], pitch: [], roll: [], dist: [] }; this.p3t = undefined;
  }
  kare(t) { if (this.t0 == null) this.t0 = t; this.t1 = t; this.n++; }
  yuz({ yaw, pitch, ear, mar, kapali, ifade }) {
    this.yuzN++;
    const ekle = (a, v) => { if (Number.isFinite(v)) a.push(v); };
    ekle(this.yaw, yaw); ekle(this.pitch, pitch); ekle(this.ear, ear); ekle(this.mar, mar);
    if (kapali) this.kapali++;
    if (ifade && typeof ifade === "object") {
      let oldu = false;
      for (const k in ifade) if (Number.isFinite(ifade[k])) { this.ifade[k] = (this.ifade[k] || 0) + ifade[k]; oldu = true; }
      if (oldu) this.ifadeN++;
    }
  }
  // p: { t, yaw, pitch, roll, dist } (bakış modülünün son karesi); aynı kare (aynı t) iki kez sayılmaz
  poz(p) {
    if (!p || p.t == null || p.t === this.p3t) return;
    this.p3t = p.t;
    for (const k of ["yaw", "pitch", "roll", "dist"]) if (Number.isFinite(p[k])) this.p3[k].push(p[k]);
  }
  al(tSon) {
    if (!this.n) return null;
    const y = (v, d) => (v == null ? null : +v.toFixed(d));
    const ort = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const mn = (a) => (a.length ? Math.min(...a) : null), mx = (a) => (a.length ? Math.max(...a) : null);
    const p3n = Math.max(...Object.values(this.p3).map((a) => a.length));
    return {
      n: this.n, yuzN: this.yuzN, ms: Math.round(((tSon ?? this.t1) - this.t0) * 1000),
      yaw: { ort: y(ort(this.yaw), 4), min: y(mn(this.yaw), 4), max: y(mx(this.yaw), 4) },
      pitch: { ort: y(ort(this.pitch), 4), min: y(mn(this.pitch), 4), max: y(mx(this.pitch), 4) },
      ear: { ort: y(ort(this.ear), 4), min: y(mn(this.ear), 4) },
      mar: { ort: y(ort(this.mar), 4), max: y(mx(this.mar), 4) },
      kirpma: this.yuzN ? this.kapali : null,
      ifade: this.ifadeN ? Object.fromEntries(Object.entries(this.ifade).map(([k, v]) => [k, +(v / this.ifadeN).toFixed(3)])) : null,
      pose3: p3n ? { yaw: y(ort(this.p3.yaw), 2), pitch: y(ort(this.p3.pitch), 2), roll: y(ort(this.p3.roll), 2), dist: y(ort(this.p3.dist), 1), n: p3n } : null,
      islemeFps: null, isciGecikmeMs: null,
    };
  }
}

class FocusAnalyzer {
  constructor(video, { interval = 300, onUpdate, getEyes = () => null, getProfile = () => null, getPose3 = () => null } = {}) {
    this.video = video; this.interval = interval; this.onUpdate = onUpdate || (() => {}); this.getEyes = getEyes; this.getProfile = getProfile;
    this.getPose3 = getPose3; this._ham = new HamToplayici();   // ham ölçü penceresi (yalnız kayıt; hesaplara girmez)
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

  // Her start()/stop() yeni bir "nesil" açar. Duraklat/Devam hızlı basılınca, o sırada süren eski step()
  // bitince kendi döngüsünü yeniden kurmasın diye döngü yalnızca kendi nesli güncelse devam eder.
  start() { if (!this.running) { this.running = true; this.gen = (this.gen || 0) + 1; this._ham = new HamToplayici(); this.loop(this.gen); } }
  /** Son gönderimden bu yana ham ölçü özeti ve pencereyi sıfırla. Analizör çalışmıyorsa ya da kare yoksa null. */
  hamAl() {
    const h = this._ham; this._ham = new HamToplayici();
    if (!this.running || !h) return null;
    const o = h.al(performance.now() / 1000);
    if (o && this.base) o.taban = { yaw: +this.base.yaw.toFixed(4), pitch: +this.base.pitch.toFixed(4), ear: +this.base.ear.toFixed(4) };
    return o;
  }
  stop() { this.running = false; this.gen = (this.gen || 0) + 1; clearTimeout(this.timer); }
  recalibrate() { this.base = null; this.calib = { yaw: [], pitch: [], ear: [] }; this.poseHist = []; this.screenEnv = null; this.state.calibrating = true; }

  /**
   * Ekran alanı kalibrasyonu: tam ekranda ortaya ve kenarlara/köşelere sırayla nokta gösterilir; kullanıcı
   * NORMAL bakar (başını çevirebilir). Ortadaki duruş taban, uç noktalar "ekran alanı" olur. Böylece ekran
   * ne kadar büyükse alan o kadar geniş olur. Tarayıcı ekranın inç ölçüsünü bilemez; bu yüzden ölçerek bulunur.
   * Konsola [KAL-BAŞ ...] satırları yazar (window.kalLog).
   */
  async calibrateScreen() {
    const log = (msg, obj = {}) => { const row = { t: new Date().toLocaleTimeString("tr-TR"), msg, ...obj }; (window.kalLog ||= []).push(row); console.log(`[KAL-BAŞ ${row.t}] ${msg}`, obj); };
    if (this.screenCal) return;
    this.screenCal = true;
    const ov = document.createElement("div");
    ov.className = "gaze-ov"; ov.innerHTML = '<canvas></canvas><div class="gaze-msg"></div>';
    document.body.append(ov);
    document.documentElement.style.overflow = "hidden";
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (e) { log("tam ekran açılamadı (telefonda/iPhone'da desteklenmeyebilir); pencere boyutunda devam", { hata: String(e) }); }
    await new Promise((r) => setTimeout(r, 400));
    const cv = ov.querySelector("canvas"), msg = ov.querySelector(".gaze-msg"), dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const ctx = cv.getContext("2d");
    const info = { ekran: `${screen.width}x${screen.height} CSS px`, dpr, pencere: `${innerWidth}x${innerHeight}`, tamEkran: !!document.fullscreenElement };
    log("başladı", info);
    let cancelled = false;
    const keys = (e) => { if (e.code === "Escape") cancelled = true; };
    addEventListener("keydown", keys);
    msg.innerHTML = `<h2>🖥️ Ekran alanı kalibrasyonu</h2><p>Noktalara <b>derste nasıl bakıyorsanız öyle</b> bakın (başınızı çevirebilirsiniz).<br>9 nokta, yaklaşık 15 saniye. Vazgeçmek için Esc.</p>`;
    await new Promise((r) => setTimeout(r, 2500));
    msg.innerHTML = "";
    const oldInt = this.interval; this.interval = 80;                     // kalibrasyonda daha sık örnek
    const m = 0.04, pts = [[0.5, 0.5], [m, m], [0.5, m], [1 - m, m], [1 - m, 0.5], [1 - m, 1 - m], [0.5, 1 - m], [m, 1 - m], [m, 0.5]];
    const res = [];
    for (let i = 0; i < pts.length && !cancelled; i++) {
      const [px, py] = pts[i], x = px * innerWidth, y = py * innerHeight, t0 = performance.now() / 1000, got = [];
      while (!cancelled) {
        const el = performance.now() / 1000 - t0;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = "#ff3b3b"; ctx.beginPath(); ctx.arc(x * dpr, y * dpr, Math.max(6, 26 - 20 * el / 0.7) * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = "#8a94a3"; ctx.font = `${13 * dpr}px system-ui`; ctx.fillText(`${i + 1} / ${pts.length}`, 16 * dpr, (innerHeight - 16) * dpr);
        const lp = this.lastPose;
        if (el >= 0.7 && lp && lp.t > t0 + 0.7 && (!got.length || got[got.length - 1].t !== lp.t)) got.push(lp);
        if (el >= 1.8) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      const med = (a) => { const q = [...a].sort((u, v) => u - v), k = q.length >> 1; return q.length ? (q.length % 2 ? q[k] : (q[k - 1] + q[k]) / 2) : null; };
      const r = { i: i + 1, x: Math.round(px * 100), y: Math.round(py * 100), n: got.length, yaw: med(got.map((g) => g.yaw)), pitch: med(got.map((g) => g.pitch)), ear: med(got.map((g) => g.ear)) };
      res.push(r);
      log(`nokta ${r.i}/9 (x %${r.x}, y %${r.y}) → örnek ${r.n}${r.n ? ` | yaw ${r.yaw.toFixed(3)} pitch ${r.pitch.toFixed(3)}` : ""}${r.n < 2 ? "  ✗ YETERSİZ (yüz bulunamadı?)" : ""}`, r);
    }
    this.interval = oldInt;
    removeEventListener("keydown", keys);
    const finish = (text) => { ov.remove(); document.documentElement.style.overflow = ""; this.screenCal = false; if (text) toast(text, 5000); };
    if (cancelled) { log("vazgeçildi; eski ayarlar korunuyor"); return finish("Ekran kalibrasyonu iptal edildi."); }
    const bad = res.filter((r) => r.n < 2);
    if (bad.length > 2 || res[0].n < 2) { log(`BAŞARISIZ: ${bad.length} noktada yüz yeterince algılanamadı`, { noktalar: bad.map((r) => r.i) }); return finish("Ekran kalibrasyonu başarısız: yüz algılanamadı. Işığı ve kamerayı kontrol edip tekrar deneyin."); }
    const ok = res.filter((r) => r.n >= 2), c = res[0], pad = 0.03;
    const dy = ok.map((r) => r.yaw - c.yaw), dp = ok.map((r) => r.pitch - c.pitch);
    this.base = { yaw: c.yaw, pitch: c.pitch, ear: this.base?.ear ?? c.ear };
    this.state.calibrating = false; this.calib = { yaw: [], pitch: [], ear: [] };
    this.screenEnv = { yaw: [Math.min(...dy) - pad, Math.max(...dy) + pad], pitch: [Math.min(...dp) - pad, Math.max(...dp) + pad] };
    this.poseHist = [];
    const f = (v) => v.toFixed(2);
    log(`TAMAM: ekran alanı yaw ${f(this.screenEnv.yaw[0])}…${f(this.screenEnv.yaw[1])}, pitch ${f(this.screenEnv.pitch[0])}…${f(this.screenEnv.pitch[1])} (ortadaki duruşa göre)`, { ...info, alan: this.screenEnv });
    finish("Ekran alanı kaydedildi: kenarlara bakmanız artık 'ekran dışı' sayılmaz.");
  }

  /** Öğrenilmiş ekran alanı: [alt, üst] (taban ± MIN ile taban ± MAX arasında, yüzde 10-90 dağılıma göre). */
  _envelope(now, b, yaw, pitch, eyeShut) {
    const h = (this.poseHist ||= []);
    if (this.base && !eyeShut && now - (h.length ? h[h.length - 1][0] : -1e9) >= POSE_CFG.EVERY) h.push([now, yaw, pitch]);
    while (h.length && now - h[0][0] > POSE_CFG.WIN) h.shift();
    const q = (arr, p) => { const s = [...arr].sort((m, n) => m - n); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const se = this.screenEnv;   // köşe kalibrasyonuyla ölçülen ekran alanı (varsa), tabana göre fark
    const side = (c, i, mn, mx) => {
      const m = se ? (i === 1 ? se.yaw : se.pitch) : null;
      const lo0 = m ? Math.min(c - mn, c + m[0]) : c - mn, hi0 = m ? Math.max(c + mn, c + m[1]) : c + mn;
      const loCap = Math.min(c - mx, lo0), hiCap = Math.max(c + mx, hi0);
      if (h.length < POSE_CFG.MIN_N) return [lo0, hi0];
      const v = h.map((r) => r[i]);
      return [Math.max(loCap, Math.min(lo0, q(v, POSE_CFG.P_LO))), Math.min(hiCap, Math.max(hi0, q(v, POSE_CFG.P_HI)))];
    };
    return { yaw: side(b.yaw, 1, POSE_CFG.YAW_MIN, POSE_CFG.YAW_MAX), pitch: side(b.pitch, 2, POSE_CFG.PITCH_MIN, POSE_CFG.PITCH_MAX), n: h.length };
  }

  async loop(gen = this.gen) {
    if (!this.running || gen !== this.gen) return;
    if (this.inflight) await this.inflight.catch(() => {});      // önceki nesilden süren adım bitsin (üst üste binmesin)
    if (!this.running || gen !== this.gen) return;
    const t0 = performance.now();
    this.inflight = this.step();
    try { await this.inflight; } catch (e) { console.warn("analiz hatası", e); } finally { this.inflight = null; }
    if (!this.running || gen !== this.gen) return;   // bu sırada durduruldu ya da yeni döngü başladı
    const spent = performance.now() - t0;
    this.timer = setTimeout(() => this.loop(gen), Math.max(60, this.interval - spent));
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
    const ham = this._ham;   // bu adımın penceresi (gönderim sırasında değişse bile aynı nesneye yazılır)
    try { ham.kare(now); ham.poz(this.getPose3()); } catch {}
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
      this.lastPose = { t: now, yaw, pitch, ear: EAR };

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
      // Kamera ekranın üstündeyse ekrana bakan göz aşağı iner ve 68 noktalı modelde 'kapalı' görünüyordu.
      // MediaPipe göz kırpma katsayısı varsa o kullanılır; aşağı bakarken eşik yükseltilir.
      const earShut = EAR < b.ear * 0.62;
      const ey = this.getEyes(), mpOk = ey && ey.eyes && now - ey.t < 1;
      let blinkTh = mpOk ? EYE_CFG.BLINK + EYE_CFG.DOWN_EXTRA * Math.min(1, ey.eyes.down / 0.5) : null;
      // Bakış testinde ölçülen kişisel profil varsa: ekranın her yerine açık gözle bakarken görülen en yüksek
      // kırpma katsayısının 0.15 üstü alt sınır olur (kamera üstteyken ekranın altına bakmak "kapalı" sayılmasın)
      const prof = this.getProfile?.();
      if (mpOk && prof && prof.kirpmaMax != null) blinkTh = Math.min(0.9, Math.max(blinkTh, prof.kirpmaMax + 0.15));
      // Yüz profili (bakış testi): kişinin nötr açık gözdeki ve gerçekten kapalı gözdeki kırpma katsayısı ölçüldüyse
      // eşik bu iki ölçümün arasına sıkıştırılır (yapısal olarak kısık gözlü kişi "kapalı" sayılmaz, kapalı göz kaçmaz).
      const yz = prof?.yuz;
      if (mpOk && yz?.kapali && yz?.notr) {
        const lo = Math.max(yz.notr.kirpma, prof.kirpmaMax ?? 0) + 0.1, hi = yz.kapali.kirpma - 0.05;
        if (hi > lo) blinkTh = Math.max(lo, Math.min(blinkTh, hi));
      }
      const eyeShut = mpOk ? ey.eyes.blink > blinkTh : earShut;
      if (now - (this.eyeLogT || 0) >= 1) {
        this.eyeLogT = now;
        const row = { t: new Date().toLocaleTimeString("tr-TR"), kaynak: mpOk ? "mediapipe" : "face-api", kirpma: mpOk ? +ey.eyes.blink.toFixed(2) : null, asagi: mpOk ? +ey.eyes.down.toFixed(2) : null,
          esik: blinkTh && +blinkTh.toFixed(2), earOran: +(EAR / b.ear).toFixed(2), eskiKarar: earShut, yeniKarar: eyeShut };
        (window.gozLog ||= []).push(row); if (gozLog.length > 3000) gozLog.shift();
        console.log(`[GÖZ ${row.t}] ${eyeShut ? "KAPALI" : "açık"} (${row.kaynak}) | kırpma ${row.kirpma ?? "-"} aşağı ${row.asagi ?? "-"} eşik ${row.esik ?? "-"} | eski: EAR/taban ${row.earOran} → ${earShut ? "kapalı" : "açık"}`, row);
      }
      if (eyeShut) { this.closedSince ??= now; } else this.closedSince = null;
      closed = this.closedSince != null && now - this.closedSince > 0.6;
      this.eyeHist.push([now, eyeShut ? 1 : 0]);

      // Esneme
      if (MAR > 0.6) { this.mouthOpenSince ??= now; if (now - this.mouthOpenSince > 1.5 && !this.yawnMarked) { this.yawns.push(now); this.yawnMarked = true; } }
      else { this.mouthOpenSince = null; this.yawnMarked = false; }

      // Baş yönü: öğrenilmiş ekran alanının DIŞINA taşma miktarı (alan en dar hâlinde eski formülle aynı sonuç)
      const env = this._envelope(now, b, yaw, pitch, eyeShut);
      const out = (v, [lo, hi]) => Math.max(0, v - hi, lo - v);
      const dy = out(yaw, env.yaw), dp = out(pitch, env.pitch);
      away = dy > POSE_CFG.AWAY_YAW || dp > POSE_CFG.AWAY_PITCH;
      raw = 100 - dy * 380 - dp * 380;
      if (now - (this.poseLogT || 0) >= 5) {
        this.poseLogT = now;
        const f = (x) => x.toFixed(2);
        const row = { t: new Date().toLocaleTimeString("tr-TR"), yaw: +f(yaw - b.yaw), pitch: +f(pitch - b.pitch), alanYaw: env.yaw.map((v) => +f(v - b.yaw)),
          alanPitch: env.pitch.map((v) => +f(v - b.pitch)), ornek: env.n, disari: away };
        (window.basLog ||= []).push(row); if (basLog.length > 2000) basLog.shift();
        console.log(`[BAŞ ${row.t}] ${away ? "EKRAN DIŞI" : "ekranda"} | yaw ${row.yaw} (alan ${row.alanYaw.join("…")}) pitch ${row.pitch} (alan ${row.alanPitch.join("…")}) | öğrenme örneği ${env.n}${env.n < POSE_CFG.MIN_N ? " (henüz dar alan)" : ""}`, row);
      }
      if (closed) raw *= 0.25;
      raw = Math.max(0, Math.min(100, raw));

      // Duygu (ifade olasılıklarını kategorilere indirger, yumuşatır).
      // Yüz profilinde nötr duygu tabanı varsa önce o düşülür (yapısal yüz ifadesi duygu sayılmaz).
      const eHam = { ...det.expressions }, tb = prof?.yuz?.notr?.duygu?.faceapi || null;
      const e = notrTabanDuzelt(eHam, tb, "neutral");
      try { ham.yuz({ yaw, pitch, ear: EAR, mar: MAR, kapali: eyeShut, ifade: eHam }); } catch {}
      if (now - (this.emoLogT || 0) >= 5) {
        this.emoLogT = now;
        const ilk = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} %${Math.round(100 * v)}`).join(", ");
        const row = { t: new Date().toLocaleTimeString("tr-TR"), tabanli: !!tb, ham: eHam, duzeltilmis: e };
        (window.duyguLog ||= []).push(row); if (duyguLog.length > 2000) duyguLog.shift();
        console.log(`[DUYGU ${row.t}] face-api ham: ${ilk(eHam)}${tb ? ` → nötr tabana göre: ${ilk(e)}` : " (nötr taban yok: bakış testinde yüz profili alınmamış)"}`, row);
      }
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

// El kaldırma algılayıcısı: MediaPipe GestureRecognizer (yerel model, /models/).
// Görüntü cihazdan çıkmaz. Kural (elle seçilmiş başlangıç değerleri, doğrulanmadı):
//   açık avuç ya da yukarı işaret + parmaklar yukarı (orta parmak ucu, parmak kökünün üstünde)
//   + orta parmak ucu göz hizasının üstünde. Bilek görünmek zorunda değil; el yüzün önünde de olabilir.
//   Kafa kaşıma / saç düzeltmeyi ayırmak için: en az 3 parmak DÜZ ve YUKARI bakmalı (kaşırken parmaklar
//   bükük ya da aşağı/yana bakar) ve el son 1 sn içinde kıpırdamadan durmalı (kaşıma ileri geri hareket).
//   Avuç içi kameraya dönük olmalı: el yüze konunca/kaşırken kameraya elin sırtı görünür.
//   Bu durum HOLD sn kesintisiz sürerse "kaldırıldı" sayılır (kısa el hareketleri tetiklemez).
//   El inene kadar ikinci kez tetiklenmez.

const HAND_MODEL = "/models/gesture_recognizer.task";
const HAND_CFG = {
  HZ: 5, HOLD: 3, GAP: 0.6, MIN_SCORE: 0.55, GESTURES: ["Open_Palm", "Pointing_Up"],
  MIN_FINGERS: 3,   // model tanımasa da bu kadar parmak açıksa açık avuç sayılır
  OCCLUDE: 0.15,    // el kutusu yüz kutusunun en az bu kadarını örterse 'yüz örtülü' sayılır
  OCCLUDE_HOLD: 0.6,// sn: örtülme bittikten sonra da bu kadar süre yüz verisi güvenilmez sayılır
  FACE_MEMORY: 8,   // sn: el yüzü kapatınca son bilinen yüz konumu bu kadar kullanılır
  STRAIGHT: 0.85,   // parmak düzlüğü: kök→uç düz mesafe / eklem eklem yol (1 = dümdüz, bükük parmak ~0.5-0.7)
  FINGER_ANGLE: 45, // derece: parmak yönü dikeyden en fazla bu kadar sapabilir
  HAND_ANGLE: 35,   // derece: orta parmak (kök→uç) dikeyden en fazla bu kadar sapabilir
  STILL_WIN: 1.0,   // sn: kıpırtı bu pencerede ölçülür
  STILL: 0.25,      // kıpırtı (avuç genişliği cinsinden) bunu aşarsa "el hareketli" (kaşıma) sayılır
  PALM: true,       // avuç içi kameraya dönük olmalı (elin sırtı görünüyorsa kabul edilmez)
  // Sağ/sol etiketi ters mi? Gerçek kamerayla ölçüldü (18.11): avuç kameraya dönük kaldırılan elde etiket
  // ters kabul edilince "arkada" çıktı (iki elde de, ~25 karede tutarlı). Bu yüzden etiket olduğu gibi kullanılır.
  HAND_LABEL_SWAPPED: false,
};

class HandRaiseDetector {
  /**
   * @param video      öğrencinin kamera <video> öğesi
   * @param getFace    () => {t, eyeY, top} | null   (gaze.js yüz konumu, normalize)
   * @param onRaise    () => void   el HOLD sn kaldırılı kalınca bir kez çağrılır
   */
  constructor(video, { getFace = () => null, onRaise = () => {} } = {}) {
    Object.assign(this, { video, getFace, onRaise });
    this.ready = false; this.enabled = false; this.loading = null;
    this.upSince = null; this.lastUp = 0; this.latched = false;
    this.info = { hand: false, gesture: null, score: 0, up: false, hold: 0 };
  }

  // Modeli tarayıcının kalıcı deposundan (Cache Storage) al; yoksa bir kez indirip kaydet.
  // HTTP önbelleğine güvenilmiyor: bazı tarayıcı ayarları onu atlıyor.
  static async modelBytes() {
    let cache = null;
    try { cache = await caches.open("dn-models-v1"); } catch {}
    let res = cache && (await cache.match(HAND_MODEL));
    HandRaiseDetector.fromCache = !!res;
    if (!res) {
      res = await fetch(HAND_MODEL);
      if (!res.ok) throw new Error("El modeli indirilemedi: " + res.status);
      if (cache) { try { await cache.put(HAND_MODEL, res.clone()); } catch {} }
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const v = await import(`${MP_BASE}/vision_bundle.mjs`);
      const files = await v.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const bytes = await HandRaiseDetector.modelBytes();
      const mk = (delegate) => v.GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: bytes, delegate }, runningMode: "VIDEO", numHands: 2,
      });
      try { this.rec = await mk("GPU"); } catch { this.rec = await mk("CPU"); }
      this.ready = true;
    })();
    return this.loading;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (!on) { clearTimeout(this.timer); this.reset(); return; }
    await this.load();
    if (this.enabled) this.loop();
  }

  reset() { this.upSince = null; this.latched = false; this.info = { hand: false, gesture: null, score: 0, up: false, hold: 0 }; }

  loop() {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    try { this.step(); } catch (e) { console.warn("el algılama hatası", e); }
    this.timer = setTimeout(() => this.loop(), 1000 / HAND_CFG.HZ);
  }

  /** Tek bir el için karar ayrıntısı. lm: 21 normalize nokta (y aşağı doğru artar). eyeY: göz hizası ya da null.
   *  asp: görüntü en/boy oranı (x ve y'yi aynı ölçeğe getirmek için). */
  static check(lm, gesture, score, eyeY, asp = 4 / 3, label = null) {
    const P = (i) => ({ x: lm[i].x * asp, y: lm[i].y });
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const angUp = (a, b) => Math.abs(Math.atan2(b.x - a.x, a.y - b.y)) * 180 / Math.PI;   // a→b yönünün dikeyden sapması
    const tipY = Math.min(lm[8].y, lm[12].y);                   // işaret / orta parmak ucu (en yukarıdaki)
    const mcpY = lm[9].y, refY = eyeY ?? 0.4;
    // Her parmak (kök, orta eklemler, uç): düz mü ve yukarı mı bakıyor
    const chains = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const per = chains.map(([m, p, q, t]) => {
      const path = d(P(m), P(p)) + d(P(p), P(q)) + d(P(q), P(t));
      const straight = path > 0 ? d(P(m), P(t)) / path : 0, ang = angUp(P(m), P(t));
      return { straight, ang, ok: straight >= HAND_CFG.STRAIGHT && ang <= HAND_CFG.FINGER_ANGLE };
    });
    const fingers = per.filter((f) => f.ok).length;             // düz ve yukarı bakan parmak sayısı
    const handAng = angUp(P(9), P(12));
    // Avuç yönü: avuç ekseni (bilek→orta parmak kökü) ile serçe→işaret parmak kökü çizgisinin çapraz çarpımı.
    // Gerçek sağ elde avuç kameraya dönükse işaret parmağı görüntünün sağında kalır (çarpım > 0); solda tersi.
    const u = { x: P(9).x - P(0).x, y: P(9).y - P(0).y }, w = { x: P(5).x - P(17).x, y: P(5).y - P(17).y };
    const cross = (u.x * w.y - u.y * w.x) / ((Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)) || 1);
    const realRight = label == null ? null : (label === "Right") !== HAND_CFG.HAND_LABEL_SWAPPED;
    const palmFacing = realRight == null ? null : (realRight ? cross : -cross) > 0.15;   // 0.15: yan duran eli dışarıda bırakır
    const palmOk = !HAND_CFG.PALM || palmFacing !== false;
    // Model kalkık eli sık sık "None" ya da düşük güvenli "Open_Palm" diye veriyor (kayıtta %51-56),
    // bu yüzden model başka bir hareket (yumruk vb.) demiyorsa parmak şekline bakılır.
    // Her iki durumda da en az MIN_FINGERS parmak düz ve yukarı olmalı (kaşırken parmaklar bükük).
    const byModel = HAND_CFG.GESTURES.includes(gesture) && score >= HAND_CFG.MIN_SCORE;
    const modelAllows = gesture == null || gesture === "None" || HAND_CFG.GESTURES.includes(gesture);
    const gestureOk = modelAllows && fingers >= HAND_CFG.MIN_FINGERS;
    const upright = tipY < mcpY && handAng <= HAND_CFG.HAND_ANGLE;   // el dik, parmaklar yukarı
    const high = tipY < refY;                                   // parmak ucu göz hizasının üstünde (bilek şart değil)
    const why = !palmOk ? `avuç içi kameraya dönük değil (elin sırtı ya da yanı görünüyor; yüze konan el olabilir)`
      : !modelAllows ? `model başka hareket diyor: ${gesture} %${Math.round(100 * score)}`
      : !gestureOk ? `düz+yukarı parmak ${fingers}/4 (gerekli ≥${HAND_CFG.MIN_FINGERS}; bükük ya da yana bakan parmak: kaşıma olabilir)`
      : !upright ? `el dik değil (orta parmak dikeyden ${Math.round(handAng)}°, sınır ${HAND_CFG.HAND_ANGLE}°)`
      : !high ? `parmak ucu göz hizasının altında (${tipY.toFixed(2)} > ${refY.toFixed(2)})` : `uygun (${byModel ? "model" : "parmak şekli"})`;
    return { ok: palmOk && gestureOk && upright && high, gesture, el: label, avuc: palmFacing == null ? "?" : palmFacing ? "önde" : "arkada", capraz: +cross.toFixed(2), score: +score.toFixed(2), fingers, gestureOk, upright, high,
             duzluk: per.map((f) => +f.straight.toFixed(2)), aci: Math.round(handAng),
             center: P(9), tipRel: { x: P(12).x - P(9).x, y: P(12).y - P(9).y }, palm: d(P(5), P(17)) || 0.05,
             tipY: +tipY.toFixed(3), mcpY: +mcpY.toFixed(3), wristY: +lm[0].y.toFixed(3), eyeY: eyeY == null ? null : +eyeY.toFixed(3), why };
  }

  /** Son STILL_WIN sn içindeki kıpırtı: avuç merkezi ve parmak ucunun (avuca göre) oynaması, avuç genişliği cinsinden. */
  motion(c, t) {
    const tr = (this.track ||= []);
    tr.push({ t, cx: c.center.x, cy: c.center.y, tx: c.tipRel.x, ty: c.tipRel.y, palm: c.palm });
    while (tr.length && t - tr[0].t > HAND_CFG.STILL_WIN) tr.shift();
    if (tr.length < 3) return 0;
    const sd = (k) => { const m = tr.reduce((a, r) => a + r[k], 0) / tr.length; return Math.sqrt(tr.reduce((a, r) => a + (r[k] - m) ** 2, 0) / tr.length); };
    const palm = tr.reduce((a, r) => a + r.palm, 0) / tr.length;
    return (Math.hypot(sd("cx"), sd("cy")) + Math.hypot(sd("tx"), sd("ty"))) / palm;
  }

  /** El kutusunun yüz kutusuyla çakışan kısmı / yüz kutusu alanı (0-1). Koordinatlar normalize. */
  static overlap(lm, face) {
    if (face.left == null) return 0;
    const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
    const ix = Math.min(Math.max(...xs), face.right) - Math.max(Math.min(...xs), face.left);
    const iy = Math.min(Math.max(...ys), face.chin) - Math.max(Math.min(...ys), face.top);
    const area = (face.right - face.left) * (face.chin - face.top);
    return ix > 0 && iy > 0 && area > 0 ? (ix * iy) / area : 0;
  }
  /** Son OCCLUDE_HOLD sn içinde el yüzü örttü mü (ifade/göz ölçümü bu sürede güvenilmez). */
  occluding() { return this.enabled && performance.now() / 1000 - (this.occludedAt ?? -Infinity) < HAND_CFG.OCCLUDE_HOLD; }

  static isRaised(lm, gesture, score, eyeY, asp) { return HandRaiseDetector.check(lm, gesture, score, eyeY, asp).ok; }

  // Konsol kaydı: olaylar anında, el görünürken saniyede bir satır. window.elLog içinde tutulur.
  _log(t, ev, extra) {
    const row = { t: new Date().toLocaleTimeString("tr-TR"), olay: ev, ...extra };
    (window.elLog ||= []).push(row); if (elLog.length > 3000) elLog.shift();
    const h = extra.el;
    const ayr = h ? ` hareket=${h.gesture}%${Math.round(100 * h.score)} avuç=${h.avuc}(${h.el ?? "?"} ${h.capraz}) düzParmak=${h.fingers}/4 düzlük=${(h.duzluk || []).join("/")} açı=${h.aci}° kıpırtı=${h.kipirti ?? "-"} dik=${h.upright ? "evet" : "hayır"} yüksek=${h.high ? "evet" : "hayır"} parmakUcu=${h.tipY} göz=${h.eyeY ?? "yok(0.4)"} → ${h.why}` : "";
    console.log(`[EL ${row.t}] ${ev}${extra.hold ? ` ${extra.hold.toFixed(1)}/${HAND_CFG.HOLD} sn` : ""}${ayr}${extra.yuzOrtulu ? " [el yüzü örtüyor]" : ""}${extra.yuzHafiza ? " (göz hizası hafızadan)" : ""}`, row);
  }

  step() {
    if (document.hidden || this.video.readyState < 2) return;
    const t = performance.now() / 1000;
    const r = this.rec.recognizeForVideo(this.video, performance.now());
    const f = this.getFace();
    const faceFresh = f && t - f.t < 1;
    // El yüzün önündeyse yüz modeli gözü yanlış yere koyuyor (kayıtta göz hizası 0.36 -> 0.51 zıpladı).
    // Bu yüzden yalnızca el yüzle çakışmıyorken yüz konumu güncellenir; çakışmada son temiz konum kullanılır.
    const box = faceFresh ? f : this.lastFace;
    const occluded = !!box && (r.landmarks || []).some((lm) => HandRaiseDetector.overlap(lm, box) >= HAND_CFG.OCCLUDE);
    if (occluded) this.occludedAt = t;
    if (faceFresh && !occluded) this.lastFace = f;
    const face = this.lastFace && t - this.lastFace.t < HAND_CFG.FACE_MEMORY ? this.lastFace : null;
    const asp = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
    let up = false, best = null, bestScore = 0, el = null;
    (r.landmarks || []).forEach((lm, i) => {
      const g = r.gestures?.[i]?.[0];
      const name = g?.categoryName, score = g?.score || 0;
      if (score > bestScore) { best = name; bestScore = score; }
      const lab = (r.handedness || r.handednesses)?.[i]?.[0]?.categoryName ?? null;
      const c = HandRaiseDetector.check(lm, name, score, face ? face.eyeY : null, asp, lab);
      if (!el || (c.ok && !el.ok) || (!el.ok && c.score > el.score)) el = c;   // en anlamlı eli kaydet
    });
    // Kıpırtı: şekli uygun olan el kıpırdıyorsa (kaşıma, saç düzeltme) kalkık sayılmaz
    if (el && el.ok) {
      el.kipirti = +this.motion(el, t).toFixed(2);
      if (el.kipirti > HAND_CFG.STILL) { el.ok = false; el.why = `el hareketli (kıpırtı ${el.kipirti} > ${HAND_CFG.STILL}; kaşıma olabilir)`; }
    } else this.track = [];
    up = !!el?.ok;
    const hand = (r.landmarks || []).length > 0;
    const wasUp = this.upSince != null;

    if (up) { this.lastUp = t; if (this.upSince == null) this.upSince = t; }
    else if (t - this.lastUp > HAND_CFG.GAP) { this.upSince = null; this.latched = false; }   // el indi

    const hold = this.upSince != null ? t - this.upSince : 0;
    const extra = { el, hold, yuzHafiza: !!face && (!faceFresh || occluded), yuzOrtulu: occluded };
    if (hand !== !!this.prevHand) this._log(t, hand ? "el göründü" : "el kayboldu", extra);
    if (!wasUp && this.upSince != null) this._log(t, "kalkış başladı", extra);
    if (wasUp && this.upSince == null) this._log(t, "el indi / kural bozuldu (sayaç sıfır)", extra);
    if (hold >= HAND_CFG.HOLD && !this.latched) { this.latched = true; this._log(t, "✋ SÖZ İSTENDİ", extra); this.onRaise(); }
    else if (hand && t - (this.lastLogT || 0) >= 1) { this.lastLogT = t; this._log(t, up ? "kalkık" : "el var", extra); }
    this.prevHand = hand;
    this.info = { hand, gesture: best, score: bestScore, up, hold, faceOk: !!face, occluded };
  }
}

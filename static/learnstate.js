// DENEYSEL: DAiSEE'deki ders durumlarına (ilgi, sıkılma, kafa karışıklığı, hayal kırıklığı) yakın tahmin.
// Eğitilmiş bir model DEĞİLDİR: HSEmotion çıktıları ile sistemin kendi sinyalleri (dikkat, enerji/yorgunluk,
// ekran dışı bakış, göz kapalı) elle seçilmiş kurallarla birleştirilir. Doğrulanmamıştır.
// Eşikler başlangıç değerleridir; etiketli denemelerle (dsIsaret / dsOzet) ayarlanmalıdır.
//
// Literatüre göre yapılan seçimler (arastirma/literatur_3 §3, literatur_1):
//  - Korku, Üzüntü, Öfke, İğrenme, Küçümseme kurallarda YOK: gerçek dünya videosunda F1 ~0 (Korku 0.016,
//    Öfke 0.15; Savchenko 2022). Sahibinin nötr yüzünde %20-40 Üzüntü/Korku okunması bu hatanın görünür hali.
//  - Şaşkınlık -> "kafası karışık" eşlemesi YOK (Şaşkınlık F1 0.30; yüzden kafa karışıklığı AUC ~0.65).
//  - Yalnızca kişisel tabana göre valence/arousal farkı (MAD birimiyle) + Mutluluk/Nötr kullanılır.
//  - Kararlar tek kareye değil son 10 sn'nin ortalamasına bağlanır.

const LS_STATES = {
  ilgili:          { label: "İlgili / odaklı",  icon: "🎯", color: "var(--good)" },
  sikilmis:        { label: "Sıkılmış / yorgun", icon: "🥱", color: "var(--muted)" },
  kafa_karisik:    { label: "Kafası karışık",   icon: "🤔", color: "var(--warn)" },
  hayal_kirikligi: { label: "Hayal kırıklığı",  icon: "😣", color: "var(--bad)" },
};
const LS_CFG = {
  TAU: 1.2,            // sn: ilgili / sıkılmış skorlarının EMA zaman sabiti
  TAU_STRICT: 4,       // sn: kafa karışık / hayal kırıklığı daha yavaş (kanıt sürmeli)
  ON: 0.5, ON_STRICT: 0.6, OFF: 0.3, MARGIN: 0.1,
  WIN: 10,             // sn: karar girdileri bu pencerenin ortalaması
  WIN_MIN: 10,         // pencerede en az bu kadar gerçek örnek (~5 sn) yoksa skorlar güncellenmez
  GAP_MAX: 15,         // sn: bu kadar süre hiç ölçüm yoksa durum "belirsiz"e düşer (taban korunur)
  // Kişisel dinlenme seviyesi: model aynı nötr yüzü kişiye/kameraya/ışığa göre farklı okuyor
  // (kayıtta "Nötr" anlarda bile valence -0.2 idi). Kurallar bu seviyeye göre FARK (MAD birimi) üzerinden çalışır.
  BASE_MIN: 60,        // dinlenme örneği (500 ms'de bir -> ~30 sn) toplanmadan taban hazır sayılmaz
                       // (taban tarayıcıda saklanır; sonraki açılışta beklemeden kullanılır, ölçtükçe güncellenir)
  BASE_MAX: 360,       // en son bu kadar dinlenme örneği (~180 sn) tutulur; sayıya bağlı, zamana değil
                       // (uzun bir durum sürerken taban boşalmasın, donmuş kalsın)
  MAD_FLOOR: 0.05,     // ölçekli MAD alt sınırı (V/A birimi); çok dar yayılımda z değerleri patlamasın
  REST_HAPPY_MAX: 0.6, // belirgin gülümseme dinlenme sayılmaz
  REST_Z: 2.5,         // taban hazırken |örnek z| bundan büyükse dinlenme sayılmaz
};

class LearningStateEstimator {
  constructor() {
    this.state = "belirsiz"; this.scores = {}; this.slow = {}; this.lastT = null; this.lastDataT = null;
    for (const k in LS_STATES) { this.scores[k] = 0; this.slow[k] = 0; }
    this.hist = [];   // dinlenme örnekleri (taban)
    this.win = [];    // son WIN sn'nin gerçek örnekleri (karar girdisi)
    this.base = { valence: 0, arousal: 0, madV: null, madA: null, n: 0 }; this.baseReady = false;
    this.z = { v: null, a: null }; this.reason = "kalibre ediliyor"; this.stale = false;
    this.anahtar = null;   // sahipAyarla çağrılana dek taban saklanmaz/yüklenmez (kişi bilinmiyor)
  }
  // Taban kişiye özgü: ders + öğrenci anahtarıyla saklanır (lab'da aynı tarayıcıyı farklı kişiler kullanır). Eski ortak anahtar silinir.
  sahipAyarla(s) {
    this.anahtar = s && s.ders && s.sid ? `dn_ls_base_${s.ders}_${s.sid}` : null;
    try { localStorage.removeItem("dn_ls_base"); } catch {}
    if (this.anahtar) this._restore();
  }

  // Taban bu tarayıcıda kişi anahtarıyla saklanır (sahipAyarla). "Kalibre et" ile sıfırlanır.
  _restore() {
    try {
      if (!this.anahtar) return;
      const d = JSON.parse(localStorage.getItem(this.anahtar) || "null");
      if (d && Array.isArray(d.hist) && d.hist.length >= LS_CFG.BASE_MIN) {
        this.hist = d.hist.slice(-LS_CFG.BASE_MAX).map((h) => ({ t: -1, v: h[0], a: h[1] }));
        this._recompute(); this.restored = d.at;
      }
    } catch {}
  }
  _save() {
    if (!this.anahtar || this.hist.length < LS_CFG.BASE_MIN || Date.now() - (this.savedAt || 0) < 10000) return;
    this.savedAt = Date.now();
    try { localStorage.setItem(this.anahtar, JSON.stringify({ at: this.savedAt, hist: this.hist.map((h) => [+h.v.toFixed(3), +h.a.toFixed(3)]) })); } catch {}
  }
  resetBase() {
    this.hist = []; this.base = { valence: 0, arousal: 0, madV: null, madA: null, n: 0 }; this.baseReady = false; this.restored = null;
    try { if (this.anahtar) localStorage.removeItem(this.anahtar); } catch {}
  }
  _recompute() {
    const med = LearningStateEstimator._med, vs = this.hist.map((h) => h.v), as = this.hist.map((h) => h.a);
    const mv = med(vs), ma = med(as);
    this.base.valence = mv; this.base.arousal = ma; this.base.n = this.hist.length;
    this.base.madV = Math.max(LS_CFG.MAD_FLOOR, 1.4826 * med(vs.map((v) => Math.abs(v - mv))));
    this.base.madA = Math.max(LS_CFG.MAD_FLOOR, 1.4826 * med(as.map((a) => Math.abs(a - ma))));
    this.baseReady = true;
  }

  static _med(arr) { const s = [...arr].sort((m, n) => m - n), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

  // Bu örnek "dinlenme" (nötr, ekrana bakıyor, başka durum yok) sayılır mı?
  _isResting(x) {
    if (!(x.attention >= 50) || x.lookingAway || x.eyesClosed) return false;
    // Taban yalnızca belirsiz/ilgili iken ve diğer durumların skorları düşükken beslenir; başka durum varken donar
    if (this.state !== "belirsiz" && this.state !== "ilgili") return false;
    if (this.slow.sikilmis >= LS_CFG.OFF || this.slow.kafa_karisik >= LS_CFG.OFF || this.slow.hayal_kirikligi >= LS_CFG.OFF) return false;
    // Duygu olasılıkları burada KULLANILMAZ: sahibinin nötr yüzü kayıtta %40-70 "Üzüntü" okunuyordu ve
    // "Nötr baskın olsun" şartı tabanın hiç dolmamasına yol açtı (2,5 dk'da 44/120). Yalnızca belirgin gülümseme hariç.
    const p = x.probs || {};
    if ((p.Happiness || 0) > LS_CFG.REST_HAPPY_MAX) return false;
    if (this.baseReady) {
      const zv = (x.valence - this.base.valence) / this.base.madV, za = (x.arousal - this.base.arousal) / this.base.madA;
      if (Math.abs(zv) > LS_CFG.REST_Z || Math.abs(za) > LS_CFG.REST_Z) return false;
    }
    return true;
  }

  // Ortanca + ölçekli MAD (1.4826*MAD, alt sınırlı). Yalnızca dinlenme örnekleriyle güncellenir.
  _updateBase(x, t) {
    if (!this._isResting(x)) return;
    this.hist.push({ t, v: x.valence, a: x.arousal });
    if (this.hist.length > LS_CFG.BASE_MAX) this.hist.shift();
    this.base.n = this.hist.length;
    if (this.hist.length < LS_CFG.BASE_MIN) return;
    this._recompute();
    this._save();
  }

  /**
   * @param x {valence, arousal, probs:{Anger,...}, attention 0-100, energy 0-100, lookingAway, eyesClosed}
   *          ya da null: o an gerçek ölçüm yok (el yüzü örtüyor / yüz yok). Durum korunur, taban güncellenmez.
   * @param t saniye (performance.now()/1000)
   */
  update(x, t) {
    if (!x) {
      // Ölçüm yok: skor/EMA/taban dokunulmaz. Çok uzun sürerse eski durumu gerçekmiş gibi göstermeyiz.
      this.stale = true;
      const gap = this.lastDataT == null ? Infinity : t - this.lastDataT;
      if (gap > LS_CFG.GAP_MAX) { this.state = "belirsiz"; this.reason = "veri yok (yüz görünmüyor / el yüzü örtüyor)"; }
      else this.reason = `ölçüm yok ${gap.toFixed(0)} sn (son durum korunuyor)`;
      return this.state;
    }
    this.stale = false; this.lastDataT = t;
    this._updateBase(x, t);
    const p = x.probs || {};
    this.win.push({ t, v: x.valence, a: x.arousal, nh: (p.Neutral || 0) + (p.Happiness || 0), att: x.attention / 100,
                    en: x.energy, away: x.lookingAway ? 1 : 0, closed: x.eyesClosed ? 1 : 0 });
    while (this.win.length && t - this.win[0].t > LS_CFG.WIN) this.win.shift();

    if (!this.baseReady) {
      // Taban yokken tahmin YAPILMAZ (sahte/tahmini veri gösterilmez)
      this.state = "belirsiz"; this.z = { v: null, a: null };
      this.reason = `kalibre ediliyor (${this.base.n}/${LS_CFG.BASE_MIN} dinlenme örneği)`;
      return this.state;
    }
    if (this.win.length < LS_CFG.WIN_MIN) { this.reason = `pencere doluyor (${this.win.length}/${LS_CFG.WIN_MIN})`; return this.state; }

    // 10 sn pencere ortalamaları
    const n = this.win.length, avg = (f) => this.win.reduce((s, w) => s + f(w), 0) / n;
    const mV = avg((w) => w.v), mA = avg((w) => w.a), nh = avg((w) => w.nh), att = avg((w) => w.att), en = avg((w) => w.en);
    const awayFrac = avg((w) => w.away), closedFrac = avg((w) => w.closed);
    const b = this.base, zV = (mV - b.valence) / b.madV, zA = (mA - b.arousal) / b.madA;   // tabana göre fark, MAD birimi
    this.z = { v: zV, a: zA };
    const c = (v) => Math.max(0, Math.min(1, v));
    const fatigue = c((60 - en) / 40);                                 // enerji 60'ın altına indikçe
    // İlgili: dikkat yüksek, tabana göre belirgin olumsuz/düşük uyarılmış değil, yüz çoğunlukla nötr/mutlu
    this.scores.ilgili = c((att - 0.4) / 0.4) * c((zV + 2) / 1) * c((zA + 2) / 1) * c((nh - 0.15) / 0.25);
    // Sıkılmış/yorgun: arousal tabanın belirgin altında ve valence olumlu değil; ya da yorgunluk,
    // ya da pencerenin çoğunda ekran dışı / göz kapalı
    this.scores.sikilmis = Math.max(c((-zA - 1) / 1.5) * c((1 - zV) / 1), fatigue,
                                    0.8 * c((awayFrac - 0.3) / 0.4), 0.9 * c((closedFrac - 0.2) / 0.4));
    // Kafası karışık (düşük güvenli): derse bakıyor, arousal belirgin yüksek, valence hafif olumsuz
    // (çok olumsuzsa hayal kırıklığına bırakılır). Şaşkınlık/korku olasılığı KULLANILMAZ.
    this.scores.kafa_karisik = c((att - 0.3) / 0.3) * c((zA - 1) / 1.5) * c((-zV - 0.5) / 1) * c((3 + zV) / 1);
    // Hayal kırıklığı: valence tabanın belirgin altında ve arousal düşük değil. Öfke/iğrenme vb. KULLANILMAZ.
    this.scores.hayal_kirikligi = c((-zV - 2) / 1.5) * c((zA + 1) / 1.5);
    // Diğer durumların kanıtı güçlüyse "ilgili" geri çekilir (öğretmen için onlar daha bilgilendirici)
    this.scores.ilgili *= 1 - 0.6 * Math.max(this.scores.sikilmis, this.scores.kafa_karisik, this.scores.hayal_kirikligi);

    const strict = (k) => k === "kafa_karisik" || k === "hayal_kirikligi";
    // İlk adımda da EMA atlanmaz (tek örnekle skor 1'e sıçramasın): nominal 0.5 sn
    const dt = this.lastT == null ? 0.5 : Math.min(2, Math.max(0, t - this.lastT)); this.lastT = t;
    for (const k in this.slow) {
      const a = 1 - Math.exp(-dt / (strict(k) ? LS_CFG.TAU_STRICT : LS_CFG.TAU));
      this.slow[k] += (this.scores[k] - this.slow[k]) * a;
    }
    if (this.state !== "belirsiz" && this.slow[this.state] < LS_CFG.OFF) this.state = "belirsiz";
    const cur = this.state === "belirsiz" ? 0 : this.slow[this.state];
    let best = null, bv = -Infinity;
    for (const k in this.slow) {
      if (k === this.state) continue;
      const need = Math.max(strict(k) ? LS_CFG.ON_STRICT : LS_CFG.ON, cur + LS_CFG.MARGIN);
      if (this.slow[k] > need && this.slow[k] > bv) { best = k; bv = this.slow[k]; }
    }
    if (best) this.state = best;
    this.reason = `10 sn ort.: ΔV ${zV.toFixed(1)} MAD, ΔA ${zA.toFixed(1)} MAD`;
    return this.state;
  }
}

// RealEye Light yöntemi (RealEye-io/webcam-eyetracker-light-open README'sindeki yayımlanmış tarif; koddan kopya YOK, kendi uygulamamız).
// Öznitelik (1.652 değer; README'nin 1.653'ü buna sabit terim eklenmiş hâli):
//   15 yüz noktası × (x,y) = 30  — yüz kutusuna (tüm noktaların sınırı) göre 0-1
//   22 blendshape               — MediaPipe katsayıları (0-1)
//   2 göz kesiti × 40×20 gri    — 800 + 800, 0-1 (histogram eşitleme yok)
// Göz kutusu göz çevresi noktalarının sınırı, merkezden 1,2 kat büyütülür; yüksekliği en az genişliğin yarısı (40×20 oranı bozulmasın).
// README 15 noktayı ve 22 katsayıyı adıyla vermiyor; seçim bizim (aşağıda). Kalibrasyonda kare başına ±1 px kaydırmalı 9 kopya (reArtir).
const REY = {
  // göz köşeleri (33,133 sağ; 362,263 sol), iris merkezleri (468 sağ, 473 sol), burun ucu, çene, alın, ağız köşeleri, yanaklar, üst kapaklar
  LM: [33, 133, 362, 263, 468, 473, 1, 152, 10, 61, 291, 234, 454, 159, 386],
  // göz ve kaş katsayıları (21) + jawOpen: çene açılınca 152 noktası ve yüz kutusu değişir, normalize noktaları bundan etkilenir
  BS: ["eyeBlinkLeft", "eyeBlinkRight",
       "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
       "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
       "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
       "cheekSquintLeft", "cheekSquintRight", "jawOpen"],
  // göz çevresi (MediaPipe 468 ağ): önce sol göz (kişinin solu, 263-362), sonra sağ (33-133) — wg_yama.js ile aynı sıra
  SOL: [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398],
  SAG: [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173],
  W: 40, H: 20, OLCEK: 1.2,
};
REY.BOY = REY.LM.length * 2 + REY.BS.length + 2 * REY.W * REY.H;   // 30 + 22 + 1600 = 1652
// Kesit alma: iki göz kutusunu (±2 px pay ile) kapsayan bölge kaynak çözünürlüğünde TEK drawImage + TEK getImageData ile okunur,
// 40×20'ye küçültme JS'te yapılır (her hücre 2×2 alt örnek, çift doğrusal). İlk sürüm her kesit için drawImage+getImageData
// yapıyordu: 9 kopya 18 okuma = ~11 ms/kare (tarayıcıda ölçüldü), kare hızını düşürürdü. Eğitim ve ölçüm aynı yolu kullanır.
const reyTuval = document.createElement("canvas");
const reyCtx = reyTuval.getContext("2d", { willReadFrequently: true });

function reyKutu(p, idx) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of idx) { const q = p[i]; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const w = (x1 - x0) * REY.OLCEK, h = Math.max((y1 - y0) * REY.OLCEK, w / 2);
  if (!(w >= 4 && h >= 2)) return null;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}
// Kutuları kapsayan bölgeyi gri (0-1) oku. Kare dışı kalan kısım 0 (siyah).
function reyOku(src, kutular, pay = 2) {
  const x0 = Math.floor(Math.min(...kutular.map((k) => k.x))) - pay, y0 = Math.floor(Math.min(...kutular.map((k) => k.y))) - pay;
  const w = Math.ceil(Math.max(...kutular.map((k) => k.x + k.w))) + pay - x0, h = Math.ceil(Math.max(...kutular.map((k) => k.y + k.h))) + pay - y0;
  if (w < 4 || h < 4 || w * h > 4e6) return null;
  if (reyTuval.width !== w || reyTuval.height !== h) { reyTuval.width = w; reyTuval.height = h; } else reyCtx.clearRect(0, 0, w, h);
  reyCtx.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  const d = reyCtx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  return { x0, y0, w, h, g };
}
// Kutu (dx,dy px kaydırılarak) 40×20'ye küçültülür, out[ofs..] içine yazılır
function reyKesit(R, k, dx, dy, out, ofs) {
  const { g, w, h } = R, sx = k.w / REY.W, sy = k.h / REY.H;
  const ox = k.x + dx - R.x0 - 0.5, oy = k.y + dy - R.y0 - 0.5;   // piksel merkezi i+0,5
  const al = (fx, fy) => {
    fx = Math.min(Math.max(fx, 0), w - 1.001); fy = Math.min(Math.max(fy, 0), h - 1.001);
    const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, o = iy * w + ix;
    return (g[o] * (1 - ax) + g[o + 1] * ax) * (1 - ay) + (g[o + w] * (1 - ax) + g[o + w + 1] * ax) * ay;
  };
  let j = ofs;
  for (let r = 0; r < REY.H; r++) for (let c = 0; c < REY.W; c++, j++) {
    const fx = ox + c * sx, fy = oy + r * sy;
    out[j] = (al(fx + 0.25 * sx, fy + 0.25 * sy) + al(fx + 0.75 * sx, fy + 0.25 * sy) + al(fx + 0.25 * sx, fy + 0.75 * sy) + al(fx + 0.75 * sx, fy + 0.75 * sy)) / 4;
  }
}
// Nokta + katsayı kısmı (ilk 52 değer). Katsayı yoksa null (sahte 0 yazılmaz).
function reyBas(p, bs) {
  if (!p || p.length < 478 || !bs) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const fw = x1 - x0, fh = y1 - y0; if (fw < 10 || fh < 10) return null;
  const v = new Float32Array(REY.BOY);
  REY.LM.forEach((i, k) => { v[2 * k] = (p[i][0] - x0) / fw; v[2 * k + 1] = (p[i][1] - y0) / fh; });
  const o = REY.LM.length * 2;
  for (let k = 0; k < REY.BS.length; k++) { const s = bs[REY.BS[k]]; if (!Number.isFinite(s)) return null; v[o + k] = s; }
  return v;
}
const REY_KESIT0 = REY.LM.length * 2 + REY.BS.length, REY_KESIT_N = REY.W * REY.H;
// Ortak hazırlık: nokta/katsayı kısmı, iki kutu, okunan bölge (biri yoksa null)
function reyHazirla(src, p, bs) {
  const v = reyBas(p, bs); if (!v) return null;
  const ks = reyKutu(p, REY.SOL), kg = reyKutu(p, REY.SAG); if (!ks || !kg) return null;
  const R = reyOku(src, [ks, kg]); return R ? { v, ks, kg, R } : null;
}
// src: modele giden kare (video ya da yakınlaştırma tuvali); p: aynı karede piksel yüz noktaları; bs: { ad: katsayı }
function reOznitelik(src, p, bs) {
  const H = reyHazirla(src, p, bs); if (!H) return null;
  reyKesit(H.R, H.ks, 0, 0, H.v, REY_KESIT0); reyKesit(H.R, H.kg, 0, 0, H.v, REY_KESIT0 + REY_KESIT_N);
  return H.v;
}
// Kalibrasyon için veri çoğaltma: göz kutuları ±1 px kaydırılarak 9 kopya (dy, dx ∈ {-1,0,1}); [4] kaydırmasız olandır.
function reArtir(src, p, bs) {
  const H = reyHazirla(src, p, bs); if (!H) return null;
  const A = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    const c = H.v.slice();
    reyKesit(H.R, H.ks, dx, dy, c, REY_KESIT0); reyKesit(H.R, H.kg, dx, dy, c, REY_KESIT0 + REY_KESIT_N);
    A.push(c);
  }
  return A;
}

// Çift (dual) ridge: β = Xᵀ(XXᵀ + λI)⁻¹ y. X z-skorlu, sabit terim y ortalaması (cezalandırılmaz).
// p (1.652) ≫ n (≤900) olduğu için p×p normal denklem yerine n×n çözülür (Cholesky).
// λ oturum başına kalibrasyon verisinden seçilir (fitSec): gruplu birini-dışarıda-bırak (grup = bir kalibrasyon noktası ya da bir
// düzeltme tıklaması: tüm kareleri ve 9 kopyası birlikte). Çekirdek ridge özdeşliği: C = (K + λI)⁻¹, α = C·y ise grup G dışarıda
// bırakılınca G'deki artıklar r_G = (C_GG)⁻¹ α_G. K bir kez, her λ için bir Cholesky. Ortalama/z-skor tüm kalibrasyon satırlarından
// (dışarıda bırakılan grup dahil) — özdeşliğin varsaydığı sabit ön işlem; kontrol/GazeLab verisi hiç kullanılmaz.
// Sabit terim CV'de her katta yeniden kestirilmeli: global ortalama sabitken Σ yc = 0 kısıtı, küçük λ'da (eğitim ezberlenince)
// dışarıdaki grubun hedefini kalanlardan birebir geri verir (hedefle ilgisiz öznitelikte bile CV ~1 px; en küçük λ hep seçilir).
// Bu yüzden CV çekirdeğine sabit sütun eklenir (K + s·11ᵀ). X sütunları tüm veriyle merkezli olduğundan K·1 = 0: tüm veriyle
// kurulan model (α) değişmez, yalnız dışarıda-bırakma artıkları düzelir.
const RER_SABIT = 100;   // s = RER_SABIT × iz: sabit terimin cezası λ/s, en büyük λ'da (10·iz) bile ihmal edilebilir
// λ = iz × çarpan. iz = Σ sütun ağırlığı² = çekirdeğin ortalama köşegeni (K_ii'nin satır ortalaması). Ağırlıksız (RealEye Light)
// her sabit olmayan sütunun ağırlığı 1 olduğundan iz = p_eff (sabit olmayan sütun sayısı): eski davranışın aynısı.
const RER_CARPAN = [1e-3, 1e-2, 1e-1, 1, 10];
// sutunGrup (isteğe bağlı): her sütunun grup etiketi (karma.js). Verilirse her grubun sütunları z-skordan sonra 1/√(grubun sabit
// olmayan sütun sayısı) ile çarpılır: her grup çekirdeğe (K = X Xᵀ) toplam varyans 1 katar, büyük grup (1.600 kesit pikseli) küçük
// grubu (7 bizim öznitelik) sayıca bastıramaz. Ağırlık sd'ye gömülür (sd·√boy), predict aynı sd ile çalıştığından ayrıca saklanmaz.
function rerHazirla(F, sutunGrup = null) {
  const n = F.length, p = F[0].length;
  const mu = new Float64Array(p), sd = new Float64Array(p);
  for (const f of F) for (let j = 0; j < p; j++) mu[j] += f[j] / n;
  for (const f of F) for (let j = 0; j < p; j++) sd[j] += (f[j] - mu[j]) ** 2 / n;
  let peff = 0;
  for (let j = 0; j < p; j++) { sd[j] = Math.sqrt(sd[j]); if (sd[j] > 1e-6) peff++; }
  let iz = peff, grupBoy = null;
  if (sutunGrup) {
    grupBoy = new Map();
    for (let j = 0; j < p; j++) if (sd[j] > 1e-6) grupBoy.set(sutunGrup[j], (grupBoy.get(sutunGrup[j]) || 0) + 1);
    iz = grupBoy.size;   // her grup Σ w² = boy × (1/boy) = 1
    for (let j = 0; j < p; j++) if (sd[j] > 1e-6) sd[j] *= Math.sqrt(grupBoy.get(sutunGrup[j]));   // (x-μ)/(sd·√boy) = z/√boy
  }
  const X = new Float64Array(n * p);   // z-skor (× grup ağırlığı); sabit sütun (sd≈0) 0 kalır
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) X[i * p + j] = sd[j] > 1e-6 ? (F[i][j] - mu[j]) / sd[j] : 0;
  return { n, p, mu, sd, X, peff, iz, grupBoy };
}
function rerCekirdek(X, n, p) {   // K = X Xᵀ (900×1652: Node'da ~1 sn, 4 satır bloklu iç çarpım)
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const oi = i * p; let k = 0;
    for (; k + 3 <= i; k += 4) {
      const o0 = k * p, o1 = o0 + p, o2 = o1 + p, o3 = o2 + p; let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let j = 0; j < p; j++) { const x = X[oi + j]; s0 += x * X[o0 + j]; s1 += x * X[o1 + j]; s2 += x * X[o2 + j]; s3 += x * X[o3 + j]; }
      K[i * n + k] = K[k * n + i] = s0; K[i * n + k + 1] = K[(k + 1) * n + i] = s1; K[i * n + k + 2] = K[(k + 2) * n + i] = s2; K[i * n + k + 3] = K[(k + 3) * n + i] = s3;
    }
    for (; k <= i; k++) { const ok = k * p; let s = 0; for (let j = 0; j < p; j++) s += X[oi + j] * X[ok + j]; K[i * n + k] = s; K[k * n + i] = s; }
  }
  return K;
}
function rerCholesky(A, n) {   // yerinde: alt üçgen L (A = L Lᵀ)
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2;
    const d = Math.sqrt(Math.max(s, 1e-12)); A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / d; }
  }
  return A;
}
function rerCoz(L, n, y) {   // L Lᵀ z = y
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) { let t = y[i]; for (let k = 0; k < i; k++) t -= L[i * n + k] * z[k]; z[i] = t / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let t = z[i]; for (let k = i + 1; k < n; k++) t -= L[k * n + i] * z[k]; z[i] = t / L[i * n + i]; }
  return z;
}
// Bir λ için: α (2 sütun) ve her grubun dışarıda-bırakma artıkları. Yc: ortalaması çıkarılmış hedefler [[x,y],...].
function rerGrupLOO(K, n, Yc, gruplar, lam) {
  const L = K.slice(); for (let i = 0; i < n; i++) L[i * n + i] += lam;
  rerCholesky(L, n);
  const a = [0, 1].map((c) => rerCoz(L, n, Yc.map((y) => y[c])));
  const M = new Float64Array(n * n);   // M = L⁻¹ (alt üçgen), satır satır (bellekte ardışık erişim); C = Mᵀ M
  for (let i = 0; i < n; i++) {
    const oi = i * n;
    for (let k = 0; k < i; k++) { const l = L[oi + k]; if (!l) continue; const ok = k * n; for (let j = 0; j <= k; j++) M[oi + j] -= l * M[ok + j]; }
    M[oi + i] += 1;
    const d = L[oi + i]; for (let j = 0; j <= i; j++) M[oi + j] /= d;
  }
  const artik = new Array(n);
  for (const G of gruplar) {
    const g = G.length, C = new Float64Array(g * g), m = new Float64Array(g);
    for (let k = Math.min(...G); k < n; k++) {   // C_GG = Σ_k M[k,G]ᵀ M[k,G]
      const ok = k * n; for (let u = 0; u < g; u++) m[u] = M[ok + G[u]];
      for (let u = 0; u < g; u++) { const x = m[u]; if (!x) continue; for (let v = 0; v <= u; v++) C[u * g + v] += x * m[v]; }
    }
    for (let u = 0; u < g; u++) for (let v = 0; v < u; v++) C[v * g + u] = C[u * g + v];
    rerCholesky(C, g);
    const r = [0, 1].map((c) => rerCoz(C, g, G.map((i) => a[c][i])));
    G.forEach((i, u) => (artik[i] = [r[0][u], r[1][u]]));
  }
  return { a, artik };
}
class ReRidge {
  _bitir(H, my, a, lam) {   // β = Xᵀ α
    const { n, p, X } = H;
    this.b = a.map((z) => { const b = new Float64Array(p); for (let i = 0; i < n; i++) { const v = z[i], oi = i * p; for (let j = 0; j < p; j++) b[j] += X[oi + j] * v; } return b; });
    Object.assign(this, { mu: H.mu, sd: H.sd, my, n, p, lam, peff: H.peff, iz: H.iz });
    return this;
  }
  fit(F, Y, lam = 1, sutunGrup = null) {
    const H = rerHazirla(F, sutunGrup), K = rerCekirdek(H.X, H.n, H.p);
    const my = [0, 1].map((c) => Y.reduce((s, y) => s + y[c], 0) / H.n);
    for (let i = 0; i < H.n; i++) K[i * H.n + i] += lam;
    rerCholesky(K, H.n);
    return this._bitir(H, my, [0, 1].map((c) => rerCoz(K, H.n, Y.map((y) => y[c] - my[c]))), lam);
  }
  // grup: her satırın grup anahtarı. Hata = grubun ortalama dışarıda-bırakma tahmininin hedefe uzaklığı (px);
  // seçim: gruplar üzerinden medyanı en küçük λ. tablo: her λ için medyan/ortalama.
  // bekle: her λ arasında çağrılır (sayfa donmasın; kurulum 900×1652'de Node'da ~4 sn, λ başına ~0,65 sn)
  // sutunGrup: rerHazirla'daki grup ağırlığı (karma); verilmezse RealEye Light'ın ağırlıksız hâli
  async fitSec(F, Y, grup, carpanlar = RER_CARPAN, bekle = null, sutunGrup = null) {
    const H = rerHazirla(F, sutunGrup), n = H.n, K = rerCekirdek(H.X, n, H.p);
    { const s = RER_SABIT * H.iz; for (let i = 0; i < n * n; i++) K[i] += s; }
    const my = [0, 1].map((c) => Y.reduce((s, y) => s + y[c], 0) / n), Yc = Y.map((y) => [y[0] - my[0], y[1] - my[1]]);
    const harita = new Map(); grup.forEach((g, i) => { if (!harita.has(g)) harita.set(g, []); harita.get(g).push(i); });
    const gruplar = [...harita.values()];
    if (gruplar.length < 3) throw new Error(`λ seçimi için en az 3 grup gerekli (${gruplar.length})`);
    const med = (A) => { const s = [...A].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
    let en = null; const tablo = [];
    for (const c of carpanlar) {
      if (bekle) await bekle();
      const lam = H.iz * c, { a, artik } = rerGrupLOO(K, n, Yc, gruplar, lam);
      const E = gruplar.map((G) => Math.hypot(G.reduce((s, i) => s + artik[i][0], 0) / G.length, G.reduce((s, i) => s + artik[i][1], 0) / G.length));
      const sat = { carpan: c, lam, medyan: med(E), ort: E.reduce((s, e) => s + e, 0) / E.length };
      tablo.push(sat);
      if (Number.isFinite(sat.medyan) && (!en || sat.medyan < en.sat.medyan)) en = { sat, a };
    }
    if (!en) throw new Error("λ seçilemedi (hata hesaplanamadı)");
    this._bitir(H, my, en.a, en.sat.lam);
    this.secim = { tablo, grup: gruplar.length, peff: H.peff, iz: H.iz, grupBoy: H.grupBoy ? Object.fromEntries(H.grupBoy) : null };
    return this;
  }
  // Tahmin için yalnız standartlaştırma ve birincil ağırlıklar (β = Xᵀα) gerekir; eğitim satırları saklanmaz (ders sayfasına aktarım)
  toJSON() { return { mu: Array.from(this.mu), sd: Array.from(this.sd), b: this.b.map((z) => Array.from(z)), my: this.my, p: this.p, lam: this.lam }; }
  static from(o) { return Object.assign(new ReRidge(), o); }
  predict(f) {
    let x = this.my[0], y = this.my[1];
    const { mu, sd, b } = this;
    for (let j = 0; j < this.p; j++) { if (sd[j] <= 1e-6) continue; const z = (f[j] - mu[j]) / sd[j]; x += z * b[0][j]; y += z * b[1][j]; }
    return [x, y];
  }
}

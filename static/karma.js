// Karma model (bakis_test.html "karma", "karmaH"): bizim öznitelikler + WebGazer 120 göz yaması + RealEye Light öznitelikleri TEK
// modelde (öznitelik düzeyinde birleştirme; sonuç ortalaması "karisim" değil). Çözüm re_yama.js'in çift ridge'i (ReRidge.fitSec):
// p ≈ 7 + 120 + 1.652 ≫ n olduğu için n×n; λ aynı gruplu bir-kalibrasyon-noktası-dışarıda CV ile seçilir (kod kopyası yok).
//
// Ölçek: üç kaynağın değerleri farklı birimde (bizim: normalize göz konumu/baş açısı; yama: 0-255 gri; RE: 0-1). Her sütun eğitim
// verisinden z-skorlanır, sonra sütun grubu boyutuna göre 1/√boy ile ağırlıklanır (rerHazirla, sutunGrup). Gerekçe: z-skordan sonra
// her sütun çekirdeğe K = X Xᵀ eşit varyans katar; ağırlıksız hâlde 1.600 kesit pikseli çekirdeğin ~%90'ını oluşturur ve bizW'yi iyi
// yapan 7 bizim öznitelik ile 120 yama değeri ezilir. 1/√boy ile her grup toplam varyans 1 katar (gruplar eşit söz hakkı). RE'nin
// kendi içindeki 52 nokta+katsayı ile 1.600 kesit pikseli de aynı nedenle iki ayrı ağırlık grubudur: 4 ağırlık grubu, 3 veri kaynağı.
// Eşit pay bir ön kabuldür (hangi grubun daha bilgili olduğu oturuma göre değişir); λ, CV ile bu ağırlıklı uzayda seçilir.
const KARMA_GRUP = ["bizim", "WebGazer yaması", "RE nokta+katsayı", "RE göz kesiti"];

// Bir karenin karma öznitelik vektörü. Üç kaynaktan biri yoksa null (eksik grup sıfırla doldurulmaz: kare atlanır).
// bizOz: bizim ham vektör → öznitelik (bakis_test.html'de gzModelFeatures; bizW'nin ozW'sindeki bizim kısmın aynısı)
function karmaOznitelik(b, bizOz) {
  if (!b || !b.raw || !b.wgp || !b.re) return null;
  const f = bizOz(b.raw);
  if (!f?.length || !b.wgp.length || b.re.length !== REY.BOY) return null;
  const v = new Float32Array(f.length + b.wgp.length + b.re.length);
  v.set(f, 0); v.set(b.wgp, f.length); v.set(b.re, f.length + b.wgp.length);
  for (let j = 0; j < v.length; j++) if (!Number.isFinite(v[j])) return null;
  return { v, boy: [f.length, b.wgp.length] };
}
// Sütun → ağırlık grubu (0 bizim, 1 yama, 2 RE nokta+katsayı, 3 RE kesit)
function karmaSutunGrup(nBiz, nYama) {
  const p = nBiz + nYama + REY.BOY, g = new Int8Array(p);
  for (let j = 0; j < p; j++) g[j] = j < nBiz ? 0 : j < nBiz + nYama ? 1 : j < nBiz + nYama + REY_KESIT0 ? 2 : 3;
  return g;
}
// Pencere karelerini depoya ekler. g: λ CV grubu (bir bakarak noktası / bir düzeltme tıklaması / bir baş turu noktası).
// w: satır tekrarı (bizW'nin düzeltme tıklaması ağırlığı "tekrar" ile aynı). Döner: atlanan kare sayısı (eksik grup).
function karmaEkle(depo, win, sx, sy, g, w, bizOz) {
  let atla = 0;
  for (const b of win) {
    const o = karmaOznitelik(b, bizOz);
    if (!o) { atla++; continue; }
    depo.kareler.push({ v: o.v, boy: o.boy, y: [sx, sy], g, w: Math.max(1, w | 0) });
  }
  depo.atlanan = (depo.atlanan || 0) + atla;
  return atla;
}
// Eğitim satırları: önce en çok enCokSatir satıra sığacak kadar kare EŞİT ARALIKLI seçilir, sonra her kare w kez yazılır.
// Öznitelik boyu (bizim/yama sütun sayısı) ilk kareden farklı olan kare atlanır (sayısı döner).
function karmaSatirlar(kareler, enCokSatir) {
  if (!kareler.length) return { F: [], Y: [], G: [], sutunGrup: null, kare: 0, boyFarki: 0 };
  const b0 = kareler[0].boy, uy = kareler.filter((k) => k.boy[0] === b0[0] && k.boy[1] === b0[1]);
  const N = uy.length, sec = (m) => Array.from({ length: m }, (_, i) => uy[m === N ? i : Math.round(i * (N - 1) / Math.max(1, m - 1))]);
  let m = N, K = sec(m);
  while (m > 1 && K.reduce((s, k) => s + k.w, 0) > enCokSatir) { m = Math.max(1, Math.floor(m * 0.9)); K = sec(m); }
  const F = [], Y = [], G = [];
  for (const k of K) for (let r = 0; r < k.w; r++) { F.push(k.v); Y.push(k.y); G.push(k.g); }
  return { F, Y, G, sutunGrup: karmaSutunGrup(b0[0], b0[1]), kare: m, boyFarki: kareler.length - N };
}
// Kurulum: { model, bilgi } ya da hata fırlatır. bekle: λ adımları arasında (sayfa donmasın)
async function karmaKurSaf(kareler, { enCokSatir = 600, minKare = 10, bekle = null } = {}) {
  const S = karmaSatirlar(kareler, enCokSatir);
  if (S.kare < minKare) throw new Error(`yetersiz kare: ${S.kare} (en az ${minKare})`);
  const model = await new ReRidge().fitSec(S.F, S.Y, S.G, undefined, bekle, S.sutunGrup);
  return { model, S };
}
// Tahmin: kare karma özniteliği yoksa ya da boyu modelinkinden farklıysa null
function karmaTahmin(model, b, bizOz) {
  if (!model) return null;
  const o = karmaOznitelik(b, bizOz);
  return o && o.v.length === model.p ? model.predict(o.v) : null;
}

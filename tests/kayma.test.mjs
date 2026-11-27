// Seçilen model için ders tıklaması kayma düzeltmesi (static/gaze.js gzKaymaGuncelle). Çalıştırma: node tests/kayma.test.mjs
//  1) tek tıklama tam kaydırmaz (n/3 ağırlık), üç tutarlı tıklamada tam kayma
//  2) aykırı tıklama (düzeltilmiş tahminden CLICK_RADIUS'tan uzak) alınmaz; medyan tek sapmaya dayanıklı
//  3) son KAYMA_N tıklama tutulur; düzeltme ±KAYMA_MAX ile sınırlı; sayı değilse değişmez
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const kod = fs.readFileSync(new URL("../static/gaze.js", import.meta.url), "utf8");
const gz = kod.slice(kod.indexOf("const GZ = {"), kod.indexOf("};", kod.indexOf("const GZ = {")) + 2);
const fn = kod.slice(kod.indexOf("function gzKaymaGuncelle"), kod.indexOf("function gzSecimOz"));
const ctx = vm.createContext({ Math, Number });
vm.runInContext(gz + "\n" + fn + "\nthis.G = GZ; this.guncelle = gzKaymaGuncelle; this.bos = gzKaymaBos; this.karar = gzKontrolKarar;", ctx);
const { G, guncelle, bos, karar } = ctx;

// 1)
let k = guncelle(bos(), 90, -60);
assert.equal(k.n, 1); assert.equal(Math.round(k.x), 30); assert.equal(Math.round(k.y), -20);
k = guncelle(k, 90, -60); k = guncelle(k, 90, -60);
assert.equal(k.n, 3); assert.equal(k.x, 90); assert.equal(k.y, -60);
// 2) uzak tıklama atılır
const once = k; k = guncelle(k, 90 + G.CLICK_RADIUS + 50, -60);
assert.equal(k, once);
// medyan: bir sapma (250 px içinde) sonucu değiştirmez
k = guncelle(k, 300, -60); assert.equal(k.n, 4); assert.equal(k.x, 90);
// 3) pencere ve sınır
let m = bos(); for (let i = 0; i < 20; i++) m = guncelle(m, 10, 10);
assert.equal(m.n, G.KAYMA_N); assert.equal(m.son.length, G.KAYMA_N);
let b = bos(); for (let x = 0; x <= 1000; x += 100) b = guncelle(b, x, 0);   // yavaşça artan kayma birikir ama sınırı aşmaz
assert.ok(b.x <= G.KAYMA_MAX && b.x > 0);
assert.equal(guncelle(m, NaN, 1), m);
// 4) kontrol noktası (güvenilir): sınıra takılmaz, tek noktada tam düzeltme; sonra tıklamalar düzeltilmiş tahmine göre kabul edilir
let n = guncelle(bos(), 170, 290, true);
assert.equal(n.n, G.KAYMA_NOKTA_AGIRLIK); assert.equal(n.x, 170); assert.equal(n.y, 290);
n = guncelle(n, 180, 300);   // eskiden 300 px sınırına takılırdı; şimdi düzeltilmiş tahmine yakın
assert.equal(n.n, G.KAYMA_NOKTA_AGIRLIK + 1);
assert.equal(guncelle(bos(), 900, 0, true).x, G.KAYMA_MAX);
// 5) güvenlik ağı (gzKontrolKarar), 27.11 deneme değerleriyle
const satir = (sec, ana, gos, n = 12) => ({ secim: { dogruluk: sec, n }, ana: { dogruluk: ana, n }, gosterilen: { dogruluk: gos, n } });
let r = karar(satir(757, 204, 757), bos());                       // karmaH 757, ana 204 → ana modele dön
assert.equal(r.birak, true); assert.match(r.neden, /757.*204/);
assert.equal(karar(satir(727, 1010, 738), bos()).birak, false);   // ana daha da kötü: bırakılmaz
assert.equal(karar(satir(233, 191, 485), bos()).birak, false);    // seçilen 300 px altında: bırakılmaz
assert.equal(karar(satir(350, 200, 350), bos()).birak, false);    // 2 kattan az kötü: bırakılmaz
assert.equal(karar(satir(900, 100, 900, 4), bos()).birak, false); // 5 kareden az: karar yok
const kay = { x: 280, y: 600, n: 3, son: [] };
r = karar(satir(233, 191, 485), kay);                              // kayma hatayı 233 → 485 büyüttü: sıfırla
assert.equal(r.kaymaSifirla, true); assert.equal(r.birak, false);
assert.equal(karar(satir(233, 191, 120), kay).kaymaSifirla, false);   // kayma işe yaradı: kalsın
assert.equal(karar(satir(233, 191, 485), bos()).kaymaSifirla, false); // kayma yokken sıfırlanacak bir şey yok
assert.equal(karar({}, kay).birak, false); assert.equal(karar(null, kay).kaymaSifirla, false);
console.log("kayma: tamam");

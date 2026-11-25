// Kare kare kayıt satırı (static/kare_kayit.js), görüntü kalitesi (static/gaze.js gzKalite) ve olay günlüğü yardımcıları
// (static/olay_gunlugu.js). Çalıştırma: node tests/kare_olay.test.mjs
//  1) gzKalite: düz gri görüntüde kontrast/netlik 0, sol-sağ fark ve aşırı/az pozlama oranları doğru; boşsa null
//  2) satir: zaman (ep, ct, pf), kalite, iris mm dizileri (eskiden yanlışlıkla null yazılıyordu), yüzsüz kare yalnız zaman + yok=1;
//     göz kesiti secenek.re=false ile atlanır
//  3) kameraAyarOzet kimlik alanlarını almaz; degisenler yalnız değişeni verir; yetenekOzet aralıkları sadeleştirir
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const oku = (f) => fs.readFileSync(new URL(`../static/${f}`, import.meta.url), "utf8");
const g = oku("gaze.js");
const ctx = vm.createContext({ Math, Number, JSON, Object, Array, Set, Float32Array, ArrayBuffer, globalThis: null });
ctx.globalThis = ctx;
vm.runInContext(g.slice(g.indexOf("function gzKalite"), g.indexOf("// ham: [rx, ry, lx, ly, ro, lo, hy, hp]")) + "\nthis.gzKalite = gzKalite;", ctx);
vm.runInContext(oku("kare_kayit.js"), ctx);
vm.runInContext(oku("olay_gunlugu.js"), ctx);
const { gzKalite, KareKayit, OlayGunlugu } = ctx;

// 1)
const goruntu = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = 4 * (y * w + x); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { data: d, width: w, height: h }; };
let q = gzKalite(goruntu(8, 8, () => 100));
assert.deepEqual([...q], [100, 0, 0, 0, 0, 0]);
q = gzKalite(goruntu(8, 8, (x) => (x < 4 ? 255 : 0)));   // sol yarı beyaz, sağ yarı siyah
assert.equal(q[0], 127.5); assert.equal(q[1], 127.5); assert.equal(q[2], 255); assert.equal(q[4], 50); assert.equal(q[5], 50);
assert.ok(q[3] > 0);   // kenar var: netlik > 0
assert.equal(gzKalite(null), null);
assert.equal(gzKalite({ data: new Uint8ClampedArray(4), width: 1, height: 1 }), null);

// 2)
const bsAd = ["eyeBlinkLeft", "jawOpen"];
const l = { t: 12.34567, ep: 1764000000123, vm: { ct: 1764000000100, pf: 412, mt: 13.7 }, q: [101.23, 20, -3, 55.56, 0, 1, 90, 2],
            blink: false, open: 0.31234567, raw: [1, 2, 3, 4, 5, 6, 7, 8], pose3: { yaw: 1.23456, pitch: -2, roll: 0, dist: 55.5, tx: 1, ty: 2, tz: 3 },
            bs: { jawOpen: 0.1, eyeBlinkLeft: 0.2 }, irisMm: { sag: [0.123456, -0.5], sol: [0.2, 0.3] }, yuz2d: { nx: 320.04, ny: 200, size: 90 },
            wgp: [1, 2], kure: [0.1, 0.2], re: [0.5, 0.6] };
let r = KareKayit.satir(l, bsAd, { a: "x", off: [0, 0] });
assert.equal(r.a, "x"); assert.equal(r.kt, 12.3457); assert.equal(r.ep, 1764000000123); assert.equal(r.ct, 1764000000100); assert.equal(r.pf, 412);
assert.deepEqual([...r.q], [101.2, 20, -3, 55.6, 0, 1, 90, 2]);
assert.deepEqual(JSON.parse(JSON.stringify(r.ir)), [[0.123, -0.5], [0.2, 0.3]]);
assert.deepEqual([...r.bs], [0.2, 0.1]);
assert.equal(r.p3[0], 1.235); assert.equal(r.b, 0); assert.deepEqual([...r.re], [0.5, 0.6]);
assert.equal(KareKayit.satir(l, bsAd, {}, { re: false }).re, undefined);
r = KareKayit.satir({ t: 1, ep: 5, vm: null, yok: true }, bsAd);
assert.deepEqual(JSON.parse(JSON.stringify(r)), { kt: 1, ep: 5, ct: null, pf: null, q: null, yok: 1 });

// 3)
assert.deepEqual({ ...OlayGunlugu.kameraAyarOzet({ width: 1280, deviceId: "gizli", groupId: "g", exposureTime: 156.333, whiteBalanceMode: "continuous" }) },
  { width: 1280, exposureTime: 156.33, whiteBalanceMode: "continuous" });
assert.deepEqual({ ...OlayGunlugu.degisenler({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }) }, { b: 3, c: 4 });
assert.equal(OlayGunlugu.degisenler({ a: 1 }, { a: 1 }), null);
assert.deepEqual(JSON.parse(JSON.stringify(OlayGunlugu.yetenekOzet({ exposureTime: { min: 1, max: 1000, step: 1 }, focusMode: ["manual", "continuous"], deviceId: "x" }))),
  { exposureTime: { min: 1, max: 1000, step: 1 }, focusMode: ["manual", "continuous"] });
// 4) kaliteSayaci: kareler arası süre, yüzsüz oran, kamera sayacındaki atlama; sıfırlayınca yeni pencere
const S = KareKayit.kaliteSayaci();
for (const [ep, pf, yok] of [[1000, 10, 0], [1033, 11, 0], [1066, 14, 1], [1166, 15, 0]]) S.ekle({ ep, pf, yok });
let o = S.al(true);
assert.equal(o.kare, 4); assert.equal(o.yuzsuz, 1); assert.equal(o.yuzsuzYuzde, 25); assert.equal(o.sureSn, 0.2);
assert.equal(o.araOrtMs, 55.3); assert.equal(o.araEnCokMs, 100); assert.equal(o.kameraAtlanan, 2);
S.ekle({ ep: 1200, pf: null });
o = S.al();
assert.equal(o.kare, 1); assert.equal(o.araOrtMs, 34); assert.equal(o.kameraAtlanan, null);
assert.equal(KareKayit.kaliteSayaci().al().araOrtMs, null);

// 5) ogeAd: etiket#id.ilkSınıf[tür], içerik yok
assert.equal(OlayGunlugu.ogeAd({ tagName: "BUTTON", id: "handBtn", classList: Object.assign(["btn", "x"], {}), type: "button" }), "button#handBtn.btn[button]");
assert.equal(OlayGunlugu.ogeAd({ tagName: "DIV", id: "", classList: [] }), "div");
assert.equal(OlayGunlugu.ogeAd(null), null);
console.log("kare_olay: tamam");

// Ders bakış ölçümü (static/bakis_olcum.js) saf işlevleri ve yerel yedekte ölçüm satırları (static/yedek.js dersJson).
// Çalıştırma: node tests/bakis_olcum.test.mjs
//  1) istatistik: doğruluk (ortalamanın hedefe uzaklığı), medyan, kesinlik; geçersiz noktalar atılır; boşsa null
//  2) basFark: kalibrasyona göre fark (ör. 15 cm yaklaşma = dist -15); referans/poz yoksa null; eksik alan null
//  3) pozOrt ve duzlestir (CSV): iç içe nesne a_b, dizi JSON metni
//  4) dersJson: ölçüm satırı "olcum" ile yazılır, govde satırları aynen; CSV satırlarına ölçüm satırı karışmaz
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ Math, Number, JSON, Object, Array, Set, Date, Intl, String, Promise, setTimeout, clearTimeout, setInterval, clearInterval, performance, globalThis: null });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(new URL("../static/bakis_olcum.js", import.meta.url), "utf8"), ctx);
vm.runInContext(fs.readFileSync(new URL("../static/yedek.js", import.meta.url), "utf8"), ctx);
const { istatistik, basFark, pozOrt, duzlestir } = ctx.BakisOlcum;
const Y = ctx.DNYedek;

// 1)
let s = istatistik([[110, 100], [90, 100], [100, 110], [100, 90]], 100, 100);
assert.equal(s.n, 4); assert.equal(s.dogruluk, 0); assert.equal(s.medyan, 10); assert.equal(s.kesinlik, 10);
s = istatistik([[200, 100], [200, 100], [NaN, 5], null], 100, 100);
assert.equal(s.n, 2); assert.equal(s.dogruluk, 100); assert.equal(s.kesinlik, 0); assert.deepEqual([...s.ort], [200, 100]);
assert.equal(istatistik([], 0, 0), null);

// 2)
const ref = { yaw: 1, pitch: -2, roll: 0, dist: 55 };
assert.deepEqual({ ...basFark(ref, { yaw: 4, pitch: -10, roll: 1, dist: 40 }) }, { yaw: 3, pitch: -8, roll: 1, dist: -15 });
assert.equal(basFark(null, { yaw: 1 }), null);
assert.equal(basFark(ref, null), null);
assert.deepEqual({ ...basFark(ref, { yaw: 2, dist: 50 }) }, { yaw: 1, pitch: null, roll: null, dist: -5 });

// 3)
assert.deepEqual({ ...pozOrt([{ yaw: 1, pitch: 2, roll: 3, dist: 50 }, { yaw: 3, pitch: 4, roll: 5, dist: 60 }]) }, { yaw: 2, pitch: 3, roll: 4, dist: 55 });
assert.equal(pozOrt([]), null);
assert.deepEqual({ ...duzlestir({ tur: "ders_ici", hedef: [5, 6], ana: { dogruluk: 80, ort: [1, 2] }, secim: null }) },
  { tur: "ders_ici", hedef: "[5,6]", ana_dogruluk: 80, ana_ort: "[1,2]", secim: null });

// 4)
const K = [{ t: 1000, govde: { attention: 50, kurulum: { cihazTam: { a: 1 } } }, sunucu: "ok" },
           { t: 2000, olcum: [{ tur: "tiklama", hataAna: 90 }], sunucu: "ok" }];
const J = JSON.parse(Y.dersJson(K));
assert.equal(J.length, 2);
assert.equal(J[0].govde.attention, 50);
assert.equal(J[1].olcum[0].hataAna, 90); assert.equal(J[1].govde, undefined);
assert.equal(Y.dersCsvSatirlari(K).length, 1);
// 5) kontrol: ölçüm sürerken g.olcumHedef hedefi, sırayı, türü ve aşamayı taşır; bitince silinir
{
  const el = () => ({ style: {}, remove() {}, className: "", innerHTML: "" });
  Object.assign(ctx, { document: { head: { insertAdjacentHTML() {} }, body: { append() {} }, createElement: el, fullscreenElement: null }, innerWidth: 1000, innerHeight: 500 });
  const B = ctx.BakisOlcum; B.O.SETTLE = 30; B.O.COLLECT = 30;
  const goruldu = [];
  const g = { hist: [], diag: {}, _off: () => ({ x: 0, y: 0 }), model: { predict: () => null }, showDot: false, setShowDot() {} };
  const iz = setInterval(() => { if (g.olcumHedef) goruldu.push({ ...g.olcumHedef }); }, 5);
  const L = await B.kontrol(g, [[0.5, 0.5], [0.1, 0.2]], "ders_sonu", () => "");
  clearInterval(iz);
  assert.equal(L.length, 2); assert.equal(g.olcumHedef, null);
  const ilk = goruldu.find((h) => h.sira === 1), ikinci = goruldu.find((h) => h.sira === 2);
  assert.deepEqual([ilk.x, ilk.y, ilk.tur], [500, 250, "ders_sonu"]); assert.deepEqual([ikinci.x, ikinci.y], [100, 100]);
  assert.ok(goruldu.some((h) => h.asama === "yerlesme") && goruldu.some((h) => h.asama === "toplama"));
}
console.log("bakis_olcum: tamam");

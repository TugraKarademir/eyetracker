// Ders bakış ölçümü (static/bakis_olcum.js) saf işlevleri ve yerel yedekte ölçüm satırları (static/yedek.js dersJson).
// Çalıştırma: node tests/bakis_olcum.test.mjs
//  1) istatistik: doğruluk (ortalamanın hedefe uzaklığı), medyan, kesinlik; geçersiz noktalar atılır; boşsa null
//  2) basFark: kalibrasyona göre fark (ör. 15 cm yaklaşma = dist -15); referans/poz yoksa null; eksik alan null
//  3) pozOrt ve duzlestir (CSV): iç içe nesne a_b, dizi JSON metni
//  4) dersJson: ölçüm satırı "olcum" ile yazılır, govde satırları aynen; CSV satırlarına ölçüm satırı karışmaz
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ Math, Number, JSON, Object, Array, Set, Date, Intl, String, globalThis: null });
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
console.log("bakis_olcum: tamam");

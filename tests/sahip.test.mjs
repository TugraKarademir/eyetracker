// Tarayıcıda saklanan kişiye özgü verinin sahibi (25.11: lab'da önceki kişinin kalibrasyonu yeni derse taşınıyordu).
// Çalıştırma: node tests/sahip.test.mjs
//  1) gzSahipUyar: sahip istenmiyorsa her kayıt; isteniyorsa yalnız aynı ders + öğrenci; sahibi yazılmamış eski kayıt reddedilir
//  2) LearningStateEstimator: sahip ayarlanmadan taban yüklenmez/saklanmaz; başka öğrencinin tabanı yüklenmez; eski ortak anahtar silinir
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const g = fs.readFileSync(new URL("../static/gaze.js", import.meta.url), "utf8");
const c1 = vm.createContext({});
vm.runInContext(g.slice(g.indexOf("function gzSahipUyar"), g.indexOf("// ---------------------------------------------------------------- özellikler")) + "\nthis.f = gzSahipUyar;", c1);
const f = c1.f;
assert.equal(f(null, null), true); assert.equal(f(null, { ders: "A", sid: "s_1" }), true);
assert.equal(f({ ders: "A", sid: "s_1" }, { ders: "A", sid: "s_1" }), true);
assert.equal(f({ ders: "A", sid: "s_1" }, { ders: "A", sid: "s_2" }), false);
assert.equal(f({ ders: "A", sid: "s_1" }, { ders: "B", sid: "s_1" }), false);
assert.equal(f({ ders: "A", sid: "s_1" }, null), false);

// 2)
const depo = new Map();
const localStorage = { getItem: (k) => (depo.has(k) ? depo.get(k) : null), setItem: (k, v) => depo.set(k, String(v)), removeItem: (k) => depo.delete(k) };
const taban = JSON.stringify({ at: 1, hist: Array.from({ length: 80 }, () => [0.1, 0.2]) });
depo.set("dn_ls_base", taban); depo.set("dn_ls_base_A_s_1", taban);
const c2 = vm.createContext({ localStorage, Math, JSON, Date, Number, Array, Object });
vm.runInContext(fs.readFileSync(new URL("../static/learnstate.js", import.meta.url), "utf8") + "\nthis.L = LearningStateEstimator;", c2);
let e = new c2.L();
assert.equal(e.restored, undefined);   // kişi bilinmeden ortak taban yüklenmez
e.sahipAyarla({ ders: "A", sid: "s_2" });
assert.equal(e.restored, undefined); assert.equal(depo.has("dn_ls_base"), false);
e = new c2.L(); e.sahipAyarla({ ders: "A", sid: "s_1" });
assert.equal(e.restored, 1);
console.log("sahip: tamam");

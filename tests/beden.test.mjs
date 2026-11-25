// Gövde duruşu ölçüleri (static/beden.js durusOlcu). Çalıştırma: node tests/beden.test.mjs
//  1) düz omuzlar: açı 0, genişlik, orta nokta; burun omuz ortasının üstünde → basOmuz > 0, yana sapma 0
//  2) sağ omuz aşağıda → açı > 0 (görüntüde y aşağı artar); burun sağa kaymış → basYana > 0
//  3) omuz görünürlüğü düşükse ya da nokta yoksa null; burun görünmüyorsa baş ölçüleri null
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ Math, Number });
vm.runInContext(fs.readFileSync(new URL("../static/beden.js", import.meta.url), "utf8") + "\nthis.durusOlcu = durusOlcu;", ctx);
const { durusOlcu } = ctx;
const N = (ek) => { const n = Array.from({ length: 33 }, () => [0, 0, 0, 0]); for (const [i, p] of Object.entries(ek)) n[i] = p; return n; };

// 1) asp=1: omuzlar (0.4,0.6) ve (0.6,0.6); burun (0.5,0.4)
let o = durusOlcu(N({ 11: [0.6, 0.6, 0, 0.9], 12: [0.4, 0.6, 0, 0.9], 0: [0.5, 0.4, 0, 0.9] }), 1);
assert.equal(o.omuzAci, 0); assert.equal(o.omuzGen, 0.2); assert.deepEqual([...o.omuzOrta], [0.5, 0.6]);
assert.equal(o.basOmuz, 1); assert.equal(o.basYana, 0);
// 2) sol omuz (görüntüde sağ, 11) yukarıda değil: 11 y=0.6, 12 y=0.5 → dy = 0.1 > 0
o = durusOlcu(N({ 11: [0.6, 0.6, 0, 0.9], 12: [0.4, 0.5, 0, 0.9], 0: [0.6, 0.3, 0, 0.9] }), 1);
assert.ok(o.omuzAci > 0); assert.ok(o.basYana > 0);
// 3)
assert.equal(durusOlcu(N({ 11: [0.6, 0.6, 0, 0.2], 12: [0.4, 0.6, 0, 0.9] }), 1), null);
assert.equal(durusOlcu(null), null);
o = durusOlcu(N({ 11: [0.6, 0.6, 0, 0.9], 12: [0.4, 0.6, 0, 0.9] }), 1);
assert.equal(o.basOmuz, null); assert.equal(o.basYana, null);
console.log("beden: tamam");

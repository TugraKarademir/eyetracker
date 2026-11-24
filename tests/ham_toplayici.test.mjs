// static/analyzer.js HamToplayici (2 sn ham yüz ölçüsü penceresi) ve FocusAnalyzer.hamAl / step() bağlantısı (sahte face-api ile).
// Çalıştırma: node tests/ham_toplayici.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const J = (v) => JSON.parse(JSON.stringify(v));   // vm alanındaki nesneler başka prototip taşır
let saat = 1000;   // ms (sahte performance.now)
const ctx = vm.createContext({ Math, Number, Object, Array, JSON, Date, String, console: { log() {}, warn() {} },
  performance: { now: () => saat }, document: { hidden: false }, window: {}, setTimeout, clearTimeout });
const kaynak = (ad) => fs.readFileSync(new URL(`../static/${ad}`, import.meta.url), "utf8");
vm.runInContext(kaynak("common.js").match(/function notrTabanDuzelt[\s\S]*?\r?\n}\r?\n/)[0], ctx);
vm.runInContext(kaynak("analyzer.js") + "\n;globalThis.HamToplayici = HamToplayici; globalThis.FocusAnalyzer = FocusAnalyzer;", ctx);
ctx.window = ctx;   // analyzer.js window.gozLog / basLog yazar

// 1) Toplayıcı: boş pencere null; istatistikler; aynı 3B poz karesi bir kez; yüzsüz karede kırpma/ifade yok
{
  const H = new ctx.HamToplayici();
  assert.equal(H.al(1), null);
  H.kare(10); H.yuz({ yaw: 0.1, pitch: 0.4, ear: 0.3, mar: 0.1, kapali: false, ifade: { happy: 0.2, neutral: 0.8 } });
  H.poz({ t: 1, yaw: 2, pitch: -4, roll: 1, dist: 50 });
  H.kare(10.3); H.yuz({ yaw: -0.1, pitch: 0.5, ear: 0.1, mar: 0.5, kapali: true, ifade: { happy: 0.6, neutral: 0.4 } });
  H.poz({ t: 1, yaw: 99, pitch: 99, roll: 99, dist: 99 });   // aynı kare: sayılmaz
  H.poz({ t: 2, yaw: 4, pitch: -2, roll: 3, dist: 60 });
  H.kare(10.6);   // yüz yok
  const o = J(H.al(11.98));
  assert.deepEqual(o, { n: 3, yuzN: 2, ms: 1980, yaw: { ort: 0, min: -0.1, max: 0.1 }, pitch: { ort: 0.45, min: 0.4, max: 0.5 },
    ear: { ort: 0.2, min: 0.1 }, mar: { ort: 0.3, max: 0.5 }, kirpma: 1, ifade: { happy: 0.4, neutral: 0.6 },
    pose3: { yaw: 3, pitch: -3, roll: 2, dist: 55, n: 2 }, islemeFps: null, isciGecikmeMs: null });
  const Y = new ctx.HamToplayici();
  Y.kare(1); Y.poz(null);
  assert.deepEqual(J(Y.al(1)), { n: 1, yuzN: 0, ms: 0, yaw: { ort: null, min: null, max: null }, pitch: { ort: null, min: null, max: null },
    ear: { ort: null, min: null }, mar: { ort: null, max: null }, kirpma: null, ifade: null, pose3: null, islemeFps: null, isciGecikmeMs: null });
  console.log("1) ham toplayıcı (ortalama/min/max, kırpma, ifade, 3B poz, yüzsüz pencere null): tamam");
}

// 2) FocusAnalyzer: step() sahte face-api karesiyle; ham değerler lastPose ile aynı, hamAl sıfırlar, durmuşken null
{
  const P = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  const yer = (i, x, y) => (P[i] = { x, y });
  // göz köşeleri, burun, çene, göz kapakları, ağız
  yer(36, 100, 100); yer(45, 200, 100); yer(39, 130, 100); yer(42, 170, 100); yer(30, 155, 140); yer(8, 150, 220);
  for (const [i, x] of [[37, 110], [38, 120], [41, 110], [40, 120]]) yer(i, x, i < 39 ? 95 : 105);
  for (const [i, x] of [[43, 180], [44, 190], [47, 180], [46, 190]]) yer(i, x, i < 45 ? 95 : 105);
  yer(60, 130, 180); yer(64, 170, 180); yer(62, 150, 175); yer(66, 150, 185);
  const det = { landmarks: { positions: P }, expressions: { neutral: 0.7, happy: 0.2, sad: 0.05, angry: 0, fearful: 0, disgusted: 0, surprised: 0.05 } };
  ctx.faceapi = { detectSingleFace: () => ({ withFaceLandmarks: () => ({ withFaceExpressions: async () => det }) }) };
  let p3t = 0;
  const A = new ctx.FocusAnalyzer({ readyState: 4 }, { getPose3: () => ({ t: ++p3t, yaw: 5, pitch: -3, roll: 1, dist: 58 }) });
  assert.equal(A.hamAl(), null);   // çalışmıyor: ham yok
  A.running = true; A._ham = new ctx.HamToplayici();
  for (let i = 0; i < 4; i++) { saat += 300; await A.step(); }
  const o = J(A.hamAl());
  assert.equal(o.n, 4); assert.equal(o.yuzN, 4); assert.equal(o.kirpma, 0);
  assert.equal(o.yaw.ort, +A.lastPose.yaw.toFixed(4)); assert.equal(o.pitch.ort, +A.lastPose.pitch.toFixed(4)); assert.equal(o.ear.min, +A.lastPose.ear.toFixed(4));
  assert.equal(o.mar.max, 0.25);
  assert.deepEqual(o.ifade, J(det.expressions));
  assert.deepEqual(o.pose3, { yaw: 5, pitch: -3, roll: 1, dist: 58, n: 4 });
  assert.equal(o.ms, 900);
  assert.equal(A.state.face, true); assert.ok(Number.isFinite(A.state.attention));
  assert.equal(A.hamAl(), null);   // sıfırlandı: yeni pencerede kare yok
  // toplayıcı bozulsa bile analiz sürer (try ile korunur)
  A._ham = { kare() { throw new Error("x"); }, poz() {}, yuz() { throw new Error("y"); } };
  saat += 300; await A.step();
  assert.equal(A.state.face, true);
  console.log("2) analizör step() → ham pencere, hamAl sıfırlar, durmuşken null, toplayıcı hatası analizi durdurmaz: tamam");
}
console.log("ham_toplayici: TAMAM");

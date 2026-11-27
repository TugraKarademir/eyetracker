// RealEye Light çift ridge (static/re_yama.js) denetimi. Çalıştırma: node tests/re_ridge.test.mjs
//  1) çift (dual) çözüm = birincil (primal) ridge çözümü
//  2) gruplu birini-dışarıda-bırak özdeşliği r_G = (C_GG)⁻¹ α_G = grubu çıkarıp yeniden kurmak (kaba kuvvet)
//  3) fitSec en küçük medyan hatalı λ'yı seçer ve tabloyu doldurur
//  4) CV sızdırmaz (sabit terim her katta yeniden kestirilir)
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const yol = new URL("../static/re_yama.js", import.meta.url);
const ctx = vm.createContext({ document: { createElement: () => ({ getContext: () => ({}) }) }, Math, Float32Array, Float64Array, Map, Number, Array, Error });
vm.runInContext(fs.readFileSync(yol, "utf8"), ctx);
const { ReRidge, REY, rerHazirla, rerCekirdek, rerGrupLOO, rerCholesky, rerCoz, rerKesitNorm, REY_KESITLER } =
  vm.runInContext("({ ReRidge, REY, rerHazirla, rerCekirdek, rerGrupLOO, rerCholesky, rerCoz, rerKesitNorm, REY_KESITLER })", ctx);

let tohum = 7; const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
assert.equal(REY.BOY, 1652); assert.equal(REY.LM.length, 15); assert.equal(new Set(REY.BS).size, 22);

// 1) dual = primal
{
  const n = 40, p = 6, F = [], Y = [];
  for (let i = 0; i < n; i++) { const f = Array.from({ length: p }, rnd); F.push(f); Y.push([3 * f[0] - 2 * f[1] + 0.1 * rnd(), f[2] + f[3]]); }
  const m = new ReRidge().fit(F, Y, 1.5);
  const Z = F.map((f) => f.map((v, j) => (v - m.mu[j]) / m.sd[j]));
  for (const c of [0, 1]) {
    const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => Z.reduce((s, z) => s + z[a] * z[b], 0) + (a === b ? 1.5 : 0)));
    const B = Array.from({ length: p }, (_, a) => Z.reduce((s, z, i) => s + z[a] * (Y[i][c] - m.my[c]), 0));
    for (let k = 0; k < p; k++) for (let r = 0; r < p; r++) if (r !== k) { const f = A[r][k] / A[k][k]; for (let q = 0; q < p; q++) A[r][q] -= f * A[k][q]; B[r] -= f * B[k]; }
    const fark = Math.max(...B.map((b, j) => Math.abs(b / A[j][j] - m.b[c][j])));
    assert.ok(fark < 1e-8, `dual-primal farkı ${fark}`);
  }
  console.log("1) dual = primal: tamam");
}

// 2) gruplu LOO özdeşliği = kaba kuvvet
{
  const n = 36, p = 50, F = [], Y = [], grup = [];
  for (let i = 0; i < n; i++) { const g = i % 6; grup.push(g); const f = Array.from({ length: p }, () => rnd() + 0.3 * g); F.push(f); Y.push([100 * g + 5 * rnd(), 50 * (g % 3) + 5 * rnd()]); }
  const H = rerHazirla(F), K = rerCekirdek(H.X, n, H.p), my = [0, 1].map((c) => Y.reduce((s, y) => s + y[c], 0) / n);
  const Yc = Y.map((y) => [y[0] - my[0], y[1] - my[1]]), lam = 3.7;
  const gruplar = [0, 1, 2, 3, 4, 5].map((g) => grup.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0));
  const { artik } = rerGrupLOO(K, n, Yc, gruplar, lam);
  let enFark = 0;
  for (const G of gruplar) {
    const D = [...Array(n).keys()].filter((i) => !G.includes(i)), m = D.length;
    const A = new Float64Array(m * m); D.forEach((i, u) => D.forEach((j, v) => (A[u * m + v] = K[i * n + j] + (u === v ? lam : 0))));
    rerCholesky(A, m);
    const a = [0, 1].map((c) => rerCoz(A, m, D.map((i) => Yc[i][c])));
    for (const i of G) for (const c of [0, 1]) {
      const yhat = D.reduce((s, j, v) => s + K[i * n + j] * a[c][v], 0);
      enFark = Math.max(enFark, Math.abs((Yc[i][c] - yhat) - artik[i][c]));
    }
  }
  assert.ok(enFark < 1e-6, `LOO özdeşlik farkı ${enFark}`);
  console.log(`2) gruplu LOO özdeşliği = yeniden kurma: tamam (en büyük fark ${enFark.toExponential(2)})`);

  // 3) fitSec
  let bekleN = 0; const m = await new ReRidge().fitSec(F, Y, grup, undefined, async () => { bekleN++; });
  assert.equal(bekleN, 5);
  assert.equal(m.secim.tablo.length, 5); assert.equal(m.secim.grup, 6); assert.equal(m.secim.peff, p);
  const enIyi = m.secim.tablo.reduce((a, b) => (b.medyan < a.medyan ? b : a));
  assert.equal(m.lam, enIyi.lam);
  const tek = new ReRidge().fit(F, Y, m.lam), q1 = m.predict(F[0]), q2 = tek.predict(F[0]);
  assert.ok(Math.abs(q1[0] - q2[0]) < 1e-6 && Math.abs(q1[1] - q2[1]) < 1e-6, "fitSec modeli seçilen λ ile fit'e eşit değil");
  console.log(`3) fitSec: λ ${m.lam} seçildi; ${m.secim.tablo.map((t) => `${t.carpan}:${t.medyan.toFixed(1)}`).join(" ")} px`);

  // 5) ders sayfasına aktarım: JSON'a yazılıp geri yüklenen model aynı tahmini verir (eğitim satırları olmadan)
  const geri = ReRidge.from(JSON.parse(JSON.stringify(m)));
  assert.equal(geri.X, undefined);
  for (const f of F.slice(0, 5)) { const a = m.predict(f), b = geri.predict(f); assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, "JSON gidiş-dönüşte tahmin değişti"); }
  console.log("5) JSON gidiş-dönüş: aynı tahmin");
}

// 4) CV sızdırmaz: öznitelik hedefle ilgisizken (her noktanın rastgele imzası) dışarıda bırakılan noktanın hatası küçük çıkmamalı.
//    Sabit terim katta yeniden kestirilmezse en küçük λ'da ~1 px çıkıyordu (Σ yc = 0 kısıtı hedefi geri veriyor).
{
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const p = 300, F = [], Y = [], G = [];
  for (let g = 0; g < 9; g++) {
    const imza = Array.from({ length: p }, gauss), y = [320 + 960 * (g % 3), 240 + 480 * Math.floor(g / 3)];
    for (let r = 0; r < 8; r++) { F.push(imza.map((v) => v + 0.3 * gauss())); Y.push(y); G.push(g); }
  }
  const m = await new ReRidge().fitSec(F, Y, G);
  const enKucuk = Math.min(...m.secim.tablo.map((t) => t.medyan));
  assert.ok(enKucuk > 300, `ilgisiz öznitelikte CV hatası ${enKucuk.toFixed(0)} px (sızıntı)`);
  console.log(`4) CV sızdırmaz: ilgisiz öznitelikte en küçük CV hatası ${enKucuk.toFixed(0)} px`);
}

// 5) göz kesiti parlaklık normalleştirmesi (27.11): kesit kendi ort/sd'siyle ölçeklenir, diğer sütunlara dokunulmaz;
//    kesitlerle eğitilen model kesite eklenen parlaklık (a·x + b) değişiminde AYNI tahmini verir; kn kayıtla taşınır;
//    kn'siz (eski) model ham kesitle tahmin eder
{
  assert.deepEqual(JSON.parse(JSON.stringify(REY_KESITLER)), [[52, 800], [852, 800]]);
  const f = [5, 7, 1, 2, 3, 4, 9, 9];
  const g = rerKesitNorm(f, [[2, 4], [6, 2]]);
  assert.equal(g[0], 5); assert.equal(g[1], 7);
  assert.ok(Math.abs(g[2] + g[3] + g[4] + g[5]) < 1e-6);
  assert.ok(Math.abs((g[2] ** 2 + g[3] ** 2 + g[4] ** 2 + g[5] ** 2) / 4 - 1) < 1e-5);
  assert.equal(g[6], 0); assert.equal(g[7], 0);                     // düz kesit → 0
  assert.deepEqual(rerKesitNorm(f, null), f); assert.equal(f[2], 1);  // kesit yoksa aynısı; girdi değişmez
  const kes = [[2, 6]], F = [], Y = [], Gr = [];
  for (let i = 0; i < 60; i++) {
    const u = rnd(), v = rnd(), k = Array.from({ length: 6 }, (_, j) => 0.3 + 0.2 * Math.sin(j + 6 * u) + 0.1 * v * j + 0.01 * rnd());
    F.push([u, v, ...k]); Y.push([1000 * u, 600 * v]); Gr.push(i % 6);
  }
  const m = await new ReRidge().fitSec(F, Y, Gr, undefined, null, null, kes);
  assert.deepEqual(JSON.parse(JSON.stringify(m.kn)), [[2, 6]]);
  const aydin = (h) => [h[0], h[1], ...h.slice(2).map((x) => 1.3 * x + 0.12)];   // ekran ışığı: kazanç + parlaklık
  for (const h of F.slice(0, 5)) {
    const a = m.predict(h), b = m.predict(aydin(h));
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3, `parlaklık tahmini değiştirdi: ${a} / ${b}`);
  }
  const m2 = ReRidge.from(JSON.parse(JSON.stringify(m)));
  assert.ok(Math.hypot(...m2.predict(aydin(F[0])).map((q, i) => q - m.predict(F[0])[i])) < 1e-3);
  const eski = await new ReRidge().fitSec(F, Y, Gr);                  // kesitsiz: eski davranış, kn yok
  assert.equal(eski.kn, null);
  const e2 = ReRidge.from({ ...JSON.parse(JSON.stringify(eski)), kn: undefined });   // 27.11 öncesi kayıt (kn alanı yok)
  assert.deepEqual([...e2.predict(F[1])], [...eski.predict(F[1])]);
}
console.log("TAMAM");

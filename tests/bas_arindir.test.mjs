// Baş etkisini çıkarma (static/bas_arindir.js) denetimi. Çalıştırma: node tests/bas_arindir.test.mjs
//  1) bilinen eğimi geri bulur: göz sabitken öznitelik = bakış + B·poz + gürültü → çıkarınca noktalar arası poz etkisi kalkar
//  2) noktalar arası bakış farkı eğime karışmaz (grup içi merkezleme): bakış ile poz noktadan noktaya birlikte değişse bile
//  3) haric sütunlara dokunulmaz; poz yoksa / boy uymuyorsa null
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ Math, Float32Array, Float64Array, Number, Array, Object });
vm.runInContext(fs.readFileSync(new URL("../static/bas_arindir.js", import.meta.url), "utf8"), ctx);
const { basPoz, basEtkisiOgren, basCikar } = vm.runInContext("({ basPoz, basEtkisiOgren, basCikar })", ctx);

let tohum = 7; const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const d = 12, k = 6;
const Bgercek = Array.from({ length: k }, () => Array.from({ length: d }, () => gauss()));
const kare = (bakis, p) => Array.from({ length: d }, (_, j) => bakis[j] + Bgercek.reduce((s, row, a) => s + row[j] * p[a], 0) + 0.01 * gauss());

// 1) + 2): 3 nokta; her noktada bakış sabit, poz noktanın ortalaması (noktadan noktaya çok farklı) etrafında değişir
{
  const noktalar = [0, 1, 2].map((i) => ({ bakis: Array.from({ length: d }, () => 5 * gauss()), pOrt: Array.from({ length: k }, () => 10 * (i - 1) + gauss()) }));
  const gruplar = noktalar.map(({ bakis, pOrt }) => {
    const P = Array.from({ length: 80 }, () => pOrt.map((m) => m + 3 * gauss()));
    return { X: P.map((p) => kare(bakis, p)), P };
  });
  const E = basEtkisiOgren(gruplar, { lam: 1e-4 });
  assert.ok(E && E.n === 240 && E.grup === 3);
  // eğim (ham poz birimine çevrilmiş) gerçeğe yakın
  let enCok = 0;
  for (let a = 0; a < k; a++) for (let j = 0; j < d; j++) enCok = Math.max(enCok, Math.abs(E.B[a][j] / E.sd[a] - Bgercek[a][j]));
  assert.ok(enCok < 0.02, `eğim hatası ${enCok}`);
  // aynı bakış, çok farklı iki poz → çıkarınca neredeyse aynı vektör
  const bakis = noktalar[0].bakis, p1 = [5, -3, 2, 1, 0, 4], p2 = [-6, 4, -1, -2, 3, -5];
  const a1 = basCikar(E, kare(bakis, p1), p1), a2 = basCikar(E, kare(bakis, p2), p2);
  const fark = Math.max(...a1.map((v, j) => Math.abs(v - a2[j]))), ham = Math.max(...kare(bakis, p1).map((v, j) => Math.abs(v - kare(bakis, p2)[j])));
  assert.ok(fark < 0.2 && ham > 5, `çıkarılmış fark ${fark}, ham fark ${ham}`);
}

// 3) haric, eksikler
{
  const P = Array.from({ length: 40 }, () => Array.from({ length: k }, () => gauss()));
  const E = basEtkisiOgren([{ X: P.map((p) => kare(new Array(d).fill(0), p)), P }], { haric: [0, 3] });
  for (let a = 0; a < k; a++) { assert.equal(E.B[a][0], 0); assert.equal(E.B[a][3], 0); }
  const v = kare(new Array(d).fill(0), P[0]), o = basCikar(E, v, P[0]);
  assert.ok(Math.abs(o[0] - v[0]) < 1e-5 && Math.abs(o[3] - v[3]) < 1e-5);
  assert.equal(basCikar(E, v, null), null);
  assert.equal(basCikar(E, v.slice(1), P[0]), null);
  assert.equal(basCikar(null, v, P[0]), null);
  assert.equal(basEtkisiOgren([{ X: [v, v], P: [P[0], P[1]] }]), null);   // grup başına en az 3 kare
  assert.deepEqual([...basPoz({ pose3: { yaw: 1, pitch: 2, roll: 3, tx: 4, ty: 5, tz: 6 } })], [1, 2, 3, 4, 5, 6]);
  assert.equal(basPoz({ pose3: { yaw: 1, pitch: NaN, roll: 3, tx: 4, ty: 5, tz: 6 } }), null);
  assert.equal(basPoz({}), null);
}
console.log("TAMAM");

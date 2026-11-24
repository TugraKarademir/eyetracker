// Karma model (static/karma.js + re_yama.js grup ağırlığı) denetimi. Çalıştırma: node tests/karma.test.mjs
//  1) standartlaştırma + grup ağırlığı: her grup çekirdeğe toplam varyans 1 katar (boyutu ne olursa olsun); ağırlıksız hâl değişmedi
//  2) bilinen doğrusal ilişkiyi geri bulur (gruplu, ölçekleri çok farklı sütunlar; λ gruplu CV ile)
//  3) grup ağırlığı boyut farkını dengeler: bilgi küçük grupta, büyük grup gürültü iken ağırlıklı model ağırlıksızdan iyi
//  4) eksik grup (3B baş dahil) olan kare atlanır ve sayılır; 5 ağırlık grubu; satır üst sınırı ve tekrar (w)
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ document: { createElement: () => ({ getContext: () => ({}) }) }, Math, Float32Array, Float64Array, Int8Array, Map, Number, Array, Object, Error });
for (const f of ["re_yama.js", "karma.js"]) vm.runInContext(fs.readFileSync(new URL(`../static/${f}`, import.meta.url), "utf8"), ctx);
const { ReRidge, REY, rerHazirla, karmaOznitelik, karmaSutunGrup, karmaEkle, karmaSatirlar, karmaKurSaf, karmaTahmin } =
  vm.runInContext("({ ReRidge, REY, rerHazirla, karmaOznitelik, karmaSutunGrup, karmaEkle, karmaSatirlar, karmaKurSaf, karmaTahmin })", ctx);

let tohum = 11; const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const med = (A) => { const s = [...A].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// 1) standartlaştırma + grup ağırlığı
{
  const n = 30, boy = [3, 40, 200], p = boy.reduce((a, b) => a + b), olcek = [1000, 1, 0.01];
  const sg = []; boy.forEach((b, g) => { for (let k = 0; k < b; k++) sg.push(g); });
  const F = Array.from({ length: n }, () => sg.map((g) => 5 + olcek[g] * gauss()));
  F.forEach((f) => (f[p - 1] = 7));   // sabit sütun: sayılmaz, 0 kalır
  const H = rerHazirla(F, sg);
  assert.equal(H.peff, p - 1); assert.equal(H.iz, 3);
  assert.deepEqual([...H.grupBoy.entries()], [[0, 3], [1, 40], [2, 199]]);
  for (let g = 0; g < 3; g++) {   // grup katkısı: Σ_{j∈g} Σ_i X_ij² / n = 1
    let s = 0; for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) if (sg[j] === g) s += H.X[i * p + j] ** 2;
    assert.ok(Math.abs(s / n - 1) < 1e-9, `grup ${g} katkısı ${s / n}`);
  }
  for (let i = 0; i < n; i++) assert.equal(H.X[i * p + p - 1], 0);
  const H0 = rerHazirla(F);   // ağırlıksız: z-skor (her sütun varyans 1), iz = p_eff — RealEye Light davranışı değişmedi
  assert.equal(H0.iz, H0.peff); assert.equal(H0.grupBoy, null);
  let s0 = 0; for (let i = 0; i < n; i++) s0 += H0.X[i * p] ** 2; assert.ok(Math.abs(s0 / n - 1) < 1e-9);
  console.log("1) standartlaştırma + grup ağırlığı (her grup toplam varyans 1, iz = grup sayısı): tamam");
}

// 2) doğrusal ilişkiyi geri bulur
{
  const boy = [4, 30], sg = boy.flatMap((b, g) => Array(b).fill(g)), p = sg.length, olcek = [0.01, 50];
  const ornek = () => sg.map((g) => olcek[g] * gauss());
  const hedef = (f) => [800 + 30000 * f[0] - 20000 * f[1] + 2 * f[5], 400 + 25000 * f[2] - 3 * f[6]];
  const F = [], Y = [], G = [];
  for (let g = 0; g < 12; g++) for (let r = 0; r < 6; r++) { const f = ornek(); F.push(f); Y.push(hedef(f)); G.push(g); }
  const m = await new ReRidge().fitSec(F, Y, G, undefined, null, sg);
  assert.equal(m.secim.iz, 2); assert.equal(m.secim.tablo.length, 5);
  const enIyi = m.secim.tablo.reduce((a, b) => (b.medyan < a.medyan ? b : a)); assert.equal(m.lam, enIyi.lam);
  const E = Array.from({ length: 50 }, () => { const f = ornek(), q = m.predict(f), y = hedef(f); return Math.hypot(q[0] - y[0], q[1] - y[1]); });
  const yay = med(Array.from({ length: 50 }, () => { const y = hedef(ornek()); return Math.hypot(y[0] - 800, y[1] - 400); }));
  assert.ok(med(E) < 0.05 * yay, `yeni örneklerde medyan hata ${med(E).toFixed(1)} px (hedef yayılımı ${yay.toFixed(0)})`);
  // seçilen λ ile fit aynı modeli verir
  const t = new ReRidge().fit(F, Y, m.lam, sg), q1 = m.predict(F[0]), q2 = t.predict(F[0]);
  assert.ok(Math.abs(q1[0] - q2[0]) < 1e-6 && Math.abs(q1[1] - q2[1]) < 1e-6);
  console.log(`2) doğrusal ilişki geri bulundu: yeni örneklerde medyan hata ${med(E).toFixed(1)} px (yayılım ${yay.toFixed(0)} px), λ ${m.lam}`);
}

// 3) grup ağırlığı boyut farkını dengeler
{
  const boy = [3, 600], sg = boy.flatMap((b, g) => Array(b).fill(g)), p = sg.length;
  const ornek = () => sg.map(() => gauss());
  const hedef = (f) => [500 + 200 * f[0] + 100 * f[1], 300 + 150 * f[2]];   // bilgi yalnız 3 sütunluk grupta
  const F = [], Y = [], G = [];
  for (let g = 0; g < 10; g++) for (let r = 0; r < 6; r++) { const f = ornek(); F.push(f); Y.push(hedef(f)); G.push(g); }
  const T = Array.from({ length: 60 }, ornek), hata = (m) => med(T.map((f) => { const q = m.predict(f), y = hedef(f); return Math.hypot(q[0] - y[0], q[1] - y[1]); }));
  const agirlikli = await new ReRidge().fitSec(F, Y, G, undefined, null, sg), duz = await new ReRidge().fitSec(F, Y, G);
  const ea = hata(agirlikli), ed = hata(duz);
  assert.ok(ea < 0.5 * ed, `ağırlıklı ${ea.toFixed(1)} px, ağırlıksız ${ed.toFixed(1)} px`);
  console.log(`3) grup ağırlığı: bilgi 3 sütunda, 600 sütun gürültü → ağırlıklı ${ea.toFixed(1)} px, ağırlıksız ${ed.toFixed(1)} px`);
}

// 4) eksik grup atlanır; satır üst sınırı; uçtan uca kurulum ve tahmin
{
  const bizOz = (r) => [r[0], r[1], r[2], r[3], (r[4] + r[5]) / 2, r[6], r[7]];
  const kare = (gx, gy, eksik) => {
    const raw = [gx + 0.01 * gauss(), gy + 0.01 * gauss(), gx, gy, 0.3, 0.3, 0.01 * gauss(), 0.01 * gauss()];
    const wgp = Array.from({ length: 120 }, (_, k) => 128 + 40 * (k % 2 ? gx : gy) + 5 * gauss());
    const re = new Float32Array(REY.BOY).map((_, k) => 0.5 + 0.2 * (k % 3 ? gx : gy) + 0.02 * gauss());
    const pose3 = { yaw: 3 * gauss(), pitch: -8 + 3 * gauss(), roll: gauss(), tx: gauss(), ty: gauss(), tz: -45 + 2 * gauss() };
    return { raw, wgp: eksik === "wgp" ? null : wgp, re: eksik === "re" ? null : re, pose3: eksik === "pose3" ? null : pose3 };
  };
  assert.equal(karmaOznitelik(kare(0, 0, "wgp"), bizOz), null);
  assert.equal(karmaOznitelik(kare(0, 0, "re"), bizOz), null);
  assert.equal(karmaOznitelik(kare(0, 0, "pose3"), bizOz), null);
  assert.equal(karmaOznitelik({ ...kare(0, 0), pose3: { yaw: NaN, pitch: 0, roll: 0, tx: 0, ty: 0, tz: 0 } }, bizOz), null);
  assert.equal(karmaOznitelik({ wgp: [1], re: new Float32Array(REY.BOY) }, bizOz), null);
  const k0 = kare(0.1, 0.2), o = karmaOznitelik(k0, bizOz), bas0 = 7 + 120 + REY.BOY;
  assert.equal(o.v.length, bas0 + 6); assert.deepEqual([...o.boy], [7, 120]);
  assert.ok(Math.abs(o.v[bas0] - k0.pose3.yaw) < 1e-4 && Math.abs(o.v[bas0 + 5] - k0.pose3.tz) < 1e-4);   // sıra: yaw, pitch, roll, tx, ty, tz
  const sg = karmaSutunGrup(7, 120);
  assert.equal(sg.length, o.v.length);
  assert.equal(sg[6], 0); assert.equal(sg[7], 1); assert.equal(sg[126], 1); assert.equal(sg[127], 2); assert.equal(sg[127 + 51], 2); assert.equal(sg[127 + 52], 3);
  assert.equal(sg[bas0 - 1], 3); assert.equal(sg[bas0], 4); assert.equal(sg[sg.length - 1], 4);

  const depo = { kareler: [] };
  let atla = 0;
  for (let g = 0; g < 12; g++) {
    const gx = (g % 4) / 3, gy = Math.floor(g / 4) / 2;
    const win = [kare(gx, gy), kare(gx, gy, g === 7 ? "pose3" : null), kare(gx, gy, g % 3 === 0 ? "re" : null), kare(gx, gy, g === 5 ? "wgp" : null)];
    atla += karmaEkle(depo, win, 100 + 1000 * gx, 100 + 600 * gy, `n${g}`, g >= 8 ? 3 : 1, bizOz);
  }
  assert.equal(atla, 6); assert.equal(depo.atlanan, 6); assert.equal(depo.kareler.length, 48 - 6);
  const S = karmaSatirlar(depo.kareler, 1000);
  assert.equal(S.kare, 42); assert.equal(S.F.length, depo.kareler.reduce((s, k) => s + k.w, 0));
  const S2 = karmaSatirlar(depo.kareler, 30);
  assert.ok(S2.F.length <= 30 && S2.kare >= 10, `üst sınır: ${S2.F.length} satır, ${S2.kare} kare`);
  const { model, S: S3 } = await karmaKurSaf(depo.kareler, { enCokSatir: 600 });
  assert.equal(model.secim.iz, 5); assert.equal(S3.F.length, model.n);
  const q = karmaTahmin(model, kare(1 / 3, 0.5), bizOz), y = [100 + 1000 / 3, 400];
  assert.ok(Math.hypot(q[0] - y[0], q[1] - y[1]) < 60, `uçtan uca tahmin ${q.map(Math.round)} ↔ ${y.map(Math.round)}`);
  assert.equal(karmaTahmin(model, kare(0, 0, "re"), bizOz), null);
  await assert.rejects(karmaKurSaf(depo.kareler.slice(0, 5)), /yetersiz kare/);
  console.log(`4) eksik grup: ${atla} kare atlandı; ${S.kare} kare → ${S.F.length} satır (tekrar dahil); üst sınır 30 → ${S2.F.length} satır; uçtan uca tahmin tamam`);
}
console.log("TAMAM");

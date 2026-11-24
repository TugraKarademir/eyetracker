// Isı testi görünüm hesapları (static/isi_testi.js + gazelab_stats.js I-VT) denetimi. Çalıştırma: node tests/isi_testi.test.mjs
//  1) örnekler: yöntem seçimi, kırpma karesi atlanır, t görsel başına göre; wg ayrı dizi
//  2) görsel dışı oranı ve n
//  3) fiksasyon algılama (I-VT): iki sabit bakış kümesi → iki fiksasyon, görsel koordinatı doğru
//  4) sakkad ölçülemez eşiği (13 Hz)
//  5) AOI: TTFF, kalma süresi (boşluk kesimi dahil), bakış payı, fiksasyon ve ziyaret sayısı; bakılmayan bölge
//  6) zaman aralığı süzgeci, Hz, CSV formül koruması
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({ Math, Number, Array, Object, Set, Float32Array, String, Infinity });
for (const f of ["gazelab_stats.js", "isi_testi.js"]) vm.runInContext(fs.readFileSync(new URL(`../static/${f}`, import.meta.url), "utf8"), ctx);
const { ISIT, GL } = vm.runInContext("({ ISIT, GL })", ctx);

// Gösterim dikdörtgeni: pencerede (100,50), 400×200 px. u = (x−100)/400, v = (y−50)/200
const R = { x: 100, y: 50, w: 400, h: 200 };
const uv = (x, y) => [+((x - R.x) / R.w).toFixed(3), +((y - R.y) / R.h).toFixed(3)];
const kare = (t, x, y) => ({ t, k: 0, p: { biz: [x, y, ...uv(x, y)] } });

// 1) örnekler
{
  const g = { bas: 1000, dikdortgen: R, kareler: [kare(1000, 200, 100), { t: 1030, k: 1 }, kare(1060, 210, 100), { t: 1090, k: 0, p: { reL: [1, 2, 0, 0] } }],
              wg: [[1010, 300, 150, ...uv(300, 150)]] };
  assert.deepEqual([...ISIT.yontemler(g)].sort(), ["biz", "reL", "wg"]);
  const S = ISIT.ornekler(g, "biz");
  assert.equal(S.length, 2); assert.equal(S[0].t, 0); assert.equal(S[1].t, 60); assert.equal(S[0].u, 0.25);
  const W = ISIT.ornekler(g, "wg"); assert.equal(W.length, 1); assert.equal(W[0].t, 10); assert.equal(W[0].x, 300);
  console.log("1) örnekler: tamam");
}

// 2) görsel dışı
{
  const S = [{ u: 0.5, v: 0.5 }, { u: -0.1, v: 0.5 }, { u: 0.2, v: 1.2 }, { u: 1, v: 0 }];
  const o = ISIT.gorselDisi(S);
  assert.equal(o.n, 4); assert.equal(o.disari, 2); assert.equal(o.pct, 50);
  assert.equal(ISIT.gorselDisi([]).pct, null);
  console.log("2) görsel dışı oranı: tamam");
}

// 30 Hz (33 ms) örnekler: 0–500 ms (200,100)'de, 600–1100 ms (400,200)'de sabit bakış; arada sıçrama
function ikiKume(adim) {
  const K = [];
  for (let t = 0; t <= 1100; t += adim) {
    if (t <= 500) K.push(kare(t, 200, 100));
    else if (t >= 600) K.push(kare(t, 400, 200));
  }
  return { bas: 0, dikdortgen: R, kareler: K };
}

// 3) fiksasyon algılama
{
  const g = ikiKume(33), S = ISIT.ornekler(g, "biz"), F = ISIT.fiksasyonlar(g, S, GL.ivt);
  assert.ok(Math.abs(F.hz - (S.length - 1) / ((S.at(-1).t - S[0].t) / 1000)) < 1e-9, `hz ${F.hz}`);   // boşluk dahil (n−1)/süre
  // uzun bölümler GL ayarıyla (maxFix 400 ms) parçalanır; her parça kendi kümesinde
  assert.ok(F.fix.length >= 2, `fiksasyon ${F.fix.length}`);
  const A = F.fix.filter((f) => f.end <= 560), B = F.fix.filter((f) => f.start >= 560);
  assert.ok(A.length >= 1 && B.length >= 1 && A.length + B.length === F.fix.length);
  for (const f of A) { assert.ok(Math.abs(f.u - 0.25) < 1e-9 && Math.abs(f.v - 0.25) < 1e-9, `A u,v ${f.u},${f.v}`); }
  for (const f of B) { assert.ok(Math.abs(f.u - 0.75) < 1e-9 && Math.abs(f.v - 0.75) < 1e-9, `B u,v ${f.u},${f.v}`); }
  assert.equal(F.hiz.length, S.length);
  assert.ok(F.sakkadOlculebilir); assert.ok(Array.isArray(F.sakkad));
  // pencere boyutu değişimi: değişimden sonraki fiksasyon yeni dikdörtgenle çevrilir
  const g2 = { ...g, dikdortgenDegisim: [{ t: 560, x: 0, y: 0, w: 800, h: 400 }] };
  const F2 = ISIT.fiksasyonlar(g2, S, GL.ivt), b2 = F2.fix.find((f) => f.start >= 560);
  assert.ok(Math.abs(b2.u - 0.5) < 1e-9 && Math.abs(b2.v - 0.5) < 1e-9);
  console.log(`3) fiksasyon algılama: tamam (${F.fix.length} fiksasyon, ${F.hz.toFixed(1)} Hz)`);
}

// 4) ölçülemez eşiği
{
  const g = ikiKume(100), S = ISIT.ornekler(g, "biz"), F = ISIT.fiksasyonlar(g, S, GL.ivt);   // 10 Hz
  assert.ok(F.hz < ISIT.HZ_SAKKAD); assert.equal(F.sakkadOlculebilir, false); assert.equal(F.sakkad, null);
  const g2 = ikiKume(70), F2 = ISIT.fiksasyonlar(g2, ISIT.ornekler(g2, "biz"), GL.ivt);   // ~14 Hz
  assert.ok(F2.hz >= ISIT.HZ_SAKKAD && F2.sakkadOlculebilir);
  assert.equal(ISIT.fiksasyonlar(g, [], GL.ivt).sakkadOlculebilir, false);   // örnek yok → ölçülemez
  console.log("4) sakkad ölçülemez eşiği (13 Hz): tamam");
}

// 5) AOI metrikleri (elle kurulmuş fiksasyon ve örneklerle; bilinen sonuç)
{
  const r = { u0: 0, v0: 0, u1: 0.5, v1: 0.5 };
  // örnekler: 0,100,200 içeride; 300 dışarıda; 400 içeride; 1400 içeride (önünde 1000 ms boşluk → kesim 300 ms)
  const S = [0, 100, 200, 300, 400, 1400].map((t) => ({ t, u: t === 300 ? 0.9 : 0.2, v: 0.2 }));
  const D = ISIT.ornekSureleri(S);
  assert.deepEqual(D, [100, 100, 100, 100, 300, 100]);   // medyan 100, kesim 3×100
  const F = [{ start: 50, end: 150, u: 0.8, v: 0.8 }, { start: 200, end: 300, u: 0.2, v: 0.2 }, { start: 320, end: 400, u: 0.3, v: 0.1 },
             { start: 500, end: 600, u: 0.9, v: 0.9 }, { start: 700, end: 800, u: 0.1, v: 0.1 }];
  const m = ISIT.aoiMetrik(S, F, r, 0);
  assert.equal(m.n, 6); assert.equal(m.ic, 5); assert.ok(Math.abs(m.pay - 500 / 6) < 1e-9);
  assert.equal(m.kalmaMs, 100 + 100 + 100 + 300 + 100);
  assert.equal(m.ttffMs, 200); assert.equal(m.ttffDurum, "tamam");
  assert.equal(m.fixN, 3); assert.equal(m.fixToplam, 5); assert.equal(m.ziyaret, 2);
  // aralık başı 100 ms ise TTFF ona göre
  assert.equal(ISIT.aoiMetrik(S, F, r, 100).ttffMs, 100);
  // hiç bakılmayan bölge
  const b = ISIT.aoiMetrik(S, F, { u0: 0.4, v0: 0.4, u1: 0.6, v1: 0.6 }, 0);
  assert.equal(b.ttffMs, null); assert.equal(b.ttffDurum, "bakılmadı"); assert.equal(b.fixN, 0); assert.equal(b.ziyaret, 0); assert.equal(b.kalmaMs, 0);
  // veri yok: örnek ve fiksasyon yok
  const y = ISIT.aoiMetrik([], [], r, 0);
  assert.equal(y.pay, null); assert.equal(y.kalmaMs, null); assert.equal(y.ttffDurum, "fiksasyon yok"); assert.equal(y.ziyaret, null);
  console.log("5) AOI: TTFF, kalma, pay, fiksasyon, ziyaret: tamam");
}

// 6) aralık, Hz, CSV
{
  const S = [0, 50, 100, 150, 200].map((t) => ({ t, u: 0.5, v: 0.5 }));
  assert.deepEqual(ISIT.aralik(S, 50, 150).map((s) => s.t), [50, 100, 150]);
  assert.equal(ISIT.hz(S), 20); assert.equal(ISIT.hz(S.slice(0, 1)), null);
  assert.equal(ISIT.csvGuvenli("=1+1"), "'=1+1"); assert.equal(ISIT.csvGuvenli("Bölge"), "Bölge"); assert.equal(ISIT.csvGuvenli(-0.2), -0.2);
  const g = { ad: "=kötü.png", bas: 0, dikdortgen: R, kareler: [kare(0, 200, 100), kare(30, 50, 100)], wg: [] };
  const rows = ISIT.hamSatirlar([g]);
  assert.equal(rows.length, 2); assert.equal(rows[0]["Görsel"], "'=kötü.png"); assert.equal(rows[0]["Görsel içi"], 1); assert.equal(rows[1]["Görsel içi"], 0);
  const d = ISIT.duygular({ bas: 1000, duygu: [{ t: 900 }, { t: 1500, va: [0.1, 0.2] }, { t: 3000 }] }, 0, 1000);
  assert.equal(d.length, 1); assert.equal(d[0].t, 500);
  console.log("6) aralık, Hz, CSV koruması, duygu süzgeci: tamam");
}
console.log("isi_testi: tüm denetimler geçti");

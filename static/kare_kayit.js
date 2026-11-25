// Kare kare kayıt satırı: bakış testi (bakis_test.html kareKaydet) ve ders (student.js) aynı biçimi kullanır.
// Ortak model eğitimi için (kullanıcı kararı 25.11.2026): her MediaPipe karesinin öznitelikleri, zamanı ve görüntü kalitesi.
// Satır anahtarları (yoksa null; uydurma yok):
//  kt = kare zamanı sn (performance saati), ep = aynı an epoch ms, ct = kameranın yakaladığı an epoch ms (rVFC captureTime),
//  pf = kameranın gösterilen kare sayacı (ardışık farkı > 1 → arada kare düştü), q = görüntü kalitesi
//  [yüz parlaklık, kontrast, sol-sağ farkı, netlik, aşırı %, az %, göz şeridi parlaklık, göz şeridi aşırı %],
//  b = kırpma, ac = göz açıklığı, raw = ham vektör, p3 = [yaw,pitch,roll,dist,tx,ty,tz], bs = blendshape (bsAd sırası),
//  ir = iris mm [sağ, sol], y2 = [burun x, y, göz köşesi arası] video px, wg = WebGazer göz yaması, ku = göz küresi açıları,
//  re = göz kesiti (yalnız hesaplandıysa), yok = 1 → bu karede yüz bulunamadı (öznitelik yok)
(function (G) {
  const yuv = (v, d) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));
  const dizi = (a, d) => (Array.isArray(a) || ArrayBuffer.isView(a) ? Array.from(a, (v) => yuv(v, d)) : null);
  const P3 = ["yaw", "pitch", "roll", "dist", "tx", "ty", "tz"];
  // l: gaze.latest ya da yüzsüz kare { t, ep, vm, yok: true }; bsAd: blendshape adlarının sırası; ek: satırın başına konacak alanlar
  // secenek.re: göz kesiti eklensin mi (büyük: kare başına ~1600 sayı)
  function satir(l, bsAd, ek = {}, secenek = {}) {
    const r = { ...ek, kt: yuv(l.t, 4), ep: l.ep ?? null, ct: l.vm?.ct ?? null, pf: l.vm?.pf ?? null, q: dizi(l.q, 1) };
    if (l.yok) { r.yok = 1; return r; }
    const p3 = l.pose3;
    Object.assign(r, { b: l.blink ? 1 : 0, ac: yuv(l.open, 4), raw: dizi(l.raw, 5),
      p3: p3 ? P3.map((k) => yuv(p3[k], 3)) : null,
      bs: l.bs && bsAd ? bsAd.map((k) => yuv(l.bs[k], 4)) : null,
      ir: l.irisMm ? [dizi(l.irisMm.sag, 3), dizi(l.irisMm.sol, 3)] : null,
      y2: l.yuz2d ? [yuv(l.yuz2d.nx, 1), yuv(l.yuz2d.ny, 1), yuv(l.yuz2d.size, 1)] : null,
      wg: dizi(l.wgp, 1), ku: dizi(l.kure, 4) });
    if (secenek.re !== false) r.re = dizi(l.re, 3);
    return r;
  }
  G.KareKayit = { satir, yuv, dizi };
})(globalThis);

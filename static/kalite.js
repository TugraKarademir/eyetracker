// Görüntü kalitesi (kare başına; ölçüm amaçlı, hiçbir modele girmez). Hem sayfada (gaze.js ana yol) hem yüz bulucu işçisinde
// (gaze_worker.js, importScripts) kullanılır. 25.11 denemesi: ana iş parçacığında her karede görüntü okumak (GPU → CPU) işleme hızını
// düşürdü; işçi yolunda bu hesap artık işçide yapılır.

// img: { data: RGBA, width, height }. Döner: [parlaklık ort (0-255), kontrast (std), sol-sağ parlaklık farkı (görüntünün sol yarısı -
// sağ yarısı), netlik (Laplace varyansı), aşırı pozlama % (≥250), az pozlama % (≤10)]; boş görüntüde null.
function gzKalite(img) {
  const { data, width: w, height: h } = img || {};
  if (!data || !(w > 2) || !(h > 2)) return null;
  const n = w * h, L = new Float32Array(n);
  let top = 0, top2 = 0, sol = 0, sag = 0, ac = 0, az = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
    L[i] = v; top += v; top2 += v * v;
    if (i % w < w / 2) sol += v; else sag += v;
    if (v >= 250) ac++; else if (v <= 10) az++;
  }
  const ort = top / n, yarim = Math.floor(w / 2) * h;
  let lt = 0, lt2 = 0, ln = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = L[i - 1] + L[i + 1] + L[i - w] + L[i + w] - 4 * L[i];
    lt += l; lt2 += l * l; ln++;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return [r1(ort), r1(Math.sqrt(Math.max(0, top2 / n - ort * ort))), r1(sol / yarim - sag / (n - yarim)),
          r1(lt2 / ln - (lt / ln) ** 2), r1(100 * ac / n), r1(100 * az / n)];
}

// Yüz ve göz şeridi kalitesi: ctx = 64×64 tuvalin 2B bağlamı (willReadFrequently), src = kare (video/tuval/ImageBitmap),
// p = yüz noktaları kare pikselinde [[x, y], ...] (478), w/h = kare boyutu. Yüz kutusu kare sınırına kırpılır (dışı çizilmez; tuvalde
// önceki karenin pikseli kalmaz). Kare başına bir çizim + bir okuma; göz şeridi aynı okumadan alınır.
// Döner: yüz 6 değer + [göz şeridi parlaklığı, göz şeridi aşırı pozlama %] (gözlük yansıması); yüz kutusu çok küçükse null.
function gzKaliteKesit(ctx, src, p, w, h) {
  const kutu = (ix, pay = 0) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of ix) { const q = p[i]; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return [Math.max(0, x0 - pay), Math.max(0, y0 - pay), Math.min(w, x1 + pay), Math.min(h, y1 + pay)];
  };
  const [fx0, fy0, fx1, fy1] = kutu([10, 152, 234, 454, 1]), fw = fx1 - fx0, fh = fy1 - fy0;
  if (!(fw > 8 && fh > 8)) return null;
  const N = 64;
  ctx.drawImage(src, fx0, fy0, fw, fh, 0, 0, N, N);
  const img = ctx.getImageData(0, 0, N, N), yuz = gzKalite(img);
  const gk = kutu([159, 145, 386, 374]), ep = Math.max(4, gk[3] - gk[1]);
  const [ex0, ey0, ex1, ey1] = kutu([33, 133, 159, 145, 362, 263, 386, 374], ep);
  const X = (x) => Math.max(0, Math.min(N, Math.round((x - fx0) / fw * N))), Y = (y) => Math.max(0, Math.min(N, Math.round((y - fy0) / fh * N)));
  const gx0 = X(ex0), gx1 = X(ex1), gy0 = Y(ey0), gy1 = Y(ey1);
  let goz = null;
  if (gx1 - gx0 > 2 && gy1 - gy0 > 2) {
    const gw = gx1 - gx0, gh = gy1 - gy0, d = new Uint8ClampedArray(gw * gh * 4);
    for (let y = 0; y < gh; y++) d.set(img.data.subarray(4 * ((gy0 + y) * N + gx0), 4 * ((gy0 + y) * N + gx1)), 4 * y * gw);
    goz = gzKalite({ data: d, width: gw, height: gh });
  }
  return yuz ? [...yuz, goz ? goz[0] : null, goz ? goz[4] : null] : null;
}

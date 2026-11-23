// WebGazer.js göz yaması öznitelikleri, MediaPipe yüz noktalarıyla.
// WebGazer 3.5.3 (src/facemesh.mjs + util.mjs getEyeFeats) ile aynı adımlar:
//   1) göz kutusu: üst kapak yayının (Upper0) en küçük x,y'si -> alt kapak yayının (Lower0) en büyük x,y'si
//   2) kutu 10x6 piksele küçültülür (tuval drawImage)
//   3) gri ton (0.299 R + 0.587 G + 0.114 B)
//   4) histogram eşitleme (her 5. pikselden histogram)
//   5) önce sol göz, sonra sağ göz: 2 x 60 = 120 değer
// Fark: WebGazer yüzü kendi TF.js yüz ağıyla bulur (ikinci bir sinir ağı, kare hızımızı 3-4 kat düşürüyordu);
// burada aynı göz kutuları zaten çalışan MediaPipe FaceLandmarker noktalarından alınır (ek ağ yok, kare başına <1 ms).
// İndeksler MediaPipe 468 noktalı yüz ağının WebGazer'ın kullandığı annotation listeleri (leftEyeUpper0 vb.).
const WGY = {
  SOL_UST: [466, 388, 387, 386, 385, 384, 398], SOL_ALT: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  SAG_UST: [246, 161, 160, 159, 158, 157, 173], SAG_ALT: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  W: 10, H: 6, ADIM: 5,
};
const wgyTuval = document.createElement("canvas"); wgyTuval.width = WGY.W; wgyTuval.height = WGY.H;
const wgyCtx = wgyTuval.getContext("2d", { willReadFrequently: true });

function wgyHistEsitle(g, adim = WGY.ADIM) {   // WebGazer util.equalizeHistogram
  const hist = new Array(256).fill(0); let n = 0;
  for (let i = 0; i < g.length; i += adim) { hist[g[i]]++; n++; }
  let c = 0; const cdf = hist.map((h) => (c += h));
  return g.map((v) => (cdf[v] * 255) / n);
}
function wgyGoz(video, p, ust, alt) {
  const x0 = Math.round(Math.min(...ust.map((i) => p[i][0]))), y0 = Math.round(Math.min(...ust.map((i) => p[i][1])));
  const x1 = Math.round(Math.max(...alt.map((i) => p[i][0]))), y1 = Math.round(Math.max(...alt.map((i) => p[i][1])));
  const w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  wgyCtx.drawImage(video, x0, y0, w, h, 0, 0, WGY.W, WGY.H);
  const d = wgyCtx.getImageData(0, 0, WGY.W, WGY.H).data, g = [];
  for (let i = 0; i < d.length; i += 4) g.push(Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]));
  return wgyHistEsitle(g);
}
// p: video pikselinde yüz noktaları [[x,y],...] (gaze.js onLandmarks kancası). 120 değer ya da null.
function wgYama(video, p) {
  if (!p || p.length < 468) return null;
  const sol = wgyGoz(video, p, WGY.SOL_UST, WGY.SOL_ALT), sag = wgyGoz(video, p, WGY.SAG_UST, WGY.SAG_ALT);
  return sol && sag ? [...sol, ...sag] : null;
}

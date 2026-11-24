// GazeLab istatistikleri (gazelab: yerel webcam göz izleme platformu) — bakış testine taşındı.
// Kaynak: gazelab/static/participant.html (doğrulama, kayma düzeltmesi, cihaz bilgisi), headpose.js (baş pozu sınırları),
// analysis.js (I-VT fiksasyon filtresi), datachart.js (örnekleme hızı, baş özeti). Hesaplar aynı tanımlarla:
//  doğruluk  = her doğrulama noktasında tahminlerin ortalamasının hedefe uzaklığı, noktalar üzerinden ORTALAMA (px)
//  kesinlik  = her noktada tahminlerin kendi ortalamalarına RMS uzaklığı (titreşim), noktalar üzerinden ortalama (px)
//  düzeltme  = eksen başına x' = a·x + b (en küçük kareler, a 0,7–1,5 ile sınırlı), aynı 5 noktadan
const GL = (() => {
  const VAL_PTS = [[.5, .5], [.2, .2], [.8, .2], [.8, .8], [.2, .8]];   // gazelab doğrulama noktaları (pencere oranı)
  const VAL = { SETTLE: 900, COLLECT: 1500, MAX_ERR: 250 };           // ms, ms, eşik px (üstündeyse yeniden kalibrasyon önerilir)
  const DEG_PER_PX = 0.0213;   // gazelab varsayımı: 1 css px ≈ 0,0213° (96 dpi, kol mesafesi) — ölçüm değil tahmin
  const IVT_DEFAULTS = { noiseWin: 200, minFix: 80, maxFix: 400, velThr: 30, maxSacc: 150 };
  const LIMITS = { angle: 12, scale: 15, shift: 35 };                 // baş: ±12°, mesafe ±%15, yüz genişliğinin %35'i kayma

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // Bir doğrulama noktası: pts [[x,y],...], hedef (tx,ty)
  function pointStats(pts, tx, ty) {
    if (!pts.length) return null;
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
    return { mx, my, tx, ty, n: pts.length, err: Math.hypot(mx - tx, my - ty),
             prec: Math.sqrt(mean(pts.map((p) => (p[0] - mx) ** 2 + (p[1] - my) ** 2))) };
  }
  // gazelab runValidation'daki doğrusal kayma düzeltmesi
  function fitCorrection(pairs) {
    if (pairs.length < 3) return null;
    const fit = (p, t) => {
      const n = p.length, mp = mean(p), mt = mean(t);
      let cov = 0, v = 0; for (let i = 0; i < n; i++) { cov += (p[i] - mp) * (t[i] - mt); v += (p[i] - mp) ** 2; }
      const a = v > 1 ? Math.min(1.5, Math.max(0.7, cov / v)) : 1;
      return [a, mt - a * mp];
    };
    const [ax, bx] = fit(pairs.map((q) => q.mx), pairs.map((q) => q.tx));
    const [ay, by] = fit(pairs.map((q) => q.my), pairs.map((q) => q.ty));
    return { ax, bx, ay, by };
  }
  const apply = (c, p) => (c && p ? [c.ax * p[0] + c.bx, c.ay * p[1] + c.by] : p);
  // Noktalar → gazelab özeti (+ medyan ve derece tahmini)
  function summarize(points) {
    const P = points.filter(Boolean);
    if (!P.length) return null;
    const acc = mean(P.map((q) => q.err)), prec = mean(P.map((q) => q.prec));
    const s = [...P.map((q) => q.err)].sort((a, b) => a - b), k = s.length >> 1;
    const corr = fitCorrection(P);
    const corrAcc = corr ? mean(P.map((q) => Math.hypot(corr.ax * q.mx + corr.bx - q.tx, corr.ay * q.my + corr.by - q.ty))) : null;
    return { acc, prec, med: s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2, nPts: P.length, nSamples: P.reduce((a, q) => a + q.n, 0),
             accDeg: acc * DEG_PER_PX, precDeg: prec * DEG_PER_PX, corr, corrAcc, good: acc <= VAL.MAX_ERR,
             points: P.map((q) => ({ tx: Math.round(q.tx), ty: Math.round(q.ty), mx: Math.round(q.mx), my: Math.round(q.my), err: Math.round(q.err), prec: Math.round(q.prec), n: q.n })) };
  }

  // ---- Baş pozu (headpose.js tanımları; açı MediaPipe 3B matrisinden, kayma/ölçek yüz noktalarından)
  function headSample(l) {
    if (!l?.pose3 || !l.yuz2d) return null;
    return { yaw: l.pose3.yaw, pitch: l.pose3.pitch, roll: l.pose3.roll, size: l.yuz2d.size, nx: l.yuz2d.nx, ny: l.yuz2d.ny };
  }
  function headAverage(list) {
    if (!list.length) return null;
    const o = {}; for (const f of ["yaw", "pitch", "roll", "size", "nx", "ny"]) o[f] = mean(list.map((p) => p[f]));
    return o;
  }
  function headDelta(p, base) {
    if (!p || !base) return null;
    return { yaw: p.yaw - base.yaw, pitch: p.pitch - base.pitch, roll: p.roll - base.roll,
             scale: p.size / base.size * 100, shift: Math.hypot(p.nx - base.nx, p.ny - base.ny) / base.size * 100 };
  }
  // satır: [t, yaw°, pitch°, roll°, mesafe %, kayma %] (gazelab recordings.head biçimi)
  const headOut = (h) => Math.abs(h[1]) > LIMITS.angle || Math.abs(h[2]) > LIMITS.angle || Math.abs(h[3]) > LIMITS.angle ||
    Math.abs(h[4] - 100) > LIMITS.scale || h[5] > LIMITS.shift;
  function headSummary(rows) {
    if (!rows?.length) return null;
    const mx = (i) => Math.max(...rows.map((r) => Math.abs(r[i])));
    return { n: rows.length, outPct: rows.filter(headOut).length / rows.length * 100, yaw: mx(1), pitch: mx(2), roll: mx(3), dist: mean(rows.map((r) => r[4])) };
  }

  // ---- I-VT fiksasyon filtresi (analysis.js ivt; koordinatlar doğrudan pencere pikseli)
  function ivt(raw, opts) {
    const o = Object.assign({}, IVT_DEFAULTS, opts || {}), n = raw.length;
    if (n < 3) return { fixations: [], saccades: [], opts: o, hiz: [] };
    const t = raw.map((p) => p[0]), sx = raw.map((p) => p[1]), sy = raw.map((p) => p[2]);
    const half = o.noiseWin / 2, fx = new Array(n), fy = new Array(n);
    const med = (arr) => { arr.sort((p, q) => p - q); const m = arr.length >> 1; return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2; };
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      while (b < n && t[b] <= t[i] + half) b++;
      while (t[a] < t[i] - half) a++;
      fx[i] = med(sx.slice(a, b)); fy[i] = med(sy.slice(a, b));
    }
    const v = new Array(n).fill(0);
    for (let i = 1; i < n; i++) { const dt = (t[i] - t[i - 1]) / 1000; v[i] = dt > 0 ? Math.hypot(fx[i] - fx[i - 1], fy[i] - fy[i - 1]) * DEG_PER_PX / dt : 0; }
    v[0] = v[1] || 0;
    const fixations = [];
    let i = 0;
    while (i < n) {
      if (v[i] >= o.velThr) { i++; continue; }
      let j = i;
      while (j + 1 < n && v[j + 1] < o.velThr) j++;
      const dur = t[j] - t[i];
      if (dur >= o.minFix) {
        const parts = Math.max(1, Math.ceil(dur / o.maxFix));
        for (let k = 0; k < parts; k++) {
          const ts = t[i] + dur * k / parts, te = t[i] + dur * (k + 1) / parts;
          let cx = 0, cy = 0, c = 0;
          for (let q = i; q <= j; q++) if (t[q] >= ts && (t[q] < te || (k === parts - 1 && t[q] <= te))) { cx += fx[q]; cy += fy[q]; c++; }
          if (c) fixations.push({ start: Math.round(ts), end: Math.round(te), dur: Math.round(te - ts), x: cx / c, y: cy / c, n: c });
        }
      }
      i = j + 1;
    }
    const saccades = [];
    for (let k = 1; k < fixations.length; k++) {
      const p = fixations[k - 1], q = fixations[k], dur = q.start - p.end;
      if (dur > 0 && dur <= o.maxSacc) saccades.push({ dur, amp: Math.hypot(q.x - p.x, q.y - p.y) * DEG_PER_PX });
    }
    return { fixations, saccades, opts: o, hiz: v };   // hiz: örnek başına süzülmüş hız °/s (DEG_PER_PX tahminiyle; ısı testi grafiği için)
  }
  // Bir kaydın gazelab "veri grafiği" özeti
  function recordingSummary(r) {
    const g = r.gaze, span = g.length > 1 ? (g.at(-1)[0] - g[0][0]) / 1000 : 0;
    const I = ivt(g), fixT = I.fixations.reduce((a, f) => a + f.dur, 0);
    const hs = headSummary(r.head);
    return { ornek: g.length, hz: span > 0 ? +((g.length - 1) / span).toFixed(1) : null, sureSn: +(r.rect.exposureMs / 1000).toFixed(2),
             fiksasyon: I.fixations.length, ortFiksasyonMs: I.fixations.length ? Math.round(fixT / I.fixations.length) : null,
             fiksasyonPay: r.rect.exposureMs ? Math.round(100 * fixT / r.rect.exposureMs) : null,
             sakkad: I.saccades.length, ortSakkadMs: I.saccades.length ? Math.round(mean(I.saccades.map((q) => q.dur))) : null,
             ortSakkadDer: I.saccades.length ? +mean(I.saccades.map((q) => q.amp)).toFixed(1) : null,
             basSinirDisiPct: hs ? Math.round(hs.outPct) : null, basMaks: hs ? [Math.round(hs.yaw), Math.round(hs.pitch), Math.round(hs.roll)] : null,
             basOrtMesafePct: hs ? Math.round(hs.dist) : null };
  }

  // participant.html deviceInfo ile aynı alanlar
  function deviceInfo() {
    const ua = navigator.userAgent;
    const type = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
    const browser = (ua.match(/(Edg|OPR|Firefox|Chrome|Safari)\/([\d.]+)/) || []).slice(1, 3).join(" ").replace("Edg", "Edge").replace("OPR", "Opera");
    return { ua, type, browser, screenW: screen.width, screenH: screen.height, viewportW: innerWidth, viewportH: innerHeight,
             windowW: outerWidth, windowH: outerHeight, dpr: devicePixelRatio, lang: navigator.language,
             screenResW: Math.round(screen.width * devicePixelRatio), screenResH: Math.round(screen.height * devicePixelRatio),
             viewportResW: Math.round(innerWidth * devicePixelRatio), viewportResH: Math.round(innerHeight * devicePixelRatio),
             colorDepth: screen.colorDepth, fullscreen: !!document.fullscreenElement };
  }

  return { VAL_PTS, VAL, DEG_PER_PX, IVT_DEFAULTS, LIMITS, pointStats, fitCorrection, apply, summarize,
           headSample, headAverage, headDelta, headOut, headSummary, ivt, recordingSummary, deviceInfo };
})();

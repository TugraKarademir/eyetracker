// Isı testi görünümleri için saf hesaplar (DOM yok). bakis_test.html yükler; birim testi: node tests/isi_testi.test.mjs
// Girdi: ISI.veri.gorseller[i] (bakis_test.html isiTestiAdimi): { bas, bit, sureMs, dikdortgen, dikdortgenDegisim?, kareler: [{t, k, p: {yöntem: [x, y, u, v]}}],
//   wg: [[t, x, y, u, v]], duygu: [{t, fa, hse, va}] }. t = ısı testi aşama saati (ms); burada görselin başına göre (t − bas) kullanılır.
// Fiksasyon: GazeLab I-VT (gazelab_stats.js GL.ivt, 30°/s, aynı ayarlar). Derece/hız GL.DEG_PER_PX varsayımıyla: ölçüm değil TAHMİN.
// Tanımlar (ekranda da yazılır):
//   görsel dışı   = u,v gösterim dikdörtgeninin [0,1] aralığı dışında kalan bakış örneği (ısıya girmez), n = tahminli örnek sayısı
//   TTFF          = aralık başından bölgedeki İLK fiksasyonun başlangıcına kadar geçen süre
//   kalma süresi  = bölge içindeki örneklerin süreleri toplamı; örnek süresi = sonraki örneğe kadar geçen süre, en çok 3 × medyan aralık
//                   (kırpma/yüz kaybı boşluğu sayılmaz); son örnek medyan aralık kadar sayılır
//   bakış payı %  = bölge içindeki örnek / tüm tahminli örnek
//   ziyaret       = bölgedeki ardışık fiksasyon dizileri (arada bölge dışı bir fiksasyon yeni ziyaret başlatır)
//   sakkad        = ardışık iki fiksasyon arasındaki 0 < boşluk ≤ maxSacc (GL ile aynı); örnekleme HZ_SAKKAD altındaysa ölçülemez
const ISIT = (() => {
  const HZ_SAKKAD = 13;   // bunun altında (≈ 77 ms'den seyrek örnek) sakkad süresi/şeridi ölçülemez
  const KESIM_KAT = 3;    // örnek süresi üst sınırı: 3 × medyan örnek aralığı
  const medyan = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const icinde = (u, v, r) => (r ? u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1 : u >= 0 && u <= 1 && v >= 0 && v <= 1);

  // Görselde tahmini olan yöntemler (en az bir örnek)
  function yontemler(g) {
    const s = new Set();
    for (const k of g?.kareler || []) if (k.p) for (const m of Object.keys(k.p)) s.add(m);
    if (g?.wg?.length) s.add("wg");
    return [...s];
  }
  // Bir yöntemin örnekleri: [{t (görsel başından ms), x, y (pencere px), u, v}], zamana göre sıralı
  function ornekler(g, yontem) {
    const bas = g.bas || 0, S = [];
    if (yontem === "wg") for (const r of g.wg || []) S.push({ t: r[0] - bas, x: r[1], y: r[2], u: r[3], v: r[4] });
    else for (const k of g.kareler || []) { const q = k.p?.[yontem]; if (q) S.push({ t: k.t - bas, x: q[0], y: q[1], u: q[2], v: q[3] }); }
    return S.filter((s) => Number.isFinite(s.u) && Number.isFinite(s.v)).sort((a, b) => a.t - b.t);
  }
  const aralik = (S, a, b) => S.filter((s) => s.t >= a && s.t <= b);
  // Örnekleme hızı (Hz) = (n − 1) / süre; n < 2 ya da süre 0 → null
  function hz(S) {
    if (S.length < 2) return null;
    const span = (S[S.length - 1].t - S[0].t) / 1000;
    return span > 0 ? (S.length - 1) / span : null;
  }
  function gorselDisi(S) {
    const n = S.length, disari = S.filter((s) => !icinde(s.u, s.v)).length;
    return { n, disari, pct: n ? (100 * disari) / n : null };
  }
  // t (görsel başından ms) anındaki gösterim dikdörtgeni (pencere boyutu değiştiyse dikdortgenDegisim'den)
  function dikdortgenAn(g, t) {
    let r = g.dikdortgen;
    for (const d of g.dikdortgenDegisim || []) if (d.t - (g.bas || 0) <= t) r = d;
    return r;
  }
  // I-VT (GL.ivt) + görsel koordinatı + sakkad aralıkları. S: ornekler() (aralık süzülmüş olabilir)
  function fiksasyonlar(g, S, ivt) {
    ivt = ivt || (typeof GL !== "undefined" ? GL.ivt : null);
    const H = hz(S), I = ivt(S.map((s) => [s.t, s.x, s.y]));
    const fix = I.fixations.map((f) => {
      const r = dikdortgenAn(g, (f.start + f.end) / 2);
      return { ...f, u: r && r.w ? (f.x - r.x) / r.w : null, v: r && r.h ? (f.y - r.y) / r.h : null };
    });
    const olculebilir = H != null && H >= HZ_SAKKAD;
    let sakkad = null;
    if (olculebilir) {
      sakkad = [];
      for (let k = 1; k < fix.length; k++) {
        const p = fix[k - 1], q = fix[k], dur = q.start - p.end;
        if (dur > 0 && dur <= I.opts.maxSacc) sakkad.push({ start: p.end, end: q.start, dur });
      }
    }
    return { fix, sakkad, sakkadOlculebilir: olculebilir, hz: H, hiz: I.hiz || [], opts: I.opts };
  }
  // Örnek süreleri (kalma süresi için); n < 2 → null
  function ornekSureleri(S) {
    if (S.length < 2) return null;
    const d = []; for (let i = 1; i < S.length; i++) d.push(S[i].t - S[i - 1].t);
    const m = medyan(d), kesim = KESIM_KAT * m;
    return S.map((_, i) => (i < S.length - 1 ? Math.min(S[i + 1].t - S[i].t, kesim) : m));
  }
  // Bölge (AOI) metrikleri. r: {u0, v0, u1, v1} (görsele göre 0–1); S, F aynı aralıktan; a: aralık başı (ms)
  function aoiMetrik(S, F, r, a) {
    const n = S.length, D = ornekSureleri(S);
    let ic = 0, kalma = 0;
    S.forEach((s, i) => { if (icinde(s.u, s.v, r)) { ic++; if (D) kalma += D[i]; } });
    const fIc = F.map((f) => f.u != null && f.v != null && icinde(f.u, f.v, r));
    let ziyaret = 0; fIc.forEach((x, i) => { if (x && !fIc[i - 1]) ziyaret++; });
    const ilk = F.find((_, i) => fIc[i]);
    return { n, ic, pay: n ? (100 * ic) / n : null, kalmaMs: D ? Math.round(kalma) : null,
             fixN: fIc.filter(Boolean).length, fixToplam: F.length, ziyaret: F.length ? ziyaret : null,
             ttffMs: ilk ? ilk.start - a : null, ttffDurum: !F.length ? "fiksasyon yok" : ilk ? "tamam" : "bakılmadı" };
  }
  // Isı haritası yoğunluğu: noktalar [{u, v, w}] (görsel içi), gw×gh ızgara, Gauss çekirdeği (sigma hücre). Float32Array, en büyük değer
  function yogunluk(P, gw, gh, sigma) {
    const G = new Float32Array(gw * gh), R = Math.ceil(3 * sigma), k2 = 2 * sigma * sigma;
    for (const p of P) {
      const cx = p.u * gw, cy = p.v * gh, w = p.w ?? 1;
      for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(gh - 1, Math.ceil(cy + R)); y++)
        for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(gw - 1, Math.ceil(cx + R)); x++) {
          const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2; if (d <= R * R) G[y * gw + x] += w * Math.exp(-d / k2);
        }
    }
    let max = 0; for (const v of G) if (v > max) max = v;
    return { G, max };
  }
  // Duygu örnekleri (aralıkta, görsel başına göre t)
  function duygular(g, a, b) {
    const bas = g.bas || 0;
    return (g.duygu || []).map((r) => ({ ...r, t: r.t - bas })).filter((r) => r.t >= a && r.t <= b);
  }
  // CSV hücresi: elle girilebilen metin (=, +, -, @, sekme, satır başı ile başlayan) formül olarak çalışmasın diye ' ile başlatılır
  const csvGuvenli = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  // Ham bakış satırları: tüm görseller × tüm yöntemler
  function hamSatirlar(gorseller) {
    const rows = [];
    for (const g of gorseller || []) for (const m of yontemler(g)) for (const s of ornekler(g, m))
      rows.push({ "Görsel": csvGuvenli(g.ad), "t ms (görsel başından)": s.t, "Yöntem": m, "x px": s.x, "y px": s.y, u: s.u, v: s.v, "Görsel içi": icinde(s.u, s.v) ? 1 : 0 });
    return rows;
  }

  return { HZ_SAKKAD, KESIM_KAT, medyan, icinde, yontemler, ornekler, aralik, hz, gorselDisi, dikdortgenAn, fiksasyonlar, ornekSureleri, aoiMetrik, yogunluk, duygular, csvGuvenli, hamSatirlar };
})();

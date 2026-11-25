// Ders sırasında bakış hatası ölçümü (kalibrasyondaki sonuçla karşılaştırmak için). Kullanıcı kararı 25.11:
//  1) ders içi kontrol noktası: her ARALIK_DK dakikada bir nokta (bakış testindeki GazeLab adımıyla aynı: 0,9 sn yerleşme + 1,5 sn toplama)
//  2) ders sonu kontrolü: ders bitince 5 nokta (öğrenci "Başla" der; "Atla" da olur)
//  3) tıklama hataları: gaze.js tikAl() (burada yalnız biçimlenir)
//  4) baş/mesafe farkı: kalibrasyondaki ortalama baş pozuna (report.basRef) göre fark
// Ölçüm hiçbir modeli öğretmez/değiştirmez. Hata EKRAN pikseli: doğruluk = tahmin ortalamasının hedefe uzaklığı, medyan = kare
// başına uzaklıkların medyanı, kesinlik = tahminlerin kendi ortalamasına RMS uzaklığı.
(function (G) {
  const O = {
    SETTLE: 900, COLLECT: 1500, ARALIK_DK: 1,   // kullanıcı kararı 25.11: varsayılan dakikada bir (?kontrol=<dk> değiştirir, 0 kapatır)
    // ders içi: sırayla dolaşılır (kenar ve köşeler dahil); ders sonu: bakış testindeki 5 GazeLab noktası
    NOKTA: [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85], [0.85, 0.15], [0.15, 0.85], [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]],
    SON: [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]],
  };
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  const medyan = (a) => { const b = [...a].sort((p, q) => p - q), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : null; };

  // P: [[x, y], …] ekran px; hedef hx, hy
  function istatistik(P, hx, hy) {
    const L = (P || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!L.length) return null;
    const mx = L.reduce((s, p) => s + p[0], 0) / L.length, my = L.reduce((s, p) => s + p[1], 0) / L.length;
    return { n: L.length, ort: [Math.round(mx), Math.round(my)], dogruluk: Math.round(Math.hypot(mx - hx, my - hy)),
             medyan: Math.round(medyan(L.map((p) => Math.hypot(p[0] - hx, p[1] - hy)))),
             kesinlik: Math.round(Math.sqrt(L.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / L.length)) };
  }
  // poz: { yaw, pitch, roll, dist } (derece, cm); ref: kalibrasyon ortalaması. Biri yoksa null.
  function basFark(ref, poz) {
    if (!ref || !poz) return null;
    const o = {};
    for (const k of ["yaw", "pitch", "roll", "dist"]) o[k] = Number.isFinite(ref[k]) && Number.isFinite(poz[k]) ? r1(poz[k] - ref[k]) : null;
    return Object.values(o).some((v) => v != null) ? o : null;
  }
  function pozOrt(L) {
    const P = (L || []).filter(Boolean);
    if (!P.length) return null;
    const o = {};
    for (const k of ["yaw", "pitch", "roll", "dist"]) { const v = P.map((p) => p[k]).filter(Number.isFinite); o[k] = v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null; }
    return o;
  }
  // CSV için düz satır: iç içe nesneler a_b anahtarına, diziler JSON metnine
  function duzlestir(o, on = "", out = {}) {
    for (const [k, v] of Object.entries(o || {})) {
      const ad = on ? `${on}_${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) duzlestir(v, ad, out);
      else out[ad] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
    return out;
  }

  // ---- Tarayıcı: bir noktayı ölç. g: GazeTracker; (x, y) pencere px. Döner: ölçüm öğesi (tur, hedef, kaynaklar, baş, fark …)
  let stilVar = false;
  function stil() {
    if (stilVar || typeof document === "undefined") return; stilVar = true;
    document.head.insertAdjacentHTML("beforeend", `<style>
      .olcum-nokta{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:#facc15;border:3px solid #fff;
        box-shadow:0 0 0 3px rgba(0,0,0,.45);z-index:9000;pointer-events:none;animation:olcumKucul linear forwards}
      @keyframes olcumKucul{from{transform:scale(1.5)}to{transform:scale(.45)}}
      .olcum-etiket{position:fixed;z-index:9001;pointer-events:none;background:rgba(15,20,27,.92);color:#fff;padding:6px 10px;border-radius:8px;
        font-size:14px;white-space:nowrap;transform:translate(-50%,0)}
      .olcum-kart{position:fixed;inset:0;z-index:9002;display:flex;align-items:center;justify-content:center;background:rgba(15,20,27,.88)}
      .olcum-kart>div{background:var(--surface,#fff);color:var(--text,#111);max-width:460px;padding:22px 24px;border-radius:var(--radius,12px);line-height:1.5;font-size:15px}
      .olcum-kart button{margin:14px 8px 0 0}</style>`);
  }
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  // isaret: { tur, sira } — ölçüm sürerken g.olcumHedef'e yazılır (ders sayfası kare kaydına hedefi işaretler):
  // { tur, sira, x, y (pencere px), asama: "yerlesme" | "toplama" }; bitince silinir
  async function noktaOlc(g, x, y, etiket, isaret = null) {
    stil();
    const nokta = document.createElement("div"), et = document.createElement("div");
    nokta.className = "olcum-nokta"; nokta.style.left = x + "px"; nokta.style.top = y + "px"; nokta.style.animationDuration = `${(O.SETTLE + O.COLLECT) / 1000}s`;
    et.className = "olcum-etiket"; et.innerHTML = etiket; et.style.left = x + "px"; et.style.top = (y > innerHeight * 0.7 ? y - 70 : y + 30) + "px";
    document.body.append(nokta, et);
    if (isaret) g.olcumHedef = { ...isaret, x: Math.round(x), y: Math.round(y), asama: "yerlesme" };
    try {
      await bekle(O.SETTLE);
      if (g.olcumHedef) g.olcumHedef.asama = "toplama";
      const t0 = performance.now() / 1000, d0 = { kare: g.diag?.kare ?? 0, yuz: g.diag?.yuz ?? 0 };
      const gor = new Set(), K = [], poz = [];
      const topla = () => {
        for (const h of g.hist || []) if (h.t >= t0 && !gor.has(h)) { gor.add(h); K.push(h); }
        const p = g.latest?.pose3; if (p && !poz.includes(p)) poz.push(p);
      };
      const iv = setInterval(topla, 40);
      await bekle(O.COLLECT); clearInterval(iv); topla();
      const o = g._off(), sx = x + o.x, sy = y + o.y, kay = g.kayma && g.kayma.n ? g.kayma : { x: 0, y: 0 };
      const ana = [], sec = [], gos = [];
      for (const h of K) {
        let a = null; try { a = g.model.predict(h.f); } catch {}
        if (a) ana.push(a);
        if (h.s) { sec.push(h.p); gos.push([h.p[0] + kay.x, h.p[1] + kay.y]); } else if (a) gos.push(a);
      }
      const bas = pozOrt(poz);
      return { hedef: [Math.round(sx), Math.round(sy)], hedefPencere: [Math.round(x), Math.round(y)], ofset: [Math.round(o.x), Math.round(o.y), o.olculdu ? 1 : 0],
               kareIslenen: (g.diag?.kare ?? 0) - d0.kare, kareYuzlu: (g.diag?.yuz ?? 0) - d0.yuz, kareTahmin: K.length,
               model: g.secim?.kod || "biz", kayma: g.kaymaBilgi?.() || null,
               gosterilen: istatistik(gos, sx, sy), secim: g.secim ? istatistik(sec, sx, sy) : null, ana: istatistik(ana, sx, sy),
               bas, basFark: basFark(g.report?.basRef, bas), kalibrasyon: g.report ? { acc: g.report.acc ?? null, gazelab: g.report.gazelab?.acc ?? null, at: g.report.at ?? null, gozluk: g.report.gozluk ?? null } : null };
    } finally { nokta.remove(); et.remove(); if (isaret) g.olcumHedef = null; }
  }
  // Noktaları sırayla ölçer; her öğeye tur, sıra, zaman eklenir. Gösterilen bakış noktası ölçüm boyunca gizlenir.
  async function kontrol(g, noktalar, tur, etiketYap) {
    const dotAcik = !!g.showDot, sonuc = [];
    if (dotAcik) g.setShowDot(false);
    try {
      for (let i = 0; i < noktalar.length; i++) {
        const [u, v] = noktalar[i];
        const m = await noktaOlc(g, Math.round(u * innerWidth), Math.round(v * innerHeight), etiketYap(i, noktalar.length), { tur, sira: i + 1 });
        sonuc.push({ tur, t: Date.now(), sira: i + 1, noktaUV: [u, v], pencere: [innerWidth, innerHeight], tamEkran: !!document.fullscreenElement, ...m });
      }
    } finally { if (dotAcik) g.setShowDot(true); }
    return sonuc;
  }
  // Ders sonu kartı: "Başla" → true; "Atla" → "atla"; sureMs içinde yanıt yoksa → "zaman_asimi"
  function sonKart(metin, sureMs = 60000) {
    stil();
    return new Promise((coz) => {
      const k = document.createElement("div"); k.className = "olcum-kart";
      k.innerHTML = `<div>${metin}<div><button class="btn primary" data-a="1">Başla</button><button class="btn" data-a="0">Atla</button></div></div>`;
      const bitir = (v) => { clearTimeout(z); k.remove(); coz(v); };
      const z = setTimeout(() => bitir("zaman_asimi"), sureMs);
      k.onclick = (e) => { const a = e.target?.dataset?.a; if (a != null) bitir(a === "1" ? true : "atla"); };
      document.body.append(k);
    });
  }
  G.BakisOlcum = { O, istatistik, basFark, pozOrt, duzlestir, medyan, kontrol, sonKart };
})(globalThis);

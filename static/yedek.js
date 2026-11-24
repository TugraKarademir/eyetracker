// Yerel yedek (sınıf testi, 24.11): laboratuvar bilgisayarı her şeyi sunucuya göndermeye devam eder; ayrıca İndirilenler klasörüne
// bir kopya iner (kullanıcı sonra elle siler). Saf kısımlar (CSV metni, dosya adı, satır düzleştirme) node testinde sınanır
// (tests/yedek.test.mjs); indir() yalnız tarayıcıda çalışır. Bellekte tutulur, localStorage kullanılmaz.
(function (G) {
  // CSV formül enjeksiyonu koruması (isi_testi.js csvGuvenli ile aynı kural): = + - @ sekme ya da satır başıyla başlayan metne ' eklenir
  const guvenli = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const hucre = (v) => `"${String(guvenli(v) ?? "").replace(/"/g, '""')}"`;
  // Bölümlü CSV: her bölüm "# başlık" satırı + kendi sütunları; bölümler arasında boş satır. Excel için BOM ve ";" ayırıcı.
  function csvMetni(bolumler) {
    const parca = [];
    for (const { baslik, rows } of bolumler) {
      if (parca.length) parca.push("");
      parca.push(hucre(`# ${baslik}`));
      const R = (rows || []).filter((r) => r && typeof r === "object");
      if (!R.length) { parca.push(hucre("veri yok")); continue; }
      const cols = [...new Set(R.flatMap((r) => Object.keys(r)))];
      parca.push(cols.map(hucre).join(";"));
      for (const r of R) parca.push(cols.map((c) => hucre(r[c])).join(";"));
    }
    return "﻿" + parca.join("\r\n");
  }
  // İç içe nesne → [{Alan: "a.b.c", Değer}] (diziler a.0, a.1 …). null olan alan "null" değil boş değerle yazılır, alan adı kalır.
  function duzSatirlar(o, on = "") {
    const out = [];
    const gez = (v, yol) => {
      if (v !== null && typeof v === "object") {
        const K = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
        if (!K.length) out.push({ Alan: yol, "Değer": "" });
        for (const k of K) gez(v[k], yol ? `${yol}.${k}` : String(k));
      } else out.push({ Alan: yol, "Değer": v == null ? "" : v });
    };
    gez(o, on);
    return out;
  }
  const slug = (s) => (String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/İ/g, "I")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40)) || "adsiz";
  const z = (n) => String(n).padStart(2, "0");
  // dersnabzi_<DERS>_<ad-slug>_<yyyyMMdd_HHmm>_<ek>  (yerel saat)
  function dosyaAdi(ders, ad, tarih, ek) {
    const d = tarih instanceof Date ? tarih : new Date(tarih);
    const zaman = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
    const dk = String(ders ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "DERSYOK";
    return `dersnabzi_${dk}_${slug(ad)}_${zaman}_${ek}`;
  }
  // Öğrencinin /api/metrics gövdesinden ders CSV satırı: yalnız gönderilen alanlar (yoksa boş), uydurma yok
  function dersSatiri(p, t) {
    const h = p?.hse, g = p?.gaze, pay = g?.share && typeof g.share === "object" ? g.share.materyal : undefined;
    const b = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : "");
    const s = (v) => (v == null ? "" : v);
    return { "zaman": new Date(t).toISOString(), "dikkat": s(p?.attention), "enerji": s(p?.energy), "duygu": s(p?.emotion),
             "hse_sinif": s(h?.top), "hse_oran": s(h?.p), "hse_valence": s(h?.valence), "hse_arousal": s(h?.arousal),
             "bakis_bolgesi": s(g?.region), "materyal_payi": s(pay), "bakis_kalibre": b(g?.cal),
             "yuz": b(p?.face), "ekran_disi": b(p?.lookingAway), "gozler_kapali": b(p?.eyesClosed), "sekme_gizli": b(p?.tabHidden) };
  }
  // Tarayıcıda indirme: Blob → <a download>; Blob adresi indirme başladıktan sonra bırakılır
  function indir(icerik, ad, tip) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([icerik], { type: tip }));
    a.download = ad; a.style.display = "none";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  G.DNYedek = { guvenli, csvMetni, duzSatirlar, dosyaAdi, dersSatiri, indir };
})(globalThis);

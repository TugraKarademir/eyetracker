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
  // Yerel saat: "YYYY-MM-DD HH:mm:ss.SSS" (CSV) ve saat farkını taşıyan ISO 8601 (JSON), ör. 2026-11-25T11:00:00.000+03:00
  const ms3 = (n) => String(n).padStart(3, "0");
  function yerelZaman(t) {
    const d = new Date(t);
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${ms3(d.getMilliseconds())}`;
  }
  function yerelIso(t) {
    const d = new Date(t), o = -d.getTimezoneOffset(), a = Math.abs(o);
    return yerelZaman(t).replace(" ", "T") + `${o >= 0 ? "+" : "-"}${z(Math.floor(a / 60))}:${z(a % 60)}`;
  }
  const s_ = (v) => (v == null ? "" : v);
  const b_ = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : "");
  const hucreDeger = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v);
  // İç içe nesne → out[onek_a_b] (diziler JSON metni olarak tek hücre)
  function duzle(o, onek, out) {
    for (const [k, v] of Object.entries(o || {})) {
      const ad = `${onek}_${k}`;
      if (v && typeof v === "object" && !Array.isArray(v)) duzle(v, ad, out);
      else out[ad] = hucreDeger(v);
    }
  }
  // Öğrencinin /api/metrics gövdesinden ders CSV satırı: yalnız gönderilen alanlar (yoksa boş), uydurma yok.
  // İlk sütunlar eski CSV ile aynı (zaman = UTC ISO); ardından bakışın tamamı (her bölge payı, materyal noktaları, sayfa izi),
  // ekran, kurulum (skaler alanlar; cihaz ayrıntısı JSON dosyasında), kalibrasyon raporu, ham ölçüler.
  function dersSatiri(p, t, sunucu) {
    const h = p?.hse, g = p?.gaze, pay = g?.share && typeof g.share === "object" ? g.share.materyal : undefined;
    const s = s_, b = b_;
    const r = { "yerel_zaman": yerelZaman(t), "zaman": new Date(t).toISOString(), "sunucu": sunucu === undefined ? "" : sunucu ?? "bekliyor",
             "dikkat": s(p?.attention), "enerji": s(p?.energy), "duygu": s(p?.emotion),
             "hse_sinif": s(h?.top), "hse_oran": s(h?.p), "hse_valence": s(h?.valence), "hse_arousal": s(h?.arousal),
             "bakis_bolgesi": s(g?.region), "materyal_payi": s(pay), "bakis_kalibre": b(g?.cal),
             "yuz": b(p?.face), "ekran_disi": b(p?.lookingAway), "gozler_kapali": b(p?.eyesClosed), "sekme_gizli": b(p?.tabHidden),
             "bakis_kaba": b(g?.coarse), "bakis_neden": s(g?.why) };
    if (g?.share && typeof g.share === "object") for (const [k, v] of Object.entries(g.share)) r[`share_${k}`] = s(v);
    if (g?.wgShare && typeof g.wgShare === "object") for (const [k, v] of Object.entries(g.wgShare)) r[`wgshare_${k}`] = s(v);
    r.pts_sayisi = Array.isArray(g?.pts) ? g.pts.length : ""; r.pts_json = Array.isArray(g?.pts) ? JSON.stringify(g.pts) : "";
    r.scr_sayisi = Array.isArray(g?.scr) ? g.scr.length : ""; r.scr_json = Array.isArray(g?.scr) ? JSON.stringify(g.scr) : "";
    for (const [k, v] of Object.entries(p?.ekran || {})) if (v == null || typeof v !== "object") r[`ekran_${k}`] = hucreDeger(v);
    for (const [k, v] of Object.entries(p?.kurulum || {})) if (v == null || typeof v !== "object") r[`kur_${k}`] = hucreDeger(v);
    const kal = p?.kal && typeof p.kal === "object" ? p.kal : null;
    r.kal_var = kal ? 1 : 0; r.kal_at = s(kal?.at); r.kal_acc = s(kal?.acc); r.kal_hit3 = s(kal?.hit3);
    if (p?.ham && typeof p.ham === "object") duzle(p.ham, "ham", r);
    return r;
  }
  // Ders yedeği kayıtları ({t, govde, sunucu}) → aynı sütunlu CSV satırları. Bölge payı sütunları ders boyunca görülen bölgelerin
  // birleşimi (alfabetik, bakis_neden'den sonra). O pakette bölge yoksa: kalibreli ve paylı pakette 0 (o pencerede hiç bakılmadı),
  // aksi hâlde boş (bilinmiyor). Diğer eksik alanlar boş.
  function dersCsvSatirlari(kayitlar) {
    const K = (kayitlar || []).filter((k) => k && k.govde && typeof k.govde === "object");
    const R = K.map((k) => dersSatiri(k.govde, k.t, k.sunucu));
    const tum = [...new Set(R.flatMap((r) => Object.keys(r)))];
    const bolge = tum.filter((c) => c.startsWith("share_")).sort(), wg = tum.filter((c) => c.startsWith("wgshare_")).sort();
    const diger = tum.filter((c) => !c.startsWith("share_") && !c.startsWith("wgshare_"));
    const i = diger.indexOf("bakis_neden") + 1;
    const cols = [...diger.slice(0, i), ...bolge, ...wg, ...diger.slice(i)];
    return R.map((r, j) => {
      const g = K[j].govde.gaze;
      const sifir = !!(g && g.cal === true && g.share && typeof g.share === "object" && Object.keys(g.share).length);
      const sifirWg = !!(g && g.wgShare && typeof g.wgShare === "object" && Object.keys(g.wgShare).length);
      const o = {};
      for (const c of cols) o[c] = c in r ? r[c] : c.startsWith("share_") && sifir ? 0 : c.startsWith("wgshare_") && sifirWg ? 0 : "";
      return o;
    });
  }
  // Kayıpsız ders yedeği: gönderilen her gövdenin aynısı, gönderim zamanı (ms, yerel ISO) ve sunucu yanıtı; satır başına bir kayıt
  function dersJson(kayitlar) {
    const K = (kayitlar || []).filter((k) => k && typeof k === "object");
    // kurulum.cihazTam (büyük) her satırda tekrarlanmasın: ilk satırda ve değiştiğinde tam, aksi halde "=onceki"
    let onceki = null;
    const satir = K.map((k, i) => {
      let govde = k.govde;
      const ct = govde?.kurulum?.cihazTam;
      if (ct !== undefined) {
        const m = JSON.stringify(ct);
        if (m === onceki) govde = { ...govde, kurulum: { ...govde.kurulum, cihazTam: "=onceki" } };
        else onceki = m;
      }
      const o = { t: k.t, yerel: yerelIso(k.t), sunucu: k.sunucu ?? "bekliyor", govde };
      if (i === 0) return JSON.stringify({ not: 'govde.kurulum.cihazTam "=onceki" ise bir önceki satırdaki cihazTam ile aynıdır (yinelenmesin diye yazılmadı).', ...o });
      return JSON.stringify(o);
    });
    return "[\n" + satir.join(",\n") + "\n]\n";
  }
  // Tarayıcıda indirme: Blob → <a download>; Blob adresi indirme başladıktan sonra bırakılır
  function indir(icerik, ad, tip) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([icerik], { type: tip }));
    a.download = ad; a.style.display = "none";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  G.DNYedek = { guvenli, csvMetni, duzSatirlar, dosyaAdi, dersSatiri, dersCsvSatirlari, dersJson, yerelZaman, yerelIso, indir };
})(globalThis);

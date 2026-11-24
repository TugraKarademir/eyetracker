"use strict";
// Ayarlar'da seçilen kamera ve çözünürlüğü sayfa pencerelerine uygulayan küçük sarmalayıcı.
//
// Sayfalar (student.js, bakis_test.html, teacher-live.js) getUserMedia'yı kendileri çağırır; uygulama
// sayfalara preload vermez. Bu yüzden sarmalayıcı, sayfanın kendi betikleri çalışmadan önce ana dünyaya
// (main world) eklenir: main.js her sayfa penceresinde CDP "Page.addScriptToEvaluateOnNewDocument" kullanır
// (her yeni belgede, sayfa betiklerinden önce çalışır). Yedek olarak dom-ready'de de çalıştırılır (betik
// tekrar çalışırsa bir şey yapmaz). Sayfaların getUserMedia çağrıları zaten kullanıcı etkileşimiyle
// (rıza/Başlat/Yayını başlat) yapıldığı için iki yol da çağrılardan önce yerindedir.
//
// Yaptığı tek şey: sayfa video istiyor ve kendisi deviceId belirtmemişse
//   - seçili kamera varsa video kısıtına deviceId: {exact} ekler (kamera etiketiyle bulunur; deviceId
//     kökene göre farklı olduğundan başlangıç ekranındaki kimlik sayfada geçersizdir),
//   - çözünürlük seçildiyse width/height'i { ideal } olarak verir.
// Başka hiçbir şey değişmez. Seçili kamera yoksa sayfanın kendi (varsayılan) isteğiyle açılır ve
// konsola "[dn-kamera] secili-kamera-bulunamadi" yazılır; ana süreç bunu başlangıç ekranında uyarı yapar.

const UYARI_IMI = "[dn-kamera] secili-kamera-bulunamadi";

// Bu işlev sayfada çalışır (toString ile aktarılır): dışarıdan hiçbir şeye başvurmaz.
function sarmalayici(cfg) {
  if (typeof window === "undefined" || window.__dnKamera) return;
  if (cfg.koken && location.origin !== cfg.koken) return;
  const durum = { etiket: cfg.etiket || null, cozunurluk: cfg.cozunurluk || null, kaynak: cfg.kaynak || null, uygulandi: 0, eksik: false };
  Object.defineProperty(window, "__dnKamera", { value: durum, enumerable: false });
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") return;
  const asil = md.getUserMedia.bind(md);
  const bildir = () => {
    if (durum.eksik) return;
    durum.eksik = true;
    console.warn(cfg.uyariImi);
  };
  async function eslesen() {
    // enumerateDevices bazı ortamlarda hiç yanıt vermeyebilir: kamera açılışı bunun yüzünden takılmasın.
    let zamanlayici = null;
    const ham = await Promise.race([
      md.enumerateDevices(),
      new Promise((_, red) => {
        zamanlayici = setTimeout(() => red(new Error("enumerateDevices zaman aşımı")), cfg.listeZamanAsimiMs || 3000);
      }),
    ]).finally(() => clearTimeout(zamanlayici));
    const liste = ham.filter((d) => d.kind === "videoinput");
    const m = liste.find((d) => d.label && d.label === cfg.etiket);
    return { id: m ? m.deviceId : null, etiketli: liste.some((d) => !!d.label) };
  }
  const sarili = async function getUserMedia(kisit) {
    const v = kisit && kisit.video;
    if (!v || (typeof v === "object" && "deviceId" in v) || (!cfg.etiket && !cfg.cozunurluk)) return asil(kisit);
    const temel = v === true ? {} : { ...v };
    if (cfg.cozunurluk) {
      temel.width = { ideal: cfg.cozunurluk.w };
      temel.height = { ideal: cfg.cozunurluk.h };
    }
    const ac = (ek) => asil({ ...kisit, video: { ...temel, ...ek } });
    if (!cfg.etiket) return ac({});
    let e = { id: null, etiketli: false };
    try { e = await eslesen(); } catch (_) { /* liste alınamadı: varsayılan */ }
    if (e.id) {
      try {
        const s = await ac({ deviceId: { exact: e.id } });
        durum.uygulandi++;
        return s;
      } catch (err) {
        if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) { bildir(); return ac({}); }
        throw err;
      }
    }
    if (e.etiketli) { bildir(); return ac({}); }
    // Kamera adları henüz görünmüyor (izin öncesi): varsayılanla aç, sonra adlara bakıp gerekirse değiştir.
    const s = await ac({});
    try {
      const e2 = await eslesen();
      if (!e2.id) { if (e2.etiketli) bildir(); return s; }
      const iz = s.getVideoTracks()[0];
      const simdiki = iz && iz.getSettings ? iz.getSettings().deviceId : null;
      if (simdiki === e2.id) { durum.uygulandi++; return s; }
      const s2 = await ac({ deviceId: { exact: e2.id } });
      s.getTracks().forEach((t) => t.stop());
      durum.uygulandi++;
      return s2;
    } catch (_) {
      return s;
    }
  };
  md.getUserMedia = sarili;
}

// cfg: { etiket: string|null, cozunurluk: {w,h}|null, koken: "http://localhost:PORT", kaynak: tanı için etiket }
function kameraBetigi({ etiket = null, cozunurluk = null, koken = null, kaynak = null, listeZamanAsimiMs = 3000 } = {}) {
  const cfg = { etiket: etiket || null, cozunurluk: cozunurluk || null, koken: koken || null, kaynak, listeZamanAsimiMs, uyariImi: UYARI_IMI };
  return `(${sarmalayici.toString()})(${JSON.stringify(cfg)});`;
}

module.exports = { kameraBetigi, UYARI_IMI };

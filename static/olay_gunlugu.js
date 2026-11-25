// Olay günlüğü (bakış testi ve ders): sayfa, pencere, fare/klavye zamanları, kamera ayarı değişimi, işlemci yükü, pil, ağ, bellek.
// Ortak model eğitimi ve sonradan analiz için (kullanıcı kararı 25.11.2026: "alabileceğimiz her şeyi alalım").
// Her olay: [epoch ms, tür, veri?]. Klavyede hangi tuşa basıldığı ALINMAZ (yalnız zaman). Tarayıcının vermediği bilgi yazılmaz (uydurma yok).
// Türler:
//  basla {timeOrigin, saatDilimi, utcFarkDk, yazilim, url yolu}      gorunur 1/0 (sekme)      odak 1/0 (pencere)      tamEkran 1/0
//  pencere [innerW, innerH, outerW, outerH, dpr]                     konum [screenX, screenY]  zoom ölçek (visualViewport, iki parmak)
//  fm [x, y] fare hareketi (en çok 20/sn)   tik [x, y, düğme, pointerType]   kaydir [dx, dy] (tekerlek)   sayfaKaydir [scrollX, scrollY]
//  tus (yalnız zaman)   dokun [x, y]   kamera {değişen ayarlar}   kameraYetenek {aralıklar}   cpu "nominal|fair|serious|critical"
//  pil [düzey 0-1, şarjda 1/0]   ag {effectiveType, downlink, rtt}   cevrimici 1/0   bellek MB (JS yığını)   istek [yol, ms, ok 1/0, bayt]
//  cikis (sayfa kapanıyor)
(function (G) {
  const KAMERA_AYAR = ["width", "height", "frameRate", "resizeMode", "aspectRatio", "exposureMode", "exposureTime", "exposureCompensation",
    "whiteBalanceMode", "colorTemperature", "brightness", "contrast", "saturation", "sharpness", "focusMode", "focusDistance", "zoom", "pan", "tilt",
    "iso", "backgroundBlur", "faceFraming", "torch"];
  const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
  // Kamera ayarlarından kayda değer alt küme (deviceId/groupId gibi kimlik alanları alınmaz)
  function kameraAyarOzet(s) {
    const o = {};
    for (const k of KAMERA_AYAR) if (s && s[k] !== undefined && s[k] !== null) o[k] = r2(s[k]);
    return o;
  }
  // a → b arasında değişen anahtarlar (yeni değerleriyle); değişiklik yoksa null
  function degisenler(a, b) {
    const o = {}; let var_ = false;
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) { o[k] = b?.[k] ?? null; var_ = true; }
    }
    return var_ ? o : null;
  }
  function yetenekOzet(c) {
    const o = {};
    for (const k of KAMERA_AYAR) if (c && c[k] !== undefined) o[k] = Array.isArray(c[k]) ? c[k] : (typeof c[k] === "object" ? { min: r2(c[k].min), max: r2(c[k].max), step: r2(c[k].step) } : c[k]);
    return o;
  }

  const OG = { olaylar: [], gonderilen: 0, EN_COK: 200000, tasma: 0, sayac: {}, basladi: false, _kam: null, _track: null };
  const simdiEp = () => Math.round(performance.timeOrigin + performance.now());
  const evEp = (e) => (e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? Math.round(performance.timeOrigin + e.timeStamp) : simdiEp());
  function ekle(tur, veri, t) {
    OG.sayac[tur] = (OG.sayac[tur] || 0) + 1;
    if (OG.olaylar.length >= OG.EN_COK) { OG.tasma++; return; }
    OG.olaylar.push(veri === undefined ? [t ?? simdiEp(), tur] : [t ?? simdiEp(), tur, veri]);
  }
  // Seyreltme: aynı türden olay en çok her ms'de bir
  const son = {};
  const seyrek = (tur, ms, t) => { if (t - (son[tur] || 0) < ms) return false; son[tur] = t; return true; };

  // yazilim: { kod, mediapipe, model, ... } kayıt yapan sayfa verir
  function baslat({ yazilim = null, track = null } = {}) {
    if (OG.basladi) { if (track) kameraIzle(track); return; }
    OG.basladi = true;
    let tz = null; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
    ekle("basla", { timeOrigin: Math.round(performance.timeOrigin), saatDilimi: tz, utcFarkDk: -new Date().getTimezoneOffset(), yazilim, yol: location.pathname });
    const d = document;
    d.addEventListener("visibilitychange", (e) => ekle("gorunur", d.hidden ? 0 : 1, evEp(e)));
    addEventListener("focus", (e) => ekle("odak", 1, evEp(e)));
    addEventListener("blur", (e) => ekle("odak", 0, evEp(e)));
    d.addEventListener("fullscreenchange", (e) => ekle("tamEkran", d.fullscreenElement ? 1 : 0, evEp(e)));
    let pz = null;
    const pencere = () => ekle("pencere", [innerWidth, innerHeight, outerWidth, outerHeight, r2(devicePixelRatio)]);
    addEventListener("resize", () => { clearTimeout(pz); pz = setTimeout(pencere, 250); });
    pencere();
    if (G.visualViewport) visualViewport.addEventListener("resize", () => { const s = r2(visualViewport.scale); if (s !== OG._zoom) { OG._zoom = s; ekle("zoom", s); } });
    // Fare / dokunma / klavye (yakalama aşamasında: sayfa olayı durdursa da kaydedilir)
    d.addEventListener("pointermove", (e) => { const t = evEp(e); if (seyrek("fm", 50, t)) ekle("fm", [Math.round(e.clientX), Math.round(e.clientY)], t); }, { capture: true, passive: true });
    d.addEventListener("pointerdown", (e) => ekle(e.pointerType === "touch" ? "dokun" : "tik", [Math.round(e.clientX), Math.round(e.clientY), e.button, e.pointerType || null], evEp(e)), { capture: true, passive: true });
    d.addEventListener("wheel", (e) => { const t = evEp(e); if (seyrek("kaydir", 100, t)) ekle("kaydir", [Math.round(e.deltaX), Math.round(e.deltaY)], t); }, { capture: true, passive: true });
    d.addEventListener("scroll", (e) => { const t = evEp(e); if (seyrek("sayfaKaydir", 200, t)) ekle("sayfaKaydir", [Math.round(scrollX), Math.round(scrollY)], t); }, { capture: true, passive: true });
    d.addEventListener("keydown", (e) => ekle("tus", undefined, evEp(e)), { capture: true, passive: true });
    addEventListener("online", () => ekle("cevrimici", 1)); addEventListener("offline", () => ekle("cevrimici", 0));
    addEventListener("pagehide", () => ekle("cikis"));
    // Ağ bilgisi (Chrome/Edge; diğerlerinde yok)
    const c = navigator.connection;
    if (c) { const ag = () => ekle("ag", { effectiveType: c.effectiveType ?? null, downlink: c.downlink ?? null, rtt: c.rtt ?? null, type: c.type ?? null }); ag(); c.addEventListener?.("change", ag); }
    // Pil (Chrome/Edge)
    try { navigator.getBattery?.().then((b) => { const p = () => ekle("pil", [r2(b.level), b.charging ? 1 : 0]); p(); b.addEventListener("levelchange", p); b.addEventListener("chargingchange", p); }).catch(() => {}); } catch {}
    // İşlemci yükü (Compute Pressure; Chrome 125+). Desteklenmezse olay yok.
    try {
      if (typeof PressureObserver === "function") {
        const po = new PressureObserver((kayitlar) => { for (const k of kayitlar) ekle("cpu", k.state, Math.round(performance.timeOrigin + k.time)); });
        po.observe("cpu", { sampleInterval: 2000 }).catch(() => {});
      }
    } catch {}
    // Pencere konumu (olayı yok: 1 sn'de bir bakılır) ve JS yığını (30 sn'de bir; yalnız Chrome)
    let kon = null;
    setInterval(() => {
      const k = `${screenX},${screenY}`; if (k !== kon) { kon = k; ekle("konum", [screenX, screenY]); }
      kameraBak();
    }, 1000);
    if (performance.memory) setInterval(() => ekle("bellek", Math.round(performance.memory.usedJSHeapSize / 1048576)), 30000);
    if (track) kameraIzle(track);
  }
  // Kamera ayarları: başta tamamı + yetenek aralıkları, sonra her saniye bakılır, değişen alanlar yazılır (otomatik pozlama/odak oynaması)
  function kameraIzle(track) {
    if (!track || track === OG._track) return;
    OG._track = track; OG._kam = null;
    try { ekle("kameraYetenek", yetenekOzet(track.getCapabilities?.() || {})); } catch {}
    kameraBak();
  }
  function kameraBak() {
    const tr = OG._track; if (!tr || tr.readyState === "ended") return;
    let s; try { s = kameraAyarOzet(tr.getSettings()); } catch { return; }
    if (!OG._kam) { ekle("kamera", s); OG._kam = s; return; }
    const d = degisenler(OG._kam, s); if (d) { ekle("kamera", d); OG._kam = s; }
  }
  // Sunucu isteği süresi ve sonucu (gönderen sayfa çağırır)
  function istek(yol, ms, ok, bayt) { ekle("istek", [yol, Math.round(ms), ok ? 1 : 0, bayt ?? null]); }
  // Gönderilmemiş olaylar (ders: parti parti gönderim). onayla(n): sunucu aldıysa işaretle.
  function bekleyen(enCok = 5000) { return OG.olaylar.slice(OG.gonderilen, OG.gonderilen + enCok); }
  function onayla(n) { OG.gonderilen += n; if (OG.gonderilen > 20000) { OG.olaylar.splice(0, OG.gonderilen); OG.gonderilen = 0; } }   // gönderilenler bellekten atılır
  function hepsi() { return OG.olaylar.slice(); }
  function ozet() { return { n: OG.olaylar.length, tasma: OG.tasma, sayac: { ...OG.sayac } }; }
  G.OlayGunlugu = { baslat, kameraIzle, ekle, istek, bekleyen, onayla, hepsi, ozet, kameraAyarOzet, degisenler, yetenekOzet, _OG: OG };
})(globalThis);

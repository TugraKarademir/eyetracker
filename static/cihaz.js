// Tam cihaz bilgisi (sınıf testi, 24.11): tarayıcının GERÇEKTEN verdiği kadarı; vermediği null (+ neden). Uydurma yok.
// Bir kez toplanır; bakis_test.html (test kaydı + GazeLab oturumu device.cihazTam) ve student.js (kurulum.cihazTam) kullanır.
// Özet (tarayıcı/sürüm, işletim sistemi, ölçülen fps) sunucuda çıkarılır (server.py cihaz_tam_ozet), tek kaynak orası.
// cihazTamTopla(o, E): o = { track (kullanılan video izi), delegate ("GPU"/"CPU"), isci (bool) }; E = ortam (tarayıcıda globalThis;
// node testinde sahte navigator/screen/... verilir).
(function (G) {
  const SURE_DOLDU = Symbol("sure");
  const s = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : null);
  const say = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ev = (v) => (typeof v === "boolean" ? v : null);
  const hataMetni = (e) => `hata: ${String(e?.message || e).slice(0, 120)}`;
  const sinirli = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(SURE_DOLDU), ms))]);
  // Kamera kimliklerinin kısa özeti (SHA-256 ilk 12 hex): aynı kamera mı ayırt edilir, ham kimlik gönderilmez
  async function oz(metin, E) {
    if (!metin || !E.crypto?.subtle || typeof TextEncoder === "undefined") return null;
    try {
      const b = await E.crypto.subtle.digest("SHA-256", new TextEncoder().encode(metin));
      return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  }
  const marka = (L) => (Array.isArray(L) ? L.slice(0, 16).map((b) => ({ brand: s(b?.brand, 60), version: s(b?.version, 40) })) : null);

  async function tarayici(E) {
    const nav = E.navigator || {}, u = nav.userAgentData;
    const out = { ua: s(nav.userAgent), uaVeri: null, uaYuksek: null, uaYuksekNeden: null };
    if (!u) { out.uaYuksekNeden = "tarayıcı vermez (userAgentData yok)"; return out; }
    out.uaVeri = { brands: marka(u.brands) || [], mobile: ev(u.mobile), platform: s(u.platform, 60) };
    if (typeof u.getHighEntropyValues !== "function") { out.uaYuksekNeden = "tarayıcı vermez"; return out; }
    try {
      const h = await sinirli(u.getHighEntropyValues(["platformVersion", "architecture", "bitness", "model", "fullVersionList", "wow64"]), 2000);
      if (h === SURE_DOLDU) out.uaYuksekNeden = "2 sn içinde yanıt yok";
      else out.uaYuksek = { platformVersion: s(h?.platformVersion, 40), architecture: s(h?.architecture, 40), bitness: s(h?.bitness, 10),
                            model: s(h?.model, 80), wow64: ev(h?.wow64), fullVersionList: marka(h?.fullVersionList) };
    } catch (e) { out.uaYuksekNeden = hataMetni(e); }
    return out;
  }

  async function gpu(E) {
    const out = { webglVendor: null, webglRenderer: null, webglNeden: null, webgl2: null, webgpu: null, webgpuAdapter: null, webgpuNeden: null };
    try {
      const gl = E.document.createElement("canvas").getContext("webgl");
      if (!gl) out.webglNeden = "WebGL yok";
      else {
        const x = gl.getExtension("WEBGL_debug_renderer_info");
        if (x) { out.webglVendor = s(gl.getParameter(x.UNMASKED_VENDOR_WEBGL), 160); out.webglRenderer = s(gl.getParameter(x.UNMASKED_RENDERER_WEBGL), 200); }
        else out.webglNeden = "tarayıcı vermez (WEBGL_debug_renderer_info yok)";
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch (e) { out.webglNeden = hataMetni(e); }
    try {
      const gl2 = E.document.createElement("canvas").getContext("webgl2");
      out.webgl2 = !!gl2; gl2?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { out.webgl2 = null; }
    const g = E.navigator?.gpu;
    out.webgpu = !!g;
    if (!g) { out.webgpuNeden = "WebGPU yok"; return out; }
    try {
      const a = await sinirli(g.requestAdapter(), 2000);
      if (a === SURE_DOLDU) out.webgpuNeden = "2 sn içinde yanıt yok";
      else if (!a) out.webgpuNeden = "bağdaştırıcı verilmedi";
      else {
        let i = a.info;
        if (!i && typeof a.requestAdapterInfo === "function") { i = await sinirli(a.requestAdapterInfo(), 2000); if (i === SURE_DOLDU) i = null; }
        if (i) out.webgpuAdapter = { vendor: s(i.vendor, 80), architecture: s(i.architecture, 80), device: s(i.device, 80), description: s(i.description, 200) };
        else out.webgpuNeden = "bağdaştırıcı bilgisi verilmedi";
      }
    } catch (e) { out.webgpuNeden = hataMetni(e); }
    return out;
  }

  function ekran(E) {
    const sc = E.screen || {}, w = E.window || {};
    return { width: say(sc.width), height: say(sc.height), availWidth: say(sc.availWidth), availHeight: say(sc.availHeight), colorDepth: say(sc.colorDepth),
             dpr: say(w.devicePixelRatio), innerW: say(w.innerWidth), innerH: say(w.innerHeight), outerW: say(w.outerWidth), outerH: say(w.outerHeight),
             tamEkran: E.document ? !!E.document.fullscreenElement : null, genisletilmis: ev(sc.isExtended) };
  }

  async function kamera(track, E) {
    const out = { label: null, ayar: null, yetenek: null, videoGirisSayisi: null, videoGirisEtiketleri: null, neden: null,
                  olculenKaynak: "ölçülen kamera/işleme fps: GazeLab aşama tablosu (Kamera fps (gerçek), İşleme fps) ve öğrenci kurulumu islemeFps; ayar değil" };
    if (!track) out.neden = "kamera izi yok";
    else {
      out.label = s(track.label, 160);
      try {
        const st = track.getSettings?.() || {};
        out.ayar = { width: say(st.width), height: say(st.height), frameRate: say(st.frameRate) != null ? Math.round(st.frameRate * 10) / 10 : null,
                     deviceIdOz: await oz(st.deviceId, E), groupIdOz: await oz(st.groupId, E), facingMode: s(st.facingMode, 30), resizeMode: s(st.resizeMode, 30) };
      } catch (e) { out.neden = hataMetni(e); }
      try {
        const c = track.getCapabilities?.();
        out.yetenek = c ? { maxWidth: say(c.width?.max), maxHeight: say(c.height?.max), maxFrameRate: say(c.frameRate?.max) } : null;
      } catch {}
    }
    try {
      const L = await sinirli(E.navigator.mediaDevices.enumerateDevices(), 2000);
      if (L !== SURE_DOLDU && Array.isArray(L)) {
        const v = L.filter((d) => d.kind === "videoinput");
        out.videoGirisSayisi = v.length; out.videoGirisEtiketleri = v.slice(0, 16).map((d) => s(d.label, 160) || null);
      }
    } catch {}
    return out;
  }

  async function cihazTamTopla(o = {}, E = G) {
    const nav = E.navigator || {}, c = nav.connection;
    let saatDilimi = null; try { saatDilimi = s(Intl.DateTimeFormat().resolvedOptions().timeZone, 60); } catch {}
    const [t, g, k] = await Promise.all([tarayici(E), gpu(E), kamera(o.track || null, E)]);
    const yigin = E.performance?.memory?.jsHeapSizeLimit;
    return {
      surum: 1, zaman: new Date().toISOString(),
      tarayici: t,
      islemci: { mantiksalCekirdek: say(nav.hardwareConcurrency), cpuModel: null, cpuModelNeden: "tarayıcı vermez" },
      bellek: { deviceMemoryGB: say(nav.deviceMemory), bellekNot: say(nav.deviceMemory) != null ? "tarayıcı ≤8 GB'a yuvarlar" : "tarayıcı vermez",
                jsHeapLimitMB: say(yigin) != null ? Math.round(yigin / 1048576) : null },
      gpu: g, ekran: ekran(E), kamera: k,
      ag: c ? { effectiveType: s(c.effectiveType, 20), downlinkMbps: say(c.downlink), rttMs: say(c.rtt), type: s(c.type, 20) } : null,
      diger: { dil: s(nav.language, 20), diller: Array.isArray(nav.languages) ? nav.languages.slice(0, 16).map((x) => s(x, 20)) : null, saatDilimi,
               platform: s(nav.platform, 60), dokunmatikNokta: say(nav.maxTouchPoints), crossOriginIsolated: ev(E.crossOriginIsolated),
               mediapipeDelegate: s(o.delegate, 10), isci: ev(o.isci) },
    };
  }
  G.cihazTamTopla = cihazTamTopla;
})(globalThis);

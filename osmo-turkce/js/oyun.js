/* oyun.js — Harf Avcısı: menü, kamera döngüsü, oyun modları, öğretme ve ayarlar */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const TR = s => s.toLocaleUpperCase('tr-TR');
  const HARFLER = Vision.HARFLER;
  const OSMO_DISI = new Set('ÇĞİÖŞÜ');
  const HARF_ADI = { A: 'a', B: 'be', C: 'ce', Ç: 'çe', D: 'de', E: 'e', F: 'fe', G: 'ge', Ğ: 'yumuşak ge', H: 'he', I: 'ı', İ: 'i', J: 'je', K: 'ke', L: 'le', M: 'me', N: 'ne', O: 'o', Ö: 'ö', P: 'pe', R: 're', S: 'se', Ş: 'şe', T: 'te', U: 'u', Ü: 'ü', V: 've', Y: 'ye', Z: 'ze' };

  /* ---------- Saklama ---------- */
  const A_AYAR = 'harfavcisi.ayarlar.v1', A_SABLON = 'harfavcisi.sablonlar.v1';
  function oku(k, v) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : v; } catch (e) { return v; } }
  function yaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* özel pencere vb. */ } }

  const ayar = Object.assign({
    oyuncu: 2, zorluk: 'kolay', kategori: 'hepsi', tur: 10, can: 5, sadeceOsmo: false,
    konusma: true, ses: true, muzik: true, mini: true, ozel: '', zoom: 1, zoomY: 0.5, otoZoom: true,
    kameraId: '', cevir: 'otomatik', cozunurluk: 640,
    vision: {}
  }, oku(A_AYAR, {}));
  // Osmo Words taşları: beyaz taş üstünde mavi/kırmızı harf
  const GORUS_VARSAYILAN = { tasTipi: 'harf', minKenar: 9, sMin: 0.42, vMin: 0.35, minSkor: 0.74, minFark: 0.025 };
  const RENK_VARSAYILAN = { harf: { sMin: 0.42, vMin: 0.35 }, zemin: { sMin: 0.35, vMin: 0.16 } };
  if (!ayar.surum || ayar.surum < 2) ayar.vision = {};            // eski (renkli taş) ayarlarını bırak
  if (!ayar.surum || ayar.surum < 3) ayar.cevir = 'otomatik';      // görüntü yönü artık kendiliğinden bulunur
  if (!ayar.surum || ayar.surum < 4) {                              // küçük/uzak harfler + her yöne okuma
    if (ayar.vision) ayar.vision.minKenar = 9;
    ayar.cozunurluk = 960; ayar.zoom = ayar.zoom || 1; ayar.zoomY = ayar.zoomY ?? 0.5; ayar.muzik = true;
  }
  if (!ayar.surum || ayar.surum < 5) { ayar.otoZoom = true; ayar.muzik = true; }   // otomatik yakınlaştırma
  ayar.surum = 5;
  ayar.vision = Object.assign({}, GORUS_VARSAYILAN, ayar.vision || {});
  const kaydet = () => yaz(A_AYAR, ayar);

  let ogrenilen = oku(A_SABLON, []);          // [{harf, g(base64)}]
  const fontSablon = Vision.fontSablonlari();
  let sablonlar = [], sablonYonu = null;
  // Öğretilen taşlar o anki görüntü yönüyle kaydedilir; başka yönde öğretilenler kullanılmaz.
  function sablonlariYenile() {
    sablonlar = fontSablon.concat(ogrenilen.filter(o => !o.yon || !sablonYonu || o.yon === sablonYonu)
      .map(o => Vision.ogrenilmisSablon(o.harf, o.g)).filter(Boolean));
  }
  sablonlariYenile();

  /* ---------- Ses ---------- */
  let ac = null;
  /* Ses kilidini aç: tarayıcılar sesi ancak bir dokunuştan sonra çalar.
     iPad/iPhone'da yan sessiz düğmesi açıkken Web Audio susar; sessiz bir <audio> döngüsü ve
     audioSession 'playback' ile ses "medya" kanalına alınır, böylece sessiz modda da duyulur. */
  let sessizAudio = null;
  function sessizWav() {
    const n = 4000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const yazS = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    yazS(0, 'RIFF'); v.setUint32(4, 36 + n, true); yazS(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); yazS(36, 'data'); v.setUint32(40, n, true);
    b.fill(128, 44);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function sesKilidiAc() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state !== 'running') ac.resume();
      const buf = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource();   // eski Safari için boş ses
      src.buffer = buf; src.connect(ac.destination); src.start(0);
    } catch (e) { }
    try {
      if (!sessizAudio) {
        sessizAudio = document.createElement('audio');
        sessizAudio.src = sessizWav(); sessizAudio.loop = true; sessizAudio.setAttribute('playsinline', '');
        sessizAudio.setAttribute('x-webkit-airplay', 'deny');
      }
      if (sessizAudio.paused) { const p = sessizAudio.play(); if (p && p.catch) p.catch(() => { }); }
    } catch (e) { }
    if (ayar.muzik && aktifEkran === 'oyun' && !muzik.zaman) muzikBaslat();
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(ev => document.addEventListener(ev, sesKilidiAc, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ac && ac.state !== 'running') { try { ac.resume(); } catch (e) { } } });

  function ton(frekans, sure, tip, gecikme, hacim) {
    if (!ayar.ses) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + (gecikme || 0), o = ac.createOscillator(), g = ac.createGain();
      o.type = tip || 'sine'; o.frequency.value = frekans;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(hacim || 0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + sure + 0.05);
    } catch (e) { /* ses yok */ }
  }
  const sesDogru = () => { ton(660, .15, 'triangle'); ton(990, .25, 'triangle', .1); };
  const sesYanlis = () => { ton(200, .3, 'sawtooth', 0, .12); ton(150, .35, 'sawtooth', .12, .12); };
  const sesZafer = () => { [523, 659, 784, 1046].forEach((f, i) => ton(f, .3, 'triangle', i * .12, .35)); ton(1318, .6, 'triangle', .5, .3); ton(1046, .6, 'sine', .5, .2); };
  const sesTik = () => ton(1200, .05, 'square', 0, .05);

  /* ---------- Arka plan müziği: tarayıcıda üretilen özgün, neşeli bir döngü ---------- */
  const muzik = { ana: null, zaman: null, sonraki: 0, adim: 0 };
  const SEKIZLIK = 60 / 112 / 2;                                   // 112 vuruş/dk
  const AKOR = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];   // C  Am  F  G
  const MELODI = [72, 0, 76, 79, 76, 0, 74, 72, 69, 0, 72, 76, 74, 0, 72, 69,
                  65, 0, 69, 72, 74, 72, 69, 0, 67, 0, 71, 74, 72, 0, 0, 0,
                  72, 74, 76, 0, 79, 0, 76, 74, 72, 0, 69, 72, 76, 0, 74, 0,
                  77, 0, 76, 74, 72, 0, 69, 0, 71, 0, 74, 72, 71, 0, 67, 0];
  const frek = m => 440 * Math.pow(2, (m - 69) / 12);
  function nota(m, t, sure, tip, hacim) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = tip; o.frequency.value = frek(m);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(hacim, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sure);
    o.connect(g).connect(muzik.ana); o.start(t); o.stop(t + sure + 0.05);
  }
  function muzikPlanla() {
    while (muzik.sonraki < ac.currentTime + 0.25) {
      const t = muzik.sonraki, i = muzik.adim % 64, akor = AKOR[Math.floor(i / 8) % 4];
      if (MELODI[i]) nota(MELODI[i], t, SEKIZLIK * 1.6, 'triangle', 0.22);
      if (i % 4 === 0) nota(akor[0] - 12, t, SEKIZLIK * 3, 'sine', 0.35);          // bas
      if (i % 2 === 1) nota(akor[(i >> 1) % 3] + 12, t, SEKIZLIK * 0.9, 'sine', 0.08); // hafif arpej
      muzik.sonraki += SEKIZLIK; muzik.adim++;
    }
  }
  function muzikBaslat() {
    if (!ayar.muzik || muzik.zaman) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state !== 'running') ac.resume();
      muzik.ana = ac.createGain(); muzik.ana.gain.value = 0.0001;
      muzik.ana.connect(ac.destination);
      muzik.ana.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 1.5);
      muzik.sonraki = ac.currentTime + 0.1; muzik.adim = 0;
      muzik.zaman = setInterval(muzikPlanla, 60);
      muzikDugme();
    } catch (e) { }
  }
  function muzikDurdur() {
    if (!muzik.zaman) return;
    clearInterval(muzik.zaman); muzik.zaman = null;
    try { const g = muzik.ana; g.gain.cancelScheduledValues(ac.currentTime); g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15); setTimeout(() => g.disconnect(), 800); } catch (e) { }
    muzikDugme();
  }
  // konuşurken müziği kıs
  function muzikKis(kis) {
    if (!muzik.zaman || !muzik.ana) return;
    try { muzik.ana.gain.setTargetAtTime(kis ? 0.05 : 0.16, ac.currentTime, 0.2); } catch (e) { }
  }
  function muzikDugme() { const b = document.getElementById('muzikBtn'); if (b) b.classList.toggle('kapali', !muzik.zaman); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) muzikDurdur(); });

  let trSes = null;
  function sesleriBul() { try { trSes = speechSynthesis.getVoices().find(v => /^tr/i.test(v.lang)) || null; } catch (e) { } }
  if ('speechSynthesis' in window) { sesleriBul(); speechSynthesis.onvoiceschanged = sesleriBul; }
  function soyle(metin) {
    if (!ayar.konusma || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(metin);
      u.lang = 'tr-TR'; if (trSes) u.voice = trSes; u.rate = 0.9; u.pitch = 1.1;
      u.onstart = () => muzikKis(true); u.onend = u.onerror = () => muzikKis(false);
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  /* ---------- Ekranlar ---------- */
  let aktifEkran = 'menu';
  function git(ad) {
    $$('.ekran').forEach(e => e.classList.toggle('aktif', e.id === ad));
    aktifEkran = ad;
    if (ad !== 'oyun') { oyun.aktif = false; clearTimeout(oyun.zaman); }
    if (ad === 'ogret') { ogretHazirla(); kameraBaslat(); }
    if (ad === 'kamera') { kameraAyarHazirla(); kameraBaslat(); }
    if (ad === 'ayarlar') ayarlarHazirla();
    if (ad === 'menu') menuHazirla();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-git]');
    if (b) { sesTik(); git(b.dataset.git); }
  });

  /* ---------- Menü ---------- */
  function menuHazirla() {
    $$('.cip').forEach(c => c.classList.toggle('secili', String(ayar[c.dataset.ayar]) === c.dataset.deger));
    const sel = $('#kategoriSec');
    if (!sel.options.length) for (const [k, v] of Object.entries(KATEGORILER)) sel.add(new Option(v, k));
    sel.value = ayar.kategori;
  }
  $$('.cip').forEach(c => c.addEventListener('click', () => {
    const v = c.dataset.deger; ayar[c.dataset.ayar] = /^\d+$/.test(v) ? +v : v; kaydet(); sesTik(); menuHazirla();
  }));
  $('#kategoriSec').addEventListener('change', e => { ayar.kategori = e.target.value; kaydet(); });
  $$('.mod').forEach(m => m.addEventListener('click', () => { sesTik(); oyunBaslat(m.dataset.mod); }));

  /* ---------- Kamera ---------- */
  const video = $('#video');
  const islem = document.createElement('canvas');
  const ictx = islem.getContext('2d', { willReadFrequently: true });
  const takipci = new Vision.Takipci({ kare: 3, oran: 0.6, unutma: 1200 });
  const kam = { akis: null, son: 0, tespit: [], lab: null, ms: 0, baslatiliyor: false };

  function durumYaz(metin, hata) {
    for (const id of ['#kameraDurum', '#kameraBilgi']) { const e = $(id); e.textContent = metin; e.classList.toggle('hata', !!hata); }
  }

  async function kameraBaslat() {
    if (kam.akis || kam.baslatiliyor) return !!kam.akis;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      durumYaz('Kamera kullanılamıyor: sayfa https:// (ya da localhost) üzerinden açılmalı. Şimdilik ekran klavyesiyle oynayabilirsiniz.', true);
      return false;
    }
    kam.baslatiliyor = true;
    const v = { width: { ideal: 1920 }, height: { ideal: 1080 } };   // yüksek çözünürlük: yakınlaştırınca harfler net kalır
    if (ayar.kameraId) v.deviceId = { exact: ayar.kameraId }; else v.facingMode = 'user';
    try {
      kam.akis = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
    } catch (e) {
      try { kam.akis = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
      catch (e2) {
        kam.baslatiliyor = false;
        durumYaz('Kameraya erişilemedi (' + (e2.name || e2) + '). İzin verip sayfayı yenileyin; ekran klavyesiyle de oynanabilir.', true);
        return false;
      }
    }
    video.srcObject = kam.akis;
    try { await video.play(); } catch (e) { }
    kam.baslatiliyor = false;
    durumYaz('Kamera açık ✔');
    zoomUygula();
    kameraListesi();
    requestAnimationFrame(kare);
    return true;
  }
  function kameraDurdur() {
    if (kam.akis) kam.akis.getTracks().forEach(t => t.stop());
    kam.akis = null; video.srcObject = null;
  }
  async function kameraListesi() {
    try {
      const sel = $('#kameraSec'), cihaz = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      sel.length = 1;
      cihaz.forEach((d, i) => sel.add(new Option(d.label || ('Kamera ' + (i + 1)), d.deviceId)));
      sel.value = ayar.kameraId;
    } catch (e) { }
  }

  function kare(t) {
    if (!kam.akis) return;
    requestAnimationFrame(kare);
    const gerek = aktifEkran === 'oyun' || aktifEkran === 'ogret' || aktifEkran === 'kamera';
    if (!gerek || t - kam.son < 90 || !video.videoWidth) return;
    kam.son = t;
    const W = ayar.cozunurluk, H = Math.round(video.videoHeight * W / video.videoWidth);
    if (islem.width !== W || islem.height !== H) { islem.width = W; islem.height = H; }
    // Otomatik yakınlaştırma: taşların olduğu bölge büyütülerek işlenir; ara sıra tüm kare taranır (yeni taşlar için)
    oto.kare++;
    oto.tamTarama = !ayar.otoZoom || !oto.hedef || oto.kare % 6 === 0;
    goruntuCiz(etkinYon(), W, H);
    const t0 = performance.now();
    const img = ictx.getImageData(0, 0, W, H);
    const gorus = Object.assign({}, ayar.vision, { minKenar: Math.round(ayar.vision.minKenar * W / 640) });
    const r = Vision.tara(img, sablonlar, gorus);
    kam.ms = performance.now() - t0;
    kam.tespit = r.tespitler; kam.lab = r.lab; kam.elenen = r.elenenler || [];
    if (ayar.cevir === 'otomatik' && r.tespitler.length && ++yon.sayac % 5 === 0) yonDegerlendir(W, H, gorus);
    otoZoomGuncelle(r, t);
    // Takipçi tam kare koordinatlarıyla çalışır: yakınlaştırma değişse de aynı taş aynı kalır
    const kr = kam.kirpim;
    const izT = r.tespitler.map(d => ({ renk: d.renk, harf: d.harf,
      x: kr.x + d.x * kr.w / W, y: kr.y + d.y * kr.h / H, boyut: d.boyut * kr.w / W, _d: d }));
    const olaylar = takipci.guncelle(izT, t);
    izT.forEach(d => { d._d.iz = d.iz; });
    if (aktifEkran === 'oyun') olaylar.forEach(o => harfGeldi(o.harf, o.renk, 'kamera'));
    if (aktifEkran === 'ogret') ogretKare(r.tespitler);
    if (!(oto.tamTarama && oto.hedef && ayar.otoZoom)) onizlemeCiz();   // ara tam taramalar önizlemeyi titretmesin
  }

  /* ---------- Görüntü yönü (Osmo aynası ters çevirir; web kamerası çevirmez) ---------- */
  const YONLER = ['yok', 'dikey', 'yatay', '180'];
  const YON_ADI = { yok: 'olduğu gibi', dikey: 'dikey çevrilmiş (Osmo aynası)', yatay: 'yatay çevrilmiş', '180': '180° döndürülmüş' };
  const yon = { aktif: null, puan: { yok: 0, dikey: 0, yatay: 0, '180': 0 }, sayac: 0, deneme: 0 };
  function varsayilanYon() {
    const tablet = navigator.maxTouchPoints > 1 || /iPad|Android|Silk|Kindle/i.test(navigator.userAgent);
    return tablet ? 'dikey' : 'yok';
  }
  function etkinYon() {
    let y;
    if (ayar.cevir !== 'otomatik') y = ayar.cevir;
    else { if (!yon.aktif) yon.aktif = oku('harfavcisi.yon', null) || varsayilanYon(); y = yon.aktif; }
    if (y !== sablonYonu) { sablonYonu = y; sablonlariYenile(); }
    return y;
  }
  const yonOturdu = () => ayar.cevir !== 'otomatik' || yon.deneme >= 2;
  // Önce tüm kare (yön çevrilmiş, elle yakınlaştırılmış) kamera çözünürlüğünde 'tam' tuvale çizilir,
  // sonra otomatik yakınlaştırma bölgesi oradan kırpılıp işlem tuvaline büyütülür.
  const tam = document.createElement('canvas'), tctx = tam.getContext('2d');
  kam.kirpim = { x: 0, y: 0, w: 1, h: 1 };
  function goruntuCiz(y, W, H) {
    const vw = video.videoWidth, vh = video.videoHeight, z = Math.max(1, kam.dijitalZoom || 1);
    const sw = vw / z, sh = vh / z, sx = (vw - sw) / 2, sy = (vh - sh) * Math.min(1, Math.max(0, ayar.zoomY));
    const TW = Math.round(sw), TH = Math.round(sh);
    if (tam.width !== TW || tam.height !== TH) { tam.width = TW; tam.height = TH; }
    tctx.save();
    if (y === 'dikey') { tctx.translate(0, TH); tctx.scale(1, -1); }
    else if (y === 'yatay') { tctx.translate(TW, 0); tctx.scale(-1, 1); }
    else if (y === '180') { tctx.translate(TW, TH); tctx.scale(-1, -1); }
    tctx.drawImage(video, sx, sy, sw, sh, 0, 0, TW, TH);
    tctx.restore();
    let k = { x: 0, y: 0, w: TW, h: TH };
    if (!oto.tamTarama && oto.hedef) {
      const h = oto.hedef;
      k = { x: h.x * TW, y: h.y * TH, w: h.w * TW, h: h.h * TH };
    }
    kam.kirpim = k;
    ictx.drawImage(tam, k.x, k.y, k.w, k.h, 0, 0, W, H);
  }

  /* ---------- Otomatik yakınlaştırma ---------- */
  // Görülen taşların (okunan ya da okunamayan) kapsayan kutusu tutulur; kırpım bu kutuya yumuşakça yaklaşır.
  const oto = { kare: 0, tamTarama: true, hedef: null, kutular: [], sonGorulme: 0 };
  function otoZoomGuncelle(r, t) {
    if (!ayar.otoZoom) { oto.hedef = null; return; }
    const kr = kam.kirpim, W = islem.width, H = islem.height, TW = tam.width, TH = tam.height;
    const kutular = r.tespitler.map(d => d.kutu).concat((r.elenenler || []).filter(e => e.sebep !== 'çok büyük').map(e => e.kutu));
    for (const [x0, y0, x1, y1] of kutular) {
      oto.kutular.push({ t, x0: (kr.x + x0 * kr.w / W) / TW, y0: (kr.y + y0 * kr.h / H) / TH,
        x1: (kr.x + x1 * kr.w / W) / TW, y1: (kr.y + y1 * kr.h / H) / TH });
    }
    if (r.tespitler.length) oto.sonGorulme = t;
    oto.kutular = oto.kutular.filter(k => t - k.t < 2500).slice(-200);
    const okunan = oto.kutular;
    if (!okunan.length || t - oto.sonGorulme > 3000) { oto.hedef = null; return; }
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, boy = 0;
    for (const k of okunan) { x0 = Math.min(x0, k.x0); y0 = Math.min(y0, k.y0); x1 = Math.max(x1, k.x1); y1 = Math.max(y1, k.y1); boy = Math.max(boy, k.y1 - k.y0, (k.x1 - k.x0) * TW / TH); }
    // kenar payı: en az bir taş boyu (yeni taş yanına konabilsin)
    const pay = Math.max(boy * 1.6, 0.06);
    x0 -= pay * TH / TW; x1 += pay * TH / TW; y0 -= pay; y1 += pay;
    // kare oranını koru, en az %35 genişlik (aşırı büyütme bulanıklaştırır)
    let w = Math.max(x1 - x0, 0.35), h = Math.max(y1 - y0, 0.35);
    w = h = Math.max(w, h);            // normalleştirilmiş eşit kenar = kameranın en-boy oranı
    w = Math.min(1, w); h = Math.min(1, h);
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    cx = Math.min(1 - w / 2, Math.max(w / 2, cx)); cy = Math.min(1 - h / 2, Math.max(h / 2, cy));
    const yeni = { x: cx - w / 2, y: cy - h / 2, w, h };
    if (w > 0.9 && h > 0.9) { oto.hedef = null; return; }
    // yumuşak geçiş; küçük titremeleri yok say
    const e = oto.hedef;
    if (!e) oto.hedef = yeni;
    else {
      const fark = Math.abs(e.x - yeni.x) + Math.abs(e.y - yeni.y) + Math.abs(e.w - yeni.w) + Math.abs(e.h - yeni.h);
      if (fark > 0.04) for (const k of ['x', 'y', 'w', 'h']) e[k] += (yeni[k] - e[k]) * 0.35;
    }
  }
  // Kamera destekliyorsa (bazı Android/Chrome) gerçek optik/sensör zoom, yoksa dijital
  function zoomUygula() {
    kam.dijitalZoom = ayar.zoom;
    try {
      const tr = kam.akis && kam.akis.getVideoTracks()[0];
      const cap = tr && tr.getCapabilities ? tr.getCapabilities() : null;
      if (cap && cap.zoom) {
        const z = Math.min(cap.zoom.max, Math.max(cap.zoom.min, cap.zoom.min * ayar.zoom));
        tr.applyConstraints({ advanced: [{ zoom: z }] }).then(() => { kam.dijitalZoom = ayar.zoom * cap.zoom.min / z; }).catch(() => { });
      }
    } catch (e) { }
  }
  // Aynı kareyi dört yönde dene: harfler yalnızca doğru yönde yüksek skorla okunur.
  // Öğretilmiş şablonlar yanlış yönde öğretilmiş olabilir; karşılaştırmada yalnız hazır şablonlar kullanılır.
  function yonDegerlendir(W, H, gorus) {
    for (const y of YONLER) {
      goruntuCiz(y, W, H);
      const rr = Vision.tara(ictx.getImageData(0, 0, W, H), fontSablon, gorus);
      let p = 0; for (const d of rr.tespitler) if (d.harf) p += d.skor * d.skor;
      yon.puan[y] = yon.puan[y] * 0.7 + p;
    }
    goruntuCiz(etkinYon(), W, H);                 // önizleme için asıl görüntüyü geri çiz
    yon.deneme++;
    const en = YONLER.reduce((a, b) => (yon.puan[b] > yon.puan[a] ? b : a));
    if (en !== yon.aktif && yon.deneme >= 2 && yon.puan[en] > yon.puan[yon.aktif] * 1.3 + 0.2) {
      yon.aktif = en; yaz('harfavcisi.yon', en); takipci.sifirla(); etkinYon();
    }
  }

  function onizlemeCiz() {
    let cv = null;
    if (aktifEkran === 'oyun') { cv = $('#miniKamera'); if (!ayar.mini) return; }
    else if (aktifEkran === 'ogret') cv = $('#ogretKamera');
    else if (aktifEkran === 'kamera') cv = $('#ayarKamera');
    if (!cv) return;
    if (cv.width !== islem.width || cv.height !== islem.height) { cv.width = islem.width; cv.height = islem.height; }
    const c = cv.getContext('2d');
    c.drawImage(islem, 0, 0);
    if (aktifEkran === 'kamera' && $('#maskeGoster').checked && kam.lab) {
      const im = c.getImageData(0, 0, cv.width, cv.height), d = im.data, lab = kam.lab;
      for (let p = 0; p < lab.length; p++) {
        const i = p * 4;
        if (lab[p] === 1) { d[i] = 40; d[i + 1] = 110; d[i + 2] = 255; }
        else if (lab[p] === 2) { d[i] = 255; d[i + 1] = 50; d[i + 2] = 50; }
        else { d[i] = d[i] * .3; d[i + 1] = d[i + 1] * .3; d[i + 2] = d[i + 2] * .3; }
      }
      c.putImageData(im, 0, 0);
    }
    const kalin = Math.max(2, cv.width / 250);
    if (aktifEkran !== 'oyun') {
      // Neden okunmadığını göster: elenen renkli lekeler kesik turuncu çerçeve + sebep
      c.setLineDash([6, 4]); c.lineWidth = kalin * 0.7; c.strokeStyle = '#ff9f1a';
      const fs2 = Math.max(11, cv.width / 60); c.font = `700 ${fs2}px system-ui, sans-serif`;
      for (const e of kam.elenen || []) {
        const [x0, y0, x1, y1] = e.kutu;
        c.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
        c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x0 - 2, y1 + 4, c.measureText(e.sebep).width + 8, fs2 + 4);
        c.fillStyle = '#ffd08a'; c.fillText(e.sebep, x0 + 2, y1 + fs2 + 4);
      }
      c.setLineDash([]);
    }
    for (const d of kam.tespit) {
      const [x0, y0, x1, y1] = d.kutu;
      c.lineWidth = kalin;
      c.strokeStyle = d.harf ? (d.renk === 'mavi' ? '#7fb2ff' : '#ff8a8a') : '#ffc93c';
      c.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      const etiket = d.harf || ('?' + (d.aday || ''));
      const fs = Math.max(14, cv.width / 28);
      c.font = `900 ${fs}px system-ui, sans-serif`;
      c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x0 - 2, y0 - fs - 6, c.measureText(etiket).width + 10, fs + 4);
      c.fillStyle = '#fff'; c.fillText(etiket, x0 + 3, y0 - 6);
    }
    if (aktifEkran === 'kamera') {
      const yonMetni = ayar.cevir === 'otomatik' ? ` · yön: ${YON_ADI[etkinYon()]} (otomatik)` : '';
      const zm = !oto.tamTarama && oto.hedef ? ` · oto yakınlaştırma ${(1 / oto.hedef.w).toFixed(1)}×` : '';
      $('#kameraBilgi').textContent = `${kam.tespit.length} taş görülüyor · ${kam.tespit.filter(d => d.harf).map(d => d.harf).join(' ') || '—'} · ${kam.ms.toFixed(0)} ms/kare${yonMetni}${zm}`;
    }
  }

  /* ---------- Oyun ---------- */
  const oyun = { aktif: false, mod: 'kelime', liste: [], i: 0, puan: { mavi: 0, kirmizi: 0 }, zaman: null };

  function kelimeHavuzu() {
    let h;
    if (ayar.kategori === 'ozel') {
      h = ayar.ozel.split(/\n/).map(s => s.trim()).filter(Boolean).map(s => {
        const p = s.split(/\s+/); return [TR(p[0]).replace(/[^A-ZÇĞİÖŞÜ]/g, ''), p.slice(1).join(' ') || '❓', 'ozel'];
      }).filter(k => k[0].length > 0);
      if (!h.length) h = KELIMELER.slice();
    } else h = KELIMELER.filter(k => ayar.kategori === 'hepsi' || k[2] === ayar.kategori);
    if (ayar.sadeceOsmo) h = h.filter(k => ![...k[0]].some(c => OSMO_DISI.has(c)));
    return h;
  }
  function uzunlukUygun(k, mod) {
    const n = k[0].length;
    if (mod === 'ilk') return true;
    if (ayar.zorluk === 'kolay') return n <= 4;
    if (ayar.zorluk === 'orta') return n >= 4 && n <= 6;
    return n >= 6;
  }
  const karistir = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function oyunBaslat(mod) {
    oyun.mod = mod; oyun.i = 0; oyun.puan = { mavi: 0, kirmizi: 0 };
    document.body.classList.toggle('tek', ayar.oyuncu === 1);
    if (mod === 'harf') {
      let harfler = ayar.sadeceOsmo ? HARFLER.filter(h => !OSMO_DISI.has(h)) : HARFLER.slice();
      oyun.liste = [];
      while (oyun.liste.length < ayar.tur) oyun.liste.push(...karistir(harfler.slice()));
      oyun.liste.length = ayar.tur;
    } else {
      const havuz = kelimeHavuzu();
      let uygun = havuz.filter(k => uzunlukUygun(k, mod));
      if (uygun.length < 3) uygun = havuz;
      oyun.liste = karistir(uygun.slice()).slice(0, ayar.tur);
    }
    git('oyun');
    oyun.aktif = true;
    $('#miniKamera').classList.toggle('gizli', !ayar.mini);
    klavyeKur();
    skorYaz();
    kameraBaslat();
    muzikBaslat();
    soru();
  }

  function skorYaz(parlayan) {
    $('#skorMavi b').textContent = oyun.puan.mavi;
    $('#skorKirmizi b').textContent = oyun.puan.kirmizi;
    $('#ilerleme').textContent = `${Math.min(oyun.i + 1, oyun.liste.length)} / ${oyun.liste.length}`;
    if (parlayan) { const e = parlayan === 'mavi' ? $('#skorMavi') : $('#skorKirmizi'); e.classList.remove('parla'); void e.offsetWidth; e.classList.add('parla'); }
  }
  function mesaj(m, tip) { const e = $('#mesaj'); e.textContent = m; e.className = 'mesaj ' + (tip || ''); }

  function soru() {
    clearTimeout(oyun.zaman);
    if (oyun.i >= oyun.liste.length) return bitir();
    oyun.kilit = false; oyun.denenen = new Set(); oyun.yanlis = [];
    oyun.can = oyun.mod === 'kelime' ? ayar.can : 99;
    $('#yanlislar').innerHTML = ''; mesaj('');
    const resim = $('#resim'), buyuk = $('#buyukHarf'), yuvalar = $('#yuvalar');
    resim.style.display = buyuk.style.display = 'none'; yuvalar.innerHTML = '';
    $('#ipucuBtn').style.display = oyun.mod === 'kelime' ? '' : 'none';
    if (oyun.mod === 'harf') {
      oyun.hedef = oyun.liste[oyun.i];
      buyuk.textContent = oyun.hedef; buyuk.style.display = 'block';
      buyuk.style.animation = 'none'; void buyuk.offsetWidth; buyuk.style.animation = '';
      soyle(`${HARF_ADI[oyun.hedef]} harfini bul`);
    } else {
      const [kelime, emoji] = oyun.liste[oyun.i];
      oyun.kelime = [...kelime]; oyun.emoji = emoji;
      resim.textContent = emoji; resim.style.display = 'block';
      resim.style.animation = 'none'; void resim.offsetWidth; resim.style.animation = '';
      yuvalar.style.setProperty('--n', Math.max(5, oyun.kelime.length));
      oyun.acik = oyun.kelime.map(() => null);
      oyun.kelime.forEach((h, i) => {
        const y = document.createElement('div'); y.className = 'yuva'; y.dataset.i = i;
        if (oyun.mod === 'ilk' && i > 0) { y.textContent = h; y.classList.add('goster'); }
        yuvalar.appendChild(y);
      });
      if (oyun.mod === 'kelime' && ayar.zorluk === 'kolay') yuvaAc(0, 'ipucu');
      if (oyun.mod === 'ilk') soyle(`${kelime.toLocaleLowerCase('tr-TR')}. Hangi harfle başlıyor?`);
    }
    canlariCiz(); skorYaz();
  }

  function yuvaAc(i, renk) {
    oyun.acik[i] = renk;
    const y = $(`#yuvalar .yuva[data-i="${i}"]`);
    y.textContent = oyun.kelime[i]; y.className = 'yuva acik ' + renk;
  }
  function canlariCiz() {
    const e = $('#canlar');
    if (oyun.mod !== 'kelime' || ayar.can >= 99) { e.innerHTML = ''; return; }
    e.innerHTML = Array.from({ length: ayar.can }, (_, i) => `<span class="${i < oyun.can ? '' : 'patladi'}">🎈</span>`).join('');
  }
  function yanlisEkle(harf, renk) {
    const d = document.createElement('div'); d.className = 'yanlis ' + renk; d.textContent = harf;
    $('#yanlislar').appendChild(d);
  }

  function harfGeldi(harf, renk, kaynak) {
    if (!oyun.aktif || oyun.kilit) return;
    if (ayar.oyuncu === 1) renk = 'mavi';
    if (oyun.mod === 'harf') return harfAviHarf(harf, renk);
    if (oyun.mod === 'ilk') return ilkHarf(harf, renk);
    kelimeHarf(harf, renk);
  }

  function kelimeHarf(harf, renk) {
    if (oyun.denenen.has(harf)) { mesaj(`${harf} zaten denendi`, ''); return; }
    oyun.denenen.add(harf);
    const yerler = oyun.kelime.map((h, i) => (h === harf && !oyun.acik[i] ? i : -1)).filter(i => i >= 0);
    if (yerler.length) {
      yerler.forEach(i => yuvaAc(i, renk));
      oyun.puan[renk] += yerler.length; skorYaz(renk); sesDogru();
      mesaj(['Harika!', 'Süper!', 'Doğru!', 'Aferin!'][Math.random() * 4 | 0], 'iyi');
      if (oyun.acik.every(Boolean)) kelimeBitti(renk);
    } else if (oyun.kelime.includes(harf)) {
      mesaj(`${harf} zaten açık`, '');
    } else {
      oyun.yanlis.push(harf); yanlisEkle(harf, renk); sesYanlis();
      oyun.can--; canlariCiz();
      mesaj(`Bu kelimede ${harf} yok`, 'kotu');
      if (oyun.can <= 0) {
        oyun.kilit = true;
        oyun.kelime.forEach((h, i) => { if (!oyun.acik[i]) { const y = $(`#yuvalar .yuva[data-i="${i}"]`); y.textContent = h; y.classList.add('goster'); } });
        mesaj(`Kelime: ${oyun.kelime.join('')}`, '');
        soyle(oyun.kelime.join('').toLocaleLowerCase('tr-TR'));
        oyun.zaman = setTimeout(() => { oyun.i++; soru(); }, 3200);
      }
    }
  }

  function kelimeBitti(renk) {
    oyun.kilit = true;
    oyun.puan[renk] += 2; skorYaz(renk);
    sesZafer(); konfeti();
    const ovgu = 'Kutlarım! ' + ['Aferin!', 'Harikasın!', 'Süpersin!', 'Bravo!'][Math.random() * 4 | 0];
    mesaj(`${oyun.kelime.join('')}! ${ovgu} 🎉`, 'iyi');
    kutlamaGoster('Kutlarım!');
    setTimeout(() => soyle(`${oyun.kelime.join('').toLocaleLowerCase('tr-TR')}. ${ovgu}`), 350);
    oyun.zaman = setTimeout(() => { oyun.i++; soru(); }, 3000);
  }

  function ilkHarf(harf, renk) {
    const dogru = oyun.kelime[0];
    if (harf === dogru) {
      oyun.kilit = true; yuvaAc(0, renk);
      $$('#yuvalar .yuva').forEach((y, i) => { if (i) { y.classList.remove('goster'); y.classList.add('acik', renk); } });
      oyun.puan[renk] += 1; skorYaz(renk); sesZafer(); konfeti();
      mesaj(`Evet! ${oyun.kelime.join('')}`, 'iyi');
      setTimeout(() => soyle(`Evet! ${oyun.kelime.join('').toLocaleLowerCase('tr-TR')}`), 300);
      oyun.zaman = setTimeout(() => { oyun.i++; soru(); }, 2600);
    } else if (!oyun.denenen.has(harf)) {
      oyun.denenen.add(harf); yanlisEkle(harf, renk); sesYanlis();
      mesaj(`Bu ${harf}. Tekrar dene!`, 'kotu');
    }
  }

  function harfAviHarf(harf, renk) {
    if (harf === oyun.hedef) {
      oyun.kilit = true;
      const b = $('#buyukHarf'); b.style.color = renk === 'mavi' ? 'var(--mavi)' : 'var(--kirmizi)';
      oyun.puan[renk] += 1; skorYaz(renk); sesZafer(); konfeti();
      mesaj('Buldun! 🎉', 'iyi'); soyle('Aferin!');
      oyun.zaman = setTimeout(() => { b.style.color = ''; oyun.i++; soru(); }, 1800);
    } else if (!oyun.denenen.has(harf)) {
      oyun.denenen.add(harf); yanlisEkle(harf, renk); sesYanlis();
      mesaj(`Bu ${harf}, biz ${oyun.hedef} arıyoruz`, 'kotu');
    }
  }

  function bitir() {
    kutlamaGoster('Kutlarım!');
    oyun.aktif = false;
    const { mavi, kirmizi } = oyun.puan;
    let baslik, metin, ses;
    if (ayar.oyuncu === 1) { baslik = 'Kutlarım! 🎉'; metin = `Oyunu bitirdin, ${mavi} puan topladın.`; ses = 'Kutlarım! Harika oynadın!'; }
    else if (mavi === kirmizi) { baslik = 'Kutlarım, berabere! 🎉'; metin = `İki takım da ${mavi} puan.`; ses = 'Berabere! İkinizi de kutlarım!'; }
    else { const k = mavi > kirmizi ? 'Mavi' : 'Kırmızı'; baslik = `Kutlarım ${k} takım! 🎉`; metin = `${k} takım kazandı · Mavi ${mavi} – ${kirmizi} Kırmızı`; ses = `Kutlarım ${k} takım! Harika oynadınız!`; }
    $('#bitisBaslik').textContent = baslik; $('#bitisMetin').textContent = metin;
    git('bitis'); sesZafer(); setTimeout(sesZafer, 700); soyle(ses);
    konfeti(); setTimeout(konfeti, 800); setTimeout(konfeti, 1600);
  }
  $('#tekrarBtn').addEventListener('click', () => oyunBaslat(oyun.mod));

  function kutlamaGoster(metin) {
    const k = $('#kutlama'); k.textContent = metin + ' 🎉';
    k.classList.remove('goster'); void k.offsetWidth; k.classList.add('goster');
  }
  function konfeti() {
    const k = $('#konfeti'), renk = ['#2c6fd6', '#d93a3a', '#ffc93c', '#2fb86b', '#a259ff'];
    for (let i = 0; i < 60; i++) {
      const e = document.createElement('i');
      e.style.left = Math.random() * 100 + 'vw'; e.style.background = renk[i % renk.length];
      e.style.animationDelay = Math.random() * .5 + 's'; e.style.animationDuration = 1.4 + Math.random() + 's';
      k.appendChild(e); setTimeout(() => e.remove(), 2600);
    }
  }

  $('#dinleBtn').addEventListener('click', () => {
    if (oyun.mod === 'harf') soyle(`${HARF_ADI[oyun.hedef]} harfini bul`);
    else soyle(oyun.kelime.join('').toLocaleLowerCase('tr-TR'));
  });
  $('#ipucuBtn').addEventListener('click', () => {
    if (oyun.kilit || oyun.mod !== 'kelime') return;
    const kapali = oyun.acik.map((a, i) => (a ? -1 : i)).filter(i => i >= 0);
    if (!kapali.length) return;
    const h = oyun.kelime[kapali[Math.random() * kapali.length | 0]];
    oyun.denenen.add(h);
    oyun.kelime.forEach((x, i) => { if (x === h && !oyun.acik[i]) yuvaAc(i, 'ipucu'); });
    sesTik();
    if (oyun.acik.every(Boolean)) { oyun.kilit = true; mesaj(oyun.kelime.join(''), ''); soyle(oyun.kelime.join('').toLocaleLowerCase('tr-TR')); oyun.zaman = setTimeout(() => { oyun.i++; soru(); }, 2600); }
  });

  /* Ekran klavyesi + fiziksel klavye (kamerasız oynama / deneme) */
  let klavyeTakim = 'mavi';
  function klavyeKur() {
    const t = $('#tuslar');
    if (!t.children.length) HARFLER.forEach(h => {
      const b = document.createElement('button'); b.textContent = h;
      b.addEventListener('click', () => harfGeldi(h, klavyeTakim, 'klavye'));
      t.appendChild(b);
    });
    $('#takimSec').style.display = ayar.oyuncu === 1 ? 'none' : '';
  }
  $('#takimSec').addEventListener('click', e => {
    klavyeTakim = klavyeTakim === 'mavi' ? 'kirmizi' : 'mavi';
    e.target.textContent = klavyeTakim === 'mavi' ? 'Mavi' : 'Kırmızı';
    e.target.classList.toggle('kirmizi', klavyeTakim === 'kirmizi');
  });
  $('#klavyeBtn').addEventListener('click', () => { const k = $('#klavye'); k.hidden = !k.hidden; });
  $('#muzikBtn').addEventListener('click', () => {
    if (muzik.zaman) { muzikDurdur(); ayar.muzik = false; } else { ayar.muzik = true; muzikBaslat(); }
    kaydet();
  });
  document.addEventListener('keydown', e => {
    if (aktifEkran !== 'oyun' || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input,textarea,select')) return;
    if (e.key === 'Tab') { e.preventDefault(); $('#takimSec').click(); return; }
    const h = TR(e.key || '');
    if (h.length === 1 && HARFLER.includes(h)) harfGeldi(h, klavyeTakim, 'klavye');
  });

  /* ---------- Öğret ---------- */
  const og = { harf: 'A', durum: 'bekle', sayac: 0, son: null, bos: 0 };
  function ogretHazirla() {
    const iz = $('#ogretIzgara');
    if (!iz.children.length) HARFLER.forEach(h => {
      const b = document.createElement('button'); b.dataset.h = h;
      b.innerHTML = `${h}<small>0</small>`;
      b.addEventListener('click', () => { og.harf = h; og.durum = 'bekle'; og.sayac = 0; ogretCiz(); });
      iz.appendChild(b);
    });
    takipci.sifirla();
    ogretCiz();
  }
  function ogretCiz() {
    $('#ogretHarf').textContent = og.harf;
    $$('#ogretIzgara button').forEach(b => {
      const n = ogrenilen.filter(o => o.harf === b.dataset.h).length;
      b.querySelector('small').textContent = n;
      b.classList.toggle('var', n > 0); b.classList.toggle('secili', b.dataset.h === og.harf);
    });
    if (!kam.akis) $('#ogretMesaj').textContent = 'Kamera bekleniyor…';
  }
  function ogretKare(tespit) {
    const m = $('#ogretMesaj'), tl = $('#ogretTanilan');
    const adaylar = tespit.filter(d => d.ham);
    tl.textContent = adaylar.length ? 'Şu an tanınan: ' + adaylar.map(d => (d.harf || '?') + ' (' + Math.round(d.skor * 100) + ')').join(', ') : '';
    if (!yonOturdu()) { m.textContent = 'Önce görüntünün yönünü buluyorum… taşı görüntüde tut'; og.sayac = 0; return; }
    if (og.durum === 'kaldir') {
      if (!tespit.length) { if (++og.bos >= 4) { og.durum = 'bekle'; og.sayac = 0; sonrakiHarf(); } }
      else og.bos = 0;
      return;
    }
    if (adaylar.length === 1) {
      const d = adaylar[0];
      if (og.son && Math.hypot(d.x - og.son.x, d.y - og.son.y) < d.boyut * 0.15) og.sayac++; else og.sayac = 1;
      og.son = d;
      m.textContent = `Görüyorum… kıpırdatma (${Math.min(og.sayac, 8)}/8)`;
      if (og.sayac >= 8) {
        ogrenilen.push({ harf: og.harf, g: Vision.hamKodla(d.ham), renk: d.renk, yon: etkinYon() });
        yaz(A_SABLON, ogrenilen); sablonlariYenile(); sesDogru();
        og.durum = 'kaldir'; og.bos = 0;
        m.textContent = `Öğrendim: ${og.harf} ✔  Şimdi taşı kaldır.`;
        ogretCiz();
      }
    } else {
      og.sayac = 0;
      m.textContent = adaylar.length > 1 ? 'Sadece bir taş koy' : `${og.harf} taşını koy`;
    }
  }
  function sonrakiHarf() {
    const i = HARFLER.indexOf(og.harf);
    og.harf = HARFLER[(i + 1) % HARFLER.length];
    soyle(HARF_ADI[og.harf]);
    ogretCiz();
  }
  $('#ogretSil').addEventListener('click', () => { ogrenilen = ogrenilen.filter(o => o.harf !== og.harf); yaz(A_SABLON, ogrenilen); sablonlariYenile(); ogretCiz(); });
  $('#ogretHepsiniSil').addEventListener('click', () => {
    if (!confirm('Öğretilen tüm taşlar silinsin mi?')) return;
    ogrenilen = []; yaz(A_SABLON, ogrenilen); sablonlariYenile(); ogretCiz();
  });
  $('#ogretDisa').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ tur: 'harf-avcisi-sablon', surum: 1, sablonlar: ogrenilen })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'harf-avcisi-taslar.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#ogretIce').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const yeni = (j.sablonlar || []).filter(o => HARFLER.includes(o.harf) && typeof o.g === 'string');
      ogrenilen = ogrenilen.concat(yeni); yaz(A_SABLON, ogrenilen); sablonlariYenile(); ogretCiz();
      $('#ogretMesaj').textContent = `${yeni.length} şablon yüklendi`;
    } catch (err) { $('#ogretMesaj').textContent = 'Dosya okunamadı'; }
    e.target.value = '';
  });

  /* ---------- Kamera ayarı ---------- */
  function kameraAyarHazirla() {
    $('#cevirSec').value = ayar.cevir;
    $('#zoomSec').value = ayar.zoom; $('#zoomDeger').textContent = ayar.zoom.toFixed(1) + '×';
    $('#zoomYSec').value = Math.round(ayar.zoomY * 100);
    $('#otoZoomSec').checked = ayar.otoZoom;
    $('#tasTipiSec').value = ayar.vision.tasTipi;
    $('#cozunurlukSec').value = String(ayar.cozunurluk);
    $('#minKenarSec').value = ayar.vision.minKenar; $('#minKenarDeger').textContent = ayar.vision.minKenar + ' px';
    $('#sMinSec').value = Math.round(ayar.vision.sMin * 100); $('#sMinDeger').textContent = Math.round(ayar.vision.sMin * 100) + '%';
  }
  $('#kameraSec').addEventListener('change', e => { ayar.kameraId = e.target.value; kaydet(); kameraDurdur(); kameraBaslat(); });
  $('#zoomSec').addEventListener('input', e => { ayar.zoom = +e.target.value; $('#zoomDeger').textContent = ayar.zoom.toFixed(1) + '×'; kaydet(); zoomUygula(); takipci.sifirla(); });
  $('#otoZoomSec').addEventListener('change', e => { ayar.otoZoom = e.target.checked; kaydet(); oto.hedef = null; });
  $('#zoomYSec').addEventListener('input', e => { ayar.zoomY = e.target.value / 100; kaydet(); takipci.sifirla(); });
  $('#cevirSec').addEventListener('change', e => {
    ayar.cevir = e.target.value; kaydet(); takipci.sifirla();
    if (ayar.cevir === 'otomatik') { yon.puan = { yok: 0, dikey: 0, yatay: 0, '180': 0 }; yon.deneme = 0; }
  });
  $('#tasTipiSec').addEventListener('change', e => {
    ayar.vision.tasTipi = e.target.value;
    Object.assign(ayar.vision, RENK_VARSAYILAN[e.target.value]);
    kaydet(); kameraAyarHazirla();
  });
  $('#cozunurlukSec').addEventListener('change', e => { ayar.cozunurluk = +e.target.value; kaydet(); });
  $('#minKenarSec').addEventListener('input', e => { ayar.vision.minKenar = +e.target.value; $('#minKenarDeger').textContent = e.target.value + ' px'; kaydet(); });
  $('#sMinSec').addEventListener('input', e => { ayar.vision.sMin = e.target.value / 100; $('#sMinDeger').textContent = e.target.value + '%'; kaydet(); });
  let ornekRenk = null;
  $('#ornekMavi').addEventListener('click', e => { ornekRenk = 'mavi'; $$('.ornekle button').forEach(b => b.classList.remove('bekliyor')); e.target.classList.add('bekliyor'); });
  $('#ornekKirmizi').addEventListener('click', e => { ornekRenk = 'kirmizi'; $$('.ornekle button').forEach(b => b.classList.remove('bekliyor')); e.target.classList.add('bekliyor'); });
  $('#renkSifirla').addEventListener('click', () => { delete ayar.vision.mavi; delete ayar.vision.kirmizi; Object.assign(ayar.vision, RENK_VARSAYILAN[ayar.vision.tasTipi]); kaydet(); kameraAyarHazirla(); });
  $('#ayarKamera').addEventListener('pointerdown', e => {
    if (!ornekRenk || !islem.width) return;
    const r = e.target.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) / r.width * islem.width), y = Math.round((e.clientY - r.top) / r.height * islem.height);
    const d = ictx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
    let R = 0, G = 0, B = 0; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    const n = d.length / 4, hsv = Vision.ton(R / n, G / n, B / n);
    if (hsv.s < 0.15) { $('#kameraBilgi').textContent = 'Bu nokta renkli değil; harfin (ya da taşın) renkli kısmına dokunun.'; return; }
    const a = [(hsv.h - 28 + 360) % 360, (hsv.h + 28) % 360];
    ayar.vision[ornekRenk] = a;
    const ust = RENK_VARSAYILAN[ayar.vision.tasTipi].sMin;
    ayar.vision.sMin = Math.min(ust, Math.max(0.2, +(hsv.s * 0.6).toFixed(2)));
    kaydet(); kameraAyarHazirla();
    $('#kameraBilgi').textContent = `${ornekRenk === 'mavi' ? 'Mavi' : 'Kırmızı'} ton ${Math.round(hsv.h)}° olarak öğrenildi.`;
    $$('.ornekle button').forEach(b => b.classList.remove('bekliyor')); ornekRenk = null;
  });

  /* ---------- Ayarlar ---------- */
  function ayarlarHazirla() {
    $('#turSec').value = String(ayar.tur); $('#canSec').value = String(ayar.can);
    $('#osmoSec').checked = ayar.sadeceOsmo; $('#konusmaSec').checked = ayar.konusma;
    $('#sesSec').checked = ayar.ses; $('#muzikSec').checked = ayar.muzik; $('#miniSec').checked = ayar.mini; $('#ozelKelimeler').value = ayar.ozel;
  }
  $('#turSec').addEventListener('change', e => { ayar.tur = +e.target.value; kaydet(); });
  $('#canSec').addEventListener('change', e => { ayar.can = +e.target.value; kaydet(); });
  $('#osmoSec').addEventListener('change', e => { ayar.sadeceOsmo = e.target.checked; kaydet(); });
  $('#konusmaSec').addEventListener('change', e => { ayar.konusma = e.target.checked; kaydet(); });
  $('#sesSec').addEventListener('change', e => { ayar.ses = e.target.checked; kaydet(); });
  $('#miniSec').addEventListener('change', e => { ayar.mini = e.target.checked; kaydet(); });
  $('#sesTestBtn').addEventListener('click', () => {
    const eskiSes = ayar.ses; ayar.ses = true; sesKilidiAc(); sesZafer(); ayar.ses = eskiSes;
    const eskiK = ayar.konusma; ayar.konusma = true; setTimeout(() => { soyle('Kutlarım! Ses çalışıyor.'); ayar.konusma = eskiK; }, 700);
    const durum = ac ? ac.state : 'yok';
    $('#sesTestBilgi').textContent = durum === 'running' ? 'Ses açık. Duymuyorsanız tabletin sesini açın.' : 'Ses motoru durumu: ' + durum + ' — bir kez daha dokunun.';
  });
  $('#muzikSec').addEventListener('change', e => { ayar.muzik = e.target.checked; kaydet(); if (!ayar.muzik) muzikDurdur(); });
  $('#ozelKelimeler').addEventListener('input', e => { ayar.ozel = e.target.value; kaydet(); });

  // Test/geliştirme için dışarı aç
  window.HarfAvcisi = { harfGeldi: (h, r) => harfGeldi(h, r || 'mavi', 'test'), oyun, ayar, git, takipci, yon, muzik };

  menuHazirla();
  if (!window.isSecureContext) durumYaz('Uyarı: sayfa güvenli bağlantıda değil (https). Kamera çalışmayabilir; ekran klavyesi ile oynanabilir.', true);
  else durumYaz('Oyuna başlayınca kamera açılır. Taşları göstermeden önce "Kamera ayarı"nı bir kez kontrol edin.');
})();

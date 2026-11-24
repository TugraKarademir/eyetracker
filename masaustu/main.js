"use strict";
// DersNabzı masaüstü: Python sunucusunu başlatır, başlangıç ekranını ve sayfa pencerelerini açar.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fileURLToPath } = require("url");
const sunucu = require("./sunucu");
const ayarlar = require("./ayarlar");
const { izinKarari, koken } = require("./izin");
const { kameraBetigi, UYARI_IMI: KAMERA_UYARI_IMI } = require("./kamera");

// ---------------------------------------------------------------- argümanlar, yollar
const SMOKE = process.argv.includes("--smoke");
function argDegeri(ad) {
  const on = `--${ad}=`;
  const a = process.argv.find((x) => x.startsWith(on));
  return a ? a.slice(on.length) : "";
}
// Veri klasörü geçersiz kılma (deneme/smoke için; ayar dosyasına yazılmaz).
let VERI_ZORLA = argDegeri("veri") || (process.env.DERSNABZI_MASAUSTU_VERI || "").trim();
let SMOKE_GECICI = null;
if (SMOKE) {
  // Smoke koşusu gerçek data/ klasörüne ve gerçek kullanıcı profiline asla dokunmaz.
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), "dn-smoke-"));
  if (!VERI_ZORLA) VERI_ZORLA = path.join(gecici, "veri");
  app.setPath("userData", path.join(gecici, "profil"));
  SMOKE_GECICI = gecici;
}
if (VERI_ZORLA) VERI_ZORLA = path.resolve(VERI_ZORLA);

const AYAR_DOSYASI = () => path.join(app.getPath("userData"), "ayarlar.json");
const BASLANGIC_HTML = path.join(__dirname, "baslangic.html");
const SAYFALAR = {
  ogretmen: "/teacher.html",
  ogrenci: "/student.html",
  test: "/bakis_test.html",
  yonetim: "/admin.html",
};

function paketSunucuYolu() {
  if (!app.isPackaged) return null;
  const ad = process.platform === "win32" ? "dersnabzi-sunucu.exe" : "dersnabzi-sunucu";
  return path.join(process.resourcesPath, "sunucu", ad);
}

// ---------------------------------------------------------------- durum
let ayar = null;
let calisan = null;        // { port, surec, durdur }
let sunucuKoken = null;    // "http://127.0.0.1:PORT" (yalnız sunucu hazırken)
let durum = { asama: "basliyor", port: null, veriKlasoru: null, hata: null, zorla: !!VERI_ZORLA, oneDrive: false, kameraUyari: null };
let baslangicPenceresi = null;
const sayfaPencereleri = new Set();
let cikiliyor = false;

function veriKlasoru() {
  return VERI_ZORLA || ayar.veriKlasoru;
}

function durumYayinla(yeni) {
  durum = { ...durum, ...yeni, zorla: !!VERI_ZORLA };
  durum.oneDrive = ayarlar.oneDriveAltindaMi(durum.veriKlasoru || "");
  if (baslangicPenceresi && !baslangicPenceresi.isDestroyed()) {
    baslangicPenceresi.webContents.send("dn:durum", durum);
  }
}

// Sunucu işlemleri sıraya alınır (başlat/durdur/yeniden başlat çakışmasın).
let sira = Promise.resolve();
function sirala(is) {
  const p = sira.then(is, is);
  sira = p.catch(() => {});
  return p;
}

async function sunucuDurdur() {
  const c = calisan;
  calisan = null;
  sunucuKoken = null;
  if (c) await c.durdur();
}

async function sunucuBaslat() {
  const veri = veriKlasoru();
  durumYayinla({ asama: "basliyor", port: null, veriKlasoru: veri, hata: null });
  try {
    fs.mkdirSync(veri, { recursive: true });
    // Sayfa tercihleri (yüz profili, kamera yeri/zoom) localStorage'da, yani kökene (porta) bağlı:
    // son başarılı port önce denenir ki aynı köken korunsun.
    const port = await sunucu.bosPortBul(ayar.sonPort || 8030);
    const { komut, argumanlar } = sunucu.varsayilanKomut(veri, paketSunucuYolu());
    const c = await sunucu.baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 15000 });
    calisan = c;
    sunucuKoken = `http://127.0.0.1:${c.port}`;
    if (ayar.sonPort !== c.port) {
      try {
        ayarlar.kaydet(AYAR_DOSYASI(), { ...ayar, sonPort: c.port });
        ayar = ayarlar.yukle(AYAR_DOSYASI());
      } catch (e) {
        console.error(`Son port kaydedilemedi: ${e.message}`);
      }
    }
    c.surec.once("exit", (kod, sinyal) => sunucuKapandi(c, kod, sinyal));
    durumYayinla({ asama: "hazir", port: calisan.port, veriKlasoru: veri, hata: null });
  } catch (e) {
    calisan = null;
    sunucuKoken = null;
    durumYayinla({ asama: "hata", port: null, veriKlasoru: veri, hata: String(e && e.message ? e.message : e) });
  }
}

// Sunucu kendiliğinden kapandıysa (bilerek durdurulmadıysa: calisan hâlâ bu süreç) hata durumuna geçilir.
function sunucuKapandi(c, kod, sinyal) {
  if (calisan !== c) return;   // sunucuDurdur() önce calisan'ı boşaltır: bilerek durdurma
  calisan = null;
  sunucuKoken = null;
  const neden = kod !== null && kod !== undefined ? `kod ${kod}` : `sinyal ${sinyal}`;
  // Savunma amaçlı: başlangıç ekranı kapanınca uygulama zaten kapanır, bu dal normalde çalışmaz.
  // Yine de ekran yoksa uyarı gösterilebilsin diye yeniden açılır, sonra sayfalar kapatılır.
  if ((!baslangicPenceresi || baslangicPenceresi.isDestroyed()) && !cikiliyor) baslangicPenceresiAc();
  sayfaPencereleriniKapat();   // eski porttaki sayfalar artık çalışmaz
  durumYayinla({ asama: "hata", port: null, hata: `Sunucu beklenmedik şekilde kapandı (${neden}). Açık sayfa pencereleri kapatıldı.` });
  const w = baslangicPenceresi;
  if (w && !w.isDestroyed() && !SMOKE) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
}

function sayfaPencereleriniKapat() {
  for (const w of [...sayfaPencereleri]) {
    w.__dnKapatIzni = true;
    if (!w.isDestroyed()) w.destroy();
  }
  sayfaPencereleri.clear();
}

function sunucuyuYenidenBaslat() {
  return sirala(async () => {
    sayfaPencereleriniKapat();   // eski porttaki sayfalar artık çalışmaz
    try {
      await sunucuDurdur();
    } catch (e) {
      // Eski sunucu hâlâ çalışıyor olabilir: ikinci bir sunucu (aynı veri klasöründe) başlatılmaz.
      console.error(`Sunucu durdurulamadı: ${e.message}`);
      durumYayinla({
        asama: "hata",
        port: null,
        hata: `Önceki sunucu durdurulamadı; ikinci bir sunucu başlatılmadı. Uygulamayı kapatıp yeniden açın.\n${e.message}`,
      });
      return;
    }
    await sunucuBaslat();
  });
}

// ---------------------------------------------------------------- yönetici anahtarı
function yoneticiAnahtariOku() {
  const env = (process.env.DERSNABZI_ADMIN_KEY || "").trim();
  if (env) return env;   // sunucu da önce ortam değişkenine bakar
  try {
    return fs.readFileSync(path.join(veriKlasoru(), "yonetici_anahtari.txt"), "utf8").trim() || null;
  } catch (_) {
    return null;
  }
}

function yonetimSayfasiMi(url) {
  try {
    const u = new URL(url);
    return sunucuKoken !== null && u.origin === sunucuKoken && u.pathname === "/admin.html";
  } catch (_) {
    return false;
  }
}

// Anahtar URL'ye konmaz. İlk yüklemeden sonra sessionStorage'a yazılır, sayfa bir kez yenilenir;
// admin.js anahtarı açılışta sessionStorage'dan okuduğu için ikinci yüklemede doğrudan kullanır.
// Pencere bu süre boyunca gizli kalır (anahtar formu kısa süre görünmesin).
function anahtarEnjeksiyonuKur(win) {
  let enjekteEdildi = false;
  const goster = () => { if (!win.isDestroyed() && !win.isVisible()) win.show(); };
  const yedek = setTimeout(goster, 8000);
  win.once("closed", () => clearTimeout(yedek));
  win.webContents.on("did-finish-load", async () => {
    const wc = win.webContents;
    if (enjekteEdildi || !yonetimSayfasiMi(wc.getURL())) { goster(); return; }
    enjekteEdildi = true;
    const anahtar = yoneticiAnahtariOku();
    if (!anahtar) { goster(); return; }   // dosya yoksa sayfa anahtarı kendisi sorar
    try {
      await wc.executeJavaScript(
        `try { sessionStorage.setItem("dn_admin_key", ${JSON.stringify(anahtar)}); true } catch (e) { false }`,
        true,
      );
      // Yazdıktan sonra da hâlâ aynı köken + yönetim sayfası mı? (araya gezinme girmediyse)
      if (yonetimSayfasiMi(wc.getURL())) wc.reload(); else goster();
    } catch (e) {
      console.error(`Yönetici anahtarı yazılamadı: ${e.message}`);
      goster();
    }
  });
}

// ---------------------------------------------------------------- pencereler
const GUVENLI_WEB = { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };

// Kiosk penceresinde engellenen kısayollar (menü zaten yok; yine de açıkça engellenir).
function kioskKisayoluMu(g, tus) {
  const ctrl = g.control || g.meta;
  if (["f11", "f5", "f12", "browserback", "browserforward", "browserrefresh"].includes(tus)) return true;
  if (g.alt && (tus === "f4" || tus === "arrowleft" || tus === "arrowright")) return true;
  if (ctrl && ["w", "r", "m", "n", "t", "p", "=", "+", "-", "_", "0"].includes(tus)) return true;
  if (ctrl && g.shift && ["i", "j", "c", "r"].includes(tus)) return true;
  return false;
}

function kioskKlavyesiKur(win) {
  const wc = win.webContents;
  let onayAcik = false;
  wc.on("before-input-event", (olay, girdi) => {
    if (girdi.type !== "keyDown") return;
    const tus = (girdi.key || "").toLowerCase();
    if (girdi.control && girdi.shift && tus === "q") {
      olay.preventDefault();
      if (onayAcik) return;   // art arda basışta diyaloglar üst üste açılmaz
      onayAcik = true;
      dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Vazgeç", "Pencereyi kapat"],
        defaultId: 0,
        cancelId: 0,
        title: "DersNabzı",
        message: "Bu pencere kapatılsın mı?",
      }).then(({ response }) => {
        onayAcik = false;
        if (response === 1 && !win.isDestroyed()) { win.__dnKapatIzni = true; win.close(); }
      }).catch(() => { onayAcik = false; });
      return;
    }
    // Esc engellenmez (sayfalarda Vazgeç/Esc çalışsın); sayfa tam ekranından çıkılırsa aşağıda geri girilir.
    if (kioskKisayoluMu(girdi, tus)) olay.preventDefault();
  });

  // Esc ile HTML tam ekranından çıkılınca (pencere kiosk kalır) sayfa tam ekranına hemen geri girilir.
  // Yalnız sunucu kökeninde; başarısızlıkta sonsuz deneme yok: art arda 3 hatadan sonra bırakılır, bir kez loglanır.
  let tamEkranHata = 0;
  let tamEkranLoglandi = false;
  // Yeni sayfaya geçişte sayaç sıfırlanır (önceki sayfadaki başarısızlıklar sonrakini kilitlemesin).
  wc.on("did-navigate", () => { tamEkranHata = 0; tamEkranLoglandi = false; });
  win.on("leave-html-full-screen", () => {
    if (win.isDestroyed() || cikiliyor || tamEkranHata >= 3) return;
    if (sunucuKoken === null || koken(wc.getURL()) !== sunucuKoken) return;
    setTimeout(() => {
      if (win.isDestroyed() || sunucuKoken === null || koken(wc.getURL()) !== sunucuKoken) return;
      wc.executeJavaScript(
        "document.fullscreenElement ? true : document.documentElement.requestFullscreen().then(() => true, () => false)",
        true,
      ).then((ok) => {
        if (ok) { tamEkranHata = 0; win.__dnTamEkranGeriGiris = (win.__dnTamEkranGeriGiris || 0) + 1; return; }
        tamEkranHata++;
        if (tamEkranHata >= 3 && !tamEkranLoglandi) {
          tamEkranLoglandi = true;
          console.error("Kiosk: sayfa tam ekranına geri girilemedi; yeniden denenmeyecek.");
        }
      }).catch(() => { tamEkranHata++; });
    }, 50);
  });

  // Yakınlaştırma 1'de sabit (bakış geometrisi CSS pikseline bağlı).
  const zoomSifirla = () => { if (!win.isDestroyed()) wc.setZoomFactor(1); };
  wc.on("did-finish-load", () => {
    zoomSifirla();
    wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });
  wc.on("zoom-changed", zoomSifirla);
  // Alt+F4 işletim sisteminden doğrudan "close" olarak gelebilir: izin yoksa kapanma.
  win.on("close", (e) => {
    if (!cikiliyor && !win.__dnKapatIzni) e.preventDefault();
  });
}

function gezinmeKilidiKur(wc, kiosk = false) {
  // Kiosk penceresinden dış adresler varsayılan tarayıcıda da açılmaz, atılır.
  const disariAc = (url) => { if (!kiosk && koken(url)) shell.openExternal(url).catch(() => {}); };
  const ayniKoken = (url) => sunucuKoken !== null && koken(url) === sunucuKoken;
  wc.on("will-navigate", (e, url) => {
    if (ayniKoken(url)) return;
    e.preventDefault();
    disariAc(url);
  });
  wc.on("will-redirect", (e, url) => { if (!ayniKoken(url)) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (ayniKoken(url)) {
      sayfaPenceresiAc(new URL(url).pathname + new URL(url).search);
    } else {
      disariAc(url);
    }
    return { action: "deny" };
  });
}

// Ayarlar'daki kamera/çözünürlük seçimi (ayrıntı: kamera.js). Sayfa betiklerinden önce çalışsın diye
// CDP Page.addScriptToEvaluateOnNewDocument ile eklenir; dom-ready'de yedek olarak yeniden çalıştırılır
// (betik ikinci kez çalışırsa hiçbir şey yapmaz). Ayar, pencere açılırken geçerli olan değerdir.
// Seçili kamera sayfada bulunamazsa sayfa konsola bir im yazar; başlangıç ekranında uyarı gösterilir.
async function kameraSarmalayiciKur(win) {
  const wc = win.webContents;
  const cfg = { etiket: ayar.kameraEtiket, cozunurluk: ayar.cozunurluk, koken: sunucuKoken };
  const betik = kameraBetigi({ ...cfg, kaynak: "belge-oncesi" });
  const yedekBetik = kameraBetigi({ ...cfg, kaynak: "dom-ready" });
  const ayniKoken = () => sunucuKoken !== null && koken(wc.getURL()) === sunucuKoken;
  wc.on("dom-ready", () => {
    if (ayniKoken()) wc.executeJavaScript(yedekBetik, false).catch(() => {});
  });
  wc.on("console-message", (olay) => {
    if (olay && olay.message === KAMERA_UYARI_IMI && ayniKoken()) {
      durumYayinla({ kameraUyari: `Seçili kamera (${cfg.etiket || "?"}) bulunamadı; sayfa varsayılan kamerayı kullandı.` });
    }
  });
  try {
    // Hedef (renderer) ilk yüklemeden önce yok: boş sayfa yüklenir, sonra betik kaydedilir; kayıt sonraki
    // tüm belgelerde (sunucu sayfası dahil) sayfa betiklerinden önce çalışır. Takılırsa 5 sn'de vazgeçilir.
    await wc.loadURL("about:blank");
    wc.debugger.attach("1.3");
    const kaydet = async () => {
      await wc.debugger.sendCommand("Page.enable");
      await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: betik });
    };
    await Promise.race([kaydet(), new Promise((_, red) => setTimeout(() => red(new Error("CDP zaman aşımı")), 5000))]);
  } catch (e) {
    console.error(`Kamera sarmalayıcısı belge öncesine eklenemedi (dom-ready yedeği kullanılacak): ${e.message}`);
  }
}

function hedefKioskMu(yol) {
  if (yol.startsWith(SAYFALAR.ogrenci)) return !!ayar.kiosk.ogrenci;
  if (yol.startsWith(SAYFALAR.test)) return !!ayar.kiosk.test;
  return false;
}

function sayfaPenceresiAc(yol, { goster = true, kiosk: kioskZorla } = {}) {
  if (!sunucuKoken) throw new Error("Sunucu hazır değil");
  const kiosk = typeof kioskZorla === "boolean" ? kioskZorla : (SMOKE ? false : hedefKioskMu(yol));
  const yonetim = yol.startsWith(SAYFALAR.yonetim);
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    kiosk,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f9",
    title: "DersNabzı",
    webPreferences: { ...GUVENLI_WEB },   // preload YOK
  });
  win.setMenuBarVisibility(false);
  sayfaPencereleri.add(win);
  win.on("closed", () => sayfaPencereleri.delete(win));
  gezinmeKilidiKur(win.webContents, kiosk);
  if (kiosk) kioskKlavyesiKur(win);
  const adres = sunucuKoken + yol;
  // Önce kamera sarmalayıcısı (boş sayfa + CDP kaydı), sonra asıl sayfa. Yükleme ve gösterme
  // dinleyicileri boş sayfadan SONRA kurulur ki boş sayfanın olayları (ör. did-finish-load) karışmasın.
  kameraSarmalayiciKur(win).finally(() => {
    if (win.isDestroyed()) return;
    if (yonetim) anahtarEnjeksiyonuKur(win);
    // Asıl sayfanın DOM'u hazır olunca gösterilir (ready-to-show boş sayfada tükenir; boş sayfadayken
    // gösterilen kiosk penceresinde sayfanın requestFullscreen isteği smoke'ta takılıyordu).
    else if (goster) win.webContents.once("dom-ready", () => { if (!win.isDestroyed()) win.show(); });
    win.loadURL(adres).catch(() => {});
  });
  return win;
}

function baslangicPenceresiAc() {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f9",
    title: "DersNabzı",
    webPreferences: { ...GUVENLI_WEB, preload: path.join(__dirname, "preload.js") },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (!SMOKE) win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    baslangicPenceresi = null;
    app.quit();   // ana pencere kapanınca uygulama (ve sunucu) kapanır
  });
  baslangicPenceresi = win;
  win.loadFile(BASLANGIC_HTML);
  return win;
}

// ---------------------------------------------------------------- IPC (yalnız başlangıç ekranından)
function baslangictanMi(olay) {
  const f = olay.senderFrame;
  if (!f || !baslangicPenceresi || olay.sender !== baslangicPenceresi.webContents) return false;
  try {
    const a = path.resolve(fileURLToPath(f.url));
    return process.platform === "win32" ? a.toLowerCase() === BASLANGIC_HTML.toLowerCase() : a === BASLANGIC_HTML;
  } catch (_) {
    return false;
  }
}

function ipcKur() {
  const kayit = (kanal, isleyici) => ipcMain.handle(kanal, (olay, ...a) => {
    if (!baslangictanMi(olay)) throw new Error("izin yok");
    return isleyici(...a);
  });
  kayit("dn:durum", () => durum);
  kayit("dn:ayarlar", () => ({ ...ayar, kiosk: { ...ayar.kiosk }, veriKlasoruZorla: VERI_ZORLA || null }));
  kayit("dn:ac", (hedef) => {
    const yol = SAYFALAR[hedef];
    if (!yol) throw new Error(`bilinmeyen hedef: ${hedef}`);
    if (!sunucuKoken) throw new Error("Sunucu hazır değil");
    sayfaPenceresiAc(yol);
    return true;
  });
  kayit("dn:veriKlasoruSec", async () => {
    const r = await dialog.showOpenDialog(baslangicPenceresi, {
      title: "Veri klasörünü seçin",
      defaultPath: veriKlasoru(),
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  kayit("dn:ayarKaydet", async (yeni) => {
    if (!yeni || typeof yeni !== "object") throw new Error("geçersiz ayar");
    const eskiVeri = veriKlasoru();
    const birlesik = {
      ...ayar,
      kiosk: {
        ogrenci: typeof yeni.kiosk?.ogrenci === "boolean" ? yeni.kiosk.ogrenci : ayar.kiosk.ogrenci,
        test: typeof yeni.kiosk?.test === "boolean" ? yeni.kiosk.test : ayar.kiosk.test,
      },
    };
    let kameraDegisti = false;
    if ("kameraEtiket" in yeni || "kameraId" in yeni) {
      birlesik.kameraId = typeof yeni.kameraId === "string" && yeni.kameraId ? yeni.kameraId : null;
      birlesik.kameraEtiket = typeof yeni.kameraEtiket === "string" && yeni.kameraEtiket ? yeni.kameraEtiket : null;
      kameraDegisti = birlesik.kameraEtiket !== ayar.kameraEtiket;
    }
    if ("cozunurluk" in yeni) birlesik.cozunurluk = yeni.cozunurluk || null;   // ayarlar.js doğrular
    if (typeof yeni.veriKlasoru === "string" && yeni.veriKlasoru) {
      if (!path.isAbsolute(yeni.veriKlasoru)) throw new Error("Veri klasörü tam yol olmalı");
      birlesik.veriKlasoru = path.resolve(yeni.veriKlasoru);
    }
    ayarlar.kaydet(AYAR_DOSYASI(), birlesik);
    ayar = ayarlar.yukle(AYAR_DOSYASI());
    if (kameraDegisti) durumYayinla({ kameraUyari: null });
    const yenidenBaslat = veriKlasoru() !== eskiVeri;
    if (yenidenBaslat) sunucuyuYenidenBaslat();   // beklemeden; durum olaylarla gelir
    return { ayar, yenidenBaslat };
  });
  kayit("dn:yenidenDene", () => { sunucuyuYenidenBaslat(); return true; });
}

// ---------------------------------------------------------------- güvenlik: izinler, webview
function oturumKur() {
  const s = session.defaultSession;
  // Sunucu kökeni: kamera/mikrofon, tam ekran, panoya yazma. Başlangıç ekranı: yalnız kamera (Ayarlar'daki
  // kamera listesinin adları için). Karar saf işlevdedir (izin.js).
  const baslangicMi = (wc) => !!wc && !!baslangicPenceresi && !baslangicPenceresi.isDestroyed() && wc === baslangicPenceresi.webContents;
  const karar = (wc, url, izin) => {
    // Yerel dosyanın kökeni "file://" olarak gelir; başlangıç ekranı için tam dosya adresine bakılır.
    const adres = baslangicMi(wc) ? wc.getURL() : url;
    return izinKarari(adres, izin, sunucuKoken, BASLANGIC_HTML);
  };
  s.setPermissionRequestHandler((wc, izin, geri, ayrinti) => {
    geri(karar(wc, (ayrinti && ayrinti.requestingUrl) || wc.getURL(), izin));
  });
  s.setPermissionCheckHandler((wc, izin, istekKoken, ayrinti) => {
    return karar(wc, istekKoken || (ayrinti && ayrinti.requestingUrl) || (wc ? wc.getURL() : ""), izin);
  });
}

app.on("web-contents-created", (_e, wc) => {
  wc.on("will-attach-webview", (e) => e.preventDefault());
  // Paketli sürümde geliştirici araçları açılmaz.
  if (app.isPackaged) wc.on("devtools-opened", () => wc.closeDevTools());
});

// ---------------------------------------------------------------- smoke
async function smokeKos() {
  const zaman = setTimeout(() => { console.error("SMOKE: zaman aşımı"); cikisYap(1); }, 90000);
  const adimlar = [];
  const yaz = (m) => { adimlar.push(m); console.log(`SMOKE: ${m}`); };
  // Takılan adım genel zaman aşımı yerine adıyla raporlansın.
  const adim = (ad, p, ms = 10000) => {
    let z = null;
    return Promise.race([p, new Promise((_, red) => { z = setTimeout(() => red(new Error(`${ad}: ${ms} ms zaman aşımı`)), ms); })])
      .finally(() => clearTimeout(z));
  };
  try {
    yaz(`veri klasörü: ${veriKlasoru()}`);
    yaz(`profil: ${app.getPath("userData")}`);
    await sira;   // sunucu başlatma bitsin
    if (durum.asama !== "hazir") throw new Error(`sunucu hazır değil: ${durum.hata}`);
    yaz(`sunucu hazır, port ${durum.port}`);
    const win = baslangicPenceresi;
    if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once("did-finish-load", r));
    await new Promise((r) => setTimeout(r, 300));
    const ekran = await win.webContents.executeJavaScript(
      `({ durum: document.getElementById("durumMetni").textContent, dugme: document.querySelectorAll("[data-hedef]").length, api: typeof window.masaustu, node: typeof require })`,
    );
    yaz(`başlangıç ekranı: ${JSON.stringify(ekran)}`);
    if (ekran.dugme !== 4 || ekran.api !== "object" || ekran.node !== "undefined") throw new Error("başlangıç ekranı beklenen gibi değil");
    if (!(await sunucu.saglikVar(durum.port, calisan.oturum))) throw new Error("/api/saglik yanıt vermiyor");
    yaz("/api/saglik ok");
    const anahtar = yoneticiAnahtariOku();
    yaz(`yönetici anahtarı dosyası: ${anahtar ? "okundu" : "YOK"}`);
    if (!anahtar) throw new Error("yönetici anahtarı okunamadı");
    // Yönetim penceresi: anahtar enjeksiyonu + yeniden yükleme
    const yw = sayfaPenceresiAc(SAYFALAR.yonetim);
    await new Promise((coz, red) => {
      const t = setTimeout(() => red(new Error("yönetim penceresi gösterilmedi")), 20000);
      yw.once("show", () => { clearTimeout(t); coz(); });
    });
    await new Promise((r) => setTimeout(r, 1500));
    const y = await yw.webContents.executeJavaScript(
      `({ esit: sessionStorage.getItem("dn_admin_key") === ${JSON.stringify(anahtar)}, anahtarsiz: document.body.classList.contains("anahtarsiz"), url: location.href })`,
    );
    yaz(`yönetim: anahtar eşit=${y.esit}, anahtar formu açık=${y.anahtarsiz}, url anahtar içeriyor=${y.url.includes(anahtar)}`);
    if (!y.esit || y.anahtarsiz || y.url.includes(anahtar)) throw new Error("yönetici anahtarı enjeksiyonu başarısız");
    // İzin kontrolü (gerçek oturum işleyicisi)
    const kamera = await yw.webContents.executeJavaScript(
      `navigator.permissions.query({ name: "camera" }).then((p) => p.state).catch((e) => "hata: " + e.message)`,
    );
    yaz(`sunucu kökeninde kamera izni durumu: ${kamera}`);
    yaz(`uygulama menüsü: ${Menu.getApplicationMenu() === null ? "yok" : "VAR"}`);
    if (Menu.getApplicationMenu() !== null) throw new Error("uygulama menüsü kaldırılmadı");

    // Son başarılı port ayarlara yazıldı mı (bir sonraki açılışta önce o denenir)?
    yaz(`son port ayarı: ${ayar.sonPort}`);
    if (ayar.sonPort !== durum.port) throw new Error("son port kaydedilmedi");
    yaz(`OneDrive uyarısı: ${durum.oneDrive}`);
    const kSec = await win.webContents.executeJavaScript(
      `(async () => {
        const r = { secenek: document.getElementById("kameraSec").options.length, cozunurluk: document.getElementById("cozunurlukSec").options.length };
        try {
          const l = await Promise.race([navigator.mediaDevices.enumerateDevices(), new Promise((_, red) => setTimeout(() => red(new Error("yanıt yok")), 3000))]);
          const v = l.filter((d) => d.kind === "videoinput");
          r.kamera = v.length; r.adli = v.filter((d) => d.label).length;
        } catch (e) { r.aygitListesi = e.message; }   // bazı ortamlarda (ör. kamerasız sanal makine) yanıt gelmez
        return r;
      })()`,
    );
    yaz(`başlangıç ekranı kamera listesi: ${JSON.stringify(kSec)}`);
    if (kSec.cozunurluk !== 3 || kSec.secenek < 1) throw new Error("kamera/çözünürlük seçimi ekranda yok");

    // Kiosk penceresi: Esc ile tam ekrandan çıkınca geri girilir; Ctrl+R / Ctrl+= engelli, zoom 1.
    // Bu pencere için kamera seçimi bellekte ayarlanır (dosyaya yazılmaz): sarmalayıcı sayfada olmalı.
    const ayarOnce = ayar;
    ayar = { ...ayar, kameraEtiket: "Smoke Kamera", cozunurluk: { w: 1280, h: 720 } };
    const kw = sayfaPenceresiAc(SAYFALAR.test, { kiosk: true });
    ayar = ayarOnce;
    await new Promise((coz, red) => {
      // Önce boş sayfa yüklenir (kamera sarmalayıcısı kaydı); sunucu sayfasının yüklenmesi beklenir.
      const t = setTimeout(() => red(new Error("kiosk penceresi yüklenmedi")), 20000);
      const f = () => {
        if (koken(kw.webContents.getURL()) !== sunucuKoken) return;
        kw.webContents.removeListener("did-finish-load", f);
        clearTimeout(t);
        coz();
      };
      kw.webContents.on("did-finish-load", f);
    });
    const kam = await kw.webContents.executeJavaScript(
      `({ var: !!window.__dnKamera, kaynak: window.__dnKamera && window.__dnKamera.kaynak, etiket: window.__dnKamera && window.__dnKamera.etiket, cozunurluk: window.__dnKamera && window.__dnKamera.cozunurluk, sarili: !String(navigator.mediaDevices.getUserMedia).includes("[native code]") })`,
    );
    yaz(`kamera sarmalayıcısı: ${JSON.stringify(kam)}`);
    if (!kam.var || kam.etiket !== "Smoke Kamera" || !kam.sarili || kam.kaynak !== "belge-oncesi") throw new Error("kamera sarmalayıcısı sayfada yok (ya da sayfa betiklerinden önce eklenmedi)");
    // "Seçili kamera bulunamadı" imi başlangıç ekranına ulaşıyor mu? (gerçek kamera açılmadan, imin kendisiyle)
    await kw.webContents.executeJavaScript(`console.warn(${JSON.stringify(KAMERA_UYARI_IMI)})`);
    await new Promise((r) => setTimeout(r, 400));
    const kamUyari = await win.webContents.executeJavaScript(
      `({ gorunur: !document.getElementById("kameraUyari").classList.contains("hidden"), metin: document.getElementById("kameraUyari").textContent })`,
    );
    yaz(`kamera uyarısı başlangıç ekranında: ${JSON.stringify(kamUyari)}`);
    if (!kamUyari.gorunur || !/bulunamadı/.test(kamUyari.metin)) throw new Error("kamera uyarısı başlangıç ekranına ulaşmadı");
    durumYayinla({ kameraUyari: null });
    await new Promise((r) => setTimeout(r, 800));
    const tamEkranIstek = await adim("tam ekran isteği", kw.webContents.executeJavaScript("document.documentElement.requestFullscreen().then(() => 1, (e) => e.message)", true));
    yaz(`tam ekran isteği: ${tamEkranIstek}`);
    await new Promise((r) => setTimeout(r, 800));
    kw.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    kw.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await new Promise((r) => setTimeout(r, 400));
    const araDurum = await adim("Esc sonrası durum", kw.webContents.executeJavaScript("!!document.fullscreenElement"));
    await new Promise((r) => setTimeout(r, 1200));
    kw.webContents.sendInputEvent({ type: "keyDown", keyCode: "=", modifiers: ["control"] });
    await new Promise((r) => setTimeout(r, 400));
    const k = await adim("kiosk durumu", kw.webContents.executeJavaScript(
      "({ tamEkran: !!document.fullscreenElement, url: location.pathname, dpr: devicePixelRatio })",
    ));
    k.zoom = kw.webContents.getZoomFactor();
    k.kiosk = kw.isKiosk();
    k.escSonrasiHemen = araDurum;
    k.geriGiris = kw.__dnTamEkranGeriGiris || 0;
    yaz(`kiosk: ${JSON.stringify(k)}`);
    if (!k.tamEkran || !k.kiosk || k.zoom !== 1 || k.geriGiris < 1) throw new Error("kiosk tam ekran/zoom beklenen gibi değil");

    // Çökme: sunucu sürecini dışarıdan öldür, hata durumu yayınlanmalı
    const hataBekle = new Promise((coz, red) => {
      const t = setTimeout(() => red(new Error("çökme algılanmadı")), 10000);
      const iv = setInterval(() => { if (durum.asama === "hata") { clearTimeout(t); clearInterval(iv); coz(); } }, 50);
    });
    process.kill(calisan.surec.pid);
    await hataBekle;
    const ekranHata = await win.webContents.executeJavaScript(
      `({ ozet: document.getElementById("hataOzet").textContent, kutu: !document.getElementById("hataKutusu").classList.contains("hidden"), dugmelerKapali: [...document.querySelectorAll("[data-hedef]")].every((b) => b.disabled) })`,
    );
    yaz(`çökme sonrası: durum=${durum.asama}, koken=${sunucuKoken}, sayfa pencereleri=${sayfaPencereleri.size}, ekran=${JSON.stringify(ekranHata)}`);
    if (sunucuKoken !== null || sayfaPencereleri.size !== 0 || !ekranHata.kutu || !ekranHata.dugmelerKapali || !/beklenmedik/.test(ekranHata.ozet)) {
      throw new Error("çökme sonrası durum beklenen gibi değil");
    }
    await sunucuyuYenidenBaslat();
    yaz(`yeniden dene: durum=${durum.asama}, port=${durum.port}`);
    if (durum.asama !== "hazir" || !(await sunucu.saglikVar(durum.port, calisan.oturum))) throw new Error("yeniden başlatma başarısız");
    clearTimeout(zaman);
    yaz("tamam");
    await cikisYap(0);
  } catch (e) {
    clearTimeout(zaman);
    console.error(`SMOKE HATA: ${e.message}`);
    await cikisYap(1);
  }
}

function smokeTemizleyiciBaslat(klasor) {
  // Yalnız os.tmpdir() altındaki dn-smoke-* klasörü (yanlış yolu silmeye karşı).
  const kok = path.resolve(os.tmpdir());
  const hedef = path.resolve(klasor);
  if (path.dirname(hedef) !== kok || !path.basename(hedef).startsWith("dn-smoke-")) return;
  const betik = [
    "const fs = require('fs');",
    "const [pid, hedef] = process.argv.slice(-2);",
    "const yasiyor = () => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };",
    "const son = Date.now() + 30000;",
    "(function dene() {",
    "  if (!yasiyor()) { try { fs.rmSync(hedef, { recursive: true, force: true }); } catch (_) {} }",
    "  if (fs.existsSync(hedef) && Date.now() < son) setTimeout(dene, 300);",
    "})();",
  ].join("\n");
  try {
    const c = require("child_process").spawn(process.execPath, ["-e", betik, String(process.pid), hedef], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    c.unref();
  } catch (e) {
    console.error(`Smoke geçici klasörü silinemeyecek: ${hedef} (${e.message})`);
  }
}

// ---------------------------------------------------------------- yaşam döngüsü
let cikisKodu = 0;
async function cikisYap(kod) {
  cikisKodu = kod;
  cikiliyor = true;
  try { await sirala(sunucuDurdur); } catch (e) { console.error(`Sunucu durdurulamadı: ${e.message}`); }
  if (SMOKE_GECICI) {
    // Geçici veri klasörü hemen silinir. Profil Electron açıkken kilitli olduğundan tüm geçici klasörü,
    // bu süreç bittikten sonra ayrık küçük bir temizleyici (Electron'un kendi Node'u) siler.
    try { fs.rmSync(path.join(SMOKE_GECICI, "veri"), { recursive: true, force: true }); } catch (_) { /* kalır */ }
    smokeTemizleyiciBaslat(SMOKE_GECICI);
  }
  app.exit(cikisKodu);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = baslangicPenceresi;
    if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });

  app.on("before-quit", (e) => {
    if (cikiliyor) return;
    e.preventDefault();
    cikisYap(cikisKodu);
  });
  // Yalnız başlangıç ekranı da kapandıysa çıkılır (çökme işleyicisi sayfaları kapatınca uygulama kapanmaz).
  app.on("window-all-closed", () => {
    if (!baslangicPenceresi || baslangicPenceresi.isDestroyed()) app.quit();
  });

  app.whenReady().then(() => {
    // Paketli uygulamada varsayılan veri klasörü kurulum klasörü dışında: Belgeler/DersNabzı/veri.
    if (app.isPackaged) ayarlar.varsayilanVeriKlasoru(path.join(app.getPath("documents"), "DersNabzı", "veri"));
    ayar = ayarlar.yukle(AYAR_DOSYASI());
    Menu.setApplicationMenu(null);   // varsayılan menü kısayolları (yenile, yakınlaştır, DevTools) kapalı
    oturumKur();
    ipcKur();
    baslangicPenceresiAc();
    sirala(sunucuBaslat);
    if (SMOKE) smokeKos();
  });
}

"use strict";
// Kullanıcı ayarları: tek JSON dosyası. Bozuk dosya yedeklenir, varsayılanlara dönülür.
const fs = require("fs");
const path = require("path");

const DEPO_KOKU = path.resolve(__dirname, "..");
// Geliştirmede tarayıcı sürümüyle aynı <depo>/data; paketli uygulama kurulum klasörü dışında bir yol verir.
let varsayilanVeri = path.join(DEPO_KOKU, "data");
function varsayilanVeriKlasoru(yol) {
  if (yol) varsayilanVeri = path.resolve(yol);
  return varsayilanVeri;
}

// Başlangıç ekranında seçilebilen çözünürlükler (null = Otomatik: sayfanın kendi isteği).
const COZUNURLUKLER = [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }];

function varsayilan() {
  return {
    veriKlasoru: varsayilanVeri,
    kameraId: null,       // başlangıç ekranı kökenindeki deviceId (yalnız seçim listesini işaretlemek için)
    kameraEtiket: null,   // sayfalarda kamera etikete göre bulunur (deviceId kökene göre değişir)
    cozunurluk: null,
    sonPort: null,        // son başarılı port: sayfa tercihleri (localStorage) porta bağlı olduğundan önce o denenir
    kiosk: { ogrenci: true, test: true },
  };
}

function cozunurlukDogrula(c) {
  if (!c || typeof c !== "object") return null;
  const b = COZUNURLUKLER.find((x) => x.w === c.w && x.h === c.h);
  return b ? { ...b } : null;
}

function portDogrula(p) {
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : null;
}

function metinVeyaNull(x) {
  return typeof x === "string" && x ? x : null;
}

function birlestir(ham) {
  const v = varsayilan();
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) throw new Error("ayar nesne değil");
  const kiosk = ham.kiosk && typeof ham.kiosk === "object" ? ham.kiosk : {};
  return {
    veriKlasoru: typeof ham.veriKlasoru === "string" && ham.veriKlasoru ? ham.veriKlasoru : v.veriKlasoru,
    kameraId: metinVeyaNull(ham.kameraId),
    kameraEtiket: metinVeyaNull(ham.kameraEtiket),
    cozunurluk: cozunurlukDogrula(ham.cozunurluk),
    sonPort: portDogrula(ham.sonPort),
    kiosk: {
      ogrenci: typeof kiosk.ogrenci === "boolean" ? kiosk.ogrenci : v.kiosk.ogrenci,
      test: typeof kiosk.test === "boolean" ? kiosk.test : v.kiosk.test,
    },
  };
}

function yukle(dosya) {
  let metin;
  try {
    metin = fs.readFileSync(dosya, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return varsayilan();
    throw e;
  }
  try {
    return birlestir(JSON.parse(metin));
  } catch (_) {
    try {
      fs.renameSync(dosya, `${dosya}.bozuk-${Date.now()}`);
    } catch (e) {
      console.error(`Bozuk ayar dosyası yedeklenemedi (${dosya}): ${e.message}`);
    }
    return varsayilan();
  }
}

function kaydet(dosya, ayar) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  const gecici = `${dosya}.tmp`;
  const yazilacak = birlestir(ayar);
  // Varsayılana eşit veri klasörü yazılmaz: kullanıcı açıkça seçmediyse varsayılan izlenir
  // (varsayılan değişirse, ör. sürüm güncellemesiyle, eski varsayılan kalıcı bir seçim gibi kalmasın).
  if (path.resolve(yazilacak.veriKlasoru) === path.resolve(varsayilanVeri)) delete yazilacak.veriKlasoru;
  fs.writeFileSync(gecici, JSON.stringify(yazilacak, null, 2), "utf8");
  fs.renameSync(gecici, dosya);
}

// Veri klasörü OneDrive ile eşitlenen bir yerde mi? (öğrenci verileri buluta yüklenebilir)
// OneDrive ortam değişkenlerinin gösterdiği klasörlerin altında ya da yolda "OneDrive" / "OneDrive - Kurum"
// adlı bir klasör varsa evet. Windows yolları büyük/küçük harf duyarsız karşılaştırılır.
function oneDriveAltindaMi(yol, ortam = process.env) {
  if (typeof yol !== "string" || !yol) return false;
  const win = path.win32;
  const norm = (p) => win.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  const hedef = norm(yol);
  for (const ad of ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]) {
    const kok = (ortam && typeof ortam[ad] === "string" ? ortam[ad] : "").trim();
    if (!kok) continue;
    const k = norm(kok);
    if (hedef === k || hedef.startsWith(`${k}\\`)) return true;
  }
  return hedef.split(/[\\/]/).some((parca) => /^onedrive( - .+)?$/i.test(parca));
}

module.exports = { yukle, kaydet, varsayilan, varsayilanVeriKlasoru, oneDriveAltindaMi, COZUNURLUKLER };

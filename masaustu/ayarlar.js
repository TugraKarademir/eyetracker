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

function varsayilan() {
  return {
    veriKlasoru: varsayilanVeri,
    kameraId: null,
    cozunurluk: null,
    kiosk: { ogrenci: true, test: true },
  };
}

function birlestir(ham) {
  const v = varsayilan();
  if (!ham || typeof ham !== "object" || Array.isArray(ham)) throw new Error("ayar nesne değil");
  const kiosk = ham.kiosk && typeof ham.kiosk === "object" ? ham.kiosk : {};
  return {
    veriKlasoru: typeof ham.veriKlasoru === "string" && ham.veriKlasoru ? ham.veriKlasoru : v.veriKlasoru,
    kameraId: typeof ham.kameraId === "string" ? ham.kameraId : null,
    cozunurluk: ham.cozunurluk && typeof ham.cozunurluk === "object" ? ham.cozunurluk : null,
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
  fs.writeFileSync(gecici, JSON.stringify(birlestir(ayar), null, 2), "utf8");
  fs.renameSync(gecici, dosya);
}

module.exports = { yukle, kaydet, varsayilan, varsayilanVeriKlasoru };

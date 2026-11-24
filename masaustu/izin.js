"use strict";
// Saf izin kararları. Sunucunun tam kökenine: kamera/mikrofon ("media"), HTML tam ekran ve panoya
// temizlenmiş yazma ("clipboard-sanitized-write", ör. ders kodunu kopyala). Başlangıç ekranına
// (yerel dosya) yalnız "media": Ayarlar'daki kamera listesinin adlarını görmek için.
const { fileURLToPath } = require("url");
const path = require("path");

function koken(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

function ayniKoken(kokenUrl, sunucuKoken) {
  const istek = koken(kokenUrl);
  const sunucu = koken(sunucuKoken);
  return istek !== null && sunucu !== null && istek === sunucu;
}

function izinVerilsinMi(kokenUrl, izin, sunucuKoken) {
  if (izin !== "media") return false;
  return ayniKoken(kokenUrl, sunucuKoken);
}

// Sayfalar requestFullscreen kullanır: HTML tam ekranı da yalnız sunucunun tam kökenine verilir.
function tamEkranVerilsinMi(kokenUrl, sunucuKoken) {
  return ayniKoken(kokenUrl, sunucuKoken);
}

// Pano: yalnız yazma (okuma değil), yalnız sunucunun tam kökeni.
function panoYazmaVerilsinMi(kokenUrl, sunucuKoken) {
  return ayniKoken(kokenUrl, sunucuKoken);
}

// Başlangıç ekranı dosyası mı? (file: URL'si tam olarak bu dosya)
function baslangicDosyasiMi(url, baslangicYolu) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "file:" || !baslangicYolu) return false;
    const a = path.resolve(fileURLToPath(u));
    const b = path.resolve(baslangicYolu);
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch (_) {
    return false;
  }
}

// Tek karar noktası (oturum izin işleyicileri bunu çağırır).
function izinKarari(url, izin, sunucuKoken, baslangicYolu) {
  if (izin === "fullscreen") return tamEkranVerilsinMi(url, sunucuKoken);
  if (izin === "clipboard-sanitized-write") return panoYazmaVerilsinMi(url, sunucuKoken);
  if (izin === "media" && baslangicDosyasiMi(url, baslangicYolu)) return true;
  return izinVerilsinMi(url, izin, sunucuKoken);
}

module.exports = { izinVerilsinMi, tamEkranVerilsinMi, panoYazmaVerilsinMi, baslangicDosyasiMi, izinKarari, koken };

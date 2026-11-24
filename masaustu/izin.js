"use strict";
// Saf izin kararı: yalnız sunucunun tam kökeni ve yalnız "media" (kamera/mikrofon) izni.

function koken(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

function izinVerilsinMi(kokenUrl, izin, sunucuKoken) {
  if (izin !== "media") return false;
  const istek = koken(kokenUrl);
  const sunucu = koken(sunucuKoken);
  return istek !== null && sunucu !== null && istek === sunucu;
}

// Sayfalar requestFullscreen kullanır: HTML tam ekranı da yalnız sunucunun tam kökenine verilir.
function tamEkranVerilsinMi(kokenUrl, sunucuKoken) {
  const istek = koken(kokenUrl);
  const sunucu = koken(sunucuKoken);
  return istek !== null && sunucu !== null && istek === sunucu;
}

module.exports = { izinVerilsinMi, tamEkranVerilsinMi, koken };

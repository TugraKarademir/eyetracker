import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { izinVerilsinMi, tamEkranVerilsinMi, panoYazmaVerilsinMi, baslangicDosyasiMi, izinKarari } = createRequire(import.meta.url)("../izin.js");

const S = "http://127.0.0.1:8030";

test("aynı köken + media: izin verilir", () => {
  assert.equal(izinVerilsinMi("http://127.0.0.1:8030/student.html", "media", S), true);
  assert.equal(izinVerilsinMi("http://127.0.0.1:8030", "media", S), true);
  assert.equal(izinVerilsinMi("http://127.0.0.1:8030/", "media", `${S}/`), true);
});

test("başka köken: izin yok", () => {
  assert.equal(izinVerilsinMi("http://127.0.0.1:8031/student.html", "media", S), false);
  assert.equal(izinVerilsinMi("http://localhost:8030/student.html", "media", S), false);
  assert.equal(izinVerilsinMi("https://127.0.0.1:8030/", "media", S), false);
  assert.equal(izinVerilsinMi("https://ornek.com/", "media", S), false);
  assert.equal(izinVerilsinMi("file:///C:/baslangic.html", "media", S), false);
  assert.equal(izinVerilsinMi("null", "media", S), false);
  assert.equal(izinVerilsinMi("", "media", S), false);
  assert.equal(izinVerilsinMi(undefined, "media", S), false);
});

test("aynı köken başka izin: izin yok", () => {
  for (const izin of ["geolocation", "notifications", "clipboard-read", "display-capture", "openExternal", "fullscreen", "", undefined]) {
    assert.equal(izinVerilsinMi(`${S}/student.html`, izin, S), false, String(izin));
  }
});

test("sunucu kökeni yoksa: izin yok", () => {
  assert.equal(izinVerilsinMi(`${S}/student.html`, "media", null), false);
  assert.equal(izinVerilsinMi(`${S}/student.html`, "media", ""), false);
});

test("tam ekran: yalnız sunucunun tam kökeni", () => {
  assert.equal(tamEkranVerilsinMi(`${S}/bakis_test.html`, S), true);
  assert.equal(tamEkranVerilsinMi("http://127.0.0.1:8031/", S), false);
  assert.equal(tamEkranVerilsinMi("http://localhost:8030/", S), false);
  assert.equal(tamEkranVerilsinMi("https://ornek.com/", S), false);
  assert.equal(tamEkranVerilsinMi("file:///C:/baslangic.html", S), false);
  assert.equal(tamEkranVerilsinMi(`${S}/`, null), false);
});

test("pano yazma: yalnız sunucunun tam kökeni ve yalnız clipboard-sanitized-write", () => {
  assert.equal(panoYazmaVerilsinMi(`${S}/teacher.html`, S), true);
  assert.equal(panoYazmaVerilsinMi("http://127.0.0.1:8031/", S), false);
  assert.equal(panoYazmaVerilsinMi("https://ornek.com/", S), false);
  assert.equal(panoYazmaVerilsinMi(`${S}/`, null), false);
  assert.equal(izinKarari(`${S}/teacher.html`, "clipboard-sanitized-write", S, null), true);
  assert.equal(izinKarari("https://ornek.com/", "clipboard-sanitized-write", S, null), false);
  assert.equal(izinKarari(`${S}/teacher.html`, "clipboard-read", S, null), false);
});

test("başlangıç ekranı dosyası: yalnız media, yalnız o dosya", () => {
  const dosya = path.resolve("baslangic.html");
  const url = pathToFileURL(dosya).href;
  assert.equal(baslangicDosyasiMi(url, dosya), true);
  assert.equal(izinKarari(url, "media", S, dosya), true);
  assert.equal(izinKarari(url, "fullscreen", S, dosya), false);
  assert.equal(izinKarari(url, "geolocation", S, dosya), false);
  assert.equal(izinKarari(url, "clipboard-sanitized-write", S, dosya), false);
  assert.equal(izinKarari(pathToFileURL(path.resolve("baska.html")).href, "media", S, dosya), false);
  assert.equal(izinKarari(url, "media", S, null), false);
  assert.equal(izinKarari("file:///", "media", S, dosya), false);
});

test("izinKarari mevcut kararlarla aynı", () => {
  assert.equal(izinKarari(`${S}/student.html`, "media", S, null), true);
  assert.equal(izinKarari(`${S}/student.html`, "fullscreen", S, null), true);
  assert.equal(izinKarari("http://127.0.0.1:8031/", "media", S, null), false);
  assert.equal(izinKarari(`${S}/`, "notifications", S, null), false);
});

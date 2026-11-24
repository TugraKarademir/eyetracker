import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { izinVerilsinMi } = createRequire(import.meta.url)("../izin.js");

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

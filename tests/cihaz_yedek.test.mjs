// static/cihaz.js (tam cihaz bilgisi toplama, sahte tarayıcı ortamıyla) ve static/yedek.js (yerel yedek CSV / dosya adı).
// Çalıştırma: node tests/cihaz_yedek.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const yukle = (ad, ek = {}) => {
  const ctx = vm.createContext({ setTimeout, clearTimeout, Promise, Intl, TextEncoder, Uint8Array, Symbol, Date, JSON, Math, String, Object, Array, ...ek });
  vm.runInContext(fs.readFileSync(new URL(`../static/${ad}`, import.meta.url), "utf8"), ctx);
  return ctx;
};

// ---- yedek.js
{
  const { DNYedek: Y } = yukle("yedek.js");
  const csv = Y.csvMetni([{ baslik: "Yöntemler", rows: [{ Kod: "biz", "GL px": 120 }, { Kod: "=HYPERLINK(\"x\")", "GL px": null, ek: "-1" }] },
                          { baslik: "Boş", rows: [] }]);
  assert.ok(csv.startsWith("﻿"));
  const L = csv.slice(1).split("\r\n");
  assert.deepEqual(L, ['"# Yöntemler"', '"Kod";"GL px";"ek"', '"biz";"120";""', `"'=HYPERLINK(""x"")";"";"'-1"`, "", '"# Boş"', '"veri yok"']);
  console.log("1) bölümlü CSV, tırnak kaçışı ve formül koruması: tamam");

  assert.equal(Y.dosyaAdi("ab12", "Şule Çağrı İnce", new Date(2026, 10, 25, 9, 5), "bakis.json"), "dersnabzi_AB12_sule-cagri-ince_20261125_0905_bakis.json");
  assert.equal(Y.dosyaAdi(null, "", new Date(2026, 0, 2, 3, 4), "ders.csv"), "dersnabzi_DERSYOK_adsiz_20260102_0304_ders.csv");
  assert.equal(Y.dosyaAdi("X", "../../a\\b", new Date(2026, 0, 2, 3, 4), "ders.csv"), "dersnabzi_X_a-b_20260102_0304_ders.csv");
  console.log("2) dosya adı (ders, ad kısaltması, yerel saat): tamam");

  const r = Y.dersSatiri({ attention: 71, energy: 80, emotion: "neutral", face: true, lookingAway: false, eyesClosed: false, tabHidden: false,
    hse: { top: "Happiness", p: 0.6, valence: 0.3, arousal: -0.1 }, gaze: { cal: true, region: "materyal", share: { materyal: 0.75 } } }, Date.UTC(2026, 10, 25, 8, 0, 0));
  assert.deepEqual({ ...r }, { zaman: "2026-11-25T08:00:00.000Z", dikkat: 71, enerji: 80, duygu: "neutral", hse_sinif: "Happiness", hse_oran: 0.6, hse_valence: 0.3,
    hse_arousal: -0.1, bakis_bolgesi: "materyal", materyal_payi: 0.75, bakis_kalibre: 1, yuz: 1, ekran_disi: 0, gozler_kapali: 0, sekme_gizli: 0 });
  const bos = Y.dersSatiri({ attention: 50, energy: 60, face: false, hse: null, gaze: null }, 0);
  assert.equal(bos.hse_sinif, ""); assert.equal(bos.bakis_bolgesi, ""); assert.equal(bos.materyal_payi, ""); assert.equal(bos.gozler_kapali, "");
  console.log("3) ders satırı yalnız gönderilen alanlardan (yoksa boş): tamam");

  const J = (v) => JSON.parse(JSON.stringify(v));   // vm alanındaki diziler başka Array prototipi taşır
  const d = J(Y.duzSatirlar({ a: { b: 1, c: null }, l: ["x"], e: {} }, "k"));
  assert.deepEqual(d, [{ Alan: "k.a.b", "Değer": 1 }, { Alan: "k.a.c", "Değer": "" }, { Alan: "k.l.0", "Değer": "x" }, { Alan: "k.e", "Değer": "" }]);
  assert.deepEqual(J(Y.duzSatirlar(null, "cihazOzet")), [{ Alan: "cihazOzet", "Değer": "" }]);
  console.log("4) cihaz verisi düz satırlar: tamam");
}

// ---- cihaz.js
const canvas = (gl) => ({ getContext: (t) => gl[t] ?? null });
{
  // Chromium benzeri: UA-CH, WebGL bilgisi, WebGPU, kamera izi
  const webgl = { getExtension: (x) => (x === "WEBGL_debug_renderer_info" ? { UNMASKED_VENDOR_WEBGL: 1, UNMASKED_RENDERER_WEBGL: 2 } : x === "WEBGL_lose_context" ? { loseContext() {} } : null),
                  getParameter: (k) => ({ 1: "Google Inc. (Intel)", 2: "ANGLE (Intel, UHD 620)" })[k] };
  const E = {
    navigator: { userAgent: "Mozilla/5.0 Chrome/131", hardwareConcurrency: 4, deviceMemory: 8, language: "tr-TR", languages: ["tr-TR", "en"], platform: "Win32", maxTouchPoints: 0,
      userAgentData: { brands: [{ brand: "Google Chrome", version: "131" }], mobile: false, platform: "Windows",
        getHighEntropyValues: async () => ({ platformVersion: "15.0.0", architecture: "x86", bitness: "64", model: "", wow64: false, fullVersionList: [{ brand: "Google Chrome", version: "131.0.1" }] }) },
      gpu: { requestAdapter: async () => ({ info: { vendor: "intel", architecture: "gen-9", device: "", description: "" } }) },
      connection: { effectiveType: "4g", downlink: 10, rtt: 50, type: undefined },
      mediaDevices: { enumerateDevices: async () => [{ kind: "videoinput", label: "HD Webcam" }, { kind: "audioinput", label: "Mic" }] } },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, isExtended: false },
    window: { devicePixelRatio: 1, innerWidth: 1900, innerHeight: 1000, outerWidth: 1920, outerHeight: 1040 },
    document: { createElement: () => canvas({ webgl, webgl2: webgl }), fullscreenElement: {} },
    performance: { memory: { jsHeapSizeLimit: 4294705152 } }, crypto: webcrypto, crossOriginIsolated: false,
  };
  const track = { label: "HD Webcam", getSettings: () => ({ width: 1280, height: 720, frameRate: 30.000030517578125, deviceId: "abc", groupId: "g", resizeMode: "none" }),
                  getCapabilities: () => ({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } }) };
  const { cihazTamTopla } = yukle("cihaz.js");
  const c = await cihazTamTopla({ track, delegate: "GPU", isci: true }, E);
  assert.equal(c.tarayici.uaYuksek.platformVersion, "15.0.0");
  assert.equal(c.tarayici.uaYuksek.fullVersionList[0].version, "131.0.1");
  assert.equal(c.islemci.mantiksalCekirdek, 4);
  assert.equal(c.islemci.cpuModel, null); assert.equal(c.islemci.cpuModelNeden, "tarayıcı vermez");
  assert.equal(c.bellek.deviceMemoryGB, 8); assert.equal(c.bellek.jsHeapLimitMB, 4096);
  assert.equal(c.gpu.webglRenderer, "ANGLE (Intel, UHD 620)"); assert.equal(c.gpu.webgl2, true); assert.equal(c.gpu.webgpuAdapter.architecture, "gen-9");
  assert.equal(c.ekran.tamEkran, true); assert.equal(c.ekran.genisletilmis, false);
  assert.equal(c.kamera.label, "HD Webcam"); assert.equal(c.kamera.ayar.frameRate, 30); assert.equal(c.kamera.ayar.width, 1280);
  assert.match(c.kamera.ayar.deviceIdOz, /^[0-9a-f]{12}$/); assert.notEqual(c.kamera.ayar.deviceIdOz, "abc");
  assert.equal(c.kamera.yetenek.maxWidth, 1920); assert.equal(c.kamera.videoGirisSayisi, 1);
  assert.equal(c.ag.type, null); assert.equal(c.ag.rttMs, 50);
  assert.equal(c.diger.mediapipeDelegate, "GPU"); assert.equal(c.diger.isci, true);
  console.log("5) cihaz toplama (Chromium benzeri ortam): tamam");
}
{
  // Hiçbir şey vermeyen tarayıcı: hepsi null + neden, hata yok, uydurma yok
  const E = { navigator: { userAgent: "UA" }, screen: {}, window: {}, document: { createElement: () => canvas({}), fullscreenElement: null } };
  const { cihazTamTopla } = yukle("cihaz.js");
  const c = await cihazTamTopla({}, E);
  assert.equal(c.tarayici.uaVeri, null); assert.match(c.tarayici.uaYuksekNeden, /tarayıcı vermez/);
  assert.equal(c.islemci.mantiksalCekirdek, null); assert.equal(c.bellek.deviceMemoryGB, null); assert.equal(c.bellek.bellekNot, "tarayıcı vermez");
  assert.equal(c.gpu.webglRenderer, null); assert.equal(c.gpu.webglNeden, "WebGL yok"); assert.equal(c.gpu.webgpu, false);
  assert.equal(c.kamera.label, null); assert.equal(c.kamera.neden, "kamera izi yok"); assert.equal(c.kamera.videoGirisSayisi, null);
  assert.equal(c.ag, null); assert.equal(c.ekran.width, null);
  console.log("6) cihaz toplama (bilgi vermeyen ortam: null + neden): tamam");
}
console.log("cihaz_yedek: TAMAM");

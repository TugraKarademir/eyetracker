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
  const J = (v) => JSON.parse(JSON.stringify(v));   // vm alanındaki diziler başka Array prototipi taşır
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
  // eski 15 sütun aynı adla ve aynı değerle duruyor (yeni sütunlar eklendi)
  const eski = { zaman: "2026-11-25T08:00:00.000Z", dikkat: 71, enerji: 80, duygu: "neutral", hse_sinif: "Happiness", hse_oran: 0.6, hse_valence: 0.3,
    hse_arousal: -0.1, bakis_bolgesi: "materyal", materyal_payi: 0.75, bakis_kalibre: 1, yuz: 1, ekran_disi: 0, gozler_kapali: 0, sekme_gizli: 0 };
  for (const [k, v] of Object.entries(eski)) assert.equal(r[k], v, k);
  assert.equal(r.share_materyal, 0.75); assert.equal(r.kal_var, 0); assert.equal(r.sunucu, "");
  const bos = Y.dersSatiri({ attention: 50, energy: 60, face: false, hse: null, gaze: null }, 0);
  assert.equal(bos.hse_sinif, ""); assert.equal(bos.bakis_bolgesi, ""); assert.equal(bos.materyal_payi, ""); assert.equal(bos.gozler_kapali, "");
  console.log("3) ders satırı yalnız gönderilen alanlardan (yoksa boş): tamam");

  // Yerel zaman (saat dilimi ne olursa olsun yerel saat okunur) ve saat farklı ISO
  const tY = new Date(2026, 10, 25, 9, 5, 7, 45).getTime();
  assert.equal(Y.yerelZaman(tY), "2026-11-25 09:05:07.045");
  assert.match(Y.yerelIso(tY), /^2026-11-25T09:05:07\.045[+-]\d\d:\d\d$/);
  assert.equal(Date.parse(Y.yerelIso(tY)), tY);

  // Tam CSV: bölge birleşimi, kalibreli pakette görülmeyen bölge 0, kalibresizde boş; pts/scr JSON; ekran, kurulum, kal, ham
  const ham = { n: 6, yuzN: 5, ms: 1980, yaw: { ort: 0.01, min: -0.02, max: 0.03 }, ear: { ort: 0.3, min: 0.2 }, kirpma: 1,
    ifade: { happy: 0.2, neutral: 0.7 }, pose3: null, islemeFps: 21.5, isciGecikmeMs: null };
  const K = [
    { t: tY, sunucu: "ok", govde: { attention: 70, energy: 80, emotion: "notr", face: true, lookingAway: false, eyesClosed: false, tabHidden: false,
      gaze: { cal: true, region: "materyal", share: { materyal: 0.8, sayfa: 0.2 }, pts: [[0.1, 0.2], [0.3, 0.4]], scr: [[-500, 0.5, 0.5]], wgShare: { materyal: 1 } },
      ekran: { sw: 1920, sh: 1080, vw: 1900, vh: 1000, dpr: 1, fs: true, mobil: false },
      kurulum: { kamera: "1280x720", fps: 30, isci: true, gecikmeMs: null, cihaz2: { cekirdek: 4 } },
      kal: { at: 5, acc: 57.4, hit3: 100 }, ham } },
    { t: tY + 2000, sunucu: "hata: Ders aktif değil", govde: { attention: 60, energy: 79, emotion: "notr", face: true,
      gaze: { cal: true, region: "sohbet", share: { sohbet: 1 }, pts: [], scr: [] } } },
    { t: tY + 4000, sunucu: null, govde: { attention: 50, energy: 78, emotion: "notr", face: false, gaze: { cal: false, coarse: true, share: { disari: 0.4 } } } },
    { t: tY + 6000, sunucu: "ok", govde: { attention: 50, energy: 78, emotion: "notr", face: false, gaze: { cal: false, why: "pencere" } } },
  ];
  const S = J(Y.dersCsvSatirlari(K));
  assert.equal(S.length, 4);
  const sut = Object.keys(S[0]);
  for (const r2 of S) assert.deepEqual(Object.keys(r2), sut);   // her satır aynı sütunlar, aynı sırada
  const i0 = sut.indexOf("bakis_neden");
  assert.deepEqual(sut.slice(i0 + 1, i0 + 6), ["share_disari", "share_materyal", "share_sayfa", "share_sohbet", "wgshare_materyal"]);
  assert.deepEqual(sut.slice(0, 3), ["yerel_zaman", "zaman", "sunucu"]);
  assert.equal(S[0].yerel_zaman, "2026-11-25 09:05:07.045");
  assert.equal(S[0].zaman, new Date(tY).toISOString());
  assert.deepEqual([S[0].share_materyal, S[0].share_sayfa, S[0].share_sohbet, S[0].share_disari], [0.8, 0.2, 0, 0]);
  assert.deepEqual([S[1].share_materyal, S[1].share_sohbet, S[1].sunucu], [0, 1, "hata: Ders aktif değil"]);
  assert.deepEqual([S[2].share_materyal, S[2].share_disari, S[2].bakis_kaba, S[2].sunucu], ["", 0.4, 1, "bekliyor"]);
  assert.deepEqual([S[3].share_materyal, S[3].bakis_neden, S[3].pts_sayisi], ["", "pencere", ""]);
  assert.deepEqual([S[0].pts_sayisi, S[0].pts_json, S[0].scr_sayisi, S[0].scr_json], [2, "[[0.1,0.2],[0.3,0.4]]", 1, "[[-500,0.5,0.5]]"]);
  assert.deepEqual([S[1].pts_sayisi, S[1].pts_json], [0, "[]"]);
  assert.deepEqual([S[0].ekran_sw, S[0].ekran_fs, S[0].ekran_mobil, S[1].ekran_sw], [1920, 1, 0, ""]);
  assert.deepEqual([S[0].kur_kamera, S[0].kur_isci, S[0].kur_gecikmeMs], ["1280x720", 1, ""]);
  assert.ok(!("kur_cihaz2" in S[0]) && !sut.some((c) => c.startsWith("kur_cihaz2")));   // iç içe cihaz bilgisi yalnız JSON dosyasında
  assert.deepEqual([S[0].kal_var, S[0].kal_acc, S[0].kal_hit3, S[1].kal_var], [1, 57.4, 100, 0]);
  assert.deepEqual([S[0].ham_n, S[0].ham_yaw_ort, S[0].ham_yaw_min, S[0].ham_ear_min, S[0].ham_kirpma, S[0].ham_ifade_happy, S[0].ham_pose3, S[0].ham_isciGecikmeMs],
                   [6, 0.01, -0.02, 0.2, 1, 0.2, "", ""]);
  assert.equal(S[1].ham_n, "");
  const csv2 = Y.csvMetni([{ baslik: "Ders", rows: Y.dersCsvSatirlari(K) }]).slice(1).split("\r\n");
  assert.equal(csv2.length, 2 + 4);
  assert.ok(csv2[2].includes('"[[-500,0.5,0.5]]"') && csv2[2].includes('"[[0.1,0.2],[0.3,0.4]]"'));
  assert.ok(csv2[3].includes(`"hata: Ders aktif değil"`));
  // formül koruması yeni metin sütunlarında da: "-" ile başlayan neden metni
  const kf = J(Y.dersCsvSatirlari([{ t: 0, sunucu: "ok", govde: { gaze: { cal: false, why: "=1+1" } } }]));
  assert.ok(Y.csvMetni([{ baslik: "x", rows: kf }]).includes(`"'=1+1"`));
  console.log("3b) tam ders CSV'si (bölge birleşimi, yerel zaman, pts/scr JSON, ekran, kurulum, kal, ham): tamam");

  // Kayıpsız JSON: gövdenin aynısı + t + yerel ISO + sunucu yanıtı
  const js = JSON.parse(Y.dersJson(K));
  assert.equal(js.length, 4);
  assert.deepEqual(js[0].govde, J(K[0].govde));
  assert.deepEqual([js[0].t, js[0].sunucu, js[2].sunucu, js[1].sunucu], [tY, "ok", "bekliyor", "hata: Ders aktif değil"]);
  assert.equal(js[0].yerel, Y.yerelIso(tY));
  assert.deepEqual(JSON.parse(Y.dersJson([])), []);
  {
    const B = { cihazTam: { a: 1, b: [2] } }, C = { cihazTam: { a: 2 } };
    const kk = [B, B, C, C].map((kur, i) => ({ t: i, sunucu: "ok", govde: { kurulum: { ...kur, fps: 30 } } }));
    const j2 = JSON.parse(Y.dersJson(kk));
    assert.deepEqual(j2.map((r) => r.govde.kurulum.cihazTam), [B.cihazTam, "=onceki", C.cihazTam, "=onceki"]);
    assert.ok(j2[0].not && !j2[1].not && j2[1].govde.kurulum.fps === 30);
    assert.deepEqual(kk[1].govde.kurulum.cihazTam, B.cihazTam);   // özgün gövde değişmez
  }
  console.log("3c) ders JSON yedeği (tam gövde): tamam");

  const d =J(Y.duzSatirlar({ a: { b: 1, c: null }, l: ["x"], e: {} }, "k"));
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

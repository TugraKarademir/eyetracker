import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
const { kameraBetigi, UYARI_IMI } = createRequire(import.meta.url)("../kamera.js");

const KOKEN = "http://localhost:8030";

// Sahte sayfa: getUserMedia çağrılarını kaydeder; aygıt listesi ve hatalar ayarlanabilir.
function sayfa({ aygitlar = [], koken = KOKEN, hata = null } = {}) {
  const cagrilar = [];
  const uyarilar = [];
  const durdurulan = [];
  const akis = (kisit) => {
    const id = kisit.video && kisit.video.deviceId ? kisit.video.deviceId.exact : "varsayilan-id";
    const iz = { getSettings: () => ({ deviceId: id }), stop: () => durdurulan.push(id) };
    return { kisit, getVideoTracks: () => [iz], getTracks: () => [iz] };
  };
  const mediaDevices = {
    async getUserMedia(kisit) {
      cagrilar.push(JSON.parse(JSON.stringify(kisit)));
      if (hata && hata(kisit)) { const e = new Error("x"); e.name = hata(kisit); throw e; }
      return akis(kisit);
    },
    async enumerateDevices() { return typeof aygitlar === "function" ? aygitlar() : aygitlar; },
  };
  const window = {};
  const baglam = { window, navigator: { mediaDevices }, location: { origin: koken }, console: { warn: (m) => uyarilar.push(m) }, setTimeout, clearTimeout };
  vm.createContext(baglam);
  return { baglam, window, mediaDevices, cagrilar, uyarilar, durdurulan };
}

const calistir = (s, cfg) => vm.runInContext(kameraBetigi({ koken: KOKEN, ...cfg }), s.baglam);
const SAYFA_ISTEGI = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false };
const KAMERALAR = [
  { kind: "audioinput", deviceId: "m1", label: "Mikrofon" },
  { kind: "videoinput", deviceId: "sayfa-a", label: "Dahili Kamera" },
  { kind: "videoinput", deviceId: "sayfa-b", label: "USB Kamera" },
];

test("seçili kamera etiketle bulunur, deviceId exact eklenir; başka bir şey değişmez", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, { etiket: "USB Kamera" });
  await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.deepEqual(s.cagrilar, [{ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", deviceId: { exact: "sayfa-b" } }, audio: false }]);
  assert.equal(s.window.__dnKamera.uygulandi, 1);
  assert.deepEqual(s.uyarilar, []);
});

test("çözünürlük seçildiyse width/height ideal olarak verilir; video:true da desteklenir", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, { cozunurluk: { w: 1920, h: 1080 } });
  await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  await s.mediaDevices.getUserMedia({ video: true, audio: true });
  assert.deepEqual(s.cagrilar[0].video, { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" });
  assert.deepEqual(s.cagrilar[1], { video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
});

test("sayfa deviceId belirtmişse ya da video istemiyorsa dokunulmaz", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, { etiket: "USB Kamera", cozunurluk: { w: 1920, h: 1080 } });
  const kendi = { video: { deviceId: "sayfanin" }, audio: false };
  await s.mediaDevices.getUserMedia(kendi);
  await s.mediaDevices.getUserMedia({ audio: true });
  assert.deepEqual(s.cagrilar, [kendi, { audio: true }]);
});

test("ayar yoksa istek aynen geçer", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, {});
  await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.deepEqual(s.cagrilar, [SAYFA_ISTEGI]);
  assert.ok(s.window.__dnKamera);
});

test("seçili kamera yoksa sayfanın varsayılanı kullanılır ve uyarı yazılır", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, { etiket: "Takılı Olmayan Kamera" });
  await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.deepEqual(s.cagrilar, [SAYFA_ISTEGI]);
  assert.deepEqual(s.uyarilar, [UYARI_IMI]);
  assert.equal(s.window.__dnKamera.eksik, true);
});

test("seçili kamerayla açılamazsa (NotFoundError) varsayılana düşer", async () => {
  const s = sayfa({ aygitlar: KAMERALAR, hata: (k) => (k.video.deviceId ? "NotFoundError" : null) });
  calistir(s, { etiket: "USB Kamera" });
  const r = await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.equal(r.kisit.video.deviceId, undefined);
  assert.equal(s.cagrilar.length, 2);
  assert.deepEqual(s.uyarilar, [UYARI_IMI]);
});

test("izin reddi gibi başka hatalar sayfaya aynen iletilir", async () => {
  const s = sayfa({ aygitlar: KAMERALAR, hata: () => "NotAllowedError" });
  calistir(s, { etiket: "USB Kamera" });
  await assert.rejects(s.mediaDevices.getUserMedia(SAYFA_ISTEGI), (e) => e.name === "NotAllowedError");
  assert.deepEqual(s.uyarilar, []);
});

test("adlar izin öncesi görünmüyorsa: varsayılanla açar, sonra seçili kameraya geçer", async () => {
  let izinli = false;
  const s = sayfa({ aygitlar: () => KAMERALAR.map((d) => (izinli ? d : { ...d, label: "" })) });
  const asil = s.mediaDevices.getUserMedia;
  s.mediaDevices.getUserMedia = async (k) => { const r = await asil(k); izinli = true; return r; };
  calistir(s, { etiket: "USB Kamera" });
  const r = await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.equal(r.kisit.video.deviceId.exact, "sayfa-b");
  assert.deepEqual(s.durdurulan, ["varsayilan-id"]);
  assert.equal(s.window.__dnKamera.uygulandi, 1);
});

test("başka kökende çalışmaz; ikinci kez çalıştırılırsa sarmalayıcı tekrar sarılmaz", async () => {
  const yabanci = sayfa({ aygitlar: KAMERALAR, koken: "https://ornek.com" });
  calistir(yabanci, { etiket: "USB Kamera" });
  assert.equal(yabanci.window.__dnKamera, undefined);
  const s = sayfa({ aygitlar: KAMERALAR });
  calistir(s, { etiket: "USB Kamera" });
  const ilk = s.mediaDevices.getUserMedia;
  calistir(s, { etiket: "Dahili Kamera" });
  assert.equal(s.mediaDevices.getUserMedia, ilk);
  await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.equal(s.cagrilar[0].video.deviceId.exact, "sayfa-b");
});

test("aygıt listesi hiç yanıt vermezse kamera yine sayfanın isteğiyle açılır (takılmaz)", async () => {
  const s = sayfa({ aygitlar: KAMERALAR });
  s.mediaDevices.enumerateDevices = () => new Promise(() => {});
  calistir(s, { etiket: "USB Kamera", listeZamanAsimiMs: 50 });
  const r = await s.mediaDevices.getUserMedia(SAYFA_ISTEGI);
  assert.equal(r.kisit.video.deviceId, undefined);
  assert.deepEqual(s.cagrilar, [SAYFA_ISTEGI]);
});

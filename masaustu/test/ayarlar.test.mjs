import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { yukle, kaydet, varsayilan, varsayilanVeriKlasoru, oneDriveAltindaMi } = createRequire(import.meta.url)("../ayarlar.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dn-ayar-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("dosya yoksa varsayılanlar", () => {
  const a = yukle(path.join(tmp, "yok.json"));
  assert.deepEqual(a, varsayilan());
  assert.deepEqual(a.kiosk, { ogrenci: true, test: true });
  assert.equal(a.kameraId, null);
  assert.equal(a.cozunurluk, null);
  assert.equal(path.basename(a.veriKlasoru), "data");
});

test("kaydet/yukle gidiş-dönüş", () => {
  const d = path.join(tmp, "alt", "a.json");
  kaydet(d, { veriKlasoru: "C:\\veri", kameraId: "cam1", cozunurluk: { w: 1280, h: 720 }, kiosk: { ogrenci: false, test: true } });
  const a = yukle(d);
  assert.equal(a.veriKlasoru, "C:\\veri");
  assert.equal(a.kameraId, "cam1");
  assert.deepEqual(a.cozunurluk, { w: 1280, h: 720 });
  assert.deepEqual(a.kiosk, { ogrenci: false, test: true });
});

test("bozuk JSON: varsayılan + yedek dosya", () => {
  const d = path.join(tmp, "bozuk.json");
  fs.writeFileSync(d, "{ bu json degil");
  const a = yukle(d);
  assert.deepEqual(a, varsayilan());
  assert.equal(fs.existsSync(d), false);
  const yedekler = fs.readdirSync(tmp).filter((f) => f.startsWith("bozuk.json.bozuk-"));
  assert.equal(yedekler.length, 1);
  assert.equal(fs.readFileSync(path.join(tmp, yedekler[0]), "utf8"), "{ bu json degil");
});

test("eksik alanlar varsayılanla tamamlanır", () => {
  const d = path.join(tmp, "kismi.json");
  fs.writeFileSync(d, JSON.stringify({ kameraId: "x" }));
  const a = yukle(d);
  assert.equal(a.kameraId, "x");
  assert.deepEqual(a.kiosk, { ogrenci: true, test: true });
});

test("varsayılan veri klasörü dışarıdan değiştirilebilir (paketli uygulama)", () => {
  const eski = varsayilanVeriKlasoru();
  try {
    const hedef = path.join(tmp, "Belgeler", "DersNabzı", "veri");
    assert.equal(varsayilanVeriKlasoru(hedef), path.resolve(hedef));
    assert.equal(yukle(path.join(tmp, "yok2.json")).veriKlasoru, path.resolve(hedef));
  } finally {
    varsayilanVeriKlasoru(eski);
  }
});

test("varsayılana eşit veri klasörü dosyaya yazılmaz (geliştirme/paket ayrımı)", () => {
  const eski = varsayilanVeriKlasoru();
  try {
    const dosya = path.join(tmp, "ayrim.json");
    const dev = path.join(tmp, "depo", "data");
    const paket = path.join(tmp, "Belgeler", "DersNabzı", "veri");
    varsayilanVeriKlasoru(dev);
    kaydet(dosya, { ...varsayilan(), kiosk: { ogrenci: false, test: true } });
    assert.equal("veriKlasoru" in JSON.parse(fs.readFileSync(dosya, "utf8")), false);
    varsayilanVeriKlasoru(paket);   // aynı dosyayı paketli sürüm okur: kendi varsayılanını alır
    const a = yukle(dosya);
    assert.equal(a.veriKlasoru, path.resolve(paket));
    assert.equal(a.kiosk.ogrenci, false);
    const ozel = path.join(tmp, "ozel");
    kaydet(dosya, { ...a, veriKlasoru: ozel });   // varsayılandan farklıysa yazılır
    assert.equal(JSON.parse(fs.readFileSync(dosya, "utf8")).veriKlasoru, ozel);
  } finally {
    varsayilanVeriKlasoru(eski);
  }
});

test("kamera etiketi, çözünürlük ve son port doğrulanır", () => {
  const d = path.join(tmp, "kamera.json");
  kaydet(d, { ...varsayilan(), kameraId: "id1", kameraEtiket: "USB Kamera (046d:0825)", cozunurluk: { w: 1920, h: 1080 }, sonPort: 8034 });
  const a = yukle(d);
  assert.equal(a.kameraEtiket, "USB Kamera (046d:0825)");
  assert.deepEqual(a.cozunurluk, { w: 1920, h: 1080 });
  assert.equal(a.sonPort, 8034);
  fs.writeFileSync(d, JSON.stringify({ cozunurluk: { w: 9999, h: 1 }, sonPort: 80, kameraEtiket: 5 }));
  const b = yukle(d);
  assert.equal(b.cozunurluk, null);
  assert.equal(b.sonPort, null);
  assert.equal(b.kameraEtiket, null);
  fs.writeFileSync(d, JSON.stringify({ sonPort: "8030" }));
  assert.equal(yukle(d).sonPort, null);
});

test("OneDrive altındaki veri klasörü algılanır", () => {
  const ortam = { OneDrive: String.raw`C:\Users\ali\OneDrive`, OneDriveCommercial: String.raw`C:\Users\ali\OneDrive - Okul` };
  assert.equal(oneDriveAltindaMi(String.raw`C:\Users\ali\OneDrive\Belgeler\DersNabzı\veri`, ortam), true);
  assert.equal(oneDriveAltindaMi(String.raw`c:\users\ALI\onedrive`, ortam), true);
  assert.equal(oneDriveAltindaMi(String.raw`C:\Users\ali\OneDrive - Okul\veri`, ortam), true);
  // ortam değişkeni olmasa da yolda OneDrive klasörü varsa
  assert.equal(oneDriveAltindaMi(String.raw`D:\Yedek\OneDrive\veri`, {}), true);
  assert.equal(oneDriveAltindaMi(String.raw`E:\OneDrive - Kurum A.Ş\veri`, {}), true);
  // ortam değişkeni kökü ile önek benzerliği yetmez (OneDriveYedek)
  assert.equal(oneDriveAltindaMi(String.raw`C:\Users\ali\OneDriveYedek\veri`, ortam), false);
  // yerel klasörler
  assert.equal(oneDriveAltindaMi(String.raw`C:\Users\ali\Documents\DersNabzı\veri`, ortam), false);
  assert.equal(oneDriveAltindaMi(String.raw`C:\Users\ali\OneDrive2\veri`, {}), false);
  assert.equal(oneDriveAltindaMi("", ortam), false);
  assert.equal(oneDriveAltindaMi(null, ortam), false);
  assert.equal(oneDriveAltindaMi(String.raw`D:\veri`, { OneDrive: "" }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { yukle, kaydet, varsayilan, varsayilanVeriKlasoru } = createRequire(import.meta.url)("../ayarlar.js");

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

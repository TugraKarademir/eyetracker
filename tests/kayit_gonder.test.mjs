// bakis_test.html kayıt gönderimi (testKaydiGonder): sıralı zincir + süre sınırı. Çalıştırma: node tests/kayit_gonder.test.mjs
//  1) yanıtsız (askıda) ara gönderim süre dolunca iptal edilir, zincir ilerler, son kayıt gider; hata ekrana gider
//  2) gönderimler sırayla çalışır (ikincisi birincisi bitmeden başlamaz)
//  3) sunucu hatası: null döner, hata gösterilir; ardından başarılı gönderim hatayı kaldırır
// Kod sayfadan (KAYIT_SURE … testKaydiGonderNow sonu) çıkarılıp sahte fetch/tlog/kayitHata ile çalıştırılır.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../static/bakis_test.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const bas = html.indexOf("const KAYIT_SURE");
const son = html.indexOf("} finally { clearTimeout(zaman); }\n}", bas);
assert.ok(bas > 0 && son > bas, "gönderim kodu sayfada bulunamadı");
const SON = "} finally { clearTimeout(zaman); }\n}";
const isiBas = html.indexOf("async function isiTestiGonder"), isiSon = html.indexOf(SON, isiBas);
assert.ok(isiBas > 0 && isiSon > isiBas, "ısı gönderim kodu sayfada bulunamadı");
const kod = html.slice(bas, son + SON.length) + "\n" + html.slice(isiBas, isiSon + SON.length);

function kur(fetchSahte) {
  const olay = { log: [], hata: [], kaldir: 0, govde: [] };
  const ctx = vm.createContext({
    setTimeout, clearTimeout, AbortController, Promise, JSON, Math, navigator: { userAgent: "Windows NT 10.0" },
    screen: { width: 1920, height: 1080 }, innerWidth: 1900, innerHeight: 1000,
    KAYIT_KIMLIK: "20261125_100000_abcdef", BAGLAM: null, KAYIT_SONUC: {}, testLog: [], tiklamaOz: [],
    cihaz2: () => ({}), CIHAZ_TAM: null, glPaket: () => null, kareOzet: () => null,
    ISI: { veri: { gorseller: [] }, kimlik: "20261125_100000_isi1", anaDosya: null }, isiTestiOzet: () => ({}), glKayitlar: () => [],
    tlog: (m) => olay.log.push(m), kayitHataGoster: (n, tur = "Kayıt") => olay.hata.push(tur === "Kayıt" ? n : `${tur}: ${n}`), kayitHataKaldir: () => olay.kaldir++,
    fetch: (url, o) => { olay.govde.push(JSON.parse(o.body)); return fetchSahte(o); },
  });
  vm.runInContext(kod.replace("const KAYIT_SURE = { ara: 60000, son: 120000 };", "const KAYIT_SURE = { ara: 50, son: 100 };"), ctx);
  return { ctx, olay, gonder: (ms) => vm.runInContext(`testKaydiGonder(${ms ?? ""})`, ctx) };
}
const tamam = (dosya) => Promise.resolve({ ok: true, json: async () => ({ dosya }) });
const askida = (o) => new Promise((_, red) => o.signal.addEventListener("abort", () => red(Object.assign(new Error("aborted"), { name: "AbortError" }))));

// 1) askıda ara gönderim
{
  let n = 0;
  const { olay, gonder } = kur((o) => (n++ === 0 ? askida(o) : tamam("x.json")));
  const t0 = Date.now();
  const p1 = gonder(), p2 = gonder(100);
  assert.equal(await p1, null);
  assert.equal(await p2, "x.json");
  assert.ok(Date.now() - t0 < 1000, "süre sınırı çalışmadı");
  assert.equal(olay.hata.length, 1);
  assert.match(olay.hata[0], /yanıt gelmedi/);
  assert.equal(olay.kaldir, 1);
  console.log("1) askıda ara gönderim iptal edildi, son kayıt gitti: tamam");
}
// 2) sıra
{
  const sira = [];
  let bitir;
  const { gonder } = kur(() => { sira.push("başla"); return new Promise((ok) => (bitir = () => { sira.push("bitti"); ok({ ok: true, json: async () => ({ dosya: "a" }) }); })); });
  const p1 = gonder(1000), p2 = gonder(1000);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sira, ["başla"]);
  bitir(); await p1; await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sira, ["başla", "bitti", "başla"]);
  bitir(); await p2;
  console.log("2) gönderimler sıralı: tamam");
}
// 3) sunucu hatası
{
  let n = 0;
  const { olay, gonder } = kur(() => (n++ === 0 ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "disk dolu" }) }) : tamam("y.json")));
  assert.equal(await gonder(), null);
  assert.deepEqual(olay.hata, ["disk dolu"]);
  assert.equal(await gonder(), "y.json");
  assert.equal(olay.kaldir, 1);
  console.log("3) sunucu hatası gösterilir, sonraki gönderim düzeltir: tamam");
}
// 4) askıda ısı verisi gönderimi de süre dolunca biter (sonuç ekranı beklemesin)
{
  const { ctx, olay } = kur(askida);
  const t0 = Date.now();
  assert.equal(await vm.runInContext("isiTestiGonder(null)", ctx), null);
  assert.ok(Date.now() - t0 < 1000, "ısı gönderiminde süre sınırı çalışmadı");
  assert.equal(olay.hata.length, 1);
  assert.match(olay.hata[0], /^Isı testi verisi: .*yanıt gelmedi/);
  console.log("4) askıda ısı verisi gönderimi iptal edildi: tamam");
}
console.log("kayit_gonder: TAMAM");

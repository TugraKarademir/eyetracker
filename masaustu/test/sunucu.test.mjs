import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const cp = require("child_process");
const { bosPortBul, baslat, varsayilanKomut } = require("../sunucu.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dn-sunucu-"));
const calisanlar = [];
test.after(async () => {
  for (const s of calisanlar) await s.durdur().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

function yasiyorMu(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}
function portTut(port) {
  return new Promise((coz, red) => {
    const s = net.createServer();
    s.once("error", red);
    s.listen(port, "127.0.0.1", () => coz(s));
  });
}
const kapat = (s) => new Promise((r) => s.close(r));

test("bosPortBul: doluysa sıradaki port", async () => {
  const p = await bosPortBul(18030);
  const tutucu = await portTut(p);
  try {
    assert.equal(await bosPortBul(p), p + 1);
  } finally {
    await kapat(tutucu);
  }
});

test("gerçek server.py: sağlıklı başlar, durdur() süreci bitirir", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18100);
  const { komut, argumanlar } = varsayilanKomut(port, veri);
  const s = await baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 30000 });
  calisanlar.push(s);
  assert.equal(s.port, port);
  const r = await fetch(`http://127.0.0.1:${port}/api/saglik`);
  assert.equal((await r.json()).ok, true);
  const pid = s.surec.pid;
  assert.ok(yasiyorMu(pid));
  await s.durdur();
  assert.equal(yasiyorMu(pid), false);
});

test("port doluyken sıradaki portta başlar", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const dolu = await bosPortBul(18200);
  const tutucu = await portTut(dolu);
  try {
    const port = await bosPortBul(dolu);
    assert.equal(port, dolu + 1);
    const { komut, argumanlar } = varsayilanKomut(port, veri);
    const s = await baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 30000 });
    calisanlar.push(s);
    assert.equal(s.port, dolu + 1);
    await s.durdur();
  } finally {
    await kapat(tutucu);
  }
});

test("zaman aşımı: hata son çıktıyı içerir ve süreç ölür", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18300);
  const kod = "import time,sys; print('MERHABA-SON-CIKTI'); sys.stdout.flush(); time.sleep(60)";
  // pid'i görmek için spawn'ı geçici olarak sar
  const gercek = cp.spawn;
  let pid = null;
  cp.spawn = (...a) => { const c = gercek(...a); pid = c.pid; return c; };
  try {
    await assert.rejects(
      baslat({ komut: "python", argumanlar: ["-c", kod], port, veri, zamanAsimiMs: 1500 }),
      (e) => /MERHABA-SON-CIKTI/.test(e.message) && /hazır olmadı/.test(e.message),
    );
  } finally {
    cp.spawn = gercek;
  }
  assert.ok(pid);
  assert.equal(yasiyorMu(pid), false);
});

test("sunucu hemen çökerse hata çıktıyı taşır", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18320);
  await assert.rejects(
    baslat({ komut: "python", argumanlar: ["-c", "import sys; print('COKTU-X'); sys.exit(3)"], port, veri, zamanAsimiMs: 5000 }),
    /COKTU-X/,
  );
});

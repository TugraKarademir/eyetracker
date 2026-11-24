import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const http = require("http");
const { bosPortBul, baslat, varsayilanKomut, saglikVar } = require("../sunucu.js");

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
  const { komut, argumanlar } = varsayilanKomut(veri);
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
    const { komut, argumanlar } = varsayilanKomut(veri);
    const s = await baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 30000 });
    calisanlar.push(s);
    assert.equal(s.port, dolu + 1);
    await s.durdur();
  } finally {
    await kapat(tutucu);
  }
});

test("zaman aşımı: hata son çıktıyı ve pid'i içerir, süreç ölür", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18300);
  const kod = "import time,sys; print('MERHABA-SON-CIKTI'); sys.stdout.flush(); time.sleep(60)";
  const e = await baslat({ komut: "python", argumanlar: ["-c", kod], port, veri, zamanAsimiMs: 1500 }).then(
    () => assert.fail("hata bekleniyordu"),
    (err) => err,
  );
  assert.match(e.message, /MERHABA-SON-CIKTI/);
  assert.match(e.message, /hazır olmadı/);
  assert.ok(Number.isInteger(e.pid));
  assert.equal(yasiyorMu(e.pid), false);
});

test("sunucu hemen çökerse hata çıktıyı taşır", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18320);
  await assert.rejects(
    baslat({ komut: "python", argumanlar: ["-c", "import sys; print('COKTU-X'); sys.exit(3)"], port, veri, zamanAsimiMs: 5000 }),
    /COKTU-X/,
  );
});

// Sahte sunucu: --port dinler; ortam değişkenleriyle bind hatası / torun süreç taklit eder.
const sahte = path.join(tmp, "sahte_sunucu.py");
fs.writeFileSync(sahte, [
  "import sys, os, time, subprocess, json",
  "from http.server import HTTPServer, BaseHTTPRequestHandler",
  "port = int(sys.argv[sys.argv.index('--port') + 1])",
  "bad = os.environ.get('FAKE_BAD_PORT')",
  "if bad and int(bad) == port:",
  "    time.sleep(float(os.environ.get('FAKE_DELAY', '0')))",
  "    print('OSError: [Errno 10048] Address already in use'); sys.exit(1)",
  "if os.environ.get('FAKE_PIDFILE'):",
  "    g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])",
  "    open(os.environ['FAKE_PIDFILE'], 'w').write(str(g.pid))",
  "class H(BaseHTTPRequestHandler):",
  "    def do_GET(self):",
  "        b = json.dumps({'ok': True, 'oturum': os.environ.get('DERSNABZI_OTURUM', '')}).encode()",
  "        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)",
  "    def log_message(self, *a): pass",
  "HTTPServer(('127.0.0.1', port), H).serve_forever()",
].join("\n"));
const sahteArg = (p) => [sahte, "--port", String(p)];

async function bekleOl(pid) {
  for (let i = 0; i < 100 && yasiyorMu(pid); i++) await new Promise((r) => setTimeout(r, 50));
}

test("durdur(): torun süreç de ölür", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const pidDosya = path.join(tmp, "torun.pid");
  const port = await bosPortBul(18400);
  const s = await baslat({ komut: "python", argumanlar: sahteArg, port, veri, ortam: { FAKE_PIDFILE: pidDosya }, zamanAsimiMs: 15000 });
  calisanlar.push(s);
  const torun = Number(fs.readFileSync(pidDosya, "utf8"));
  assert.ok(torun > 0 && yasiyorMu(torun));
  await s.durdur();
  await bekleOl(torun);
  assert.equal(yasiyorMu(torun), false);
  assert.equal(yasiyorMu(s.surec.pid), false);
});

test("durdur() sonrası port yeniden bağlanabilir", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18500);
  const { komut, argumanlar } = varsayilanKomut(veri);
  const s = await baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 30000 });
  calisanlar.push(s);
  await s.durdur();
  const tutucu = await portTut(port);
  await kapat(tutucu);
});

test("bind hatasıyla kapanan çocuk: sıradaki portta yeniden dener", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const p0 = await bosPortBul(18600);
  const s = await baslat({ komut: "python", argumanlar: sahteArg, port: p0, veri, ortam: { FAKE_BAD_PORT: String(p0) }, zamanAsimiMs: 15000 });
  calisanlar.push(s);
  assert.notEqual(s.port, p0);
  assert.ok(s.port > p0);
  await s.durdur();
});

test("başka sunucu sağlık verse bile çocuk ölürse o yanıt kabul edilmez (port yarışı)", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const p0 = await bosPortBul(18700);
  const yabanci = http.createServer((q, r) => { r.setHeader("Content-Type", "application/json"); r.end('{"ok":true}'); });
  await new Promise((r) => yabanci.listen(p0, "127.0.0.1", r));
  try {
    const s = await baslat({ komut: "python", argumanlar: sahteArg, port: p0, veri, ortam: { FAKE_BAD_PORT: String(p0) }, zamanAsimiMs: 15000 });
    calisanlar.push(s);
    assert.notEqual(s.port, p0);
    await s.durdur();
  } finally {
    await new Promise((r) => yabanci.close(r));
  }
});

test("sağlık yanıtı yalnız kendi oturum kimliğiyle kabul edilir (yabancı sunucu ok:true dese bile)", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const p0 = await bosPortBul(18800);
  // Yabancı sunucu portu tutar ve ok:true + başka bir oturum yanıtlar; çocuk dinlemez ama ölmez (uyur).
  const yabanci = http.createServer((q, r) => { r.setHeader("Content-Type", "application/json"); r.end('{"ok":true,"oturum":"baskasi"}'); });
  await new Promise((r) => yabanci.listen(p0, "127.0.0.1", r));
  try {
    await assert.rejects(
      baslat({ komut: "python", argumanlar: ["-c", "import time; time.sleep(60)"], port: p0, veri, zamanAsimiMs: 2500 }),
      /hazır olmadı/,
    );
  } finally {
    await new Promise((r) => yabanci.close(r));
  }
});

test("gerçek server.py oturum kimliğini yankılar", async () => {
  const veri = fs.mkdtempSync(path.join(tmp, "veri-"));
  const port = await bosPortBul(18900);
  const { komut, argumanlar } = varsayilanKomut(veri);
  const s = await baslat({ komut, argumanlar, port, veri, zamanAsimiMs: 30000 });
  calisanlar.push(s);
  assert.match(s.oturum, /^[0-9a-f]{32}$/);
  const j = await (await fetch(`http://127.0.0.1:${port}/api/saglik`)).json();
  assert.equal(j.oturum, s.oturum);
  assert.equal(await saglikVar(port, s.oturum), true);
  assert.equal(await saglikVar(port, "yanlis"), false);
  await s.durdur();
});

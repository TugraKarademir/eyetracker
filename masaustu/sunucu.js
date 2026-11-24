"use strict";
// Python sunucu sürecini başlatır/durdurur. Veri klasörü DERSNABZI_DATA ile verilir.
const childProcess = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const DEPO_KOKU = path.resolve(__dirname, "..");

function portBosMu(port) {
  return new Promise((coz) => {
    const s = net.createServer();
    s.once("error", () => coz(false));
    s.listen(port, "127.0.0.1", () => s.close(() => coz(true)));
  });
}

async function bosPortBul(baslangic = 8030) {
  for (let p = baslangic; p < baslangic + 200; p++) {
    if (await portBosMu(p)) return p;
  }
  throw new Error(`${baslangic} sonrasında boş port bulunamadı`);
}

// Geliştirmede python server.py; pakette resources/sunucu/dersnabzi-sunucu.exe (yol dışarıdan verilir).
function varsayilanKomut(port, veri, paketYolu) {
  if (paketYolu) return { komut: paketYolu, argumanlar: ["--port", String(port), "--data", veri] };
  return {
    komut: process.platform === "win32" ? "python" : "python3",
    argumanlar: [path.join(DEPO_KOKU, "server.py"), "--port", String(port), "--data", veri],
  };
}

function saglikVar(port) {
  return new Promise((coz) => {
    const istek = http.get({ host: "127.0.0.1", port, path: "/api/saglik", timeout: 1000 }, (yanit) => {
      let govde = "";
      yanit.on("data", (d) => { govde += d; });
      yanit.on("end", () => {
        try { coz(yanit.statusCode === 200 && JSON.parse(govde).ok === true); } catch (_) { coz(false); }
      });
    });
    istek.on("timeout", () => { istek.destroy(); coz(false); });
    istek.on("error", () => coz(false));
  });
}

function agaciOldur(surec) {
  if (surec.exitCode !== null || surec.signalCode !== null) return;
  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill", ["/PID", String(surec.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { surec.kill("SIGKILL"); } catch (_) { /* zaten bitmiş */ }
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

async function baslat({ komut, argumanlar = [], port, veri, zamanAsimiMs = 15000, ortam = {} }) {
  const surec = childProcess.spawn(komut, argumanlar, {
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", ...ortam, DERSNABZI_DATA: veri },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const satirlar = [];
  let kalan = "";
  const topla = (d) => {
    kalan += d.toString("utf8");
    const parca = kalan.split(/\r?\n/);
    kalan = parca.pop();
    for (const s of parca) satirlar.push(s);
    while (satirlar.length > 40) satirlar.shift();
  };
  surec.stdout.on("data", topla);
  surec.stderr.on("data", topla);

  let bitti = null;
  const cikis = new Promise((coz) => {
    surec.once("exit", (kod, sinyal) => { bitti = { kod, sinyal }; coz(); });
    surec.once("error", (e) => { bitti = { kod: null, sinyal: null }; satirlar.push(String(e.message)); coz(); });
  });

  const durdur = async () => {
    agaciOldur(surec);
    if (bitti === null) await Promise.race([cikis, bekle(5000)]);
  };
  const sonCikti = () => (kalan ? [...satirlar, kalan] : satirlar).slice(-40).join("\n");

  const son = Date.now() + zamanAsimiMs;
  while (Date.now() < son) {
    if (bitti) {
      throw new Error(`Sunucu başlamadan kapandı (kod ${bitti.kod}).\nSon çıktı:\n${sonCikti()}`);
    }
    if (await saglikVar(port)) return { port, surec, durdur };
    await bekle(200);
  }
  await durdur();
  throw new Error(`Sunucu ${zamanAsimiMs} ms içinde hazır olmadı.\nSon çıktı:\n${sonCikti()}`);
}

module.exports = { bosPortBul, baslat, varsayilanKomut, saglikVar };

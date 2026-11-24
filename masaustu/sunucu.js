"use strict";
// Python sunucu sürecini başlatır/durdurur. Veri klasörü DERSNABZI_DATA ile verilir.
const childProcess = require("child_process");
const crypto = require("crypto");
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
// argumanlar bir işlev (port) => dizi olduğundan port yarışında yeniden denemede yeni port kullanılır.
function varsayilanKomut(veri, paketYolu) {
  if (paketYolu) return { komut: paketYolu, argumanlar: (p) => ["--port", String(p), "--data", veri] };
  return {
    komut: process.platform === "win32" ? "python" : "python3",
    argumanlar: (p) => [path.join(DEPO_KOKU, "server.py"), "--port", String(p), "--data", veri],
  };
}

// oturum verilirse yanıttaki "oturum" ona eşit olmalı (yanıt bizim başlattığımız süreçten mi?).
function saglikVar(port, oturum = null) {
  return new Promise((coz) => {
    const istek = http.get({ host: "127.0.0.1", port, path: "/api/saglik", timeout: 1000 }, (yanit) => {
      let govde = "";
      yanit.on("data", (d) => { govde += d; });
      yanit.on("end", () => {
        try {
          const j = JSON.parse(govde);
          coz(yanit.statusCode === 200 && j.ok === true && (oturum === null || j.oturum === oturum));
        } catch (_) { coz(false); }
      });
    });
    istek.on("timeout", () => { istek.destroy(); coz(false); });
    istek.on("error", () => coz(false));
  });
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function yasiyor(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Süreç ağacını öldürür ve gerçekten bittiğini doğrular; bitmezse hata fırlatır.
async function agaciOldur(surec) {
  const pid = surec.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const r = childProcess.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    // 128: süreç zaten yok
    if (r.status !== 0 && r.status !== 128 && yasiyor(pid)) {
      throw new Error(`taskkill başarısız (kod ${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
    }
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch (_) { try { surec.kill("SIGKILL"); } catch (_e) { /* bitmiş */ } }
  }
  const son = Date.now() + 5000;
  while (yasiyor(pid)) {
    if (Date.now() > son) throw new Error(`Sunucu süreci (pid ${pid}) 5 sn içinde sonlanmadı`);
    await bekle(50);
  }
}

// server.py ilk çalıştırmada "Yönetici anahtarı (yönetim ekranı): <anahtar>  (<yol>)" yazar.
function anahtarMaskele(metin) {
  return String(metin).replace(/(Yönetici anahtarı[^:\n]*:[ \t]*)\S+/g, "$1***");
}

const BIND_HATASI = /Address already in use|10048|Errno 98|Errno 10048/i;
const SAGLIK_SONRASI_BEKLEME_MS = 1000;

async function baslatTek({ komut, argumanlar, port, veri, zamanAsimiMs, ortam }) {
  const args = typeof argumanlar === "function" ? argumanlar(port) : argumanlar;
  // Her başlatmada yeni rastgele kimlik: sağlık yanıtı yalnız bu kimliği yankılayan süreçten kabul edilir.
  const oturum = crypto.randomBytes(16).toString("hex");
  const surec = childProcess.spawn(komut, args, {
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", ...ortam, DERSNABZI_DATA: veri, DERSNABZI_OTURUM: oturum },
    // stdin boru: uygulama (Electron ana süreci) ölürse boru kapanır, server.py bunu görüp kendini sonlandırır
    // (yalnız DERSNABZI_OTURUM verildiğinde). Böylece sunucu yetim kalmaz.
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
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
  surec.stdin.on("error", () => {});   // çocuk kapanmışsa EPIPE yutulur
  surec.stdout.on("data", topla);
  surec.stderr.on("data", topla);

  let bitti = null;
  const cikis = new Promise((coz) => {
    surec.once("exit", (kod, sinyal) => { bitti = { kod, sinyal }; coz(); });
    surec.once("error", (e) => { bitti = { kod: null, sinyal: null }; satirlar.push(String(e.message)); coz(); });
  });
  // Başlangıç ekranında gösterilir: yönetici anahtarı maskelenir.
  const sonCikti = () => anahtarMaskele((kalan ? [...satirlar, kalan] : satirlar).slice(-40).join("\n"));
  const durdur = async () => {
    await agaciOldur(surec);
    if (bitti === null) await Promise.race([cikis, bekle(5000)]);
  };
  const hata = async (mesaj, ekstra = {}) => {
    let not = "";
    try { await durdur(); } catch (e) { not = `
(durdurma: ${e.message})`; }
    return Object.assign(new Error(`${mesaj}\nSon çıktı:\n${sonCikti()}${not}`), { pid: surec.pid, port }, ekstra);
  };

  const son = Date.now() + zamanAsimiMs;
  while (Date.now() < son) {
    if (bitti) {
      throw await hata(`Sunucu başlamadan kapandı (kod ${bitti.kod}).`, { bindHatasi: BIND_HATASI.test(sonCikti()) });
    }
    if (await saglikVar(port, oturum)) {
      // Kimlik eşleşti; yine de çocuk hemen kapanmadı mı (ör. ikinci dinleyici bind hatası)?
      await Promise.race([cikis, bekle(SAGLIK_SONRASI_BEKLEME_MS)]);
      if (bitti) {
        throw await hata(`Sunucu sağlık yanıtından sonra kapandı (kod ${bitti.kod}).`, { bindHatasi: true });
      }
      return { port, surec, durdur, oturum };
    }
    await bekle(200);
  }
  throw await hata(`Sunucu ${zamanAsimiMs} ms içinde hazır olmadı.`);
}

// Port yarışında (bind hatası) sıradaki boş portta en çok 3 kez dener; sonuçtaki port gerçek olandır.
async function baslat(secenek) {
  let port = secenek.port;
  for (let deneme = 1; ; deneme++) {
    try {
      return await baslatTek({ argumanlar: [], zamanAsimiMs: 15000, ortam: {}, ...secenek, port });
    } catch (e) {
      if (!e.bindHatasi || deneme >= 3) throw e;
      port = await bosPortBul(port + 1);
    }
  }
}

module.exports = { bosPortBul, baslat, varsayilanKomut, saglikVar, anahtarMaskele };

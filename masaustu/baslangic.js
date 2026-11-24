"use strict";
// Başlangıç ekranı. Yalnız preload'un verdiği window.masaustu API'sini kullanır.
(() => {
  const api = window.masaustu;
  const $ = (id) => document.getElementById(id);
  let ayar = null;

  function durumGoster(d) {
    const isik = $("durumIsik");
    isik.className = `isik ${d.asama === "hazir" ? "hazir" : d.asama === "hata" ? "hata" : ""}`;
    $("durumMetni").textContent =
      d.asama === "hazir" ? `Sunucu çalışıyor (port ${d.port})`
        : d.asama === "hata" ? "Sunucu başlatılamadı"
          : "Sunucu başlatılıyor…";
    $("durumVeri").textContent = d.veriKlasoru || "—";
    const hata = d.asama === "hata";
    $("hataKutusu").classList.toggle("hidden", !hata);
    if (hata) {
      const metin = String(d.hata || "");
      const i = metin.indexOf("\nSon çıktı:\n");
      $("hataOzet").textContent = i >= 0 ? metin.slice(0, i) : metin;
      $("hataCikti").textContent = i >= 0 ? metin.slice(i + 1) : "";
      $("hataCikti").classList.toggle("hidden", i < 0);
    }
    $("yenidenDene").disabled = false;
    for (const b of document.querySelectorAll("[data-hedef]")) b.disabled = d.asama !== "hazir";
  }

  function ayarGoster(a) {
    ayar = a;
    $("ayarVeri").textContent = a.veriKlasoru;
    $("kioskOgrenci").checked = !!a.kiosk.ogrenci;
    $("kioskTest").checked = !!a.kiosk.test;
    $("veriZorlaNot").classList.toggle("hidden", !a.veriKlasoruZorla);
  }

  function mesaj(m, hata = false) {
    $("ayarMesaj").textContent = m;
    $("ayarMesaj").className = `small ${hata ? "hata-metni" : "muted"}`;
  }

  async function kaydet(degisiklik) {
    try {
      const r = await api.ayarKaydet({ ...ayar, ...degisiklik });
      ayarGoster({ ...r.ayar, veriKlasoruZorla: ayar.veriKlasoruZorla });
      mesaj(r.yenidenBaslat ? "Kaydedildi. Sunucu yeni klasörle yeniden başlatılıyor…" : "Kaydedildi.");
    } catch (e) {
      mesaj(`Kaydedilemedi: ${e.message}`, true);
    }
  }

  for (const b of document.querySelectorAll("[data-hedef]")) {
    b.addEventListener("click", async () => {
      $("acHata").classList.add("hidden");
      try {
        await api.ac(b.dataset.hedef);
      } catch (e) {
        $("acHata").textContent = `Açılamadı: ${e.message}`;
        $("acHata").classList.remove("hidden");
      }
    });
  }

  $("yenidenDene").addEventListener("click", () => {
    $("yenidenDene").disabled = true;
    api.yenidenDene().catch(() => { $("yenidenDene").disabled = false; });
  });

  $("veriSec").addEventListener("click", async () => {
    const k = await api.veriKlasoruSec();
    if (k && k !== ayar.veriKlasoru) await kaydet({ veriKlasoru: k });
  });
  $("kioskOgrenci").addEventListener("change", (e) => kaydet({ kiosk: { ...ayar.kiosk, ogrenci: e.target.checked } }));
  $("kioskTest").addEventListener("change", (e) => kaydet({ kiosk: { ...ayar.kiosk, test: e.target.checked } }));

  api.durumDinle(durumGoster);
  api.durum().then(durumGoster);
  api.ayarlar().then(ayarGoster);
})();

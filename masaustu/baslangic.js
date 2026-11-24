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
          : d.asama === "durdurulamadi" ? "Sunucu durdurulamadı"
            : "Sunucu başlatılıyor…";
    $("durumVeri").textContent = d.veriKlasoru || "—";
    const hata = d.asama === "hata" || d.asama === "durdurulamadi";
    $("hataKutusu").classList.toggle("hidden", !hata);
    if (hata) {
      const metin = String(d.hata || "");
      const i = metin.indexOf("\nSon çıktı:\n");
      $("hataOzet").textContent = i >= 0 ? metin.slice(0, i) : metin;
      $("hataCikti").textContent = i >= 0 ? metin.slice(i + 1) : "";
      $("hataCikti").classList.toggle("hidden", i < 0);
    }
    $("yenidenDene").disabled = d.asama === "durdurulamadi";
    for (const b of document.querySelectorAll("[data-hedef]")) b.disabled = d.asama !== "hazir";
    $("oneDriveUyari").classList.toggle("hidden", !d.oneDrive);
    sayfaKameraUyari = d.kameraUyari || null;
    kameraUyariGoster();
  }

  // ---------------------------------------------------------------- kamera seçimi
  // deviceId kökene göre değişir (bu ekran ile sayfalar farklı köken): sayfalar kamerayı ETİKETLE bulur.
  let sayfaKameraUyari = null;
  let listeKameraUyari = null;
  function kameraUyariGoster() {
    const m = sayfaKameraUyari || listeKameraUyari;
    $("kameraUyari").textContent = m || "";
    $("kameraUyari").classList.toggle("hidden", !m);
  }

  async function kameralariListele(adlariIste = false) {
    const md = navigator.mediaDevices;
    const sec = $("kameraSec");
    if (!md || !md.enumerateDevices) { sec.disabled = true; return; }
    // Bazı ortamlarda enumerateDevices yanıt vermeyebilir: 5 sn sonra vazgeçilir.
    const listele = async () => {
      let z = null;
      const l = await Promise.race([
        md.enumerateDevices(),
        new Promise((_, red) => { z = setTimeout(() => red(new Error("yanıt yok")), 5000); }),
      ]).finally(() => clearTimeout(z));
      return l.filter((d) => d.kind === "videoinput");
    };
    let liste = [];
    try {
      liste = await listele();
      if (adlariIste && liste.length && liste.every((d) => !d.label)) {
        // Adlar görünmüyorsa: geçici kamera açılır ve hemen kapatılır (yalnız adları okumak için).
        const s = await md.getUserMedia({ video: true, audio: false });
        s.getTracks().forEach((t) => t.stop());
        liste = await listele();
      }
    } catch (e) {
      mesaj(`Kamera listesi alınamadı: ${e.message}`, true);
    }
    const adli = liste.filter((d) => d.label);
    const adsiz = liste.length > 0 && adli.length === 0;
    $("kameraAdlari").classList.toggle("hidden", !adsiz);
    while (sec.options.length > 1) sec.remove(1);
    for (const d of adli) sec.add(new Option(d.label, d.deviceId));
    sec.disabled = adsiz;
    sec.value = "";
    listeKameraUyari = null;
    if (ayar && ayar.kameraEtiket) {
      const bulunan = adli.find((d) => d.label === ayar.kameraEtiket);
      if (bulunan) {
        sec.value = bulunan.deviceId;
      } else if (!adsiz) {
        const o = new Option(`${ayar.kameraEtiket} (takılı değil)`, "__eksik__");
        sec.add(o);
        sec.value = "__eksik__";
        listeKameraUyari = `Seçili kamera (${ayar.kameraEtiket}) bulunamadı; sayfalar varsayılan kamerayı kullanacak.`;
      }
    }
    kameraUyariGoster();
  }

  function ayarGoster(a) {
    ayar = a;
    $("ayarVeri").textContent = a.veriKlasoru;
    $("kioskOgrenci").checked = !!a.kiosk.ogrenci;
    $("kioskTest").checked = !!a.kiosk.test;
    $("veriZorlaNot").classList.toggle("hidden", !a.veriKlasoruZorla);
    $("cozunurlukSec").value = a.cozunurluk ? `${a.cozunurluk.w}x${a.cozunurluk.h}` : "";
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
    api.yenidenDene().catch((e) => {
      $("yenidenDene").disabled = false;
      $("hataOzet").textContent = `Yeniden deneme başarısız: ${e && e.message ? e.message : e}`;
    });
  });

  $("veriSec").addEventListener("click", async () => {
    const k = await api.veriKlasoruSec();
    if (k && k !== ayar.veriKlasoru) await kaydet({ veriKlasoru: k });
  });
  $("kioskOgrenci").addEventListener("change", (e) => kaydet({ kiosk: { ...ayar.kiosk, ogrenci: e.target.checked } }));
  $("kioskTest").addEventListener("change", (e) => kaydet({ kiosk: { ...ayar.kiosk, test: e.target.checked } }));

  $("kameraSec").addEventListener("change", async (e) => {
    const sec = e.target;
    if (sec.value === "__eksik__") return;
    const o = sec.selectedOptions[0];
    await kaydet(sec.value ? { kameraId: sec.value, kameraEtiket: o.textContent } : { kameraId: null, kameraEtiket: null });
    await kameralariListele();
  });
  $("kameraAdlari").addEventListener("click", () => kameralariListele(true));
  $("cozunurlukSec").addEventListener("change", (e) => {
    const m = /^(\d+)x(\d+)$/.exec(e.target.value);
    kaydet({ cozunurluk: m ? { w: Number(m[1]), h: Number(m[2]) } : null });
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => kameralariListele());
  }

  api.durumDinle(durumGoster);
  const hataMetni = (e) => String(e && e.message ? e.message : e);
  api.durum().then(durumGoster).catch((e) => { $("durumVeri").textContent = `Durum alınamadı: ${hataMetni(e)}`; });
  api.ayarlar().then((a) => { ayarGoster(a); kameralariListele(); })
    .catch((e) => { $("ayarMesaj").textContent = `Ayarlar alınamadı: ${hataMetni(e)}`; });
})();

"use strict";
// Yalnız başlangıç ekranına yüklenir. Sayfa pencereleri (öğretmen/öğrenci/test/yönetim) preload almaz.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("masaustu", {
  ac: (hedef) => ipcRenderer.invoke("dn:ac", String(hedef)),
  ayarlar: () => ipcRenderer.invoke("dn:ayarlar"),
  ayarKaydet: (ayar) => ipcRenderer.invoke("dn:ayarKaydet", ayar),
  veriKlasoruSec: () => ipcRenderer.invoke("dn:veriKlasoruSec"),
  durum: () => ipcRenderer.invoke("dn:durum"),
  yenidenDene: () => ipcRenderer.invoke("dn:yenidenDene"),
  durumDinle: (cb) => {
    const f = (_e, d) => cb(d);
    ipcRenderer.on("dn:durum", f);
    return () => ipcRenderer.removeListener("dn:durum", f);
  },
});

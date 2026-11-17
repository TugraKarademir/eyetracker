"""Canlı Tercüman — kontrol penceresi + altyazı penceresi.
Çalıştır:  python uygulama.py          (gerçek servisler)
           python uygulama.py --sahte  (servis yok; ses yönlendirmesini ücretsiz dene)
"""
import queue
import sys
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

import ayarlar
import ses
from cekirdek import Tercuman

YOK = "(kapalı)"

EDGE_SESLERI = [
    ("Andrew — erkek, Amerikan", "en-US-AndrewNeural"),
    ("Brian — erkek, Amerikan", "en-US-BrianNeural"),
    ("Guy — erkek, Amerikan", "en-US-GuyNeural"),
    ("Ryan — erkek, İngiliz", "en-GB-RyanNeural"),
    ("Ava — kadın, Amerikan", "en-US-AvaNeural"),
    ("Emma — kadın, Amerikan", "en-US-EmmaNeural"),
    ("Jenny — kadın, Amerikan", "en-US-JennyNeural"),
    ("Sonia — kadın, İngiliz", "en-GB-SoniaNeural"),
]
TANIMA_SECENEKLERI = [   # (görünen ad, tanima, whisper_modeli)
    ("Google — doğru ve hızlı (önerilen)", "google", "small"),
    ("Whisper small — internetsiz, hatalı", "whisper", "small"),
    ("Whisper base — internetsiz, çok hatalı", "whisper", "base"),
]

DURUM_YAZI = {"dinliyor": "Dinliyor", "isleniyor": "Çevriliyor…", "konusuyor": "İngilizce konuşuyor"}


class Altyazi(tk.Toplevel):
    """Kenarlıksız, her zaman üstte, sürüklenebilir altyazı şeridi."""

    def __init__(self, kok, ayar):
        super().__init__(kok)
        self.a = ayar
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.attributes("-alpha", ayar["altyazi_saydamlik"])
        self.configure(bg="#111")
        gen = int(self.winfo_screenwidth() * 0.6)
        x = (self.winfo_screenwidth() - gen) // 2
        y = self.winfo_screenheight() - 260
        self.geometry(f"{gen}x170+{x}+{y}")
        self.font = ayar["altyazi_font"]
        self.satirlar = []
        self.metin = tk.Text(self, bg="#111", fg="#fff", bd=0, wrap="word",
                             highlightthickness=0, padx=14, pady=8, cursor="fleur")
        self.metin.pack(fill="both", expand=True)
        self._stil()
        self.metin.insert("end", "Altyazı burada görünecek — sürükleyerek taşı, tekerlekle büyüt/küçült, "
                                 "sağ köşeden boyutlandır.", "kucuk")
        self.metin.configure(state="disabled")
        tutamac = tk.Label(self, text="◢", bg="#111", fg="#666", cursor="size_nw_se")
        tutamac.place(relx=1.0, rely=1.0, anchor="se")
        for w in (self.metin,):
            w.bind("<ButtonPress-1>", self._bas)
            w.bind("<B1-Motion>", self._surukle)
            w.bind("<MouseWheel>", self._tekerlek)
        tutamac.bind("<ButtonPress-1>", self._bas)
        tutamac.bind("<B1-Motion>", self._boyut)

    def _stil(self):
        self.metin.tag_configure("tr", font=("Segoe UI", self.font, "bold"), foreground="#fff")
        self.metin.tag_configure("en", font=("Segoe UI", max(9, int(self.font * 0.55))), foreground="#9aa")
        self.metin.tag_configure("kucuk", font=("Segoe UI", 11), foreground="#888")

    def _bas(self, e):
        self._x, self._y = e.x_root, e.y_root
        self._gx, self._gy = self.winfo_x(), self.winfo_y()
        self._gw, self._gh = self.winfo_width(), self.winfo_height()

    def _surukle(self, e):
        self.geometry(f"+{self._gx + e.x_root - self._x}+{self._gy + e.y_root - self._y}")

    def _boyut(self, e):
        w = max(300, self._gw + e.x_root - self._x)
        h = max(80, self._gh + e.y_root - self._y)
        self.geometry(f"{w}x{h}")

    def _tekerlek(self, e):
        self.font = max(12, min(48, self.font + (2 if e.delta > 0 else -2)))
        self.a["altyazi_font"] = self.font
        self._stil()

    def ekle(self, tr, en):
        self.satirlar.append((tr, en))
        self.satirlar = self.satirlar[-self.a["altyazi_satir"]:]
        self.metin.configure(state="normal")
        self.metin.delete("1.0", "end")
        for i, (t, o) in enumerate(self.satirlar):
            if i:
                self.metin.insert("end", "\n")
            self.metin.insert("end", t + "\n", "tr")
            self.metin.insert("end", o, "en")
        self.metin.configure(state="disabled")
        self.metin.see("end")


class Uygulama:
    def __init__(self, sahte=False):
        self.sahte = sahte
        self.a = ayarlar.yukle()
        self.olaylar = queue.Queue()
        self.tercuman = None

        self.kok = tk.Tk()
        self.kok.title("Canlı Tercüman" + ("  [SAHTE MOD]" if sahte else ""))
        self.kok.geometry("760x620")
        self.kok.minsize(640, 520)
        self.kok.protocol("WM_DELETE_WINDOW", self.kapat)
        ttk.Style().theme_use("vista" if "vista" in ttk.Style().theme_names() else "clam")
        self._kur()
        self.altyazi = Altyazi(self.kok, self.a)
        self.altyazi.withdraw()
        self._cihazlari_doldur()
        self.kok.after(50, self._dongu)
        # açılışta pencereyi öne getir (başka pencerelerin arkasında kalmasın)
        self.kok.lift()
        self.kok.attributes("-topmost", True)
        self.kok.after(1500, lambda: self.kok.attributes("-topmost", False))
        self.kok.focus_force()

    # ------------------------------------------------------------ arayüz
    def _kur(self):
        k = self.kok
        ust = ttk.LabelFrame(k, text="Ses cihazları", padding=8)
        ust.pack(fill="x", padx=10, pady=(10, 4))
        self.sec = {}
        satirlar = [
            ("mikrofon", "Mikrofonum (Türkçe konuşacağım):"),
            ("cikis", "Teams/Zoom'a giden ses (CABLE Input):"),
            ("dinleme", "Karşı tarafı duyduğum hoparlör:"),
            ("kendini_duy", "İngilizce sesimi ben de duyayım (ops.):"),
        ]
        for i, (ad, etiket) in enumerate(satirlar):
            ttk.Label(ust, text=etiket).grid(row=i, column=0, sticky="w", pady=2)
            cb = ttk.Combobox(ust, state="readonly", width=58)
            cb.grid(row=i, column=1, sticky="ew", padx=6, pady=2)
            self.sec[ad] = cb
        ust.columnconfigure(1, weight=1)
        ttk.Button(ust, text="Yenile", command=self._cihazlari_doldur).grid(row=0, column=2, rowspan=2)

        mot = ttk.LabelFrame(k, text="Çeviri motoru", padding=8)
        mot.pack(fill="x", padx=10, pady=4)
        self.motor = tk.StringVar(value=ayarlar.motor(self.a))
        ttk.Radiobutton(mot, text="Ücretsiz (anahtar gerekmez)", value="ucretsiz", variable=self.motor,
                        command=self._motor_degisti).grid(row=0, column=0, sticky="w")
        ttk.Radiobutton(mot, text="Ücretli (OpenAI + ElevenLabs, kendi sesim)", value="ucretli",
                        variable=self.motor, command=self._motor_degisti).grid(row=0, column=1, columnspan=3,
                                                                                 sticky="w", padx=12)
        ttk.Label(mot, text="İngilizce ses:").grid(row=1, column=0, sticky="w", pady=(6, 0))
        self.edge_sec = ttk.Combobox(mot, state="readonly", width=34, values=[a for a, _ in EDGE_SESLERI])
        self.edge_sec.grid(row=1, column=1, sticky="w", padx=12, pady=(6, 0))
        self.edge_sec.set(next((a for a, k in EDGE_SESLERI if k == self.a["edge_sesi"]), EDGE_SESLERI[0][0]))
        ttk.Button(mot, text="▶ Dinle", width=8, command=self._ses_dinle).grid(row=1, column=2, pady=(6, 0))
        ttk.Label(mot, text="Tanıma:").grid(row=1, column=3, sticky="e", padx=(16, 4), pady=(6, 0))
        self.model_sec = ttk.Combobox(mot, state="readonly", width=34, values=[s[0] for s in TANIMA_SECENEKLERI])
        self.model_sec.grid(row=1, column=4, sticky="w", pady=(6, 0))
        self.model_sec.set(next((s[0] for s in TANIMA_SECENEKLERI
                                 if s[1] == self.a["tanima"] and (s[1] == "google" or s[2] == self.a["whisper_modeli"])),
                                TANIMA_SECENEKLERI[0][0]))
        self._motor_degisti()

        orta = ttk.Frame(k, padding=(10, 4))
        orta.pack(fill="x")
        self.dugme = ttk.Button(orta, text="▶  Başlat", command=self.baslat_durdur, width=14)
        self.dugme.pack(side="left")
        self.mod = tk.StringVar(value="ceviri")
        mf = ttk.LabelFrame(orta, text="Mikrofon modu", padding=(8, 2))
        mf.pack(side="left", padx=10)
        for deger, yazi in (("ceviri", "Çevir (TR→EN)"), ("dogrudan", "Doğrudan (kendi sesim)"),
                            ("sessiz", "Sessiz")):
            ttk.Radiobutton(mf, text=yazi, value=deger, variable=self.mod,
                            command=self._mod).pack(side="left", padx=3)
        self.altyazi_acik = tk.BooleanVar(value=True)
        ttk.Checkbutton(orta, text="Türkçe altyazı", variable=self.altyazi_acik,
                        command=self._altyazi_ac_kapa).pack(side="left", padx=6)

        dur = ttk.Frame(k, padding=(10, 2))
        dur.pack(fill="x")
        ttk.Label(dur, text="Ben:").grid(row=0, column=0, sticky="w")
        self.cubuk_ben = tk.Canvas(dur, height=12, width=220, bg="#eee", highlightthickness=0)
        self.cubuk_ben.grid(row=0, column=1, padx=4)
        self.durum_ben = ttk.Label(dur, text="—", width=24)
        self.durum_ben.grid(row=0, column=2, sticky="w")
        ttk.Label(dur, text="Onlar:").grid(row=1, column=0, sticky="w")
        self.cubuk_onlar = tk.Canvas(dur, height=12, width=220, bg="#eee", highlightthickness=0)
        self.cubuk_onlar.grid(row=1, column=1, padx=4)
        self.durum_onlar = ttk.Label(dur, text="—", width=24)
        self.durum_onlar.grid(row=1, column=2, sticky="w")
        self.gecikme = ttk.Label(dur, text="", foreground="#555")
        self.gecikme.grid(row=0, column=3, rowspan=2, sticky="w", padx=10)
        self.ses_bilgi = ttk.Label(dur, text="", foreground="#555")
        self.ses_bilgi.grid(row=2, column=0, columnspan=4, sticky="w", pady=(4, 0))

        self.gunluk = scrolledtext.ScrolledText(k, wrap="word", font=("Segoe UI", 10), state="disabled")
        self.gunluk.pack(fill="both", expand=True, padx=10, pady=(6, 10))
        self.gunluk.tag_configure("ben", foreground="#0b5394")
        self.gunluk.tag_configure("onlar", foreground="#38761d")
        self.gunluk.tag_configure("soluk", foreground="#777")
        self.gunluk.tag_configure("hata", foreground="#c00")

    def _cihazlari_doldur(self):
        self.cihaz = {
            "mikrofon": ses.girisler(),
            "cikis": ses.cikislar(),
            "dinleme": ses.loopbackler(),
            "kendini_duy": ses.cikislar(),
        }
        vars_ = {
            "mikrofon": ses.bul(self.cihaz["mikrofon"], self.a["mikrofon"]) or ses.varsayilan_mikrofon(),
            # VB-Cable varsa her zaman onu seç (sahte denemede hoparlör seçilmiş olsa bile)
            "cikis": ses.sanal_kablo() or ses.bul(self.cihaz["cikis"], self.a["cikis"])
                     or ses.bul(self.cihaz["cikis"], "Hoparlör"),   # VB-Cable yokken deneme için
            "dinleme": ses.bul(self.cihaz["dinleme"], self.a["dinleme"]) or ses.varsayilan_loopback(),
            "kendini_duy": ses.bul(self.cihaz["kendini_duy"], self.a["kendini_duy"]),
        }
        for ad, cb in self.sec.items():
            adlar = [d["name"] for d in self.cihaz[ad]]
            if ad in ("dinleme", "kendini_duy"):
                adlar = [YOK] + adlar
            cb["values"] = adlar
            v = vars_[ad]
            cb.set(v["name"] if v else (YOK if ad in ("dinleme", "kendini_duy") else ""))
        if not ses.sanal_kablo():
            self._yaz("⚠ VB-Cable bulunamadı. Kurulmadan İngilizce ses Teams'e gidemez (README'ye bak). "
                      "Şimdilik çıkışı hoparlör seçerek deneyebilirsin.\n", "hata")

    def _secili(self, ad):
        isim = self.sec[ad].get()
        if not isim or isim == YOK:
            return None
        return ses.bul(self.cihaz[ad], isim)

    def _yaz(self, metin, etiket=None):
        self.gunluk.configure(state="normal")
        self.gunluk.insert("end", metin, etiket)
        self.gunluk.configure(state="disabled")
        self.gunluk.see("end")

    # --------------------------------------------------------- eylemler
    def baslat_durdur(self):
        if self.tercuman and self.tercuman.calisiyor:
            self.tercuman.durdur()
            self.tercuman = None
            self.dugme.configure(text="▶  Başlat")
            self.durum_ben.configure(text="—")
            self.durum_onlar.configure(text="—")
            self.altyazi.withdraw()
            self._yaz("■ Durduruldu.\n", "soluk")
            return
        mik, cik = self._secili("mikrofon"), self._secili("cikis")
        dinle, izle = self._secili("dinleme"), self._secili("kendini_duy")
        if not mik or not cik:
            messagebox.showwarning("Eksik", "Mikrofon ve çıkış cihazı seçilmeli.")
            return
        if izle and dinle and izle["name"] in dinle["name"]:
            self._yaz("ℹ İngilizce sesin karşı tarafı dinlediğin hoparlörden de çalacak. Sen konuşurken "
                      "altyazı kısa süre duraklar; toplantıda kulaklık kullanman daha iyi olur.\n", "soluk")
        for ad in ("mikrofon", "cikis", "dinleme", "kendini_duy"):
            v = self.sec[ad].get()
            self.a[ad] = "" if v == YOK else v
        self._motor_ayarlarini_al()
        ayarlar.kaydet(self.a)
        if self.a["motor"] == "ucretsiz" and not self.sahte:
            self._yaz("Konuşma tanıma modeli yükleniyor (ilk seferde indirilir, biraz sürebilir)…\n", "soluk")
            self.kok.config(cursor="watch")
            self.kok.update()
        try:
            self.tercuman = Tercuman(self.a, self.olaylar.put, sahte=self.sahte)
            self.tercuman.mod = self.mod.get()
            self.tercuman.altyazi = self.altyazi_acik.get() and dinle is not None
            self.tercuman.baslat(mik, cik, dinle, izle)
        except Exception as e:
            if self.tercuman:
                self.tercuman.durdur()
            self.tercuman = None
            self.kok.config(cursor="")
            messagebox.showerror("Başlatılamadı", str(e))
            return
        self.kok.config(cursor="")
        self.dugme.configure(text="■  Durdur")
        s = self.tercuman.servis
        if self.sahte:
            ses_turu = "sahte ton"
        elif self.a["motor"] == "ucretsiz":
            tanima = "Google" if self.a["tanima"] == "google" else f"Whisper {self.a['whisper_modeli']}"
            ses_turu = f"Ücretsiz — {self.edge_sec.get()} (Edge), tanıma: {tanima}"
        elif s.klon_ses:
            ses_turu = "senin klon sesin (ElevenLabs)"
        else:
            ses_turu = "standart OpenAI sesi — klon ses ayarlı değil"
        self.ses_bilgi.configure(text=f"İngilizce ses: {ses_turu}   •   Kayıt: kayitlar\\ klasörü")
        self._yaz(f"▶ Başladı. Mikrofon: {mik['name']}  →  {cik['name']}\n", "soluk")
        if self.tercuman.altyazi:
            self.altyazi.deiconify()

    def _motor_degisti(self):
        ucretsiz = self.motor.get() == "ucretsiz"
        self.model_sec.configure(state="readonly" if ucretsiz else "disabled")

    def _motor_ayarlarini_al(self):
        self.a["motor"] = self.motor.get()
        self.a["edge_sesi"] = dict(EDGE_SESLERI)[self.edge_sec.get()]
        secim = next(s for s in TANIMA_SECENEKLERI if s[0] == self.model_sec.get())
        self.a["tanima"], self.a["whisper_modeli"] = secim[1], secim[2]

    def _ses_dinle(self):
        """Seçili Edge sesiyle örnek cümleyi varsayılan hoparlörden çalar."""
        import threading
        from servisler import edge_seslendir
        self._motor_ayarlarini_al()
        hoparlor = ses.bul(ses.cikislar(), "Hoparlör") or (ses.cikislar() or [None])[0]

        def calis():
            try:
                c = ses.Calici(hoparlor)
                c.baslat()
                edge_seslendir("Hello everyone, thank you for joining. Let me walk you through our results.",
                               self.a["edge_sesi"], self.a["edge_hiz"], lambda p: c.yaz(p, 24000))
                import time
                while c.caliyor:
                    time.sleep(0.1)
                time.sleep(0.2)
                c.durdur()
            except Exception as e:
                self.olaylar.put({"tur": "hata", "yon": "giden", "mesaj": f"Ses örneği: {e}"})

        threading.Thread(target=calis, daemon=True).start()

    def _mod(self):
        if self.tercuman:
            self.tercuman.mod_degistir(self.mod.get())

    def _altyazi_ac_kapa(self):
        acik = self.altyazi_acik.get()
        if self.tercuman and self.tercuman.calisiyor:
            self.tercuman.altyazi = acik and self.tercuman.dinle_yakala is not None
            (self.altyazi.deiconify if self.tercuman.altyazi else self.altyazi.withdraw)()

    # ------------------------------------------------------------ döngü
    def _cubuk(self, tuval, seviye, esik=None):
        import math
        tuval.delete("all")

        def olcek(v):  # -66 dB .. 0 dB -> 0 .. 220 piksel (kısık mikrofonda da hareket görünsün)
            return int(max(0.0, min(1.0, (20 * math.log10(max(v, 1e-6)) + 66) / 66)) * 220)

        konusma = esik is not None and seviye > esik
        tuval.create_rectangle(0, 0, olcek(seviye), 12, fill="#3c9d5d" if konusma else "#4a90d9", width=0)
        if esik:
            x = olcek(esik)
            tuval.create_line(x, 0, x, 12, fill="#c00", width=2)

    def _dongu(self):
        try:
            while True:
                self._olay(self.olaylar.get_nowait())
        except queue.Empty:
            pass
        if self.tercuman and self.tercuman.calisiyor:
            ben, onlar, esik = self.tercuman.seviyeler()
            self._cubuk(self.cubuk_ben, ben, esik)
            self._cubuk(self.cubuk_onlar, onlar)
            if self.tercuman.konusuyor:
                self.durum_ben.configure(text=DURUM_YAZI["konusuyor"])
        self.kok.after(50, self._dongu)

    def _olay(self, o):
        yon = o.get("yon")
        etiket = self.durum_ben if yon == "giden" else self.durum_onlar
        if o["tur"] == "parca":
            if yon == "giden":
                self._yaz(f"🎤 Konuşma algılandı ({o['sure']:.1f} sn) — çevriliyor…\n", "soluk")
            return
        if o["tur"] == "anlasilamadi":
            if yon == "giden":
                self._yaz("   (ses algılandı ama konuşma anlaşılamadı — biraz daha yakın/yüksek sesle dene)\n", "soluk")
            return
        if o["tur"] == "durum":
            etiket.configure(text=DURUM_YAZI.get(o["durum"], o["durum"]))
        elif o["tur"] == "hata":
            self._yaz(f"⚠ {o['mesaj']}\n", "hata")
            etiket.configure(text="Hata (günlüğe bak)")
        elif o["tur"] == "ceviri":
            etiket.configure(text="Dinliyor")
            g = o.get("gecikme")
            if g is not None:
                self.gecikme.configure(text=f"Son gecikme ({'ben' if yon == 'giden' else 'onlar'}): {g:.1f} sn")
            if yon == "giden":
                self._yaz("BEN: ", "ben")
                self._yaz(o["kaynak"] + "\n", "soluk")
                self._yaz("   → " + o["ceviri"] + "\n", "ben")
            else:
                self._yaz("ONLAR: ", "onlar")
                self._yaz(o["kaynak"] + "\n", "soluk")
                self._yaz("   → " + o["ceviri"] + "\n", "onlar")
                self.altyazi.ekle(o["ceviri"], o["kaynak"])

    def kapat(self):
        if self.tercuman:
            self.tercuman.durdur()
        ayarlar.kaydet(self.a)
        self.kok.destroy()

    def calistir(self):
        self.kok.mainloop()


def _hata_kaydi(*args):
    import datetime
    import traceback
    metin = "".join(traceback.format_exception(*args[-3:]))
    try:
        with open(ayarlar.KOK / "hata.log", "a", encoding="utf-8") as f:
            f.write(f"\n--- {datetime.datetime.now():%Y-%m-%d %H:%M:%S} ---\n{metin}")
    except Exception:
        pass
    print(metin, file=sys.stderr)
    try:
        messagebox.showerror("Hata", metin[-800:])
    except Exception:
        pass


if __name__ == "__main__":
    import threading
    sys.excepthook = _hata_kaydi
    threading.excepthook = lambda a: _hata_kaydi(a.exc_type, a.exc_value, a.exc_traceback)
    try:
        u = Uygulama(sahte="--sahte" in sys.argv)
        u.kok.report_callback_exception = _hata_kaydi
        u.calistir()
    except Exception:
        _hata_kaydi(*sys.exc_info())

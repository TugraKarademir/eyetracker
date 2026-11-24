"""Yönetim ekranı sorguları (yalnız okur). Yalnız standart kütüphane."""
import csv
import io
import json
import sqlite3

KALITE_ESIK = {"iyi": {"kamerada": 90, "kalibreli": 80, "hz": 8, "hata": 200},
               "orta": {"kamerada": 70, "kalibreli": 50}}
_SATIR, _SUTUN, _KUTU = 18, 32, 10


def _j(v, bos=None):
    if v is None:
        return bos
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return bos


def _ort(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if v else None


def _yuv(v, n=1):
    return None if v is None else round(v, n)


def _sn(v):
    return None if v is None else round(v)


def _pct(sayi, toplam):
    return round(100 * sayi / toplam) if toplam else None


def _baskin(emos):
    sayac = {}
    for e in emos:
        if e is not None:
            sayac[e] = sayac.get(e, 0) + 1
    return _en_cok(sayac)


def _en_cok(sayac):
    """En sık değer; eşitlikte alfabetik ilk (sıra/ekleme düzenine bağlı değil)."""
    return min(sayac, key=lambda k: (-round(sayac[k], 9), k)) if sayac else None


def _isi(rows):
    g = [[0] * _SUTUN for _ in range(_SATIR)]
    for r in rows:
        for p in _j(r["mat_pts"], []) or []:
            try:
                u, v = float(p[0]), float(p[1])
                y = min(max(int(v * _SATIR), 0), _SATIR - 1)
                x = min(max(int(u * _SUTUN), 0), _SUTUN - 1)
            except (TypeError, ValueError, IndexError, OverflowError):
                continue
            g[y][x] += 1
    m = max(max(s) for s in g)
    return [[c / m if m else 0.0 for c in s] for s in g]


def _ozet(rows):
    """Örnek satırlarından ortak özet alanları."""
    kal = [r for r in rows if r["gaze_cal"] == 1]
    # share boş/None: pencerede bakış sayılmamış, ölçüm değil; atlanır.
    # Dolu share'de "materyal" yoksa o bölgeye bakılmamıştır (0).
    bak, bak_sid = [], set()
    for r in kal:
        sh = _j(r["share"], {})
        if isinstance(sh, dict) and sh:
            bak.append(sh.get("materyal") or 0)
            bak_sid.add(r["sid"])
    return {
        "bakma_pct": round(100 * sum(bak) / len(bak)) if bak else None,
        "ort_dikkat": _yuv(_ort(r["attention"] for r in rows)),
        "ort_enerji": _yuv(_ort(r["energy"] for r in rows)),
        "baskin_duygu": _baskin(r["emotion"] for r in rows),
        "n_ornek": len(rows),
        "n_kalibreli": len({r["sid"] for r in kal}),
        "n_bakma": len(bak_sid),   # bakma_pct ortalamasına en az bir örnekle katılan öğrenci
        "n_bakma_ornek": len(bak),   # bakma_pct'ye katkı veren örnek (kalibreli + dolu share)
        "n_kalibreli_ornek": len(kal),
    }


def kalite(kamerada_pct, kalibreli_pct, hz, kal_hata):
    if all(v is None for v in (kamerada_pct, kalibreli_pct, hz, kal_hata)):
        return "veri yok"
    i, o = KALITE_ESIK["iyi"], KALITE_ESIK["orta"]

    def ge(v, e):
        return v is not None and v >= e
    if (ge(kamerada_pct, i["kamerada"]) and ge(kalibreli_pct, i["kalibreli"])
            and ge(hz, i["hz"]) and (kal_hata is None or kal_hata <= i["hata"])):
        return "iyi"
    if ge(kamerada_pct, o["kamerada"]) and ge(kalibreli_pct, o["kalibreli"]):
        return "orta"
    return "düşük"


def _sorgu(con, sql, *a):
    return con.execute(sql, a).fetchall()


def _bitis(con, code, ended):
    if ended is not None:
        return ended
    return _sorgu(con, "SELECT MAX(t) FROM samples WHERE lesson_code=?", code)[0][0]


def kalibrasyonlar(con, ogretmen=None):
    """Ders sayfasından gelen bütün kalibrasyon raporları (öğretmen, ders, öğrenci ve o anki kurulumla)."""
    sql = ("SELECT c.*, l.name AS ders, l.teacher_id, t.name AS ogretmen, s.name AS ogrenci, s.participant_code AS pcode"
           " FROM calibrations c JOIN lessons l ON l.code=c.lesson_code LEFT JOIN teachers t ON t.id=l.teacher_id"
           " LEFT JOIN students s ON s.lesson_code=c.lesson_code AND s.sid=c.sid")
    a = []
    if ogretmen:
        sql += " WHERE l.teacher_id=?"
        a.append(ogretmen)
    out = []
    for r in _sorgu(con, sql + " ORDER BY c.t DESC", *a):
        k = _j(r["report"], {}) or {}
        ak = k.get("aktarim") if isinstance(k.get("aktarim"), dict) else {}
        gl = k.get("gazelab") if isinstance(k.get("gazelab"), dict) else {}
        kur = _sorgu(con, "SELECT setup FROM setups WHERE lesson_code=? AND sid=? AND t<=? ORDER BY t DESC LIMIT 1",
                     r["lesson_code"], r["sid"], r["t"] + 5)
        kur = _j(kur[0]["setup"], {}) if kur else {}
        out.append({"t": r["t"], "at": r["at"], "code": r["lesson_code"], "ders": r["ders"], "sid": r["sid"],
                    "ogrenci": r["ogrenci"], "pcode": r["pcode"], "teacher_id": r["teacher_id"], "ogretmen": r["ogretmen"],
                    "acc": k.get("acc"), "hit3": k.get("hit3"), "gl_acc": gl.get("acc"), "gl_prec": gl.get("prec"),
                    "model": ak.get("ad") or "bizim (ana model)", "model_kod": ak.get("kod") or "biz", "gerekce": ak.get("gerekce"),
                    "kaynak": k.get("kaynak"), "n": k.get("n"), "zoom": k.get("zoom"), "kamera": k.get("kamera") or kur.get("kamera"),
                    "ekran": kur.get("ekran"), "pencere": kur.get("pencere"), "uzaklik": kur.get("uzaklikCm"),
                    "tarayici": kur.get("tarayici"), "kameraKonumu": (k.get("kameraKonumu") or {}).get("metin")})
    return out


def dersler(con, ara=None, bas=None, bit=None, ogretmen=None):
    sql, a = ("SELECT l.*, t.name AS teacher_name FROM lessons l LEFT JOIN teachers t ON t.id=l.teacher_id"
              " WHERE 1=1"), []
    if ogretmen == "-":
        sql += " AND l.teacher_id IS NULL"
    elif ogretmen:
        sql += " AND l.teacher_id=?"
        a.append(ogretmen)
    if ara:
        sql += " AND (l.name LIKE ? OR l.topic LIKE ? OR l.code LIKE ? OR t.name LIKE ?)"
        a += [f"%{ara}%"] * 4
    if bas is not None:
        sql += " AND l.created>=?"
        a.append(bas)
    if bit is not None:
        sql += " AND l.created<=?"
        a.append(bit)
    out = []
    for d in _sorgu(con, sql + " ORDER BY l.created DESC", *a):
        c = d["code"]
        son = _bitis(con, c, d["ended"])
        ok = son is not None and d["created"] is not None
        ornek = _sorgu(con, "SELECT attention, gaze_cal FROM samples"
                            " WHERE lesson_code=?", c)
        kal = sum(1 for r in ornek if r["gaze_cal"] == 1)
        tur = {r[0]: r[1] for r in _sorgu(
            con, "SELECT kind, COUNT(*) FROM materials WHERE lesson_code=?"
                 " GROUP BY kind", c)}
        row = {"code": c, "name": d["name"], "topic": d["topic"],
               "teacher_id": d["teacher_id"], "teacher_name": d["teacher_name"],
               "created": d["created"], "ended": d["ended"],
               "sure_dk": round(max(0, son - d["created"]) / 60, 1) if ok else None,
               "n_ogrenci": _sorgu(
                   con, "SELECT COUNT(*) FROM students WHERE lesson_code=?", c)[0][0],
               "n_materyal": sum(tur.values()),
               "n_insan": tur.get("insan", 0), "n_yz": tur.get("yz", 0),
               "ort_dikkat": _yuv(_ort(r["attention"] for r in ornek)),
               "kalibreli_pct": _pct(kal, len(ornek))}
        if d["ended"] is None:
            row["bitmedi"] = True
        out.append(row)
    return out


def _span_sure(con, code, ended):
    son = _bitis(con, code, ended)
    top = {}
    for s in _sorgu(con, "SELECT * FROM material_spans WHERE lesson_code=?", code):
        bit = s["t_end"] if s["t_end"] is not None else son
        if bit is not None and s["t_start"] is not None:
            top[s["material_id"]] = (top.get(s["material_id"], 0)
                                     + max(0, bit - s["t_start"]))
    return top


def _olaylar(con, sql, *a):
    return [{"sid": r["sid"], "t": r["t"], "kind": r["kind"], "data": _j(r["data"])}
            for r in _sorgu(con, sql, *a)]


def _son_hata(con, code, sid):
    r = _sorgu(con, "SELECT report FROM calibrations WHERE lesson_code=? AND sid=?"
                    " ORDER BY rowid DESC LIMIT 1", code, sid)
    rep = _j(r[0][0], {}) if r else {}
    acc = rep.get("acc") if isinstance(rep, dict) else None
    return acc if isinstance(acc, (int, float)) else None


def _kalite_ozet(rs, kal_hata):
    n = len(rs)
    kal = [r for r in rs if r["gaze_cal"] == 1]
    kam = _pct(sum(1 for r in rs if r["face"] == 1), n)
    kp = _pct(len(kal), n)
    nokta = sum(len(_j(r["gaze"], []) or []) for r in kal)
    hz = round(nokta / (len(kal) * 2), 1) if kal else None
    return {"kamerada_pct": kam, "kalibreli_pct": kp, "hz": hz,
            "kal_hata": kal_hata, "not": kalite(kam, kp, hz, kal_hata)}


def _say(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _tar_ayir(s):
    """'Chrome 120.0.1' -> ('Chrome', '120.0.1'); ayrılamıyorsa (s, None)."""
    if not isinstance(s, str) or not s.strip():
        return None, None
    ad, _, sur = s.strip().rpartition(" ")
    return (ad, sur) if ad and sur[:1].isdigit() else (s.strip(), None)


def _d(v):
    return v if isinstance(v, dict) else {}


def _l(v):
    return v if isinstance(v, list) else []


def _os_ua(c2):
    pl = _d(c2.get("uaVeri")).get("platform")
    if isinstance(pl, str) and pl:
        return pl
    ua = c2.get("ua") if isinstance(c2.get("ua"), str) else ""
    for anahtar, ad in (("Windows NT 10.0", "Windows 10/11"), ("Android", "Android"), ("CrOS", "ChromeOS"),
                        ("Mac OS X", "macOS"), ("Linux", "Linux")):
        if anahtar in ua:
            return ad
    return None


CIHAZ_ALAN = ("tarayici", "tarayiciSurum", "isletimSistemi", "cekirdek", "bellekGB", "gpu", "gpuVendor", "kamera",
              "kameraCozunurluk", "kameraFpsAyar", "kameraFpsOlculen", "islemeFps", "delegate", "isci")


def cihaz_ozet(setup):
    """Kurulum JSON'undan düz cihaz özeti. cihazOzet varsa o; eksik alanlar cihazTam, sonra cihaz2 ve kurulumun
    kendi alanlarından (tarayici, kamera, fps, islemeFps, isci) türetilir. Türetilemeyen None. Kurulum yoksa ya da
    istemci JSON'u beklenen biçimde değilse None (hata fırlatmaz)."""
    try:
        return _cihaz_ozet(setup)
    except (TypeError, ValueError, AttributeError, KeyError):
        return None


def _cihaz_ozet(setup):
    if not isinstance(setup, dict):
        return None
    c2, tam = _d(setup.get("cihaz2")), _d(setup.get("cihazTam"))
    g, k = _d(tam.get("gpu")), _d(tam.get("kamera"))
    ay, d = _d(k.get("ayar")), _d(tam.get("diger"))
    tar, sur = _tar_ayir(setup.get("tarayici"))
    cozun = (f"{int(ay['width'])}x{int(ay['height'])}" if _say(ay.get("width")) and _say(ay.get("height")) else None)
    tur = {
        "tarayici": tar, "tarayiciSurum": sur, "isletimSistemi": _os_ua(c2) if c2 else None,
        "cekirdek": _d(tam.get("islemci")).get("mantiksalCekirdek", c2.get("cekirdek")),
        "bellekGB": _d(tam.get("bellek")).get("deviceMemoryGB", c2.get("bellekGB")),
        "gpu": g.get("webglRenderer") or c2.get("gpu") or None, "gpuVendor": g.get("webglVendor") or None,
        "kamera": k.get("label") or None, "kameraCozunurluk": cozun or setup.get("kamera") or None,
        "kameraFpsAyar": ay.get("frameRate") if _say(ay.get("frameRate")) else setup.get("fps"),
        "kameraFpsOlculen": None, "islemeFps": setup.get("islemeFps"),
        "delegate": d.get("mediapipeDelegate"),
        "isci": d["isci"] if isinstance(d.get("isci"), bool) else setup.get("isci"),
    }
    oz = _d(setup.get("cihazOzet"))
    out = {a: (oz[a] if oz.get(a) is not None else tur[a]) for a in CIHAZ_ALAN}
    # istemciden gelen değerler yalnız düz değer olabilir (dict/list özet alanına sızmasın)
    out = {a: (v if v is None or isinstance(v, (str, int, float, bool)) else None) for a, v in out.items()}
    if all(v is None for v in out.values()):
        return None
    return out


def cihaz_tam(setup):
    """Öğrenci görünümü için ayrıntılı cihaz bilgisi: cihazTam (varsa) ya da cihaz2, kaynağı belirtilir; yoksa None."""
    if not isinstance(setup, dict):
        return None
    if isinstance(setup.get("cihazTam"), dict):
        return {"kaynak": "cihazTam", "veri": setup["cihazTam"]}
    if isinstance(setup.get("cihaz2"), dict):
        return {"kaynak": "cihaz2", "veri": setup["cihaz2"]}
    return None


def _durum(son):
    if son is None:
        return "baslamadi"
    if son["durum"] == "bitti":
        return "bitti" if son["model"] else "bitmedi"   # öğretmen paneliyle aynı kural
    return "suruyor"


def _bakis_ozet(satirlar):
    """satirlar: bakis_testleri satırları (zaman artan). Durum son denemeden; GL px / model son biten denemeden."""
    if not satirlar:
        return {"durum": "baslamadi", "deneme": 0, "gl_acc": None, "model": None, "t": None}
    son = satirlar[-1]
    biten = [r for r in satirlar if r["durum"] == "bitti"]
    kaynak = biten[-1] if biten else son
    return {"durum": _durum(son), "deneme": len(satirlar), "gl_acc": kaynak["gl_acc"],
            "model": kaynak["model"] if biten else None, "t": son["t"]}


def _bakis_satirlari(con, code, sid=None):
    sql = "SELECT * FROM bakis_testleri WHERE lesson_code=?" + (" AND sid=?" if sid else "") + " ORDER BY t, rowid"
    try:
        return _sorgu(con, sql, *((code, sid) if sid else (code,)))
    except sqlite3.OperationalError:   # eski veritabanı: tablo yok
        return []


def _onay(s):
    kol = s.keys()
    t = s["onay_t"] if "onay_t" in kol else None
    surum = s["onay_surum"] if "onay_surum" in kol else None
    return {"var": t is not None, "t": t, "surum": surum}


def _son_kurulumlar(con, code):
    son = {}
    for r in _sorgu(con, "SELECT sid, setup FROM setups WHERE lesson_code=? ORDER BY rowid", code):
        son[r["sid"]] = _j(r["setup"])
    return son


def cihazlar(con):
    """Bütün derslerdeki öğrencilerin cihaz özeti, bakış testi durumu ve GazeLab doğruluğu (tek liste)."""
    out = []
    for d in _sorgu(con, "SELECT code, name FROM lessons ORDER BY created DESC, rowid DESC"):
        kur = _son_kurulumlar(con, d["code"])
        bk = {}
        for r in _bakis_satirlari(con, d["code"]):
            bk.setdefault(r["sid"], []).append(r)
        for s in _sorgu(con, "SELECT * FROM students WHERE lesson_code=? ORDER BY joined", d["code"]):
            out.append({"code": d["code"], "ders": d["name"], "sid": s["sid"], "name": s["name"],
                        "participant_code": s["participant_code"],
                        "cihaz": cihaz_ozet(kur.get(s["sid"])), "bakis": _bakis_ozet(bk.get(s["sid"], [])),
                        "onay": _onay(s)})
    return out


def ders(con, code):
    d = _sorgu(con, "SELECT * FROM lessons WHERE code=?", code)
    if not d:
        return None
    d = dict(d[0])
    d["teacher_meta"] = _j(d.get("teacher_meta"))
    rows = _sorgu(con, "SELECT * FROM samples WHERE lesson_code=? ORDER BY t", code)
    kutu = {}
    for r in rows:
        kutu.setdefault(int(r["t"] // _KUTU * _KUTU), []).append(r)
    zaman = []
    for t, rs in sorted(kutu.items()):
        duy = {}
        for r in rs:
            if r["emotion"] is not None:
                duy[r["emotion"]] = duy.get(r["emotion"], 0) + 1
        zaman.append({"t": t, "dikkat": _yuv(_ort(r["attention"] for r in rs)),
                      "enerji": _yuv(_ort(r["energy"] for r in rs)),
                      "duygular": duy, "n": len(rs)})
    sureler = _span_sure(con, code, d["ended"])
    mats = []
    for m in _sorgu(con, "SELECT * FROM materials WHERE lesson_code=? ORDER BY idx",
                    code):
        rs = [r for r in rows if r["material_id"] == m["id"]]
        o = _ozet(rs)
        mats.append({"id": m["id"], "name": m["name"], "kind": m["kind"],
                     "hasImage": bool(m["image_path"]),
                     # hiç gösterilmediyse (span yok) süre bilinmez: None, 0 değil
                     "sure_sn": _sn(sureler.get(m["id"])),
                     "n_kalibreli": o["n_kalibreli"], "bakma_pct": o["bakma_pct"],
                     "n_bakma": o["n_bakma"],
                     "ort_dikkat": o["ort_dikkat"], "ort_enerji": o["ort_enerji"],
                     "baskin_duygu": o["baskin_duygu"], "isi": _isi(rs),
                     "n_ornek": o["n_ornek"]})
    ogr = []
    kurs = _son_kurulumlar(con, code)
    bks = {}
    for r in _bakis_satirlari(con, code):
        bks.setdefault(r["sid"], []).append(r)
    for s in _sorgu(con, "SELECT * FROM students WHERE lesson_code=? ORDER BY joined",
                    code):
        rs = [r for r in rows if r["sid"] == s["sid"]]
        o = _ozet(rs)
        kl = _kalite_ozet(rs, _son_hata(con, code, s["sid"]))
        ogr.append({"sid": s["sid"], "name": s["name"],
                    "participant_code": s["participant_code"], "joined": s["joined"],
                    "ort_dikkat": o["ort_dikkat"], "ort_enerji": o["ort_enerji"],
                    "baskin_duygu": o["baskin_duygu"], "n_ornek": o["n_ornek"],
                    "kalite": kl, "onay": _onay(s), "bakis": _bakis_ozet(bks.get(s["sid"], [])),
                    "cihaz": cihaz_ozet(kurs.get(s["sid"]))})
    spans = [dict(s) for s in _sorgu(
        con, "SELECT * FROM material_spans WHERE lesson_code=? ORDER BY t_start", code)]
    return {"ders": d, "zaman": zaman, "spans": spans, "materyaller": mats,
            "ogrenciler": ogr,
            "olaylar": _olaylar(
                con, "SELECT * FROM events WHERE lesson_code=? ORDER BY t", code)}


def ogrenci(con, code, sid):
    s = _sorgu(con, "SELECT * FROM students WHERE lesson_code=? AND sid=?", code, sid)
    if not s:
        return None
    rs = _sorgu(con, "SELECT * FROM samples WHERE lesson_code=? AND sid=? ORDER BY t",
                code, sid)
    bakis = []
    for r in rs:
        if r["gaze_cal"] != 1:
            continue
        for p in _j(r["gaze"], []) or []:
            try:
                bakis.append([round(r["t"] * 1000 + p[0]), p[1], p[2]])
            except (TypeError, IndexError):
                continue
    bakis.sort(key=lambda p: p[0])
    isi = {}
    for mid in sorted({r["material_id"] for r in rs if r["material_id"] is not None}):
        isi[str(mid)] = _isi([r for r in rs if r["material_id"] == mid])
    son_kur = _son_kurulumlar(con, code).get(sid)
    return {
        "bilgi": dict(s[0]),
        "onay": _onay(s[0]),
        "bakis_denemeleri": [{"t": r["t"], "durum": r["durum"], "gl_acc": r["gl_acc"], "model": r["model"],
                              "dosya": r["dosya"]} for r in _bakis_satirlari(con, code, sid)],
        "cihaz": cihaz_ozet(son_kur),
        "cihaz_tam": cihaz_tam(son_kur),
        "kalite": _kalite_ozet(rs, _son_hata(con, code, sid)),
        "ornekler": [[r["t"], r["attention"], r["energy"], r["emotion"],
                      r["material_id"]] for r in rs],
        "bakis": bakis,
        "kurulumlar": [{"t": r["t"], "setup": _j(r["setup"])} for r in _sorgu(
            con, "SELECT * FROM setups WHERE lesson_code=? AND sid=? ORDER BY rowid",
            code, sid)],
        "kalibrasyonlar": [{"t": r["t"], "at": r["at"], "report": _j(r["report"])}
                           for r in _sorgu(
            con, "SELECT * FROM calibrations WHERE lesson_code=? AND sid=?"
                 " ORDER BY rowid", code, sid)],
        "olaylar": _olaylar(
            con, "SELECT * FROM events WHERE lesson_code=? AND sid=? ORDER BY t",
            code, sid),
        "isi": isi,
    }


def _secili(con, dersler):
    if dersler is None:
        return [r[0] for r in _sorgu(con, "SELECT code FROM lessons ORDER BY created")]
    return list(dersler)


def _grup_ozet(rs):
    """Grup değeri = ders × öğrenci (lesson_code, sid) başına değerlerin ortalaması (örnek ağırlıklı havuz değil).
    Her ölçünün n'i = o ölçüye değer veren ders × öğrenci sayısı; n_ornek yalnız ikincil bilgi."""
    kisi = {}
    for r in rs:
        kisi.setdefault((r["lesson_code"], r["sid"]), []).append(r)
    bak, dik, ene, duy = [], [], [], []
    for krs in kisi.values():
        b = []
        for r in krs:
            if r["gaze_cal"] == 1:
                sh = _j(r["share"], {})
                if isinstance(sh, dict) and sh:   # _ozet ile aynı tanım
                    b.append(sh.get("materyal") or 0)
        if b:
            bak.append(100 * sum(b) / len(b))
        for hedef, alan in ((dik, "attention"), (ene, "energy")):
            v = _ort(r[alan] for r in krs)
            if v is not None:
                hedef.append(v)
        e = [r["emotion"] for r in krs if r["emotion"] is not None]
        if e:
            duy.append({k: e.count(k) / len(e) for k in sorted(set(e))})
    dag = {}
    for d in duy:   # öğrenci başına duygu payları, öğrenciler üzerinden ortalama
        for k, v in d.items():
            dag[k] = dag.get(k, 0) + v / len(duy)
    return {"bakma_pct": round(_ort(bak)) if bak else None, "n_bakma": len(bak),
            "ort_dikkat": _yuv(_ort(dik)), "n_dikkat": len(dik),
            "ort_enerji": _yuv(_ort(ene)), "n_enerji": len(ene),
            "duygu_pct": {k: round(100 * v) for k, v in sorted(dag.items())},
            "baskin_duygu": _en_cok(dag), "n_duygu": len(duy),
            "n_ogrenci": len(kisi), "n_ornek": len(rs)}


def _materyalli_ornekler(con, codes):
    """Örnek + materyal türü/adı + öğrenci adı/katılımcı kodu."""
    if not codes:
        return []
    q = ",".join("?" * len(codes))
    return _sorgu(
        con, "SELECT s.*, m.kind AS kind, m.name AS mname,"
             " st.participant_code AS pc, st.name AS sname FROM samples s"
             " JOIN materials m ON m.id=s.material_id"
             " LEFT JOIN students st ON st.lesson_code=s.lesson_code AND st.sid=s.sid"
             f" WHERE s.lesson_code IN ({q}) ORDER BY s.lesson_code, s.sid, s.t",
        *codes)


def karsilastirma(con, dersler=None):
    rows = _materyalli_ornekler(con, _secili(con, dersler))
    tur = {k: _grup_ozet([r for r in rows if r["kind"] == k])
           for k in ("insan", "yz", "diger")}
    kisi = {}
    for r in rows:
        if r["pc"] and r["kind"] in ("insan", "yz"):
            kisi.setdefault(r["pc"], {"insan": [], "yz": []})[r["kind"]].append(r)
    esl = [{"katilimci": k, "insan": _grup_ozet(v["insan"]), "yz": _grup_ozet(v["yz"])}
           for k, v in sorted(kisi.items()) if v["insan"] and v["yz"]]
    kodsuz = {(r["lesson_code"], r["sid"]) for r in rows if not r["pc"]}
    return {"tur": tur, "eslesik": esl, "kodsuz_n": len(kodsuz)}


def _hucre(v):
    if v is None:
        return ""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v   # tablo programı formül enjeksiyonuna karşı
    return v


def _csv(satirlar):
    b = io.StringIO()
    w = csv.writer(b, lineterminator="\n")
    for s in satirlar:
        w.writerow([_hucre(v) for v in s])
    return b.getvalue()


def csv_uzun(con, dersler=None):
    codes = _secili(con, dersler)
    out = [["ders", "katilimci", "ogrenci", "materyal", "tur", "sure_sn", "bakma_pct",
            "n_bakma_ornek", "n_kalibreli_ornek", "ort_dikkat", "ort_enerji", "baskin_duygu",
            "n_ornek"]]
    sure = {}
    for c in codes:
        e = _sorgu(con, "SELECT ended FROM lessons WHERE code=?", c)
        if e:
            sure.update(_span_sure(con, c, e[0][0]))
    grup = {}
    for r in _materyalli_ornekler(con, codes):
        grup.setdefault((r["lesson_code"], r["sid"], r["material_id"]), []).append(r)
    for (c, sid, mid), rs in grup.items():
        r0, o = rs[0], _ozet(rs)
        out.append([c, r0["pc"], r0["sname"] or sid, r0["mname"], r0["kind"],
                    _sn(sure.get(mid)), o["bakma_pct"], o["n_bakma_ornek"],
                    o["n_kalibreli_ornek"], o["ort_dikkat"], o["ort_enerji"],
                    o["baskin_duygu"], o["n_ornek"]])
    return _csv(out)


# samples.ham (2 sn ham yüz ölçüsü özeti, static/analyzer.js HamToplayici) düzleştirilmiş sütunları: "yaw_ort" → ham["yaw"]["ort"]
HAM_SUTUN = ("n", "yuzN", "ms", "yaw_ort", "yaw_min", "yaw_max", "pitch_ort", "pitch_min", "pitch_max",
             "ear_ort", "ear_min", "mar_ort", "mar_max", "kirpma",
             "ifade_neutral", "ifade_happy", "ifade_sad", "ifade_angry", "ifade_fearful", "ifade_disgusted",
             "ifade_surprised", "pose3_yaw", "pose3_pitch", "pose3_roll", "pose3_dist", "pose3_n",
             "islemeFps", "isciGecikmeMs", "taban_yaw", "taban_pitch", "taban_ear")


def _ham_duz(metin):
    h = _j(metin)
    if not isinstance(h, dict):
        return [None] * len(HAM_SUTUN)
    out = []
    for ad in HAM_SUTUN:
        k, _, alt = ad.partition("_")
        v = h.get(ad) if not alt or ad in h else (h.get(k) or {}).get(alt) if isinstance(h.get(k), dict) else None
        out.append(v)
    return out


def csv_ham(con, code):
    out = [["ders", "ogrenci", "t", "material_id", "attention", "energy", "emotion",
            "face", "away", "eyes_closed", "tab_hidden", "gaze_cal", "coarse",
            "share", "mat_pts", "gaze", "wg_share", "head", "gecis"]
           + ["ham_" + a for a in HAM_SUTUN] + ["ham"]]
    for r in _sorgu(con, "SELECT * FROM samples WHERE lesson_code=? ORDER BY sid, t",
                    code):
        ham = r["ham"] if "ham" in r.keys() else None   # göç görmemiş eski veritabanı
        out.append([code, r["sid"], r["t"], r["material_id"], r["attention"],
                    r["energy"], r["emotion"], r["face"], r["away"],
                    r["eyes_closed"], r["tab_hidden"], r["gaze_cal"], r["coarse"],
                    r["share"], r["mat_pts"], r["gaze"], r["wg_share"], r["head"],
                    r["gecis"]] + _ham_duz(ham) + [ham])
    return _csv(out)

"""Yönetim ekranı sorguları (yalnız okur). Yalnız standart kütüphane."""
import csv
import io
import json

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


def _pct(sayi, toplam):
    return round(100 * sayi / toplam) if toplam else None


def _baskin(emos):
    sayac = {}
    for e in emos:
        if e is not None:
            sayac[e] = sayac.get(e, 0) + 1
    return max(sayac, key=sayac.get) if sayac else None


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


def dersler(con, ara=None, bas=None, bit=None):
    sql, a = "SELECT * FROM lessons WHERE 1=1", []
    if ara:
        sql += " AND (name LIKE ? OR topic LIKE ? OR code LIKE ?)"
        a += [f"%{ara}%"] * 3
    if bas is not None:
        sql += " AND created>=?"
        a.append(bas)
    if bit is not None:
        sql += " AND created<=?"
        a.append(bit)
    out = []
    for d in _sorgu(con, sql + " ORDER BY created DESC", *a):
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
                     "sure_sn": round(sureler.get(m["id"], 0)),
                     "n_kalibreli": o["n_kalibreli"], "bakma_pct": o["bakma_pct"],
                     "n_bakma": o["n_bakma"],
                     "ort_dikkat": o["ort_dikkat"], "ort_enerji": o["ort_enerji"],
                     "baskin_duygu": o["baskin_duygu"], "isi": _isi(rs),
                     "n_ornek": o["n_ornek"]})
    ogr = []
    for s in _sorgu(con, "SELECT * FROM students WHERE lesson_code=? ORDER BY joined",
                    code):
        rs = [r for r in rows if r["sid"] == s["sid"]]
        o = _ozet(rs)
        kl = _kalite_ozet(rs, _son_hata(con, code, s["sid"]))
        ogr.append({"sid": s["sid"], "name": s["name"],
                    "participant_code": s["participant_code"], "joined": s["joined"],
                    "ort_dikkat": o["ort_dikkat"], "ort_enerji": o["ort_enerji"],
                    "baskin_duygu": o["baskin_duygu"], "n_ornek": o["n_ornek"],
                    "kalite": kl})
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
    return {
        "bilgi": dict(s[0]),
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
    o = _ozet(rs)
    return {"bakma_pct": o["bakma_pct"], "ort_dikkat": o["ort_dikkat"],
            "n": o["n_ornek"]}


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
            "ort_dikkat", "ort_enerji", "baskin_duygu", "n_ornek"]]
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
                    round(sure.get(mid, 0)), o["bakma_pct"], o["ort_dikkat"],
                    o["ort_enerji"], o["baskin_duygu"], o["n_ornek"]])
    return _csv(out)


def csv_ham(con, code):
    out = [["ders", "ogrenci", "t", "material_id", "attention", "energy", "emotion",
            "face", "away", "eyes_closed", "tab_hidden", "gaze_cal", "coarse",
            "share", "mat_pts", "gaze", "wg_share", "head"]]
    for r in _sorgu(con, "SELECT * FROM samples WHERE lesson_code=? ORDER BY sid, t",
                    code):
        out.append([code, r["sid"], r["t"], r["material_id"], r["attention"],
                    r["energy"], r["emotion"], r["face"], r["away"],
                    r["eyes_closed"], r["tab_hidden"], r["gaze_cal"], r["coarse"],
                    r["share"], r["mat_pts"], r["gaze"], r["wg_share"], r["head"]])
    return _csv(out)

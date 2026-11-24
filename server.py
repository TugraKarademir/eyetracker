"""DersNabzı — canlı ders dikkat / duygu analitiği sunucusu.

Bağımlılık gerektirmez (yalnızca Python 3.9+ standart kütüphanesi).
Çalıştırma:  python server.py            -> http://localhost:8000
             python server.py --port 9000 --host 0.0.0.0

Mimari:
  * Öğrenci tarayıcısı kamerayı yerelde analiz eder (face-api), sunucuya yalnızca
    sayısal metrikler gönderir (POST /api/metrics). Görüntü cihazdan çıkmaz.
  * Öğretmen paneli ve öğrenciler Server-Sent Events (GET /api/stream) ile canlı
    güncelleme alır.
  * Ders bitince oturum data/<KOD>.json olarak saklanır; /report.html raporu gösterir.
"""
import argparse
import csv
import io
import json
import math
import os
import pathlib
import queue
import random
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import kayit
import yonetim

# PyInstaller paketinde (frozen) dosyalar sys._MEIPASS altında; geliştirmede bu dosyanın klasörü.
ROOT = getattr(sys, "_MEIPASS", None) if getattr(sys, "frozen", False) else None
ROOT = ROOT or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
# Veri klasörü: DERSNABZI_DATA (masaüstü uygulaması verir) -> yoksa ROOT/data. Her şey (ders kaydı, bakış testi kayıtları) orada durur.
_VERI_ENV = os.environ.get("DERSNABZI_DATA", "").strip()
if getattr(sys, "frozen", False) and not _VERI_ENV:
    # Paket klasörüne asla veri yazılmaz: paketli sunucu veri klasörünü ortamdan almak zorunda.
    sys.exit("DERSNABZI_DATA ortam değişkeni gerekli; paketli sunucuda --data tek başına yetmez "
             "(paketli sunucu kendi klasörüne veri yazmaz).")
DATA = os.path.abspath(_VERI_ENV) if _VERI_ENV else os.path.join(ROOT, "data")
TEST_DIR = os.path.join(DATA, "test_kayitlari") if _VERI_ENV else os.path.join(ROOT, "test_kayitlari")   # bakış testi kayıtları (telefondan da gelir)
os.makedirs(DATA, exist_ok=True)
KAYIT = kayit.ac(os.path.join(DATA, "dersler.db"))   # kalıcı ders kaydı; yazmalar LOCK altında

# ---- Bakış testi verileri GazeLab biçiminde (gazelab/server.py şeması + yöntem sütunu + yöntem özeti)
GL_DB = os.path.join(TEST_DIR, "gazelab.db")
GL_LOCK = threading.Lock()
GL_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, study_id TEXT, participant TEXT, status TEXT,
  device TEXT DEFAULT '{}', accuracy_px REAL, precision_px REAL,
  answers TEXT DEFAULT '{}', meta TEXT DEFAULT '{}', created_at REAL, completed_at REAL, log_file TEXT);
CREATE TABLE IF NOT EXISTS recordings(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, stimulus_id TEXT, method TEXT,
  order_idx INTEGER, started_at REAL, rect TEXT, gaze TEXT, mouse TEXT, head TEXT,
  UNIQUE(session_id, stimulus_id, method));
CREATE TABLE IF NOT EXISTS method_stats(
  session_id TEXT, method TEXT, label TEXT, gl_accuracy_px REAL, gl_precision_px REAL, gl_median_px REAL,
  gl_corrected_px REAL, control_median_px REAL, control_hit150_pct REAL, control_cell_pct REAL, sample_hz REAL,
  row TEXT, PRIMARY KEY(session_id, method));
CREATE TABLE IF NOT EXISTS phase_stats(session_id TEXT, idx INTEGER, phase TEXT, row TEXT, PRIMARY KEY(session_id, idx));
CREATE TABLE IF NOT EXISTS session_stats(session_id TEXT, idx INTEGER, section TEXT, name TEXT, value TEXT, PRIMARY KEY(session_id, idx));
"""


def gl_db():
    os.makedirs(TEST_DIR, exist_ok=True)
    con = sqlite3.connect(GL_DB)
    con.row_factory = sqlite3.Row
    con.executescript(GL_SCHEMA)
    return con


def gl_num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def gl_kaydet(g, log_file):
    """bakis_test.html glPaket() → SQLite. Oturum kimliği gazelab gibi 8 karakter."""
    se = g.get("session") if isinstance(g.get("session"), dict) else {}
    # Aynı test birden çok kez gönderilebilir (yüz kaybolunca otomatik gönderim): istemci kimliği varsa eski kayıt silinip yenisi yazılır
    cid = str(se.get("id") or "")
    sid = cid if re.fullmatch(r"[A-Za-z0-9_-]{6,16}", cid) else secrets.token_urlsafe(6)[:8]
    tab = g.get("tablolar") if isinstance(g.get("tablolar"), dict) else {}
    with GL_LOCK, gl_db() as con:
        for t in ("recordings", "method_stats", "phase_stats", "session_stats"):
            con.execute(f"DELETE FROM {t} WHERE session_id=?", (sid,))
        con.execute("DELETE FROM sessions WHERE id=?", (sid,))
        con.execute("INSERT INTO sessions(id,study_id,participant,status,device,accuracy_px,precision_px,meta,created_at,completed_at,log_file)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, "bakis_testi", None, str(se.get("status") or "started")[:20], json.dumps(se.get("device") or {}),
                     gl_num(se.get("accuracy_px")), gl_num(se.get("precision_px")), json.dumps(se.get("meta") or {}, ensure_ascii=False),
                     gl_num(se.get("created_at")) or time.time(), gl_num(se.get("completed_at")), log_file))
        for r in g.get("recordings") or []:
            if not isinstance(r, dict):
                continue
            gz = r.get("gaze") if isinstance(r.get("gaze"), dict) else {}
            stim = str(r.get("stimulus_id") or "?")[:40]
            for m, pts in (gz or {"-": []}).items():   # yöntem başına bir satır (gazelab: uyaran başına bir satır)
                con.execute("INSERT OR REPLACE INTO recordings(session_id,stimulus_id,method,order_idx,started_at,rect,gaze,mouse,head)"
                            " VALUES(?,?,?,?,?,?,?,?,?)",
                            (sid, stim, str(m)[:20], r.get("order_idx"), gl_num(r.get("started_at")), json.dumps(r.get("rect") or {}),
                             json.dumps(pts if isinstance(pts, list) else []), json.dumps(r.get("mouse") or []), json.dumps(r.get("head") or [])))
        for row in tab.get("yontem") or []:
            if isinstance(row, dict):
                con.execute("INSERT OR REPLACE INTO method_stats VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (sid, str(row.get("Kod"))[:20], str(row.get("Yöntem"))[:120], gl_num(row.get("GL doğruluk px")), gl_num(row.get("GL kesinlik px")),
                             gl_num(row.get("GL medyan px")), gl_num(row.get("GL düzeltmeli px")), gl_num(row.get("Kontrol medyan px")),
                             gl_num(row.get("Kontrol ≤150 %")), gl_num(row.get("Kontrol 3×3 %")), gl_num(row.get("Örnekleme Hz")),
                             json.dumps(row, ensure_ascii=False)))
        for i, row in enumerate(tab.get("asama") or []):
            if isinstance(row, dict):
                con.execute("INSERT OR REPLACE INTO phase_stats VALUES(?,?,?,?)", (sid, i, str(row.get("Aşama"))[:60], json.dumps(row, ensure_ascii=False)))
        for i, row in enumerate(tab.get("oturum") or []):
            if isinstance(row, dict):
                con.execute("INSERT OR REPLACE INTO session_stats VALUES(?,?,?,?,?)",
                            (sid, i, str(row.get("Bölüm"))[:40], str(row.get("Ölçü"))[:80], str(row.get("Değer"))[:200]))
    return sid


def gl_csv(kind):
    """gazelab export_csv karşılığı: sessions | gaze | head | mouse | methods | phases | session_stats"""
    buf = io.StringIO()
    w = csv.writer(buf)
    with GL_LOCK, gl_db() as con:
        if kind == "sessions":
            w.writerow(["session_id", "status", "accuracy_px", "precision_px", "created_at", "completed_at", "screen_w", "screen_h",
                        "viewport_w", "viewport_h", "dpr", "screen_res_w", "screen_res_h", "viewport_res_w", "viewport_res_h",
                        "camera_w", "camera_h", "camera_fps", "zoom", "zoom_mode", "model_input", "device_type", "browser", "user_agent", "log_file"])
            for r in con.execute("SELECT * FROM sessions ORDER BY created_at"):
                d, m = json.loads(r["device"] or "{}"), json.loads(r["meta"] or "{}")
                cam, ay = m.get("camera") or {}, m.get("kameraAyari") or {}
                w.writerow([r["id"], r["status"], r["accuracy_px"], r["precision_px"], fmt_ts(r["created_at"]), fmt_ts(r["completed_at"]),
                            d.get("screenW"), d.get("screenH"), d.get("viewportW"), d.get("viewportH"), d.get("dpr"), d.get("screenResW"),
                            d.get("screenResH"), d.get("viewportResW"), d.get("viewportResH"), cam.get("width"), cam.get("height"),
                            cam.get("frameRate"), ay.get("zoom"), ay.get("mod"), ay.get("islenen"), d.get("type"), d.get("browser"), d.get("ua"), r["log_file"]])
        elif kind in ("gaze", "head", "mouse"):
            col = {"gaze": "gaze", "head": "head", "mouse": "mouse"}[kind]
            hdr = {"gaze": ["session_id", "phase", "method", "t_ms", "x_px", "y_px"],
                   "head": ["session_id", "phase", "t_ms", "yaw_deg", "pitch_deg", "roll_deg", "distance_pct", "shift_pct"],
                   "mouse": ["session_id", "phase", "t_ms", "x_px", "y_px", "event"]}[kind]
            w.writerow(hdr)
            q = "SELECT * FROM recordings ORDER BY session_id, order_idx, method"
            if kind != "gaze":   # baş ve fare her yöntem satırında aynı: aşama başına bir kez
                q = "SELECT * FROM recordings WHERE id IN (SELECT MIN(id) FROM recordings GROUP BY session_id, stimulus_id) ORDER BY session_id, order_idx"
            for r in con.execute(q):
                for p in json.loads(r[col] or "[]"):
                    if kind == "gaze":
                        w.writerow([r["session_id"], r["stimulus_id"], r["method"]] + list(p[:3]))
                    else:
                        w.writerow([r["session_id"], r["stimulus_id"]] + list(p))
        elif kind == "methods":
            rows = [(r["session_id"], json.loads(r["row"])) for r in con.execute("SELECT * FROM method_stats ORDER BY session_id")]
            cols = []
            for _, d in rows:
                cols += [k for k in d if k not in cols]
            w.writerow(["session_id"] + cols)
            for sid, d in rows:
                w.writerow([sid] + [d.get(k) for k in cols])
        elif kind == "phases":
            rows = [(r["session_id"], json.loads(r["row"])) for r in con.execute("SELECT * FROM phase_stats ORDER BY session_id, idx")]
            cols = []
            for _, d in rows:
                cols += [k for k in d if k not in cols]
            w.writerow(["session_id"] + cols)
            for sid, d in rows:
                w.writerow([sid] + [d.get(k) for k in cols])
        elif kind == "session_stats":
            w.writerow(["session_id", "section", "name", "value"])
            for r in con.execute("SELECT * FROM session_stats ORDER BY session_id, idx"):
                w.writerow([r["session_id"], r["section"], r["name"], r["value"]])
        else:
            return None
    return buf.getvalue()


def fmt_ts(t):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else ""

EMOTIONS = ["mutlu", "notr", "kafa_karisik", "zorlaniyor"]
TIMELINE_EVERY = 5          # saniye
OFFLINE_AFTER = 8           # saniye metrik gelmezse çevrimdışı
LOW_ATT = 40                # dikkat eşiği
LOW_ATT_SECONDS = 20        # bu kadar süre düşükse uyarı
LOW_ENERGY = 35
PERSIST_EVERY = 5           # saniye; aktif dersler bu aralıkla diske yazılır
RESTORE_HOURS = 24          # açılışta bu kadar yeni, bitmemiş dersler geri yüklenir

# Bakış (göz takibi) ilgi alanları — öğrenci ekranındaki bölgeler
AOI_KEYS = ["materyal", "konu", "duyuru", "etkilesim", "sohbet", "kamera", "sayfa", "disari"]
HX, HY = 32, 18             # materyal ısı haritası çözünürlüğü (16:9)
HEAT_DECAY = 0.92           # canlı ısı haritası saniyelik sönüm (~8 sn yarı ömür)

LOCK = threading.RLock()

_ADMIN_KEY = None


_ADMIN_LOCK = threading.Lock()


def yonetici_anahtari():
    """Sıra: DERSNABZI_ADMIN_KEY ortam değişkeni, data/yonetici_anahtari.txt, yoksa üretip dosyaya yaz. Tembel, önbellekli, kilitli."""
    global _ADMIN_KEY
    if _ADMIN_KEY:
        return _ADMIN_KEY
    with _ADMIN_LOCK:
        if _ADMIN_KEY:
            return _ADMIN_KEY
        anahtar = os.environ.get("DERSNABZI_ADMIN_KEY", "").strip()
        if not anahtar:
            yol = os.path.join(DATA, "yonetici_anahtari.txt")
            try:
                with open(yol, encoding="utf-8") as f:
                    anahtar = f.read().strip()
            except OSError:
                anahtar = ""
            if not anahtar:
                anahtar = secrets.token_urlsafe(18)
                os.makedirs(DATA, exist_ok=True)
                fd = os.open(yol, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(anahtar)
                print(f"Yönetici anahtarı (yönetim ekranı): {anahtar}  ({yol})")
        _ADMIN_KEY = anahtar
        return anahtar
CLASSES = {}
MATERYAL_MAX = 10 * 1024 * 1024   # yüklenen materyal görseli üst sınırı

DEMO_NAMES = ["Ayşe Y.", "Mehmet K.", "Zeynep A.", "Can D.", "Elif S.", "Burak T.",
              "Selin Ö.", "Emre Ç.", "Deniz B.", "Ece G.", "Kerem Ş.", "Naz U."]


def now():
    return time.time()


def new_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if code not in CLASSES and not os.path.exists(os.path.join(DATA, code + ".json")):
            return code


def clamp(v, lo=0.0, hi=100.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return lo
    if math.isnan(v):
        return lo
    return max(lo, min(hi, v))


# ---------------------------------------------------------------- yayın ----

def push(cls, msg, role=None, sid=None):
    """Sınıftaki istemcilere mesaj gönder. role: 'teacher'|'student'|None(herkes)."""
    for c in list(cls["clients"]):
        if role and c["role"] != role:
            continue
        if sid and c.get("sid") != sid:
            continue
        try:
            c["q"].put_nowait(msg)
        except queue.Full:
            pass


def public_student(s, t):
    m = s["metrics"]
    online = (t - s["last_seen"]) < OFFLINE_AFTER
    return {
        "id": s["id"], "name": s["name"], "demo": s["demo"], "online": online,
        "attention": round(m.get("attention", 0)), "energy": round(m.get("energy", 0)),
        "emotion": m.get("emotion", "notr"), "face": m.get("face", False),
        "lookingAway": m.get("lookingAway", False), "eyesClosed": m.get("eyesClosed", False),
        "tabHidden": m.get("tabHidden", False), "hand": s["hand"],
        "lowFor": round(t - s["low_since"]) if s["low_since"] else 0,
        "gazeCal": m.get("gazeCal", False), "gazeRegion": m.get("gazeRegion"),
        "materialPct": material_pct(s["samples"][-30:]),
        "ekran": s.get("ekran"),
    }


def material_pct(samples):
    """Örneklerdeki (5. alan = materyale bakma payı) ortalama, yüzde."""
    v = [x[4] for x in samples if len(x) > 4 and x[4] is not None]
    return round(100 * sum(v) / len(v)) if v else None


def aggregate(cls, t):
    # Demo öğrenciler gerçek verilerle ASLA karışmaz. Sınıfta çevrim içi gerçek öğrenci yoksa
    # (yalnızca tanıtım için) demo öğrencilerden ayrı bir özet üretilir ve "demo": True ile işaretlenir.
    alive = [s for s in cls["students"].values() if (t - s["last_seen"]) < OFFLINE_AFTER]
    real = [s for s in alive if not s["demo"]]
    demo = not real and any(s["demo"] for s in alive)
    online = [s for s in alive if s["demo"]] if demo else real
    pool = [s for s in cls["students"].values() if s["demo"] == demo]
    emo = {e: 0 for e in EMOTIONS}
    for s in online:
        emo[s["metrics"].get("emotion", "notr")] = emo.get(s["metrics"].get("emotion", "notr"), 0) + 1
    n = len(online)
    return {
        "demo": demo,
        "present": n,
        "total": len(pool),
        "attention": round(sum(s["metrics"].get("attention", 0) for s in online) / n) if n else None,
        "energy": round(sum(s["metrics"].get("energy", 0) for s in online) / n) if n else None,
        "emotions": emo,
        "hands": sum(1 for s in pool if s["hand"]),
        "gaze": gaze_agg(online),
    }


def gaze_agg(online):
    cal = [s for s in online if s["metrics"].get("gazeCal")]
    regions = {k: 0 for k in AOI_KEYS}
    for s in cal:
        r = s["metrics"].get("gazeRegion")
        if r in regions:
            regions[r] += 1
    n = len(cal)
    return {"calibrated": n, "regions": regions,
            "onMaterial": round(100 * regions["materyal"] / n) if n else None}


def snapshot(cls, t):
    agg = aggregate(cls, t)
    return {
        "type": "state",
        "cls": {"code": cls["code"], "name": cls["name"], "topic": cls["topic"],
                "created": cls["created"], "ended": cls["ended"], "live": cls.get("live", False)},
        "agg": agg,
        "students": sorted((public_student(s, t) for s in cls["students"].values()),
                           key=lambda x: (not x["online"], x["attention"])),
        "timeline": cls["timeline"][-120:],
        "reactions": cls["reaction_counts"],
        "heat": norm_heat(cls["heat_demo"] if agg["demo"] else cls["heat_live"]),
    }


def norm_heat(grid):
    mx = max(grid) if grid else 0
    return [round(100 * v / mx) for v in grid] if mx > 0.05 else None


def add_heat(cls, pts, demo=False):
    for u, v in pts:
        i = min(HY - 1, int(v * HY)) * HX + min(HX - 1, int(u * HX))
        if demo:
            cls["heat_demo"][i] += 1
        else:
            cls["heat_live"][i] += 1
            cls["heat_total"][i] += 1


def add_alert(cls, kind, text, key, t, cooldown=60, demo=False):
    last = cls["alert_marks"].get(key, 0)
    if t - last < cooldown:
        return
    cls["alert_marks"][key] = t
    alert = {"t": t, "kind": kind, "text": ("[Demo] " + text) if demo else text}
    if demo:
        alert["demo"] = True
    cls["alerts"].append(alert)
    if not demo:
        kayit.olay_ekle(KAYIT, cls["code"], None, t, "alert", {"kind": kind, "text": text})
    push(cls, {"type": "alert", "alert": alert}, role="teacher")


# ------------------------------------------------------------- demo sim ----

def simulate_demo(cls, t):
    for s in cls["students"].values():
        if not s["demo"]:
            continue
        p = s["sim"]
        # Kişilik: taban dikkat, dağılma eğilimi
        if random.random() < p["drift"]:
            p["away"] = random.randint(4, 25)
        if p["away"] > 0:
            p["away"] -= 1
            target_att = random.uniform(5, 30)
        else:
            target_att = p["base"] + random.uniform(-10, 10)
        p["att"] += (target_att - p["att"]) * 0.35
        p["energy"] += random.uniform(-2.2, 1.6)
        p["energy"] = clamp(p["energy"], 15, 100)
        if random.random() < 0.08:
            p["emotion"] = random.choices(EMOTIONS, weights=[2, 6, 2, 1])[0]
        m = {"attention": clamp(p["att"]), "energy": p["energy"], "emotion": p["emotion"],
             "face": p["away"] == 0 or random.random() < 0.5, "lookingAway": p["away"] > 0,
             "eyesClosed": p["energy"] < 25 and random.random() < 0.3, "tabHidden": False}
        record_metrics(cls, s, m, t, simulate_gaze(cls, p))
        if not s["hand"] and random.random() < 0.004:
            s["hand"] = True
            s["hand_count"] += 1
            kayit.olay_ekle(KAYIT, cls["code"], s["id"], t, "hand", {"up": s["hand"]})
            push(cls, {"type": "hand", "id": s["id"], "name": s["name"], "up": True}, role="teacher")


def simulate_gaze(cls, p):
    """Demo öğrenci bakışı: sınıfın ortak odak noktası (öğretmenin anlattığı yer) etrafında."""
    fx, fy = cls["sim_focus"]
    if p["away"] > 0:
        return {"region": "disari", "share": {"disari": 1.0}, "pts": []}
    if random.random() < 0.07:
        r = random.choice(["sohbet", "konu", "kamera"])
        return {"region": r, "share": {r: 1.0}, "pts": []}
    sd = 0.05 + (100 - p["att"]) / 900
    pts = [(clamp(random.gauss(fx, sd), 0, 0.999), clamp(random.gauss(fy, sd * 1.3), 0, 0.999))
           for _ in range(6)]
    return {"region": "materyal", "share": {"materyal": 1.0}, "pts": pts}


def move_focus(cls):
    """Odak noktası slaytta yavaşça gezinir (okuma sırası: soldan sağa, yukarıdan aşağı)."""
    fx, fy = cls["sim_focus"]
    fx += 0.012
    if fx > 0.85:
        fx, fy = 0.15, (fy + 0.18 if fy < 0.75 else 0.25)
    cls["sim_focus"] = [fx, fy]


def make_sim():
    return {"base": random.uniform(55, 92), "drift": random.uniform(0.005, 0.04),
            "away": 0, "att": random.uniform(60, 90), "energy": random.uniform(70, 95),
            "emotion": "notr"}


def add_demo_students(cls, count):
    t = now()
    used = {s["name"] for s in cls["students"].values()}
    pool = [n for n in DEMO_NAMES if n not in used] or [f"Demo {i}" for i in range(100)]
    for name in pool[:count]:
        sid = "d_" + secrets.token_hex(4)
        s = make_student(sid, name, demo=True)
        s["sim"] = make_sim()
        s["last_seen"] = t
        cls["students"][sid] = s


# ------------------------------------------------------------- mantık ----

def make_student(sid, name, demo=False, pcode=None):
    t = now()
    return {"id": sid, "name": name, "demo": demo, "pcode": pcode, "joined": t, "last_seen": t,
            "metrics": {"attention": 0, "energy": 0, "emotion": "notr"},
            "hand": False, "hand_count": 0, "chat_count": 0, "reactions": 0,
            "samples": [], "low_since": None, "low_alerted": False, "gaze_time": {}}


def record_metrics(cls, s, m, t, gaze=None):
    # Öğrenci bir süre veri göndermediyse (duraklatma, bağlantı kopması) düşük dikkat sayacı
    # aradaki boşluğu "dikkatsizlik" saymasın (önceden 10 dk sonra "600 sn'dir" uyarısı çıkıyordu).
    if t - s["last_seen"] >= OFFLINE_AFTER:
        s["low_since"] = None
        s["low_alerted"] = False
    m["gazeCal"] = gaze is not None
    m["gazeRegion"] = gaze["region"] if gaze else None
    s["metrics"] = m
    s["last_seen"] = t
    mat = None
    if gaze:
        for k, v in gaze["share"].items():
            s["gaze_time"][k] = s["gaze_time"].get(k, 0) + v
        if gaze.get("wgShare"):
            wg = s.setdefault("gaze_time_wg", {})
            for k, v in gaze["wgShare"].items():
                wg[k] = wg.get(k, 0) + v
        if gaze["share"]:
            mat = round(gaze["share"].get("materyal", 0), 2)
        add_heat(cls, gaze["pts"], demo=s["demo"])
    s["samples"].append([round(t, 1), round(m["attention"]), round(m["energy"]), m["emotion"], mat])
    if m["attention"] < LOW_ATT:
        if not s["low_since"]:
            s["low_since"] = t
        elif t - s["low_since"] >= LOW_ATT_SECONDS and not s["low_alerted"]:
            s["low_alerted"] = True
            reason = "ekrana bakmıyor" if m.get("lookingAway") else (
                "kamerada görünmüyor" if not m.get("face") else "dikkati düşük")
            if m.get("tabHidden"):
                reason = "başka bir sekmede"
            add_alert(cls, "attention", f"{s['name']} {int(t - s['low_since'])} sn'dir {reason}.",
                      "att_" + s["id"], t, cooldown=90, demo=s["demo"])
    else:
        s["low_since"] = None
        s["low_alerted"] = False
    if m["energy"] < LOW_ENERGY:
        add_alert(cls, "energy", f"{s['name']} yorgun görünüyor (enerji %{round(m['energy'])}).",
                  "en_" + s["id"], t, cooldown=180, demo=s["demo"])


def class_alerts(cls, agg, t):
    n, d = agg["present"], agg["demo"]
    if n >= 3:
        confused = agg["emotions"].get("kafa_karisik", 0) + agg["emotions"].get("zorlaniyor", 0)
        if confused / n >= 0.35:
            add_alert(cls, "class", f"Sınıfın %{round(100 * confused / n)}'i zorlanıyor ya da kafası "
                      "karışık görünüyor. Konuyu bir örnekle tekrar açıklamayı düşünün.", "cls_conf", t, 120, demo=d)
        if agg["attention"] is not None and agg["attention"] < 50:
            add_alert(cls, "class", f"Sınıf dikkati %{agg['attention']} seviyesine düştü. "
                      "Kısa bir soru ya da etkinlik iyi gelebilir.", "cls_att", t, 120, demo=d)
        if agg["energy"] is not None and agg["energy"] < 45:
            add_alert(cls, "class", "Sınıfın enerjisi düşük. 2-3 dakikalık bir mola önerilir.",
                      "cls_en", t, 300, demo=d)


def ticker():
    last_tl = last_save = 0
    while True:
        time.sleep(1)
        t = now()
        with LOCK:
            take_tl = t - last_tl >= TIMELINE_EVERY
            if take_tl:
                last_tl = t
            if t - last_save >= PERSIST_EVERY:
                last_save = t
                for cls in list(CLASSES.values()):
                    if not cls["ended"]:
                        try:
                            persist(cls)
                        except OSError as e:
                            print("Kayıt hatası:", cls["code"], e)
            for cls in list(CLASSES.values()):
                if cls["ended"]:
                    continue
                move_focus(cls)
                simulate_demo(cls, t)
                cls["heat_live"] = [v * HEAT_DECAY for v in cls["heat_live"]]
                cls["heat_demo"] = [v * HEAT_DECAY for v in cls["heat_demo"]]
                agg = aggregate(cls, t)
                if take_tl and agg["present"]:
                    class_alerts(cls, agg, t)
                if take_tl and agg["present"] and not agg["demo"]:   # zaman çizgisine yalnız gerçek veri
                    cls["timeline"].append({"t": round(t), "attention": agg["attention"],
                                            "energy": agg["energy"], "present": agg["present"],
                                            "emotions": agg["emotions"],
                                            "material": agg["gaze"]["onMaterial"]})
                push(cls, snapshot(cls, t), role="teacher")


def persist(cls):
    data = {k: v for k, v in cls.items() if k not in ("clients",)}
    data["students"] = {sid: {k: v for k, v in s.items() if k != "sim"}
                        for sid, s in cls["students"].items()}
    tmp = os.path.join(DATA, cls["code"] + ".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(DATA, cls["code"] + ".json"))


def ensure_gaze_fields(cls):
    cls.setdefault("alert_marks", {})
    cls.setdefault("heat_live", [0.0] * (HX * HY))
    cls.setdefault("heat_total", [0.0] * (HX * HY))
    cls.setdefault("heat_demo", [0.0] * (HX * HY))
    cls.setdefault("sim_focus", [0.15, 0.25])
    for st in cls["students"].values():
        st.setdefault("gaze_time", {})


def restore_active():
    """Sunucu yeniden başlatıldığında bitmemiş dersleri diskten geri yükler."""
    restored = []
    for fn in os.listdir(DATA):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(DATA, fn), encoding="utf-8") as f:
                cls = json.load(f)
        except (OSError, ValueError):
            continue
        if cls.get("ended") or now() - cls.get("created", 0) > RESTORE_HOURS * 3600:
            continue
        cls["clients"] = []
        cls["live"] = False                       # öğretmenin medya akışı sunucu kapanınca kaybolur
        ensure_gaze_fields(cls)
        for st in cls["students"].values():
            if st.get("demo"):
                st["sim"] = make_sim()
        CLASSES[cls["code"]] = cls
        kayit.ders_ekle(KAYIT, cls["code"], cls.get("name"), cls.get("topic"), cls.get("created"))
        for sid, st in cls["students"].items():
            # pcode None ise (eski JSON) kayıttaki kod korunur (ogrenci_ekle COALESCE)
            kayit.ogrenci_ekle(KAYIT, cls["code"], sid, st.get("name"), st.get("pcode"),
                               st.get("joined"), bool(st.get("demo")))
        restored.append(f"{cls['code']} ({cls['name']})")
    if restored:
        print("Geri yüklenen aktif dersler:", ", ".join(restored))


def load_class(code):
    if code in CLASSES:
        return CLASSES[code]
    path = os.path.join(DATA, code + ".json")
    if code.isalnum() and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cls = json.load(f)
        cls["clients"] = []
        ensure_gaze_fields(cls)
        return cls
    return None


def parse_gaze(g):
    """Öğrenciden gelen bakış özetini doğrula. Kalibre değilse None."""
    if not isinstance(g, dict) or not g.get("cal"):
        return None
    share = {}
    if isinstance(g.get("share"), dict):
        share = {k: clamp(v, 0, 1) for k, v in g["share"].items() if k in AOI_KEYS}
    pts = []
    for q in (g.get("pts") or [])[:40]:
        if isinstance(q, (list, tuple)) and len(q) == 2:
            pts.append((clamp(q[0], 0, 0.999), clamp(q[1], 0, 0.999)))
    region = g.get("region") if g.get("region") in AOI_KEYS else None
    scr = []
    for q in (g.get("scr") or [])[:40]:
        if isinstance(q, (list, tuple)) and len(q) == 3:
            scr.append([round(clamp(q[0], -60000, 0)), round(clamp(q[1], -0.2, 1.2), 3), round(clamp(q[2], -0.2, 1.2), 3)])
    wg_share = {}   # WebGazer yöntemi (aynı kalibrasyon, ikinci model): yalnız ders kaydında karşılaştırma için
    if isinstance(g.get("wgShare"), dict):
        wg_share = {k: clamp(v, 0, 1) for k, v in g["wgShare"].items() if k in AOI_KEYS}
    return {"region": region, "share": share, "pts": pts, "wgShare": wg_share, "scr": scr}


# islemeFps: iki gönderim arasında gerçekten işlenen kare / geçen süre; gecikmeMs: işçi yolunda kare → sonuç ortalaması
_KURULUM_SAYI = {"fps": (0, 1000), "dpr": (0.25, 8), "uzaklikCm": (0, 1000), "islemeFps": (0, 1000),
                 "gecikmeMs": (0, 60000)}
_KURULUM_METIN = ("kamera", "ekran", "pencere", "tarayici")


def temiz_kurulum(k):
    """Öğrenci kurulum özetini doğrula: bilinen alanlar, sayılar kırpılı, metinler ≤40 karakter."""
    if not isinstance(k, dict):
        return None
    out = {}
    for a in _KURULUM_METIN:
        if isinstance(k.get(a), str):
            out[a] = k[a][:40]
    for a, (lo, hi) in _KURULUM_SAYI.items():
        v = k.get(a)
        out[a] = None if isinstance(v, bool) or not isinstance(v, (int, float)) else round(clamp(v, lo, hi), 2)
    out["fs"] = bool(k.get("fs"))
    out["isci"] = k["isci"] if isinstance(k.get("isci"), bool) else None   # işleme yeri; bilinmiyorsa None
    return out


def kayit_bakis(g, parsed):
    """Ham bakış yükünden ornek_ekle alanları. Kaba/kalibresiz: nokta ve ekran izi saklanmaz."""
    g = g if isinstance(g, dict) else {}
    if parsed is None:
        share = {}
        if g.get("coarse") and isinstance(g.get("share"), dict):
            share = {k: clamp(v, 0, 1) for k, v in g["share"].items() if k in AOI_KEYS}
        return {"gaze_cal": 0, "coarse": 1 if g.get("coarse") else 0, "share": share or None,
                "mat_pts": None, "gaze": None, "wg_share": None}
    if g.get("coarse"):
        return {"gaze_cal": 0, "coarse": 1, "share": parsed["share"] or None,
                "mat_pts": None, "gaze": None, "wg_share": None}
    return {"gaze_cal": 1, "coarse": 0, "share": parsed["share"], "mat_pts": [list(p) for p in parsed["pts"]],
            "gaze": parsed["scr"] or None, "wg_share": parsed["wgShare"] or None}


def build_report(cls):
    end = cls["ended"] or now()
    students = []
    real = [s for s in cls["students"].values() if not s["demo"]]   # rapora demo veri girmez
    for s in real:
        smp = s["samples"]
        emo = {e: 0 for e in EMOTIONS}
        for x in smp:
            emo[x[3]] = emo.get(x[3], 0) + 1
        n = len(smp)
        students.append({
            "name": s["name"], "demo": s["demo"],
            "avgAttention": round(sum(x[1] for x in smp) / n) if n else None,
            "avgEnergy": round(sum(x[2] for x in smp) / n) if n else None,
            "lowAttentionPct": round(100 * sum(1 for x in smp if x[1] < LOW_ATT) / n) if n else None,
            "dominantEmotion": max(emo, key=emo.get) if n else None,
            "emotions": {k: round(100 * v / n) if n else 0 for k, v in emo.items()},
            "minutes": round((smp[-1][0] - smp[0][0]) / 60, 1) if n > 1 else 0,
            "hands": s["hand_count"], "messages": s["chat_count"], "reactions": s["reactions"],
            "materialPct": material_pct(smp),
            "gazeRegions": pct_dist(s.get("gaze_time", {})),
            # WebGazer yöntemi (aynı kalibrasyonla eğitilen ikinci model): karşılaştırma için; yoksa boş
            "gazeRegionsWg": pct_dist(s.get("gaze_time_wg", {})) if s.get("gaze_time_wg") else None,
        })
    students.sort(key=lambda x: -(x["avgAttention"] or 0))
    total_gaze = {}
    for s in real:
        for k, v in s.get("gaze_time", {}).items():
            total_gaze[k] = total_gaze.get(k, 0) + v
    tl = cls["timeline"]
    valid = [p for p in tl if p["attention"] is not None]
    emo_total = {e: 0 for e in EMOTIONS}
    for p in tl:
        for k, v in p["emotions"].items():
            emo_total[k] = emo_total.get(k, 0) + v
    tot = sum(emo_total.values()) or 1
    lowest = min(valid, key=lambda p: p["attention"]) if valid else None
    return {
        "code": cls["code"], "name": cls["name"], "topic": cls["topic"],
        "topics": cls.get("topic_log", []),
        "created": cls["created"], "ended": cls["ended"], "durationMin": round((end - cls["created"]) / 60, 1),
        "avgAttention": round(sum(p["attention"] for p in valid) / len(valid)) if valid else None,
        "avgEnergy": round(sum(p["energy"] for p in valid) / len(valid)) if valid else None,
        "peakPresent": max((p["present"] for p in tl), default=0),
        "lowestMoment": lowest,
        "emotions": {k: round(100 * v / tot) for k, v in emo_total.items()},
        "timeline": tl, "students": students, "alerts": [a for a in cls["alerts"] if not a.get("demo")],
        "reactions": cls["reaction_counts"], "chat": cls["chat"],
        "gazeRegions": pct_dist(total_gaze),
        "heat": norm_heat(cls.get("heat_total", [])), "heatSize": [HX, HY],
    }


def pct_dist(d):
    tot = sum(d.values())
    return {k: round(100 * v / tot) for k, v in d.items() if v} if tot else {}


# --------------------------------------------------------------- HTTP ----

CTYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml",
          ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "DersNabzi/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if args and "/api/metrics" in str(args[0]):
            return
        # Öğretmen anahtarı URL'de taşınıyor; log dosyasına düz yazılmasın
        args = tuple(re.sub(r"((?:key|admin)=)[^&\s]+", r"\1***", a) if isinstance(a, str) else a for a in args)
        super().log_message(fmt, *args)

    # yardımcılar
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def err(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > 200_000:          # negatif uzunluk rfile.read(-1) ile sınırsız okumaya yol açıyordu
            raise ValueError("geçersiz uzunluk")
        raw = self.rfile.read(n) if n else b"{}"
        b = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(b, dict):
            raise ValueError("nesne bekleniyor")
        return b

    def test_log(self):
        """Bakış testi kaydını test_kayitlari/ altına yazar. Yalnız bakis_test.html kullanır; en çok 2 MB."""
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 8_000_000:       # her yöntemin kare kare bakış kaydı (gazelab biçimi) da gelir
            return self.err("geçersiz uzunluk")
        try:
            b = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError):
            return self.err("Geçersiz JSON")
        if not isinstance(b, dict) or not isinstance(b.get("log"), list):
            return self.err("log listesi bekleniyor")
        cihaz = re.sub(r"[^A-Za-z0-9]+", "-", str(b.get("cihaz") or "bilinmiyor"))[:30].strip("-") or "bilinmiyor"
        os.makedirs(TEST_DIR, exist_ok=True)
        ad = f"{time.strftime('%Y%m%d_%H%M%S')}_{cihaz}_{secrets.token_hex(2)}.json"
        with open(os.path.join(TEST_DIR, ad), "w", encoding="utf-8") as f:
            json.dump(b, f, ensure_ascii=False, indent=1)
        print(f"[testlog] {ad} ({len(b['log'])} satır)")
        oturum = None
        if isinstance(b.get("gazelab"), dict):
            try:
                oturum = gl_kaydet(b["gazelab"], ad)
                print(f"[testlog] GazeLab oturumu {oturum} -> {GL_DB}")
            except (sqlite3.Error, TypeError, ValueError) as e:
                print(f"[testlog] GazeLab kaydı yazılamadı: {e}")
        self.send_json({"ok": True, "dosya": ad, "oturum": oturum})

    def teacher_ok(self, cls, key):
        return bool(key) and secrets.compare_digest(str(key).encode("utf-8"), cls["teacher_key"].encode("utf-8"))

    def admin_ok(self, q):
        """Yönetici erişimi: yerel istemci VE doğru anahtar (X-Admin-Key başlığı ya da ?admin=)."""
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return False
        anahtar = self.headers.get("X-Admin-Key") or q.get("admin") or ""
        return bool(anahtar) and secrets.compare_digest(anahtar.encode("utf-8"), yonetici_anahtari().encode("utf-8"))

    def gorsel_yetkili(self, cls_code, q):
        """Materyal görseli okuma yetkisi: öğretmen anahtarı ya da yerel yönetici anahtarı (?admin=)."""
        if self.admin_ok(q):
            return True
        cls = load_class(cls_code)
        return bool(cls) and self.teacher_ok(cls, q.get("key"))

    def admin_get(self, yol, q):
        if not self.admin_ok(q):
            return self.err("Yetkisiz", 403)
        if yol == "kalite_esik":
            return self.send_json(yonetim.KALITE_ESIK)
        if yol not in ("dersler", "ders", "ogrenci", "karsilastirma", "katilimcilar", "csv"):
            return self.err("Bulunamadı", 404)
        # Yönetim okumaları LOCK almaz: istek başına salt okunur bağlantı (WAL), canlı dersi dondurmaz
        try:
            con = kayit_okuma()
        except sqlite3.Error:
            return self.err("Kayıt okunamadı", 503)
        try:
            return self._admin_oku(con, yol, q)
        finally:
            con.close()

    def _admin_oku(self, con, yol, q):
        if yol == "dersler":
            return self.send_json(yonetim.dersler(con, q.get("ara") or None, q.get("bas") or None, q.get("bit") or None))
        if yol == "ders":
            r = yonetim.ders(con, q.get("code", "").upper())
            return self.send_json(r) if r is not None else self.err("Ders bulunamadı", 404)
        if yol == "ogrenci":
            r = yonetim.ogrenci(con, q.get("code", "").upper(), q.get("sid", ""))
            return self.send_json(r) if r is not None else self.err("Öğrenci bulunamadı", 404)
        if yol == "karsilastirma":
            d = [x.strip().upper() for x in q.get("dersler", "").split(",") if x.strip()]
            return self.send_json(yonetim.karsilastirma(con, d or None))
        if yol == "katilimcilar":
            return self.send_json(kayit.katilimcilar(con))
        if yol == "csv":
            tur, code = q.get("tur", "uzun"), q.get("code", "").upper()
            if tur == "ham":
                if not code:
                    return self.err("ham CSV için code gerekli")
                metin = yonetim.csv_ham(con, code)
            elif tur == "uzun":
                metin = yonetim.csv_uzun(con, [code] if code else None)
            else:
                return self.err("Geçersiz tur")
            veri = ("﻿" + metin).encode("utf-8")
            ad = "dersnabzi_%s%s.csv" % (tur, "_" + re.sub(r"[^A-Z0-9_-]", "", code) if code else "")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % ad)
            self.send_header("Content-Length", str(len(veri)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(veri)
        return self.err("Bulunamadı", 404)

    def admin_katilimci(self, b):
        if not self.admin_ok({}):
            return self.err("Yetkisiz", 403)
        try:
            kod = kayit.katilimci_ekle(KAYIT, str(b.get("kod") or ""))
        except ValueError as e:
            return self.err(str(e), 400)
        return self.send_json({"kod": kod})

    def materials_list(self, q):
        with LOCK:
            cls = CLASSES.get(q.get("code", "").upper())
            if not cls or cls["ended"]:
                return self.err("Sınıf bulunamadı", 404)
            if not self.teacher_ok(cls, q.get("key")):
                return self.err("Yetkisiz", 403)
            lst = [{"id": m["id"], "idx": m["idx"], "name": m["name"], "kind": m["kind"],
                    "hasImage": bool(m["image_path"])} for m in kayit.materyaller(KAYIT, cls["code"])]
            return self.send_json({"materials": lst, "active": kayit.aktif_materyal(KAYIT, cls["code"])})

    def material_image(self, q):
        code = q.get("code", "").upper()
        with LOCK:
            if not self.gorsel_yetkili(code, q):
                return self.err("Yetkisiz", 403)
            try:
                mid = int(q.get("id", ""))
            except ValueError:
                return self.err("Geçersiz id")
            m = next((x for x in kayit.materyaller(KAYIT, code) if x["id"] == mid), None)
            full = os.path.normpath(os.path.join(DATA, m["image_path"])) if m and m["image_path"] else None
            base = os.path.normpath(os.path.join(DATA, "materyaller"))
        # Dosya LOCK dışında okunur (büyük görsel canlı dersi bekletmesin)
        try:
            if not full or os.path.commonpath([full, base]) != base or not os.path.isfile(full):
                return self.err("Görsel yok", 404)
            with open(full, "rb") as f:
                data = f.read()
        except (OSError, ValueError):
            return self.err("Görsel yok", 404)
        self.send_response(200)
        self.send_header("Content-Type", "image/png" if full.endswith(".png") else "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def material_upload(self, q):
        """POST /api/material?code=&key=&name=&kind= ; gövde = PNG/JPEG baytları (boş = görselsiz). En çok 10 MB."""
        q = {k: v[0] for k, v in q.items()}
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > MATERYAL_MAX:
            self.close_connection = True          # gövde okunmadı; bağlantı yeniden kullanılmasın
            return self.err("Görsel en çok 10 MB olabilir", 413)
        raw = self.rfile.read(n) if n else b""
        with LOCK:
            cls = CLASSES.get(q.get("code", "").upper())
            if not cls or cls["ended"]:
                return self.err("Sınıf bulunamadı", 404)
            if not self.teacher_ok(cls, q.get("key")):
                return self.err("Yetkisiz", 403)
            name = (q.get("name") or "").strip()[:80]
            if not name:
                return self.err("Materyal adı gerekli")
            ext = None
            if raw:
                if raw.startswith(b"\x89PNG\r\n\x1a\n"):
                    ext = "png"
                elif raw.startswith(b"\xff\xd8\xff"):
                    ext = "jpg"
                else:
                    return self.err("Yalnız PNG veya JPEG", 415)
            try:
                mid = kayit.materyal_ekle(KAYIT, cls["code"], name, q.get("kind", ""))
            except ValueError as e:
                return self.err(str(e))
            if ext:
                rel = "materyaller/%s/%d.%s" % (cls["code"], mid, ext)
                os.makedirs(os.path.join(DATA, "materyaller", cls["code"]), exist_ok=True)
                with open(os.path.join(DATA, rel), "wb") as f:
                    f.write(raw)
                kayit.materyal_gorsel(KAYIT, mid, rel)
            return self.send_json({"id": mid})

    # GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/api/saglik":
            yanit = {"ok": True, "surum": 1}
            oturum = os.environ.get("DERSNABZI_OTURUM", "")
            if oturum:
                yanit["oturum"] = oturum   # masaüstü uygulaması kendi başlattığı süreci tanısın diye (yalnız yankı)
            return self.send_json(yanit)
        if u.path == "/api/stream":
            return self.stream(q)
        if u.path == "/api/report":
            with LOCK:
                cls = load_class(q.get("code", "").upper())
                if not cls:
                    return self.err("Sınıf bulunamadı", 404)
                if not self.teacher_ok(cls, q.get("key")):
                    return self.err("Yetkisiz", 403)
                return self.send_json(build_report(cls))
        if u.path.startswith("/api/admin/"):
            return self.admin_get(u.path[len("/api/admin/"):], q)
        if u.path == "/api/testlog/export.csv":
            # Yalnız bu bilgisayardan (test kayıtları cihaz/yüz ölçüleri içerir)
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.err("Yalnız yerelden", 403)
            kind = q.get("kind", "methods")
            text = gl_csv(kind)
            if text is None:
                return self.err("kind: sessions | gaze | head | mouse | methods | phases | session_stats")
            body = ("\ufeff" + text).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="bakis_testi_{kind}.csv"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/api/materials":
            return self.materials_list(q)
        if u.path == "/api/material/image":
            return self.material_image(q)
        if u.path == "/api/class":
            with LOCK:
                cls = load_class(q.get("code", "").upper())
                if not cls:
                    return self.err("Sınıf bulunamadı", 404)
                return self.send_json({"code": cls["code"], "name": cls["name"], "topic": cls["topic"],
                                       "ended": cls["ended"]})
        return self.static(u.path)

    def do_HEAD(self):
        self.static(urlparse(self.path).path, head=True)

    def static(self, path, head=False):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        try:
            inside = os.path.commonpath([full, STATIC]) == STATIC  # "static_x" gibi komşu klasörler dışarıda kalır
        except ValueError:                                          # farklı sürücü (ör. "C:/...") verilirse
            inside = False
        if not inside or not os.path.isfile(full):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CTYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        # Model dosyaları (MB'larca, değişmez) tarayıcıda kalıcı önbelleğe alınır; diğerleri her açılışta tazelenir
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if path.startswith("/models/") else "no-cache")
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def stream(self, q):
        code = q.get("code", "").upper()
        role = q.get("role")
        with LOCK:
            cls = CLASSES.get(code)
            if not cls:
                return self.err("Sınıf bulunamadı", 404)
            if role == "teacher":
                if not self.teacher_ok(cls, q.get("key")):
                    return self.err("Yetkisiz", 403)
                sid = None
            elif role == "student":
                sid = q.get("sid")
                if sid not in cls["students"]:
                    return self.err("Öğrenci bulunamadı", 404)
            else:
                return self.err("Geçersiz rol")
            client = {"role": role, "sid": sid, "q": queue.Queue(maxsize=500)}
            cls["clients"].append(client)
            t = now()
            if role == "teacher":
                first = [snapshot(cls, t), {"type": "history", "alerts": cls["alerts"][-30:],
                                            "chat": cls["chat"][-100:]}]
            else:
                s = cls["students"][sid]
                first = [{"type": "welcome", "name": s["name"], "cls": {"name": cls["name"],
                          "topic": cls["topic"], "ended": cls["ended"], "live": cls.get("live", False)},
                          "chat": cls["chat"][-100:],
                          "announce": cls.get("announce"), "hand": s["hand"]}]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        try:
            for m in first:
                self.wfile.write(b"data: " + json.dumps(m, ensure_ascii=False).encode() + b"\n\n")
            self.wfile.flush()
            while True:
                try:
                    m = client["q"].get(timeout=15)
                    self.wfile.write(b"data: " + json.dumps(m, ensure_ascii=False).encode() + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            with LOCK:
                if client in cls["clients"]:
                    cls["clients"].remove(client)

    # POST
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/testlog":
            return self.test_log()
        if u.path == "/api/material":
            return self.material_upload(parse_qs(u.query))
        try:
            b = self.body()
        except (ValueError, UnicodeDecodeError, RecursionError):
            return self.err("Geçersiz JSON")
        routes = {"/api/class": self.create_class, "/api/join": self.join,
                  "/api/metrics": self.metrics, "/api/event": self.event,
                  "/api/admin/katilimci": self.admin_katilimci}
        fn = routes.get(u.path)
        if not fn:
            return self.err("Bulunamadı", 404)
        with LOCK:
            try:
                return fn(b)
            except (TypeError, ValueError, KeyError, AttributeError):
                # ör. liste olarak gönderilen sid, sayı olmayan count: işleyici çökmesin
                return self.err("Geçersiz istek")

    def create_class(self, b):
        name = str(b.get("name") or "").strip()[:80] or "Adsız ders"
        topic = str(b.get("topic") or "").strip()[:120]
        code = new_code()
        t = now()
        CLASSES[code] = {"code": code, "name": name, "topic": topic, "teacher_key": secrets.token_urlsafe(18),
                         "created": t, "ended": None, "students": {}, "timeline": [], "chat": [],
                         "alerts": [], "alert_marks": {}, "clients": [], "announce": None,
                         "reaction_counts": {}, "topic_log": [{"t": t, "topic": topic}] if topic else []}
        ensure_gaze_fields(CLASSES[code])
        persist(CLASSES[code])
        kayit.ders_ekle(KAYIT, code, name, topic, t)
        self.send_json({"code": code, "key": CLASSES[code]["teacher_key"]})

    def join(self, b):
        cls = CLASSES.get(str(b.get("code") or "").upper().strip())
        if not cls:
            return self.err("Bu kodla aktif bir ders bulunamadı.", 404)
        if cls["ended"]:
            return self.err("Bu ders sona ermiş.", 410)
        name = str(b.get("name") or "").strip()[:40]
        if not name:
            return self.err("İsim gerekli.")
        pcode = str(b.get("pcode") or "").strip().upper() or None
        if pcode and not re.match(r"^[A-Z0-9_-]{1,20}$", pcode):
            return self.err("Katılımcı kodu yalnız harf, rakam, - ve _ içerebilir (en çok 20).")
        sid = b.get("sid")
        if sid in cls["students"] and cls["students"][sid]["name"] == name:
            st = cls["students"][sid]
            out = {"sid": sid, "name": st["name"]}
            if pcode:   # yeniden katılımda verilen kod eksik kodu doldurur (joined değişmez)
                st["pcode"] = pcode
                kayit.ogrenci_ekle(KAYIT, cls["code"], sid, st["name"], pcode, st.get("joined"),
                                   bool(st.get("demo")))
                if not kayit.katilimci_var(KAYIT, pcode):
                    out["kodBilinmiyor"] = True
            return self.send_json(out)
        sid = "s_" + secrets.token_hex(6)
        cls["students"][sid] = make_student(sid, name, pcode=pcode)
        kayit.ogrenci_ekle(KAYIT, cls["code"], sid, name, pcode, cls["students"][sid]["joined"], False)
        out = {"sid": sid, "name": name}
        if pcode and not kayit.katilimci_var(KAYIT, pcode):
            out["kodBilinmiyor"] = True
        self.send_json(out)

    def metrics(self, b):
        cls = CLASSES.get(str(b.get("code") or "").upper())
        if not cls or cls["ended"]:
            return self.err("Ders aktif değil", 410)
        s = cls["students"].get(b.get("sid"))
        if not s:
            return self.err("Öğrenci bulunamadı", 404)
        emotion = b.get("emotion") if b.get("emotion") in EMOTIONS else "notr"
        m = {"attention": clamp(b.get("attention")), "energy": clamp(b.get("energy")), "emotion": emotion,
             "face": bool(b.get("face")), "lookingAway": bool(b.get("lookingAway")),
             "eyesClosed": bool(b.get("eyesClosed")), "tabHidden": bool(b.get("tabHidden"))}
        e = b.get("ekran")
        if isinstance(e, dict):   # tarayıcı/ekran boyutu (yalnızca sayılar, sınırlı)
            s["ekran"] = {k: int(clamp(e.get(k) or 0, 0, 20000)) for k in ("sw", "sh", "vw", "vh")}
            s["ekran"].update(dpr=round(clamp(e.get("dpr") or 1, 0.25, 8), 2), fs=bool(e.get("fs")), mobil=bool(e.get("mobil")))
        t = now()
        parsed = parse_gaze(b.get("gaze"))
        record_metrics(cls, s, m, t, parsed)
        row = {"attention": m["attention"], "energy": m["energy"], "emotion": emotion, "face": int(m["face"]),
               "away": int(m["lookingAway"]), "eyes_closed": int(m["eyesClosed"]), "tab_hidden": int(m["tabHidden"])}
        row.update(kayit_bakis(b.get("gaze"), parsed))
        kayit.ornek_ekle(KAYIT, cls["code"], s["id"], t, row)
        kur = temiz_kurulum(b.get("kurulum"))
        if kur:
            kayit.kurulum_ekle(KAYIT, cls["code"], s["id"], t, kur)
        kal = b.get("kal")
        if isinstance(kal, dict) and len(json.dumps(kal)) <= 20000 and (
                kal.get("at") is None or (isinstance(kal["at"], (int, float)) and not isinstance(kal["at"], bool))):
            kayit.kalibrasyon_ekle(KAYIT, cls["code"], s["id"], t, kal)
        self.send_json({"ok": True})

    def event(self, b):
        cls = CLASSES.get(str(b.get("code") or "").upper())
        if not cls:
            return self.err("Sınıf bulunamadı", 404)
        typ = b.get("type")
        t = now()
        is_teacher = self.teacher_ok(cls, b.get("key"))
        s = cls["students"].get(b.get("sid")) if b.get("sid") else None
        if not is_teacher and not s:
            return self.err("Yetkisiz", 403)
        if cls["ended"] and typ != "noop":
            return self.err("Ders sona erdi", 410)

        if typ == "chat":
            text = str(b.get("text") or "").strip()[:500]
            if not text:
                return self.err("Boş mesaj")
            msg = {"t": t, "role": "teacher" if is_teacher and not s else "student",
                   "name": "Öğretmen" if is_teacher and not s else s["name"], "text": text}
            cls["chat"].append(msg)
            if s:
                s["chat_count"] += 1
            kayit.olay_ekle(KAYIT, cls["code"], s["id"] if s else None, t, "chat", {"text": text})
            push(cls, {"type": "chat", "msg": msg})
        elif typ == "hand" and s:
            s["hand"] = bool(b.get("up"))
            if s["hand"]:
                s["hand_count"] += 1
            kayit.olay_ekle(KAYIT, cls["code"], s["id"], t, "hand", {"up": s["hand"]})
            push(cls, {"type": "hand", "id": s["id"], "name": s["name"], "up": s["hand"]}, role="teacher")
        elif typ == "reaction" and s:
            r = str(b.get("emoji") or "")[:8]
            if r not in ("👍", "❓", "🐢", "🎉", "💡"):
                return self.err("Geçersiz tepki")
            s["reactions"] += 1
            cls["reaction_counts"][r] = cls["reaction_counts"].get(r, 0) + 1
            kayit.olay_ekle(KAYIT, cls["code"], s["id"], t, "reaction", {"emoji": r})
            push(cls, {"type": "reaction", "emoji": r, "name": s["name"]}, role="teacher")
        elif typ == "signal":
            # WebRTC sinyalleşmesi (offer/answer/ICE/ready). İçerik sunucuda yorumlanmaz.
            data = b.get("data")
            if not isinstance(data, dict):
                return self.err("Geçersiz sinyal")
            if s:          # öğrenci -> öğretmen
                push(cls, {"type": "signal", "from": s["id"], "name": s["name"], "data": data}, role="teacher")
            else:          # öğretmen -> öğrenci
                to = b.get("to")
                if to not in cls["students"]:
                    return self.err("Öğrenci bulunamadı", 404)
                push(cls, {"type": "signal", "data": data}, role="student", sid=to)
        elif not is_teacher:
            return self.err("Yetkisiz", 403)
        elif typ == "live":
            cls["live"] = bool(b.get("on"))
            push(cls, {"type": "live", "on": cls["live"]}, role="student")
        elif typ == "lower_hand":
            st = cls["students"].get(b.get("id"))
            if st:
                st["hand"] = False
                kayit.olay_ekle(KAYIT, cls["code"], st["id"], t, "lower_hand", None)
                push(cls, {"type": "hand_lowered"}, role="student", sid=st["id"])
        elif typ == "topic":
            cls["topic"] = str(b.get("topic") or "").strip()[:120]
            cls.setdefault("topic_log", []).append({"t": t, "topic": cls["topic"]})
            kayit.olay_ekle(KAYIT, cls["code"], None, t, "topic", {"topic": cls["topic"]})
            push(cls, {"type": "topic", "topic": cls["topic"]})
        elif typ == "announce":
            cls["announce"] = {"t": t, "text": str(b.get("text") or "").strip()[:300]}
            push(cls, {"type": "announce", "announce": cls["announce"]}, role="student")
        elif typ == "material":
            mid = b.get("id")
            if mid is not None and (isinstance(mid, bool) or mid not in
                                    [m["id"] for m in kayit.materyaller(KAYIT, cls["code"])]):
                return self.err("Materyal bulunamadı")
            kayit.materyal_sec(KAYIT, cls["code"], mid, t)
            kayit.olay_ekle(KAYIT, cls["code"], None, t, "material", {"id": mid})
            push(cls, {"type": "material", "active": mid}, role="teacher")
        elif typ == "demo":
            add_demo_students(cls, max(1, min(12, int(b.get("count") or 6))))
        elif typ == "end":
            cls["ended"] = t
            push(cls, {"type": "ended"})
            persist(cls)
            kayit.materyal_sec(KAYIT, cls["code"], None, t)   # açık materyal aralığı ders bitişinde kapanır
            kayit.ders_bitir(KAYIT, cls["code"], t)
            kayit.olay_ekle(KAYIT, cls["code"], None, t, "end", None)
        else:
            return self.err("Bilinmeyen olay")
        self.send_json({"ok": True})


def kayit_okuma():
    """DATA/dersler.db'ye salt okunur bağlantı (yönetim okumaları; LOCK gerekmez).
    Yazar bağlantı (KAYIT) WAL kipindedir: okuyucu yazmaları beklemez, yazmalar okuyucuyu beklemez."""
    uri = pathlib.Path(os.path.join(DATA, "dersler.db")).resolve().as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def veri_klasoru_ayarla(yol):
    """--data: veri klasörünü değiştirir (yalnız başlangıçta çağrılır); KAYIT yeni klasördeki dersler.db ile açılır, yönetici anahtarı oradan okunur."""
    global DATA, KAYIT, TEST_DIR, GL_DB, _ADMIN_KEY
    yol = os.path.abspath(yol)
    os.makedirs(yol, exist_ok=True)
    with _ADMIN_LOCK:
        DATA = yol
        eski = KAYIT
        KAYIT = kayit.ac(os.path.join(yol, "dersler.db"))
        TEST_DIR = os.path.join(yol, "test_kayitlari")
        GL_DB = os.path.join(TEST_DIR, "gazelab.db")
        _ADMIN_KEY = None
        try:
            eski.close()
        except Exception:
            pass


def _ust_surec_izle(kapat=None, bekleme=2.0):
    """Masaüstü uygulaması (DERSNABZI_OTURUM verilir) sunucuyu stdin borusuyla başlatır.
    Electron ana süreci ölürse boru kapanır (EOF): sunucu yetim kalmasın diye süreç sonlanır.
    Önce kısa bir düzenli kapanış denenir (kapat), en geç `bekleme` saniye sonra os._exit.
    Tarayıcı kullanımında (ortam değişkeni yok) hiçbir şey yapmaz."""
    if not os.environ.get("DERSNABZI_OTURUM") or sys.stdin is None:
        return None

    def izle():
        try:
            try:
                kaynak = getattr(sys.stdin, "buffer", sys.stdin)
                while kaynak.read(4096):
                    pass
            except Exception:
                pass
            # Electron ölünce stdout/stderr boruları da kapanır: yazma hatası çıkışı engellememeli.
            try:
                print("Uygulama kapandı (stdin kapandı); sunucu sonlanıyor.")
            except BaseException:
                pass
            if kapat is not None:
                try:
                    t = threading.Thread(target=kapat, daemon=True)
                    t.start()
                    t.join(bekleme)
                except BaseException:
                    pass
        finally:
            os._exit(0)

    t = threading.Thread(target=izle, name="ust-surec-izle", daemon=True)
    t.start()
    return t


def _aktif_dersleri_kaydet():
    with LOCK:
        for cls in CLASSES.values():
            if not cls["ended"]:
                persist(cls)


def main():
    ap = argparse.ArgumentParser(description="DersNabzı sunucusu")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    # İsteğe bağlı HTTPS dinleyicisi (aynı süreç, aynı ders durumu). Telefon/başka cihaz kamerası için
    # tarayıcı güvenli adres ister. Ör: --https-port 8443 --cert yerel_ssl/sertifika.pem --key yerel_ssl/anahtar.pem
    ap.add_argument("--https-port", type=int, default=0)
    ap.add_argument("--https-host", default="0.0.0.0")
    ap.add_argument("--cert", default="")
    ap.add_argument("--key", default="")
    ap.add_argument("--data", default="", help="veri klasörü (varsayılan: uygulama klasörü/data)")
    a = ap.parse_args()
    if a.data:
        veri_klasoru_ayarla(a.data)
    try:
        sys.stdout.reconfigure(line_buffering=True)   # loglar anında görünsün
    except AttributeError:
        pass
    restore_active()
    yonetici_anahtari()   # başlangıçta üret/yaz; konsolda görünsün
    threading.Thread(target=ticker, daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    _ust_surec_izle(_aktif_dersleri_kaydet)
    print(f"DersNabzı çalışıyor: http://{'localhost' if a.host in ('127.0.0.1', '0.0.0.0') else a.host}:{a.port}")
    if a.https_port:
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(a.cert, a.key)
        hs = ThreadingHTTPServer((a.https_host, a.https_port), Handler)
        hs.daemon_threads = True
        hs.socket = ctx.wrap_socket(hs.socket, server_side=True)
        threading.Thread(target=hs.serve_forever, daemon=True).start()
        print(f"HTTPS de açık: https://{a.https_host}:{a.https_port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatılıyor…")
        _aktif_dersleri_kaydet()


if __name__ == "__main__":
    main()

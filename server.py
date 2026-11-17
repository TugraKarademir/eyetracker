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
import json
import math
import os
import queue
import random
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)

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
CLASSES = {}

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
    }


def material_pct(samples):
    """Örneklerdeki (5. alan = materyale bakma payı) ortalama, yüzde."""
    v = [x[4] for x in samples if len(x) > 4 and x[4] is not None]
    return round(100 * sum(v) / len(v)) if v else None


def aggregate(cls, t):
    online = [s for s in cls["students"].values() if (t - s["last_seen"]) < OFFLINE_AFTER]
    emo = {e: 0 for e in EMOTIONS}
    for s in online:
        emo[s["metrics"].get("emotion", "notr")] = emo.get(s["metrics"].get("emotion", "notr"), 0) + 1
    n = len(online)
    return {
        "present": n,
        "total": len(cls["students"]),
        "attention": round(sum(s["metrics"].get("attention", 0) for s in online) / n) if n else None,
        "energy": round(sum(s["metrics"].get("energy", 0) for s in online) / n) if n else None,
        "emotions": emo,
        "hands": sum(1 for s in cls["students"].values() if s["hand"]),
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
    return {
        "type": "state",
        "cls": {"code": cls["code"], "name": cls["name"], "topic": cls["topic"],
                "created": cls["created"], "ended": cls["ended"], "live": cls.get("live", False)},
        "agg": aggregate(cls, t),
        "students": sorted((public_student(s, t) for s in cls["students"].values()),
                           key=lambda x: (not x["online"], x["attention"])),
        "timeline": cls["timeline"][-120:],
        "reactions": cls["reaction_counts"],
        "heat": norm_heat(cls["heat_live"]),
    }


def norm_heat(grid):
    mx = max(grid) if grid else 0
    return [round(100 * v / mx) for v in grid] if mx > 0.05 else None


def add_heat(cls, pts):
    for u, v in pts:
        i = min(HY - 1, int(v * HY)) * HX + min(HX - 1, int(u * HX))
        cls["heat_live"][i] += 1
        cls["heat_total"][i] += 1


def add_alert(cls, kind, text, key, t, cooldown=60):
    last = cls["alert_marks"].get(key, 0)
    if t - last < cooldown:
        return
    cls["alert_marks"][key] = t
    alert = {"t": t, "kind": kind, "text": text}
    cls["alerts"].append(alert)
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

def make_student(sid, name, demo=False):
    t = now()
    return {"id": sid, "name": name, "demo": demo, "joined": t, "last_seen": t,
            "metrics": {"attention": 0, "energy": 0, "emotion": "notr"},
            "hand": False, "hand_count": 0, "chat_count": 0, "reactions": 0,
            "samples": [], "low_since": None, "low_alerted": False, "gaze_time": {}}


def record_metrics(cls, s, m, t, gaze=None):
    m["gazeCal"] = gaze is not None
    m["gazeRegion"] = gaze["region"] if gaze else None
    s["metrics"] = m
    s["last_seen"] = t
    mat = None
    if gaze:
        for k, v in gaze["share"].items():
            s["gaze_time"][k] = s["gaze_time"].get(k, 0) + v
        if gaze["share"]:
            mat = round(gaze["share"].get("materyal", 0), 2)
        add_heat(cls, gaze["pts"])
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
                      "att_" + s["id"], t, cooldown=90)
    else:
        s["low_since"] = None
        s["low_alerted"] = False
    if m["energy"] < LOW_ENERGY:
        add_alert(cls, "energy", f"{s['name']} yorgun görünüyor (enerji %{round(m['energy'])}).",
                  "en_" + s["id"], t, cooldown=180)


def class_alerts(cls, agg, t):
    n = agg["present"]
    if n >= 3:
        confused = agg["emotions"].get("kafa_karisik", 0) + agg["emotions"].get("zorlaniyor", 0)
        if confused / n >= 0.35:
            add_alert(cls, "class", f"Sınıfın %{round(100 * confused / n)}'i zorlanıyor ya da kafası "
                      "karışık görünüyor. Konuyu bir örnekle tekrar açıklamayı düşünün.", "cls_conf", t, 120)
        if agg["attention"] is not None and agg["attention"] < 50:
            add_alert(cls, "class", f"Sınıf dikkati %{agg['attention']} seviyesine düştü. "
                      "Kısa bir soru ya da etkinlik iyi gelebilir.", "cls_att", t, 120)
        if agg["energy"] is not None and agg["energy"] < 45:
            add_alert(cls, "class", "Sınıfın enerjisi düşük. 2-3 dakikalık bir mola önerilir.",
                      "cls_en", t, 300)


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
                agg = aggregate(cls, t)
                if take_tl and agg["present"]:
                    cls["timeline"].append({"t": round(t), "attention": agg["attention"],
                                            "energy": agg["energy"], "present": agg["present"],
                                            "emotions": agg["emotions"],
                                            "material": agg["gaze"]["onMaterial"]})
                    class_alerts(cls, agg, t)
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
    return {"region": region, "share": share, "pts": pts}


def build_report(cls):
    end = cls["ended"] or now()
    students = []
    for s in cls["students"].values():
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
        })
    students.sort(key=lambda x: -(x["avgAttention"] or 0))
    total_gaze = {}
    for s in cls["students"].values():
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
        "timeline": tl, "students": students, "alerts": cls["alerts"],
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
        if n > 200_000:
            raise ValueError("çok büyük")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def teacher_ok(self, cls, key):
        return bool(key) and secrets.compare_digest(str(key), cls["teacher_key"])

    # GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
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
        if not full.startswith(STATIC) or not os.path.isfile(full):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CTYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
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
        try:
            b = self.body()
        except (ValueError, json.JSONDecodeError):
            return self.err("Geçersiz JSON")
        routes = {"/api/class": self.create_class, "/api/join": self.join,
                  "/api/metrics": self.metrics, "/api/event": self.event}
        fn = routes.get(u.path)
        if not fn:
            return self.err("Bulunamadı", 404)
        with LOCK:
            return fn(b)

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
        sid = b.get("sid")
        if sid in cls["students"] and cls["students"][sid]["name"] == name:
            return self.send_json({"sid": sid, "name": cls["students"][sid]["name"]})
        sid = "s_" + secrets.token_hex(6)
        cls["students"][sid] = make_student(sid, name)
        self.send_json({"sid": sid, "name": name})

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
        record_metrics(cls, s, m, now(), parse_gaze(b.get("gaze")))
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
            push(cls, {"type": "chat", "msg": msg})
        elif typ == "hand" and s:
            s["hand"] = bool(b.get("up"))
            if s["hand"]:
                s["hand_count"] += 1
            push(cls, {"type": "hand", "id": s["id"], "name": s["name"], "up": s["hand"]}, role="teacher")
        elif typ == "reaction" and s:
            r = str(b.get("emoji") or "")[:8]
            if r not in ("👍", "❓", "🐢", "🎉", "💡"):
                return self.err("Geçersiz tepki")
            s["reactions"] += 1
            cls["reaction_counts"][r] = cls["reaction_counts"].get(r, 0) + 1
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
                push(cls, {"type": "hand_lowered"}, role="student", sid=st["id"])
        elif typ == "topic":
            cls["topic"] = str(b.get("topic") or "").strip()[:120]
            cls.setdefault("topic_log", []).append({"t": t, "topic": cls["topic"]})
            push(cls, {"type": "topic", "topic": cls["topic"]})
        elif typ == "announce":
            cls["announce"] = {"t": t, "text": str(b.get("text") or "").strip()[:300]}
            push(cls, {"type": "announce", "announce": cls["announce"]}, role="student")
        elif typ == "demo":
            add_demo_students(cls, max(1, min(12, int(b.get("count") or 6))))
        elif typ == "end":
            cls["ended"] = t
            push(cls, {"type": "ended"})
            persist(cls)
        else:
            return self.err("Bilinmeyen olay")
        self.send_json({"ok": True})


def main():
    ap = argparse.ArgumentParser(description="DersNabzı sunucusu")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(line_buffering=True)   # loglar anında görünsün
    except AttributeError:
        pass
    restore_active()
    threading.Thread(target=ticker, daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    print(f"DersNabzı çalışıyor: http://{'localhost' if a.host in ('127.0.0.1', '0.0.0.0') else a.host}:{a.port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatılıyor…")
        with LOCK:
            for cls in CLASSES.values():
                if not cls["ended"]:
                    persist(cls)


if __name__ == "__main__":
    main()

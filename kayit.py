"""Kalıcı ders kaydı (SQLite). Yalnız standart kütüphane."""
import json
import re
import sqlite3

_SEMA = """
CREATE TABLE IF NOT EXISTS lessons(code TEXT PRIMARY KEY, name TEXT, topic TEXT,
  created REAL, ended REAL, teacher_meta TEXT);
CREATE TABLE IF NOT EXISTS participants(code TEXT PRIMARY KEY, created REAL);
CREATE TABLE IF NOT EXISTS students(lesson_code TEXT, sid TEXT, name TEXT,
  participant_code TEXT, joined REAL, PRIMARY KEY(lesson_code, sid));
CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_code TEXT, idx INTEGER, name TEXT, kind TEXT, image_path TEXT);
CREATE TABLE IF NOT EXISTS material_spans(lesson_code TEXT, material_id INTEGER,
  t_start REAL, t_end REAL);
CREATE TABLE IF NOT EXISTS samples(lesson_code TEXT, sid TEXT, t REAL,
  material_id INTEGER, attention REAL, energy REAL, emotion TEXT, face INTEGER,
  away INTEGER, eyes_closed INTEGER, tab_hidden INTEGER, gaze_cal INTEGER,
  coarse INTEGER, share TEXT, mat_pts TEXT, gaze TEXT, wg_share TEXT, head TEXT);
CREATE INDEX IF NOT EXISTS ix_samples ON samples(lesson_code, sid, t);
CREATE TABLE IF NOT EXISTS setups(lesson_code TEXT, sid TEXT, t REAL, setup TEXT);
CREATE TABLE IF NOT EXISTS calibrations(lesson_code TEXT, sid TEXT, t REAL,
  at REAL, report TEXT);
CREATE TABLE IF NOT EXISTS events(lesson_code TEXT, sid TEXT, t REAL,
  kind TEXT, data TEXT);
"""
_KOD = re.compile(r"^[A-Z0-9_-]{1,20}$")
_TUR = ("insan", "yz", "diger")
_OZEL = ("share", "mat_pts", "gaze", "wg_share", "head")  # JSON alanlar


def _js(v):
    return None if v is None else json.dumps(v, ensure_ascii=False)


def ac(yol):
    con = sqlite3.connect(yol, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(_SEMA)
    return con


def ders_ekle(con, code, name, topic, created):
    with con:
        con.execute("INSERT OR IGNORE INTO lessons(code,name,topic,created)"
                    " VALUES(?,?,?,?)", (code, name, topic, created))


def ders_bitir(con, code, ended):
    with con:
        con.execute("UPDATE lessons SET ended=? WHERE code=?", (ended, code))


def ogrenci_ekle(con, lesson, sid, name, pcode, joined, demo):
    if demo:
        return False
    with con:
        # Yeniden ekleme (yeniden katılım, sunucu yeniden başlatma) katılımcı kodunu ve
        # ilk katılım zamanını silmez: kod yalnız yeni bir kod verildiyse değişir.
        con.execute("INSERT INTO students(lesson_code,sid,name,participant_code,joined)"
                    " VALUES(?,?,?,?,?) ON CONFLICT(lesson_code,sid) DO UPDATE SET"
                    " name=excluded.name, participant_code="
                    "COALESCE(excluded.participant_code, students.participant_code)",
                    (lesson, sid, name, pcode, joined))
    return True


def _kayitli(con, lesson, sid):
    return con.execute("SELECT 1 FROM students WHERE lesson_code=? AND sid=?",
                       (lesson, sid)).fetchone() is not None


def materyal_ekle(con, lesson, name, kind, image_path=None):
    if kind not in _TUR:
        raise ValueError("materyal türü: insan|yz|diger")
    with con:
        idx = con.execute("SELECT COUNT(*) FROM materials WHERE lesson_code=?",
                          (lesson,)).fetchone()[0]
        return con.execute(
            "INSERT INTO materials(lesson_code,idx,name,kind,image_path)"
            " VALUES(?,?,?,?,?)", (lesson, idx, name, kind, image_path)).lastrowid


def materyal_gorsel(con, material_id, image_path):
    with con:
        con.execute("UPDATE materials SET image_path=? WHERE id=?",
                    (image_path, material_id))


def materyaller(con, lesson):
    return [dict(r) for r in con.execute(
        "SELECT * FROM materials WHERE lesson_code=? ORDER BY idx", (lesson,))]


def materyal_sec(con, lesson, material_id, t):
    with con:
        con.execute("UPDATE material_spans SET t_end=? WHERE lesson_code=?"
                    " AND t_end IS NULL", (t, lesson))
        if material_id is not None:
            con.execute("INSERT INTO material_spans VALUES(?,?,?,NULL)",
                        (lesson, material_id, t))


def aktif_materyal(con, lesson):
    r = con.execute("SELECT material_id FROM material_spans WHERE lesson_code=?"
                    " AND t_end IS NULL ORDER BY t_start DESC LIMIT 1",
                    (lesson,)).fetchone()
    return r[0] if r else None


def ornek_ekle(con, lesson, sid, t, row):
    if not _kayitli(con, lesson, sid):
        return
    v = [row.get(k) for k in ("attention", "energy", "emotion", "face", "away",
                              "eyes_closed", "tab_hidden", "gaze_cal", "coarse")]
    v += [_js(row.get(k)) for k in _OZEL]
    with con:
        con.execute("INSERT INTO samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (lesson, sid, t, aktif_materyal(con, lesson), *v))


def kurulum_ekle(con, lesson, sid, t, setup):
    if not _kayitli(con, lesson, sid):
        return False
    s = json.dumps(setup, ensure_ascii=False, sort_keys=True)
    son = con.execute("SELECT setup FROM setups WHERE lesson_code=? AND sid=?"
                      " ORDER BY rowid DESC LIMIT 1", (lesson, sid)).fetchone()
    if son and json.dumps(json.loads(son[0]), ensure_ascii=False, sort_keys=True) == s:
        return False
    with con:
        con.execute("INSERT INTO setups VALUES(?,?,?,?)", (lesson, sid, t, s))
    return True


def kalibrasyon_ekle(con, lesson, sid, t, report):
    if not _kayitli(con, lesson, sid):
        return False
    at = report.get("at")
    if at is not None and con.execute(
            "SELECT 1 FROM calibrations WHERE lesson_code=? AND sid=? AND at=?",
            (lesson, sid, at)).fetchone():
        return False
    with con:
        con.execute("INSERT INTO calibrations VALUES(?,?,?,?,?)",
                    (lesson, sid, t, at, _js(report)))
    return True


def olay_ekle(con, lesson, sid, t, kind, data):
    if sid is not None and not _kayitli(con, lesson, sid):
        return   # demo / kayıtsız öğrenci olayı yazılmaz
    with con:
        con.execute("INSERT INTO events VALUES(?,?,?,?,?)",
                    (lesson, sid, t, kind, _js(data)))


def katilimci_ekle(con, code):
    c = str(code).strip().upper()
    if not _KOD.match(c):
        raise ValueError("katılımcı kodu: A-Z 0-9 _ - (1-20)")
    with con:
        con.execute("INSERT OR IGNORE INTO participants VALUES(?, strftime('%s','now'))", (c,))
    return c


def katilimci_var(con, code):
    return con.execute("SELECT 1 FROM participants WHERE code=?",
                       (str(code).strip().upper(),)).fetchone() is not None


def katilimcilar(con):
    return [dict(r) for r in con.execute(
        "SELECT * FROM participants ORDER BY code")]

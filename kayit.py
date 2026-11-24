"""Kalıcı ders kaydı (SQLite). Yalnız standart kütüphane."""
import json
import re
import sqlite3
import time

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
CREATE TABLE IF NOT EXISTS teachers(id TEXT PRIMARY KEY, name TEXT, email TEXT,
  kurum TEXT, note TEXT, created REAL, aktif INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS bakis_testleri(lesson_code TEXT, sid TEXT, t REAL,
  dosya TEXT PRIMARY KEY, durum TEXT, gl_acc REAL, model TEXT);
"""
_KOD = re.compile(r"^[A-Z0-9_-]{1,20}$")
_TUR = ("insan", "yz", "diger")
_OZEL = ("share", "mat_pts", "gaze", "wg_share", "head", "ham")  # JSON alanlar (ham: 2 sn penceresinin ham yüz ölçüleri)
_ALAN = ("attention", "energy", "emotion", "face", "away", "eyes_closed", "tab_hidden",
         "gaze_cal", "coarse")
GONDERIM_SN = 2.0   # öğrenci 2 sn'de bir paket gönderir: paket [t - 2, t] aralığını kapsar


def _js(v):
    return None if v is None else json.dumps(v, ensure_ascii=False)


def ac(yol):
    con = sqlite3.connect(yol, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(_SEMA)
    # Göç: eski veritabanlarında gecis sütunu yok (1 = paket materyal geçişini kapsıyor)
    if "gecis" not in {r[1] for r in con.execute("PRAGMA table_info(samples)")}:
        with con:
            con.execute("ALTER TABLE samples ADD COLUMN gecis INTEGER DEFAULT 0")
    # Göç: ham yüz ölçüleri (sınıf testi 24.11): yaw/pitch/EAR/MAR/kırpma/ifade/3B baş özeti, JSON
    if "ham" not in {r[1] for r in con.execute("PRAGMA table_info(samples)")}:
        with con:
            con.execute("ALTER TABLE samples ADD COLUMN ham TEXT")
    # Göç: dersin öğretmeni (öğretmen girişi henüz yok; ders başlatırken listeden seçilir, seçilmezse NULL)
    if "teacher_id" not in {r[1] for r in con.execute("PRAGMA table_info(lessons)")}:
        with con:
            con.execute("ALTER TABLE lessons ADD COLUMN teacher_id TEXT")
    # Göç: KVKK onayı (sınıf testi 25.11): onay zamanı ve onay metninin sürümü
    ogr = {r[1] for r in con.execute("PRAGMA table_info(students)")}
    for sut, tur in (("onay_t", "REAL"), ("onay_surum", "TEXT")):
        if sut not in ogr:
            with con:
                con.execute(f"ALTER TABLE students ADD COLUMN {sut} {tur}")
    return con


def ders_ekle(con, code, name, topic, created, teacher_id=None):
    with con:
        con.execute("INSERT OR IGNORE INTO lessons(code,name,topic,created,teacher_id)"
                    " VALUES(?,?,?,?,?)", (code, name, topic, created, teacher_id))


_OGRETMEN_ALAN = {"name": 80, "email": 120, "kurum": 120, "note": 500}


def _ogretmen_temiz(d):
    out = {k: str(d.get(k) or "").strip()[:n] for k, n in _OGRETMEN_ALAN.items() if k in d}
    if "email" in out and out["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", out["email"]):
        raise ValueError("e-posta biçimi geçersiz")
    return out


def ogretmen_ekle(con, d):
    """Öğretmen ekle (giriş henüz yok: yalnız kimlik ve iletişim bilgisi). Döner: yeni id."""
    import secrets
    v = _ogretmen_temiz(d)
    if not v.get("name"):
        raise ValueError("öğretmen adı gerekli")
    tid = "t_" + secrets.token_hex(4)
    with con:
        con.execute("INSERT INTO teachers(id,name,email,kurum,note,created,aktif) VALUES(?,?,?,?,?,?,1)",
                    (tid, v["name"], v.get("email", ""), v.get("kurum", ""), v.get("note", ""), time.time()))
    return tid


def ogretmen_guncelle(con, tid, d):
    v = _ogretmen_temiz(d)
    if "name" in v and not v["name"]:
        raise ValueError("öğretmen adı boş olamaz")
    if "aktif" in d:
        v["aktif"] = 1 if d["aktif"] else 0
    if not con.execute("SELECT 1 FROM teachers WHERE id=?", (tid,)).fetchone():
        raise KeyError(tid)
    if v:
        with con:
            con.execute("UPDATE teachers SET %s WHERE id=?" % ",".join(f"{k}=?" for k in v), (*v.values(), tid))


def ogretmen_aktif(con, tid):
    return bool(tid) and con.execute("SELECT 1 FROM teachers WHERE id=? AND aktif=1", (tid,)).fetchone() is not None


def ogretmenler(con, yalniz_aktif=False):
    """Öğretmenler ve ders verisi özetleri (ders, öğrenci, örnek, kalibrasyon sayısı, son ders)."""
    sql = ("SELECT t.*, COUNT(DISTINCT l.code) AS n_ders, MAX(l.created) AS son_ders,"
           " (SELECT COUNT(*) FROM students s JOIN lessons x ON x.code=s.lesson_code WHERE x.teacher_id=t.id) AS n_ogrenci,"
           " (SELECT COUNT(*) FROM samples s JOIN lessons x ON x.code=s.lesson_code WHERE x.teacher_id=t.id) AS n_ornek,"
           " (SELECT COUNT(*) FROM calibrations c JOIN lessons x ON x.code=c.lesson_code WHERE x.teacher_id=t.id) AS n_kalibrasyon"
           " FROM teachers t LEFT JOIN lessons l ON l.teacher_id=t.id")
    if yalniz_aktif:
        sql += " WHERE t.aktif=1"
    return [dict(r) for r in con.execute(sql + " GROUP BY t.id ORDER BY t.name COLLATE NOCASE")]


def ders_bitir(con, code, ended):
    with con:
        con.execute("UPDATE lessons SET ended=? WHERE code=?", (ended, code))


def ogrenci_ekle(con, lesson, sid, name, pcode, joined, demo, onay_t=None, onay_surum=None):
    if demo:
        return False
    with con:
        # Yeniden ekleme (yeniden katılım, sunucu yeniden başlatma) katılımcı kodunu,
        # ilk katılım zamanını ve onayı silmez: yalnız yeni bir değer verildiyse değişir.
        con.execute("INSERT INTO students(lesson_code,sid,name,participant_code,joined,onay_t,onay_surum)"
                    " VALUES(?,?,?,?,?,?,?) ON CONFLICT(lesson_code,sid) DO UPDATE SET"
                    " name=excluded.name, participant_code="
                    "COALESCE(excluded.participant_code, students.participant_code),"
                    " onay_t=COALESCE(excluded.onay_t, students.onay_t),"
                    " onay_surum=COALESCE(excluded.onay_surum, students.onay_surum)",
                    (lesson, sid, name, pcode, joined, onay_t, onay_surum))
    return True


def ogrenci_var(con, lesson, sid):
    return _kayitli(con, lesson, sid)


def bakis_testi_yaz(con, lesson, sid, t, dosya, durum, gl_acc=None, model=None):
    """Bakış testi kaydını öğrenciye bağlar. Aynı dosya (ara kayıtların üzerine yazılan oturum dosyası) tek satırdır."""
    with con:
        con.execute("INSERT INTO bakis_testleri(lesson_code,sid,t,dosya,durum,gl_acc,model) VALUES(?,?,?,?,?,?,?)"
                    " ON CONFLICT(dosya) DO UPDATE SET t=excluded.t, durum=excluded.durum,"
                    " gl_acc=excluded.gl_acc, model=excluded.model"
                    " WHERE NOT (bakis_testleri.durum='bitti' AND excluded.durum<>'bitti')",   # bitti'den ara'ya dönmez
                    (lesson, sid, t, dosya, durum, gl_acc, model))


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


def materyal_anda(con, lesson, t):
    """t anında gösterilen materyal (yoksa None)."""
    r = con.execute("SELECT material_id FROM material_spans WHERE lesson_code=? AND t_start<=?"
                    " AND (t_end IS NULL OR t_end>?) ORDER BY t_start DESC LIMIT 1",
                    (lesson, t, t)).fetchone()
    return r[0] if r else None


def ornek_ekle(con, lesson, sid, t, row):
    """Paket [t - GONDERIM_SN, t] aralığını kapsar. Başında ve sonunda aynı materyal gösteriliyorsa
    o materyale yazılır; arada geçiş olduysa materyale atanmaz (material_id NULL, gecis=1)."""
    if not _kayitli(con, lesson, sid):
        return
    bas, son = materyal_anda(con, lesson, t - GONDERIM_SN), materyal_anda(con, lesson, t)
    mid, gecis = (son, 0) if bas == son else (None, 1)
    v = [row.get(k) for k in _ALAN] + [_js(row.get(k)) for k in _OZEL]
    sut = ("lesson_code", "sid", "t", "material_id") + _ALAN + _OZEL + ("gecis",)
    with con:
        con.execute("INSERT INTO samples(%s) VALUES(%s)" % (",".join(sut), ",".join("?" * len(sut))),
                    (lesson, sid, t, mid, *v, gecis))


_DEGISKEN_KURULUM = ("islemeFps", "gecikmeMs")   # her pakette oynar; tek başına yeni satır açmaz


def _kurulum_anahtar(setup):
    return json.dumps({k: v for k, v in setup.items() if k not in _DEGISKEN_KURULUM},
                      ensure_ascii=False, sort_keys=True)


def kurulum_ekle(con, lesson, sid, t, setup):
    if not _kayitli(con, lesson, sid):
        return False
    s = json.dumps(setup, ensure_ascii=False, sort_keys=True)
    son = con.execute("SELECT setup FROM setups WHERE lesson_code=? AND sid=?"
                      " ORDER BY rowid DESC LIMIT 1", (lesson, sid)).fetchone()
    if son and _kurulum_anahtar(json.loads(son[0])) == _kurulum_anahtar(setup):
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
        con.execute("INSERT OR IGNORE INTO participants VALUES(?, ?)", (c, time.time()))
    return c


def katilimci_var(con, code):
    return con.execute("SELECT 1 FROM participants WHERE code=?",
                       (str(code).strip().upper(),)).fetchone() is not None


def katilimcilar(con):
    return [dict(r) for r in con.execute(
        "SELECT * FROM participants ORDER BY code")]

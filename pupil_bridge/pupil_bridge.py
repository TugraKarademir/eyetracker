"""
Pupil Core -> Göz İzleme sunucusu köprüsü (Faz 8, DIY IR göz izleyici).

Pupil Capture'ın ağ API'sinden (ZMQ + msgpack) EKRAN YÜZEYİNE (surface)
eşlenmiş bakışı okur ve bizim mevcut kayıt API'mize POST eder. Böylece DIY
başa-takılan IR izleyiciden gelen veri, Faz 2-6 analiz/AOI/ısı haritası/Excel
zincirinde AYNEN işlenir — yakalama katmanı dışında hiçbir şey değişmez.

ÖN KOŞULLAR (Pupil tarafı):
  1) Pupil Capture çalışıyor, DIY başlık bağlı, göz kamerası pupili buluyor.
  2) "Surface Tracker" eklentisi açık; ekranda materyalin gösterildiği alanın
     köşelerine AprilTag işaretçileri yapıştırılmış ve bir yüzey tanımlanmış.
     Yüzey adı --surface ile verilen adla aynı olmalı (ör. "materyal").
  3) Böylece gaze_on_surfaces.norm_pos = materyale göre 0-1 koordinat
     ((0,0) sol-alt, (1,1) sağ-üst — biz y'yi üst-sol başlangıca çeviririz).

KULLANIM:
  python pupil_bridge.py --server http://localhost:8000 --study-code rm4ekwsk \
      --material-id 1 --surface materyal --participant pilot1

Bu v1 TEK materyale akıtır (uçtan uca doğrulama için). Çoklu materyal zaman
senkronu bir sonraki adım (README'ye bakın).

Bağımlılıklar: pyzmq, msgpack, requests
  pip install pyzmq msgpack requests
"""
import argparse
import sys
import time

try:
    import zmq
    import msgpack
    import requests
except ImportError as e:
    sys.exit("Eksik bağımlılık: %s\n  pip install pyzmq msgpack requests" % e)


def get_csrf(session, server, study_code):
    """run_study sayfasını GET ederek csrftoken çerezini alır (API POST için)."""
    url = "%s/dene/%s/" % (server.rstrip("/"), study_code)
    session.get(url)
    return session.cookies.get("csrftoken", "")


def start_session(session, server, study_code, csrf, participant, screen):
    url = "%s/api/session/baslat/" % server.rstrip("/")
    body = {
        "study_code": study_code,
        "participant_code": participant,
        "device": {
            "user_agent": "pupil_bridge",
            "screen_width": screen[0], "screen_height": screen[1],
            "viewport_width": screen[0], "viewport_height": screen[1],
            "device_pixel_ratio": 1,
        },
    }
    r = session.post(url, json=body, headers={"X-CSRFToken": csrf})
    r.raise_for_status()
    return r.json()["session_id"]


def flush(session, server, session_id, csrf, samples):
    if not samples:
        return
    url = "%s/api/session/%d/veri/" % (server.rstrip("/"), session_id)
    body = {"samples": samples, "meta": {"gaze_engine": "pupil_core_diy"}}
    r = session.post(url, json=body, headers={"X-CSRFToken": csrf})
    r.raise_for_status()


def finish(session, server, session_id, csrf):
    url = "%s/api/session/%d/bitir/" % (server.rstrip("/"), session_id)
    session.post(url, json={"status": "completed"}, headers={"X-CSRFToken": csrf})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--study-code", required=True)
    ap.add_argument("--material-id", type=int, required=True)
    ap.add_argument("--surface", default="materyal")
    ap.add_argument("--participant", default="")
    ap.add_argument("--pupil-host", default="127.0.0.1")
    ap.add_argument("--pupil-port", type=int, default=50020)
    ap.add_argument("--min-confidence", type=float, default=0.6)
    ap.add_argument("--screen", default="1920x1080")
    ap.add_argument("--flush-every", type=int, default=100)
    args = ap.parse_args()
    screen = tuple(int(v) for v in args.screen.lower().split("x"))

    # --- Pupil ağ API: SUB portunu al, surface konusuna abone ol ---
    ctx = zmq.Context()
    req = ctx.socket(zmq.REQ)
    req.connect("tcp://%s:%d" % (args.pupil_host, args.pupil_port))
    req.send_string("SUB_PORT")
    sub_port = req.recv_string()
    sub = ctx.socket(zmq.SUB)
    sub.connect("tcp://%s:%s" % (args.pupil_host, sub_port))
    sub.setsockopt_string(zmq.SUBSCRIBE, "surfaces.")
    print("Pupil'e bağlandı (SUB %s). Yüzey: '%s'. Veri bekleniyor…" % (sub_port, args.surface))

    http = requests.Session()
    csrf = get_csrf(http, args.server, args.study_code)
    session_id = start_session(http, args.server, args.study_code, csrf, args.participant, screen)
    print("Oturum başlatıldı: %d. Çıkmak için Ctrl+C." % session_id)

    samples = []
    t0 = None
    n_total = 0
    try:
        while True:
            topic = sub.recv_string()
            payload = msgpack.loads(sub.recv(), raw=False)
            if payload.get("name") != args.surface:
                continue
            for g in payload.get("gaze_on_surfaces", []):
                if g.get("confidence", 0) < args.min_confidence:
                    continue
                x, y = g["norm_pos"][0], 1.0 - g["norm_pos"][1]  # üst-sol başlangıç
                ts = g.get("timestamp", time.time())
                if t0 is None:
                    t0 = ts
                in_mat = 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0
                samples.append({
                    "material_id": args.material_id,
                    "t": int((ts - t0) * 1000),
                    "x_px": int(round(x * screen[0])),
                    "y_px": int(round(y * screen[1])),
                    "x_norm": round(x, 4),
                    "y_norm": round(y, 4),
                    "in_material": in_mat,
                })
                n_total += 1
            if len(samples) >= args.flush_every:
                flush(http, args.server, session_id, csrf, samples)
                samples = []
                print("  gönderildi, toplam %d örnek" % n_total, end="\r")
    except KeyboardInterrupt:
        print("\nKapatılıyor…")
    finally:
        flush(http, args.server, session_id, csrf, samples)
        finish(http, args.server, session_id, csrf)
        print("Bitti. Toplam %d örnek. Oturum %d tamamlandı." % (n_total, session_id))


if __name__ == "__main__":
    main()

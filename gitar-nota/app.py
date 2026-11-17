"""Gitar Nota (gitar sustur + tab) prototipi — yerel sunucu.

Çalıştır:  .venv\\Scripts\\python app.py
Bilgisayarda: http://localhost:8766
Telefonda (aynı Wi-Fi): http://<bilgisayarın-IP'si>:8766
"""
from __future__ import annotations

import json
import queue
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
SONGS = ROOT / "songs"
UPLOADS = ROOT / "uploads"
SONGS.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)
ALLOWED = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}

app = FastAPI(title="Gitar Nota")
jobs: dict[str, dict] = {}
work: "queue.Queue[str]" = queue.Queue()


def worker():
    import pipeline  # ağır modelleri ilk işte yükle
    while True:
        jid = work.get()
        job = jobs[jid]
        job["status"] = "running"

        def progress(msg: str):
            job["stage"] = msg

        try:
            pipeline.process(Path(job["src"]), SONGS / jid, title=job["title"], progress=progress)
            job["status"] = "done"
        except Exception as e:  # noqa: BLE001
            job["status"] = "error"
            job["stage"] = f"Hata: {e}"
            shutil.rmtree(SONGS / jid, ignore_errors=True)
        finally:
            Path(job["src"]).unlink(missing_ok=True)


threading.Thread(target=worker, daemon=True).start()


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"Desteklenen biçimler: {', '.join(sorted(ALLOWED))}")
    jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    src = UPLOADS / f"{jid}{ext}"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    title = re.sub(r"[_]+", " ", Path(file.filename).stem).strip() or "Şarkı"
    jobs[jid] = {"id": jid, "title": title, "src": str(src), "status": "queued",
                 "stage": "Sırada bekliyor…", "created": time.time()}
    work.put(jid)
    return {"id": jid}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    if jid not in jobs:
        raise HTTPException(404)
    j = jobs[jid]
    return {k: j[k] for k in ("id", "title", "status", "stage", "created")}


@app.get("/api/songs")
def list_songs():
    out = []
    for d in sorted(SONGS.iterdir(), reverse=True):
        f = d / "song.json"
        if f.exists():
            s = json.loads(f.read_text(encoding="utf-8"))
            out.append({"id": d.name, "title": s["title"], "duration": s["duration"],
                        "bpm": s["bpm"], "notes": len(s["notes"]), "chords": len({c["name"] for c in s["chords"]} - {"N"})})
    pending = [job_status(j) for j in jobs if jobs[j]["status"] in ("queued", "running", "error")]
    return {"songs": out, "pending": pending}


@app.delete("/api/songs/{sid}")
def delete_song(sid: str):
    d = (SONGS / sid).resolve()
    if d.parent != SONGS.resolve() or not d.exists():
        raise HTTPException(404)
    shutil.rmtree(d)
    return {"ok": True}


app.mount("/songs", StaticFiles(directory=SONGS), name="songs")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


if __name__ == "__main__":
    import os
    import socket
    import uvicorn
    port = int(os.environ.get("PORT", 8766))
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]; s.close()
    except OSError:
        ip = "127.0.0.1"
    print(f"\n  Bilgisayarda: http://localhost:{port}\n  Telefonda:    http://{ip}:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")

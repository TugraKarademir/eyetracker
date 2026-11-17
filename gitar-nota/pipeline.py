"""Ses dosyası -> gitar stem'i + gitarsız altyapı + akorlar + tab işleme hattı.

1. Demucs htdemucs_6s ile şarkıyı ayır: guitar + backing (gitar hariç her şey)
2. Basic Pitch (Spotify, ONNX) ile gitar stem'inden notaları çıkar
3. Notaları standart akortlu gitar klavyesine yerleştir (tel/perde, Viterbi)
4. Gitar+bas+piyano+diğer'den akor tanıma (chroma + şablon + yumuşatma)
5. librosa ile tempo / vuruş ızgarası, song.json + guitar.mid yaz

Kullanım:  python pipeline.py sarki.mp3 [cikti_klasoru]
"""
from __future__ import annotations

import itertools
import json
import sys
import time
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import soundfile as sf
import torch

SR = 44100
TUNING = [40, 45, 50, 55, 59, 64]          # E2 A2 D3 G3 B3 E4  (tel 6 -> tel 1)
STRING_NAMES = ["E", "A", "D", "G", "B", "e"]
MAX_FRET = 20
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_demucs_model = None


def _get_demucs():
    global _demucs_model
    if _demucs_model is None:
        from demucs.pretrained import get_model
        _demucs_model = get_model("htdemucs_6s")
        _demucs_model.eval()
    return _demucs_model


def _write_audio(path_no_ext: Path, audio: np.ndarray) -> str:
    """audio: [kanal, örnek]. Önce MP3 dener (küçük), olmazsa WAV."""
    data = np.clip(audio.T, -1, 1)
    try:
        p = path_no_ext.with_suffix(".mp3")
        sf.write(p, data, SR, format="MP3")
        return p.name
    except Exception:
        p = path_no_ext.with_suffix(".wav")
        sf.write(p, data, SR, subtype="PCM_16")
        return p.name


# ---------------------------------------------------------------- ayrıştırma
def separate(wav: np.ndarray, progress: Callable[[str], None]) -> dict[str, np.ndarray]:
    """wav: [2, n] float32 @44.1k -> {kaynak_adı: [2, n]}"""
    from demucs.apply import apply_model
    model = _get_demucs()
    x = torch.from_numpy(wav)
    ref = x.mean(0)
    mu, sd = ref.mean(), ref.std() + 1e-8
    x = (x - mu) / sd
    progress("Gitar sesi ayrılıyor (Demucs 6 kaynak)… en uzun adım bu")
    with torch.no_grad():
        out = apply_model(model, x[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    out = out * sd + mu
    return {name: out[i].numpy() for i, name in enumerate(model.sources)}


# ---------------------------------------------------------------- nota çıkarma
def transcribe(guitar_wav: Path, progress: Callable[[str], None]) -> tuple[list[dict], object]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    progress("Gitar notaları çıkarılıyor (Basic Pitch)…")
    _, midi, events = predict(
        str(guitar_wav), ICASSP_2022_MODEL_PATH,
        onset_threshold=0.65, frame_threshold=0.3, minimum_note_length=80,
        minimum_frequency=librosa.midi_to_hz(TUNING[0]) * 0.97,
        maximum_frequency=librosa.midi_to_hz(TUNING[-1] + MAX_FRET) * 1.03,
        multiple_pitch_bends=False, melodia_trick=True,
    )
    notes = []
    for start, end, pitch, amp, _bends in events:
        if amp < 0.45 or not (TUNING[0] <= pitch <= TUNING[-1] + MAX_FRET):
            continue
        notes.append({"t": round(float(start), 3), "d": round(float(end - start), 3),
                      "p": int(pitch), "v": round(float(amp), 2)})
    notes.sort(key=lambda n: (n["t"], n["p"]))
    return notes, midi


def _positions(pitch: int) -> list[tuple[int, int]]:
    """(tel_idx 0=kalın E, perde) olası konumlar"""
    return [(s, pitch - o) for s, o in enumerate(TUNING) if 0 <= pitch - o <= MAX_FRET]


def _cluster(notes: list[dict], win: float = 0.04) -> list[list[dict]]:
    groups: list[list[dict]] = []
    for n in notes:
        if groups and n["t"] - groups[-1][0]["t"] <= win:
            if all(m["p"] != n["p"] for m in groups[-1]):
                groups[-1].append(n)
        else:
            groups.append([n])
    for g in groups:  # en fazla 6 tel: en güçlüleri tut
        if len(g) > 6:
            g.sort(key=lambda m: -m["v"])
            del g[6:]
        g.sort(key=lambda m: m["p"])
    return groups


def _candidates(group: list[dict], limit: int = 24) -> list[tuple[tuple, float, float]]:
    """(atama, statik_maliyet, el_konumu) listesi"""
    out = []
    for combo in itertools.product(*[_positions(n["p"]) for n in group]):
        strings = [s for s, _ in combo]
        if len(set(strings)) != len(strings):
            continue
        fretted = [f for _, f in combo if f > 0]
        span = (max(fretted) - min(fretted)) if fretted else 0
        if span > 4:
            continue
        hand = float(np.mean(fretted)) if fretted else 0.0
        cost = span * 0.6 + hand * 0.12 + (0.0 if fretted else -0.3)
        out.append((combo, cost, hand))
    out.sort(key=lambda c: c[1])
    return out[:limit]


def assign_frets(notes: list[dict]) -> list[dict]:
    """Viterbi: el kaydırmasını ve yüksek perdeleri cezalandırarak tel/perde seç."""
    groups = _cluster(notes)
    cands = []
    kept = []
    for g in groups:
        c = _candidates(g)
        while not c and len(g) > 1:     # oynanamıyorsa en zayıf notayı at
            g.remove(min(g, key=lambda m: m["v"]))
            c = _candidates(g)
        if c:
            cands.append(c)
            kept.append(g)
    if not kept:
        return []
    cost = np.array([c[1] for c in cands[0]])
    back = []
    for i in range(1, len(cands)):
        prev, cur = cands[i - 1], cands[i]
        gap = kept[i][0]["t"] - kept[i - 1][0]["t"]
        w = 0.35 / (1.0 + gap)          # uzun boşlukta kaydırma ucuz
        ph = np.array([c[2] for c in prev])
        new_cost, bp = [], []
        for combo, sc, hand in cur:
            move = np.abs(ph - hand) if hand > 0 else np.zeros_like(ph)
            tot = cost + move * w
            j = int(np.argmin(tot))
            new_cost.append(tot[j] + sc)
            bp.append(j)
        cost = np.array(new_cost)
        back.append(bp)
    j = int(np.argmin(cost))
    path = [j]
    for bp in reversed(back):
        j = bp[j]
        path.append(j)
    path.reverse()
    out = []
    for g, c, j in zip(kept, cands, path):
        for n, (s, f) in zip(g, c[j][0]):
            out.append({**n, "s": 5 - s, "f": f})   # s: 0 = ince e (tab'ın üst satırı)
    return out


# ---------------------------------------------------------------- akorlar
def _chord_templates():
    names, temps = [], []
    for r in range(12):
        for q, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12)
            t[[(r + i) % 12 for i in iv]] = [1.0, 0.8, 0.9]
            names.append(NOTE_NAMES[r] + q)
            temps.append(t / np.linalg.norm(t))
    return names, np.array(temps)


def detect_chords(harm: np.ndarray, bass: np.ndarray, beats: np.ndarray, duration: float,
                  progress: Callable[[str], None]) -> list[dict]:
    progress("Akorlar tanınıyor…")
    hop = 2048
    y = librosa.resample(harm, orig_sr=SR, target_sr=22050)
    yb = librosa.resample(bass, orig_sr=SR, target_sr=22050)
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=hop, bins_per_octave=36)
    bchroma = librosa.feature.chroma_cqt(y=yb, sr=22050, hop_length=hop, fmin=librosa.note_to_hz("E1"),
                                         n_octaves=3, bins_per_octave=36)
    m = min(chroma.shape[1], bchroma.shape[1])
    chroma = chroma[:, :m] + 0.5 * bchroma[:, :m]
    energy = librosa.feature.rms(y=y + yb, hop_length=hop)[0]
    if len(beats) < 4:
        beats = np.arange(0, duration, 0.5)
    frames = librosa.time_to_frames(beats, sr=22050, hop_length=hop)
    frames = np.unique(np.clip(np.concatenate([[0], frames, [chroma.shape[1]]]), 0, chroma.shape[1]))
    sync = librosa.util.sync(chroma, frames, aggregate=np.median)
    esync = librosa.util.sync(energy[None], frames, aggregate=np.mean)[0]
    times = librosa.frames_to_time(frames, sr=22050, hop_length=hop)

    names, temps = _chord_templates()
    norm = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    score = temps @ norm                       # [24, segment]
    silent = esync < max(1e-4, np.percentile(esync, 90) * 0.05)
    # Viterbi: akor değiştirmeye ceza
    n_c, n_t = score.shape
    switch = 0.12
    dp = score[:, 0].copy()
    bp = np.zeros((n_c, n_t), dtype=int)
    for t in range(1, n_t):
        stay = dp
        best = dp.max()
        bj = int(dp.argmax())
        choose_switch = best - switch > stay
        bp[:, t] = np.where(choose_switch, bj, np.arange(n_c))
        dp = np.where(choose_switch, best - switch, stay) + score[:, t]
    path = [int(dp.argmax())]
    for t in range(n_t - 1, 0, -1):
        path.append(int(bp[path[-1], t]))
    path.reverse()

    segs: list[dict] = []
    for i, c in enumerate(path):
        t0 = float(times[i])
        t1 = float(times[i + 1]) if i + 1 < len(times) else duration
        name = "N" if silent[i] or score[c, i] < 0.55 else names[c]
        if segs and segs[-1]["name"] == name:
            segs[-1]["end"] = round(t1, 3)
        else:
            segs.append({"t": round(t0, 3), "end": round(t1, 3), "name": name})
    return segs


# ---------------------------------------------------------------- ana akış
def process(src: Path, out_dir: Path, title: str | None = None,
            progress: Callable[[str], None] = print) -> dict:
    t0 = time.time()
    out_dir.mkdir(parents=True, exist_ok=True)
    progress("Ses yükleniyor…")
    wav, _ = librosa.load(str(src), sr=SR, mono=False)
    if wav.ndim == 1:
        wav = np.stack([wav, wav])
    wav = wav[:2].astype(np.float32)
    duration = wav.shape[1] / SR

    st = separate(wav, progress)
    guitar = st["guitar"]
    backing = sum(v for k, v in st.items() if k != "guitar")
    progress("Ayrılmış sesler kaydediliyor…")
    files = {
        "mix": _write_audio(out_dir / "mix", wav),
        "guitar": _write_audio(out_dir / "guitar", guitar),
        "backing": _write_audio(out_dir / "backing", backing),
    }
    guitar_level = float(np.sqrt(np.mean(guitar ** 2)) / (np.sqrt(np.mean(wav ** 2)) + 1e-9))

    tmp = out_dir / "_guitar.wav"
    sf.write(tmp, guitar.mean(0), SR, subtype="PCM_16")
    raw, midi = transcribe(tmp, progress)
    tmp.unlink(missing_ok=True)
    midi.write(str(out_dir / "guitar.mid"))
    progress("Tab'a yerleştiriliyor…")
    notes = assign_frets(raw)

    progress("Tempo hesaplanıyor…")
    tempo, beats = librosa.beat.beat_track(y=wav.mean(0), sr=SR, units="time")
    bpm = float(np.atleast_1d(tempo)[0])

    harm = (st["guitar"] + st["piano"] + st["other"]).mean(0)
    chords = detect_chords(harm, st["bass"].mean(0), beats, duration, progress)

    song = {
        "title": title or src.stem,
        "duration": round(duration, 3),
        "bpm": round(bpm, 1),
        "beats": [round(float(b), 3) for b in beats],
        "files": files,
        "tuning": STRING_NAMES,
        "notes": notes,
        "chords": chords,
        "guitar_level": round(guitar_level, 3),
        "processing_seconds": round(time.time() - t0, 1),
    }
    (out_dir / "song.json").write_text(json.dumps(song, ensure_ascii=False), encoding="utf-8")
    progress("Hazır")
    return song


if __name__ == "__main__":
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("songs") / src.stem
    s = process(src, out)
    print(json.dumps({k: v for k, v in s.items() if k not in ("notes", "beats", "chords")},
                     ensure_ascii=False, indent=1))
    print("akorlar:", " ".join(c["name"] for c in s["chords"][:40]))

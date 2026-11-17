"""Doğruluğu ölçmek için sentetik test şarkısı: Karplus-Strong gitar (akor arpejleri)
+ sinüs bas + basit davul. Gerçek akorlar/notalar test_data/test_truth.json'a yazılır.

Kullanım: python make_test.py   ->  test_data/test_song.wav
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
BPM = 100
BEAT = 60 / BPM
rng = np.random.default_rng(1)
# (akor, gitarda çalınan MIDI notaları: alçaktan yükseğe)
PROG = [("C", [48, 52, 55, 60, 64]), ("G", [43, 47, 50, 55, 59, 67]),
        ("Am", [45, 52, 57, 60, 64]), ("F", [41, 48, 53, 57, 60, 65])]
BARS = 12
dur = BARS * 4 * BEAT + 2
n = int(dur * SR)
gtr = np.zeros(n); bass = np.zeros(n); drums = np.zeros(n)


def ks(freq, length, bright=0.5):
    N = int(SR / freq)
    buf = rng.uniform(-1, 1, N) * bright + rng.uniform(-1, 1, N) * (1 - bright) * 0.3
    out = np.zeros(int(length * SR))
    for i in range(len(out)):
        out[i] = buf[i % N]
        buf[i % N] = 0.996 * 0.5 * (buf[i % N] + buf[(i + 1) % N])
    return out


def add(dst, sig, t, g=1.0):
    i = int(t * SR); j = min(len(dst), i + len(sig))
    dst[i:j] += sig[:j - i] * g


truth_notes, truth_chords = [], []
for bar in range(BARS):
    name, notes = PROG[bar % 4]
    t0 = 1.0 + bar * 4 * BEAT
    truth_chords.append({"t": round(t0, 3), "end": round(t0 + 4 * BEAT, 3), "name": name})
    # 8'lik arpej: notalar sırayla yukarı-aşağı
    seq = notes + notes[-2:0:-1]
    for k in range(8):
        p = seq[k % len(seq)]
        t = t0 + k * BEAT / 2
        add(gtr, ks(440 * 2 ** ((p - 69) / 12), 1.2), t, 0.5)
        truth_notes.append({"t": round(t, 3), "p": p})
    root = notes[0] - 12 if notes[0] >= 40 else notes[0]
    tt = np.arange(int(4 * BEAT * SR)) / SR
    add(bass, np.sin(2 * np.pi * 440 * 2 ** ((root - 69) / 12) * tt) * np.exp(-tt * 0.6), t0, 0.35)
    for b in range(4):
        tb = t0 + b * BEAT
        tk = np.arange(int(0.25 * SR)) / SR
        add(drums, np.sin(2 * np.pi * (50 + 80 * np.exp(-tk * 30)) * tk) * np.exp(-tk * 12), tb, 0.6)
        if b % 2:
            add(drums, rng.normal(0, 1, int(0.15 * SR)) * np.exp(-np.arange(int(0.15 * SR)) / SR * 25), tb, 0.25)
        for h in (0, 0.5):
            add(drums, rng.normal(0, 1, 2000) * np.exp(-np.arange(2000) / 300), tb + h * BEAT, 0.08)

mix = gtr + bass + drums
mix /= np.abs(mix).max() * 1.1
out = Path(__file__).parent / "test_data"
out.mkdir(exist_ok=True)
sf.write(out / "test_song.wav", np.stack([mix, mix], 1), SR)
(out / "test_truth.json").write_text(json.dumps({"notes": truth_notes, "chords": truth_chords}))
print("yazıldı", out / "test_song.wav", f"{dur:.1f} sn")

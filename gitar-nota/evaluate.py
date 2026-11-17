"""Sentetik test şarkısını işleyip nota/akor doğruluğunu ölçer.
Kullanım: python evaluate.py
"""
import json
from pathlib import Path

import pipeline

ROOT = Path(__file__).parent
truth = json.loads((ROOT / "test_data" / "test_truth.json").read_text())
song = pipeline.process(ROOT / "test_data" / "test_song.wav", ROOT / "test_data" / "out", "Test")

# nota F1 (onset ±50 ms, aynı perde)
pred = [(n["t"], n["p"]) for n in song["notes"]]
used = set(); tp = 0
for tn in truth["notes"]:
    for i, (t, p) in enumerate(pred):
        if i not in used and p == tn["p"] and abs(t - tn["t"]) <= 0.05:
            used.add(i); tp += 1; break
prec = tp / max(1, len(pred)); rec = tp / len(truth["notes"])
f1 = 2 * prec * rec / max(1e-9, prec + rec)
print(f"Nota: P={prec:.2f} R={rec:.2f} F1={f1:.2f}  (tahmin {len(pred)}, gerçek {len(truth['notes'])})")

# akor doğruluğu: 0.1 sn örnekleme
def at(segs, t):
    for s in segs:
        if s["t"] <= t < s["end"]:
            return s["name"]
    return "N"
ts = [1.0 + i * 0.1 for i in range(int((truth["chords"][-1]["end"] - 1.0) / 0.1))]
acc = sum(at(song["chords"], t) == at(truth["chords"], t) for t in ts) / len(ts)
print(f"Akor zaman-doğruluğu: {acc:.2%}")
print("Tahmin akorlar:", " ".join(f"{c['name']}@{c['t']:.1f}" for c in song["chords"]))
playable = all(0 <= n["f"] <= 20 and 0 <= n["s"] <= 5 for n in song["notes"])
print("Tüm notalar oynanabilir konumda:", playable, "| gitar seviyesi:", song["guitar_level"])

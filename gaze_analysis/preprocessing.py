"""On isleme (spec §8.1): gecersiz/materyal disi ornekleri ayir, medyan filtre.

Ornek bicimi: {"t": ms, "x": 0-1, "y": 0-1, "in_material": bool}
(x, y materyale gore normalize; runner DB alanlarini bu bicime esler.)
"""
from statistics import median


def clean_samples(samples):
    """Materyal disi ve koordinati eksik ornekleri cikarir, t'ye gore siralar."""
    out = [
        s for s in samples
        if s.get("in_material") and s.get("x") is not None and s.get("y") is not None
    ]
    out.sort(key=lambda s: s["t"])
    return out


def moving_median(samples, window):
    """x ve y'ye hareketli medyan filtresi uygular (gurultu azaltma).

    window <= 1 ise filtre uygulanmaz. Tek sayi degilse bir artirilir.
    """
    n = len(samples)
    if window is None or window <= 1 or n == 0:
        return samples
    if window % 2 == 0:
        window += 1
    half = window // 2
    out = []
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        xs = [samples[j]["x"] for j in range(lo, hi)]
        ys = [samples[j]["y"] for j in range(lo, hi)]
        s = dict(samples[i])
        s["x"] = median(xs)
        s["y"] = median(ys)
        out.append(s)
    return out


def preprocess(samples, config):
    """clean + opsiyonel medyan filtre -> analize hazir ornek listesi."""
    cleaned = clean_samples(samples)
    return moving_median(cleaned, config.median_filter_window)


def actual_sampling_hz(samples):
    """Ornek listesinden gercek ornekleme hizini (Hz) hesaplar (spec §6)."""
    if len(samples) < 2:
        return None
    dur_ms = samples[-1]["t"] - samples[0]["t"]
    if dur_ms <= 0:
        return None
    return round(len(samples) / (dur_ms / 1000.0), 1)

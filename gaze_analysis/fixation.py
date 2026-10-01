"""Fiksasyon tespiti — I-DT (dagilim esigi) algoritmasi (spec §8.2).

Salvucci & Goldberg (2000). Dagilim D = (xmax-xmin) + (ymax-ymin).
Koordinatlar materyale gore normalize; dagilim "materyal genisligi" biriminde
olculur, bu yuzden y ekseni en-boy orani (yukseklik/genislik) ile olceklenir.

Web kamerasi gurultulu oldugu icin parametreler pilot veriyle ayarlanmalidir.
"""


def _dispersion(window, aspect):
    xs = [p["x"] for p in window]
    ys = [p["y"] * aspect for p in window]
    return (max(xs) - min(xs)) + (max(ys) - min(ys))


def _make_fixation(window):
    n = len(window)
    cx = sum(p["x"] for p in window) / n
    cy = sum(p["y"] for p in window) / n
    start = window[0]["t"]
    end = window[-1]["t"]
    return {
        "start_t": start,
        "end_t": end,
        "duration": end - start,
        "x": round(cx, 4),
        "y": round(cy, 4),
        "n_samples": n,
    }


def detect_fixations(samples, config, aspect=1.0):
    """Sirali (t artan) ornek listesinden fiksasyonlari dondurur.

    samples: [{"t":ms, "x":0-1, "y":0-1}, ...]  (on islenmis, materyal ici)
    aspect : yukseklik/genislik (y eksenini genislik birimine cevirmek icin)
    donus  : [{"start_t","end_t","duration","x","y","n_samples"}, ...]
    """
    thr = config.dispersion_threshold
    min_dur = config.min_fixation_ms
    pts = samples
    n = len(pts)
    fixations = []
    i = 0
    while i < n:
        # [i, j) penceresini zamanda min_dur'u kapsayacak sekilde baslat
        j = i + 1
        while j < n and (pts[j - 1]["t"] - pts[i]["t"]) < min_dur:
            j += 1
        # Yeterli zaman kalmadiysa bitir
        if j > n or (pts[j - 1]["t"] - pts[i]["t"]) < min_dur:
            break

        if _dispersion(pts[i:j], aspect) <= thr:
            # Esik asilana kadar pencereyi genislet
            while j < n and _dispersion(pts[i:j + 1], aspect) <= thr:
                j += 1
            fixations.append(_make_fixation(pts[i:j]))
            i = j
        else:
            i += 1  # pencereyi kaydir
    return fixations

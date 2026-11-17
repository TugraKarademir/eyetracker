"""Bilinen-hedef dogruluk testi (spec §12, PILOT.md).

Her ekranda TEK hedef gosterilir (8 ekran, sabit sira); katilimci noktaya bakar
ve "Devam" der. Hangi ornegin hangi hedefe ait oldugu kesindir (en-yakin atama
gerekmez). Ekranin basi (goz hedefe giderken) ve sonu (goz "Devam"a kayarken)
atilir; kalan orneklerin medyani ile hedef arasindaki uzaklik = dogruluk,
orneklerin medyana uzakliklarinin medyani = kesinlik (precision).

Koordinatlar materyale gore 0-1; uzakliklar "materyal genisligi" biriminde
(y ekseni en-boy orani ile olceklenir). Materyal disina tasan ornekler de
kullanilir (kenar hedeflerde atilirsa hata oldugundan kucuk cikar).
"""
import math
import statistics

# 3x3 izgara eksi merkez; saat yonunde, sol-ustten baslar.
EIGHT_POINT_TARGETS = [
    ("Hedef 1", 0.1, 0.1), ("Hedef 2", 0.5, 0.1), ("Hedef 3", 0.9, 0.1),
    ("Hedef 4", 0.9, 0.5), ("Hedef 5", 0.9, 0.9), ("Hedef 6", 0.5, 0.9),
    ("Hedef 7", 0.1, 0.9), ("Hedef 8", 0.1, 0.5),
]

TRIM_START_MS = 500   # goz hedefe gidiyor
TRIM_END_MS = 400     # goz "Devam" dugmesine kayiyor
MIN_SAMPLES = 5


def display_width_px(samples):
    """Materyalin ekrandaki genisligini (CSS px) orneklerden tahmin eder.

    x_px = left + x_norm * W dogrusal oldugundan W = egim (en kucuk kareler).
    """
    pts = [(s["x_norm"], s["x_px"]) for s in samples
           if s.get("x_norm") is not None and s.get("x_px") is not None]
    if len(pts) < 2:
        return None
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    if sxx <= 0:
        return None
    return sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx


def target_error(samples, tx, ty, aspect):
    """Tek hedef ekraninin ornekleri -> {"n","cx","cy","dx","dy","error","precision"}.

    Yeterli ornek yoksa error None.
    """
    pts = sorted((s for s in samples if s.get("x_norm") is not None and s.get("y_norm") is not None),
                 key=lambda s: s["t"])
    if pts:
        t0, t1 = pts[0]["t"], pts[-1]["t"]
        pts = [s for s in pts if t0 + TRIM_START_MS <= s["t"] <= t1 - TRIM_END_MS]
    if len(pts) < MIN_SAMPLES:
        return {"n": len(pts), "cx": None, "cy": None, "dx": None, "dy": None,
                "error": None, "precision": None}
    cx = statistics.median(s["x_norm"] for s in pts)
    cy = statistics.median(s["y_norm"] for s in pts)
    dx, dy = cx - tx, (cy - ty) * aspect
    prec = statistics.median(
        math.hypot(s["x_norm"] - cx, (s["y_norm"] - cy) * aspect) for s in pts)
    return {"n": len(pts), "cx": round(cx, 4), "cy": round(cy, 4),
            "dx": round(dx, 4), "dy": round(dy, 4),
            "error": round(math.hypot(dx, dy), 4), "precision": round(prec, 4)}


def summarize(rows):
    """Hedef satirlarindan ortalama/medyan hata ve yatay/dikey ortalama mutlak hata."""
    ok = [r for r in rows if r["error"] is not None]
    if not ok:
        return {"n_hit": 0, "mean_error": None, "median_error": None,
                "mean_abs_dx": None, "mean_abs_dy": None, "mean_precision": None}
    return {
        "n_hit": len(ok),
        "mean_error": round(statistics.mean(r["error"] for r in ok), 4),
        "median_error": round(statistics.median(r["error"] for r in ok), 4),
        "mean_abs_dx": round(statistics.mean(abs(r["dx"]) for r in ok), 4),
        "mean_abs_dy": round(statistics.mean(abs(r["dy"]) for r in ok), 4),
        "mean_precision": round(statistics.mean(r["precision"] for r in ok), 4),
    }

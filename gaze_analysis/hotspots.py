"""Sicak bolge tespiti (spec §8.5): AOI disindaki en yogun bakilan alanlar.

Isi haritasi yogunlugundan en yuksek %10'luk alan bulunur, mevcut AOI'lerin
icinde kalan hucreler cikarilir ve kalan bagli bilesenler yeni AOI onerisi
olarak sinirlayici kutulariyla dondurulur.
"""
import numpy as np
from scipy import ndimage

from gaze_analysis.geometry import aoi_contains


def find_hotspots(density, aois, top_percent=10, min_area_frac=0.002, buffer=0.0):
    """AOI disi sicak bolgeleri dondurur.

    density: (G, G) numpy dizi (satir=y, sutun=x), 0-1.
    aois: [{"shape","coords"}]  (mevcut AOI'ler; icleri haric tutulur)
    donus: [{"x","y","w","h","peak_density","area_cells"}, ...] (yogun -> seyrek)
    """
    g = density.shape[0]
    if density.max() <= 0:
        return []

    thr = np.percentile(density, 100 - top_percent)
    mask = (density >= thr) & (density > 0)

    # Mevcut AOI'lerin icindeki hucreleri cikar
    if aois:
        axis = (np.arange(g) + 0.5) / g
        for iy in range(g):
            y = axis[iy]
            row = mask[iy]
            if not row.any():
                continue
            for ix in np.nonzero(row)[0]:
                x = axis[ix]
                if any(aoi_contains(x, y, a, buffer=buffer) for a in aois):
                    mask[iy, ix] = False

    labels, n = ndimage.label(mask)
    if n == 0:
        return []

    min_cells = max(2, int(min_area_frac * g * g))
    spots = []
    for lbl in range(1, n + 1):
        ys, xs = np.where(labels == lbl)
        if len(xs) < min_cells:
            continue
        x0, x1 = xs.min() / g, (xs.max() + 1) / g
        y0, y1 = ys.min() / g, (ys.max() + 1) / g
        peak = float(density[ys, xs].max())
        spots.append({
            "x": round(float(x0), 4), "y": round(float(y0), 4),
            "w": round(float(x1 - x0), 4), "h": round(float(y1 - y0), 4),
            "peak_density": round(peak, 3), "area_cells": int(len(xs)),
        })
    spots.sort(key=lambda s: s["peak_density"], reverse=True)
    return spots

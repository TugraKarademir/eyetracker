"""Isi haritasi (spec §8.3): sure agirlikli Gauss cekirdek yogunlugu.

compute_density() saf numpy'dir (testlenebilir). render_overlay_png() matplotlib
ile materyal uzerine yari saydam harita bindirir.

Koordinatlar materyale gore 0-1 normalize. Cekirdek genisligi (sigma) "materyal
genisligi" biriminde; y ekseni en-boy orani (yukseklik/genislik) ile olceklenir.

Grup haritasinda her katilimcinin toplam agirligi esitlenir (spec §8.3): uzun
bakan ya da cok veri ureten katilimcilar haritaya hakim olmasin.
"""
import numpy as np


def compute_density(fixations, grid_size=120, sigma=0.04, aspect=1.0, equalize=True):
    """Fiksasyonlardan normalize (0-1) yogunluk izgarasi uretir.

    fixations: [{"x":0-1, "y":0-1, "duration":ms, "participant":id?}, ...]
    donus: shape (grid_size, grid_size) numpy dizi (satir=y, sutun=x), 0-1 olcekli.
    """
    g = grid_size
    density = np.zeros((g, g), dtype=float)
    if not fixations:
        return density

    sx = max(sigma, 1e-4)
    sy = max(sigma / aspect if aspect else sigma, 1e-4)

    # Katilimci bazli agirlik esitleme (spec §8.3)
    weights = _equalized_weights(fixations) if equalize else \
        np.array([max(f.get("duration", 1), 1) for f in fixations], dtype=float)

    axis = (np.arange(g) + 0.5) / g  # hucre merkezleri 0-1
    gx, gy = np.meshgrid(axis, axis)  # gx,gy shape (g,g)

    for f, w in zip(fixations, weights):
        if w <= 0:
            continue
        dx = gx - float(f["x"])
        dy = gy - float(f["y"])
        density += w * np.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy))

    m = density.max()
    if m > 0:
        density /= m
    return density


def _equalized_weights(fixations):
    """Her katilimcinin toplam agirligi 1 olacak sekilde normalize sure agirliklari."""
    parts = {}
    for i, f in enumerate(fixations):
        parts.setdefault(f.get("participant", "_"), []).append(i)
    weights = np.zeros(len(fixations), dtype=float)
    for idxs in parts.values():
        total = sum(max(fixations[i].get("duration", 1), 1) for i in idxs)
        if total <= 0:
            continue
        for i in idxs:
            weights[i] = max(fixations[i].get("duration", 1), 1) / total
    return weights


def render_overlay_png(density, image_path, alpha=0.55, cmap="turbo", aspect=None):
    """Yogunlugu materyal gorseli uzerine bindirip PNG bayt dizisi dondurur.

    image_path None ise (video materyal) gri zemin uzerine cizilir; oran `aspect` (h/w).
    """
    import io
    import matplotlib
    matplotlib.use("Agg")  # sunucu tarafi, ekransiz
    import matplotlib.pyplot as plt

    if image_path is None:
        r = aspect or 1.0
        img = np.full((max(1, int(round(400 * r))), 400, 3), 0.2)
    else:
        img = plt.imread(image_path)
    h, w = img.shape[0], img.shape[1]
    fig_w = 8.0
    fig_h = fig_w * (h / w)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=100)
    ax.imshow(img, extent=[0, 1, 1, 0], aspect="auto")

    # Dusuk yogunlukta saydam: alpha hucre bazli
    a = np.clip(density, 0, 1) ** 0.7
    ax.imshow(density, extent=[0, 1, 1, 0], cmap=cmap, alpha=a * alpha,
              aspect="auto", interpolation="bilinear", vmin=0, vmax=1)
    ax.set_xlim(0, 1)
    ax.set_ylim(1, 0)
    ax.axis("off")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return buf.getvalue()


def render_points_png(items, image_path, kind="points"):
    """Ham bakis noktalari veya scanpath gorseli (spec §8.3 ek gorseller)."""
    import io
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    img = plt.imread(image_path)
    h, w = img.shape[0], img.shape[1]
    fig, ax = plt.subplots(figsize=(8.0, 8.0 * (h / w)), dpi=100)
    ax.imshow(img, extent=[0, 1, 1, 0], aspect="auto")
    xs = [float(p["x"]) for p in items]
    ys = [float(p["y"]) for p in items]
    if kind == "scanpath" and xs:
        ax.plot(xs, ys, "-o", color="#e53935", markersize=6, linewidth=1.5, alpha=0.8)
        for i, (x, y) in enumerate(zip(xs, ys), 1):
            ax.annotate(str(i), (x, y), color="white", fontsize=8, ha="center", va="center")
    else:
        ax.scatter(xs, ys, s=12, c="#1e88e5", alpha=0.4, edgecolors="none")
    ax.set_xlim(0, 1)
    ax.set_ylim(1, 0)
    ax.axis("off")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return buf.getvalue()

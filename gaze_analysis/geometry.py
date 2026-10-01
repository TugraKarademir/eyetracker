"""Normalize (0-1) koordinat geometrisi: AOI icinde-mi testleri ve cakisma.

Django'dan bagimsizdir (spec §15). Hem sunucu tarafi cakisma uyarisi hem de
Faz 4 AOI isabet hesaplari bu modulu kullanir.

AOI sozlugu bicimi:
  {"shape": "rect",    "coords": {"x":.., "y":.., "w":.., "h":..}}
  {"shape": "polygon", "coords": {"points": [[x, y], ...]}}
Koordinatlar materyale gore 0-1 normalize.
"""


def point_in_rect(x, y, rect, buffer=0.0):
    rx, ry = float(rect.get("x", 0)), float(rect.get("y", 0))
    rw, rh = float(rect.get("w", 0)), float(rect.get("h", 0))
    return (rx - buffer) <= x <= (rx + rw + buffer) and (ry - buffer) <= y <= (ry + rh + buffer)


def point_in_polygon(x, y, points):
    """Isin atma (ray casting) ile nokta-cokgen testi."""
    n = len(points)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(points[i][0]), float(points[i][1])
        xj, yj = float(points[j][0]), float(points[j][1])
        intersect = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def aoi_contains(x, y, aoi, buffer=0.0):
    """Nokta AOI icinde mi? (buffer: kenarlara tampon payi, spec §8.4)."""
    shape = aoi.get("shape", "rect")
    coords = aoi.get("coords", {}) or {}
    if shape == "rect":
        return point_in_rect(x, y, coords, buffer=buffer)
    pts = coords.get("points") or []
    if buffer and pts:
        # Tampon icin basit yaklasim: cokgeni merkezden disa olceklemek yerine,
        # sinirlayici kutuyu buffer kadar genislet (yaklasik).
        x0, y0, x1, y1 = aoi_bbox(aoi)
        if not (x0 - buffer <= x <= x1 + buffer and y0 - buffer <= y <= y1 + buffer):
            return False
    return point_in_polygon(x, y, pts)


def aoi_bbox(aoi):
    """AOI'nin normalize sinirlayici kutusu (x0, y0, x1, y1)."""
    shape = aoi.get("shape", "rect")
    coords = aoi.get("coords", {}) or {}
    if shape == "rect":
        x, y = float(coords.get("x", 0)), float(coords.get("y", 0))
        w, h = float(coords.get("w", 0)), float(coords.get("h", 0))
        return (x, y, x + w, y + h)
    pts = coords.get("points") or []
    if not pts:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def bboxes_overlap(a, b):
    """Iki sinirlayici kutu (x0,y0,x1,y1) kesisiyor mu?"""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0)


def find_overlaps(aois):
    """Cakisan AOI cift indekslerini dondurur (sinirlayici kutu bazli).

    aois: [{"shape":.., "coords":..}, ...]
    donus: [(i, j), ...]  i < j
    """
    boxes = [aoi_bbox(a) for a in aois]
    pairs = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if bboxes_overlap(boxes[i], boxes[j]):
                pairs.append((i, j))
    return pairs

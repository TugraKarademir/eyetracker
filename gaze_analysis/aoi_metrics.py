"""AOI dikkat metrikleri (spec §8.4): katilimci x AOI ve grup ortalamasi.

Metrikler fiksasyonlardan hesaplanir. Bir fiksasyon birden fazla (cakisan)
AOI'ye isabet edebilir; her AOI bagimsiz degerlendirilir.
"""
from gaze_analysis.geometry import aoi_contains


def session_aoi_metrics(fixations, aois, buffer=0.0):
    """Tek bir oturum icin AOI x metrik tablosu.

    fixations: zaman sirali [{"start_t","duration","x","y",...}]
    aois: [{"id","name","shape","coords"}]
    donus: { aoi_id: {metrikler...} }, total_fixation_ms
    """
    total_fix_ms = sum(f["duration"] for f in fixations)
    results = {}
    for aoi in aois:
        member = [aoi_contains(f["x"], f["y"], aoi, buffer=buffer) for f in fixations]
        dwell = sum(f["duration"] for f, m in zip(fixations, member) if m)
        count = sum(1 for m in member if m)

        ttff = None
        for f, m in zip(fixations, member):
            if m:
                ttff = f["start_t"]
                break

        visits = 0
        prev = False
        for m in member:
            if m and not prev:
                visits += 1
            prev = m

        prop = (dwell / total_fix_ms * 100.0) if total_fix_ms > 0 else 0.0
        results[aoi["id"]] = {
            "total_dwell_ms": dwell,
            "dwell_proportion": round(prop, 1),
            "time_to_first_fixation_ms": ttff,
            "fixation_count": count,
            "visit_count": visits,
            "hit": count > 0,
        }
    return results, total_fix_ms


def group_aoi_metrics(session_metrics_list, aois):
    """Bir materyal icin grup duzeyi AOI ozeti.

    session_metrics_list: [ { aoi_id: {metrikler} }, ... ]  (her katilimci icin)
    donus: { aoi_id: {ortalama metrikler + hit_rate + n} }
    """
    n = len(session_metrics_list)
    out = {}
    for aoi in aois:
        aid = aoi["id"]
        rows = [sm[aid] for sm in session_metrics_list if aid in sm]
        if not rows:
            out[aid] = _empty_group_row(n)
            continue
        hits = [r for r in rows if r["hit"]]
        ttffs = [r["time_to_first_fixation_ms"] for r in rows
                 if r["time_to_first_fixation_ms"] is not None]
        out[aid] = {
            "n_participants": len(rows),
            "hit_rate": round(len(hits) / len(rows) * 100.0, 1),
            "mean_dwell_ms": round(_mean([r["total_dwell_ms"] for r in rows]), 1),
            "mean_dwell_proportion": round(_mean([r["dwell_proportion"] for r in rows]), 1),
            "mean_time_to_first_fixation_ms": round(_mean(ttffs), 1) if ttffs else None,
            "mean_fixation_count": round(_mean([r["fixation_count"] for r in rows]), 1),
            "mean_visit_count": round(_mean([r["visit_count"] for r in rows]), 1),
        }
    return out


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _empty_group_row(n):
    return {
        "n_participants": 0, "hit_rate": 0.0, "mean_dwell_ms": 0.0,
        "mean_dwell_proportion": 0.0, "mean_time_to_first_fixation_ms": None,
        "mean_fixation_count": 0.0, "mean_visit_count": 0.0,
    }

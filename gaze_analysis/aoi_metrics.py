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


def rq2_attention_metrics(fixations, aois):
    """RQ2 dikkat dagilimi gostergeleri (ilgili/ilgisiz AOI).

    aois: [{"id","name","shape","coords","is_relevant"}]
    Her fiksasyon etiketlenir: 'R' (herhangi ILGILI AOI icinde), yoksa 'I'
    (herhangi ILGISIZ AOI icinde), yoksa 'O' (hicbiri). Cakismada ILGILI oncelikli.

    Donus (spec RQ2 DV'leri):
      relevant_dwell_ms, irrelevant_dwell_ms,
      relevant_dwell_ratio (%), irrelevant_dwell_ratio (%),
      time_to_first_relevant_ms, transition_ratio, n_fixations
    """
    rel = [a for a in aois if a.get("is_relevant")]
    irr = [a for a in aois if not a.get("is_relevant")]

    labels = []
    for f in fixations:
        if any(aoi_contains(f["x"], f["y"], a) for a in rel):
            labels.append("R")
        elif any(aoi_contains(f["x"], f["y"], a) for a in irr):
            labels.append("I")
        else:
            labels.append("O")

    total_ms = sum(f["duration"] for f in fixations)
    rel_ms = sum(f["duration"] for f, l in zip(fixations, labels) if l == "R")
    irr_ms = sum(f["duration"] for f, l in zip(fixations, labels) if l == "I")

    ttf_rel = None
    for f, l in zip(fixations, labels):
        if l == "R":
            ttf_rel = f["start_t"]
            break

    # Gecis orani: yalniz R/I etiketli fiksasyon dizisinde, ardisik ciftlerin
    # relevans degistirme (R<->I) orani.
    seq = [l for l in labels if l in ("R", "I")]
    pairs = len(seq) - 1
    switches = sum(1 for i in range(pairs) if seq[i] != seq[i + 1]) if pairs > 0 else 0
    transition_ratio = round(switches / pairs, 3) if pairs > 0 else None

    return {
        "n_fixations": len(fixations),
        "relevant_dwell_ms": rel_ms,
        "irrelevant_dwell_ms": irr_ms,
        "relevant_dwell_ratio": round(rel_ms / total_ms * 100, 1) if total_ms else 0.0,
        "irrelevant_dwell_ratio": round(irr_ms / total_ms * 100, 1) if total_ms else 0.0,
        "time_to_first_relevant_ms": ttf_rel,
        "transition_ratio": transition_ratio,
    }

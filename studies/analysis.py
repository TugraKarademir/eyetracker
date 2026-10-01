"""Django adaptoru: DB'den veri cekip gaze_analysis ile analiz eder (spec §8).

Algoritmalar gaze_analysis/ icinde (Django'suz); burasi yalnizca modelden veri
toplar, sonuclari derler ve Excel/CSV uretir.
"""
import csv
import io

from django.utils import timezone

from gaze_analysis import excel
from gaze_analysis.aoi_metrics import group_aoi_metrics, session_aoi_metrics
from gaze_analysis.config import ANALYSIS_VERSION, AnalysisConfig
from gaze_analysis.fixation import detect_fixations
from gaze_analysis.geometry import aoi_contains
from gaze_analysis.preprocessing import actual_sampling_hz, preprocess

from .models import GazeSample, Session


def _material_aois(material):
    return [
        {"id": a.id, "name": a.name, "shape": a.shape, "coords": a.coords}
        for a in material.aois.all()
    ]


def run_study_analysis(study, config=None):
    """Bir calisma icin tum analizi calistirir ve sonuc sozlugu dondurur."""
    config = config or AnalysisConfig.from_dict(study.settings)

    materials = list(study.materials.all())
    mat_info = {}
    for m in materials:
        w = m.natural_width or 1
        h = m.natural_height or 1
        mat_info[m.id] = {
            "order": m.order,
            "width": w,
            "height": h,
            "aspect": (h / w) if w else 1.0,
            "aois": _material_aois(m),
        }

    sessions = list(study.sessions.all())

    result = {
        "study": {
            "name": study.name,
            "code": study.participation_code,
            "version": ANALYSIS_VERSION,
            "generated_at": timezone.now().strftime("%Y-%m-%d %H:%M"),
        },
        "config": config.to_dict(),
        "sessions": [],
        "materials": [{"id": m.id, **{k: mat_info[m.id][k] for k in ("order", "width", "height", "aspect")}} for m in materials],
        "raw_samples": [],
        "fixations": [],
        "aoi_metrics": [],
        "aoi_summary": [],
    }

    # material_id -> [session_aoi_metrics dict] (grup icin)
    per_material_session_metrics = {m.id: [] for m in materials}

    for sess in sessions:
        all_samples = list(
            GazeSample.objects.filter(session=sess)
            .values("material_id", "t", "x_px", "y_px", "x_norm", "y_norm", "in_material")
            .order_by("material_id", "t")
        )
        # materyale gore grupla
        by_mat = {}
        for s in all_samples:
            by_mat.setdefault(s["material_id"], []).append(s)

        total_n = len(all_samples)
        total_out = sum(1 for s in all_samples if not s["in_material"])
        missing_ratio = round(total_out / total_n, 3) if total_n else None

        # Kalibrasyon/dogrulama (son deneme)
        calib = sess.calibrations.order_by("-attempt_no").first()

        # ornekleme hizi (tum ornekler t'ye gore)
        hz_list = [{"t": s["t"]} for s in sorted(all_samples, key=lambda s: s["t"])]
        hz = actual_sampling_hz(hz_list)

        result["sessions"].append({
            "id": sess.id,
            "participant_code": sess.participant_code,
            "status": sess.get_status_display(),
            "started_at": _fmt(sess.started_at),
            "finished_at": _fmt(sess.finished_at),
            "validation_error_px": calib.avg_error_px if calib else None,
            "validation_passed": calib.passed if calib else None,
            "sampling_hz": hz,
            "sample_count": total_n,
            "missing_ratio": missing_ratio,
            "exclusion_reason": "",  # Faz 6'da kalite kurallari
        })

        for mid, samples in by_mat.items():
            if mid not in mat_info:
                continue
            info = mat_info[mid]
            aois = info["aois"]

            # Ham veri satirlari
            for s in samples:
                result["raw_samples"].append({
                    "session_id": sess.id, "participant_code": sess.participant_code,
                    "material_order": info["order"], "material_id": mid,
                    "t": s["t"], "x_px": s["x_px"], "y_px": s["y_px"],
                    "x_norm": s["x_norm"], "y_norm": s["y_norm"], "in_material": s["in_material"],
                })

            # On isleme + fiksasyon
            pre = preprocess(
                [{"t": s["t"], "x": s["x_norm"], "y": s["y_norm"], "in_material": s["in_material"]}
                 for s in samples],
                config,
            )
            fixations = detect_fixations(pre, config, aspect=info["aspect"])

            for f in fixations:
                hit_names = [a["name"] for a in aois
                             if aoi_contains(f["x"], f["y"], a, buffer=config.aoi_buffer)]
                result["fixations"].append({
                    "session_id": sess.id, "participant_code": sess.participant_code,
                    "material_order": info["order"], "material_id": mid,
                    "start_t": f["start_t"], "end_t": f["end_t"], "duration": f["duration"],
                    "x": f["x"], "y": f["y"], "n_samples": f["n_samples"],
                    "aoi_names": hit_names,
                })

            # AOI metrikleri (katilimci x AOI)
            if aois:
                sm, _total = session_aoi_metrics(fixations, aois, buffer=config.aoi_buffer)
                per_material_session_metrics[mid].append(sm)
                aoi_name = {a["id"]: a["name"] for a in aois}
                for aid, mrow in sm.items():
                    result["aoi_metrics"].append({
                        "session_id": sess.id, "participant_code": sess.participant_code,
                        "material_order": info["order"], "aoi_id": aid,
                        "aoi_name": aoi_name[aid], **mrow,
                    })

    # Grup ozeti (materyal x AOI)
    for m in materials:
        info = mat_info[m.id]
        aois = info["aois"]
        if not aois:
            continue
        g = group_aoi_metrics(per_material_session_metrics[m.id], aois)
        aoi_name = {a["id"]: a["name"] for a in aois}
        for aid, grow in g.items():
            result["aoi_summary"].append({
                "material_order": info["order"], "aoi_id": aid,
                "aoi_name": aoi_name[aid], **grow,
            })

    return result


def build_excel_bytes(study, config=None):
    """Calisma analizini Excel (xlsx) bayt dizisi olarak dondurur."""
    result = run_study_analysis(study, config)
    wb = excel.build_workbook(result)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), result


def build_aoi_metrics_csv(result):
    """AOI metriklerini uzun formatli CSV olarak dondurur (R/SPSS, spec §9)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["oturum_id", "katilimci_kodu", "materyal_sira", "aoi",
                "toplam_bakma_ms", "bakma_orani", "ilk_fiksasyon_ms",
                "fiksasyon_sayisi", "ziyaret_sayisi", "isabet"])
    for m in result.get("aoi_metrics", []):
        w.writerow([m["session_id"], m["participant_code"], m["material_order"],
                    m["aoi_name"], m["total_dwell_ms"], m["dwell_proportion"],
                    m["time_to_first_fixation_ms"], m["fixation_count"],
                    m["visit_count"], int(m["hit"])])
    return buf.getvalue()


def _fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M") if dt else None

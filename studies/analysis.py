"""Django adaptoru: DB'den veri cekip gaze_analysis ile analiz eder (spec §8).

Algoritmalar gaze_analysis/ icinde (Django'suz); burasi yalnizca modelden veri
toplar, sonuclari derler ve Excel/CSV uretir.
"""
import csv
import io

from django.utils import timezone

from gaze_analysis import excel
from gaze_analysis.aoi_metrics import group_aoi_metrics, rq2_attention_metrics, session_aoi_metrics
from gaze_analysis.config import ANALYSIS_VERSION, AnalysisConfig
from gaze_analysis.fixation import detect_fixations
from gaze_analysis.geometry import aoi_contains
from gaze_analysis.preprocessing import actual_sampling_hz, preprocess
from gaze_analysis.quality import material_quality, session_quality

from .models import GazeSample, Session


def _material_aois(material):
    return [
        {"id": a.id, "name": a.name, "shape": a.shape, "coords": a.coords,
         "is_relevant": a.is_relevant}
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
            "kind": m.kind,
            "source": m.source,
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
        "rq2": [],   # RQ2: katilimci x materyal dikkat dagilimi (uzun format)
    }

    # material_id -> [session_aoi_metrics dict] (grup icin)
    per_material_session_metrics = {m.id: [] for m in materials}

    for sess in sessions:
        all_samples = list(
            GazeSample.objects.filter(session=sess)
            .values("material_id", "t", "x_px", "y_px", "x_norm", "y_norm", "in_material")
            .order_by("material_id", "t")
        )
        by_mat = {}
        for s in all_samples:
            by_mat.setdefault(s["material_id"], []).append(s)

        total_n = len(all_samples)
        total_out = sum(1 for s in all_samples if not s["in_material"])
        missing_ratio = round(total_out / total_n, 3) if total_n else None

        calib = sess.calibrations.order_by("-attempt_no").first()
        hz_list = [{"t": s["t"]} for s in sorted(all_samples, key=lambda s: s["t"])]
        hz = actual_sampling_hz(hz_list)

        # 1) Materyal bazli isleme + kalite (spec §7)
        material_results = []
        material_flags = []  # her denenen materyal gecerli mi (dislanmadi mi)
        for mid, samples in by_mat.items():
            if mid not in mat_info:
                continue
            info = mat_info[mid]
            aois = info["aois"]

            for s in samples:  # ham veri her zaman saklanir (silinmez)
                result["raw_samples"].append({
                    "session_id": sess.id, "participant_code": sess.participant_code,
                    "material_order": info["order"], "material_id": mid,
                    "t": s["t"], "x_px": s["x_px"], "y_px": s["y_px"],
                    "x_norm": s["x_norm"], "y_norm": s["y_norm"], "in_material": s["in_material"],
                })

            out_c = sum(1 for s in samples if not s["in_material"])
            mq = material_quality(len(samples), out_c, config)
            material_flags.append(not mq["excluded"])

            pre = preprocess(
                [{"t": s["t"], "x": s["x_norm"], "y": s["y_norm"], "in_material": s["in_material"]}
                 for s in samples],
                config,
            )
            fixations = detect_fixations(pre, config, aspect=info["aspect"])
            sm = None
            if aois:
                sm, _ = session_aoi_metrics(fixations, aois, buffer=config.aoi_buffer)
            material_results.append(
                {"mid": mid, "info": info, "aois": aois, "fixations": fixations, "sm": sm, "mq": mq}
            )

        # 2) Oturum kalitesi (spec §7)
        sq = session_quality(
            calib.avg_error_px if calib else None, sess.viewport_width, material_flags, config
        )
        sess_excluded = sq["excluded"]

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
            "valid_material_ratio": sq["valid_material_ratio"],
            "excluded": sess_excluded,
            "exclusion_reason": "; ".join(sq["reasons"]),
        })

        # 3) Fiksasyon + metrik satirlari; grup yalnizca dislanmayan veriyle
        for mr in material_results:
            info, mid, aois = mr["info"], mr["mid"], mr["aois"]
            excl = sess_excluded or mr["mq"]["excluded"]
            for f in mr["fixations"]:
                hit_names = [a["name"] for a in aois
                             if aoi_contains(f["x"], f["y"], a, buffer=config.aoi_buffer)]
                result["fixations"].append({
                    "session_id": sess.id, "participant_code": sess.participant_code,
                    "material_order": info["order"], "material_id": mid,
                    "start_t": f["start_t"], "end_t": f["end_t"], "duration": f["duration"],
                    "x": f["x"], "y": f["y"], "n_samples": f["n_samples"],
                    "aoi_names": hit_names, "excluded": excl,
                })
            if aois and mr["sm"] is not None:
                aoi_name = {a["id"]: a["name"] for a in aois}
                for aid, mrow in mr["sm"].items():
                    result["aoi_metrics"].append({
                        "session_id": sess.id, "participant_code": sess.participant_code,
                        "material_order": info["order"], "aoi_id": aid,
                        "aoi_name": aoi_name[aid], "excluded": excl, **mrow,
                    })
                if not excl:  # grup ozetine yalnizca dislanmayan veri girer
                    per_material_session_metrics[mid].append(mr["sm"])

            # RQ2: katilimci x materyal dikkat dagilimi (ilgili/ilgisiz, gecis)
            if aois:
                rq2 = rq2_attention_metrics(mr["fixations"], aois)
                result["rq2"].append({
                    "session_id": sess.id, "participant_code": sess.participant_code,
                    "material_order": info["order"], "material_id": mid,
                    "kind": info.get("kind"), "source": info.get("source"),
                    "excluded": excl, **rq2,
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


# --- Faz 5: rapor (isi haritasi + sicak bolge + siralama) -------------------
def build_study_report(study, config=None):
    """Rapor ekrani icin isi haritasi, sicak bolge ve AOI siralamasi derler.

    Her materyal icin grup isi haritasi PNG'si base64 data-URI olarak gomulur.
    """
    import base64

    from gaze_analysis import report as report_mod
    from gaze_analysis.heatmap import compute_density, render_overlay_png
    from gaze_analysis.hotspots import find_hotspots

    config = config or AnalysisConfig.from_dict(study.settings)
    result = run_study_analysis(study, config)

    # fiksasyonlari materyale gore grupla (dislanan oturum/materyal haric; spec §7)
    fix_by_mat = {}
    for f in result["fixations"]:
        if f.get("excluded"):
            continue
        fix_by_mat.setdefault(f["material_id"], []).append(f)

    summary_by_order = {}
    for g in result["aoi_summary"]:
        summary_by_order.setdefault(g["material_order"], []).append(g)

    materials_ctx = []
    for m in study.materials.all():
        w = m.natural_width or 1
        h = m.natural_height or 1
        aspect = (h / w) if w else 1.0
        aois = _material_aois(m)

        fixations = [
            {"x": f["x"], "y": f["y"], "duration": f["duration"], "participant": f["session_id"]}
            for f in fix_by_mat.get(m.id, [])
        ]
        n_sessions = len({f["session_id"] for f in fix_by_mat.get(m.id, [])})

        heatmap_uri = None
        hotspots = []
        if fixations:
            density = compute_density(
                fixations, sigma=config.heatmap_sigma, aspect=aspect, equalize=True
            )
            try:
                png = render_overlay_png(density, m.image.path)
                heatmap_uri = "data:image/png;base64," + base64.b64encode(png).decode()
            except Exception as e:  # gorsel okunamazsa harita atlanir
                heatmap_uri = None
            hotspots = find_hotspots(density, aois, top_percent=10, buffer=config.aoi_buffer)

        ranking = report_mod.rank_aois(summary_by_order.get(m.order, []))

        materials_ctx.append({
            "id": m.id, "order": m.order, "src": m.image.url,
            "n_sessions": n_sessions, "n_fixations": len(fixations),
            "heatmap_uri": heatmap_uri, "hotspots": hotspots,
            "ranking": ranking, "aois": aois,
        })

    return {
        "study": result["study"],
        "limitation_note": report_mod.LIMITATION_NOTE,
        "materials": materials_ctx,
        "n_sessions": len(result["sessions"]),
        "sessions": result["sessions"],  # kalite raporu (spec §7)
        "feasibility": build_feasibility(study),  # RQ1 fizibilite (motor bazinda)
    }


def build_rq2_csv(result):
    """RQ2 dikkat dagilimi gostergelerini uzun formatli CSV olarak dondurur.

    Bir satir = katilimci x materyal. Istatistik (ANOVA/korelasyon) icin hazir:
    faktorler (kind, source) + DV'ler (ilgili/ilgisiz dwell, ilk ilgili, gecis).
    """
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "oturum_id", "katilimci_kodu", "materyal_sira", "materyal_id",
        "tur", "kaynak", "analize_dahil",
        "ilgili_dwell_ms", "ilgisiz_dwell_ms",
        "ilgili_dwell_orani", "ilgisiz_dwell_orani",
        "ilk_ilgili_fiksasyon_ms", "gecis_orani", "fiksasyon_sayisi",
    ])
    for r in result.get("rq2", []):
        w.writerow([
            r["session_id"], r["participant_code"], r["material_order"], r["material_id"],
            r.get("kind"), r.get("source"), int(not r.get("excluded")),
            r["relevant_dwell_ms"], r["irrelevant_dwell_ms"],
            r["relevant_dwell_ratio"], r["irrelevant_dwell_ratio"],
            r["time_to_first_relevant_ms"], r["transition_ratio"], r["n_fixations"],
        ])
    return buf.getvalue()


def build_rq3_csv(study, result):
    """RQ3: dikkat gostergeleri + Leppink alt olcekleri (oturum x materyal).

    Dikkat DV'leri (RQ2) ile bilissel yuk alt olcekleri tek satirda birlestirilir;
    dissal yuk (extraneous) ile korelasyon dogrudan yapilabilir.
    """
    from .models import CognitiveLoadResponse
    load = {}
    for c in CognitiveLoadResponse.objects.filter(session__study=study):
        load[(c.session_id, c.material_id)] = c.subscales()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "oturum_id", "katilimci_kodu", "materyal_sira", "materyal_id", "tur", "kaynak",
        "ilgili_dwell_ms", "ilgisiz_dwell_ms", "ilgili_dwell_orani",
        "ilk_ilgili_fiksasyon_ms", "gecis_orani",
        "yuk_dissal", "yuk_icsel", "yuk_germane",
    ])
    for r in result.get("rq2", []):
        sub = load.get((r["session_id"], r["material_id"]), {})
        w.writerow([
            r["session_id"], r["participant_code"], r["material_order"], r["material_id"],
            r.get("kind"), r.get("source"),
            r["relevant_dwell_ms"], r["irrelevant_dwell_ms"], r["relevant_dwell_ratio"],
            r["time_to_first_relevant_ms"], r["transition_ratio"],
            sub.get("extraneous"), sub.get("intrinsic"), sub.get("germane"),
        ])
    return buf.getvalue()


def build_feasibility(study):
    """RQ1 fizibilite ozeti: motor bazinda (webgazer/mediapipe) sistem metrikleri.

    Metrikler (katilimci orneklemi uzerinde oran/ortalama):
      - kalibrasyon_tamamlama: dogrulama (CalibrationResult) olusan oturum orani
      - dogrulama_gecme: esigi gecen oturum orani
      - ort_dogrulama_px / %: ortalama dogrulama hatasi
      - oturum_tamamlama: status=completed orani
      - gecerli_veri: ortalama (materyal-ici ornek / toplam ornek)
      - ort_kadran_dogruluk: bilinen-hedef kadran dogrulugu (varsa; client_meta)
    """
    from .models import CalibrationResult, GazeSample

    rows = {}
    for sess in study.sessions.all():
        eng = (sess.client_meta or {}).get("gaze_engine") or "webgazer"
        r = rows.setdefault(eng, {
            "engine": eng, "n": 0, "n_calib": 0, "n_pass": 0, "n_completed": 0,
            "val_px": [], "valid_rate": [], "quad": [],
        })
        r["n"] += 1
        calib = CalibrationResult.objects.filter(session=sess).order_by("attempt_no").first()
        if calib:
            r["n_calib"] += 1
            if calib.passed:
                r["n_pass"] += 1
            if calib.avg_error_px is not None and sess.viewport_width:
                r["val_px"].append((calib.avg_error_px, sess.viewport_width))
        if sess.status == sess.Status.COMPLETED:
            r["n_completed"] += 1
        total = GazeSample.objects.filter(session=sess).count()
        if total:
            inm = GazeSample.objects.filter(session=sess, in_material=True).count()
            r["valid_rate"].append(inm / total)
        q = (sess.client_meta or {}).get("quadrant_accuracy")
        if isinstance(q, (int, float)):
            r["quad"].append(q)

    out = []
    for eng, r in rows.items():
        n = r["n"] or 1
        mean_px = round(sum(p for p, _ in r["val_px"]) / len(r["val_px"]), 1) if r["val_px"] else None
        mean_pct = round(sum(100 * p / w for p, w in r["val_px"]) / len(r["val_px"]), 1) if r["val_px"] else None
        out.append({
            "engine": eng,
            "n_sessions": r["n"],
            "calib_completion_rate": round(r["n_calib"] / n * 100, 1),
            "validation_pass_rate": round(r["n_pass"] / n * 100, 1),
            "mean_validation_px": mean_px,
            "mean_validation_pct": mean_pct,
            "session_completion_rate": round(r["n_completed"] / n * 100, 1),
            "mean_valid_data_rate": round(sum(r["valid_rate"]) / len(r["valid_rate"]) * 100, 1) if r["valid_rate"] else None,
            "mean_quadrant_accuracy": round(sum(r["quad"]) / len(r["quad"]) * 100, 1) if r["quad"] else None,
        })
    out.sort(key=lambda x: x["engine"])
    return out


def build_feasibility_csv(study):
    rows = build_feasibility(study)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["motor", "oturum_sayisi", "kalibrasyon_tamamlama_%", "dogrulama_gecme_%",
                "ort_dogrulama_px", "ort_dogrulama_%", "oturum_tamamlama_%",
                "ort_gecerli_veri_%", "ort_kadran_dogruluk_%"])
    for r in rows:
        w.writerow([r["engine"], r["n_sessions"], r["calib_completion_rate"],
                    r["validation_pass_rate"], r["mean_validation_px"], r["mean_validation_pct"],
                    r["session_completion_rate"], r["mean_valid_data_rate"], r["mean_quadrant_accuracy"]])
    return buf.getvalue()

"""Faz 2 veri kayit API'si (sade Django JSON, DRF'siz).

Katilimci sayfasi (ayni origin) bu uclara CSRF token'i ile POST eder.
Akis: baslat -> (materyaller) -> veri (toplu) -> bitir.
"""
import json

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import CalibrationResult, GazeSample, Material, Session, Study

# Tek istekte kabul edilen azami ornek sayisi (kotuye kullanim/kazara devasa
# yukleme koruma). 5 Hz'de uzun bir oturum bile bunun cok altinda kalir.
MAX_SAMPLES_PER_REQUEST = 500_000


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


@require_POST
def session_start(request):
    """study_code ile yeni bir oturum olusturur, session_id doner."""
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Gecersiz JSON"}, status=400)

    code = (data.get("study_code") or "").strip()
    try:
        study = Study.objects.get(participation_code=code)
    except Study.DoesNotExist:
        return JsonResponse({"error": "Calisma bulunamadi"}, status=404)
    if not study.is_open:
        return JsonResponse({"error": "Calisma aktif degil"}, status=403)

    device = data.get("device") or {}
    session = Session.objects.create(
        study=study,
        participant_code=(data.get("participant_code") or "").strip()[:32] or _anon_code(),
        user_agent=str(device.get("user_agent") or "")[:2000],
        screen_width=_as_int(device.get("screen_width")),
        screen_height=_as_int(device.get("screen_height")),
        viewport_width=_as_int(device.get("viewport_width")),
        viewport_height=_as_int(device.get("viewport_height")),
        device_pixel_ratio=_as_float(device.get("device_pixel_ratio")),
        status=Session.Status.IN_PROGRESS,
    )
    return JsonResponse({"session_id": session.id, "participant_code": session.participant_code})


@require_POST
def session_data(request, session_id):
    """Oturumun kalibrasyon sonuclarini ve bakis orneklerini toplu kaydeder."""
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Gecersiz JSON"}, status=400)

    try:
        session = Session.objects.select_related("study").get(pk=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Oturum bulunamadi"}, status=404)
    if session.status != Session.Status.IN_PROGRESS:
        return JsonResponse({"error": "Oturum artik veri kabul etmiyor"}, status=409)

    samples_in = data.get("samples") or []
    if len(samples_in) > MAX_SAMPLES_PER_REQUEST:
        return JsonResponse({"error": "Cok fazla ornek"}, status=413)

    # Bu calismaya ait gecerli materyal id'leri
    valid_material_ids = set(
        Material.objects.filter(study=session.study).values_list("id", flat=True)
    )

    calib_objs = []
    for c in (data.get("calibrations") or []):
        calib_objs.append(
            CalibrationResult(
                session=session,
                attempt_no=_as_int(c.get("attempt_no")) or 1,
                avg_error_px=_as_float(c.get("avg_error_px")),
                avg_error_norm=_as_float(c.get("avg_error_norm")),
                precision=_as_float(c.get("precision")),
                passed=bool(c.get("passed")),
            )
        )

    sample_objs = []
    skipped = 0
    for s in samples_in:
        mid = _as_int(s.get("material_id"))
        if mid not in valid_material_ids:
            skipped += 1
            continue
        sample_objs.append(
            GazeSample(
                session=session,
                material_id=mid,
                t=_as_int(s.get("t")) or 0,
                x_px=_as_int(s.get("x_px")) or 0,
                y_px=_as_int(s.get("y_px")) or 0,
                x_norm=_as_float(s.get("x_norm")),
                y_norm=_as_float(s.get("y_norm")),
                in_material=bool(s.get("in_material")),
            )
        )

    # Istemci tanisi (gaze motoru, ensemble agirliklari, surum) — varsa sakla
    meta = data.get("meta")
    with transaction.atomic():
        if calib_objs:
            CalibrationResult.objects.bulk_create(calib_objs)
        if sample_objs:
            GazeSample.objects.bulk_create(sample_objs, batch_size=2000)
        if isinstance(meta, dict):
            cur = session.client_meta or {}
            cur.update(meta)
            session.client_meta = cur
            session.save(update_fields=["client_meta"])

    return JsonResponse(
        {"saved_samples": len(sample_objs), "saved_calibrations": len(calib_objs), "skipped": skipped}
    )


@require_POST
def session_finish(request, session_id):
    """Oturumu tamamlandi/dusuk kalite/yarim olarak isaretler."""
    data = _json_body(request) or {}
    try:
        session = Session.objects.get(pk=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Oturum bulunamadi"}, status=404)

    status = data.get("status")
    valid = {
        Session.Status.COMPLETED,
        Session.Status.LOW_QUALITY,
        Session.Status.ABANDONED,
    }
    session.status = status if status in valid else Session.Status.COMPLETED
    session.finished_at = timezone.now()
    session.save(update_fields=["status", "finished_at"])
    return JsonResponse({"ok": True, "status": session.status})


# --- yardimcilar -----------------------------------------------------------
def _as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _anon_code():
    import secrets
    return "k-" + secrets.token_hex(4)


# --- AOI (Faz 3) -----------------------------------------------------------
from django.contrib.auth.decorators import login_required  # noqa: E402

from gaze_analysis.geometry import find_overlaps  # noqa: E402

from .models import AOI  # noqa: E402

VALID_SHAPES = {"rect", "polygon"}


def _aoi_to_dict(a):
    return {"id": a.id, "name": a.name, "shape": a.shape, "coords": a.coords, "color": a.color}


def _overlap_warnings(aoi_dicts):
    pairs = find_overlaps(aoi_dicts)
    warnings = []
    for i, j in pairs:
        warnings.append(
            f"'{aoi_dicts[i].get('name') or i}' ve '{aoi_dicts[j].get('name') or j}' AOI'leri cakisiyor."
        )
    return warnings


def _owns_material(user, material):
    return material.study.teacher_id == user.id or user.is_superuser


@login_required
@require_POST
def aoi_save(request, material_id):
    """Bir materyalin TUM AOI'lerini gelen listeyle degistirir (login gerekli)."""
    try:
        material = Material.objects.select_related("study").get(pk=material_id)
    except Material.DoesNotExist:
        return JsonResponse({"error": "Materyal bulunamadi"}, status=404)
    if not _owns_material(request.user, material):
        return JsonResponse({"error": "Yetki yok"}, status=403)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Gecersiz JSON"}, status=400)

    incoming = data.get("aois") or []
    cleaned = []
    for a in incoming:
        shape = a.get("shape")
        if shape not in VALID_SHAPES:
            continue
        cleaned.append({
            "name": (a.get("name") or "AOI").strip()[:100],
            "shape": shape,
            "coords": a.get("coords") or {},
            "color": (a.get("color") or "#e53935")[:9],
        })

    with transaction.atomic():
        material.aois.all().delete()
        AOI.objects.bulk_create([
            AOI(material=material, name=c["name"], shape=c["shape"],
                coords=c["coords"], color=c["color"])
            for c in cleaned
        ])

    warnings = _overlap_warnings(cleaned)
    return JsonResponse({"saved": len(cleaned), "warnings": warnings})

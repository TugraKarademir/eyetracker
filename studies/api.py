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


def _clean_alt(alt):
    """Iki kamera alternatif tahminleri: yalniz bilinen anahtarlar ve [x, y] sayilar."""
    if not isinstance(alt, dict):
        return None
    out = {}
    for k in ("a", "b", "late", "early"):
        v = alt.get(k)
        if isinstance(v, (list, tuple)) and len(v) == 2:
            x, y = _as_float(v[0]), _as_float(v[1])
            out[k] = [x, y] if x is not None and y is not None else None
        else:
            out[k] = None
    return out


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
                alt=_clean_alt(s.get("alt")),
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
            "is_relevant": a.get("is_relevant", True) is not False,
        })

    # Video materyalde ozgun boyut yuklemede bilinmez; editor videodan okuyup gonderir
    if not material.natural_width or not material.natural_height:
        try:
            nw, nh = int(data.get("natural_width") or 0), int(data.get("natural_height") or 0)
        except (TypeError, ValueError):
            nw = nh = 0
        if nw > 0 and nh > 0:
            material.natural_width, material.natural_height = nw, nh
            material.save(update_fields=["natural_width", "natural_height"])

    with transaction.atomic():
        material.aois.all().delete()
        AOI.objects.bulk_create([
            AOI(material=material, name=c["name"], shape=c["shape"],
                coords=c["coords"], color=c["color"], is_relevant=c["is_relevant"])
            for c in cleaned
        ])

    warnings = _overlap_warnings(cleaned)
    return JsonResponse({"saved": len(cleaned), "warnings": warnings})


# --- Bilissel yuk (Leppink, RQ3) -------------------------------------------
from .models import CognitiveLoadResponse  # noqa: E402

# Leppink olcegi maddeleri (TR) — 1-3 icsel, 4-6 dissal, 7-10 germane
LEPPINK_ITEMS = [
    "Etkinlikte islenen konu/konular cok karmasikti",
    "Etkinlik, cok karmasik olarak algiladigim formulleri kapsiyordu",
    "Etkinlik, cok karmasik olarak algiladigim kavram ve tanimlari kapsiyordu",
    "Etkinlik sirasinda verilen talimatlar ve/veya aciklamalar cok net degildi",
    "Talimatlar ve/veya aciklamalar ogrenme acisindan cok etkisizdi",
    "Talimatlar ve/veya aciklamalar belirsiz bir dille doluydu",
    "Etkinlik, islenen konu(lar) hakkindaki anlayisimi gercekten gelistirdi",
    "Etkinlik, istatistik bilgimi ve anlayisimi gercekten gelistirdi",
    "Etkinlik, kapsanan formulleri anlamami gercekten gelistirdi",
    "Etkinlik, kavramlari ve tanimlari anlamami gercekten gelistirdi",
]


@require_POST
def cognitive_load(request, session_id):
    """Bir oturum x materyal icin Leppink yanitini kaydeder (10 madde, 0-10)."""
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "Gecersiz JSON"}, status=400)
    try:
        session = Session.objects.select_related("study").get(pk=session_id)
    except Session.DoesNotExist:
        return JsonResponse({"error": "Oturum bulunamadi"}, status=404)

    mid = _as_int(data.get("material_id"))
    if not Material.objects.filter(pk=mid, study=session.study).exists():
        return JsonResponse({"error": "Materyal bu calismada degil"}, status=400)

    scores = data.get("scores")
    if not isinstance(scores, list) or len(scores) != 10:
        return JsonResponse({"error": "10 madde puani gerekli"}, status=400)
    clean = []
    for v in scores:
        iv = _as_int(v)
        clean.append(min(10, max(0, iv)) if iv is not None else None)

    CognitiveLoadResponse.objects.update_or_create(
        session=session, material_id=mid, defaults={"scores": clean}
    )
    return JsonResponse({"ok": True})

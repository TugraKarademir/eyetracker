from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.text import slugify

from .models import AOI, Material, Study


def _require_owner(request, study):
    return study.teacher_id == request.user.id or request.user.is_superuser


@login_required
def dashboard(request):
    """Ogretmenin calismalarini ve materyallerini listeler (AOI editorune baglar)."""
    studies = (
        Study.objects.filter(teacher=request.user)
        .prefetch_related("materials", "sessions")
        if not request.user.is_superuser
        else Study.objects.all().prefetch_related("materials", "sessions")
    )
    return render(request, "studies/dashboard.html", {"studies": studies})


@login_required
def aoi_editor(request, material_id):
    """Bir materyal uzerinde AOI cizme araci (HTML Canvas)."""
    material = get_object_or_404(Material.objects.select_related("study"), pk=material_id)
    if material.study.teacher_id != request.user.id and not request.user.is_superuser:
        return redirect("studies:dashboard")

    aois = [
        {"id": a.id, "name": a.name, "shape": a.shape, "coords": a.coords, "color": a.color}
        for a in material.aois.all()
    ]
    context = {
        "material": {
            "id": material.id,
            "src": material.image.url,
            "natural_width": material.natural_width,
            "natural_height": material.natural_height,
            "study_name": material.study.name,
            "order": material.order,
        },
        "aois_json": aois,
        "save_url": reverse("studies:aoi_save", args=[material.id]),
        "dashboard_url": reverse("studies:dashboard"),
    }
    return render(request, "studies/aoi_editor.html", context)


@login_required
def study_excel(request, study_id):
    """Calisma analizini Excel (xlsx) olarak indirir (Faz 4)."""
    from .analysis import build_excel_bytes
    study = get_object_or_404(Study, pk=study_id)
    if not _require_owner(request, study):
        return redirect("studies:dashboard")
    data, _result = build_excel_bytes(study)
    resp = HttpResponse(
        data, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    fname = f"goz_izleme_{slugify(study.name) or study.id}.xlsx"
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp


@login_required
def study_csv(request, study_id):
    """AOI metriklerini uzun formatli CSV olarak indirir (R/SPSS, spec §9)."""
    from .analysis import build_aoi_metrics_csv, run_study_analysis
    study = get_object_or_404(Study, pk=study_id)
    if not _require_owner(request, study):
        return redirect("studies:dashboard")
    result = run_study_analysis(study)
    csv_text = build_aoi_metrics_csv(result)
    resp = HttpResponse(csv_text, content_type="text/csv; charset=utf-8")
    fname = f"aoi_metrikleri_{slugify(study.name) or study.id}.csv"
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp

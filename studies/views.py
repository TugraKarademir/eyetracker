from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse

from .models import AOI, Material, Study


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

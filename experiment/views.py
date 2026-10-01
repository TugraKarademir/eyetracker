from pathlib import Path

from django.shortcuts import get_object_or_404, render
from django.templatetags.static import static
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie

from studies.models import Study

_JS_DIR = Path(__file__).resolve().parent / "static" / "experiment" / "js"


def _asset_version(filename):
    """Bir statik JS dosyasinin mtime'ini cache-busting icin dondurur.

    Tarayici eski JS'i onbellekten sunmasin diye script URL'sine ?v=<mtime>
    eklenir; dosya her degistiginde deger degisir ve onbellek atlanir.
    """
    try:
        return str(int((_JS_DIR / filename).stat().st_mtime))
    except OSError:
        return "0"


@never_cache
def run_experiment(request):
    """Faz 1 katilimci prototipi: tek materyal, sunucuya kayit YOK, JSON indir."""
    context = {
        "asset_version": _asset_version("experiment.js"),
        "material": {
            "src": static("experiment/materials/ornek_materyal.png"),
            "name": "ornek_materyal",
            "natural_width": 1200,
            "natural_height": 800,
        },
    }
    return render(request, "experiment/run.html", context)


@never_cache
@ensure_csrf_cookie
def run_study(request, code):
    """Faz 2: katilim koduyla cok-materyalli calisma; veri sunucuya kaydedilir."""
    study = get_object_or_404(Study, participation_code=code)
    materials = [
        {
            "id": m.id,
            "order": m.order,
            "src": m.image.url,
            "natural_width": m.natural_width,
            "natural_height": m.natural_height,
        }
        for m in study.materials.all()
    ]
    context = {
        "asset_version": _asset_version("study.js"),
        "study": {
            "code": study.participation_code,
            "name": study.name,
            "is_open": study.is_open,
        },
        "materials_json": materials,
        "api": {
            "start": reverse("studies:session_start"),
            # <id> yer tutucusu JS'te gercek oturum id'siyle degistirilir
            "data_tmpl": reverse("studies:session_data", args=[0]).replace("/0/", "/__ID__/"),
            "finish_tmpl": reverse("studies:session_finish", args=[0]).replace("/0/", "/__ID__/"),
        },
    }
    return render(request, "experiment/run_study.html", context)

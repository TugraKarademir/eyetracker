from pathlib import Path

from django.shortcuts import render
from django.templatetags.static import static


def _asset_version():
    """experiment.js'in degisiklik zamanini cache-busting icin dondurur.

    Tarayici eski JS'i onbellekten sunmasin diye script URL'sine ?v=<mtime>
    eklenir; dosya her degistiginde deger degisir ve onbellek atlanir.
    """
    js_path = Path(__file__).resolve().parent / "static" / "experiment" / "js" / "experiment.js"
    try:
        return str(int(js_path.stat().st_mtime))
    except OSError:
        return "0"


def run_experiment(request):
    """Faz 1 katilimci prototipi: jsPsych + WebGazer deney sayfasini sunar.

    Bu fazda sunucuya kayit YOKTUR; veri tarayicidan JSON olarak indirilir.
    """
    context = {
        "asset_version": _asset_version(),
        # Tek materyal (Faz 1). Faz 2'de bu veritabanindan gelecek.
        "material": {
            "src": static("experiment/materials/ornek_materyal.png"),
            "name": "ornek_materyal",
            "natural_width": 1200,
            "natural_height": 800,
        },
    }
    return render(request, "experiment/run.html", context)

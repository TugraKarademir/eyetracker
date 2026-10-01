from django.shortcuts import render
from django.templatetags.static import static


def run_experiment(request):
    """Faz 1 katilimci prototipi: jsPsych + WebGazer deney sayfasini sunar.

    Bu fazda sunucuya kayit YOKTUR; veri tarayicidan JSON olarak indirilir.
    """
    context = {
        # Tek materyal (Faz 1). Faz 2'de bu veritabanindan gelecek.
        "material": {
            "src": static("experiment/materials/ornek_materyal.png"),
            "name": "ornek_materyal",
            "natural_width": 1200,
            "natural_height": 800,
        },
    }
    return render(request, "experiment/run.html", context)

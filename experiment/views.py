import random as _random
from pathlib import Path

from django.shortcuts import get_object_or_404, render
from django.templatetags.static import static
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie

from studies import api as api_mod
from studies.models import Study

_JS_DIR = Path(__file__).resolve().parent / "static" / "experiment" / "js"


def williams_square(n):
    """Williams dengeli Latin kare: n (cift) satir; her kosul her konumda bir kez
    ve birinci-dereceden taşıma (carryover) dengeli. Tek n'de 2n dizi döner."""
    rows = []
    for i in range(n):
        row = []
        for j in range(n):
            k = j // 2 if j % 2 == 0 else n - 1 - (j - 1) // 2
            row.append((k + i) % n)
        rows.append(row)
    if n % 2 == 1:
        rows += [list(reversed(r)) for r in rows]
    return rows


def _order_materials(mats, scheme, seq_index):
    """mats (sira'ya gore) -> gosterim sirasina gore yeniden duzenle.

    scheme: 'latin' (Williams, seq_index ile dengeli), 'random' (rastgele),
    'fixed' (materyal 'order' alani). seq_index: bu katilimcinin sira numarasi.
    """
    n = len(mats)
    if n < 2:
        return list(mats)
    if scheme == "latin":
        rows = williams_square(n)
        perm = rows[seq_index % len(rows)]
        return [mats[p] for p in perm]
    if scheme == "random":
        out = list(mats)
        _random.shuffle(out)
        return out
    return list(mats)  # fixed


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
def iris_test(request):
    """Faz 7 arastirma: MediaPipe Iris tabanli gaze prototipi (tani sayfasi).

    Calisan akisa dokunmaz; WebGazer'a alternatif iris kestirimini olcmek icin.
    """
    return render(request, "experiment/iris_test.html",
                  {"asset_version": _asset_version("iris_test.js")})


@never_cache
@ensure_csrf_cookie
def run_study(request, code):
    """Faz 2: katilim koduyla cok-materyalli calisma; veri sunucuya kaydedilir."""
    study = get_object_or_404(Study, participation_code=code)
    materials = [
        {
            "id": m.id,
            "order": m.order,
            "kind": m.kind,
            "src": m.image.url if m.image else None,
            "video": m.video.url if m.video else None,
            "natural_width": m.natural_width,
            "natural_height": m.natural_height,
        }
        for m in study.materials.all()
    ]
    # Gaze motoru: VARSAYILAN jsPsych + WebGazer (RQ1 bu sistemi olcuyor).
    # MediaPipe, calisma ayarlarindan {"gaze_engine":"mediapipe"} ile acilir
    # ("sonradan eklenen" daha dogru alternatif; jsPsych disi). Ikisi de ayni
    # API/veri formatini kullanir -> analiz/AOI/rapor degismez.
    engine = (study.settings or {}).get("gaze_engine", "webgazer")
    if engine == "webgazer":
        template, js = "experiment/run_study.html", "study.js"
    else:
        template, js = "experiment/run_study_mp.html", "study_mp.js"

    from gaze_analysis.config import AnalysisConfig
    cfg = AnalysisConfig.from_dict(study.settings)
    settings = study.settings or {}

    # Materyal sunum sirasi (sira etkisini azaltmak icin). Sunucu tarafinda,
    # bu katilimcinin sira numarasina (seq) gore belirlenir:
    #   "latin"  = Williams dengeli Latin kare (onerilen, dengeli)
    #   "random" = rastgele; "fixed" = materyal order'i
    scheme = settings.get("order_scheme", "random")
    seq_index = study.sessions.count()
    materials = _order_materials(materials, scheme, seq_index)

    context = {
        "asset_version": _asset_version(js),
        "study": {
            "code": study.participation_code,
            "name": study.name,
            "is_open": study.is_open,
            # Kalite kapisi (spec §5.6, §7): dogrulama esigini gecmeden veri
            # toplanmaz. Esikler calisma ayarlarindan degistirilebilir.
            "max_validation_error_ratio": cfg.max_validation_error_ratio,
            "max_calibration_attempts": int(settings.get("max_calibration_attempts", 3)),
            # Varsayilan tek iris motoru; ayarlarda {"ensemble": true} ile acilir
            "ensemble": bool(settings.get("ensemble", False)),
            # Sira sunucu tarafinda belirlendi; istemci materials_json'u OLDUGU GIBI
            # kullanir (yeniden karistirmaz).
            "order_scheme": scheme,
        },
        "materials_json": materials,
        "api": {
            "start": reverse("studies:session_start"),
            # <id> yer tutucusu JS'te gercek oturum id'siyle degistirilir
            "data_tmpl": reverse("studies:session_data", args=[0]).replace("/0/", "/__ID__/"),
            "finish_tmpl": reverse("studies:session_finish", args=[0]).replace("/0/", "/__ID__/"),
            "load_tmpl": reverse("studies:cognitive_load", args=[0]).replace("/0/", "/__ID__/"),
        },
        # RQ3 Leppink maddeleri (her materyalden sonra; ayarla kapatilabilir)
        "leppink_items": api_mod.LEPPINK_ITEMS if settings.get("leppink", True) else [],
    }
    return render(request, template, context)

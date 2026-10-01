from django.shortcuts import render


def health_check(request):
    """Faz 0 saglik kontrolu: sunucunun HTTPS uzerinden ayakta oldugunu gosterir."""
    context = {
        "is_secure": request.is_secure(),
        "host": request.get_host(),
    }
    return render(request, "core/health_check.html", context)

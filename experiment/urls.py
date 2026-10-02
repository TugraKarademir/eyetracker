from django.urls import path

from . import views

app_name = "experiment"

urlpatterns = [
    # Faz 1 tek-materyal demo (geriye uyumlu, sunucuya kayit yok)
    path("dene/", views.run_experiment, name="run"),
    # Faz 7 arastirma: MediaPipe iris gaze prototipi (tani)
    path("iris-test/", views.iris_test, name="iris_test"),
    # Faz 2: katilim koduyla cok-materyalli calisma (sunucuya kayit)
    path("dene/<str:code>/", views.run_study, name="run_study"),
]
